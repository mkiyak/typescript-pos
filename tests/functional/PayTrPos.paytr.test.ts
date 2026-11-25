import { describe, expect, it } from 'vitest'
import { posTestConfig } from '../../src/config/posTestConfig.js'
import { AccountFactory } from '../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../src/factory/CreditCardFactory.js'
import { PosFactory } from '../../src/factory/PosFactory.js'
import { CURRENCY, LANG, MODEL, TX_TYPE } from '../../src/PosInterface.js'
import type { PosOrder, ThreeDFormData } from '../../src/types.js'
import { maskSensitiveData } from '../../src/util/maskSensitiveData.js'

// Runs against PayTR in test mode (the shipped test entry sets `test_mode: true`). Skipped unless FUNCTIONAL_TESTS=1
// and PAYTR_MERCHANT_ID is set; never run in CI. All credentials come from the environment: PAYTR_MERCHANT_ID,
// PAYTR_MERCHANT_SALT, PAYTR_MERCHANT_KEY. The non-secure sale needs the Non3D permission and runs only with
// PAYTR_NON_SECURE=1, with the test card in PAYTR_CARD_NUMBER, PAYTR_CARD_EXPIRY_MONTH, PAYTR_CARD_EXPIRY_YEAR,
// PAYTR_CARD_CVV.

const RUN = process.env.FUNCTIONAL_TESTS === '1' && Boolean(process.env.PAYTR_MERCHANT_ID)
const RUN_NON_SECURE = RUN && process.env.PAYTR_NON_SECURE === '1'

const env = (name: string): string => process.env[name] ?? ''

function createGateway() {
  const account = AccountFactory.createPayTrPosAccount(
    'paytr',
    env('PAYTR_MERCHANT_ID'),
    env('PAYTR_MERCHANT_SALT'),
    env('PAYTR_MERCHANT_KEY'),
  )

  return PosFactory.createPosGateway(account, posTestConfig, { timeoutMs: 30_000 })
}

const card = () =>
  CreditCardFactory.create(
    env('PAYTR_CARD_NUMBER'),
    env('PAYTR_CARD_EXPIRY_YEAR'),
    env('PAYTR_CARD_EXPIRY_MONTH'),
    env('PAYTR_CARD_CVV'),
    'John Doe',
  )

// PayTR documents order ids of letters and digits only.
const newOrderId = (): string => `PT${Date.now()}${Math.floor(Math.random() * 1000)}`

const newOrder = (amount = 1.01): PosOrder => ({
  id: newOrderId(),
  amount,
  currency: CURRENCY.TRY,
  installment: 0,
  lang: LANG.TR,
  ip: '127.0.0.1',
  success_url: 'https://example.com/paytr/ok',
  fail_url: 'https://example.com/paytr/fail',
  buyer: { email: 'test@example.com', name: 'John Doe', gsm_number: '05001234567' },
  billing_address: { address: 'Test Sokak No:1 Istanbul' },
})

/** The bank's own `status` and `err_no` only (a status answer may hold a masked card number and amounts). */
const shownStatusRecord = (raw: unknown): Record<string, unknown> => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const record = raw as Record<string, unknown>
  return maskSensitiveData({
    status: Object.hasOwn(record, 'status') ? record.status : undefined,
    err_no: Object.hasOwn(record, 'err_no') ? record.err_no : undefined,
  }) as Record<string, unknown>
}

describe.skipIf(!RUN)('PayTrPos against PayTR (test mode)', () => {
  it('3D Host: the token request returns the PayTR page of the token', async () => {
    const pos = createGateway()
    const form = (await pos.get3DFormData(newOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)) as ThreeDFormData
    const prefix = `${posTestConfig.banks.paytr.gateway_endpoints.gateway_3d_host}/`

    // the token length only: the page URL is for the payer's browser
    console.info('[functional] 3D Host token length', form.gateway.length - prefix.length)
    expect(form.method).toBe('GET')
    expect(form.gateway.startsWith(prefix)).toBe(true)
  }, 60_000)

  it('3D Pay: a card-less form is built without a request', async () => {
    const pos = createGateway()
    const form = (await pos.get3DFormData(
      newOrder(),
      MODEL.THREE_D_PAY,
      TX_TYPE.PAY_AUTH,
      null,
      true,
    )) as ThreeDFormData

    console.info('[functional] 3D Pay form inputs', Object.keys(form.inputs))
    expect(form.method).toBe('POST')
    for (const key of ['cc_owner', 'card_number', 'expiry_month', 'expiry_year', 'cvv']) {
      expect(form.inputs).not.toHaveProperty(key)
    }
  }, 60_000)

  it('status of an unpaid order is declined', async () => {
    const pos = createGateway()
    const res = await pos.status({ id: newOrderId() })

    console.info('[functional] status', JSON.stringify(shownStatusRecord(res.all)))
    expect(res.status).toBe('declined')
  }, 60_000)

  it.skipIf(!RUN_NON_SECURE)(
    'non-secure sale answers with a documented status',
    async () => {
      const pos = createGateway()
      const res = await pos.payment(MODEL.NON_SECURE, newOrder(), TX_TYPE.PAY_AUTH, card())

      // the status and the names of the answer's keys only
      const raw = res.all !== null && typeof res.all === 'object' ? Object.keys(res.all as object) : []
      console.info('[functional] non-secure sale', res.status, raw)
      expect(['approved', 'declined']).toContain(res.status)
    },
    60_000,
  )
})
