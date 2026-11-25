import { describe, expect, it, vi } from 'vitest'
import type { IyzicoPosCrypt } from '../../../../../src/crypt/IyzicoPosCrypt.js'
import { IyzicoPosRequestDataMapper } from '../../../../../src/data-mapper/request/mapper/IyzicoPosRequestDataMapper.js'
import { IyzicoPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/IyzicoPosRequestValueFormatter.js'
import { IyzicoPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/IyzicoPosRequestValueMapper.js'
import {
  NotImplementedError,
  PosError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import { CURRENCY, LANG, MODEL, TX_TYPE } from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'

const IA = AccountFactory.createIyzicoPosAccount('iyzico', 'sandbox-apiKey', 'sandbox-secretKey')
const card = CreditCardFactory.create('5555444433332222', '26', '12', '123', 'John Doe')

function stubCrypt() {
  return { createHash: vi.fn(), create3DHash: vi.fn(), authorizationHeader: vi.fn(), hashString: vi.fn() }
}

function setup() {
  const crypt = stubCrypt()
  const mapper = new IyzicoPosRequestDataMapper(
    new IyzicoPosRequestValueMapper(),
    new IyzicoPosRequestValueFormatter(),
    {},
    crypt as unknown as IyzicoPosCrypt,
    LANG.TR,
  )
  return { mapper, crypt }
}

function buildOrder(): PosOrder {
  return {
    id: 'order-001',
    amount: 100.0,
    currency: CURRENCY.TRY,
    success_url: 'https://example.com/success',
    fail_url: 'https://example.com/fail',
    payment_channel: 'WEB',
    buyer: {
      id: 'buyer-1',
      name: 'John',
      surname: 'Doe',
      identity_number: '11111111111',
      email: 'john@example.com',
      gsm_number: '+905350000000',
      registration_address: 'Address 1',
      city: 'Istanbul',
      country: 'Turkey',
      zip_code: '34000',
      ip: '127.0.0.1',
    },
    shipping_address: { contact_name: 'John Doe', city: 'Istanbul', country: 'Turkey', address: 'Shipping Address' },
    billing_address: { contact_name: 'John Doe', city: 'Istanbul', country: 'Turkey', address: 'Billing Address' },
    basket_items: [
      // deviation: R4 category1 is required
      { id: 'item-1', name: 'Product', category1: 'Category', item_type: 'PHYSICAL', price: 100.0 },
    ],
  }
}

function item0(order: PosOrder): Record<string, unknown> {
  return (order.basket_items as Array<Record<string, unknown>>)[0] as Record<string, unknown>
}

const PAYMENT_KEYS = [
  'locale',
  'conversationId',
  'basketId',
  'price',
  'paidPrice',
  'currency',
  'paymentGroup',
  'buyer',
  'shippingAddress',
  'billingAddress',
  'basketItems',
  'paymentCard',
  'paymentChannel',
  'installment',
]

function expectedNonSecure(): Record<string, unknown> {
  return {
    locale: 'tr',
    conversationId: 'order-001',
    basketId: 'order-001',
    price: 100,
    paidPrice: 100,
    currency: 'TRY',
    paymentGroup: 'PRODUCT',
    buyer: {
      id: 'buyer-1',
      name: 'John',
      surname: 'Doe',
      identityNumber: '11111111111',
      email: 'john@example.com',
      gsmNumber: '+905350000000',
      registrationAddress: 'Address 1',
      city: 'Istanbul',
      country: 'Turkey',
      zipCode: '34000',
      ip: '127.0.0.1',
      registrationDate: '',
      lastLoginDate: '',
    },
    shippingAddress: {
      contactName: 'John Doe',
      city: 'Istanbul',
      country: 'Turkey',
      address: 'Shipping Address',
      zipCode: '',
    },
    billingAddress: {
      contactName: 'John Doe',
      city: 'Istanbul',
      country: 'Turkey',
      address: 'Billing Address',
      zipCode: '',
    },
    basketItems: [
      { id: 'item-1', name: 'Product', category1: 'Category', category2: '', itemType: 'PHYSICAL', price: 100 },
    ],
    paymentCard: {
      cardHolderName: 'John Doe',
      cardNumber: '5555444433332222',
      expireMonth: '12',
      expireYear: '2026',
      cvc: '123',
      registerCard: 0,
    },
    paymentChannel: 'WEB',
    installment: 1,
  }
}

/** Every string and key of a produced value; no value may be the text "undefined" or "null". */
function walk(value: unknown, visit: (v: unknown) => void): void {
  visit(value)
  if (Array.isArray(value)) {
    for (const v of value) walk(v, visit)
  } else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) walk(v, visit)
  }
}

describe('IyzicoPosRequestDataMapper', () => {
  it('supports only IyzicoPos', () => {
    expect(IyzicoPosRequestDataMapper.supports('IyzicoPos')).toBe(true)
    expect(IyzicoPosRequestDataMapper.supports('AkbankPos')).toBe(false)
  })

  it('test mode defaults to false and can be switched', () => {
    const { mapper } = setup()
    expect(mapper.isTestMode()).toBe(false)
    mapper.setTestMode(true)
    expect(mapper.isTestMode()).toBe(true)
    mapper.setTestMode(false)
    expect(mapper.isTestMode()).toBe(false)
  })

  it('create3DFormData is not implemented', async () => {
    const { mapper } = setup()
    await expect(
      mapper.create3DFormData(IA, {}, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'https://example.com'),
    ).rejects.toThrow(NotImplementedError)
  })

  describe('status and order history', () => {
    // deviation: R3 the transaction id is a payment id (digits), the reference rows used 'tx-001'
    const rows: Array<[string, PosOrder, Record<string, unknown>]> = [
      [
        'order id only',
        { id: 'order-123', lang: LANG.TR },
        { locale: 'tr', paymentConversationId: 'order-123', conversationId: 'order-123' },
      ],
      ['transaction id only', { transaction_id: '1001' }, { locale: 'tr', paymentId: '1001' }],
      [
        'both ids',
        { id: 'order-123', transaction_id: '1001' },
        { locale: 'tr', paymentId: '1001', paymentConversationId: 'order-123', conversationId: 'order-123' },
      ],
    ]

    it.each(rows)('status with %s', (_name, order, expected) => {
      const { mapper, crypt } = setup()
      const actual = mapper.createStatusRequestData(IA, order)
      expect(actual).toEqual(expected)
      // addition: key order is part of the signed and sent text
      expect(Object.keys(actual)).toEqual(Object.keys(expected))
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    it.each(rows)('order history with %s', (_name, order, expected) => {
      const { mapper } = setup()
      const actual = mapper.createOrderHistoryRequestData(IA, order)
      expect(actual).toEqual(expected)
      expect(Object.keys(actual)).toEqual(Object.keys(expected))
    })

    it('addition: both need an order id or a transaction id', () => {
      const { mapper } = setup()
      expect(() => mapper.createStatusRequestData(IA, {})).toThrow(PosError)
      expect(() => mapper.createOrderHistoryRequestData(IA, {})).toThrow(PosError)
    })

    it.each(['x', '0', '01', '1a', '1'.repeat(21)])('addition: R3 transaction id %j is refused', (id) => {
      const { mapper } = setup()
      expect(() => mapper.createStatusRequestData(IA, { transaction_id: id })).toThrow(PosError)
    })
  })

  describe('cancel and refund', () => {
    it('cancel keeps the ip', () => {
      const { mapper } = setup()
      const actual = mapper.createCancelRequestData(IA, {
        id: 'order-789',
        transaction_id: '1001',
        ip: '127.0.0.1',
      })
      expect(actual).toEqual({ locale: 'tr', conversationId: 'order-789', paymentId: '1001', ip: '127.0.0.1' })
      expect(Object.keys(actual)).toEqual(['locale', 'conversationId', 'paymentId', 'ip'])
    })

    it('addition: cancel without an ip omits the key', () => {
      const { mapper } = setup()
      const actual = mapper.createCancelRequestData(IA, { id: 'order-789', transaction_id: '1001' })
      expect(Object.keys(actual)).toEqual(['locale', 'conversationId', 'paymentId'])
    })

    it('refund', () => {
      const { mapper } = setup()
      const actual = mapper.createRefundRequestData(
        IA,
        {
          id: 'order-ref-1',
          transaction_id: '1001',
          amount: 50.0,
          currency: CURRENCY.TRY,
          ip: '192.168.1.1',
        },
        TX_TYPE.REFUND,
      )
      // note: 50.0 === 50
      expect(actual).toEqual({
        locale: 'tr',
        conversationId: 'order-ref-1',
        paymentId: '1001',
        price: 50,
        currency: 'TRY',
        ip: '192.168.1.1',
      })
      expect(Object.keys(actual)).toEqual(['locale', 'conversationId', 'paymentId', 'price', 'currency', 'ip'])
    })

    it('addition: a partial refund sends the same body and refund refuses other types', () => {
      const { mapper } = setup()
      const order = { id: 'o-1', transaction_id: '7', amount: 12.34 }
      expect(mapper.createRefundRequestData(IA, order, TX_TYPE.REFUND_PARTIAL)).toEqual({
        locale: 'tr',
        conversationId: 'o-1',
        paymentId: '7',
        price: 12.34,
        currency: 'TRY',
      })
      expect(() => mapper.createRefundRequestData(IA, order, TX_TYPE.PAY_AUTH)).toThrow(UnsupportedTransactionTypeError)
    })

    it.each([
      ['missing transaction id', { id: 'o-1', amount: 5 }],
      ['letters', { id: 'o-1', transaction_id: 'x', amount: 5 }],
      ['zero amount', { id: 'o-1', transaction_id: '1', amount: 0 }],
      ['negative amount', { id: 'o-1', transaction_id: '1', amount: -1 }],
      ['text amount', { id: 'o-1', transaction_id: '1', amount: 'abc' }],
      ['huge amount', { id: 'o-1', transaction_id: '1', amount: 1e13 }],
      ['bad ip', { id: 'o-1', transaction_id: '1', amount: 5, ip: 'a b' }],
    ] as Array<[string, PosOrder]>)('addition: refund with %s is refused', (_name, order) => {
      const { mapper } = setup()
      expect(() => mapper.createRefundRequestData(IA, order, TX_TYPE.REFUND)).toThrow(PosError)
    })
  })

  describe('3D Secure authorization', () => {
    it('builds the auth body from the order and the callback payment id', () => {
      const { mapper, crypt } = setup()
      // deviation: R5 the payment id must be digits and the conversation id is the order's
      const actual = mapper.create3DPaymentRequestData(IA, buildOrder(), TX_TYPE.PAY_AUTH, {
        conversationId: 'order-001',
        paymentId: '1',
      })
      expect(actual).toEqual({
        locale: 'tr',
        conversationId: 'order-001',
        paymentId: '1',
        paidPrice: 100,
        basketId: 'order-001',
        currency: 'TRY',
      })
      expect(Object.keys(actual)).toEqual([
        'locale',
        'conversationId',
        'paymentId',
        'paidPrice',
        'basketId',
        'currency',
      ])
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    it('addition: only the payment id comes from the callback', () => {
      const { mapper } = setup()
      const actual = mapper.create3DPaymentRequestData(IA, buildOrder(), TX_TYPE.PAY_PRE_AUTH, {
        conversationId: 'order-EVIL',
        paymentId: '55',
        paidPrice: '0.01',
        basketId: 'x',
        currency: 'USD',
      })
      expect(actual.conversationId).toBe('order-001')
      expect(actual.basketId).toBe('order-001')
      expect(actual.paidPrice).toBe(100)
      expect(actual.currency).toBe('TRY')
    })

    it.each([
      ['letters', 'pay-1'],
      ['leading zero', '01'],
      ['zero', '0'],
      ['blank', ''],
      ['21 digits', '1'.repeat(21)],
      ['a number', 5],
      ['an array', ['1']],
      ['missing', undefined],
    ])('addition: R5 callback payment id %s is refused', (_name, paymentId) => {
      const { mapper } = setup()
      expect(() =>
        mapper.create3DPaymentRequestData(IA, buildOrder(), TX_TYPE.PAY_AUTH, { paymentId } as Record<string, unknown>),
      ).toThrow(PosError)
    })

    it('addition: an inherited payment id is not read', () => {
      const { mapper } = setup()
      const callback = Object.create({ paymentId: '1' }) as Record<string, unknown>
      expect(() => mapper.create3DPaymentRequestData(IA, buildOrder(), TX_TYPE.PAY_AUTH, callback)).toThrow(PosError)
    })

    it('addition: only pay and pre are allowed', () => {
      const { mapper } = setup()
      expect(() =>
        mapper.create3DPaymentRequestData(IA, buildOrder(), TX_TYPE.PAY_POST_AUTH, { paymentId: '1' }),
      ).toThrow(UnsupportedTransactionTypeError)
    })
  })

  describe('post-auth', () => {
    it('builds the body', () => {
      const { mapper } = setup()
      // deviation: R3 transaction id must be digits
      const actual = mapper.createNonSecurePostAuthPaymentRequestData(IA, {
        id: 'order-1',
        transaction_id: '1',
        amount: 100.0,
        currency: CURRENCY.TRY,
        ip: '127.0.0.1',
      })
      expect(actual).toEqual({
        locale: 'tr',
        conversationId: 'order-1',
        paymentId: '1',
        paidPrice: 100,
        ip: '127.0.0.1',
        currency: 'TRY',
      })
      expect(Object.keys(actual)).toEqual(['locale', 'conversationId', 'paymentId', 'paidPrice', 'ip', 'currency'])
    })

    it('addition: without an ip the key is omitted', () => {
      const { mapper } = setup()
      const actual = mapper.createNonSecurePostAuthPaymentRequestData(IA, {
        id: 'order-1',
        transaction_id: '1',
        amount: 100,
      })
      expect(Object.keys(actual)).toEqual(['locale', 'conversationId', 'paymentId', 'paidPrice', 'currency'])
    })

    it.each(['0', '01', '1a', '1'.repeat(21), 'tx-1'])('addition: transaction id %j is refused', (id) => {
      const { mapper } = setup()
      expect(() =>
        mapper.createNonSecurePostAuthPaymentRequestData(IA, { id: 'o-1', transaction_id: id, amount: 1 }),
      ).toThrow(PosError)
    })
  })

  describe('3D Host retrieve', () => {
    it('builds the body', () => {
      const { mapper } = setup()
      const actual = mapper.create3DHostPaymentStatusRequestData({ token: 'tok-123' }, { id: 'order-1' })
      expect(actual).toEqual({ locale: 'tr', conversationId: 'order-1', token: 'tok-123' })
      expect(Object.keys(actual)).toEqual(['locale', 'conversationId', 'token'])
    })

    it.each([['a b'], [''], ['x'.repeat(129)], [['x']], [5], [undefined]])('addition: token %j is refused', (token) => {
      const { mapper } = setup()
      expect(() =>
        mapper.create3DHostPaymentStatusRequestData({ token } as Record<string, unknown>, { id: 'order-1' }),
      ).toThrow(PosError)
    })

    it('addition: an order id that is not plain is refused', () => {
      const { mapper } = setup()
      expect(() => mapper.create3DHostPaymentStatusRequestData({ token: 'tok' }, { id: 'a b' })).toThrow(PosError)
    })
  })

  describe('non-secure payment', () => {
    it('without sub merchant', () => {
      const { mapper, crypt } = setup()
      const actual = mapper.createNonSecurePaymentRequestData(IA, buildOrder(), TX_TYPE.PAY_AUTH, card)
      expect(actual).toEqual(expectedNonSecure())
      expect(Object.keys(actual)).toEqual(PAYMENT_KEYS)
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    it('with sub merchant', () => {
      const { mapper } = setup()
      const account = AccountFactory.createIyzicoPosAccount('iyzico', 'key', 'secret', 'sub-key')
      const actual = mapper.createNonSecurePaymentRequestData(account, buildOrder(), TX_TYPE.PAY_AUTH, card)
      expect(actual).toEqual({ ...expectedNonSecure(), subMerchantKey: 'sub-key' })
      expect(Object.keys(actual)).toEqual([...PAYMENT_KEYS, 'subMerchantKey'])
    })

    it('addition: the JSON text is byte for byte the expected one (numbers, not 100.0)', () => {
      const { mapper } = setup()
      const actual = mapper.createNonSecurePaymentRequestData(IA, buildOrder(), TX_TYPE.PAY_AUTH, card)
      expect(JSON.stringify(actual)).toBe(
        '{"locale":"tr","conversationId":"order-001","basketId":"order-001","price":100,"paidPrice":100,' +
          '"currency":"TRY","paymentGroup":"PRODUCT","buyer":{"id":"buyer-1","name":"John","surname":"Doe",' +
          '"identityNumber":"11111111111","email":"john@example.com","gsmNumber":"+905350000000",' +
          '"registrationAddress":"Address 1","city":"Istanbul","country":"Turkey","zipCode":"34000",' +
          '"ip":"127.0.0.1","registrationDate":"","lastLoginDate":""},"shippingAddress":{"contactName":"John Doe",' +
          '"city":"Istanbul","country":"Turkey","address":"Shipping Address","zipCode":""},' +
          '"billingAddress":{"contactName":"John Doe","city":"Istanbul","country":"Turkey",' +
          '"address":"Billing Address","zipCode":""},"basketItems":[{"id":"item-1","name":"Product",' +
          '"category1":"Category","category2":"","itemType":"PHYSICAL","price":100}],' +
          '"paymentCard":{"cardHolderName":"John Doe","cardNumber":"5555444433332222","expireMonth":"12",' +
          '"expireYear":"2026","cvc":"123","registerCard":0},"paymentChannel":"WEB","installment":1}',
      )
    })

    it('addition: the fixture basket 0.3 + 9.71 for 10.01 is accepted without float drift', () => {
      const { mapper } = setup()
      const order = buildOrder()
      order.amount = 10.01
      order.basket_items = [
        { id: 'a', name: 'A', category1: 'C', item_type: 'VIRTUAL', price: 0.3 },
        { id: 'b', name: 'B', category1: 'C', item_type: 'VIRTUAL', price: 9.71 },
      ]
      delete order.shipping_address
      const actual = mapper.createNonSecurePaymentRequestData(IA, order, TX_TYPE.PAY_AUTH, card)
      expect(actual.price).toBe(10.01)
      expect(actual.paidPrice).toBe(10.01)
      expect((actual.basketItems as Array<{ price: number }>).map((i) => i.price)).toEqual([0.3, 9.71])
      expect(JSON.stringify(actual)).toContain('"price":10.01,"paidPrice":10.01')
      expect('shippingAddress' in actual).toBe(false)
    })

    it('addition: a basket that does not add up is refused before any body is built', () => {
      const { mapper } = setup()
      const order = buildOrder()
      order.amount = 10.01
      order.basket_items = [
        { id: 'a', name: 'A', category1: 'C', item_type: 'VIRTUAL', price: 0.3 },
        { id: 'b', name: 'B', category1: 'C', item_type: 'VIRTUAL', price: 9.7 },
      ]
      expect(() => mapper.createNonSecurePaymentRequestData(IA, order, TX_TYPE.PAY_AUTH, card)).toThrow(
        'Basket item prices must add up to the order amount',
      )
    })

    it('addition: pre-auth is allowed, other types are not', () => {
      const { mapper } = setup()
      expect(() => mapper.createNonSecurePaymentRequestData(IA, buildOrder(), TX_TYPE.PAY_PRE_AUTH, card)).not.toThrow()
      expect(() => mapper.createNonSecurePaymentRequestData(IA, buildOrder(), TX_TYPE.CANCEL, card)).toThrow(
        UnsupportedTransactionTypeError,
      )
    })

    it('addition: no produced value is the text "undefined" and the order is not mutated', () => {
      const { mapper } = setup()
      const order = buildOrder()
      const before = JSON.stringify(order)
      const actual = mapper.createNonSecurePaymentRequestData(IA, order, TX_TYPE.PAY_AUTH, card)
      walk(actual, (v) => {
        expect(v).not.toBeUndefined()
        expect(v).not.toBe('undefined')
        expect(v).not.toBe('null')
      })
      expect(JSON.stringify(order)).toBe(before)
    })

    it('addition: the produced body shares nothing with the order', () => {
      const { mapper } = setup()
      const order = buildOrder()
      const actual = mapper.createNonSecurePaymentRequestData(IA, order, TX_TYPE.PAY_AUTH, card)
      expect(actual.buyer).not.toBe(order.buyer)
      expect(actual.basketItems).not.toBe(order.basket_items)
    })

    it('addition: an optional buyer date is passed through when it reads YYYY-MM-DD HH:mm:ss', () => {
      const { mapper } = setup()
      const order = buildOrder()
      ;(order.buyer as Record<string, unknown>).registration_date = '2013-04-21 15:12:09'
      ;(order.buyer as Record<string, unknown>).last_login_date = '2015-10-05 12:43:35'
      const buyer = mapper.createNonSecurePaymentRequestData(IA, order, TX_TYPE.PAY_AUTH, card).buyer as Record<
        string,
        string
      >
      expect(buyer.registrationDate).toBe('2013-04-21 15:12:09')
      expect(buyer.lastLoginDate).toBe('2015-10-05 12:43:35')
    })

    it('addition: a card holder of null is refused', () => {
      const { mapper } = setup()
      const noHolder = CreditCardFactory.create('5555444433332222', '26', '12', '123', null)
      expect(() => mapper.createNonSecurePaymentRequestData(IA, buildOrder(), TX_TYPE.PAY_AUTH, noHolder)).toThrow(
        PosError,
      )
    })
  })

  describe('3D initialize', () => {
    it('3d_secure with card', () => {
      const { mapper } = setup()
      const actual = mapper.create3DFormInitializeRequestData(
        IA,
        buildOrder(),
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        card,
      )
      expect(actual).toMatchObject({
        locale: 'tr',
        conversationId: 'order-001',
        price: 100,
        currency: 'TRY',
        paymentChannel: 'WEB',
        installment: 1,
        callbackUrl: 'https://example.com/success',
      })
      expect(Object.keys(actual)).toEqual([
        'locale',
        'conversationId',
        'basketId',
        'price',
        'paidPrice',
        'currency',
        'paymentGroup',
        'buyer',
        'shippingAddress',
        'billingAddress',
        'basketItems',
        'paymentCard',
        'callbackUrl',
        'paymentChannel',
        'installment',
      ])
    })

    it('3d_host', () => {
      const { mapper } = setup()
      const order = { ...buildOrder(), enabled_installments: [1, 3, 6] }
      const actual = mapper.create3DFormInitializeRequestData(IA, order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, card)
      expect(actual).toMatchObject({
        locale: 'tr',
        conversationId: 'order-001',
        price: 100,
        currency: 'TRY',
        forceThreeDS: 1,
        enabledInstallments: [1, 3, 6],
        callbackUrl: 'https://example.com/success',
      })
      expect('paymentChannel' in actual).toBe(false)
      expect('installment' in actual).toBe(false)
      expect(Object.keys(actual).slice(-3)).toEqual(['callbackUrl', 'forceThreeDS', 'enabledInstallments'])
    })

    it('addition: 3d_host without enabled installments sends an empty list', () => {
      const { mapper } = setup()
      const actual = mapper.create3DFormInitializeRequestData(IA, buildOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)
      expect(actual.enabledInstallments).toEqual([])
      expect('paymentCard' in actual).toBe(false)
    })

    it('addition: 3d_secure without a card is refused', () => {
      const { mapper } = setup()
      expect(() =>
        mapper.create3DFormInitializeRequestData(IA, buildOrder(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH),
      ).toThrow('iyzico 3D Secure needs the card')
    })

    it('addition: other models and other types are refused', () => {
      const { mapper } = setup()
      expect(() =>
        mapper.create3DFormInitializeRequestData(IA, buildOrder(), MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, card),
      ).toThrow(UnsupportedPaymentModelError)
      expect(() =>
        mapper.create3DFormInitializeRequestData(IA, buildOrder(), MODEL.THREE_D_SECURE, TX_TYPE.REFUND, card),
      ).toThrow(UnsupportedTransactionTypeError)
    })

    it.each([
      ['missing', undefined],
      ['javascript', 'javascript:x'],
      ['blank inside', 'https://example.com/a b'],
      ['too long', `https://example.com/${'a'.repeat(400)}`],
      ['array', ['https://example.com']],
    ])('addition: success_url %s is refused (3D Secure and 3D Host)', (_name, url) => {
      const { mapper } = setup()
      const order = { ...buildOrder(), success_url: url } as PosOrder
      if (url === undefined) delete order.success_url
      expect(() =>
        mapper.create3DFormInitializeRequestData(IA, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
      ).toThrow(PosError)
      expect(() => mapper.create3DFormInitializeRequestData(IA, order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)).toThrow(
        PosError,
      )
    })

    it('addition: non-secure does not need a success_url', () => {
      const { mapper } = setup()
      const order = buildOrder()
      delete order.success_url
      expect(() => mapper.createNonSecurePaymentRequestData(IA, order, TX_TYPE.PAY_AUTH, card)).not.toThrow()
    })

    it.each([
      ['unknown channel', { payment_channel: 'TV' }],
      ['channel of a wrong type', { payment_channel: 5 }],
    ] as Array<[string, PosOrder]>)('addition: %s is refused (3D Secure)', (_name, extra) => {
      const { mapper } = setup()
      const order = { ...buildOrder(), ...extra }
      expect(() =>
        mapper.create3DFormInitializeRequestData(IA, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
      ).toThrow(PosError)
      expect(() => mapper.createNonSecurePaymentRequestData(IA, order, TX_TYPE.PAY_AUTH, card)).toThrow(PosError)
    })

    it.each([
      ['out of range installments', { enabled_installments: [1, 13] }],
      ['duplicate installments', { enabled_installments: [3, 3] }],
      ['non-integer installments', { enabled_installments: [1.5] }],
      ['installments not a list', { enabled_installments: '1,3' }],
    ] as Array<[string, PosOrder]>)('addition: %s is refused (3D Host)', (_name, extra) => {
      const { mapper } = setup()
      const order = { ...buildOrder(), ...extra }
      expect(() => mapper.create3DFormInitializeRequestData(IA, order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)).toThrow(
        PosError,
      )
    })

    it('addition: a mobile payment channel is passed through', () => {
      const { mapper } = setup()
      const order = { ...buildOrder(), payment_channel: 'MOBILE_IOS' }
      const actual = mapper.create3DFormInitializeRequestData(IA, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
      expect(actual.paymentChannel).toBe('MOBILE_IOS')
    })
  })

  describe('addition: order validation (Requests review focus)', () => {
    const create = (order: PosOrder) => {
      const { mapper } = setup()
      return () => mapper.createNonSecurePaymentRequestData(IA, order, TX_TYPE.PAY_AUTH, card)
    }
    const change = (fn: (o: PosOrder) => void): PosOrder => {
      const order = buildOrder()
      fn(order)
      return order
    }
    const buyer = (o: PosOrder) => o.buyer as Record<string, unknown>

    it.each([
      ['order id with a blank', change((o) => (o.id = 'a b'))],
      ['order id of 65 characters', change((o) => (o.id = 'a'.repeat(65)))],
      ['order id starting with a hyphen', change((o) => (o.id = '-a'))],
      ['missing order id', change((o) => delete o.id)],
      ['amount 0', change((o) => (o.amount = 0))],
      ['amount -1', change((o) => (o.amount = -1))],
      ['amount abc', change((o) => (o.amount = 'abc' as unknown as number))],
      ['amount 1e13', change((o) => (o.amount = 1e13))],
      ['amount NaN', change((o) => (o.amount = Number.NaN))],
      ['amount below one kurus', change((o) => (o.amount = 0.001))],
      ['unknown currency', change((o) => (o.currency = 'XXX' as never))],
      ['currency of a wrong type', change((o) => (o.currency = 949 as never))],
      ['installment 13', change((o) => (o.installment = 13))],
      ['installment 1.5', change((o) => (o.installment = 1.5))],
      ['missing buyer', change((o) => delete o.buyer)],
      ['buyer that is a list', change((o) => (o.buyer = []))],
      ['missing buyer.identity_number', change((o) => delete buyer(o).identity_number)],
      ['blank buyer.name', change((o) => (buyer(o).name = '  '))],
      ['buyer.id that is a number', change((o) => (buyer(o).id = 5))],
      ['identity number of 21 characters', change((o) => (buyer(o).identity_number = '1'.repeat(21)))],
      ['email without an @', change((o) => (buyer(o).email = 'john.example.com'))],
      ['email with two @', change((o) => (buyer(o).email = 'a@b@c.com'))],
      ['email with a blank', change((o) => (buyer(o).email = 'a b@c.com'))],
      ['missing buyer.ip', change((o) => delete buyer(o).ip)],
      ['buyer.ip with a blank', change((o) => (buyer(o).ip = '1.2.3 4'))],
      ['buyer.city with a control character', change((o) => (buyer(o).city = 'Ist\nanbul'))],
      ['buyer.city with a line separator', change((o) => (buyer(o).city = `Ist${String.fromCharCode(0x2028)}anbul`))],
      ['buyer.city of 256 characters', change((o) => (buyer(o).city = 'a'.repeat(256)))],
      ['bad registration_date', change((o) => (buyer(o).registration_date = '2013-04-21'))],
      ['gsm_number of a wrong type', change((o) => (buyer(o).gsm_number = 5))],
      ['missing billing_address', change((o) => delete o.billing_address)],
      ['billing_address without a city', change((o) => delete (o.billing_address as Record<string, unknown>).city)],
      ['PHYSICAL item without a shipping_address', change((o) => delete o.shipping_address)],
      ['shipping_address of a wrong type', change((o) => (o.shipping_address = 'home'))],
      ['empty basket', change((o) => (o.basket_items = []))],
      ['basket that is not a list', change((o) => (o.basket_items = {} as never))],
      ['basket entry that is not an object', change((o) => (o.basket_items = ['x'] as never))],
      ['item without category1', change((o) => delete item0(o).category1)],
      ['item_type SERVICE', change((o) => (item0(o).item_type = 'SERVICE'))],
      ['item price 0', change((o) => (item0(o).price = 0))],
      ['item price text', change((o) => (item0(o).price = 'abc'))],
      ['item price that does not add up', change((o) => (item0(o).price = 99.99))],
    ] as Array<[string, PosOrder]>)('%s is a PosError', (_name, order) => {
      expect(create(order)).toThrow(PosError)
    })

    it('a VIRTUAL basket needs no shipping address', () => {
      const order = change((o) => {
        delete o.shipping_address
        item0(o).item_type = 'VIRTUAL'
      })
      const { mapper } = setup()
      const actual = mapper.createNonSecurePaymentRequestData(IA, order, TX_TYPE.PAY_AUTH, card)
      expect('shippingAddress' in actual).toBe(false)
      expect(Object.keys(actual)).toEqual(PAYMENT_KEYS.filter((k) => k !== 'shippingAddress'))
    })

    it('inherited order values are not read', () => {
      const order = Object.create(buildOrder()) as PosOrder
      expect(create(order)).toThrow(PosError)
    })

    it('a decimal text amount and basket price are read exactly', () => {
      const { mapper } = setup()
      const order = change((o) => {
        o.amount = '10.01' as unknown as number
        item0(o).price = '10.01'
      })
      expect(mapper.createNonSecurePaymentRequestData(IA, order, TX_TYPE.PAY_AUTH, card).price).toBe(10.01)
    })

    it('the lang of the order is mapped', () => {
      const { mapper } = setup()
      const order = { ...buildOrder(), lang: LANG.EN }
      expect(mapper.createNonSecurePaymentRequestData(IA, order, TX_TYPE.PAY_AUTH, card).locale).toBe('en')
    })

    it('an installment count is sent as the integer', () => {
      const { mapper } = setup()
      const order = { ...buildOrder(), installment: 3 }
      expect(mapper.createNonSecurePaymentRequestData(IA, order, TX_TYPE.PAY_AUTH, card).installment).toBe(3)
    })
  })
})
