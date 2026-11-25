import { describe, expect, it, vi } from 'vitest'
import { ParamPosCrypt } from '../../../../../src/crypt/ParamPosCrypt.js'
import { Param3DHostPosRequestDataMapper } from '../../../../../src/data-mapper/request/mapper/Param3DHostPosRequestDataMapper.js'
import { ParamPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/ParamPosRequestValueFormatter.js'
import { ParamPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/ParamPosRequestValueMapper.js'
import {
  MissingAccountInfoError,
  NotImplementedError,
  PosError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import { CARD_TYPE, CURRENCY, LANG, MODEL, TX_TYPE } from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'

type Data = Record<string, unknown>

const G = '0c13d406-873b-403b-9c09-a5766840d98c'
const HA = AccountFactory.createParamPosAccount('param-3d-host-pos', '10738', 'Test1', 'Test2', G, '99001')
const HA_NO_TERMINAL = AccountFactory.createParamPosAccount('param-3d-host-pos', '10738', 'Test1', 'Test2', G)
const card = CreditCardFactory.create('5555444433332222', '22', '01', '123', 'ahmet', CARD_TYPE.VISA)

const HI1 = '10EA8B9F7B2728D8F4BF034F'
const S =
  'JHnDLmT5yierHIqsHNRU2SR7HLxOpi8o7Eb/oVSiIf35v+Z1uzteqid4wop8SAuykWNFElYyAxGWcIGvTxmhSljuLTcJ3xDMkS3O0jUboNpl5ad6roy/92lDftpV535KmpbxMxStRa+qGT7Tk4BdEIf+Jobr2o1Yl1+ZakWZ+parsTgnodyWl432Hsv2FUNLhuU7H6folMwleaZFPYdFZ+bO1T95opw5pnDWcFkrIuPfAmVRg4cg+al22FQSN/58AXxWBb8jEPrqn+/ojZ+WqncGvw+NB/Mtv9iCDuF+SNQqRig2dRILzWYwcvNxzj/OxcYuNuvO8wYI/iF1kNBBNtaExIunWZyj1tntGeb7UUaDmHD4LmSMUMpgZGugRfUpxm8WL/EE+PnUkLXE7SOG3g=='
const GATEWAY = 'https://test-pos.param.com.tr/to.ws/Service_Odeme.asmx'

const order = (extra: Data = {}): PosOrder => ({
  id: 'order222',
  amount: 1000.25,
  installment: 0,
  currency: CURRENCY.TRY,
  ip: '127.0.0.1',
  success_url: 'https://domain.com/success',
  fail_url: 'https://domain.com/fail',
  ...extra,
})

const header = {
  ServiceSecuritySoapHeader: {
    '@xmlns': 'https://turkodeme.com.tr/',
    CLIENT_CODE: '10738',
    CLIENT_USERNAME: 'Test1',
    CLIENT_PASSWORD: 'Test2',
  },
}

const bodyOf = (id: string, extra: Data = {}): Data => ({
  '@xmlns': 'https://turkodeme.com.tr/',
  Borclu_Aciklama: 'r|',
  Borclu_AdSoyad: 'r|',
  Borclu_GSM: 'r|',
  Borclu_Kisi_TC: '',
  Borclu_Odeme_Tip: 'r|Diğer',
  Borclu_Tutar: 'r|1000,25',
  Islem_ID: id,
  Return_URL: 'r|https://domain.com/success',
  Taksit: '1',
  Terminal_ID: '99001',
  ...extra,
})

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.fromEntries(
    Object.entries(value as Data)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, sortKeys(v)]),
  )
}

function makeMapper(crypt: unknown): Param3DHostPosRequestDataMapper {
  return new Param3DHostPosRequestDataMapper(
    new ParamPosRequestValueMapper(),
    new ParamPosRequestValueFormatter(),
    {},
    crypt as ParamPosCrypt,
    LANG.EN,
  )
}

function stubCrypt() {
  return {
    generateRandomString: vi.fn(),
    createHash: vi.fn(),
    create3DHash: vi.fn(),
    create3DHostTransactionId: vi.fn().mockReturnValue('rand'),
  }
}

