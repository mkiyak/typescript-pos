import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KuveytPosCrypt } from '../../../../../src/crypt/KuveytPosCrypt.js'
import { KuveytPosRequestDataMapper } from '../../../../../src/data-mapper/request/mapper/KuveytPosRequestDataMapper.js'
import { KuveytPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/KuveytPosRequestValueFormatter.js'
import { KuveytPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/KuveytPosRequestValueMapper.js'
import { NotImplementedError, PosError, UnsupportedPaymentModelError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import { CARD_TYPE, CURRENCY, LANG, MODEL, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'

const KM = AccountFactory.createBoaPosAccount('kuveytpos', '80', 'apiuser', '400235', 'Api123')
const KM_HP = 'c77dFssAnYSy6O2MJo+5tMYtGVc='
const card = CreditCardFactory.create('4155650100416111', '25', '01', '123', 'John Doe', CARD_TYPE.VISA)

const s1 = (text: string): string => createHash('sha1').update(text, 'utf8').digest('base64')

/** Recursive key sort, like the expectations of the rows (key order is not part of them). */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortDeep(v)]),
    )
  }
  return value
}

function expectSorted(actual: unknown, expected: unknown): void {
  expect(sortDeep(actual)).toStrictEqual(sortDeep(expected))
}

/** Fails on an `undefined` anywhere, including keys whose value is undefined (JSON would drop them). */
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

type CryptStub = Record<
  'hashString' | 'check3DHash' | 'create3DHash' | 'createHash' | 'hashFromParams' | 'generateRandomString',
  ReturnType<typeof vi.fn>
>

function makeCryptStub(hash: string): CryptStub {
  return {
    hashString: vi.fn(),
    check3DHash: vi.fn(),
    create3DHash: vi.fn(),
    createHash: vi.fn().mockReturnValue(hash),
    hashFromParams: vi.fn(),
    generateRandomString: vi.fn(),
  }
}

/** The data the crypt was asked to sign in its first call. */
function hashedData(stub: CryptStub): Record<string, unknown> {
  return (stub.createHash.mock.calls[0] as unknown[])[1] as Record<string, unknown>
}

function makeMapper(crypt: unknown): KuveytPosRequestDataMapper {
  return new KuveytPosRequestDataMapper(
    new KuveytPosRequestValueMapper(),
    new KuveytPosRequestValueFormatter(),
    {},
    crypt as KuveytPosCrypt,
    LANG.EN,
  )
}

const formOrder = (): PosOrder => ({
  id: '2020110828BC',
  amount: 10.01,
  installment: 0,
  currency: CURRENCY.TRY,
  success_url: 'http://localhost/finansbank-payfor/3d/success.php',
  fail_url: 'http://localhost/finansbank-payfor/3d/fail.php',
  ip: '127.0.0.1',
  payment_channel: '02',
  buyer: { email: 'test@example.com', gsm_number_cc: '90', gsm_number: '5001234567' },
  billing_address: {
    city: 'Istanbul',
    country: '792',
    address: 'Test Street No 1',
    zip_code: '34000',
    state: '40',
  },
})

const formExpected = {
  APIVersion: KuveytPosRequestDataMapper.API_VERSION,
  MerchantId: '80',
  UserName: 'apiuser',
  CustomerId: '400235',
  HashData: 'request-3d-hash',
  TransactionType: 'Sale',
  TransactionSecurity: '3',
  InstallmentCount: '0',
  Amount: 1001,
  DisplayAmount: 1001,
  CurrencyCode: '0949',
  MerchantOrderId: '2020110828BC',
  OkUrl: 'http://localhost/finansbank-payfor/3d/success.php',
  FailUrl: 'http://localhost/finansbank-payfor/3d/fail.php',
  CardHolderName: 'John Doe',
  CardNumber: '4155650100416111',
  CardType: 'Visa',
  CardExpireDateYear: '25',
  CardExpireDateMonth: '01',
  CardCVV2: '123',
  DeviceData: { ClientIP: '127.0.0.1', DeviceChannel: '02' },
  CardHolderData: {
    BillAddrCity: 'Istanbul',
    BillAddrCountry: '792',
    BillAddrLine1: 'Test Street No 1',
    BillAddrPostCode: '34000',
    BillAddrState: '40',
    Email: 'test@example.com',
    MobilePhone: { Cc: '90', Subscriber: '5001234567' },
  },
}

