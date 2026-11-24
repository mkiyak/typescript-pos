import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { posTestConfig } from '../../src/config/posTestConfig.js'
import { AccountFactory } from '../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../src/factory/CreditCardFactory.js'
import { PosFactory } from '../../src/factory/PosFactory.js'
import { CARD_TYPE, CURRENCY, MODEL, TX_TYPE } from '../../src/PosInterface.js'
import type { PosOrder, PosResponse } from '../../src/types.js'

// Runs against the Akbank test environment. Skipped unless FUNCTIONAL_TESTS=1 and AKBANKPOS_MERCHANT_ID is set;
// never run in CI. All credentials come from the environment:
// AKBANKPOS_MERCHANT_ID, AKBANKPOS_TERMINAL_ID, AKBANKPOS_SECRET_KEY.

const RUN = process.env.FUNCTIONAL_TESTS === '1' && Boolean(process.env.AKBANKPOS_MERCHANT_ID)

const env = (name: string): string => process.env[name] ?? ''

function createGateway() {
  const account = AccountFactory.createAkbankPosAccount(
    'akbank-pos',
    env('AKBANKPOS_MERCHANT_ID'),
    env('AKBANKPOS_TERMINAL_ID'),
    env('AKBANKPOS_SECRET_KEY'),
  )

  return PosFactory.createPosGateway(account, posTestConfig, { timeoutMs: 30_000 })
}

const card = () => CreditCardFactory.create('4355093000315232', '28', '01', '264', 'John Doe', CARD_TYPE.VISA)

const newOrder = (): PosOrder => {
  const token = randomBytes(6).toString('hex')
  return {
    id: `TSPOS${token.toUpperCase()}`,
    amount: 1.01,
    currency: CURRENCY.TRY,
    installment: 0,
    ip: '127.0.0.1',
    success_url: `https://example.com/akbank/success?t=${token}`,
    fail_url: `https://example.com/akbank/fail?t=${token}`,
  }
}

/** Bank codes only (no card data) for the run record; run with `--silent=false` to see them. */
const summary = (res: PosResponse) => ({
  status: res.status,
  proc_return_code: res.proc_return_code,
  error_code: res.error_code,
  error_message: res.error_message,
  order_id: res.order_id,
  ref_ret_num: res.ref_ret_num ?? null,
})

describe.skipIf(!RUN)('AkbankPos against the Akbank test environment', () => {
  it('non-3D sale, order history and cancel are approved', async () => {
    const pos = createGateway()
    const order = newOrder()

    const sale = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card())
    console.info('[functional] sale', summary(sale))
    expect(sale.status, JSON.stringify(summary(sale))).toBe('approved')

    const history = await pos.orderHistory({ id: order.id, currency: order.currency, ip: order.ip })
    console.info('[functional] order history', summary(history))
    expect(history.status, JSON.stringify(summary(history))).toBe('approved')

    // Same-day sales are cancelled, not refunded.
    const cancel = await pos.cancel({ id: order.id, currency: order.currency, amount: order.amount, ip: order.ip })
    console.info('[functional] cancel', summary(cancel))
    expect(cancel.status, JSON.stringify(summary(cancel))).toBe('approved')
  }, 120_000)

  it('non-3D pre-authorization is completed by a post-authorization', async () => {
    const pos = createGateway()
    const order = newOrder()

    const pre = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_PRE_AUTH, card())
    console.info('[functional] pre-auth', summary(pre))
    expect(pre.status, JSON.stringify(summary(pre))).toBe('approved')

    const post = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_POST_AUTH)
    console.info('[functional] post-auth', summary(post))
    expect(post.status, JSON.stringify(summary(post))).toBe('approved')
  }, 120_000)
})
