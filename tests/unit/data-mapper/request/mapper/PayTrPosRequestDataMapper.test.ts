import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { PayTrPosCrypt } from '../../../../../src/crypt/PayTrPosCrypt.js'
import {
  PayTrPosRequestDataMapper,
  payTrOrderCore,
  payTrOrderFields,
} from '../../../../../src/data-mapper/request/mapper/PayTrPosRequestDataMapper.js'
import { PayTrPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/PayTrPosRequestValueFormatter.js'
import { PayTrPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/PayTrPosRequestValueMapper.js'
import {
  NotImplementedError,
  PosError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import { CURRENCY, LANG, MODEL, TX_TYPE } from '../../../../../src/PosInterface.js'
import type { PosHooks, PosOrder } from '../../../../../src/types.js'

// Account for the mapper rows: salt and key as in the stub-crypt rows (salt `wWwU…`, key `YEUa…`).
const PM = AccountFactory.createPayTrPosAccount('paytr', '123456', 'wWwU8buJp6jo1r25', 'YEUaNcdHXqyt7hjt')
const SALT = 'wWwU8buJp6jo1r25'
const KEY = 'YEUaNcdHXqyt7hjt'
const HOST_GATEWAY = 'https://www.paytr.com/odeme/guvenli'
const PAY_GATEWAY = 'https://www.paytr.com/odeme'
const HASH44 = /^[A-Za-z0-9+/]{43}=$/

const card = CreditCardFactory.create('4355084355084358', '30', '12', '000', 'John Doe')

const BASKET_ROW_1 = 'W1sib3JkZXItMTIzIiwxMC41LDFdXQ=='
const BASKET_ROW_3 = 'W1siQmlub2N1bGFyIiwwLjMsMV0sWyJHYW1lIGNvZGUiLDkuNzEsMV1d'

type Stub = { createHash: ReturnType<typeof vi.fn>; create3DHash: ReturnType<typeof vi.fn> }

function stubCrypt(): Stub {
  return {
    createHash: vi.fn().mockReturnValue('mock-token'),
    create3DHash: vi.fn().mockReturnValue('3d-token'),
  }
}

function makeMapper(crypt: unknown, hooks: PosHooks = {}): PayTrPosRequestDataMapper {
  return new PayTrPosRequestDataMapper(
    new PayTrPosRequestValueMapper(),
    new PayTrPosRequestValueFormatter(),
    hooks,
    crypt as PayTrPosCrypt,
    LANG.TR,
  )
}

function realMapper(hooks: PosHooks = {}): PayTrPosRequestDataMapper {
  return makeMapper(new PayTrPosCrypt(), hooks)
}

/** The token of the documented formula, computed here with node:crypto from the values that are sent. */
function expectedToken(data: Record<string, unknown>, fields: string[]): string {
  const message = fields.map((name) => String(data[name])).join('')
  return createHmac('sha256', KEY)
    .update(message + SALT, 'utf8')
    .digest('base64')
}

const IFRAME_FIELDS = [
  'merchant_id',
  'user_ip',
  'merchant_oid',
  'email',
  'payment_amount',
  'user_basket',
  'no_installment',
  'max_installment',
  'currency',
  'test_mode',
]
const DIRECT_FIELDS = [
  'merchant_id',
  'user_ip',
  'merchant_oid',
  'email',
  'payment_amount',
  'payment_type',
  'installment_count',
  'currency',
  'test_mode',
  'non_3d',
]

const baseOrder = (): PosOrder => ({
  id: 'order-123',
  amount: 10.5,
  ip: '127.0.0.1',
  success_url: 'https://example.com/success',
  fail_url: 'https://example.com/fail',
  currency: CURRENCY.TRY,
  lang: LANG.TR,
  buyer: { email: 'test@example.com', name: 'John Doe', gsm_number: '05001234567' },
  billing_address: { address: 'Test Sokak No:1 Istanbul' },
})

function iframeExpected(order: PosOrder, overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    merchant_id: '123456',
    user_ip: '127.0.0.1',
    merchant_oid: order.id,
    email: 'test@example.com',
    payment_amount: 1050,
    currency: 'TL',
    no_installment: 1,
    max_installment: 0,
    test_mode: 0,
    lang: 'tr',
    user_basket: BASKET_ROW_1,
    merchant_ok_url: 'https://example.com/success',
    merchant_fail_url: 'https://example.com/fail',
    user_name: 'John Doe',
    user_address: 'Test Sokak No:1 Istanbul',
    user_phone: '05001234567',
    ...overrides,
  }
}

function directExpected(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    merchant_id: '123456',
    user_ip: '127.0.0.1',
    merchant_oid: 'order-456',
    email: 'test@example.com',
    payment_amount: '50.00',
    installment_count: 0,
    currency: 'TL',
    non_3d: 1,
    sync_mode: 1,
    user_name: 'John Doe',
    user_address: 'Test Sokak No:1 Istanbul',
    user_phone: '05001234567',
    test_mode: 0,
    debug_on: 0,
    client_lang: 'tr',
    user_basket: '[["order-456",50,1]]',
    payment_type: 'card',
    cc_owner: 'John Doe',
    card_number: '4355084355084358',
    expiry_month: '12',
    expiry_year: '30',
    cvv: '000',
    ...overrides,
  }
}

function expectSame(actual: unknown, expected: unknown): void {
  expect(actual).toEqual(expected)
  expect(Object.keys(actual as object)).toEqual(Object.keys(expected as object))
}

function expectNoUndefined(value: unknown, path = 'value'): void {
  expect(value, path).not.toBeUndefined()
  if (typeof value === 'object' && value !== null) {
    for (const [key, inner] of Object.entries(value)) {
      expectNoUndefined(inner, `${path}.${key}`)
    }
  }
  if (typeof value === 'string') {
    expect(value, path).not.toContain('undefined')
  }
}

describe('PayTrPosRequestDataMapper', () => {
  it('supports only PayTrPos', () => {
    expect(PayTrPosRequestDataMapper.supports('PayTrPos')).toBe(true)
    expect(PayTrPosRequestDataMapper.supports('AkbankPos')).toBe(false)
  })

  it('is not in test mode by default', () => {
    expect(makeMapper(stubCrypt()).isTestMode()).toBe(false)
  })

  it.each([true, false])('setTestMode(%s)', (testMode) => {
    const mapper = makeMapper(stubCrypt())
    mapper.setTestMode(testMode)
    expect(mapper.isTestMode()).toBe(testMode)
  })

  describe('iFrame token request', () => {
    const rows: Array<[string, boolean, Record<string, unknown>, Record<string, unknown>]> = [
      ['no_installment_test_mode_off', false, { installment: 0 }, {}],
      [
        'with_installment_test_mode_on',
        true,
        { installment: 3 },
        { no_installment: 0, max_installment: 3, test_mode: 1 },
      ],
      [
        'with_basket_items',
        false,
        {
          installment: 0,
          basket_items: [
            { name: 'Binocular', item_count: 1, price: 0.3 },
            { name: 'Game code', item_count: 1, price: 9.71 },
          ],
        },
        { user_basket: BASKET_ROW_3 },
      ],
    ]

    it.each(rows)('%s', (_label, testMode, orderExtra, expectedExtra) => {
      const crypt = stubCrypt()
      const mapper = makeMapper(crypt)
      mapper.setTestMode(testMode)
      const order = { ...baseOrder(), ...orderExtra }
      const expected = iframeExpected(order, expectedExtra)

      const actual = mapper.create3DFormInitializeRequestData(PM, order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)

      expect(crypt.createHash).toHaveBeenCalledTimes(1)
      expect(crypt.createHash).toHaveBeenCalledWith(PM, expected)
      expectSame(actual, { ...expected, paytr_token: 'mock-token' })
    })

    // addition: RV1
    it('signs with the iFrame formula (real crypt)', () => {
      const actual = realMapper().create3DFormInitializeRequestData(
        PM,
        baseOrder(),
        MODEL.THREE_D_HOST,
        TX_TYPE.PAY_AUTH,
      )
      expect(actual.paytr_token).toMatch(HASH44)
      expect(actual.paytr_token).toBe(expectedToken(actual, IFRAME_FIELDS))
    })

    // addition: RV6 (test mode on)
    it('signs the test mode flag (real crypt)', () => {
      const mapper = realMapper()
      mapper.setTestMode(true)
      const actual = mapper.create3DFormInitializeRequestData(
        PM,
        { ...baseOrder(), installment: 3 },
        MODEL.THREE_D_HOST,
        TX_TYPE.PAY_AUTH,
      )
      expect(actual.test_mode).toBe(1)
      expect(actual.paytr_token).toBe(expectedToken(actual, IFRAME_FIELDS))
    })

    // addition
    it('refuses any model but 3D Host and any type but a sale', () => {
      const mapper = realMapper()
      expect(() =>
        mapper.create3DFormInitializeRequestData(PM, baseOrder(), MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH),
      ).toThrow(UnsupportedPaymentModelError)
      expect(() =>
        mapper.create3DFormInitializeRequestData(PM, baseOrder(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH),
      ).toThrow(UnsupportedPaymentModelError)
      expect(() =>
        mapper.create3DFormInitializeRequestData(PM, baseOrder(), MODEL.THREE_D_HOST, TX_TYPE.REFUND),
      ).toThrow(UnsupportedTransactionTypeError)
    })

    // addition
    it('writes the Turkish name of the item as an escaped ASCII basket', () => {
      const actual = realMapper().create3DFormInitializeRequestData(
        PM,
        { ...baseOrder(), basket_items: [{ name: 'Gözlük/Ç', item_count: 1, price: 10.5 }] },
        MODEL.THREE_D_HOST,
        TX_TYPE.PAY_AUTH,
      )
      expect(Buffer.from(String(actual.user_basket), 'base64').toString('utf8')).toBe(
        '[["G\\u00f6zl\\u00fck\\/\\u00c7",10.5,1]]',
      )
    })

    // addition: the amount in kuruş and the basket row use the same two-decimal amount
    it('charges the rounded amount', () => {
      const actual = realMapper().create3DFormInitializeRequestData(
        PM,
        { ...baseOrder(), amount: 10.005, basket_items: undefined },
        MODEL.THREE_D_HOST,
        TX_TYPE.PAY_AUTH,
      )
      expect(actual.payment_amount).toBe(1001)
      expect(Buffer.from(String(actual.user_basket), 'base64').toString('utf8')).toBe('[["order-123",10.01,1]]')
    })
  })

  describe('non-secure payment body', () => {
    // deviation: R4 (the Direct API basket is plain JSON, not base64)
    it('no_installment', () => {
      const crypt = stubCrypt()
      const order: PosOrder = { ...baseOrder(), id: 'order-456', amount: 50, installment: 0 }
      const expected = directExpected({})

      const actual = makeMapper(crypt).createNonSecurePaymentRequestData(PM, order, TX_TYPE.PAY_AUTH, card)

      expect(crypt.createHash).toHaveBeenCalledTimes(1)
      expect(crypt.createHash).toHaveBeenCalledWith(PM, expected)
      expectSame(actual, { ...expected, paytr_token: 'mock-token' })
    })

    // deviation: R4
    it('with_installment', () => {
      const crypt = stubCrypt()
      const order: PosOrder = { ...baseOrder(), id: 'order-456', amount: 50, installment: 3 }
      const expected = directExpected({ installment_count: 3 })

      const actual = makeMapper(crypt).createNonSecurePaymentRequestData(PM, order, TX_TYPE.PAY_AUTH, card)

      expect(crypt.createHash).toHaveBeenCalledWith(PM, expected)
      expectSame(actual, { ...expected, paytr_token: 'mock-token' })
    })

    // addition: RV3 (real crypt, the direct formula)
    it('signs with the direct formula (real crypt)', () => {
      const actual = realMapper().createNonSecurePaymentRequestData(
        PM,
        { ...baseOrder(), id: 'order-456', amount: 50 },
        TX_TYPE.PAY_AUTH,
        card,
      )
      expect(actual.paytr_token).toMatch(HASH44)
      expect(actual.paytr_token).toBe(expectedToken(actual, DIRECT_FIELDS))
    })

    // addition
    it('keeps the types of the body (numbers stay numbers) and signs the test flag', () => {
      const mapper = realMapper()
      mapper.setTestMode(true)
      const actual = mapper.createNonSecurePaymentRequestData(PM, baseOrder(), TX_TYPE.PAY_AUTH, card)
      expect(actual).toMatchObject({ non_3d: 1, sync_mode: 1, test_mode: 1, debug_on: 1, installment_count: 0 })
      expect(actual.paytr_token).toBe(expectedToken(actual, DIRECT_FIELDS))
    })

    // addition
    it('needs a sale type and a card', () => {
      const mapper = realMapper()
      expect(() => mapper.createNonSecurePaymentRequestData(PM, baseOrder(), TX_TYPE.PAY_PRE_AUTH, card)).toThrow(
        UnsupportedTransactionTypeError,
      )
      expect(() => mapper.createNonSecurePaymentRequestData(PM, baseOrder(), TX_TYPE.PAY_AUTH, null as never)).toThrow(
        PosError,
      )
    })

    // addition
    it('needs a card holder name', () => {
      const noName = CreditCardFactory.create('4355084355084358', '30', '12', '000')
      expect(() => realMapper().createNonSecurePaymentRequestData(PM, baseOrder(), TX_TYPE.PAY_AUTH, noName)).toThrow(
        PosError,
      )
      const longName = CreditCardFactory.create('4355084355084358', '30', '12', '000', 'x'.repeat(51))
      expect(() => realMapper().createNonSecurePaymentRequestData(PM, baseOrder(), TX_TYPE.PAY_AUTH, longName)).toThrow(
        PosError,
      )
    })
  })

  describe('unsupported operations', () => {
    const mapper = realMapper()

    it('create3DPaymentRequestData', () => {
      expect(() => mapper.create3DPaymentRequestData(PM, {}, TX_TYPE.PAY_AUTH, {})).toThrow(NotImplementedError)
    })
    it('createNonSecurePostAuthPaymentRequestData', () => {
      expect(() => mapper.createNonSecurePostAuthPaymentRequestData(PM, {})).toThrow(NotImplementedError)
    })
    it('createCancelRequestData', () => {
      expect(() => mapper.createCancelRequestData(PM, {})).toThrow(NotImplementedError)
    })
    it('createOrderHistoryRequestData', () => {
      expect(() => mapper.createOrderHistoryRequestData(PM, {})).toThrow(NotImplementedError)
    })
  })

  describe('status and refund', () => {
    it('createStatusRequestData', () => {
      const crypt = stubCrypt()
      const expected = { merchant_id: '123456', merchant_oid: 'order-999' }

      const actual = makeMapper(crypt).createStatusRequestData(PM, { id: 'order-999' })

      expect(crypt.createHash).toHaveBeenCalledTimes(1)
      expect(crypt.createHash).toHaveBeenCalledWith(PM, expected)
      expectSame(actual, { ...expected, paytr_token: 'mock-token' })
    })

    // addition: RV5
    it('signs the status request with the order formula (real crypt)', () => {
      const actual = realMapper().createStatusRequestData(PM, { id: 'order-999' })
      expect(actual.paytr_token).toMatch(HASH44)
      expect(actual.paytr_token).toBe(expectedToken(actual, ['merchant_id', 'merchant_oid']))
    })

    it('createRefundRequestData', () => {
      const crypt = stubCrypt()
      const expected = { merchant_id: '123456', merchant_oid: 'order-789', return_amount: '10.50' }

      const actual = makeMapper(crypt).createRefundRequestData(PM, { id: 'order-789', amount: 10.5 }, TX_TYPE.REFUND)

      expect(crypt.createHash).toHaveBeenCalledTimes(1)
      expect(crypt.createHash).toHaveBeenCalledWith(PM, expected)
      expectSame(actual, { ...expected, paytr_token: 'mock-token' })
    })

    // addition: RV4
    it.each([TX_TYPE.REFUND, TX_TYPE.REFUND_PARTIAL])(
      'signs the %s request with the refund formula (real crypt)',
      (type) => {
        const actual = realMapper().createRefundRequestData(PM, { id: 'order-789', amount: 10.5 }, type)
        expect(actual.paytr_token).toMatch(HASH44)
        expect(actual.paytr_token).toBe(expectedToken(actual, ['merchant_id', 'merchant_oid', 'return_amount']))
      },
    )

    // addition
    it('sends reference_no after the token and does not sign it', () => {
      const actual = realMapper().createRefundRequestData(
        PM,
        { id: 'order-789', amount: 10.5, reference_no: 'REF1' },
        TX_TYPE.REFUND_PARTIAL,
      )
      expect(Object.keys(actual)).toEqual([
        'merchant_id',
        'merchant_oid',
        'return_amount',
        'paytr_token',
        'reference_no',
      ])
      expect(actual.reference_no).toBe('REF1')
      expect(actual.paytr_token).toBe(expectedToken(actual, ['merchant_id', 'merchant_oid', 'return_amount']))
    })

    // addition
    it.each(['ab-1', '', 'x'.repeat(65), 5, {}])('refuses reference_no %j', (referenceNo) => {
      expect(() =>
        realMapper().createRefundRequestData(
          PM,
          { id: 'order-789', amount: 10.5, reference_no: referenceNo },
          TX_TYPE.REFUND,
        ),
      ).toThrow(PosError)
    })

    // addition: a refund request is never built for another type
    it.each([TX_TYPE.PAY_AUTH, TX_TYPE.CANCEL, TX_TYPE.PAY_POST_AUTH, 'x'])('refuses the refund type %s', (type) => {
      expect(() => realMapper().createRefundRequestData(PM, { id: 'order-789', amount: 10.5 }, type as never)).toThrow(
        UnsupportedTransactionTypeError,
      )
    })

    // addition
    it.each([undefined, null, 0, -1, 0.004, Number.NaN, 1e13, 'x', '1e2'])('refuses the refund amount %j', (amount) => {
      expect(() =>
        realMapper().createRefundRequestData(PM, { id: 'order-789', amount: amount as never }, TX_TYPE.REFUND),
      ).toThrow(PosError)
    })

    // addition
    it('refuses a refund without an amount key', () => {
      expect(() => realMapper().createRefundRequestData(PM, { id: 'order-789' }, TX_TYPE.REFUND)).toThrow(PosError)
    })
  })

  describe('3D form data', () => {
    it('3D Host: the payment page of the token, no crypt call', async () => {
      const crypt = stubCrypt()

      const actual = await makeMapper(crypt).create3DFormData(
        PM,
        {},
        MODEL.THREE_D_HOST,
        TX_TYPE.PAY_AUTH,
        HOST_GATEWAY,
        null,
        { token: 'abc123' },
      )

      expect(crypt.createHash).not.toHaveBeenCalled()
      expect(crypt.create3DHash).not.toHaveBeenCalled()
      expect(actual.gateway).toBe('https://www.paytr.com/odeme/guvenli/abc123')
      expect(actual.method).toBe('GET')
      expect(actual.inputs).toEqual({})
    })

    // addition: a gateway address that ends in a slash does not double it before the token
    it('3D Host: the token follows the gateway address with a single slash', async () => {
      const actual = await makeMapper(stubCrypt()).create3DFormData(
        PM,
        {},
        MODEL.THREE_D_HOST,
        TX_TYPE.PAY_AUTH,
        `${HOST_GATEWAY}/`,
        null,
        { token: 'abc123' },
      )
      expect(actual.gateway).toBe('https://www.paytr.com/odeme/guvenli/abc123')
    })

    // deviation: R4/R6 (every input is a string; the Direct API basket is plain JSON)
    it('3D Pay: a POST form with the card', async () => {
      const crypt = stubCrypt()
      const expected = {
        merchant_id: '123456',
        user_ip: '127.0.0.1',
        merchant_oid: 'order-123',
        email: 'test@example.com',
        payment_amount: '10.50',
        installment_count: '0',
        currency: 'TL',
        non_3d: '0',
        sync_mode: '0',
        user_name: 'John Doe',
        user_address: 'Test Sokak No:1 Istanbul',
        user_phone: '05001234567',
        test_mode: '0',
        debug_on: '0',
        client_lang: 'tr',
        user_basket: '[["order-123",10.5,1]]',
        payment_type: 'card',
        cc_owner: 'John Doe',
        card_number: '4355084355084358',
        expiry_month: '12',
        expiry_year: '30',
        cvv: '000',
        merchant_ok_url: 'https://example.com/success',
        merchant_fail_url: 'https://example.com/fail',
      }

      const actual = await makeMapper(crypt).create3DFormData(
        PM,
        { ...baseOrder(), installment: 0 },
        MODEL.THREE_D_PAY,
        TX_TYPE.PAY_AUTH,
        PAY_GATEWAY,
        card,
      )

      expect(crypt.create3DHash).toHaveBeenCalledTimes(1)
      expect(crypt.create3DHash).toHaveBeenCalledWith(PM, expected)
      expect(crypt.createHash).not.toHaveBeenCalled()
      expect(actual.gateway).toBe(PAY_GATEWAY)
      expect(actual.method).toBe('POST')
      expectSame(actual.inputs, { ...expected, paytr_token: '3d-token' })
      for (const value of Object.values(actual.inputs)) {
        expect(typeof value).toBe('string')
      }
    })

    // deviation: R6 (a card-less form is allowed; this order is incomplete, it lacks the buyer e-mail, so it still throws)
    it('3D Pay without a card and with an incomplete order still throws', async () => {
      await expect(
        makeMapper(stubCrypt()).create3DFormData(
          PM,
          { id: 'order-1', amount: 1.0, ip: '127.0.0.1', buyer: {}, billing_address: {} },
          MODEL.THREE_D_PAY,
          TX_TYPE.PAY_AUTH,
          PAY_GATEWAY,
        ),
      ).rejects.toThrow(PosError)
    })

    // addition: RV2
    it('3D Pay signs with the direct formula (real crypt)', async () => {
      const actual = await realMapper().create3DFormData(
        PM,
        baseOrder(),
        MODEL.THREE_D_PAY,
        TX_TYPE.PAY_AUTH,
        PAY_GATEWAY,
        card,
      )
      expect(actual.inputs.paytr_token).toMatch(HASH44)
      expect(actual.inputs.paytr_token).toBe(expectedToken(actual.inputs, DIRECT_FIELDS))
    })

    // addition: a card-less form leaves the five card keys to the payer's browser; the token is the same
    it('3D Pay without a card has no card keys and the same token', async () => {
      const mapper = realMapper()
      const withCard = await mapper.create3DFormData(
        PM,
        baseOrder(),
        MODEL.THREE_D_PAY,
        TX_TYPE.PAY_AUTH,
        PAY_GATEWAY,
        card,
      )
      const without = await mapper.create3DFormData(PM, baseOrder(), MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, PAY_GATEWAY)

      for (const key of ['cc_owner', 'card_number', 'expiry_month', 'expiry_year', 'cvv']) {
        expect(without.inputs).not.toHaveProperty(key)
      }
      expect(without.inputs.payment_type).toBe('card')
      expect(without.inputs.paytr_token).toBe(withCard.inputs.paytr_token)
      expect(without.inputs.paytr_token).toBe(expectedToken(without.inputs, DIRECT_FIELDS))
      expect(Object.keys(without.inputs).slice(-3)).toEqual(['merchant_ok_url', 'merchant_fail_url', 'paytr_token'])
    })

    // addition: the hook runs before the hash and what it returns is what is signed and sent
    it('hashes exactly the inputs the hook leaves', async () => {
      const hooks: PosHooks = {
        onBefore3DFormHashCalculated: [
          (event) => {
            event.formInputs.user_name = 'Hooked Name'
          },
        ],
      }
      const actual = await realMapper(hooks).create3DFormData(
        PM,
        baseOrder(),
        MODEL.THREE_D_PAY,
        TX_TYPE.PAY_AUTH,
        PAY_GATEWAY,
        card,
      )
      expect(actual.inputs.user_name).toBe('Hooked Name')
      expect(actual.inputs.paytr_token).toBe(expectedToken(actual.inputs, DIRECT_FIELDS))
    })

    // addition
    it('the 3D Pay form carries the test flag as text', async () => {
      const mapper = realMapper()
      mapper.setTestMode(true)
      const actual = await mapper.create3DFormData(PM, baseOrder(), MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, PAY_GATEWAY)
      expect(actual.inputs.test_mode).toBe('1')
      expect(actual.inputs.debug_on).toBe('1')
      expect(actual.inputs.paytr_token).toBe(expectedToken(actual.inputs, DIRECT_FIELDS))
    })

    // addition
    it.each(['a/b', '', 'a b', 'x'.repeat(513), undefined, 5, null, {}])(
      '3D Host refuses the token %j',
      async (token) => {
        await expect(
          realMapper().create3DFormData(PM, {}, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, HOST_GATEWAY, null, {
            token,
          }),
        ).rejects.toThrow(PosError)
      },
    )

    // addition
    it('3D Host refuses a missing extra data', async () => {
      await expect(
        realMapper().create3DFormData(PM, {}, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, HOST_GATEWAY),
      ).rejects.toThrow(PosError)
    })

    // addition
    it.each(['http://x', 'https://www.paytr.com/odeme?x=1', 'https://www.paytr.com/odeme#x', '', 'ftp://x'])(
      'refuses the gateway address %j',
      async (gateway) => {
        await expect(
          realMapper().create3DFormData(PM, {}, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, gateway, null, {
            token: 'abc',
          }),
        ).rejects.toThrow(PosError)
        await expect(
          realMapper().create3DFormData(PM, baseOrder(), MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, gateway, card),
        ).rejects.toThrow(PosError)
      },
    )

    // addition
    it('refuses another model and a type but a sale', async () => {
      await expect(
        realMapper().create3DFormData(PM, baseOrder(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, PAY_GATEWAY, card),
      ).rejects.toThrow(UnsupportedPaymentModelError)
      await expect(
        realMapper().create3DFormData(PM, baseOrder(), MODEL.NON_SECURE, TX_TYPE.PAY_AUTH, PAY_GATEWAY, card),
      ).rejects.toThrow(UnsupportedPaymentModelError)
      await expect(
        realMapper().create3DFormData(PM, baseOrder(), MODEL.THREE_D_PAY, TX_TYPE.REFUND, PAY_GATEWAY, card),
      ).rejects.toThrow(UnsupportedTransactionTypeError)
    })

    // addition
    it('3D Pay needs the order', async () => {
      await expect(
        realMapper().create3DFormData(PM, null, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, PAY_GATEWAY, card),
      ).rejects.toThrow(PosError)
    })
  })

  // addition: v0.11 lesson. Every operation the mapper can emit, built with the real crypt, must select the
  // formula it is meant for; the token is recomputed here from the documented field list.
  describe('every emitted operation signs with its own formula', () => {
    const mapper = realMapper()
    const operations: Array<[string, () => Promise<Record<string, unknown>> | Record<string, unknown>, string[]]> = [
      [
        'iFrame token request',
        () => mapper.create3DFormInitializeRequestData(PM, baseOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH),
        IFRAME_FIELDS,
      ],
      [
        'iFrame token request with installment',
        () =>
          mapper.create3DFormInitializeRequestData(
            PM,
            { ...baseOrder(), installment: 6 },
            MODEL.THREE_D_HOST,
            TX_TYPE.PAY_AUTH,
          ),
        IFRAME_FIELDS,
      ],
      [
        'non-secure sale',
        () => mapper.createNonSecurePaymentRequestData(PM, baseOrder(), TX_TYPE.PAY_AUTH, card),
        DIRECT_FIELDS,
      ],
      [
        'non-secure sale with installment',
        () => mapper.createNonSecurePaymentRequestData(PM, { ...baseOrder(), installment: 2 }, TX_TYPE.PAY_AUTH, card),
        DIRECT_FIELDS,
      ],
      [
        '3D Pay form with card',
        async () =>
          (await mapper.create3DFormData(PM, baseOrder(), MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, PAY_GATEWAY, card))
            .inputs,
        DIRECT_FIELDS,
      ],
      [
        '3D Pay form without card',
        async () =>
          (await mapper.create3DFormData(PM, baseOrder(), MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, PAY_GATEWAY)).inputs,
        DIRECT_FIELDS,
      ],
      ['status', () => mapper.createStatusRequestData(PM, baseOrder()), ['merchant_id', 'merchant_oid']],
      [
        'refund',
        () => mapper.createRefundRequestData(PM, baseOrder(), TX_TYPE.REFUND),
        ['merchant_id', 'merchant_oid', 'return_amount'],
      ],
      [
        'partial refund with reference',
        () => mapper.createRefundRequestData(PM, { ...baseOrder(), reference_no: 'R1' }, TX_TYPE.REFUND_PARTIAL),
        ['merchant_id', 'merchant_oid', 'return_amount'],
      ],
    ]

    it.each(operations)('%s', async (_label, build, fields) => {
      const data = await build()
      expect(data.paytr_token).toMatch(HASH44)
      expect(data.paytr_token).toBe(expectedToken(data, fields))
      expectNoUndefined(data)
    })

    it('each formula gives a different token for the same order', async () => {
      const tokens = await Promise.all(operations.map(async ([, build]) => (await build()).paytr_token))
      // one token per formula family: iFrame (0), direct (2), status (6), refund (7)
      expect(new Set([0, 2, 6, 7].map((i) => tokens[i])).size).toBe(4)
    })
  })

  // addition: R3, in every method that reads the order
  describe('order validation', () => {
    const mapper = realMapper()
    const idMethods: Array<[string, (order: PosOrder) => unknown]> = [
      [
        '3D Host token request',
        (o) => mapper.create3DFormInitializeRequestData(PM, o, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH),
      ],
      ['non-secure', (o) => mapper.createNonSecurePaymentRequestData(PM, o, TX_TYPE.PAY_AUTH, card)],
      ['3D Pay form', (o) => mapper.create3DFormData(PM, o, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, PAY_GATEWAY, card)],
      ['status', (o) => mapper.createStatusRequestData(PM, o)],
      ['refund', (o) => mapper.createRefundRequestData(PM, o, TX_TYPE.REFUND)],
    ]
    const paymentMethods = idMethods.slice(0, 3)
    const hostMethod = idMethods[0]?.[1] as (order: PosOrder) => unknown
    const payFormMethod = idMethods[2]?.[1] as (order: PosOrder) => unknown

    async function expectRefused(method: (order: PosOrder) => unknown, order: PosOrder): Promise<void> {
      await expect(Promise.resolve().then(() => method(order))).rejects.toThrow(PosError)
    }

    for (const [name, method] of idMethods) {
      it.each(['a b', '', '-x', '_x', 'x'.repeat(65), 'a/b', 'ö1', null, undefined, {}, [], Number.NaN, true])(
        `${name}: refuses the order id %j`,
        async (id) => {
          await expectRefused(method, { ...baseOrder(), id: id as never })
        },
      )

      it(`${name}: refuses a missing order id`, async () => {
        const { id: _id, ...order } = baseOrder()
        await expectRefused(method, order)
      })

      it(`${name}: refuses an inherited order id`, async () => {
        const { id: _id, ...order } = baseOrder()
        await expectRefused(method, Object.assign(Object.create({ id: 'inherited-1' }), order))
      })
    }

    it('accepts a numeric order id and a 64-character id', () => {
      expect(mapper.createStatusRequestData(PM, { id: 12345 as never }).merchant_oid).toBe('12345')
      expect(mapper.createStatusRequestData(PM, { id: `a${'b'.repeat(63)}` }).merchant_oid).toHaveLength(64)
    })

    for (const [name, method] of paymentMethods) {
      it.each([13, 1.5, 'x', -1, 100])(`${name}: refuses the installment %j`, async (installment) => {
        await expectRefused(method, { ...baseOrder(), installment: installment as never })
      })

      it.each(['JPY', 'XXX', 5, 'constructor'])(`${name}: refuses the currency %j`, async (currency) => {
        await expectRefused(method, { ...baseOrder(), currency: currency as never })
      })

      it.each([undefined, null, 0, -5, 0.004, Number.NaN, 1e13, 'x', '1e2'])(
        `${name}: refuses the amount %j`,
        async (amount) => {
          await expectRefused(method, { ...baseOrder(), amount: amount as never })
        },
      )

      it.each([undefined, null, '', 'abc', '1.2.3.4.5', 5, '1'.repeat(40)])(
        `${name}: refuses the ip %j`,
        async (ip) => {
          await expectRefused(method, { ...baseOrder(), ip: ip as never })
        },
      )

      it.each([
        undefined,
        null,
        '',
        'a',
        '@x.com',
        'a@',
        'a@b@c',
        'ö@x.com',
        'a b@x.com',
        `${'a'.repeat(95)}@x.com`,
        5,
      ])(`${name}: refuses the buyer e-mail %j`, async (email) => {
        await expectRefused(method, { ...baseOrder(), buyer: { ...(baseOrder().buyer as object), email } })
      })

      it.each([undefined, null, '', '  ', 'x'.repeat(61), 'a\nb', 5])(
        `${name}: refuses the buyer name %j`,
        async (value) => {
          await expectRefused(method, { ...baseOrder(), buyer: { ...(baseOrder().buyer as object), name: value } })
        },
      )

      it.each([undefined, null, '', '  ', 'x'.repeat(21), 5])(`${name}: refuses the buyer phone %j`, async (value) => {
        await expectRefused(method, { ...baseOrder(), buyer: { ...(baseOrder().buyer as object), gsm_number: value } })
      })

      it.each([undefined, null, '', '  ', 'x'.repeat(401), 5])(`${name}: refuses the address %j`, async (value) => {
        await expectRefused(method, { ...baseOrder(), billing_address: { address: value } })
      })

      it(`${name}: refuses a missing buyer or billing address`, async () => {
        const { buyer: _buyer, ...noBuyer } = baseOrder()
        await expectRefused(method, noBuyer)
        const { billing_address: _address, ...noAddress } = baseOrder()
        await expectRefused(method, noAddress)
        await expectRefused(method, { ...baseOrder(), buyer: 'x' as never })
        await expectRefused(method, { ...baseOrder(), billing_address: [] as never })
      })
    }

    it('accepts an IPv6 address and an installment of 12', () => {
      const data = mapper.createNonSecurePaymentRequestData(
        PM,
        { ...baseOrder(), ip: '2001:db8::1', installment: 12 },
        TX_TYPE.PAY_AUTH,
        card,
      )
      expect(data).toMatchObject({ user_ip: '2001:db8::1', installment_count: 12 })
    })

    it.each([
      undefined,
      null,
      '',
      'javascript:x',
      'ftp://x',
      'https://x/ö',
      'https://x y',
      `https://x/${'a'.repeat(400)}`,
    ])('iFrame and 3D Pay refuse the success_url %j', async (url) => {
      const order = { ...baseOrder(), success_url: url as never }
      await expectRefused(hostMethod, order)
      await expectRefused(payFormMethod, order)
    })

    it.each([undefined, null, '', 'javascript:x'])('iFrame and 3D Pay refuse the fail_url %j', async (url) => {
      const order = { ...baseOrder(), fail_url: url as never }
      await expectRefused(hostMethod, order)
      await expectRefused(payFormMethod, order)
    })

    it('the non-secure sale does not need return URLs', () => {
      const { success_url: _s, fail_url: _f, ...order } = baseOrder()
      const data = mapper.createNonSecurePaymentRequestData(PM, order, TX_TYPE.PAY_AUTH, card)
      expect(data).not.toHaveProperty('merchant_ok_url')
      expect(data).not.toHaveProperty('merchant_fail_url')
    })

    it('refuses a bad item in the basket in every method', async () => {
      for (const [, method] of paymentMethods) {
        await expectRefused(method, { ...baseOrder(), basket_items: [{ name: '', price: 1, item_count: 1 }] })
      }
    })

    it('does not build anything before the order is valid (the crypt is not called)', () => {
      const crypt = stubCrypt()
      const stubbed = makeMapper(crypt)
      expect(() => stubbed.createStatusRequestData(PM, { id: 'a b' })).toThrow(PosError)
      expect(() =>
        stubbed.createNonSecurePaymentRequestData(PM, { ...baseOrder(), buyer: {} }, TX_TYPE.PAY_AUTH, card),
      ).toThrow(PosError)
      expect(() =>
        stubbed.create3DFormInitializeRequestData(
          PM,
          { ...baseOrder(), amount: 0 },
          MODEL.THREE_D_HOST,
          TX_TYPE.PAY_AUTH,
        ),
      ).toThrow(PosError)
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    it('does not mutate the order', async () => {
      const order = {
        ...baseOrder(),
        installment: 3,
        reference_no: 'R1',
        basket_items: [{ name: 'A', price: 1.5, item_count: 2 }],
      }
      const snapshot = structuredClone(order)
      Object.freeze(order)
      mapper.create3DFormInitializeRequestData(PM, order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)
      mapper.createNonSecurePaymentRequestData(PM, order, TX_TYPE.PAY_AUTH, card)
      await mapper.create3DFormData(PM, order, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, PAY_GATEWAY, card)
      mapper.createStatusRequestData(PM, order)
      mapper.createRefundRequestData(PM, order, TX_TYPE.REFUND)
      expect(order).toEqual(snapshot)
    })

    it('no produced value contains "undefined"', async () => {
      const order = { ...baseOrder(), installment: 3, basket_items: [{ name: 'A', price: 1.5, item_count: 2 }] }
      expectNoUndefined(mapper.create3DFormInitializeRequestData(PM, order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH))
      expectNoUndefined(mapper.createNonSecurePaymentRequestData(PM, order, TX_TYPE.PAY_AUTH, card))
      expectNoUndefined(
        await mapper.create3DFormData(PM, order, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, PAY_GATEWAY, card),
      )
      expectNoUndefined(await mapper.create3DFormData(PM, order, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, PAY_GATEWAY))
      expectNoUndefined(mapper.createStatusRequestData(PM, order))
      expectNoUndefined(mapper.createRefundRequestData(PM, { ...order, reference_no: 'R1' }, TX_TYPE.REFUND))
    })
  })

  describe('payTrOrderCore and payTrOrderFields', () => {
    it('returns the validated values', () => {
      expect(payTrOrderCore({ id: 'o-1', amount: '10.5' as never })).toEqual({
        orderId: 'o-1',
        amount: 10.5,
        currency: 'TRY',
        installment: 0,
      })
      expect(payTrOrderFields({ ...baseOrder(), installment: '3' as never, currency: CURRENCY.EUR })).toEqual({
        orderId: 'order-123',
        amount: 10.5,
        currency: 'EUR',
        installment: 3,
        ip: '127.0.0.1',
        email: 'test@example.com',
        name: 'John Doe',
        address: 'Test Sokak No:1 Istanbul',
        phone: '05001234567',
      })
    })

    it('the core does not need the buyer; the fields do', () => {
      expect(() => payTrOrderCore({ id: 'o-1', amount: 1 })).not.toThrow()
      expect(() => payTrOrderFields({ id: 'o-1', amount: 1 })).toThrow(PosError)
    })

    it.each([null, undefined, 'x', [], 5])('refuse the order %j', (order) => {
      expect(() => payTrOrderCore(order as never)).toThrow(PosError)
    })
  })
})