const refOrder = (amount: number): PosOrder => ({
  id: '2023070849CD',
  remote_order_id: '114293600',
  ref_ret_num: '318923298433',
  auth_code: '241839',
  transaction_id: '298433',
  amount,
  currency: CURRENCY.TRY,
})

function vposMessage(txType: string, amount: number, display: number): Record<string, unknown> {
  return {
    APIVersion: KuveytPosRequestDataMapper.API_VERSION,
    InstallmentMaturityCommisionFlag: 0,
    HashData: 'request-hash',
    MerchantId: '80',
    SubMerchantId: 0,
    CustomerId: '400235',
    UserName: 'apiuser',
    CardType: 'Visa',
    BatchID: 0,
    TransactionType: txType,
    InstallmentCount: 0,
    Amount: amount,
    DisplayAmount: display,
    CancelAmount: amount,
    MerchantOrderId: '2023070849CD',
    FECAmount: 0,
    CurrencyCode: '0949',
    QeryId: 0,
    DebtId: 0,
    SurchargeAmount: 0,
    SGKDebtAmount: 0,
    TransactionSecurity: 1,
  }
}

function refRequest(txType: string, amount: number, display: number): Record<string, unknown> {
  return {
    [txType]: {
      request: {
        IsFromExternalNetwork: true,
        BusinessKey: 0,
        ResourceId: 0,
        ActionId: 0,
        LanguageId: 0,
        CustomerId: '400235',
        MailOrTelephoneOrder: true,
        Amount: amount,
        MerchantId: '80',
        OrderId: '114293600',
        RRN: '318923298433',
        Stan: '298433',
        ProvisionNumber: '241839',
        VPosMessage: vposMessage(txType, amount, display),
      },
    },
  }
}

const callback = (): Record<string, unknown> => ({
  MD: '67YtBfBRTZ0XBKnAHi8c/A==',
  VPosMessage: {
    InstallmentCount: '0',
    Amount: '100',
    CurrencyCode: '0949',
    OkUrl: 'http://localhost/response',
    FailUrl: 'http://localhost/response',
    OrderId: '86297530',
    MerchantOrderId: '2020110828BC',
    TransactionSecurity: '3',
    MerchantId: '****',
    SubMerchantId: '0',
    CustomerId: '*****',
    UserName: 'fapapi',
    HashPassword: 'Hiorgg24rNeRdHUvMCg//mOJn4U=',
    CardNumber: '***********1609',
  },
  IsEnrolled: 'true',
  IsVirtual: 'false',
  ResponseCode: '00',
  ResponseMessage: 'Kart doğrulandı.',
  OrderId: '86297530',
  MerchantOrderId: '2020110828BC',
  HashData: 'ucejRvHjCbuPXagyoweFLnJfSJg=',
  BusinessKey: '20220845654324600000140459',
})

const provisionOrder = (): PosOrder => ({
  id: '2020110828BC',
  amount: 1,
  installment: '0' as never,
  currency: CURRENCY.TRY,
  ip: '127.0.0.1',
  lang: LANG.TR,
})

const provisionExpected = {
  APIVersion: KuveytPosRequestDataMapper.API_VERSION,
  HashData: 'request-hash',
  MerchantId: '80',
  CustomerId: '400235',
  UserName: 'apiuser',
  CustomerIPAddress: '127.0.0.1',
  KuveytTurkVPosAdditionalData: { AdditionalData: { Key: 'MD', Data: '67YtBfBRTZ0XBKnAHi8c/A==' } },
  TransactionType: 'Sale',
  InstallmentCount: '0',
  Amount: '100',
  DisplayAmount: '100',
  CurrencyCode: '0949',
  MerchantOrderId: '2020110828BC',
  TransactionSecurity: '3',
}

