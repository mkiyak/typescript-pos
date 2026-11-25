import { describe, expect, it } from 'vitest'
import { posTestConfig } from '../../src/config/posTestConfig.js'
import { AccountFactory } from '../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../src/factory/CreditCardFactory.js'
import { PosFactory } from '../../src/factory/PosFactory.js'
import { CARD_TYPE, CURRENCY, MODEL, TX_TYPE } from '../../src/PosInterface.js'
import type { PosOrder, PosResponse, ThreeDFormData } from '../../src/types.js'
import { maskSensitiveData } from '../../src/util/maskSensitiveData.js'

/**
 * Status record fields printed for live verification (none of them secret): the shape the confirmation of 3D
 * approvals depends on (result codes, state, transaction type, dotted amounts, installment count). The receipt and
 * transaction ids are printed as their kind only.
 */
const RECORD_FIELDS = ['Durum', 'Odeme_Sonuc', 'Islem_Tip', 'Toplam_Tutar', 'Toplam_Iade_Tutar', 'Taksit'] as const
const RECORD_KINDS = ['Dekont_ID', 'Islem_ID'] as const

// Runs against the Param test environment. Skipped unless FUNCTIONAL_TESTS=1 and PARAMPOS_MERCHANT_ID is set; never
// run in CI. All credentials come from the environment: PARAMPOS_MERCHANT_ID (client code), PARAMPOS_USERNAME,
// PARAMPOS_PASSWORD, PARAMPOS_CLIENT_SECRET (the merchant GUID) and the test card in PARAMPOS_CARD_NUMBER,
// PARAMPOS_CARD_EXPIRY_MONTH, PARAMPOS_CARD_EXPIRY_YEAR, PARAMPOS_CARD_CVV.

const RUN = process.env.FUNCTIONAL_TESTS === '1' && Boolean(process.env.PARAMPOS_MERCHANT_ID)

const env = (name: string): string => process.env[name] ?? ''

function createGateway() {
  const account = AccountFactory.createParamPosAccount(
    'param-pos',
    env('PARAMPOS_MERCHANT_ID'),
    env('PARAMPOS_USERNAME'),
    env('PARAMPOS_PASSWORD'),
    env('PARAMPOS_CLIENT_SECRET'),
  )

  return PosFactory.createPosGateway(account, posTestConfig, { timeoutMs: 30_000 })
}

const card = () =>
  CreditCardFactory.create(
    env('PARAMPOS_CARD_NUMBER'),
    env('PARAMPOS_CARD_EXPIRY_YEAR'),
    env('PARAMPOS_CARD_EXPIRY_MONTH'),
    env('PARAMPOS_CARD_CVV'),
    'John Doe',
    CARD_TYPE.MASTERCARD,
  )

// Order ids are a letter or digit, then letters, digits, underscore and hyphen (at most 64).
const newOrder = (amount = 10.01): PosOrder => {
  const id = `PP${Date.now()}${Math.floor(Math.random() * 1000)}`
  return {
    id,
    amount,
    currency: CURRENCY.TRY,
    installment: 0,
    ip: '127.0.0.1',
    success_url: `https://example.com/param/callback?o=${id}`,
    fail_url: `https://example.com/param/callback?o=${id}`,
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** The allow-listed, masked fields of a status answer and the kind of the ids; everything else stays unprinted. */
const shownRecord = (answer: unknown): Record<string, unknown> => {
  const response = isRecord(answer) ? answer.TP_Islem_Sorgulama4Response : undefined
  const result = isRecord(response) ? response.TP_Islem_Sorgulama4Result : undefined
  if (!isRecord(result)) return {}
  const shown: Record<string, unknown> = { Sonuc: result.Sonuc, DT_Bilgi_type: typeof result.DT_Bilgi }
  const record = result.DT_Bilgi
  if (isRecord(record)) {
    for (const key of RECORD_FIELDS) {
      if (Object.hasOwn(record, key)) shown[key] = record[key]
    }
    for (const key of RECORD_KINDS) {
      shown[`${key}_type`] = Object.hasOwn(record, key) ? typeof record[key] : 'absent'
    }
  } else if (Array.isArray(record)) {
    shown.DT_Bilgi_type = 'list'
  }
  return maskSensitiveData(shown) as Record<string, unknown>
}

describe.skipIf(!RUN)('ParamPos against the Param test environment', () => {
  it('non-3D sale, status and cancel are approved', async () => {
    const pos = createGateway()
    const order = newOrder()

    const sale = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card())
    console.info('[functional] sale', summary(sale))
    expect(sale.status, JSON.stringify(summary(sale))).toBe('approved')

    const status = await pos.status({ id: order.id })
    console.info('[functional] status', summary(status))
    console.info('[functional] status record', JSON.stringify(shownRecord(status.all)))
    expect(status.status, JSON.stringify(summary(status))).toBe('approved')

    // Cancelling a sale needs its amount.
    const cancel = await pos.cancel({ id: order.id, amount: order.amount })
    console.info('[functional] cancel', summary(cancel))
    expect(cancel.status, JSON.stringify(summary(cancel))).toBe('approved')
  }, 120_000)

  it('pre-authorization and post-authorization are approved', async () => {
    const pos = createGateway()
    const order = newOrder()

    const pre = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_PRE_AUTH, card())
    console.info('[functional] pre-authorization', summary(pre))
    expect(pre.status, JSON.stringify(summary(pre))).toBe('approved')

    const post = await pos.payment(MODEL.NON_SECURE, { id: order.id, amount: order.amount }, TX_TYPE.PAY_POST_AUTH)
    console.info('[functional] post-authorization', summary(post))
    expect(post.status, JSON.stringify(summary(post))).toBe('approved')
  }, 120_000)

  it('a partial refund answers with the mapped shape', async () => {
    const pos = createGateway()
    const order = newOrder()

    const sale = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card())
    console.info('[functional] sale', summary(sale))
    expect(sale.status, JSON.stringify(summary(sale))).toBe('approved')

    // The bank may refuse a refund on the day of the sale; only the mapped shape is asserted.
    const refund = await pos.refund({ id: order.id, amount: 5.01, order_amount: order.amount })
    console.info('[functional] partial refund', summary(refund))
    expect(['approved', 'declined']).toContain(refund.status)
  }, 120_000)

  it('3D Secure and 3D Pay payments are registered', async () => {
    const pos = createGateway()

    const page = await pos.get3DFormData(newOrder(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card())
    // the length only: the page is the bank's card-check page
    console.info('[functional] 3D Secure page length', typeof page === 'string' ? page.length : typeof page)
    expect(typeof page).toBe('string')
    expect((page as string).length).toBeGreaterThan(0)

    const pay = (await pos.get3DFormData(newOrder(), MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, card())) as ThreeDFormData
    // input names only
    console.info('[functional] 3D Pay form', pay.gateway, pay.method, Object.keys(pay.inputs))
    expect(pay.method).toBe('GET')
    expect(pay.gateway.startsWith('https://')).toBe(true)
  }, 120_000)
})
