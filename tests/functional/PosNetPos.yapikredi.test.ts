import { describe, expect, it } from 'vitest'
import { posTestConfig } from '../../src/config/posTestConfig.js'
import { AccountFactory } from '../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../src/factory/CreditCardFactory.js'
import { PosFactory } from '../../src/factory/PosFactory.js'
import { CARD_TYPE, CURRENCY, MODEL, TX_TYPE } from '../../src/PosInterface.js'
import type { PosOrder, PosResponse, ThreeDFormData } from '../../src/types.js'

// Runs against the Yapi Kredi PosNet test environment. Skipped unless FUNCTIONAL_TESTS=1 and POSNET_YKB_MERCHANT_ID is
// set; never run in CI. All credentials come from the environment:
// POSNET_YKB_MERCHANT_ID, POSNET_YKB_TERMINAL_ID, POSNET_YKB_POS_ID, POSNET_YKB_ENC_KEY (optional).

const RUN = process.env.FUNCTIONAL_TESTS === '1' && Boolean(process.env.POSNET_YKB_MERCHANT_ID)

const env = (name: string): string => process.env[name] ?? ''

function createGateway() {
  const account = AccountFactory.createPosNetPosAccount(
    'yapikredi',
    env('POSNET_YKB_MERCHANT_ID'),
    env('POSNET_YKB_TERMINAL_ID'),
    env('POSNET_YKB_POS_ID'),
    env('POSNET_YKB_ENC_KEY') || '10,10,10,10,10,10,10,10',
  )

  return PosFactory.createPosGateway(account, posTestConfig, { timeoutMs: 30_000 })
}

const card = () => CreditCardFactory.create('4048095010857528', '28', '05', '454', 'John Doe', CARD_TYPE.VISA)

// The bank accepts at most 20 characters for the order id.
const newOrder = (): PosOrder => {
  const id = `TS${Date.now()}`
  return {
    id,
    amount: 1.01,
    currency: CURRENCY.TRY,
    installment: 0,
    ip: '127.0.0.1',
    success_url: `https://example.com/yapikredi/success?o=${id}`,
    fail_url: `https://example.com/yapikredi/fail?o=${id}`,
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

describe.skipIf(!RUN)('PosNetPos against the Yapi Kredi test environment', () => {
  it('non-3D sale, status and cancel are approved', async () => {
    const pos = createGateway()
    const order = newOrder()

    const sale = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card())
    console.info('[functional] sale', summary(sale))
    expect(sale.status, JSON.stringify(summary(sale))).toBe('approved')

    const status = await pos.status({ id: order.id, payment_model: 'regular' })
    console.info('[functional] status', summary(status))
    expect(status.status, JSON.stringify(summary(status))).toBe('approved')

    const cancel = await pos.cancel({ id: order.id, payment_model: 'regular' })
    console.info('[functional] cancel', summary(cancel))
    expect(cancel.status, JSON.stringify(summary(cancel))).toBe('approved')
  }, 120_000)

  it('3D initialization returns a form carrying posnetData', async () => {
    const pos = createGateway()
    const form = await pos.get3DFormData(newOrder(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card())
    expect(typeof form).toBe('object')
    expect(Object.keys((form as ThreeDFormData).inputs)).toContain('posnetData')
  }, 120_000)
})
