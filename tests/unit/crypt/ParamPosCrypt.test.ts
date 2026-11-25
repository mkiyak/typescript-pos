import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ParamPosCrypt } from '../../../src/crypt/ParamPosCrypt.js'
import { NotImplementedError, PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosLogger } from '../../../src/logger.js'
import type { GatewayResponseData } from '../../../src/types.js'

type Data = Record<string, unknown>
type MockLogger = { [K in keyof PosLogger]: ReturnType<typeof vi.fn> }

function makeLogger(): MockLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

const G = '0c13d406-873b-403b-9c09-a5766840d98c'
const PA = AccountFactory.createParamPosAccount('param-pos', '10738', 'Test1', 'Test2', G)
const HA = AccountFactory.createParamPosAccount('param-3d-host-pos', '10738', 'Test1', 'Test2', G, '99001')

const S1 = (text: string): string => createHash('sha1').update(text, 'utf8').digest('base64')

/** A 3D Secure callback of the shape the bank posts after the card check. */
const md = (islemGUID: string, mdValue: string, mdStatus: string, orderId: string, islemHash: string): Data => ({
  md: mdValue,
  mdStatus,
  orderId,
  transactionAmount: '10,01',
  islemGUID,
  islemHash,
  bankResult: 'Y-status/Challenge authentication via ACS',
  dc: '',
  dcURL: 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx',
})

/** The five signed fields of a 3D Pay / 3D Host callback, with a hash. */
const turkpos = (islemId: string, dekont: string, tutar: string, orderId: string, hash: string): Data => ({
  TURKPOS_RETVAL_Islem_ID: islemId,
  TURKPOS_RETVAL_Sonuc: '1',
  TURKPOS_RETVAL_GUID: G,
  TURKPOS_RETVAL_Dekont_ID: dekont,
  TURKPOS_RETVAL_Tahsilat_Tutari: tutar,
  TURKPOS_RETVAL_Siparis_ID: orderId,
  TURKPOS_RETVAL_Hash: hash,
})

const MD1 = '581877:A65A349B0BAE27FC6567294215158DD8AE223843B5C96462F04A750CA7E8B165:3680:##500100000'
const CS1 = md('35513153-9902-4a4c-a256-af6ed9cadc52', MD1, '1', '2025011749D1', 'b1D7+nI3j4k3WGJuhW5IuPOFpEE=')
const CS2 = md(
  'c1ee369b-ec27-4ab6-8c27-2e15e62793d3',
  '444676:84E83D96A7CEC3A5815D49EB7F64D2709D1BC30425D578D118B9819A81749FB8:4429:##190100000',
  '0',
  '20241229C152',
  'N1/W7/GcbuT3UVwVM9Q5C/rmoKg=',
)
const CS3 = md(
  '5ee6c14d-94c2-48c9-bfe1-da31c415e647',
  '444676:B1748AA7FF30A96AADFECC19670A3038C1419A842DD221D2408708A84FE9D811:4011:##190100000',
  '1',
  '202412306616',
  'zrHcS2iMl0J0GPU6DalIdOppDz8=',
)
const CS4 = md(
  '45c47ad7-2d2a-4e9f-adca-a9641cd34b74',
  '444676:A78A6D388E30776DA8F0EB5920F615F9AA523AC0E1EBA1499DB65C2B2BC4F29B:4474:##190100000',
  '1',
  '20250104E733',
  'TLN7U1O+XAreUpt7nx6UlP63nzc=',
)
const MD5 = '444676:13FDE30917BF65D853787DB838390849D73151A10FC8C1192AC72660F2464521:3473:##190100000'
// The fixture's own hash (jF0PD92E+dM394Z1h5qm4SB6pPo=) does not verify with this GUID; this one does.
const CS5 = md('8b6868fe-a553-4164-a7cc-528461f21759', MD5, '1', '202412292160', 'VW80ENgtqYCWlReB6tyAvqsomb4=')
const RP1 = md('8b6868fe-a553-4164-a7cc-528461f21759', `${MD5}12024`, '1', '2292160', 'VW80ENgtqYCWlReB6tyAvqsomb4=')