describe('Param3DHostPosRequestDataMapper', () => {
  it('supports only Param3DHostPos', () => {
    expect(Param3DHostPosRequestDataMapper.supports('Param3DHostPos')).toBe(true)
    expect(Param3DHostPosRequestDataMapper.supports('ParamPos')).toBe(false)
    expect(Param3DHostPosRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  describe('unsupported requests', () => {
    const mapper = makeMapper(stubCrypt())
    it.each([
      ['post-auth', () => mapper.createNonSecurePostAuthPaymentRequestData(HA, {})],
      ['non-secure payment', () => mapper.createNonSecurePaymentRequestData(HA, {}, TX_TYPE.PAY_AUTH, card)],
      ['cancel', () => mapper.createCancelRequestData(HA, {})],
      ['order history', () => mapper.createOrderHistoryRequestData(HA, {})],
      ['status', () => mapper.createStatusRequestData(HA, {})],
      ['refund', () => mapper.createRefundRequestData(HA, {}, TX_TYPE.REFUND)],
      ['3D payment', () => mapper.create3DPaymentRequestData(HA, {}, TX_TYPE.PAY_AUTH, {})],
    ])('%s is not implemented', (_name, call) => {
      expect(call).toThrow(NotImplementedError)
    })
  })

  describe('create3DFormInitializeRequestData', () => {
    // deviation: H1 the transaction id is derived from the order, not random
    it.each([
      ['TRY', {}, '1000', {}],
      ['EUR', { currency: CURRENCY.EUR }, '1002', { Doviz_Kodu: '1002' }],
    ])('registers the %s payment', async (_name, orderExtra, code, bodyExtra) => {
      const crypt = stubCrypt()
      const mapper = makeMapper(crypt)
      const actual = await mapper.create3DFormInitializeRequestData(
        HA,
        order(orderExtra),
        MODEL.THREE_D_HOST,
        TX_TYPE.PAY_AUTH,
      )
      expect(sortKeys(actual)).toEqual(
        sortKeys({ 'soap:Header': header, 'soap:Body': { TO_Pre_Encrypting_OOS: bodyOf('rand', bodyExtra) } }),
      )
      expect(crypt.create3DHostTransactionId).toHaveBeenCalledTimes(1)
      expect(crypt.create3DHostTransactionId).toHaveBeenCalledWith(HA, 'order222', 100025, code)
      expect(crypt.generateRandomString).not.toHaveBeenCalled()
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    it('uses the real crypt for the transaction id (HI1)', async () => {
      const mapper = makeMapper(new ParamPosCrypt())
      const actual = (await mapper.create3DFormInitializeRequestData(
        HA,
        order(),
        MODEL.THREE_D_HOST,
        TX_TYPE.PAY_AUTH,
      )) as { 'soap:Body': { TO_Pre_Encrypting_OOS: Data } }
      expect(actual['soap:Body'].TO_Pre_Encrypting_OOS.Islem_ID).toBe(HI1)
    })

    // addition: the same order and amount give the same id, another amount or currency another one
    it('derives a stable id that depends on amount and currency', async () => {
      const mapper = makeMapper(new ParamPosCrypt())
      const idOf = async (extra: Data): Promise<unknown> =>
        (
          (await mapper.create3DFormInitializeRequestData(HA, order(extra), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)) as {
            'soap:Body': { TO_Pre_Encrypting_OOS: Data }
          }
        )['soap:Body'].TO_Pre_Encrypting_OOS.Islem_ID
      expect(await idOf({})).toBe(await idOf({}))
      expect(await idOf({ amount: 1000.26 })).not.toBe(await idOf({}))
      expect(await idOf({ currency: CURRENCY.EUR })).not.toBe(await idOf({}))
      expect(await idOf({ id: 'order223' })).not.toBe(await idOf({}))
    })

    // addition: header key order and header before body
    it('puts the header first with the credentials in a fixed order', async () => {
      const mapper = makeMapper(stubCrypt())
      const actual = await mapper.create3DFormInitializeRequestData(HA, order(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)
      expect(Object.keys(actual)).toEqual(['soap:Header', 'soap:Body'])
      const h = (actual['soap:Header'] as Data).ServiceSecuritySoapHeader as Data
      expect(Object.keys(h)).toEqual(['@xmlns', 'CLIENT_CODE', 'CLIENT_USERNAME', 'CLIENT_PASSWORD'])
    })

    // addition: a missing terminal id never reaches the bank
    it('needs a terminal id', async () => {
      const crypt = stubCrypt()
      const mapper = makeMapper(crypt)
      await expect(
        Promise.resolve().then(() =>
          mapper.create3DFormInitializeRequestData(HA_NO_TERMINAL, order(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH),
        ),
      ).rejects.toThrow(MissingAccountInfoError)
      expect(crypt.create3DHostTransactionId).not.toHaveBeenCalled()
    })

    const call = (o: PosOrder) => async () =>
      makeMapper(stubCrypt()).create3DFormInitializeRequestData(HA, o, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)

    // addition: amount rules as for the other Param requests
    it.each([0, -1, 0.004, 'abc', 1e13, undefined, null, ''])('refuses the amount %s', async (amount) => {
      await expect(call(order({ amount }))()).rejects.toThrow(PosError)
    })

    // addition: the order id is validated although it is not sent
    it.each(['sipariş1', 'a b', '', '-x', 'a'.repeat(65), undefined, {}, 5.5])(
      'refuses the order id %s',
      async (id) => {
        await expect(call(order({ id }))()).rejects.toThrow(PosError)
      },
    )

    // addition: success_url is the page the payer returns to
    it.each([undefined, '', 'javascript:alert(1)', 'https://a b/c', 'ftp://x/y', 5])(
      'refuses the success_url %s',
      async (success_url) => {
        await expect(call(order({ success_url }))()).rejects.toThrow(PosError)
      },
    )

    it.each([1.5, 100, 'x', -1])('refuses the installment %s', async (installment) => {
      await expect(call(order({ installment }))()).rejects.toThrow(PosError)
    })

    it('refuses an unknown currency and a non-object order', async () => {
      await expect(call(order({ currency: 'XXX' }))()).rejects.toThrow(PosError)
      await expect(call(null as never)()).rejects.toThrow(PosError)
    })

    // addition: only a 3D Host sale is registered
    it('refuses other models and transaction types', async () => {
      const mapper = makeMapper(stubCrypt())
      await expect(
        Promise.resolve().then(() =>
          mapper.create3DFormInitializeRequestData(HA, order(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH),
        ),
      ).rejects.toThrow(UnsupportedPaymentModelError)
      for (const txType of [TX_TYPE.PAY_PRE_AUTH, TX_TYPE.PAY_POST_AUTH, TX_TYPE.REFUND, TX_TYPE.STATUS]) {
        await expect(
          Promise.resolve().then(() =>
            mapper.create3DFormInitializeRequestData(HA, order(), MODEL.THREE_D_HOST, txType),
          ),
        ).rejects.toThrow(UnsupportedTransactionTypeError)
      }
    })

    // addition: no card data in the hosted request, the order is not changed, nothing says "undefined"
    it('sends no card fields, does not mutate the order and never writes "undefined"', async () => {
      const o = order({ extra: 'x' })
      const copy = structuredClone(o)
      const mapper = makeMapper(new ParamPosCrypt())
      const actual = await mapper.create3DFormInitializeRequestData(HA, o, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, card)
      expect(o).toEqual(copy)
      const text = JSON.stringify(actual)
      expect(text).not.toContain('undefined')
      expect(text).not.toMatch(/KK_|5555444433332222|"123"|ahmet/)
      expect(text).not.toContain(G)
      expect(text).not.toContain('Islem_Hash')
    })

    // addition: the mapper emits only unsigned operations; the real crypt is never asked to sign or to make a random id
    it('needs no signature for anything it emits (real crypt)', async () => {
      const crypt = new ParamPosCrypt()
      const createHash = vi.spyOn(crypt, 'createHash')
      const create3DHash = vi.spyOn(crypt, 'create3DHash')
      const random = vi.spyOn(crypt, 'generateRandomString')
      const mapper = makeMapper(crypt)
      for (const currency of [CURRENCY.TRY, CURRENCY.USD, CURRENCY.EUR, CURRENCY.GBP]) {
        const request = await mapper.create3DFormInitializeRequestData(
          HA,
          order({ currency }),
          MODEL.THREE_D_HOST,
          TX_TYPE.PAY_AUTH,
        )
        expect(Object.keys((request['soap:Body'] as Data) ?? {})).toEqual(['TO_Pre_Encrypting_OOS'])
      }
      const confirmation = mapper.createConfirmationRequestData(HA, 'order222')
      expect(Object.keys(confirmation['soap:Body'] as Data)).toEqual(['TP_Islem_Sorgulama4'])
      expect(createHash).not.toHaveBeenCalled()
      expect(create3DHash).not.toHaveBeenCalled()
      expect(random).not.toHaveBeenCalled()
    })
  })

  describe('create3DFormData', () => {
    const answer = (result: unknown): Data => ({
      TO_Pre_Encrypting_OOSResponse: { TO_Pre_Encrypting_OOSResult: result },
    })
    const form = async (
      result: unknown,
      gateway = GATEWAY,
      model: string = MODEL.THREE_D_HOST,
      extra: Data | null = null,
    ) =>
      makeMapper(stubCrypt()).create3DFormData(
        HA,
        {},
        model as never,
        TX_TYPE.PAY_AUTH,
        gateway,
        null,
        extra ?? answer(result),
      )

    it('returns a GET form with the encrypted value', async () => {
      const crypt = stubCrypt()
      const actual = await makeMapper(crypt).create3DFormData(
        HA,
        {},
        MODEL.THREE_D_HOST,
        TX_TYPE.PAY_AUTH,
        GATEWAY,
        null,
        answer(S),
      )
      expect(actual).toEqual({ gateway: GATEWAY, method: 'GET', inputs: { s: S } })
      expect(crypt.create3DHash).not.toHaveBeenCalled()
      expect(crypt.generateRandomString).not.toHaveBeenCalled()
    })

    // deviation: C8 the failure is a PosError carrying the masked bank text
    it('refuses a bank error text', async () => {
      await expect(form('SOAP Güvenlik Hatası.192.168.190.2')).rejects.toThrow(PosError)
      await expect(form('SOAP Güvenlik Hatası.192.168.190.2')).rejects.toThrow(/SOAP G/)
    })

    it('refuses another model', async () => {
      await expect(form(S, GATEWAY, MODEL.THREE_D_SECURE)).rejects.toThrow(UnsupportedPaymentModelError)
    })

    // deviation: the interface takes a string, so a missing address is an empty one
    it('refuses an empty gateway address', async () => {
      await expect(form(S, '')).rejects.toThrow(PosError)
    })

    it('refuses missing extra data', async () => {
      await expect(
        makeMapper(stubCrypt()).create3DFormData(HA, {}, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, GATEWAY, null, null),
      ).rejects.toThrow(PosError)
    })

    // addition: strict base64, bounded length
    it.each([
      ['length % 4 != 0', 'QUJD='],
      ['8193 chars', 'A'.repeat(8193)],
      ['empty', ''],
      ['not text', 42],
      ['object', { a: 1 }],
      ['array', ['QUJD']],
      ['null', null],
      ['url-safe alphabet', 'QUJD-_8='],
      ['padding in the middle', 'QU=D'],
    ])('refuses %s', async (_name, value) => {
      await expect(form(value)).rejects.toThrow(PosError)
    })

    it('accepts the longest value', async () => {
      const value = 'A'.repeat(8192)
      expect(await form(value)).toEqual({ gateway: GATEWAY, method: 'GET', inputs: { s: value } })
    })

    it('refuses answers without the result and an http gateway', async () => {
      await expect(form(S, GATEWAY, MODEL.THREE_D_HOST, {})).rejects.toThrow(PosError)
      await expect(form(S, GATEWAY, MODEL.THREE_D_HOST, { TO_Pre_Encrypting_OOSResponse: 'x' })).rejects.toThrow(
        PosError,
      )
      await expect(form(S, 'http://test-pos.param.com.tr/x')).rejects.toThrow(PosError)
    })

    // addition: the bank text is masked and short in the error
    it('masks secrets and shortens the bank text', async () => {
      const text = `Test2 ${G} ${'x'.repeat(600)}`
      const error = await form(text).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(PosError)
      const message = (error as Error).message
      expect(message).not.toContain('Test2')
      expect(message).not.toContain(G)
      expect(message.length).toBeLessThan(400)
    })
  })

  describe('createConfirmationRequestData', () => {
    const mapper = makeMapper(stubCrypt())

    it('builds the status request of the order', () => {
      expect(mapper.createConfirmationRequestData(HA, '20250119BACB')).toEqual({
        'soap:Body': {
          TP_Islem_Sorgulama4: {
            G: { CLIENT_CODE: '10738', CLIENT_USERNAME: 'Test1', CLIENT_PASSWORD: 'Test2' },
            GUID: G,
            '@xmlns': 'https://turkpos.com.tr/',
            Siparis_ID: '20250119BACB',
          },
        },
      })
    })

    it.each(['a b', '', '-x', 'sipariş', 'a'.repeat(65), 5, null, undefined, {}])('refuses the order id %s', (id) => {
      expect(() => mapper.createConfirmationRequestData(HA, id as never)).toThrow(PosError)
    })
  })
})
