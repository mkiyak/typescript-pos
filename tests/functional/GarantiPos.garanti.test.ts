import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { posTestConfig } from '../../src/config/posTestConfig.js'
import { AccountFactory } from '../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../src/factory/CreditCardFactory.js'
import { PosFactory } from '../../src/factory/PosFactory.js'
import { CARD_TYPE, CURRENCY, MODEL, TX_TYPE } from '../../src/PosInterface.js'
import type { PosOrder, PosResponse } from '../../src/types.js'

// Runs against the Garanti test environment. Skipped unless FUNCTIONAL_TESTS=1 and GARANTI_MERCHANT_ID is set;
// never run in CI. All credentials come from the environment:
// GARANTI_MERCHANT_ID, GARANTI_USERNAME, GARANTI_PASSWORD, GARANTI_TERMINAL_ID, GARANTI_STORE_KEY,
// GARANTI_REFUND_USERNAME, GARANTI_REFUND_PASSWORD.

const RUN = process.env.FUNCTIONAL_TESTS === '1' && Boolean(process.env.GARANTI_MERCHANT_ID)

const env = (name: string): string => process.env[name] ?? ''

function createGateway() {
  const account = AccountFactory.createGarantiPosAccount(
    'garanti',
    env('GARANTI_MERCHANT_ID'),
    env('GARANTI_USERNAME'),
    env('GARANTI_PASSWORD'),
    env('GARANTI_TERMINAL_ID'),
    env('GARANTI_STORE_KEY') || null,
    env('GARANTI_REFUND_USERNAME') || null,
    env('GARANTI_REFUND_PASSWORD') || null,
  )

  return PosFactory.createPosGateway(account, posTestConfig, { timeoutMs: 30_000 })
}

const card = () => CreditCardFactory.create('4282209004348015', '30', '08', '123', 'John Doe', CARD_TYPE.VISA)

const newOrder = (): PosOrder => {
  const token = randomBytes(6).toString('hex')
  return {
    id: `TSPOS${token.toUpperCase()}`,
    amount: 1.01,
    currency: CURRENCY.TRY,
    installment: 0,
    ip: '127.0.0.1',
    success_url: `https://example.com/garanti/success?t=${token}`,
    fail_url: `https://example.com/garanti/fail?t=${token}`,
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

describe.skipIf(!RUN)('GarantiPos against the Garanti test environment', () => {
  it('non-3D sale, status, order history and cancel are approved', async () => {
    const pos = createGateway()
    const order = newOrder()

    const sale = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card())
    console.info('[functional] sale', summary(sale))
    expect(sale.status, JSON.stringify(summary(sale))).toBe('approved')

    const status = await pos.status({ id: order.id, currency: order.currency, amount: order.amount, ip: order.ip })
    console.info('[functional] status', summary(status))
    expect(status.status, JSON.stringify(summary(status))).toBe('approved')

    const history = await pos.orderHistory({ id: order.id, currency: order.currency, ip: order.ip })
    console.info('[functional] order history', summary(history))
    expect(history.status, JSON.stringify(summary(history))).toBe('approved')

    const cancel = await pos.cancel({
      id: order.id,
      currency: order.currency,
      amount: order.amount,
      ip: order.ip,
      ref_ret_num: sale.ref_ret_num as string,
    })
    console.info('[functional] cancel', summary(cancel))
    expect(cancel.status, JSON.stringify(summary(cancel))).toBe('approved')
  }, 120_000)
})
