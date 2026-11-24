import { describe, expect, it } from 'vitest'
import { posTestConfig } from '../../src/config/posTestConfig.js'
import { AccountFactory } from '../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../src/factory/CreditCardFactory.js'
import { PosFactory } from '../../src/factory/PosFactory.js'
import { CARD_TYPE, CURRENCY, MODEL, TX_TYPE } from '../../src/PosInterface.js'
import type { PosOrder, PosResponse, ThreeDFormData } from '../../src/types.js'

// Runs against the QNB Finansbank PayFor test environment. Skipped unless FUNCTIONAL_TESTS=1 and
// PAYFOR_QNB_MERCHANT_ID is set; never run in CI. All credentials come from the environment:
// PAYFOR_QNB_MERCHANT_ID, PAYFOR_QNB_USER_CODE, PAYFOR_QNB_USER_PASSWORD, PAYFOR_QNB_MERCHANT_PASS.

const RUN = process.env.FUNCTIONAL_TESTS === '1' && Boolean(process.env.PAYFOR_QNB_MERCHANT_ID)

const env = (name: string): string => process.env[name] ?? ''

function createGateway() {
  const account = AccountFactory.createPayForPosAccount(
    'qnbfinansbank-payfor',
    env('PAYFOR_QNB_MERCHANT_ID'),
    env('PAYFOR_QNB_USER_CODE'),
    env('PAYFOR_QNB_USER_PASSWORD'),
    env('PAYFOR_QNB_MERCHANT_PASS'),
  )

  return PosFactory.createPosGateway(account, posTestConfig, { timeoutMs: 30_000 })
}

const card = () => CreditCardFactory.create('4155650100416111', '28', '01', '123', 'John Doe', CARD_TYPE.VISA)

// The bank accepts at most 64 characters for the order id.
const newOrder = (amount = 1.01): PosOrder => {
  const id = `TS${Date.now()}${Math.floor(Math.random() * 1000)}`
  return {
    id,
    amount,
    currency: CURRENCY.TRY,
    installment: 0,
    ip: '127.0.0.1',
    success_url: `https://example.com/payfor/success?o=${id}`,
    fail_url: `https://example.com/payfor/fail?o=${id}`,
  }
}

/** Bank codes only (no card data) for the run record; run with `--silent=false` to see them. */
const summary = (res: PosResponse) => ({
  status: res.status,
  proc_return_code: res.proc_return_code,
  error_code: res.error_code,
  error_message: res.error_message,
  order_id: res.order_id,
})

describe.skipIf(!RUN)('PayForPos against the QNB Finansbank test environment', () => {
  it('non-3D sale, status and cancel are approved', async () => {
    const pos = createGateway()
    const order = newOrder()

    const sale = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card())
    console.info('[functional] sale', summary(sale))
    expect(sale.status, JSON.stringify(summary(sale))).toBe('approved')

    const status = await pos.status({ id: order.id })
    console.info('[functional] status', summary(status))
    expect(status.status, JSON.stringify(summary(status))).toBe('approved')

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

    const post = await pos.payment(MODEL.NON_SECURE, { ...order, amount: 1.03 }, TX_TYPE.PAY_POST_AUTH)
    console.info('[functional] post-auth', summary(post))
    expect(post.status, JSON.stringify(summary(post))).toBe('approved')
  }, 120_000)

  it('order history lists the transactions of an order', async () => {
    const pos = createGateway()
    const order = newOrder()

    const sale = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card())
    expect(sale.status, JSON.stringify(summary(sale))).toBe('approved')

    const history = await pos.orderHistory({ id: order.id })
    console.info('[functional] order history', summary(history))
    expect(history.status, JSON.stringify(summary(history))).toBe('approved')
    expect(Array.isArray(history.transactions)).toBe(true)
  }, 120_000)

  it('3D initialization returns a signed form with 19 inputs', async () => {
    const pos = createGateway()
    const form = await pos.get3DFormData(newOrder(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card())
    const inputs = (form as ThreeDFormData).inputs
    expect(Object.keys(inputs)).toHaveLength(19)
    expect(Object.keys(inputs)).toContain('Hash')
  }, 120_000)
})
