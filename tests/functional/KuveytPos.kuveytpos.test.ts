import { describe, expect, it } from 'vitest'
import { posTestConfig } from '../../src/config/posTestConfig.js'
import { AccountFactory } from '../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../src/factory/CreditCardFactory.js'
import { PosFactory } from '../../src/factory/PosFactory.js'
import { CARD_TYPE, CURRENCY, MODEL, TX_TYPE } from '../../src/PosInterface.js'
import type { PosOrder, PosResponse } from '../../src/types.js'
import { maskSensitiveData } from '../../src/util/maskSensitiveData.js'

/** Status record fields printed for live verification (none of them secret). */
const RECORD_FIELDS = [
  'MerchantOrderId',
  'OrderId',
  'ResponseCode',
  'OrderStatus',
  'LastOrderStatus',
  'TransactionStatus',
  'FirstAmount',
  'CancelAmount',
  'DrawbackAmount',
  'FEC',
  'InstallmentCount',
  'TransactionSecurity',
  'ProvNumber',
  'RRN',
  'Stan',
  'OrderDate',
] as const

// Runs against the Kuveyt Turk test environment. Skipped unless FUNCTIONAL_TESTS=1 and KUVEYTPOS_MERCHANT_ID is
// set; never run in CI. All credentials come from the environment: KUVEYTPOS_MERCHANT_ID, KUVEYTPOS_USERNAME,
// KUVEYTPOS_CUSTOMER_NUMBER, KUVEYTPOS_PASSWORD and the test card in KUVEYTPOS_CARD_NUMBER,
// KUVEYTPOS_CARD_EXPIRY_MONTH, KUVEYTPOS_CARD_EXPIRY_YEAR, KUVEYTPOS_CARD_CVV.

const RUN = process.env.FUNCTIONAL_TESTS === '1' && Boolean(process.env.KUVEYTPOS_MERCHANT_ID)

const env = (name: string): string => process.env[name] ?? ''

function createGateway() {
  const account = AccountFactory.createBoaPosAccount(
    'kuveytpos',
    env('KUVEYTPOS_MERCHANT_ID'),
    env('KUVEYTPOS_USERNAME'),
    env('KUVEYTPOS_CUSTOMER_NUMBER'),
    env('KUVEYTPOS_PASSWORD'),
  )

  return PosFactory.createPosGateway(account, posTestConfig, { timeoutMs: 30_000 })
}

const card = () =>
  CreditCardFactory.create(
    env('KUVEYTPOS_CARD_NUMBER'),
    env('KUVEYTPOS_CARD_EXPIRY_YEAR'),
    env('KUVEYTPOS_CARD_EXPIRY_MONTH'),
    env('KUVEYTPOS_CARD_CVV'),
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
    success_url: `https://example.com/kuveytpos/success?o=${id}`,
    fail_url: `https://example.com/kuveytpos/fail?o=${id}`,
    payment_channel: '02',
    buyer: { email: 'buyer@example.com', gsm_number_cc: '90', gsm_number: '5000000000' },
    billing_address: { city: 'Istanbul', country: '792', address: 'Test', zip_code: '34000', state: '34' },
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

/** The references a cancel or refund needs, taken from the mapped sale. */
const references = (order: PosOrder, sale: PosResponse): PosOrder => ({
  id: order.id,
  amount: order.amount,
  currency: order.currency,
  remote_order_id: sale.remote_order_id as string,
  ref_ret_num: sale.ref_ret_num as string,
  auth_code: sale.auth_code as string,
  transaction_id: sale.transaction_id as string,
})

/** The order record of a mapped status answer (raw bank data). */
const orderRecord = (status: PosResponse): Record<string, unknown> => {
  const all = (status.all ?? {}) as Record<string, Record<string, Record<string, Record<string, unknown>>>>
  const contract = all.GetMerchantOrderDetailResponse?.GetMerchantOrderDetailResult?.Value?.OrderContract
  return contract !== null && typeof contract === 'object' ? (contract as Record<string, unknown>) : {}
}

describe.skipIf(!RUN)('KuveytPos against the Kuveyt Turk test environment', () => {
  it('non-3D sale, status and cancel are approved', async () => {
    const pos = createGateway()
    const order = newOrder()

    const sale = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card())
    console.info('[functional] sale', summary(sale))
    expect(sale.status, JSON.stringify(summary(sale))).toBe('approved')

    const status = await pos.status({ id: order.id })
    console.info('[functional] status', summary(status))
    // values only for non-secret fields of the bank's record; everything else stays unprinted
    const record = orderRecord(status)
    const shown = Object.fromEntries(RECORD_FIELDS.filter((k) => Object.hasOwn(record, k)).map((k) => [k, record[k]]))
    console.info('[functional] status record', JSON.stringify(maskSensitiveData(shown)))
    expect(status.status, JSON.stringify(summary(status))).toBe('approved')

    const cancel = await pos.cancel(references(order, sale))
    console.info('[functional] cancel', summary(cancel))
    expect(cancel.status, JSON.stringify(summary(cancel))).toBe('approved')
  }, 120_000)

  it('a partial refund of a sale is answered (the bank may refuse same-day refunds)', async () => {
    const pos = createGateway()
    const order = newOrder(2.02)

    const sale = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card())
    console.info('[functional] sale', summary(sale))
    expect(sale.status, JSON.stringify(summary(sale))).toBe('approved')

    const refund = await pos.refund({ ...references(order, sale), amount: 1.01, order_amount: 2.02 })
    console.info('[functional] partial refund', summary(refund))
    expect(['approved', 'declined']).toContain(refund.status)
    expect(refund).toHaveProperty('proc_return_code')
    expect(refund).toHaveProperty('error_code')
  }, 120_000)

  it('3D initialization returns the bank page', async () => {
    const pos = createGateway()
    const html = await pos.get3DFormData(newOrder(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card())
    expect(typeof html).toBe('string')
    expect((html as string).trim()).not.toBe('')
  }, 120_000)
})
