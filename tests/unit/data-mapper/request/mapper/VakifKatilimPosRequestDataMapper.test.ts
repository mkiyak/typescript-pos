import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KuveytPosCrypt } from '../../../../../src/crypt/KuveytPosCrypt.js'
import { VakifKatilimPosRequestDataMapper } from '../../../../../src/data-mapper/request/mapper/VakifKatilimPosRequestDataMapper.js'
import { VakifKatilimPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/VakifKatilimPosRequestValueFormatter.js'
import { VakifKatilimPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/VakifKatilimPosRequestValueMapper.js'
import { PosError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import { CURRENCY, LANG, MODEL, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'
import type { PosOrder, ThreeDFormData } from '../../../../../src/types.js'

const V = AccountFactory.createBoaPosAccount('vakif-katilim', '1', 'APIUSER', '11111', 'kdsnsksl')
const HP = 'h58bUB83xQz2/21SUeOemUgkF5U='
const card = CreditCardFactory.create('4155650100416111', '25', '01', '123', 'John Doe')
const HOST_URL = 'https://boa.vakifkatilim.com.tr/VirtualPOS.Gateway/CommonPaymentPage/CommonPaymentPage'

type CryptStub = Record<
  'hashString' | 'check3DHash' | 'create3DHash' | 'createHash' | 'hashFromParams' | 'generateRandomString',
  ReturnType<typeof vi.fn>
>

function makeCryptStub(hash: string): CryptStub {
  return {
    hashString: vi.fn().mockReturnValue(HP),
    check3DHash: vi.fn(),
    create3DHash: vi.fn(),
    createHash: vi.fn().mockReturnValue(hash),
    hashFromParams: vi.fn(),
    generateRandomString: vi.fn(),
  }
}

function makeMapper(crypt: unknown): VakifKatilimPosRequestDataMapper {
  return new VakifKatilimPosRequestDataMapper(
    new VakifKatilimPosRequestValueMapper(),
    new VakifKatilimPosRequestValueFormatter(),
    {},
    crypt as KuveytPosCrypt,
    LANG.EN,
  )
}

function sortKeys<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) as T
}

function withoutHash<T extends Record<string, unknown>>(value: T): Omit<T, 'HashData'> {
  const { HashData: _removed, ...rest } = value
  return rest
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

/** Exact value and exact key order (the rows that are not sorted before comparing). */
function expectOrdered(actual: Record<string, unknown>, expected: Record<string, unknown>): void {
  expect(actual).toStrictEqual(expected)
  expect(Object.keys(actual)).toStrictEqual(Object.keys(expected))
}

const API = VakifKatilimPosRequestDataMapper.API_VERSION

const accountPart = {
  MerchantId: '1',
  CustomerId: '11111',
  UserName: 'APIUSER',
  SubMerchantId: '0',
}

const nonSecureOrder = (): PosOrder => ({ id: '123', amount: 10.0, installment: 0, currency: CURRENCY.TRY })

const nonSecureExpected = {
  ...accountPart,
  APIVersion: '1.0.0',
  HashPassword: HP,
  MerchantOrderId: '123',
  InstallmentCount: '0',
  Amount: 1000,
  FECCurrencyCode: '0949',
  CurrencyCode: '0949',
  TransactionSecurity: '5',
  CardNumber: '4155650100416111',
  CardExpireDateYear: '25',
  CardExpireDateMonth: '01',
  CardCVV2: '123',
  CardHolderName: 'John Doe',
  HashData: 'AYOjSzXn6dgwiV3U0vXzNTWlO8g=',
}

const postAuthOrder = (): PosOrder => ({ id: '123', remote_order_id: 'remote-123', ip: '127.0.0.1' })

const postAuthExpected = {
  ...accountPart,
  HashPassword: HP,
  MerchantOrderId: '123',
  OrderId: 'remote-123',
  CustomerIPAddress: '127.0.0.1',
  HashData: 'K0LvOf07C/ayD53wWiykcUCZPc8=',
}

const formOrder = (): PosOrder => ({
  id: '2020110828BC',
  amount: 10.01,
  installment: '0' as never,
  currency: CURRENCY.TRY,
  success_url: 'http://localhost/finansbank-payfor/3d/success.php',
  fail_url: 'http://localhost/finansbank-payfor/3d/fail.php',
})

const formExpected = {
  APIVersion: API,
  MerchantId: '1',
  UserName: 'APIUSER',
  CustomerId: '11111',
  HashData: 'xAV9RXTP58Hy+8KYe1VgYDaZFqs=',
  TransactionSecurity: '3',
  InstallmentCount: '0',
  Amount: 1001,
  DisplayAmount: 1001,
  FECCurrencyCode: '0949',
  MerchantOrderId: '2020110828BC',
  OkUrl: 'http://localhost/finansbank-payfor/3d/success.php',
  FailUrl: 'http://localhost/finansbank-payfor/3d/fail.php',
  CardHolderName: 'John Doe',
  CardNumber: '4155650100416111',
  CardExpireDateYear: '25',
  CardExpireDateMonth: '01',
  CardCVV2: '123',
  SubMerchantId: '0',
  HashPassword: HP,
}

const cancelOrder = (extra: Partial<PosOrder> = {}): PosOrder => ({
  id: '2023070849CD',
  remote_order_id: '114293600',
  amount: 1.01,
  ...extra,
})

const cancelExpected = {
  CustomerId: '11111',
  Amount: 101,
  MerchantId: '1',
  OrderId: '114293600',
  UserName: 'APIUSER',
  SubMerchantId: '0',
  HashPassword: HP,
  MerchantOrderId: '2023070849CD',
  PaymentType: '1',
  HashData: '/fcrfEy2juD7L/aTujiLgtJg23M=',
}

const { Amount: _cancelAmount, ...cancelPreExpectedBody } = {
  ...cancelExpected,
  HashData: '2JEWD55cC2JtLJIxM8KDRz2f6hU=',
}
const cancelPreExpected = cancelPreExpectedBody

const refundExpected = {
  MerchantId: '1',
  CustomerId: '11111',
  UserName: 'APIUSER',
  SubMerchantId: '0',
  HashPassword: HP,
  MerchantOrderId: '2023070849CD',
  OrderId: '114293600',
  HashData: '2JEWD55cC2JtLJIxM8KDRz2f6hU=',
}

const statusExpected = {
  ...accountPart,
  MerchantOrderId: 'order-123',
  HashData: '4oNmzFPMeC/tOK8i/XCPNy4W+FU=',
}

const historyOrder = (): PosOrder => ({
  start_date: new Date('2024-03-30T00:00:00+03:00'),
  end_date: new Date('2024-03-31T00:00:00+03:00'),
  auth_code: '896626',
})

const historyExpected = {
  ...accountPart,
  StartDate: '2024-03-30',
  EndDate: '2024-03-31',
  LowerLimit: 0,
  UpperLimit: 100,
  ProvNumber: '896626',
  OrderStatus: null,
  TranResult: null,
  OrderNo: null,
  HashData: '58xhdJGlgIZtsid8cvSDlr8EItk=',
}

const provisionOrder = (): PosOrder => ({
  id: '2020110828BC',
  amount: 1,
  installment: '0' as never,
  currency: CURRENCY.TRY,
  success_url: 'http://localhost/finansbank-payfor/3d/response.php',
  fail_url: 'http://localhost/finansbank-payfor/3d/response.php',
})

const callback = (): Record<string, unknown> => ({
  MD: '67YtBfBRTZ0XBKnAHi8c/A==',
  OrderId: '86297530',
  MerchantOrderId: '2020110828BC',
  ResponseCode: '00',
  ResponseMessage: 'Kart doğrulandı.',
  HashData: 'ucejRvHjCbuPXagyoweFLnJfSJg=',
})

const provisionExpected = {
  APIVersion: API,
  HashData: 'sFxxO809/N3Yif4p/js1UKFMRro=',
  MerchantId: '1',
  CustomerId: '11111',
  UserName: 'APIUSER',
  InstallmentCount: '0',
  Amount: 100,
  MerchantOrderId: '2020110828BC',
  TransactionSecurity: '3',
  SubMerchantId: '0',
  OkUrl: 'http://localhost/finansbank-payfor/3d/response.php',
  FailUrl: 'http://localhost/finansbank-payfor/3d/response.php',
  AdditionalData: {
    AdditionalDataList: { VPosAdditionalData: { Key: 'MD', Data: '67YtBfBRTZ0XBKnAHi8c/A==' } },
  },
}

const hostOrder = (): PosOrder => ({
  id: 'order222',
  amount: '100.25' as never,
  currency: CURRENCY.TRY,
  success_url: 'https://domain.com/success',
  fail_url: 'https://domain.com/fail_url',
})

const hostExpected = {
  gateway: HOST_URL,
  method: 'POST',
  inputs: {
    UserName: 'APIUSER',
    HashPassword: HP,
    MerchantId: '1',
    MerchantOrderId: 'order222',
    Amount: '10025',
    FECCurrencyCode: '0949',
    OkUrl: 'https://domain.com/success',
    FailUrl: 'https://domain.com/fail_url',
    PaymentType: '1',
  },
}

describe('VakifKatilimPosRequestDataMapper', () => {
  let crypt: CryptStub
  let mapper: VakifKatilimPosRequestDataMapper

  beforeEach(() => {
    crypt = makeCryptStub('request-hash')
    mapper = makeMapper(crypt)
  })

  /** The first signed data, which must be exactly what is sent (without the hash). */
  const signed = (): Record<string, unknown> =>
    (crypt.createHash.mock.calls[0] as unknown[])[1] as Record<string, unknown>

  const useHash = (hash: string): void => {
    crypt.createHash.mockReturnValue(hash)
  }

  it('supports only VakifKatilimPos', () => {
    expect(VakifKatilimPosRequestDataMapper.supports('VakifKatilimPos')).toBe(true)
    expect(VakifKatilimPosRequestDataMapper.supports('AssecoPos')).toBe(false)
    expect(VakifKatilimPosRequestDataMapper.supports('KuveytPos')).toBe(false)
  })

  describe('create3DFormData', () => {
    it('builds the 3D Host form', async () => {
      const actual = await mapper.create3DFormData(V, hostOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, HOST_URL)

      expect(actual).toStrictEqual(hostExpected)
      expect(crypt.hashString).toHaveBeenCalledTimes(1)
      expect(crypt.hashString).toHaveBeenCalledWith('kdsnsksl')
      expect(crypt.createHash).not.toHaveBeenCalled()
      expectNoUndefined(actual)
    })

    // deviation: B14 (error class)
    it('refuses every model but 3D Host', async () => {
      await expect(
        mapper.create3DFormData(V, hostOrder(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, HOST_URL),
      ).rejects.toThrow(PosError)
      expect(crypt.hashString).not.toHaveBeenCalled()
    })

    // addition: the form is posted by the browser; no card data ever goes into it
    it('never contains card keys, even when a card is passed', async () => {
      const actual = (await mapper.create3DFormData(
        V,
        hostOrder(),
        MODEL.THREE_D_HOST,
        TX_TYPE.PAY_AUTH,
        HOST_URL,
        card,
      )) as ThreeDFormData
      const keys = Object.keys(actual.inputs)
      expect(keys.filter((key) => key.startsWith('Card'))).toStrictEqual([])
      expect(JSON.stringify(actual)).not.toContain('4155650100416111')
    })

    // addition: B6 (exact kuruş)
    it('sends the exact kuruş of 1.15', async () => {
      const actual = (await mapper.create3DFormData(
        V,
        { ...hostOrder(), amount: 1.15 },
        MODEL.THREE_D_HOST,
        TX_TYPE.PAY_AUTH,
        HOST_URL,
      )) as ThreeDFormData
      expect(actual.inputs.Amount).toBe('115')
    })

    // addition: only a sale can be paid on the bank's page
    it.each([TX_TYPE.PAY_PRE_AUTH, TX_TYPE.PAY_POST_AUTH, TX_TYPE.REFUND, TX_TYPE.CANCEL])(
      'refuses the transaction type %s',
      async (txType) => {
        await expect(mapper.create3DFormData(V, hostOrder(), MODEL.THREE_D_HOST, txType, HOST_URL)).rejects.toThrow(
          PosError,
        )
        expect(crypt.hashString).not.toHaveBeenCalled()
      },
    )

    // addition: order rules
    it.each([
      ['a missing id', { id: undefined }],
      ['an id with a slash', { id: 'a/b' }],
      ['an id of 65 characters', { id: 'a'.repeat(65) }],
      ['an object id', { id: {} as never }],
      ['a missing amount', { amount: undefined }],
      ['a zero amount', { amount: 0 }],
      ['a negative amount', { amount: -1 }],
      ['an exponent amount', { amount: '1e2' as never }],
      ['an unknown currency', { currency: 'XXX' as never }],
      ['a missing success url', { success_url: undefined }],
      ['a success url with a space', { success_url: 'https://a.com/x y' }],
      ['a javascript url', { fail_url: 'javascript:alert(1)' }],
      ['a non-ASCII url', { fail_url: 'https://a.com/ş' }],
    ])('refuses %s', async (_name, patch) => {
      const order = { ...hostOrder(), ...patch } as PosOrder
      await expect(mapper.create3DFormData(V, order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, HOST_URL)).rejects.toThrow(
        PosError,
      )
    })

    // addition: the gateway url is the bank page the browser posts to
    it.each(['', 'http://boa.example.com/x', 'ftp://x', undefined])('refuses the gateway url %j', async (url) => {
      await expect(
        mapper.create3DFormData(V, hostOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, url as never),
      ).rejects.toThrow(PosError)
    })

    // addition: numeric order ids
    it('accepts a numeric order id', async () => {
      const actual = (await mapper.create3DFormData(
        V,
        { ...hostOrder(), id: 12345 as never },
        MODEL.THREE_D_HOST,
        TX_TYPE.PAY_AUTH,
        HOST_URL,
      )) as ThreeDFormData
      expect(actual.inputs.MerchantOrderId).toBe('12345')
    })

    // addition: the caller's object is not touched
    it('does not mutate the order', async () => {
      const order = Object.freeze(hostOrder())
      await mapper.create3DFormData(V, order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, HOST_URL)
      expect(order).toStrictEqual(hostOrder())
    })
  })

  describe('createNonSecurePaymentRequestData', () => {
    it('builds the sale (key order exact)', () => {
      useHash(nonSecureExpected.HashData)
      const actual = mapper.createNonSecurePaymentRequestData(V, nonSecureOrder(), TX_TYPE.PAY_AUTH, card)

      expectOrdered(actual, nonSecureExpected)
      expect(crypt.hashString).toHaveBeenCalledTimes(1)
      expect(crypt.hashString).toHaveBeenCalledWith('kdsnsksl')
      expect(crypt.createHash).toHaveBeenCalledTimes(1)
      expect(crypt.createHash).toHaveBeenCalledWith(V, withoutHash(nonSecureExpected))
      expectNoUndefined(actual)
    })

    it('sends the installment count', () => {
      useHash(nonSecureExpected.HashData)
      const actual = mapper.createNonSecurePaymentRequestData(
        V,
        { ...nonSecureOrder(), installment: 3 },
        TX_TYPE.PAY_AUTH,
        card,
      )
      expectOrdered(actual, { ...nonSecureExpected, InstallmentCount: '3' })
    })

    // addition: the hash covers exactly what is sent
    it('signs exactly the data it returns', () => {
      const actual = mapper.createNonSecurePaymentRequestData(V, nonSecureOrder(), TX_TYPE.PAY_AUTH, card)
      expect({ ...signed(), HashData: actual.HashData }).toStrictEqual(actual)
    })

    // addition: B6
    it('sends the exact kuruş of 1.15', () => {
      const actual = mapper.createNonSecurePaymentRequestData(
        V,
        { ...nonSecureOrder(), amount: 1.15 },
        TX_TYPE.PAY_AUTH,
        card,
      )
      expect(actual.Amount).toBe(115)
    })

    // addition: pre-auth is a sale body with another path
    it('accepts a pre-authorization', () => {
      const actual = mapper.createNonSecurePaymentRequestData(V, nonSecureOrder(), TX_TYPE.PAY_PRE_AUTH, card)
      expect(actual.TransactionSecurity).toBe('5')
    })

    // addition: tx type guard
    it.each([TX_TYPE.PAY_POST_AUTH, TX_TYPE.CANCEL, TX_TYPE.REFUND, TX_TYPE.STATUS])(
      'refuses the transaction type %s',
      (txType) => {
        expect(() => mapper.createNonSecurePaymentRequestData(V, nonSecureOrder(), txType, card)).toThrow(
          UnsupportedTransactionTypeError,
        )
        expect(crypt.hashString).not.toHaveBeenCalled()
      },
    )

    // addition: sub merchant
    it('sends the sub merchant of the account', () => {
      const sub = AccountFactory.createBoaPosAccount('vakif-katilim', '1', 'APIUSER', '11111', 'kdsnsksl', 'SUB1')
      const actual = mapper.createNonSecurePaymentRequestData(sub, nonSecureOrder(), TX_TYPE.PAY_AUTH, card)
      expect(actual.SubMerchantId).toBe('SUB1')
    })

    // addition: a card without a holder name
    it('sends an empty holder name rather than "null"', () => {
      const anonymous = CreditCardFactory.create('4155650100416111', '25', '01', '123')
      const actual = mapper.createNonSecurePaymentRequestData(V, nonSecureOrder(), TX_TYPE.PAY_AUTH, anonymous)
      expect(actual.CardHolderName).toBe('')
    })

    // addition: strict installment
    it.each([-1, 1.5, 100, '1e1', 'abc', '', ' 1', '0x2', Number.NaN, {}, []])(
      'refuses the installment %j',
      (value) => {
        const order = { ...nonSecureOrder(), installment: value as never }
        expect(() => mapper.createNonSecurePaymentRequestData(V, order, TX_TYPE.PAY_AUTH, card)).toThrow(PosError)
      },
    )

    // addition: order rules
    it.each([
      ['a missing id', { id: undefined }],
      ['a null id', { id: null as never }],
      ['an empty id', { id: '' }],
      ['an array id', { id: ['1'] as never }],
      ['a boolean id', { id: true as never }],
      ['an id with a quote', { id: 'a"b' }],
      ['an infinite numeric id', { id: Number.POSITIVE_INFINITY }],
      ['a missing amount', { amount: undefined }],
      ['a NaN amount', { amount: Number.NaN }],
      ['an amount below one kuruş', { amount: 0.004 }],
      ['an amount of 1e13', { amount: 1e13 }],
      ['a hex amount', { amount: '0x10' as never }],
      ['an unknown currency', { currency: 'XXX' as never }],
    ])('refuses %s', (_name, patch) => {
      const order = { ...nonSecureOrder(), ...patch } as PosOrder
      expect(() => mapper.createNonSecurePaymentRequestData(V, order, TX_TYPE.PAY_AUTH, card)).toThrow(PosError)
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    // addition: defaults
    it('defaults the currency to TRY and the installment to none', () => {
      const actual = mapper.createNonSecurePaymentRequestData(V, { id: '1', amount: 1 }, TX_TYPE.PAY_AUTH, card)
      expect(actual.FECCurrencyCode).toBe('0949')
      expect(actual.InstallmentCount).toBe('0')
    })

    // addition: the caller's object is not touched
    it('does not mutate the order', () => {
      const order = Object.freeze({ id: '1', amount: 1 })
      mapper.createNonSecurePaymentRequestData(V, order, TX_TYPE.PAY_AUTH, card)
      expect(order).toStrictEqual({ id: '1', amount: 1 })
    })
  })

  describe('createNonSecurePostAuthPaymentRequestData', () => {
    it('builds the close request (key order exact)', () => {
      useHash(postAuthExpected.HashData)
      const actual = mapper.createNonSecurePostAuthPaymentRequestData(V, postAuthOrder())

      expectOrdered(actual, postAuthExpected)
      expect(crypt.hashString).toHaveBeenCalledWith('kdsnsksl')
      expect(crypt.createHash).toHaveBeenCalledWith(V, withoutHash(postAuthExpected))
      expectNoUndefined(actual)
    })

    // addition: required fields
    it.each([
      ['id', { id: undefined }],
      ['remote_order_id', { remote_order_id: undefined }],
      ['ip', { ip: undefined }],
      ['ip as a number', { ip: 1 as never }],
      ['remote_order_id with a space', { remote_order_id: 'a b' }],
      ['remote_order_id as an object', { remote_order_id: {} as never }],
    ])('refuses a missing or malformed %s', (_name, patch) => {
      expect(() => mapper.createNonSecurePostAuthPaymentRequestData(V, { ...postAuthOrder(), ...patch })).toThrow(
        PosError,
      )
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    // addition: the bank order id may be a number
    it('accepts a numeric bank order id', () => {
      const actual = mapper.createNonSecurePostAuthPaymentRequestData(V, {
        ...postAuthOrder(),
        remote_order_id: 114293600 as never,
      })
      expect(actual.OrderId).toBe('114293600')
    })
  })

  describe('createStatusRequestData', () => {
    it('builds the status request (key order exact)', () => {
      useHash(statusExpected.HashData)
      const actual = mapper.createStatusRequestData(V, { id: 'order-123' })

      expectOrdered(actual, statusExpected)
      expect(crypt.createHash).toHaveBeenCalledWith(V, withoutHash(statusExpected))
      expect(crypt.hashString).not.toHaveBeenCalled()
    })

    // addition: required id
    it.each([undefined, '', 'a b', {}, []])('refuses the id %j', (id) => {
      expect(() => mapper.createStatusRequestData(V, { id: id as never })).toThrow(PosError)
    })

    // addition: the request has no bank order id; stray values are not sent
    it('ignores a bank order id', () => {
      const actual = mapper.createStatusRequestData(V, { id: 'order-123', remote_order_id: 0 as never })
      expect(Object.keys(actual)).toStrictEqual(Object.keys(statusExpected))
    })
  })

  describe('createOrderHistoryRequestData', () => {
    it('builds the history request (key order exact)', () => {
      useHash(historyExpected.HashData)
      const actual = mapper.createOrderHistoryRequestData(V, historyOrder())

      expectOrdered(actual, historyExpected)
      expect(crypt.createHash).toHaveBeenCalledWith(V, withoutHash(historyExpected))
    })

    // addition: the auth code is a filter
    it('sends null when there is no auth code', () => {
      const { auth_code: _removed, ...order } = historyOrder()
      const actual = mapper.createOrderHistoryRequestData(V, order)
      expect(actual.ProvNumber).toBeNull()
      expect(Object.keys(actual)).toStrictEqual(Object.keys(historyExpected))
    })

    // addition: required dates
    it.each([
      ['no start date', { start_date: undefined }],
      ['no end date', { end_date: undefined }],
      ['a text start date', { start_date: '2024-01-01' as never }],
      ['an invalid end date', { end_date: new Date('x') }],
      ['a numeric end date', { end_date: 1711800000000 as never }],
      ['an object auth code', { auth_code: {} as never }],
    ])('refuses %s', (_name, patch) => {
      expect(() => mapper.createOrderHistoryRequestData(V, { ...historyOrder(), ...patch })).toThrow(PosError)
    })

    // addition: B13 (days are Türkiye days)
    it('formats the dates as Türkiye days', () => {
      const actual = mapper.createOrderHistoryRequestData(V, {
        start_date: new Date('2024-03-29T21:30:00Z'),
        end_date: new Date('2024-03-30T20:59:00Z'),
      })
      expect(actual.StartDate).toBe('2024-03-30')
      expect(actual.EndDate).toBe('2024-03-30')
    })

    // addition: a numeric auth code is text
    it('sends a numeric auth code as text', () => {
      const actual = mapper.createOrderHistoryRequestData(V, { ...historyOrder(), auth_code: 896626 as never })
      expect(actual.ProvNumber).toBe('896626')
    })
  })

  describe('create3DFormInitializeRequestData', () => {
    it('builds the enrollment request', () => {
      useHash(formExpected.HashData)
      const actual = mapper.create3DFormInitializeRequestData(
        V,
        formOrder(),
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        card,
      )

      expect(sortKeys(actual)).toStrictEqual(sortKeys(formExpected))
      expect(crypt.hashString).toHaveBeenCalledTimes(1)
      expect(crypt.hashString).toHaveBeenCalledWith('kdsnsksl')
      expect(crypt.createHash).toHaveBeenCalledWith(V, withoutHash(formExpected))
      expectNoUndefined(actual)
    })

    // addition: only the 3D Secure model starts on the server
    it.each([MODEL.NON_SECURE, MODEL.THREE_D_HOST, MODEL.THREE_D_PAY])('refuses the model %s', (model) => {
      expect(() => mapper.create3DFormInitializeRequestData(V, formOrder(), model, TX_TYPE.PAY_AUTH, card)).toThrow(
        PosError,
      )
    })

    // addition: tx type guard
    it.each([TX_TYPE.PAY_PRE_AUTH, TX_TYPE.CANCEL, TX_TYPE.REFUND])('refuses the transaction type %s', (txType) => {
      expect(() =>
        mapper.create3DFormInitializeRequestData(V, formOrder(), MODEL.THREE_D_SECURE, txType, card),
      ).toThrow(UnsupportedTransactionTypeError)
    })

    // addition: B6 and the return urls
    it('sends the exact kuruş of 1.15 as numbers', () => {
      const actual = mapper.create3DFormInitializeRequestData(
        V,
        { ...formOrder(), amount: 1.15 },
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        card,
      )
      expect(actual.Amount).toBe(115)
      expect(actual.DisplayAmount).toBe(115)
    })

    // addition: without a card there are no card keys
    it('leaves the card keys out without a card', () => {
      const actual = mapper.create3DFormInitializeRequestData(V, formOrder(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH)
      expect(Object.keys(actual).filter((key) => key.startsWith('Card'))).toStrictEqual([])
    })

    // addition: order rules
    it.each([
      ['a missing success url', { success_url: undefined }],
      ['a missing fail url', { fail_url: undefined }],
      ['a url with a space', { fail_url: 'http://a.com/a b' }],
      ['a non-http url', { success_url: 'ftp://a.com/' }],
      ['a url object', { success_url: {} as never }],
      ['a missing id', { id: undefined }],
      ['a bad id', { id: '1;2' }],
      ['a missing amount', { amount: undefined }],
      ['a bad installment', { installment: 'x' as never }],
    ])('refuses %s', (_name, patch) => {
      expect(() =>
        mapper.create3DFormInitializeRequestData(
          V,
          { ...formOrder(), ...patch } as PosOrder,
          MODEL.THREE_D_SECURE,
          TX_TYPE.PAY_AUTH,
          card,
        ),
      ).toThrow(PosError)
    })

    // addition: the caller's object is not touched
    it('does not mutate the order', () => {
      const order = Object.freeze(formOrder())
      mapper.create3DFormInitializeRequestData(V, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
      expect(order).toStrictEqual(formOrder())
    })
  })

  describe('createCancelRequestData', () => {
    it.each([
      ['no transaction type', cancelOrder(), cancelExpected],
      ['a sale', cancelOrder({ transaction_type: TX_TYPE.PAY_AUTH }), cancelExpected],
      ['a pre-authorization (no amount)', cancelOrder({ transaction_type: TX_TYPE.PAY_PRE_AUTH }), cancelPreExpected],
    ])('builds the cancel request for %s', (_name, order, expected) => {
      useHash(expected.HashData)
      const actual = mapper.createCancelRequestData(V, order)

      expect(sortKeys(actual)).toStrictEqual(sortKeys(expected))
      expect(crypt.hashString).toHaveBeenCalledWith('kdsnsksl')
      expect(crypt.createHash).toHaveBeenCalledWith(V, withoutHash(expected))
      expectNoUndefined(actual)
    })

    // addition: the cancel path exists only for sales and pre-authorizations
    it.each([TX_TYPE.PAY_POST_AUTH, TX_TYPE.REFUND, TX_TYPE.CANCEL, 'x'])(
      'refuses the order transaction type %s',
      (type) => {
        expect(() => mapper.createCancelRequestData(V, cancelOrder({ transaction_type: type as TxType }))).toThrow(
          PosError,
        )
        expect(crypt.createHash).not.toHaveBeenCalled()
      },
    )

    // addition: required fields
    it.each([
      ['amount (not a pre-authorization)', { amount: undefined }],
      ['remote_order_id', { remote_order_id: undefined }],
      ['id', { id: undefined }],
      ['a zero amount', { amount: 0 }],
      ['an exponent amount', { amount: '1e2' as never }],
    ])('refuses a missing or malformed %s', (_name, patch) => {
      expect(() => mapper.createCancelRequestData(V, { ...cancelOrder(), ...patch })).toThrow(PosError)
    })

    // addition: a pre-authorization cancel needs no amount, and an amount given is not sent
    it('does not send an amount for a pre-authorization even when given', () => {
      const actual = mapper.createCancelRequestData(V, cancelOrder({ transaction_type: TX_TYPE.PAY_PRE_AUTH }))
      expect('Amount' in actual).toBe(false)
      const noAmount = mapper.createCancelRequestData(V, {
        id: '2023070849CD',
        remote_order_id: '114293600',
        transaction_type: TX_TYPE.PAY_PRE_AUTH,
      })
      expect('Amount' in noAmount).toBe(false)
    })

    // addition: B6
    it('sends the exact kuruş of 1.15', () => {
      const actual = mapper.createCancelRequestData(V, cancelOrder({ amount: 1.15 }))
      expect(actual.Amount).toBe(115)
    })

    // addition: the caller's object is not touched
    it('does not mutate the order', () => {
      const order = Object.freeze(cancelOrder())
      mapper.createCancelRequestData(V, order)
      expect(order).toStrictEqual(cancelOrder())
    })
  })

  describe('createRefundRequestData', () => {
    it('builds the refund request (no amount)', () => {
      useHash(refundExpected.HashData)
      const actual = mapper.createRefundRequestData(V, cancelOrder(), TX_TYPE.REFUND)

      expect(sortKeys(actual)).toStrictEqual(sortKeys(refundExpected))
      expect(crypt.hashString).toHaveBeenCalledWith('kdsnsksl')
      expect(crypt.createHash).toHaveBeenCalledWith(V, withoutHash(refundExpected))
      expect('Amount' in actual).toBe(false)
    })

    // addition: the bank request carries no amount, so a partial refund cannot be expressed
    it('refuses a partial refund', () => {
      expect(() => mapper.createRefundRequestData(V, cancelOrder(), TX_TYPE.REFUND_PARTIAL)).toThrow(
        UnsupportedTransactionTypeError,
      )
      expect(crypt.hashString).not.toHaveBeenCalled()
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    // addition: a refund request never becomes another operation
    it.each([TX_TYPE.PAY_AUTH, TX_TYPE.CANCEL, TX_TYPE.STATUS, TX_TYPE.PAY_POST_AUTH])(
      'refuses the refund transaction type %s',
      (txType) => {
        expect(() => mapper.createRefundRequestData(V, cancelOrder(), txType)).toThrow(UnsupportedTransactionTypeError)
      },
    )

    // addition: a refund needs no amount
    it('needs no amount', () => {
      const actual = mapper.createRefundRequestData(
        V,
        { id: '2023070849CD', remote_order_id: '114293600' },
        TX_TYPE.REFUND,
      )
      expect(actual.OrderId).toBe('114293600')
    })

    // addition: the refund path exists only for sales and pre-authorizations
    it.each([TX_TYPE.PAY_POST_AUTH, TX_TYPE.REFUND, 'x'])('refuses the order transaction type %s', (type) => {
      expect(() =>
        mapper.createRefundRequestData(V, cancelOrder({ transaction_type: type as TxType }), TX_TYPE.REFUND),
      ).toThrow(PosError)
    })

    // addition: required fields
    it.each([
      ['id', { id: undefined }],
      ['remote_order_id', { remote_order_id: undefined }],
      ['a bank order id with a space', { remote_order_id: '1 2' }],
    ])('refuses a missing or malformed %s', (_name, patch) => {
      expect(() => mapper.createRefundRequestData(V, { ...cancelOrder(), ...patch }, TX_TYPE.REFUND)).toThrow(PosError)
    })
  })

  describe('create3DPaymentRequestData', () => {
    it('builds the provision from the order and the callback session value', () => {
      useHash(provisionExpected.HashData)
      const actual = mapper.create3DPaymentRequestData(V, provisionOrder(), TX_TYPE.PAY_AUTH, callback())

      expect(sortKeys(actual)).toStrictEqual(sortKeys(provisionExpected))
      expect(crypt.createHash).toHaveBeenCalledTimes(1)
      // deviation: the reference signs the callback's order id; here it is the order's
      expect(crypt.createHash).toHaveBeenCalledWith(V, { ...provisionExpected, HashData: '' })
      expectNoUndefined(actual)
    })

    // addition: money values come from the order, never from the unsigned callback
    it('ignores amount, currency, installment and order id echoed by the callback', () => {
      const hostile = {
        ...callback(),
        MerchantOrderId: 'OTHER',
        Amount: '1',
        CurrencyCode: '0840',
        InstallmentCount: '12',
        VPosMessage: { Amount: '1', CurrencyCode: '0840', InstallmentCount: '12', MerchantOrderId: 'OTHER' },
      }
      const actual = mapper.create3DPaymentRequestData(V, provisionOrder(), TX_TYPE.PAY_AUTH, hostile)
      expect(actual.Amount).toBe(100)
      expect(actual.MerchantOrderId).toBe('2020110828BC')
      expect(actual.InstallmentCount).toBe('0')
      expect(JSON.stringify(actual)).not.toContain('OTHER')
    })

    // addition: B6
    it('sends the exact kuruş of 1.15', () => {
      const actual = mapper.create3DPaymentRequestData(
        V,
        { ...provisionOrder(), amount: 1.15 },
        TX_TYPE.PAY_AUTH,
        callback(),
      )
      expect(actual.Amount).toBe(115)
    })

    // addition: the installment of the order
    it('sends the installment of the order', () => {
      const actual = mapper.create3DPaymentRequestData(
        V,
        { ...provisionOrder(), installment: 6 },
        TX_TYPE.PAY_AUTH,
        callback(),
      )
      expect(actual.InstallmentCount).toBe('6')
    })

    // addition: the session value is checked as an own string before any pattern
    it.each([
      ['missing', undefined],
      ['null', null],
      ['empty', ''],
      ['an array', ['AAAA']],
      ['an object', { a: 1 }],
      ['a number', 12345],
      ['a boolean', true],
      ['with a space', 'AAAA BBBB'],
      ['with a tag', '<x/>'],
      ['too long', 'A'.repeat(1025)],
      ['with a newline', 'AAAA\n'],
    ])('refuses an MD that is %s', (_name, md) => {
      const data = { ...callback(), MD: md }
      if (md === undefined) delete (data as Record<string, unknown>).MD
      expect(() => mapper.create3DPaymentRequestData(V, provisionOrder(), TX_TYPE.PAY_AUTH, data)).toThrow(PosError)
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    // addition: an inherited MD is not the callback's
    it('refuses an inherited MD', () => {
      const data = Object.create({ MD: 'AAAA' }) as Record<string, unknown>
      expect(() => mapper.create3DPaymentRequestData(V, provisionOrder(), TX_TYPE.PAY_AUTH, data)).toThrow(PosError)
    })

    // addition: an MD of 1024 characters is the longest accepted
    it('accepts an MD of 1024 characters', () => {
      const actual = mapper.create3DPaymentRequestData(V, provisionOrder(), TX_TYPE.PAY_AUTH, {
        ...callback(),
        MD: 'A'.repeat(1024),
      })
      expect(JSON.stringify(actual)).toContain('A'.repeat(1024))
    })

    // addition: tx type guard
    it.each([TX_TYPE.PAY_PRE_AUTH, TX_TYPE.CANCEL, TX_TYPE.REFUND])('refuses the transaction type %s', (txType) => {
      expect(() => mapper.create3DPaymentRequestData(V, provisionOrder(), txType, callback())).toThrow(
        UnsupportedTransactionTypeError,
      )
    })

    // addition: return urls come from the order and are signed as text
    it.each([
      ['a missing success url', { success_url: undefined }],
      ['a missing fail url', { fail_url: undefined }],
      ['a url with a newline', { success_url: 'http://a.com/\nx' }],
      ['a missing amount', { amount: undefined }],
      ['a missing id', { id: undefined }],
      ['a bad installment', { installment: -1 as never }],
    ])('refuses %s', (_name, patch) => {
      expect(() =>
        mapper.create3DPaymentRequestData(
          V,
          { ...provisionOrder(), ...patch } as PosOrder,
          TX_TYPE.PAY_AUTH,
          callback(),
        ),
      ).toThrow(PosError)
    })

    // addition: the caller's objects are not touched
    it('does not mutate the order or the callback', () => {
      const order = Object.freeze(provisionOrder())
      const data = Object.freeze(callback())
      mapper.create3DPaymentRequestData(V, order, TX_TYPE.PAY_AUTH, data)
      expect(order).toStrictEqual(provisionOrder())
      expect(data).toStrictEqual(callback())
    })
  })

  // addition: RV3 (the real crypt reproduces every expected signature of the reference rows)
  describe('with the real crypt', () => {
    let real: VakifKatilimPosRequestDataMapper

    beforeEach(() => {
      real = makeMapper(new KuveytPosCrypt())
    })

    it('non-secure sale', () => {
      expectOrdered(
        real.createNonSecurePaymentRequestData(V, nonSecureOrder(), TX_TYPE.PAY_AUTH, card),
        nonSecureExpected,
      )
    })

    it('post-auth', () => {
      expectOrdered(real.createNonSecurePostAuthPaymentRequestData(V, postAuthOrder()), postAuthExpected)
    })

    it('status', () => {
      expectOrdered(real.createStatusRequestData(V, { id: 'order-123' }), statusExpected)
    })

    it('order history', () => {
      expectOrdered(real.createOrderHistoryRequestData(V, historyOrder()), historyExpected)
    })

    it('enrollment', () => {
      const actual = real.create3DFormInitializeRequestData(
        V,
        formOrder(),
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        card,
      )
      expect(sortKeys(actual)).toStrictEqual(sortKeys(formExpected))
    })

    it.each([
      ['no transaction type', cancelOrder(), cancelExpected],
      ['a sale', cancelOrder({ transaction_type: TX_TYPE.PAY_AUTH }), cancelExpected],
      ['a pre-authorization', cancelOrder({ transaction_type: TX_TYPE.PAY_PRE_AUTH }), cancelPreExpected],
    ])('cancel of %s', (_name, order, expected) => {
      expect(sortKeys(real.createCancelRequestData(V, order))).toStrictEqual(sortKeys(expected))
    })

    it('refund', () => {
      expect(sortKeys(real.createRefundRequestData(V, cancelOrder(), TX_TYPE.REFUND))).toStrictEqual(
        sortKeys(refundExpected),
      )
    })

    it('provision', () => {
      const actual = real.create3DPaymentRequestData(V, provisionOrder(), TX_TYPE.PAY_AUTH, callback())
      expect(sortKeys(actual)).toStrictEqual(sortKeys(provisionExpected))
    })
  })
})
