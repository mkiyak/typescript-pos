import { describe, expect, it } from 'vitest'
import { posTestConfig } from '../../src/config/posTestConfig.js'
import { AccountFactory } from '../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../src/factory/CreditCardFactory.js'
import { PosFactory } from '../../src/factory/PosFactory.js'
import { CARD_TYPE, CURRENCY, MODEL, TX_TYPE } from '../../src/PosInterface.js'
import type { PosOrder, PosResponse, ThreeDFormData } from '../../src/types.js'
import { maskSensitiveData } from '../../src/util/maskSensitiveData.js'

/**
 * Order record fields printed for live verification (none of them secret): the shape the 3D Host confirmation
 * depends on (order and transaction status, amounts, currency, security level, references).
 */
const RECORD_FIELDS = [
  'MerchantOrderId',
  'OrderId',
  'ResponseCode',
  'OrderStatus',
  'LastOrderStatus',
  'OrderType',
  'TransactionStatus',
  'FirstAmount',
  'CancelAmount',
  'DrawbackAmount',
  'ClosedAmount',
  'FEC',
  'InstallmentCount',
  'TransactionSecurity',
  'ProvNumber',
  'RRN',
  'Stan',
  'OrderDate',
] as const

// Runs against the Vakıf Katılım test merchant. Skipped unless FUNCTIONAL_TESTS=1 and VAKIF_KATILIM_MERCHANT_ID is
// set; never run in CI. All credentials come from the environment: VAKIF_KATILIM_MERCHANT_ID,
// VAKIF_KATILIM_USERNAME, VAKIF_KATILIM_CUSTOMER_NUMBER, VAKIF_KATILIM_PASSWORD and the test card in
// VAKIF_KATILIM_CARD_NUMBER, VAKIF_KATILIM_CARD_EXPIRY_MONTH, VAKIF_KATILIM_CARD_EXPIRY_YEAR, VAKIF_KATILIM_CARD_CVV.

const RUN = process.env.FUNCTIONAL_TESTS === '1' && Boolean(process.env.VAKIF_KATILIM_MERCHANT_ID)

const env = (name: string): string => process.env[name] ?? ''

function createGateway() {
  const account = AccountFactory.createBoaPosAccount(
    'vakif-katilim',
    env('VAKIF_KATILIM_MERCHANT_ID'),
    env('VAKIF_KATILIM_USERNAME'),
    env('VAKIF_KATILIM_CUSTOMER_NUMBER'),
    env('VAKIF_KATILIM_PASSWORD'),
  )

  return PosFactory.createPosGateway(account, posTestConfig, { timeoutMs: 30_000 })
}

const card = () =>
  CreditCardFactory.create(
    env('VAKIF_KATILIM_CARD_NUMBER'),
    env('VAKIF_KATILIM_CARD_EXPIRY_YEAR'),
    env('VAKIF_KATILIM_CARD_EXPIRY_MONTH'),
    env('VAKIF_KATILIM_CARD_CVV'),
    'John Doe',
    CARD_TYPE.MASTERCARD,
  )

// Order ids are at most 64 characters of letters, digits, underscore and hyphen.
const newOrder = (amount = 1.01): PosOrder => {
  const id = `TS${Date.now()}${Math.floor(Math.random() * 1000)}`
  return {
    id,
    amount,
    currency: CURRENCY.TRY,
    installment: 0,
    ip: '127.0.0.1',
    success_url: `https://example.com/vakif-katilim/success?o=${id}`,
    fail_url: `https://example.com/vakif-katilim/fail?o=${id}`,
  }
}

/** Bank codes only (no card data, hashes or credentials) for the run record; run with `--silent=false`. */
const summary = (res: PosResponse) => ({
  status: res.status,
  proc_return_code: res.proc_return_code,
  error_code: res.error_code,
  error_message: res.error_message,
  order_id: res.order_id,
})

/** The allow-listed, masked fields of one order record; everything else stays unprinted. */
const shownRecord = (record: unknown): Record<string, unknown> => {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return {}
  const fields = record as Record<string, unknown>
  const shown = Object.fromEntries(RECORD_FIELDS.filter((k) => Object.hasOwn(fields, k)).map((k) => [k, fields[k]]))
  return maskSensitiveData(shown) as Record<string, unknown>
}

/** The order records of a mapped status answer (raw bank data): one record or a list, as the bank sent it. */
const orderRecords = (status: PosResponse): { shape: string; records: Record<string, unknown>[] } => {
  const all = (status.all ?? {}) as Record<string, unknown>
  const data = all.VPosOrderData as Record<string, unknown> | null | undefined
  const contract = data !== null && typeof data === 'object' ? data.OrderContract : undefined
  if (Array.isArray(contract)) return { shape: `list of ${contract.length}`, records: contract.map(shownRecord) }
  if (contract !== null && typeof contract === 'object') return { shape: 'single', records: [shownRecord(contract)] }
  return { shape: 'none', records: [] }
}

describe.skipIf(!RUN)('VakifKatilimPos against the Vakıf Katılım test merchant', () => {
  it('non-3D sale, status and cancel are approved', async () => {
    const pos = createGateway()
    const order = newOrder()

    const sale = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card())
    console.info('[functional] sale', summary(sale))
    expect(sale.status, JSON.stringify(summary(sale))).toBe('approved')

    const status = await pos.status({ id: order.id })
    console.info('[functional] status', summary(status))
    const { shape, records } = orderRecords(status)
    console.info('[functional] status record shape', shape, JSON.stringify(records))
    expect(status.status, JSON.stringify(summary(status))).toBe('approved')

    const cancel = await pos.cancel({
      id: order.id,
      amount: order.amount,
      remote_order_id: sale.remote_order_id as string,
      transaction_type: TX_TYPE.PAY_AUTH,
    })
    console.info('[functional] cancel', summary(cancel))
    expect(cancel.status, JSON.stringify(summary(cancel))).toBe('approved')
  }, 120_000)

  it('a pre-authorization and its close are approved', async () => {
    const pos = createGateway()
    const order = newOrder()

    const pre = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_PRE_AUTH, card())
    console.info('[functional] pre-auth', summary(pre))
    expect(pre.status, JSON.stringify(summary(pre))).toBe('approved')

    const post = await pos.payment(
      MODEL.NON_SECURE,
      { id: order.id, remote_order_id: pre.remote_order_id as string, ip: '127.0.0.1' },
      TX_TYPE.PAY_POST_AUTH,
    )
    console.info('[functional] post-auth', summary(post))
    expect(post.status, JSON.stringify(summary(post))).toBe('approved')
  }, 120_000)

  it('3D Host form data carries the nine inputs of the common payment page', async () => {
    const pos = createGateway()
    const form = (await pos.get3DFormData(
      newOrder(),
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_AUTH,
      null,
      true,
    )) as ThreeDFormData
    // input names only: the form carries the hashed API password
    console.info('[functional] 3D Host form', form.gateway, Object.keys(form.inputs))
    expect(Object.keys(form.inputs)).toHaveLength(9)
  }, 120_000)
})