describe('KuveytPosRequestDataMapper', () => {
  let crypt: CryptStub
  let mapper: KuveytPosRequestDataMapper

  beforeEach(() => {
    crypt = makeCryptStub('request-hash')
    mapper = makeMapper(crypt)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('supports only KuveytPos', () => {
    expect(KuveytPosRequestDataMapper.supports('KuveytPos')).toBe(true)
    expect(KuveytPosRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  describe('3D form initialisation', () => {
    beforeEach(() => {
      crypt = makeCryptStub('request-3d-hash')
      mapper = makeMapper(crypt)
    })

    it('builds the request', () => {
      const actual = mapper.create3DFormInitializeRequestData(
        KM,
        formOrder(),
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        card,
      )
      expectSorted(actual, formExpected)
      expect(crypt.createHash).toHaveBeenCalledTimes(1)
    })

    it('puts the hash last, computed over the data that is sent', () => {
      const actual = mapper.create3DFormInitializeRequestData(
        KM,
        formOrder(),
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        card,
      )
      expect(Object.keys(actual).at(-1)).toBe('HashData')
      const hashed = hashedData(crypt)
      expect(hashed.MerchantOrderId).toBe('2020110828BC')
      expect(hashed.Amount).toBe(1001)
      expect(hashed.OkUrl).toBe(actual.OkUrl)
      expect(hashed.FailUrl).toBe(actual.FailUrl)
    })

    // deviation: B14 (error class)
    it.each(['payment_channel', 'buyer', 'billing_address'])('requires %s', (key) => {
      const order = formOrder()
      delete order[key]
      expect(() =>
        mapper.create3DFormInitializeRequestData(KM, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
      ).toThrow(PosError)
    })

    // addition: K3 (the bank page is for 3D Secure only)
    it('rejects a payment model other than 3D Secure', () => {
      expect(() =>
        mapper.create3DFormInitializeRequestData(KM, formOrder(), MODEL.NON_SECURE, TX_TYPE.PAY_AUTH, card),
      ).toThrow(UnsupportedPaymentModelError)
    })

    // addition: only a sale can be started
    it.each([TX_TYPE.CANCEL, TX_TYPE.REFUND, TX_TYPE.STATUS, TX_TYPE.PAY_POST_AUTH, TX_TYPE.PAY_PRE_AUTH])(
      'rejects the transaction type %s',
      (txType) => {
        expect(() =>
          mapper.create3DFormInitializeRequestData(KM, formOrder(), MODEL.THREE_D_SECURE, txType, card),
        ).toThrow(PosError)
      },
    )

    // addition: sub-fields of the buyer and the address are optional text
    it('writes an absent buyer or billing sub-field as an empty string', () => {
      const order = formOrder()
      order.buyer = { email: 'a@b.c' }
      order.billing_address = { city: 'Ankara', zip_code: 6000 }
      const actual = mapper.create3DFormInitializeRequestData(KM, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
      expect(actual.CardHolderData).toStrictEqual({
        BillAddrCity: 'Ankara',
        BillAddrCountry: '',
        BillAddrLine1: '',
        BillAddrPostCode: '6000',
        BillAddrState: '',
        Email: 'a@b.c',
        MobilePhone: { Cc: '', Subscriber: '' },
      })
      expectNoUndefined(actual)
    })

    // addition: an object is not text
    it('rejects a non-text buyer sub-field', () => {
      const order = formOrder()
      order.buyer = { email: { a: 1 } }
      expect(() =>
        mapper.create3DFormInitializeRequestData(KM, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
      ).toThrow(PosError)
    })

    // addition: buyer and billing_address must be plain objects
    it.each([['x'], [['a']], [5], [null]])('rejects a buyer that is %j', (value) => {
      const order = formOrder()
      order.buyer = value
      expect(() =>
        mapper.create3DFormInitializeRequestData(KM, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
      ).toThrow(PosError)
    })

    // addition: ip is required and not blank
    it.each([undefined, '', 5])('rejects the ip %j', (ip) => {
      const order = formOrder()
      order.ip = ip as never
      expect(() =>
        mapper.create3DFormInitializeRequestData(KM, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
      ).toThrow(PosError)
    })

    it('works without a card', () => {
      const actual = mapper.create3DFormInitializeRequestData(KM, formOrder(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH)
      expect(actual).not.toHaveProperty('CardNumber')
      expect(actual).not.toHaveProperty('CardCVV2')
    })

    // addition: an unknown card type is sent as an empty type
    it('sends an empty CardType for a card without a type', () => {
      const typeless = CreditCardFactory.create('4155650100416111', '25', '01', '123', 'John Doe')
      const actual = mapper.create3DFormInitializeRequestData(
        KM,
        formOrder(),
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        typeless,
      )
      expect(actual.CardType).toBe('')
    })

    // addition: B6 (exact kuruş everywhere the amount appears)
    it('writes 1.15 as 115 in Amount and DisplayAmount', () => {
      const order = formOrder()
      order.amount = 1.15
      const actual = mapper.create3DFormInitializeRequestData(KM, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
      expect(actual.Amount).toBe(115)
      expect(actual.DisplayAmount).toBe(115)
      expect(hashedData(crypt).Amount).toBe(115)
    })

    // addition: B7 / K3 with the real crypt, the hash covers the URLs
    it('signs with the real crypt over the order id, amount, both URLs and the user name', () => {
      const real = makeMapper(new KuveytPosCrypt())
      const order = formOrder()
      order.amount = 1.15
      const actual = real.create3DFormInitializeRequestData(KM, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
      const expected = s1(`80${order.id}115${order.success_url}${order.fail_url}apiuser${KM_HP}`)
      expect(actual.HashData).toBe(expected)
    })

    // addition: B6
    it.each([0, -1, 0.004, 'abc', 1e13, undefined, null])('rejects the amount %j', (amount) => {
      const order = formOrder()
      order.amount = amount as never
      expect(() =>
        mapper.create3DFormInitializeRequestData(KM, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
      ).toThrow(PosError)
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    // addition: strict installment
    it.each([1.5, 100, -1, 'x'])('rejects the installment %j', (installment) => {
      const order = formOrder()
      order.installment = installment as never
      expect(() =>
        mapper.create3DFormInitializeRequestData(KM, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
      ).toThrow(PosError)
    })

    it.each([
      [3, '3'],
      [1, '0'],
      [undefined, '0'],
    ])('installment %j is %j', (installment, expected) => {
      const order = formOrder()
      order.installment = installment as never
      const actual = mapper.create3DFormInitializeRequestData(KM, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
      expect(actual.InstallmentCount).toBe(expected)
    })

    // addition: B7
    it.each(['sipariş1', 'a b', '', 'x'.repeat(65), undefined, true, { a: 1 }, Number.NaN])(
      'rejects the order id %j',
      (id) => {
        const order = formOrder()
        order.id = id as never
        expect(() =>
          mapper.create3DFormInitializeRequestData(KM, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
        ).toThrow(PosError)
      },
    )

    it('accepts a numeric order id', () => {
      const order = formOrder()
      order.id = 12345 as never
      const actual = mapper.create3DFormInitializeRequestData(KM, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
      expect(actual.MerchantOrderId).toBe('12345')
    })

    // addition: B7
    it.each(['javascript:alert(1)', 'https://a b', 'https://ş.com', 'ftp://a.com', 5, undefined])(
      'rejects the success_url %j',
      (url) => {
        const order = formOrder()
        order.success_url = url as never
        expect(() =>
          mapper.create3DFormInitializeRequestData(KM, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
        ).toThrow(PosError)
      },
    )

    it('rejects an unsafe fail_url', () => {
      const order = formOrder()
      order.fail_url = 'https://a.com/\nx'
      expect(() =>
        mapper.create3DFormInitializeRequestData(KM, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
      ).toThrow(PosError)
    })

    it('never produces an undefined value and does not mutate the order', () => {
      const order = formOrder()
      const snapshot = structuredClone(order)
      const actual = mapper.create3DFormInitializeRequestData(KM, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
      expectNoUndefined(actual)
      expect(order).toStrictEqual(snapshot)
    })
  })

  describe('cancel', () => {
    it('builds the request', () => {
      expectSorted(mapper.createCancelRequestData(KM, refOrder(1.01)), refRequest('SaleReversal', 101, 101))
      expect(crypt.createHash).toHaveBeenCalledTimes(1)
    })

    it('signs the VPosMessage that is sent', () => {
      const actual = mapper.createCancelRequestData(KM, refOrder(1.01)) as {
        SaleReversal: { request: Record<string, unknown> }
      }
      const hashed = hashedData(crypt)
      expect(hashed).toBe(actual.SaleReversal.request.VPosMessage)
    })

    // addition: required fields
    it.each(['id', 'remote_order_id', 'ref_ret_num', 'auth_code', 'transaction_id', 'amount'])('requires %s', (key) => {
      const order = refOrder(1.01)
      delete order[key]
      expect(() => mapper.createCancelRequestData(KM, order)).toThrow(PosError)
    })

    // addition: B6
    it.each([0, -1, 0.004, 'abc', 1e13])('rejects the amount %j', (amount) => {
      const order = refOrder(1.01)
      order.amount = amount as never
      expect(() => mapper.createCancelRequestData(KM, order)).toThrow(PosError)
    })

    it('writes 1.15 as 115', () => {
      const actual = mapper.createCancelRequestData(KM, refOrder(1.15)) as {
        SaleReversal: { request: Record<string, unknown> }
      }
      expect(actual.SaleReversal.request.Amount).toBe(115)
      const message = actual.SaleReversal.request.VPosMessage as Record<string, unknown>
      expect([message.Amount, message.DisplayAmount, message.CancelAmount]).toStrictEqual([115, 115, 115])
    })

    // addition: B7
    it.each(['sipariş1', 'a b', '', 'x'.repeat(65)])('rejects the order id %j', (id) => {
      const order = refOrder(1.01)
      order.id = id
      expect(() => mapper.createCancelRequestData(KM, order)).toThrow(PosError)
    })

    // addition: the bank order id is digits
    it.each(['abc', '0', '12 3', '1234567890123456789012'])('rejects the remote order id %j', (id) => {
      const order = refOrder(1.01)
      order.remote_order_id = id
      expect(() => mapper.createCancelRequestData(KM, order)).toThrow(PosError)
    })

    it.each([{ a: 1 }, ['1'], true])('rejects a non-text reference %j', (value) => {
      const order = refOrder(1.01)
      order.ref_ret_num = value as never
      expect(() => mapper.createCancelRequestData(KM, order)).toThrow(PosError)
    })

    it('does not mutate the order and has no undefined', () => {
      const order = refOrder(1.01)
      const snapshot = structuredClone(order)
      expectNoUndefined(mapper.createCancelRequestData(KM, order))
      expect(order).toStrictEqual(snapshot)
    })
  })

  describe('refund', () => {
    it('builds the full refund', () => {
      expectSorted(mapper.createRefundRequestData(KM, refOrder(1.01), TX_TYPE.REFUND), refRequest('DrawBack', 101, 0))
      expect(crypt.createHash).toHaveBeenCalledTimes(1)
    })

    it('builds the partial refund', () => {
      const order = { ...refOrder(9.01), order_amount: 10.01 }
      expectSorted(
        mapper.createRefundRequestData(KM, order, TX_TYPE.REFUND_PARTIAL),
        refRequest('PartialDrawback', 901, 0),
      )
      expect(crypt.createHash).toHaveBeenCalledTimes(1)
    })

    // addition: a refund request never becomes another bank operation
    it.each([TX_TYPE.PAY_AUTH, TX_TYPE.CANCEL, TX_TYPE.STATUS, TX_TYPE.PAY_PRE_AUTH, 'x' as TxType])(
      'rejects the transaction type %s',
      (txType) => {
        expect(() => mapper.createRefundRequestData(KM, refOrder(1.01), txType)).toThrow(PosError)
      },
    )

    it.each(['id', 'remote_order_id', 'ref_ret_num', 'auth_code', 'transaction_id', 'amount'])('requires %s', (key) => {
      const order = refOrder(1.01)
      delete order[key]
      expect(() => mapper.createRefundRequestData(KM, order, TX_TYPE.REFUND)).toThrow(PosError)
    })

    it.each([0, -1, 0.004, 'abc', 1e13])('rejects the amount %j', (amount) => {
      const order = refOrder(1.01)
      order.amount = amount as never
      expect(() => mapper.createRefundRequestData(KM, order, TX_TYPE.REFUND)).toThrow(PosError)
    })

    it('writes 8.2 as 820', () => {
      const actual = mapper.createRefundRequestData(KM, refOrder(8.2), TX_TYPE.REFUND_PARTIAL) as {
        PartialDrawback: { request: Record<string, unknown> }
      }
      expect(actual.PartialDrawback.request.Amount).toBe(820)
    })

    it('does not mutate the order and has no undefined', () => {
      const order = refOrder(1.01)
      const snapshot = structuredClone(order)
      expectNoUndefined(mapper.createRefundRequestData(KM, order, TX_TYPE.REFUND))
      expect(order).toStrictEqual(snapshot)
    })
  })

  describe('status', () => {
    const expected = (start: string, end: string, orderId: unknown = 0): Record<string, unknown> => ({
      GetMerchantOrderDetail: {
        request: {
          IsFromExternalNetwork: true,
          BusinessKey: 0,
          ResourceId: 0,
          ActionId: 0,
          LanguageId: 0,
          CustomerId: '400235',
          MailOrTelephoneOrder: true,
          Amount: 0,
          MerchantId: '80',
          OrderId: orderId,
          TransactionType: 0,
          VPosMessage: {
            APIVersion: KuveytPosRequestDataMapper.API_VERSION,
            InstallmentMaturityCommisionFlag: 0,
            HashData: 'request-hash',
            MerchantId: '80',
            SubMerchantId: 0,
            CustomerId: '400235',
            UserName: 'apiuser',
            CardType: 'Visa',
            BatchID: 0,
            TransactionType: 'GetMerchantOrderDetail',
            InstallmentCount: 0,
            Amount: 0,
            DisplayAmount: 0,
            CancelAmount: 0,
            MerchantOrderId: '2023070849CD',
            FECAmount: 0,
            CurrencyCode: '0949',
            QeryId: 0,
            DebtId: 0,
            SurchargeAmount: 0,
            SGKDebtAmount: 0,
            TransactionSecurity: 1,
          },
          MerchantOrderId: '2023070849CD',
          StartDate: start,
          EndDate: end,
        },
      },
    })

    it('builds the request', () => {
      // deviation: B13 (explicit +03:00 instants)
      const order: PosOrder = {
        id: '2023070849CD',
        currency: CURRENCY.TRY,
        start_date: new Date('2022-07-08T22:44:31+03:00'),
        end_date: new Date('2023-07-08T22:44:31+03:00'),
      }
      expectSorted(mapper.createStatusRequestData(KM, order), expected('2022-07-08T22:44:31', '2023-07-08T22:44:31'))
      expect(crypt.createHash).toHaveBeenCalledTimes(1)
    })

    // addition: dates default to the last 360 days
    it('defaults the dates to now - 360 days and now', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-06-10T10:00:00+03:00'))
      const actual = mapper.createStatusRequestData(KM, { id: '2023070849CD' })
      expectSorted(actual, expected('2023-06-16T10:00:00', '2024-06-10T10:00:00'))
    })

    it('carries the bank order id when given', () => {
      const actual = mapper.createStatusRequestData(KM, {
        id: '2023070849CD',
        remote_order_id: '114293600',
        start_date: new Date('2022-07-08T22:44:31+03:00'),
        end_date: new Date('2023-07-08T22:44:31+03:00'),
      }) as { GetMerchantOrderDetail: { request: Record<string, unknown> } }
      expect(actual.GetMerchantOrderDetail.request.OrderId).toBe('114293600')
    })

    it('requires the order id', () => {
      expect(() => mapper.createStatusRequestData(KM, {})).toThrow(PosError)
    })

    it.each(['abc', '0', {}, true])('rejects the bank order id %j', (id) => {
      expect(() => mapper.createStatusRequestData(KM, { id: '1', remote_order_id: id as never })).toThrow(PosError)
    })

    it.each(['2024-01-01', 5, new Date('x')])('rejects the start date %j', (date) => {
      expect(() => mapper.createStatusRequestData(KM, { id: '1', start_date: date as never })).toThrow(PosError)
    })

    it('does not mutate the order and has no undefined', () => {
      const order: PosOrder = { id: '2023070849CD' }
      const snapshot = structuredClone(order)
      expectNoUndefined(mapper.createStatusRequestData(KM, order))
      expect(order).toStrictEqual(snapshot)
    })
  })

  describe('3D provision', () => {
    it('builds the request', () => {
      // deviation: K3 (values come from the order; the unsigned callback message carries the same values in this row)
      const actual = mapper.create3DPaymentRequestData(KM, provisionOrder(), TX_TYPE.PAY_AUTH, callback())
      expectSorted(actual, provisionExpected)
      expect(crypt.createHash).toHaveBeenCalledTimes(1)
    })

    // addition: K3 (the money values are the order's, never the browser-posted message's)
    it('ignores the unsigned VPosMessage values', () => {
      const posted = {
        MD: 'm1',
        VPosMessage: {
          Amount: '1',
          CurrencyCode: '0840',
          InstallmentCount: '9',
          MerchantOrderId: 'X',
          TransactionSecurity: '0',
        },
      }
      const actual = mapper.create3DPaymentRequestData(KM, provisionOrder(), TX_TYPE.PAY_AUTH, posted)
      expect(actual.Amount).toBe('100')
      expect(actual.DisplayAmount).toBe('100')
      expect(actual.CurrencyCode).toBe('0949')
      expect(actual.InstallmentCount).toBe('0')
      expect(actual.MerchantOrderId).toBe('2020110828BC')
      expect(actual.TransactionSecurity).toBe('3')
      expect(actual.KuveytTurkVPosAdditionalData).toStrictEqual({ AdditionalData: { Key: 'MD', Data: 'm1' } })
    })

    it('works without a VPosMessage at all', () => {
      const actual = mapper.create3DPaymentRequestData(KM, provisionOrder(), TX_TYPE.PAY_AUTH, { MD: 'abc==' })
      expect(actual.Amount).toBe('100')
    })

    // addition: B6
    it('writes 1.15 as 115 for Amount and DisplayAmount', () => {
      const order = provisionOrder()
      order.amount = 1.15
      const actual = mapper.create3DPaymentRequestData(KM, order, TX_TYPE.PAY_AUTH, { MD: 'm1' })
      expect(actual.Amount).toBe('115')
      expect(actual.DisplayAmount).toBe('115')
    })

    it('takes the installment and currency of the order', () => {
      const order = provisionOrder()
      order.installment = 3
      order.currency = CURRENCY.EUR
      const actual = mapper.create3DPaymentRequestData(KM, order, TX_TYPE.PAY_AUTH, { MD: 'm1' })
      expect(actual.InstallmentCount).toBe('3')
      expect(actual.CurrencyCode).toBe('0978')
    })

    // addition: B16
    it.each([undefined, '', {}, [], 5, null, 'a b', 'x'.repeat(1025), 'é'])('rejects the MD %j', (md) => {
      expect(() =>
        mapper.create3DPaymentRequestData(KM, provisionOrder(), TX_TYPE.PAY_AUTH, { MD: md as never }),
      ).toThrow(PosError)
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    it('rejects an MD that is only inherited', () => {
      const inherited = Object.create({ MD: 'm1' }) as Record<string, unknown>
      expect(() => mapper.create3DPaymentRequestData(KM, provisionOrder(), TX_TYPE.PAY_AUTH, inherited)).toThrow(
        PosError,
      )
    })

    // addition: the client ip is required
    it.each([undefined, '', 5])('rejects the ip %j', (ip) => {
      const order = provisionOrder()
      order.ip = ip as never
      expect(() => mapper.create3DPaymentRequestData(KM, order, TX_TYPE.PAY_AUTH, { MD: 'm1' })).toThrow(PosError)
    })

    it.each(['sipariş1', 'a b', '', 'x'.repeat(65)])('rejects the order id %j', (id) => {
      const order = provisionOrder()
      order.id = id
      expect(() => mapper.create3DPaymentRequestData(KM, order, TX_TYPE.PAY_AUTH, { MD: 'm1' })).toThrow(PosError)
    })

    it.each([0, -1, 0.004, 'abc', 1e13])('rejects the amount %j', (amount) => {
      const order = provisionOrder()
      order.amount = amount as never
      expect(() => mapper.create3DPaymentRequestData(KM, order, TX_TYPE.PAY_AUTH, { MD: 'm1' })).toThrow(PosError)
    })

    it.each([1.5, 100])('rejects the installment %j', (installment) => {
      const order = provisionOrder()
      order.installment = installment
      expect(() => mapper.create3DPaymentRequestData(KM, order, TX_TYPE.PAY_AUTH, { MD: 'm1' })).toThrow(PosError)
    })

    it.each([TX_TYPE.CANCEL, TX_TYPE.REFUND, TX_TYPE.STATUS, TX_TYPE.PAY_PRE_AUTH])(
      'rejects the transaction type %s',
      (txType) => {
        expect(() => mapper.create3DPaymentRequestData(KM, provisionOrder(), txType, { MD: 'm1' })).toThrow(PosError)
      },
    )

    // addition: B2 (real crypt: the hash covers exactly the order id and amount that are sent)
    it('signs with the real crypt', () => {
      const real = makeMapper(new KuveytPosCrypt())
      const order = provisionOrder()
      order.amount = 1.15
      const actual = real.create3DPaymentRequestData(KM, order, TX_TYPE.PAY_AUTH, { MD: 'm1' })
      expect(actual.HashData).toBe(s1(`80${order.id}115apiuser${KM_HP}`))
    })

    it('does not mutate the order or the callback and has no undefined', () => {
      const order = provisionOrder()
      const posted = callback()
      const orderSnapshot = structuredClone(order)
      const postedSnapshot = structuredClone(posted)
      expectNoUndefined(mapper.create3DPaymentRequestData(KM, order, TX_TYPE.PAY_AUTH, posted))
      expect(order).toStrictEqual(orderSnapshot)
      expect(posted).toStrictEqual(postedSnapshot)
    })
  })

  describe('non-secure payment', () => {
    const order = (): PosOrder => ({
      id: '2020110828BC',
      amount: 1.1,
      ip: '127.0.0.1',
      installment: 0,
      currency: CURRENCY.TRY,
    })

    const expected = {
      APIVersion: 'TDV2.0.0',
      Amount: 110,
      CardCVV2: '123',
      CardExpireDateMonth: '01',
      CardExpireDateYear: '25',
      CardHolderName: 'John Doe',
      CardNumber: '4155650100416111',
      CurrencyCode: '0949',
      CustomerId: '400235',
      DisplayAmount: 110,
      HashData: 'request-hash',
      InstallmentCount: '0',
      MerchantId: '80',
      MerchantOrderId: '2020110828BC',
      TransactionSecurity: '1',
      TransactionType: 'Sale',
      UserName: 'apiuser',
    }

    it('builds the request', () => {
      expectSorted(mapper.createNonSecurePaymentRequestData(KM, order(), TX_TYPE.PAY_AUTH, card), expected)
      expect(crypt.createHash).toHaveBeenCalledTimes(1)
    })

    // addition: a card without a holder name is sent with an empty name
    it('writes an empty holder name for a nameless card', () => {
      const nameless = CreditCardFactory.create('4155650100416111', '25', '01', '123')
      const actual = mapper.createNonSecurePaymentRequestData(KM, order(), TX_TYPE.PAY_AUTH, nameless)
      expect(actual.CardHolderName).toBe('')
    })

    it('writes 1.15 as 115', () => {
      const o = order()
      o.amount = 1.15
      const actual = mapper.createNonSecurePaymentRequestData(KM, o, TX_TYPE.PAY_AUTH, card)
      expect(actual.Amount).toBe(115)
      expect(actual.DisplayAmount).toBe(115)
    })

    it.each([0, -1, 0.004, 'abc', 1e13, undefined])('rejects the amount %j', (amount) => {
      const o = order()
      o.amount = amount as never
      expect(() => mapper.createNonSecurePaymentRequestData(KM, o, TX_TYPE.PAY_AUTH, card)).toThrow(PosError)
    })

    it.each([1.5, 100])('rejects the installment %j', (installment) => {
      const o = order()
      o.installment = installment
      expect(() => mapper.createNonSecurePaymentRequestData(KM, o, TX_TYPE.PAY_AUTH, card)).toThrow(PosError)
    })

    it.each(['sipariş1', 'a b', '', 'x'.repeat(65)])('rejects the order id %j', (id) => {
      const o = order()
      o.id = id
      expect(() => mapper.createNonSecurePaymentRequestData(KM, o, TX_TYPE.PAY_AUTH, card)).toThrow(PosError)
    })

    // addition: only a sale is supported
    it.each([TX_TYPE.CANCEL, TX_TYPE.REFUND, TX_TYPE.STATUS, TX_TYPE.PAY_PRE_AUTH, TX_TYPE.PAY_POST_AUTH])(
      'rejects the transaction type %s',
      (txType) => {
        expect(() => mapper.createNonSecurePaymentRequestData(KM, order(), txType, card)).toThrow(PosError)
      },
    )

    it('does not mutate the order and has no undefined', () => {
      const o = order()
      const snapshot = structuredClone(o)
      expectNoUndefined(mapper.createNonSecurePaymentRequestData(KM, o, TX_TYPE.PAY_AUTH, card))
      expect(o).toStrictEqual(snapshot)
    })
  })

  describe('unsupported', () => {
    it('create3DFormData is not implemented', async () => {
      // deviation: B14 (error class)
      await expect(
        mapper.create3DFormData(KM, { id: '123' }, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'https://bank-gateway.com'),
      ).rejects.toThrow(NotImplementedError)
    })

    it('post-auth is not implemented', () => {
      expect(() => mapper.createNonSecurePostAuthPaymentRequestData(KM, {})).toThrow(NotImplementedError)
    })

    it('order history is not implemented', () => {
      expect(() => mapper.createOrderHistoryRequestData(KM, {})).toThrow(NotImplementedError)
    })
  })
})