const CP1 = turkpos('1944A39AD0AEA92E173D665B', '3007300695', '10,01', '20250119BACB', 'LOpkL9J8vne8E2j0A0HKOhUWGhI=')
const CP2 = turkpos('21C152499BA0369D94028E30', '3007301017', '10,01', '202501208059', 'sUAKlp9jJ9lyDVV4C0+lAnkDC9I=')
const CP3 = turkpos('FF0591BD887935E481743533', '0', '10,01', '202501193584', '+qCEIrH+7ARPmJC55MGQCykg8pk=')
const CP4 = turkpos('25B4E0BAAD1F3FC05D46F5B4', '3007296668', '10,01', '202501053F4F', 'LrFgOcE6S8HzNF4tzvtORAh3C20=')
const CP5 = turkpos('C38F20632F9FBBC3FD2A3B35', '0', '10,01', '20250120B068', 'Df3gttv1swwT8N1m3aCVYzp23Rg=')

const body = (extra: Data = {}): Data => ({
  G: { CLIENT_CODE: '10738', CLIENT_USERNAME: 'Test1', CLIENT_PASSWORD: 'Test2' },
  GUID: G,
  '@xmlns': 'https://turkpos.com.tr/',
  Islem_Guvenlik_Tip: '3D',
  Islem_ID: '3344914AAB82284E39742F4C',
  Siparis_ID: 'order222',
  Islem_Tutar: '1000,25',
  Toplam_Tutar: '1000,25',
  Basarili_URL: 'https://domain.com/success',
  Hata_URL: 'https://domain.com/fail',
  Taksit: '1',
  KK_No: '5555444433332222',
  ...extra,
})

