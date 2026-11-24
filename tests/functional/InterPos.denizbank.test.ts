import { describe, expect, it } from 'vitest'
import { posTestConfig } from '../../src/config/posTestConfig.js'
import { AccountFactory } from '../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../src/factory/CreditCardFactory.js'
import { PosFactory } from '../../src/factory/PosFactory.js'
import { CARD_TYPE, CURRENCY, MODEL, TX_TYPE } from '../../src/PosInterface.js'
import type { PosOrder, PosResponse, ThreeDFormData } from '../../src/types.js'

// Runs against the Denizbank InterPos test environment. Skipped unless FUNCTIONAL_TESTS=1 and
// INTERPOS_SHOP_CODE is set; never run in CI. All credentials come from the environment:
// INTERPOS_SHOP_CODE, INTERPOS_USER_CODE, INTERPOS_USER_PASS, INTERPOS_MERCHANT_PASS and the test card in
// INTERPOS_CARD_NUMBER, INTERPOS_CARD_EXPIRY_MONTH, INTERPOS_CARD_EXPIRY_YEAR, INTERPOS_CARD_CVV.

const RUN = process.env.FUNCTIONAL_TESTS === '1' && Boolean(process.env.INTERPOS_SHOP_CODE)

const env = (name: string): string => process.env[name] ?? ''

function createGateway() {
  const account = AccountFactory.createInterPosAccount(
    'denizbank',
    env('INTERPOS_SHOP_CODE'),
    env('INTERPOS_USER_CODE'),
    env('INTERPOS_USER_PASS'),
    env('INTERPOS_MERCHANT_PASS'),
  )

  return PosFactory.createPosGateway(account, posTestConfig, { timeoutMs: 30_000 })
}

const card = () =>
  CreditCardFactory.create(
    env('INTERPOS_CARD_NUMBER'),
    env('INTERPOS_CARD_EXPIRY_YEAR'),
    env('INTERPOS_CARD_EXPIRY_MONTH'),
    env('INTERPOS_CARD_CVV'),
    'John Doe',
    CARD_TYPE.VISA,
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
    success_url: `https://example.com/interpos/success?o=${id}`,
    fail_url: `https://example.com/interpos/fail?o=${id}`,
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

describe.skipIf(!RUN)('InterPos against the Denizbank test environment', () => {
  it('non-3D sale, status and cancel are approved', async () => {
    const pos = createGateway()
    const order = newOrder()

    const sale = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card())
    console.info('[functional] sale', summary(sale))
    expect(sale.status, JSON.stringify(summary(sale))).toBe('approved')

    // The shape of the approved status record is what the 3D Pay/Host confirmation relies on: the record keys and
    // the non-secret values are printed so they can be compared with the expected shape.
    const status = await pos.status({ id: order.id })
    console.info('[functional] status', summary(status), 'record keys', Object.keys(status.all ?? {}))
    console.info('[functional] status record', JSON.stringify(status.all))
    expect(status.order_id, JSON.stringify(summary(status))).toBe(order.id)

    const cancel = await pos.cancel({ id: order.id })
    console.info('[functional] cancel', summary(cancel))
    expect(cancel.status, JSON.stringify(summary(cancel))).toBe('approved')
  }, 120_000)

  it('pre-authorization followed by post-authorization is approved', async () => {
    const pos = createGateway()
    const order = newOrder()

    const pre = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_PRE_AUTH, card())
    console.info('[functional] pre-auth', summary(pre))
    expect(pre.status, JSON.stringify(summary(pre))).toBe('approved')

    const post = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_POST_AUTH)
    console.info('[functional] post-auth', summary(post))
    expect(post.status, JSON.stringify(summary(post))).toBe('approved')
  }, 120_000)

  it('3D initialization returns a signed form with 16 inputs', async () => {
    const pos = createGateway()
    const form = await pos.get3DFormData(newOrder(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card())
    const inputs = (form as ThreeDFormData).inputs
    expect(Object.keys(inputs)).toHaveLength(16)
    expect(Object.keys(inputs)).toContain('Hash')
  }, 120_000)
})
