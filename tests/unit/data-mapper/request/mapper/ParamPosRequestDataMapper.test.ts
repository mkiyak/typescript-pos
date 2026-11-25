import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ParamPosCrypt } from '../../../../../src/crypt/ParamPosCrypt.js'
import { ParamPosRequestDataMapper } from '../../../../../src/data-mapper/request/mapper/ParamPosRequestDataMapper.js'
import { ParamPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/ParamPosRequestValueFormatter.js'
import { ParamPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/ParamPosRequestValueMapper.js'
import {
  NotImplementedError,
  PosError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import {
  CARD_TYPE,
  CURRENCY,
  LANG,
  MODEL,
  type PaymentModel,
  TX_TYPE,
  type TxType,
} from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'

type Data = Record<string, unknown>

const G = '0c13d406-873b-403b-9c09-a5766840d98c'
const PA = AccountFactory.createParamPosAccount('param-pos', '10738', 'Test1', 'Test2', G)
const card = CreditCardFactory.create('5555444433332222', '22', '01', '123', 'ahmet', CARD_TYPE.VISA)

const RH5 = 'y2xdHtlV4Hk8QMKE9XDSR/vz6VI='
const RH6 = 'evC6uS/X/6IMUR/QU9c7jpZi8Jg='

const account = { G: { CLIENT_CODE: '10738', CLIENT_USERNAME: 'Test1', CLIENT_PASSWORD: 'Test2' }, GUID: G }
const XMLNS = 'https://turkpos.com.tr/'

const cardFields = {
  KK_Sahibi: 'ahmet',
  KK_No: '5555444433332222',
  KK_SK_Ay: '01',
  KK_SK_Yil: '2022',
  KK_CVC: '123',
  KK_Sahibi_GSM: '',
}

const order3d = (extra: Data = {}): PosOrder => ({
  id: 'order222',
  amount: 1000.25,
  installment: 0,
  currency: CURRENCY.TRY,
  ip: '127.0.0.1',
  success_url: 'https://domain.com/success',
  fail_url: 'https://domain.com/fail',
  ...extra,
})

const orderNs = (extra: Data = {}): PosOrder => ({
  id: 'order222',
  amount: 100.25,
  installment: 0,
  ip: '127.0.0.1',
  currency: CURRENCY.TRY,
  success_url: 'https://domain.com/success',
  ...extra,
})

/** The expected registration body, in the order the bank documents. */
function registerBody(parts: {
  secure: '3D' | 'NS'
  id?: string
  amount: string
  taksit?: string
  urls?: boolean
  doviz?: string
  hash: string
  islemId: string
}): Data {
  return {
    ...account,
    '@xmlns': XMLNS,
    Islem_Guvenlik_Tip: parts.secure,
    Islem_ID: parts.islemId,
    IPAdr: '127.0.0.1',
    Siparis_ID: parts.id ?? 'order222',
    Islem_Tutar: parts.amount,
    Toplam_Tutar: parts.amount,
    ...(parts.urls === false
      ? {}
      : { Basarili_URL: 'https://domain.com/success', Hata_URL: 'https://domain.com/fail' }),
    Taksit: parts.taksit ?? '1',
    ...cardFields,
    ...(parts.doviz === undefined ? {} : { Doviz_Kodu: parts.doviz }),
    Islem_Hash: parts.hash,
  }
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

type Stub = {
  generateRandomString: ReturnType<typeof vi.fn>
  createHash: ReturnType<typeof vi.fn>
  create3DHash: ReturnType<typeof vi.fn>
}

function makeMapper(crypt: unknown): ParamPosRequestDataMapper {
  return new ParamPosRequestDataMapper(
    new ParamPosRequestValueMapper(),
    new ParamPosRequestValueFormatter(),
    {},
    crypt as ParamPosCrypt,
    LANG.EN,
  )
}

describe('ParamPosRequestDataMapper', () => {
  let crypt: Stub
  let mapper: ParamPosRequestDataMapper

  beforeEach(() => {
    crypt = { generateRandomString: vi.fn(), createHash: vi.fn(), create3DHash: vi.fn() }
    mapper = makeMapper(crypt)
  })

  it('supports only ParamPos', () => {
    expect(ParamPosRequestDataMapper.supports('ParamPos')).toBe(true)
    expect(ParamPosRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  describe('create3DFormInitializeRequestData', () => {
    const rows: Array<[string, PosOrder, PaymentModel, TxType, string, Data]> = [
      [
        '3d secure TRY',
        order3d(),
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        'TP_WMD_UCD',
        registerBody({ secure: '3D', amount: '1000,25', hash: 'jsLYSB3lJ81leFgDLw4D8PbXURs=', islemId: 'rand' }),
      ],
      [
        '3d secure foreign currency',
        order3d({ currency: CURRENCY.USD }),
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        'TP_Islem_Odeme_WD',
        registerBody({
          secure: '3D',
          amount: '1000,25',
          doviz: '1001',
          hash: 'LFZ+Sl0mW+ybGvLr1u0ehZoxhxM=',
          islemId: '3344914AAB82284E39742F4C',
        }),
      ],
      [
        '3d secure pre-auth',
        order3d(),
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_PRE_AUTH,
        'TP_Islem_Odeme_OnProv_WMD',
        registerBody({
          secure: '3D',
          amount: '1000,25',
          hash: 'LFZ+Sl0mW+ybGvLr1u0ehZoxhxM=',
          islemId: '3344914AAB82284E39742F4C',
        }),
      ],
      [
        '3d pay',
        order3d(),
        MODEL.THREE_D_PAY,
        TX_TYPE.PAY_AUTH,
        'Pos_Odeme',
        registerBody({
          secure: '3D',
          amount: '1000,25',
          hash: 'LFZ+Sl0mW+ybGvLr1u0ehZoxhxM=',
          islemId: '3344914AAB82284E39742F4C',
        }),
      ],
      [
        '3d pay installment',
        order3d({ installment: 2 }),
        MODEL.THREE_D_PAY,
        TX_TYPE.PAY_AUTH,
        'Pos_Odeme',
        registerBody({
          secure: '3D',
          amount: '1000,25',
          taksit: '2',
          hash: 'LFZ+Sl0mW+ybGvLr1u0ehZoxhxM=',
          islemId: '3344914AAB82284E39742F4C',
        }),
      ],
    ]

    it.each(rows)('%s', (_name, order, model, txType, action, expectedBody) => {
      crypt.generateRandomString.mockReturnValue(expectedBody.Islem_ID)
      crypt.createHash.mockReturnValue(expectedBody.Islem_Hash)
      const { Islem_Hash: _hash, ...bodyWithoutHash } = expectedBody

      const actual = mapper.create3DFormInitializeRequestData(PA, order, model, txType, card)

      expect(actual).toEqual({ 'soap:Body': { [action]: expectedBody } })
      expect(Object.keys((actual['soap:Body'] as Data)[action] as Data)).toEqual(Object.keys(expectedBody))
      expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
      expect(crypt.createHash).toHaveBeenCalledTimes(1)
      const [acc, hashed] = crypt.createHash.mock.calls[0] as [unknown, Data]
      expect(acc).toBe(PA)
      // the signature covers exactly the body that is sent (without its own hash)
      expect(hashed).toEqual({ [action]: bodyWithoutHash })
    })

    // deviation: C8 (PosError subclasses instead of InvalidArgumentException)
    it('needs a card', () => {
      expect(() =>
        mapper.create3DFormInitializeRequestData(PA, order3d(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, null),
      ).toThrow(PosError)
    })

    it('does not support 3D Host', () => {
      expect(() =>
        mapper.create3DFormInitializeRequestData(PA, order3d(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null),
      ).toThrow(UnsupportedPaymentModelError)
    })

    // addition: P3 (a foreign currency pre-authorization would otherwise be sent as a sale)
    it('refuses a 3D pre-authorization in a foreign currency', () => {
      expect(() =>
        mapper.create3DFormInitializeRequestData(
          PA,
          order3d({ currency: CURRENCY.USD }),
          MODEL.THREE_D_SECURE,
          TX_TYPE.PAY_PRE_AUTH,
          card,
        ),
      ).toThrow(/TRY only/)
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    // addition: P3 (3D Pay in a foreign currency uses the same operation as 3D Secure)
    it('sends a 3D Pay in USD as the foreign currency operation', () => {
      crypt.generateRandomString.mockReturnValue('ID')
      crypt.createHash.mockReturnValue('H')
      const actual = mapper.create3DFormInitializeRequestData(
        PA,
        order3d({ currency: CURRENCY.USD }),
        MODEL.THREE_D_PAY,
        TX_TYPE.PAY_AUTH,
        card,
      )
      expect(Object.keys(actual['soap:Body'] as Data)).toEqual(['TP_Islem_Odeme_WD'])
    })

    // addition: the real crypt signs what the mapper sends (RH5)
    it('signs the 3D Secure request with the real crypt (RH5)', () => {
      const real = makeMapper(new ParamPosCrypt())
      const actual = real.create3DFormInitializeRequestData(PA, order3d(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
      const body = (actual['soap:Body'] as Data).TP_WMD_UCD as Data
      expect(body.Islem_Hash).toBe(RH5)
      expect(body.Islem_ID).toMatch(/^[0-9A-F]{24}$/)
    })

    // addition: the caller's order is never changed
    it('does not change the order', () => {
      crypt.generateRandomString.mockReturnValue('ID')
      crypt.createHash.mockReturnValue('H')
      const order = order3d()
      const copy = structuredClone(order)
      mapper.create3DFormInitializeRequestData(PA, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
      expect(order).toEqual(copy)
    })

    // addition: every order value is validated before anything is built
    describe.each([
      ['amount 0', { amount: 0 }],
      ['amount -1', { amount: -1 }],
      ['amount 0.004', { amount: 0.004 }],
      ['amount abc', { amount: 'abc' }],
      ['amount 1e13', { amount: 1e13 }],
      ['amount missing', { amount: undefined }],
      ['installment 1.5', { installment: 1.5 }],
      ['installment 100', { installment: 100 }],
      ['installment x', { installment: 'x' }],
      ['unknown currency', { currency: 'XXX' }],
      ['currency not text', { currency: 949 }],
      ['id with a non-ASCII letter', { id: 'sipariş1' }],
      ['id with a blank', { id: 'a b' }],
      ['empty id', { id: '' }],
      ['id starting with a hyphen', { id: '-x' }],
      ['id of 65 chars', { id: 'a'.repeat(65) }],
      ['id missing', { id: undefined }],
      ['id an object', { id: {} }],
      ['id NaN', { id: Number.NaN }],
      ['ip missing', { ip: undefined }],
      ['ip with a blank', { ip: 'x y' }],
      ['success_url missing', { success_url: undefined }],
      ['fail_url missing', { fail_url: undefined }],
      ['success_url javascript', { success_url: 'javascript:alert(1)' }],
      ['fail_url with a blank', { fail_url: 'https://a.b/c d' }],
    ])('rejects %s', (_name, patch) => {
      it('in the 3D registration', () => {
        expect(() =>
          mapper.create3DFormInitializeRequestData(
            PA,
            order3d(patch as Data),
            MODEL.THREE_D_SECURE,
            TX_TYPE.PAY_AUTH,
            card,
          ),
        ).toThrow(PosError)
        expect(crypt.createHash).not.toHaveBeenCalled()
        expect(crypt.generateRandomString).not.toHaveBeenCalled()
      })
    })

    // addition: a number id is accepted as its text
    it('accepts a numeric order id', () => {
      crypt.generateRandomString.mockReturnValue('ID')
      crypt.createHash.mockReturnValue('H')
      const actual = mapper.create3DFormInitializeRequestData(
        PA,
        order3d({ id: 20250119 }),
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        card,
      )
      expect(((actual['soap:Body'] as Data).TP_WMD_UCD as Data).Siparis_ID).toBe('20250119')
    })

    // addition: only sale and pre-authorization registrations exist
    it.each([TX_TYPE.PAY_POST_AUTH, TX_TYPE.CANCEL, TX_TYPE.REFUND, TX_TYPE.STATUS])(
      'refuses the tx type %s',
      (txType) => {
        expect(() =>
          mapper.create3DFormInitializeRequestData(PA, order3d(), MODEL.THREE_D_SECURE, txType, card),
        ).toThrow(PosError)
      },
    )

    // addition: a hash that is not text never goes out
    it('refuses a random value that is not text', () => {
      crypt.generateRandomString.mockReturnValue(undefined)
      crypt.createHash.mockReturnValue('H')
      expect(() =>
        mapper.create3DFormInitializeRequestData(PA, order3d(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
      ).toThrow(PosError)
    })

    it('never puts "undefined" into a request', () => {
      crypt.generateRandomString.mockReturnValue('ID')
      crypt.createHash.mockReturnValue('H')
      expectNoUndefined(
        mapper.create3DFormInitializeRequestData(PA, order3d(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
      )
    })
  })

  describe('createNonSecurePaymentRequestData', () => {
    const rows: Array<[string, PosOrder, TxType, string, Data]> = [
      [
        'sale',
        orderNs(),
        TX_TYPE.PAY_AUTH,
        'TP_WMD_UCD',
        registerBody({
          secure: 'NS',
          amount: '100,25',
          urls: false,
          hash: 'jsLYSB3lJ81leFgDLw4D8PbXURs=',
          islemId: 'rand',
        }),
      ],
      [
        // deviation: the pre-authorization signature covers the return URLs, so they are always required and sent
        'pre-auth',
        orderNs({ fail_url: 'https://domain.com/fail' }),
        TX_TYPE.PAY_PRE_AUTH,
        'TP_Islem_Odeme_OnProv_WMD',
        registerBody({
          secure: 'NS',
          amount: '100,25',
          urls: true,
          hash: 'jsLYSB3lJ81leFgDLw4D8PbXURs=',
          islemId: 'rand',
        }),
      ],
      [
        'foreign currency',
        orderNs({ currency: CURRENCY.EUR, fail_url: 'https://domain.com/fail' }),
        TX_TYPE.PAY_AUTH,
        'TP_Islem_Odeme_WD',
        (() => {
          const body = registerBody({
            secure: 'NS',
            amount: '100,25',
            doviz: '1002',
            hash: 'jsLYSB3lJ81leFgDLw4D8PbXURs=',
            islemId: 'rand',
          })
          // the foreign currency request carries the return URLs after the currency code
          const { Basarili_URL, Hata_URL, Islem_Hash, Doviz_Kodu, ...rest } = body
          return { ...rest, Doviz_Kodu, Basarili_URL, Hata_URL, Islem_Hash }
        })(),
      ],
    ]

    it.each(rows)('%s', (_name, order, txType, action, expectedBody) => {
      crypt.generateRandomString.mockReturnValue(expectedBody.Islem_ID)
      crypt.createHash.mockReturnValue(expectedBody.Islem_Hash)
      const { Islem_Hash: _hash, ...bodyWithoutHash } = expectedBody

      const actual = mapper.createNonSecurePaymentRequestData(PA, order, txType, card)

      expect(actual).toEqual({ 'soap:Body': { [action]: expectedBody } })
      expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
      expect(crypt.createHash).toHaveBeenCalledTimes(1)
      const [acc, hashed] = crypt.createHash.mock.calls[0] as [unknown, Data]
      expect(acc).toBe(PA)
      expect(hashed).toEqual({ [action]: bodyWithoutHash })
    })

    // addition: the real crypt signs the TRY sale (RH6)
    it('signs the non-secure sale with the real crypt (RH6)', () => {
      const real = makeMapper(new ParamPosCrypt())
      const actual = real.createNonSecurePaymentRequestData(PA, orderNs(), TX_TYPE.PAY_AUTH, card)
      expect(((actual['soap:Body'] as Data).TP_WMD_UCD as Data).Islem_Hash).toBe(RH6)
    })

    // addition: a TRY pre-authorization signs the return URLs, so the real crypt must be able to sign it
    it('signs a TRY non-secure pre-authorization with the real crypt', () => {
      const real = makeMapper(new ParamPosCrypt())
      const order = orderNs({ fail_url: 'https://domain.com/fail' })
      const actual = real.createNonSecurePaymentRequestData(PA, order, TX_TYPE.PAY_PRE_AUTH, card)
      const body = (actual['soap:Body'] as Data).TP_Islem_Odeme_OnProv_WMD as Data
      expect(body.Islem_Hash).toMatch(/^[A-Za-z0-9+/]{27}=$/)
      expect(body.Basarili_URL).toBe('https://domain.com/success')
      expect(body.Hata_URL).toBe('https://domain.com/fail')
    })

    it('needs both return URLs for a TRY pre-authorization', () => {
      crypt.generateRandomString.mockReturnValue('ID')
      crypt.createHash.mockReturnValue('H')
      for (const key of ['success_url', 'fail_url']) {
        expect(() =>
          mapper.createNonSecurePaymentRequestData(
            PA,
            orderNs({ fail_url: 'https://domain.com/fail', [key]: undefined }),
            TX_TYPE.PAY_PRE_AUTH,
            card,
          ),
        ).toThrow(PosError)
      }
    })

    // addition: every request the mapper can emit is signable by the real crypt
    it.each([
      [MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'TRY'],
      [MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'USD'],
      [MODEL.THREE_D_SECURE, TX_TYPE.PAY_PRE_AUTH, 'TRY'],
      [MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, 'TRY'],
      [MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, 'EUR'],
      [MODEL.NON_SECURE, TX_TYPE.PAY_AUTH, 'TRY'],
      [MODEL.NON_SECURE, TX_TYPE.PAY_AUTH, 'GBP'],
      [MODEL.NON_SECURE, TX_TYPE.PAY_PRE_AUTH, 'TRY'],
      [MODEL.NON_SECURE, TX_TYPE.PAY_PRE_AUTH, 'USD'],
    ] as const)('signs %s %s %s with the real crypt', (model, txType, currency) => {
      const real = makeMapper(new ParamPosCrypt())
      const order = order3d({ currency })
      const actual =
        model === MODEL.NON_SECURE
          ? real.createNonSecurePaymentRequestData(PA, order, txType, card)
          : real.create3DFormInitializeRequestData(PA, order, model, txType, card)
      const [body] = Object.values(actual['soap:Body'] as Data) as [Data]
      expect(body.Islem_Hash).toMatch(/^[A-Za-z0-9+/]{27}=$/)
    })

    // addition: a foreign currency request without return URLs never reaches the bank
    it.each(['success_url', 'fail_url'])('needs %s for a foreign currency', (key) => {
      expect(() =>
        mapper.createNonSecurePaymentRequestData(
          PA,
          orderNs({ currency: CURRENCY.EUR, fail_url: 'https://domain.com/fail', [key]: undefined }),
          TX_TYPE.PAY_AUTH,
          card,
        ),
      ).toThrow(PosError)
    })

    it('rejects a javascript: return URL for a foreign currency', () => {
      expect(() =>
        mapper.createNonSecurePaymentRequestData(
          PA,
          orderNs({ currency: CURRENCY.EUR, fail_url: 'javascript:alert(1)' }),
          TX_TYPE.PAY_AUTH,
          card,
        ),
      ).toThrow(PosError)
    })

    // addition: a TRY request sends no URLs, so none are required
    it('needs no return URL for TRY', () => {
      crypt.generateRandomString.mockReturnValue('ID')
      crypt.createHash.mockReturnValue('H')
      const order = orderNs()
      delete order.success_url
      const body = (mapper.createNonSecurePaymentRequestData(PA, order, TX_TYPE.PAY_AUTH, card)['soap:Body'] as Data)
        .TP_WMD_UCD as Data
      expect(body).not.toHaveProperty('Basarili_URL')
    })

    it.each([
      ['amount 0', { amount: 0 }],
      ['amount -1', { amount: -1 }],
      ['amount 0.004', { amount: 0.004 }],
      ['amount abc', { amount: 'abc' }],
      ['amount 1e13', { amount: 1e13 }],
      ['amount missing', { amount: undefined }],
      ['installment 1.5', { installment: 1.5 }],
      ['installment 100', { installment: 100 }],
      ['installment x', { installment: 'x' }],
      ['unknown currency', { currency: 'XXX' }],
      ['id sipariş1', { id: 'sipariş1' }],
      ['id with blank', { id: 'a b' }],
      ['empty id', { id: '' }],
      ['id -x', { id: '-x' }],
      ['id of 65 chars', { id: 'a'.repeat(65) }],
      ['id missing', { id: undefined }],
      ['ip missing', { ip: undefined }],
      ['ip with blank', { ip: 'x y' }],
    ])('rejects %s', (_name, patch) => {
      expect(() =>
        mapper.createNonSecurePaymentRequestData(PA, orderNs(patch as Data), TX_TYPE.PAY_AUTH, card),
      ).toThrow(PosError)
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    it('refuses other tx types', () => {
      expect(() => mapper.createNonSecurePaymentRequestData(PA, orderNs(), TX_TYPE.REFUND, card)).toThrow(
        UnsupportedTransactionTypeError,
      )
    })
  })

  describe('createNonSecurePostAuthPaymentRequestData', () => {
    it('post-auth', () => {
      const actual = mapper.createNonSecurePostAuthPaymentRequestData(PA, { id: '2020110828BC', amount: 1.1 })
      const expected = {
        'soap:Body': {
          TP_Islem_Odeme_OnProv_Kapa: {
            ...account,
            '@xmlns': XMLNS,
            Prov_ID: '',
            Prov_Tutar: '1,10',
            Siparis_ID: '2020110828BC',
          },
        },
      }
      expect(actual).toEqual(expected)
      expect(Object.keys((actual['soap:Body'] as Data).TP_Islem_Odeme_OnProv_Kapa as Data)).toEqual(
        Object.keys(expected['soap:Body'].TP_Islem_Odeme_OnProv_Kapa),
      )
    })

    // addition: P1
    it('writes 1.15 with a comma', () => {
      const body = (
        mapper.createNonSecurePostAuthPaymentRequestData(PA, { id: 'a1', amount: 1.15 })['soap:Body'] as Data
      ).TP_Islem_Odeme_OnProv_Kapa as Data
      expect(body.Prov_Tutar).toBe('1,15')
    })

    it.each([0, -1, 0.004, 'abc', 1e13, undefined])('rejects the amount %j', (amount) => {
      expect(() => mapper.createNonSecurePostAuthPaymentRequestData(PA, { id: 'a1', amount: amount as never })).toThrow(
        PosError,
      )
    })

    it.each(['sipariş1', 'a b', '', '-x', 'a'.repeat(65), undefined])('rejects the order id %j', (id) => {
      expect(() => mapper.createNonSecurePostAuthPaymentRequestData(PA, { id: id as never, amount: 1 })).toThrow(
        PosError,
      )
    })
  })

  describe('createStatusRequestData', () => {
    it('status', () => {
      const actual = mapper.createStatusRequestData(PA, { id: 'id-12' })
      const expected = { 'soap:Body': { TP_Islem_Sorgulama4: { ...account, '@xmlns': XMLNS, Siparis_ID: 'id-12' } } }
      expect(actual).toEqual(expected)
      expect(Object.keys((actual['soap:Body'] as Data).TP_Islem_Sorgulama4 as Data)).toEqual(
        Object.keys(expected['soap:Body'].TP_Islem_Sorgulama4),
      )
    })

    it.each(['sipariş1', 'a b', '', '-x', 'a'.repeat(65), undefined])('rejects the order id %j', (id) => {
      expect(() => mapper.createStatusRequestData(PA, { id: id as never })).toThrow(PosError)
    })
  })

  describe('createCancelRequestData', () => {
    it('cancels a sale', () => {
      const actual = mapper.createCancelRequestData(PA, {
        id: 'id-12',
        transaction_type: TX_TYPE.PAY_AUTH,
        amount: 10.0,
      })
      const expected = {
        'soap:Body': {
          TP_Islem_Iptal_Iade_Kismi2: {
            ...account,
            '@xmlns': XMLNS,
            Durum: 'IPTAL',
            Siparis_ID: 'id-12',
            Tutar: '10.00',
          },
        },
      }
      expect(actual).toEqual(expected)
      expect(Object.keys((actual['soap:Body'] as Data).TP_Islem_Iptal_Iade_Kismi2 as Data)).toEqual(
        Object.keys(expected['soap:Body'].TP_Islem_Iptal_Iade_Kismi2),
      )
    })

    it('cancels a pre-authorization', () => {
      const actual = mapper.createCancelRequestData(PA, {
        id: 'id-12',
        transaction_type: TX_TYPE.PAY_PRE_AUTH,
        amount: 10.0,
      })
      const expected = {
        'soap:Body': { TP_Islem_Iptal_OnProv: { ...account, '@xmlns': XMLNS, Prov_ID: null, Siparis_ID: 'id-12' } },
      }
      expect(actual).toEqual(expected)
      expect(Object.keys((actual['soap:Body'] as Data).TP_Islem_Iptal_OnProv as Data)).toEqual(
        Object.keys(expected['soap:Body'].TP_Islem_Iptal_OnProv),
      )
    })

    // addition: P1 and P5
    it('writes 1.15 with a dot', () => {
      const body = (mapper.createCancelRequestData(PA, { id: 'a1', amount: 1.15 })['soap:Body'] as Data)
        .TP_Islem_Iptal_Iade_Kismi2 as Data
      expect(body.Tutar).toBe('1.15')
    })

    it('treats an order without a transaction type as a sale', () => {
      const body = (mapper.createCancelRequestData(PA, { id: 'a1', amount: 2 })['soap:Body'] as Data)
        .TP_Islem_Iptal_Iade_Kismi2 as Data
      expect(body.Durum).toBe('IPTAL')
    })

    it('cancels a pre-authorization of a USD order with the pre-auth cancel', () => {
      const actual = mapper.createCancelRequestData(PA, { id: 'a1', transaction_type: 'pre', currency: 'USD' })
      expect(Object.keys(actual['soap:Body'] as Data)).toEqual(['TP_Islem_Iptal_OnProv'])
    })

    // addition: P5 (a missing amount would otherwise be sent as 0.00)
    it.each([undefined, 0, -1, 0.004, 'abc', 1e13])('cancelling a sale needs a valid amount (%j)', (amount) => {
      expect(() => mapper.createCancelRequestData(PA, { id: 'a1', amount: amount as never })).toThrow(PosError)
    })

    it('cancelling a pre-authorization needs no amount', () => {
      expect(() => mapper.createCancelRequestData(PA, { id: 'a1', transaction_type: 'pre' })).not.toThrow()
    })

    it.each(['refund', 'post', 'status', 'constructor', 5, ''])(
      'rejects the transaction type %j',
      (transactionType) => {
        expect(() =>
          mapper.createCancelRequestData(PA, { id: 'a1', amount: 1, transaction_type: transactionType }),
        ).toThrow(PosError)
      },
    )

    it.each(['sipariş1', 'a b', '', '-x', 'a'.repeat(65), undefined])('rejects the order id %j', (id) => {
      expect(() => mapper.createCancelRequestData(PA, { id: id as never, amount: 1 })).toThrow(PosError)
    })
  })

  describe('createRefundRequestData', () => {
    it('refunds', () => {
      const actual = mapper.createRefundRequestData(PA, { id: 'id-12', amount: 1.02 }, TX_TYPE.REFUND)
      const expected = {
        'soap:Body': {
          TP_Islem_Iptal_Iade_Kismi2: {
            ...account,
            '@xmlns': XMLNS,
            Durum: 'IADE',
            Siparis_ID: 'id-12',
            Tutar: '1.02',
          },
        },
      }
      expect(actual).toEqual(expected)
      expect(Object.keys((actual['soap:Body'] as Data).TP_Islem_Iptal_Iade_Kismi2 as Data)).toEqual(
        Object.keys(expected['soap:Body'].TP_Islem_Iptal_Iade_Kismi2),
      )
    })

    // addition: P1
    it.each([TX_TYPE.REFUND, TX_TYPE.REFUND_PARTIAL])('writes 1.15 with a dot (%s)', (txType) => {
      const body = (mapper.createRefundRequestData(PA, { id: 'a1', amount: 1.15 }, txType)['soap:Body'] as Data)
        .TP_Islem_Iptal_Iade_Kismi2 as Data
      expect(body.Tutar).toBe('1.15')
    })

    // addition: a refund request never becomes another operation
    it.each([TX_TYPE.PAY_AUTH, TX_TYPE.CANCEL, TX_TYPE.PAY_POST_AUTH, TX_TYPE.STATUS])(
      'refuses the tx type %s',
      (txType) => {
        expect(() => mapper.createRefundRequestData(PA, { id: 'a1', amount: 1 }, txType)).toThrow(PosError)
      },
    )

    it.each([0, -1, 0.004, 'abc', 1e13, undefined])('rejects the amount %j', (amount) => {
      expect(() => mapper.createRefundRequestData(PA, { id: 'a1', amount: amount as never }, TX_TYPE.REFUND)).toThrow(
        PosError,
      )
    })

    it.each(['sipariş1', 'a b', '', '-x', 'a'.repeat(65), undefined])('rejects the order id %j', (id) => {
      expect(() => mapper.createRefundRequestData(PA, { id: id as never, amount: 1 }, TX_TYPE.REFUND)).toThrow(PosError)
    })
  })

  // addition: no produced request holds "undefined" anywhere
  it('never puts "undefined" into any request', () => {
    crypt.generateRandomString.mockReturnValue('ID')
    crypt.createHash.mockReturnValue('H')
    const order = { id: 'a1', amount: 2.5, currency: CURRENCY.TRY }
    expectNoUndefined(mapper.createNonSecurePaymentRequestData(PA, orderNs(), TX_TYPE.PAY_AUTH, card))
    expectNoUndefined(mapper.createNonSecurePostAuthPaymentRequestData(PA, order))
    expectNoUndefined(mapper.createStatusRequestData(PA, order))
    expectNoUndefined(mapper.createCancelRequestData(PA, order))
    expectNoUndefined(mapper.createRefundRequestData(PA, order, TX_TYPE.REFUND))
    expectNoUndefined(
      mapper.create3DPaymentRequestData(PA, order, TX_TYPE.PAY_AUTH, {
        md: 'abc',
        islemGUID: '8b6868fe-a553-4164-a7cc-528461f21759',
      }),
    )
  })

  // addition: an order that is not an object is a PosError, never a TypeError
  it.each([null, undefined, 'x', 5, []])('rejects the order %j', (order) => {
    const o = order as never
    const cb = { md: 'a', islemGUID: '8b6868fe-a553-4164-a7cc-528461f21759' }
    expect(() => mapper.createStatusRequestData(PA, o)).toThrow(PosError)
    expect(() => mapper.createCancelRequestData(PA, o)).toThrow(PosError)
    expect(() => mapper.createRefundRequestData(PA, o, TX_TYPE.REFUND)).toThrow(PosError)
    expect(() => mapper.createNonSecurePostAuthPaymentRequestData(PA, o)).toThrow(PosError)
    expect(() => mapper.createNonSecurePaymentRequestData(PA, o, TX_TYPE.PAY_AUTH, card)).toThrow(PosError)
    expect(() => mapper.create3DFormInitializeRequestData(PA, o, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)).toThrow(
      PosError,
    )
    expect(() => mapper.create3DPaymentRequestData(PA, o, TX_TYPE.PAY_AUTH, cb)).toThrow(PosError)
  })

  it('has no order history request', () => {
    expect(() => mapper.createOrderHistoryRequestData(PA, {})).toThrow(NotImplementedError)
  })

  describe('create3DFormData', () => {
    const wd = (url: unknown): Data => ({ TP_Islem_Odeme_WDResponse: { TP_Islem_Odeme_WDResult: { UCD_URL: url } } })
    const payResult = (url: unknown): Data => ({ Pos_OdemeResponse: { Pos_OdemeResult: { UCD_URL: url } } })
    const htmlResult = (html: unknown): Data => ({
      TP_WMD_UCDResponse: { TP_WMD_UCDResult: { UCD_HTML: html, UCD_MD: 'x' } },
    })

    const call = (
      order: PosOrder | null,
      txType: TxType,
      model: PaymentModel,
      extra: Data | null,
      withCard = false,
    ): Promise<unknown> => mapper.create3DFormData(PA, order, model, txType, '', withCard ? card : null, extra)

    it('returns the HTML of a 3D Secure registration', async () => {
      await expect(
        call({ currency: CURRENCY.TRY }, TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, htmlResult('HTML_FORM_DATA')),
      ).resolves.toBe('HTML_FORM_DATA')
    })

    it('returns a GET form for a foreign currency', async () => {
      await expect(
        call(
          { currency: CURRENCY.USD },
          TX_TYPE.PAY_AUTH,
          MODEL.THREE_D_SECURE,
          wd(
            'https://test-pos.param.com.tr/3D_Secure/AkilliKart_3DPay_EST_Doviz.aspx?rURL=TURKPOS_3D_TRAN&SID=de67c915-0f0c-4e2a-ac36-a5e8a61c2167',
          ),
        ),
      ).resolves.toEqual({
        gateway: 'https://test-pos.param.com.tr/3D_Secure/AkilliKart_3DPay_EST_Doviz.aspx',
        method: 'GET',
        inputs: { rURL: 'TURKPOS_3D_TRAN', SID: 'de67c915-0f0c-4e2a-ac36-a5e8a61c2167' },
      })
    })

    it('returns the HTML of a 3D pre-authorization', async () => {
      await expect(
        call({ currency: CURRENCY.TRY }, TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_SECURE, {
          TP_Islem_Odeme_OnProv_WMDResponse: { TP_Islem_Odeme_OnProv_WMDResult: { UCD_HTML: 'HTML_FORM' } },
        }),
      ).resolves.toBe('HTML_FORM')
    })

    it('returns a GET form for 3D Pay', async () => {
      await expect(
        call(
          { currency: CURRENCY.TRY },
          TX_TYPE.PAY_AUTH,
          MODEL.THREE_D_PAY,
          payResult(
            'https://test-pos.param.com.tr/3D_Secure/AkilliKart_3DPay_PFO.aspx?rURL=TURKPOS_3D_TRAN&SID=f2771b35-f5fd-434a-a1be-ba4eea554146',
          ),
        ),
      ).resolves.toEqual({
        gateway: 'https://test-pos.param.com.tr/3D_Secure/AkilliKart_3DPay_PFO.aspx',
        method: 'GET',
        inputs: { rURL: 'TURKPOS_3D_TRAN', SID: 'f2771b35-f5fd-434a-a1be-ba4eea554146' },
      })
    })

    it('keeps an explicit port', async () => {
      await expect(
        call(
          { currency: CURRENCY.TRY },
          TX_TYPE.PAY_AUTH,
          MODEL.THREE_D_PAY,
          payResult(
            'https://test-pos.param.com.tr:443/3D_Secure/AkilliKart_3DPay_PFO.aspx?rURL=TURKPOS_3D_TRAN&SID=f2771b35',
          ),
        ),
      ).resolves.toEqual({
        gateway: 'https://test-pos.param.com.tr:443/3D_Secure/AkilliKart_3DPay_PFO.aspx',
        method: 'GET',
        inputs: { rURL: 'TURKPOS_3D_TRAN', SID: 'f2771b35' },
      })
    })

    // addition: a 3D Pay in USD takes the foreign currency result
    it('reads the foreign currency result for a USD 3D Pay', async () => {
      await expect(
        call({ currency: CURRENCY.USD }, TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY, wd('https://a.b/p?x=1')),
      ).resolves.toEqual({ gateway: 'https://a.b/p', method: 'GET', inputs: { x: '1' } })
    })

    it('never builds a hash, a random value or a hook event', async () => {
      await call({ currency: CURRENCY.TRY }, TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, htmlResult('H'))
      expect(crypt.create3DHash).not.toHaveBeenCalled()
      expect(crypt.generateRandomString).not.toHaveBeenCalled()
    })

    it('does not support 3D Host', async () => {
      await expect(
        call({}, TX_TYPE.PAY_AUTH, MODEL.THREE_D_HOST, {
          TO_Pre_Encrypting_OOSResponse: { TO_Pre_Encrypting_OOSResult: 'SOAP' },
        }),
      ).rejects.toThrow(UnsupportedPaymentModelError)
    })

    it('rejects text that is not a URL', async () => {
      await expect(
        call({}, TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY, payResult('SOAP Güvenlik Hatası.192.168.190.2')),
      ).rejects.toThrow(PosError)
    })

    it('rejects a URL without query parameters', async () => {
      await expect(
        call(
          {},
          TX_TYPE.PAY_AUTH,
          MODEL.THREE_D_PAY,
          payResult('https://test-pos.param.com.tr/3D_Secure/AkilliKart_3DPay_PFO.aspx'),
        ),
      ).rejects.toThrow(PosError)
    })

    it('rejects an empty HTML result', async () => {
      await expect(
        call({ currency: CURRENCY.TRY }, TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, htmlResult('')),
      ).rejects.toThrow(PosError)
    })

    // deviation: P6 (a missing bank answer is a PosError, not a TypeError)
    it('rejects missing extra data', async () => {
      await expect(call({}, TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, null)).rejects.toThrow(PosError)
    })

    // addition: P6 (the URL and its query are checked, they become a redirect)
    it.each([
      ['http scheme', 'http://test-pos.param.com.tr/p?a=1'],
      ['fragment', 'https://a.b/x#y?z=1'],
      ['fragment after the query', 'https://a.b/x?z=1#y'],
      ['bracket key', 'https://a.b/x?a[b]=1'],
      ['empty query', 'https://a.b/x?'],
      ['blank in the query', 'https://a.b/x?a=1 2'],
      ['duplicate key', 'https://a.b/x?a=1&a=2'],
      ['proto key', 'https://a.b/x?__proto__=1'],
      ['userinfo', 'https://user@a.b/x?a=1'],
      ['no path', 'https://a.b?a=1'],
      ['non-ASCII host', 'https://ş.b/x?a=1'],
      ['long value', `https://a.b/x?a=${'v'.repeat(2049)}`],
      ['javascript scheme', 'javascript:alert(1)'],
    ])('rejects a UCD_URL with %s', async (_name, url) => {
      await expect(call({}, TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY, payResult(url))).rejects.toThrow(PosError)
    })

    it.each([[undefined], [5], [null], [['https://a.b/x?a=1']], [{}]])('rejects a UCD_URL of %j', async (url) => {
      await expect(call({}, TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY, payResult(url))).rejects.toThrow(PosError)
    })

    it('rejects a missing result record', async () => {
      await expect(call({}, TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY, {})).rejects.toThrow(PosError)
      await expect(call({}, TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY, { Pos_OdemeResponse: [] })).rejects.toThrow(PosError)
    })

    it('rejects HTML that is missing, not text or too large', async () => {
      await expect(call({}, TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, htmlResult(undefined))).rejects.toThrow(PosError)
      await expect(call({}, TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, htmlResult(5))).rejects.toThrow(PosError)
      await expect(call({}, TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, htmlResult('a'.repeat(1_048_577)))).rejects.toThrow(
        PosError,
      )
    })

    it('rejects an unknown currency and a USD pre-authorization', async () => {
      await expect(
        call({ currency: 'XXX' as never }, TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, htmlResult('H')),
      ).rejects.toThrow(PosError)
      await expect(
        call({ currency: CURRENCY.USD }, TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_SECURE, wd('https://a.b/p?x=1')),
      ).rejects.toThrow(PosError)
    })

    it('has no pre-authorization with 3D Pay', async () => {
      await expect(
        call({ currency: CURRENCY.TRY }, TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_PAY, payResult('https://a.b/p?x=1')),
      ).rejects.toThrow(PosError)
    })
  })

  describe('create3DPaymentRequestData', () => {
    const order = { id: '202412292160', amount: 100.25, currency: CURRENCY.TRY, ip: '156.155.154.153' }
    const callback = {
      md: '444676:13FDE30917BF65D853787DB838390849D73151A10FC8C1192AC72660F2464521:3473:##190100000',
      orderId: '202412292160',
      islemGUID: '8b6868fe-a553-4164-a7cc-528461f21759',
    }

    // deviation: P5 (Siparis_ID comes from the order, equal to the callback's here)
    it('provision request', () => {
      const actual = mapper.create3DPaymentRequestData(PA, order, TX_TYPE.PAY_AUTH, callback)
      const expected = {
        'soap:Body': {
          TP_WMD_Pay: {
            ...account,
            '@xmlns': XMLNS,
            UCD_MD: callback.md,
            Islem_GUID: callback.islemGUID,
            Siparis_ID: '202412292160',
          },
        },
      }
      expect(actual).toEqual(expected)
      expect(Object.keys((actual['soap:Body'] as Data).TP_WMD_Pay as Data)).toEqual(
        Object.keys(expected['soap:Body'].TP_WMD_Pay),
      )
    })

    // addition: the order id comes from the order, never from the callback
    it('does not read the callback order id', () => {
      const body = (
        mapper.create3DPaymentRequestData(PA, order, TX_TYPE.PAY_AUTH, { ...callback, orderId: '2292160' })[
          'soap:Body'
        ] as Data
      ).TP_WMD_Pay as Data
      expect(body.Siparis_ID).toBe('202412292160')
    })

    it.each([
      ['md missing', { md: undefined }],
      ['md not text', { md: 5 }],
      ['md an array', { md: ['x'] }],
      ['md empty', { md: '' }],
      ['md with a blank', { md: 'a b' }],
      ['md with a non-ASCII letter', { md: 'şx' }],
      ['md of 1025 chars', { md: 'a'.repeat(1025) }],
      ['islemGUID missing', { islemGUID: undefined }],
      ['islemGUID not text', { islemGUID: 5 }],
      ['islemGUID malformed', { islemGUID: '8b6868fe' }],
    ])('rejects %s', (_name, patch) => {
      expect(() => mapper.create3DPaymentRequestData(PA, order, TX_TYPE.PAY_AUTH, { ...callback, ...patch })).toThrow(
        PosError,
      )
    })

    it('rejects inherited callback fields', () => {
      const inherited = Object.create(callback) as Record<string, unknown>
      expect(() => mapper.create3DPaymentRequestData(PA, order, TX_TYPE.PAY_AUTH, inherited)).toThrow(PosError)
    })

    it.each([
      ['id', { id: 'sipariş1' }],
      ['id with blank', { id: 'a b' }],
      ['id missing', { id: undefined }],
      ['amount', { amount: 0 }],
      ['amount abc', { amount: 'abc' }],
    ])('rejects an order with a bad %s', (_name, patch) => {
      expect(() =>
        mapper.create3DPaymentRequestData(PA, { ...order, ...patch } as PosOrder, TX_TYPE.PAY_AUTH, callback),
      ).toThrow(PosError)
    })

    it('refuses other tx types', () => {
      expect(() => mapper.create3DPaymentRequestData(PA, order, TX_TYPE.REFUND, callback)).toThrow(PosError)
    })

    it('does not change the order or the callback', () => {
      const o = structuredClone(order)
      const c = structuredClone(callback)
      mapper.create3DPaymentRequestData(PA, o, TX_TYPE.PAY_AUTH, c)
      expect(o).toEqual(order)
      expect(c).toEqual(callback)
    })
  })
})
