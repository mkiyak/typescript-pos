import { describe, expect, it } from 'vitest'
import { posTestConfig } from '../../src/config/posTestConfig.js'
import { AccountFactory } from '../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../src/factory/CreditCardFactory.js'
import { PosFactory } from '../../src/factory/PosFactory.js'
import { CARD_TYPE, CURRENCY, MODEL, TX_TYPE } from '../../src/PosInterface.js'
import type { PosOrder, PosResponse } from '../../src/types.js'

// Runs against the Albaraka PosNetV1 test environment. Skipped unless FUNCTIONAL_TESTS=1 and POSNET_V1_MERCHANT_ID,
// POSNET_V1_TERMINAL_ID and POSNET_V1_POS_ID are set; never run in CI. All credentials come from the environment:
// POSNET_V1_MERCHANT_ID, POSNET_V1_TERMINAL_ID, POSNET_V1_POS_ID, POSNET_V1_ENC_KEY (optional).

// Every credential the account needs gates the run, so a half-set environment skips instead of failing on empty values.
const RUN =
  process.env.FUNCTIONAL_TESTS === '1' &&
  ['MERCHANT_ID', 'TERMINAL_ID', 'POS_ID'].every((name) => Boolean(process.env[`POSNET_V1_${name}`]))

const env = (name: string): string => process.env[name] ?? ''

function createGateway() {
  const account = AccountFactory.createPosNetPosAccount(
    'albaraka',
    env('POSNET_V1_MERCHANT_ID'),
    env('POSNET_V1_TERMINAL_ID'),
    env('POSNET_V1_POS_ID'),
    env('POSNET_V1_ENC_KEY') || '10,10,10,10,10,10,10,10',
  )

  return PosFactory.createPosGateway(account, posTestConfig, { timeoutMs: 30_000 })
}

const card = () => CreditCardFactory.create('4506347010299085', '26', '09', '000', 'John Doe', CARD_TYPE.VISA)

// Short, timestamp based order id.
const newOrder = (): PosOrder => {
  const id = `TS${Date.now()}`
  return {
    id,
    amount: 1.01,
    currency: CURRENCY.TRY,
    installment: 0,
    ip: '127.0.0.1',
    success_url: `https://example.com/albaraka/success?o=${id}`,
    fail_url: `https://example.com/albaraka/fail?o=${id}`,
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

describe.skipIf(!RUN)('PosNetV1Pos against the Albaraka test environment', () => {
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
})