describe('ParamPosCrypt', () => {
  let logger: MockLogger
  let crypt: ParamPosCrypt

  beforeEach(() => {
    logger = makeLogger()
    crypt = new ParamPosCrypt(logger as unknown as PosLogger)
  })

  const check = (data: unknown, who = PA): boolean => crypt.check3DHash(who, data as GatewayResponseData)

  it('testSupports', () => {
    expect(ParamPosCrypt.supports('ParamPos')).toBe(true)
    expect(ParamPosCrypt.supports('Param3DHostPos')).toBe(true)
    expect(ParamPosCrypt.supports('AssecoPos')).toBe(false)
  })

  it('testCreate3DHash', () => {
    expect(() => crypt.create3DHash(PA, {})).toThrow(NotImplementedError)
  })

  describe('check3DHash', () => {
    it('3d secure row: passes, then fails with an empty mdStatus', () => {
      expect(check(CS1)).toBe(true)
      expect(check({ ...CS1, mdStatus: '' })).toBe(false)
    })

    it.each([
      ['3d_pay', CP1],
      ['3d_secure_foreign_currency', CP2],
    ])('%s row: passes, then fails with an empty order id', (_name, row) => {
      expect(check(row)).toBe(true)
      expect(check({ ...row, TURKPOS_RETVAL_Siparis_ID: '' })).toBe(false)
    })

    // addition: signed callbacks of the other shipped samples, failed 3D included
    it.each([
      ['CS2 failed 3D', CS2],
      ['CS3', CS3],
      ['CS4', CS4],
      ['CS5', CS5],
      ['CP3 3D Pay auth failure', CP3],
      ['CP4 foreign success', CP4],
      ['CP5 foreign failure', CP5],
    ])('verifies %s', (_name, row) => {
      expect(check(row)).toBe(true)
    })

    // addition: P10 md ends in digits and the order id may start with digits, so a re-split verifies too.
    // Accepted by the crypt on purpose: the gateway rejects it (the provision and the status record must show the
    // genuine order), and md cannot be pinned tighter without a live sample.
    it('accepts a re-split of md and the order id (permanent test)', () => {
      expect(check(CS5)).toBe(true)
      expect(check(RP1)).toBe(true)
      expect((RP1.md as string).endsWith('3473:##19010000012024')).toBe(true)
    })

    // deviation: C5 the GUID is the account's, the one inside the callback is not read
    it.each([
      ['CP1', CP1],
      ['CP2', CP2],
    ])('%s: another GUID inside the callback still verifies, another account GUID does not', (_name, row) => {
      expect(check({ ...row, TURKPOS_RETVAL_GUID: '11111111-2222-3333-4444-555555555555' })).toBe(true)
      expect(check({ ...row, TURKPOS_RETVAL_GUID: undefined })).toBe(true)
      const other = AccountFactory.createParamPosAccount(
        'param-pos',
        '10738',
        'Test1',
        'Test2',
        '99999999-aaaa-bbbb-cccc-000000000000',
      )
      expect(check(row, other)).toBe(false)
      expect(check(CS1, other)).toBe(false)
    })

    it('depends on the merchant id for the TURKPOS shape', () => {
      const other = AccountFactory.createParamPosAccount('param-pos', '10739', 'Test1', 'Test2', G)
      expect(check(CP1, other)).toBe(false)
    })

    // addition: hash shape and type
    it.each([
      ['27 characters', 'b1D7+nI3j4k3WGJuhW5IuPOFpEE'],
      ['null', null],
      ['an array', ['b1D7+nI3j4k3WGJuhW5IuPOFpEE=']],
      ['a number', 5],
      ['one character altered', 'b1D7+nI3j4k3WGJuhW5IuPOFpEF='],
      ['lower case', 'b1d7+ni3j4k3wgjuhw5iupofpee='],
      ['empty', ''],
    ])('rejects an islemHash of %s', (_name, hash) => {
      expect(check({ ...CS1, islemHash: hash })).toBe(false)
    })

    it('rejects a missing islemHash and a TURKPOS_RETVAL_Hash of the wrong shape', () => {
      const { islemHash: _drop, ...noHash } = CS1
      expect(check(noHash)).toBe(false)
      expect(check({ ...CP1, TURKPOS_RETVAL_Hash: 'LOpkL9J8vne8E2j0A0HKOhUWGhI' })).toBe(false)
      expect(check({ ...CP1, TURKPOS_RETVAL_Hash: ['LOpkL9J8vne8E2j0A0HKOhUWGhI='] })).toBe(false)
      expect(check({ ...CP1, TURKPOS_RETVAL_Hash: 'LOpkL9J8vne8E2j0A0HKOhUWGhJ=' })).toBe(false)
    })

    it.each([
      ['a number order id', { orderId: 5 }],
      ['an object order id', { orderId: {} }],
      ['an array md', { md: ['x'] }],
      ['a number mdStatus', { mdStatus: 1 }],
      ['an object islemGUID', { islemGUID: { a: 1 } }],
    ])('rejects %s without throwing', (_name, patch) => {
      expect(check({ ...CS1, ...patch })).toBe(false)
    })

    it.each([
      ['a number', { TURKPOS_RETVAL_Siparis_ID: 5 }],
      ['an object', { TURKPOS_RETVAL_Dekont_ID: {} }],
      ['an array', { TURKPOS_RETVAL_Tahsilat_Tutari: ['10,01'] }],
      ['a boolean', { TURKPOS_RETVAL_Islem_ID: true }],
    ])('rejects %s in a TURKPOS field without throwing', (_name, patch) => {
      expect(check({ ...CP1, ...patch })).toBe(false)
    })

    // addition: an absent field counts as empty, like a missing key in the bank's own signature
    it('treats an absent md like an empty one', () => {
      const empty = md('35513153-9902-4a4c-a256-af6ed9cadc52', '', '1', '2025011749D1', '')
      empty.islemHash = S1(`35513153-9902-4a4c-a256-af6ed9cadc521${'2025011749D1'}${G}`)
      expect(check(empty)).toBe(true)
      const { md: _drop, ...absent } = empty
      expect(check(absent)).toBe(true)
      expect(check({ ...empty, md: null })).toBe(true)
    })

    it.each([null, undefined, 'x', 5, [], [CS1], true])('returns false for non-object callback data %j', (data) => {
      expect(check(data)).toBe(false)
    })

    // addition: only own top-level fields are signed
    it('ignores inherited and nested fields', () => {
      const inherited = Object.create({ islemHash: CS1.islemHash, md: MD1 }) as Data
      expect(check(inherited)).toBe(false)
      const nested = { wrap: { ...CS1 } }
      expect(check(nested)).toBe(false)
      const hidden = { ...CS1, md: 'x', nested: { md: MD1 } }
      expect(check(hidden)).toBe(false)
    })

    it('accepts a callback with extra unsigned fields and with the shapes of both present as TURKPOS', () => {
      expect(check({ ...CS1, extra: 'x' })).toBe(true)
      // The TURKPOS shape wins when its hash is present.
      expect(check({ ...CS1, ...CP1 })).toBe(true)
    })

    it('logs only the order id on a failure and nothing secret', () => {
      expect(check({ ...CS1, islemHash: 'b1D7+nI3j4k3WGJuhW5IuPOFpEF=' })).toBe(false)
      expect(logger.error).toHaveBeenCalledTimes(1)
      const [message, context] = logger.error.mock.calls[0] as [string, Record<string, unknown>]
      expect(message).toBe('hash check failed')
      expect(context).toEqual({ order_id: '2025011749D1' })
      const all = JSON.stringify([...logger.debug.mock.calls, ...logger.error.mock.calls, ...logger.info.mock.calls])
      expect(all).not.toContain(G)
      expect(all).not.toContain('b1D7')
      expect(all).not.toContain('Test2')
    })

    it('logs the TURKPOS order id and a long one shortened', () => {
      expect(check({ ...CP1, TURKPOS_RETVAL_Siparis_ID: 'x'.repeat(100) })).toBe(false)
      const [, context] = logger.error.mock.calls[0] as [string, Record<string, unknown>]
      expect(context).toEqual({ order_id: 'x'.repeat(64) })
    })

    it('logs success without data', () => {
      expect(check(CS1)).toBe(true)
      expect(logger.debug).toHaveBeenCalledWith('hash check is successful', expect.anything())
      expect(JSON.stringify(logger.debug.mock.calls)).not.toContain(G)
    })
  })

  describe('createHash', () => {
    const wmd = (extra: Data): Data => ({ TP_WMD_UCD: body(extra) })

    it.each([
      [
        '3d_secure_payment',
        {
          TP_WMD_UCD: body({
            Siparis_ID: '202412293F4E',
            Islem_Tutar: '1.000,01',
            Toplam_Tutar: '1.000,01',
            Taksit: '3',
            Basarili_URL: 'http://localhost/parampos/3d/response.php',
            Hata_URL: 'http://localhost/parampos/3d/response.php',
          }),
        },
        'jsLYSB3lJ81leFgDLw4D8PbXURs=',
      ],
      ['3d_pay', { Pos_Odeme: body() }, 'qsIY8qDvdTsnALe7AYJiEA5kY20='],
      ['3d_pay_installment', { Pos_Odeme: body({ Taksit: '2' }) }, 'zdIBpbUnRfvlCIgHo01yfIfMXXQ='],
      [
        '3d_secure_foreign_currency',
        { TP_Islem_Odeme_WD: body({ Doviz_Kodu: '1001' }) },
        'LFZ+Sl0mW+ybGvLr1u0ehZoxhxM=',
      ],
      ['3d_secure_pre_payment', { TP_Islem_Odeme_OnProv_WMD: body() }, 'LFZ+Sl0mW+ybGvLr1u0ehZoxhxM='],
    ])('testCreateHash %s', (_name, requestData, expected) => {
      expect(crypt.createHash(PA, requestData as Data)).toBe(expected)
    })

    // addition: the 3D Secure mapper rows computed by the real crypt
    it('hashes the 3D Secure and the non-secure request', () => {
      expect(crypt.createHash(PA, wmd({}))).toBe('y2xdHtlV4Hk8QMKE9XDSR/vz6VI=')
      expect(crypt.createHash(PA, wmd({ Islem_Tutar: '100,25', Toplam_Tutar: '100,25' }))).toBe(
        'evC6uS/X/6IMUR/QU9c7jpZi8Jg=',
      )
    })

    it('reads the client code and the GUID from the request, not from the account', () => {
      const other = body({ GUID: 'other-guid' })
      expect(crypt.createHash(PA, { TP_WMD_UCD: other })).toBe(
        S1(`10738other-guid${'1'}${'1000,25'}${'1000,25'}order222`),
      )
    })

    // addition: ISO-8859-9 bytes
    it('hashes a Turkish letter as ISO-8859-9 and refuses a letter that has no such byte', () => {
      expect(crypt.createHash(PA, { TP_Islem_Odeme_WD: body({ Basarili_URL: 'https://domain.com/ş' }) })).toBe(
        'FVv2/EcB5iR61QPFcn5J/82WKw0=',
      )
      expect(() => crypt.createHash(PA, { TP_Islem_Odeme_WD: body({ Basarili_URL: 'https://domain.com/€' }) })).toThrow(
        PosError,
      )
    })

    // addition: nothing is signed as "undefined"
    it.each([
      ['a missing Siparis_ID', { Siparis_ID: undefined }],
      ['an empty Siparis_ID', { Siparis_ID: '' }],
      ['a numeric Islem_Tutar', { Islem_Tutar: 1 }],
      ['a null GUID', { GUID: null }],
      ['a missing G', { G: undefined }],
      ['a G without CLIENT_CODE', { G: { CLIENT_USERNAME: 'x' } }],
      ['a G that is a string', { G: '10738' }],
      ['a missing Taksit', { Taksit: undefined }],
    ])('rejects %s', (_name, patch) => {
      const spy = vi.spyOn(crypt, 'hashString')
      expect(() => crypt.createHash(PA, { Pos_Odeme: body(patch) })).toThrow(PosError)
      for (const call of spy.mock.calls) expect(call[0]).not.toContain('undefined')
    })

    it('never passes "undefined" to hashString for a good request', () => {
      const spy = vi.spyOn(crypt, 'hashString')
      crypt.createHash(PA, wmd({}))
      expect(spy.mock.calls.length).toBeGreaterThan(0)
      for (const call of spy.mock.calls) expect(call[0]).not.toContain('undefined')
    })

    it('does not need Taksit for the foreign currency and pre-authorization bodies', () => {
      const { Taksit: _t, ...noTaksit } = body()
      expect(typeof crypt.createHash(PA, { TP_Islem_Odeme_WD: noTaksit })).toBe('string')
      expect(typeof crypt.createHash(PA, { TP_Islem_Odeme_OnProv_WMD: noTaksit })).toBe('string')
    })

    it.each([
      ['two known bodies', { TP_WMD_UCD: body(), Pos_Odeme: body() }],
      ['an unknown body', { TP_X: body() }],
      ['no body', {}],
      ['a body that is a string', { TP_WMD_UCD: 'x' }],
      ['a body that is an array', { TP_WMD_UCD: [body()] }],
      ['a body that is null', { TP_WMD_UCD: null }],
    ])('rejects %s', (_name, requestData) => {
      expect(() => crypt.createHash(PA, requestData as Data)).toThrow(PosError)
    })

    it('ignores an inherited body', () => {
      const inherited = Object.create({ TP_WMD_UCD: body() }) as Data
      expect(() => crypt.createHash(PA, inherited)).toThrow(PosError)
    })
  })

  describe('create3DHostTransactionId', () => {
    it('HI1', () => {
      expect(crypt.create3DHostTransactionId(HA, 'order222', 100025, '1000')).toBe('7318E87EBF9D8763695AC2B2')
    })

    it('differs when the amount, order id, currency, client code or password changes', () => {
      const base = crypt.create3DHostTransactionId(HA, 'order222', 100025, '1000')
      const ids = [
        crypt.create3DHostTransactionId(HA, 'order222', 100026, '1000'),
        crypt.create3DHostTransactionId(HA, 'order223', 100025, '1000'),
        crypt.create3DHostTransactionId(HA, 'order222', 100025, '1001'),
        crypt.create3DHostTransactionId(
          AccountFactory.createParamPosAccount('param-3d-host-pos', '10738', 'Test1', 'Test3', G, '99001'),
          'order222',
          100025,
          '1000',
        ),
        crypt.create3DHostTransactionId(
          AccountFactory.createParamPosAccount('param-3d-host-pos', '10739', 'Test1', 'Test2', G, '99001'),
          'order222',
          100025,
          '1000',
        ),
      ]
      for (const id of ids) {
        expect(id).toMatch(/^[0-9A-F]{24}$/)
        expect(id).not.toBe(base)
      }
      expect(new Set(ids).size).toBe(ids.length)
    })

    it.each([
      ['an order id with a bar', 'a|b', 100025, '1000'],
      ['an empty order id', '', 100025, '1000'],
      ['a space', 'a b', 100025, '1000'],
      ['a leading dash', '-ab', 100025, '1000'],
      ['65 characters', 'a'.repeat(65), 100025, '1000'],
      ['zero kurus', 'order222', 0, '1000'],
      ['negative kurus', 'order222', -5, '1000'],
      ['fractional kurus', 'order222', 1.5, '1000'],
      ['unsafe kurus', 'order222', 2 ** 53, '1000'],
      ['NaN kurus', 'order222', Number.NaN, '1000'],
      ['a short currency code', 'order222', 100025, '100'],
      ['a long currency code', 'order222', 100025, '10000'],
      ['a letter currency code', 'order222', 100025, 'TRY'],
      ['an empty currency code', 'order222', 100025, ''],
    ])('rejects %s', (_name, orderId, kurus, currency) => {
      expect(() => crypt.create3DHostTransactionId(HA, orderId, kurus, currency)).toThrow(PosError)
    })

    it('rejects non-string inputs', () => {
      const f = crypt.create3DHostTransactionId.bind(crypt) as unknown as (...a: unknown[]) => string
      expect(() => f(HA, 5, 100025, '1000')).toThrow(PosError)
      expect(() => f(HA, 'order222', '100025', '1000')).toThrow(PosError)
      expect(() => f(HA, 'order222', 100025, 1000)).toThrow(PosError)
    })
  })

  it('generateRandomString gives 24 upper case hex digits', () => {
    expect(crypt.generateRandomString()).toMatch(/^[0-9A-F]{24}$/)
  })
})
