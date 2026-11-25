import { describe, expect, it } from 'vitest'
import { posTestConfig } from '../../src/config/posTestConfig.js'
import { AccountFactory } from '../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../src/factory/CreditCardFactory.js'
import { PosFactory } from '../../src/factory/PosFactory.js'
import { CARD_TYPE, CURRENCY, MODEL, TX_TYPE } from '../../src/PosInterface.js'
import type { PosOrder, PosResponse, ThreeDFormData } from '../../src/types.js'
import { maskSensitiveData } from '../../src/util/maskSensitiveData.js'

/**
 * Status record fields printed for live verification (none of them secret), with the kind of each value: the shape
 * the confirmation of 3D Pay / 3D Host approvals depends on (result codes, request status, transaction type, kuruş
 * amounts, currency, installment count).
 */
const RECORD_FIELDS = [
  'Code',
  'BankResponseCode',
  'RequestStatus',
  'TransactionType',
  'Amount',
  'Currency',
  'InstallmentCount',
  'RefundedAmount',
  'PostAuthedAmount',
] as const

// Runs against the Tosla test environment. Skipped unless FUNCTIONAL_TESTS=1 and TOSLA_MERCHANT_ID is set; never run
// in CI. All credentials come from the environment: TOSLA_MERCHANT_ID, TOSLA_USERNAME, TOSLA_PASSWORD and the test
// card in TOSLA_CARD_NUMBER, TOSLA_CARD_EXPIRY_MONTH, TOSLA_CARD_EXPIRY_YEAR, TOSLA_CARD_CVV.

const RUN = process.env.FUNCTIONAL_TESTS === '1' && Boolean(process.env.TOSLA_MERCHANT_ID)

const env = (name: string): string => process.env[name] ?? ''

function createGateway() {
  const account = AccountFactory.createToslaPosAccount(
    'tosla',
    env('TOSLA_MERCHANT_ID'),
    env('TOSLA_USERNAME'),
    env('TOSLA_PASSWORD'),
  )

  return PosFactory.createPosGateway(account, posTestConfig, { timeoutMs: 30_000 })
}

const card = () =>
  CreditCardFactory.create(
    env('TOSLA_CARD_NUMBER'),
    env('TOSLA_CARD_EXPIRY_YEAR'),
    env('TOSLA_CARD_EXPIRY_MONTH'),
    env('TOSLA_CARD_CVV'),
    'John Doe',
    CARD_TYPE.VISA,
  )

// Order ids are a letter or digit, then letters, digits, underscore and hyphen (at most 64).
const newOrder = (amount = 1.01): PosOrder => {
  const id = `TS${Date.now()}${Math.floor(Math.random() * 1000)}`
  return {
    id,
    amount,
    currency: CURRENCY.TRY,
    installment: 0,
    success_url: `https://example.com/tosla/callback?o=${id}`,
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

/** The allow-listed, masked fields of a status record and the kind of each value; everything else stays unprinted. */
const shownRecord = (record: unknown): Record<string, unknown> => {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return {}
  const fields = record as Record<string, unknown>
  const shown: Record<string, unknown> = {}
  for (const key of RECORD_FIELDS) {
    if (!Object.hasOwn(fields, key)) continue
    shown[key] = fields[key]
    shown[`${key}_type`] = fields[key] === null ? 'null' : typeof fields[key]
  }
  return maskSensitiveData(shown) as Record<string, unknown>
}

describe.skipIf(!RUN)('ToslaPos against the Tosla test environment', () => {
  it('non-3D sale, status, order history and cancel are approved', async () => {
    const pos = createGateway()
    const order = newOrder()

    const sale = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card())
    console.info('[functional] sale', summary(sale))
    expect(sale.status, JSON.stringify(summary(sale))).toBe('approved')

    const status = await pos.status({ id: order.id })
    console.info('[functional] status', summary(status))
    console.info('[functional] status record', JSON.stringify(shownRecord(status.all)))
    expect(status.status, JSON.stringify(summary(status))).toBe('approved')

    const history = await pos.orderHistory({ id: order.id, transaction_date: new Date() })
    console.info('[functional] order history', summary(history), history.trans_count)
    expect(history.status, JSON.stringify(summary(history))).toBe('approved')

    const cancel = await pos.cancel({ id: order.id })
    console.info('[functional] cancel', summary(cancel))
    expect(cancel.status, JSON.stringify(summary(cancel))).toBe('approved')
  }, 120_000)

  it('a partial refund answers with the mapped shape', async () => {
    const pos = createGateway()
    const order = newOrder()

    const sale = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card())
    console.info('[functional] sale', summary(sale))
    expect(sale.status, JSON.stringify(summary(sale))).toBe('approved')

    // The bank may refuse a refund on the day of the sale; only the mapped shape is asserted.
    const refund = await pos.refund({ id: order.id, amount: 0.59, order_amount: order.amount })
    console.info('[functional] partial refund', summary(refund))
    expect(['approved', 'declined']).toContain(refund.status)
  }, 120_000)

  it('3D Pay and 3D Host sessions are registered', async () => {
    const pos = createGateway()

    const pay = (await pos.get3DFormData(newOrder(), MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, card())) as ThreeDFormData
    // input names only: the form carries the card
    console.info('[functional] 3D Pay form', pay.gateway, Object.keys(pay.inputs))
    expect(pay.inputs.ThreeDSessionId).toMatch(/^[A-Za-z0-9]{1,128}$/)

    const host = (await pos.get3DFormData(
      newOrder(),
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_AUTH,
      null,
      true,
    )) as ThreeDFormData
    console.info('[functional] 3D Host form', host.method)
    expect(host.gateway.startsWith(`${posTestConfig.banks.tosla.gateway_endpoints.gateway_3d_host}/`)).toBe(true)
  }, 120_000)
})
