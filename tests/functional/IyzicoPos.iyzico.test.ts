import { describe, expect, it } from 'vitest'
import { posTestConfig } from '../../src/config/posTestConfig.js'
import { AccountFactory } from '../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../src/factory/CreditCardFactory.js'
import { PosFactory } from '../../src/factory/PosFactory.js'
import { CURRENCY, FORM_FORMAT, LANG, MODEL, TX_TYPE } from '../../src/PosInterface.js'
import type { PosOrder, PosResponse, ThreeDFormData } from '../../src/types.js'
import { maskSensitiveData } from '../../src/util/maskSensitiveData.js'

// Runs against the iyzico sandbox (the shipped test entry). Skipped unless FUNCTIONAL_TESTS=1 and IYZICO_API_KEY is
// set; never run in CI. Credentials come from the environment: IYZICO_API_KEY, IYZICO_SECRET_KEY. Only allow-listed
// fields of the bank's answers are printed (masked): never a whole record.

const RUN = process.env.FUNCTIONAL_TESTS === '1' && Boolean(process.env.IYZICO_API_KEY)

const env = (name: string): string => process.env[name] ?? ''

function createGateway() {
  const account = AccountFactory.createIyzicoPosAccount('iyzico', env('IYZICO_API_KEY'), env('IYZICO_SECRET_KEY'))

  return PosFactory.createPosGateway(account, posTestConfig, { timeoutMs: 30_000 })
}

// iyzico's sandbox test card
const card = () => CreditCardFactory.create('4603450000000000', '26', '12', '000', 'John Doe')

const newOrderId = (): string => `IZ${Date.now()}${Math.floor(Math.random() * 1000)}`

const address = {
  contact_name: 'John Doe',
  city: 'Istanbul',
  country: 'Turkey',
  address: 'Address 1',
  zip_code: '34732',
}

const newOrder = (id: string = newOrderId()): PosOrder => ({
  id,
  amount: 10.01,
  currency: CURRENCY.TRY,
  installment: 0,
  lang: LANG.TR,
  ip: '127.0.0.1',
  success_url: 'https://example.com/iyzico/callback',
  fail_url: 'https://example.com/iyzico/fail',
  payment_channel: 'WEB',
  buyer: {
    id: 'BY789',
    name: 'John',
    surname: 'Doe',
    identity_number: '74300864791',
    email: 'email@email.com',
    gsm_number: '+905350000000',
    registration_address: 'Address 1',
    city: 'Istanbul',
    country: 'Turkey',
    zip_code: '34732',
    ip: '127.0.0.1',
  },
  shipping_address: address,
  billing_address: address,
  basket_items: [
    {
      id: 'BI101',
      name: 'Binocular',
      category1: 'Collectibles',
      category2: 'Accessories',
      item_type: 'PHYSICAL',
      price: 0.3,
    },
    {
      id: 'BI102',
      name: 'Game code',
      category1: 'Game',
      category2: 'Online Game Items',
      item_type: 'VIRTUAL',
      price: 9.71,
    },
  ],
})

/** An own field of the raw answer, masked; nothing else of the record is shown. */
const shownField = (response: PosResponse, key: string): unknown => {
  const raw = response.all
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !Object.hasOwn(raw, key)) return undefined
  return maskSensitiveData((raw as Record<string, unknown>)[key])
}

/** The names of the answer's keys only. */
const answerKeys = (response: PosResponse): string[] =>
  response.all !== null && typeof response.all === 'object' ? Object.keys(response.all as object) : []

describe.skipIf(!RUN)('IyzicoPos against the iyzico sandbox', () => {
  it('non-secure sale, its status and its refund', async () => {
    const pos = createGateway()
    const order = newOrder()
    const sale = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card())

    console.info('[functional] non-secure sale', sale.status, shownField(sale, 'fraudStatus'), answerKeys(sale))
    expect(['approved', 'declined']).toContain(sale.status)
    if (sale.status !== 'approved') return

    const status = await pos.status({ id: order.id })
    console.info('[functional] status', status.status, status.order_status)
    expect(status.status).toBe('approved')

    const refund = await pos.refund({
      id: order.id,
      amount: 10.01,
      currency: CURRENCY.TRY,
      transaction_id: String(sale.transaction_id),
    })
    console.info('[functional] refund', refund.status, answerKeys(refund))
    expect(['approved', 'declined']).toContain(refund.status)
  }, 90_000)

  it('3D Host: the checkout initialize returns iyzico payment page', async () => {
    const pos = createGateway()
    const form = (await pos.get3DFormData(
      newOrder(),
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_AUTH,
      null,
      true,
      FORM_FORMAT.ARRAY,
    )) as ThreeDFormData

    // the host only: the page URL carries the token and is for the payer's browser
    console.info('[functional] 3D Host page host', new URL(form.gateway).host)
    expect(form.method).toBe('GET')
    expect(form.gateway.startsWith('https://')).toBe(true)
  }, 60_000)
})
