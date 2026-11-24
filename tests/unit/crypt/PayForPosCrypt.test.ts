import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayForPosCrypt } from '../../../src/crypt/PayForPosCrypt.js'
import { MissingAccountInfoError, NotImplementedError, PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosLogger } from '../../../src/logger.js'
import type { GatewayResponseData } from '../../../src/types.js'

type MockLogger = { [K in keyof PosLogger]: ReturnType<typeof vi.fn> }

function makeLogger(): MockLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

const account = AccountFactory.createPayForPosAccount(
  'qnbfinansbank-payfor',
  '085300000009704',
  'QNB_API_KULLANICI_3DPAY',
  'UcBN0',
  '12345678',
)

const ziraat = AccountFactory.createPayForPosAccount(
  'ziraat-katilim-payfor',
  '085300000009704',
  'ZIRAATKATILIM_API_KULLANICI_3DPAY',
  'UcBN0',
  '12345678',
  '12',
)

const digest = (algorithm: string, text: string, encoding: 'base64' | 'hex' = 'base64'): string =>
  createHash(algorithm).update(text, 'utf8').digest(encoding)

/** The signing string: merchant, key, order, auth code, return code, 3D status, random, user code. */
const signedText = (
  data: GatewayResponseData,
  merchantPass = '12345678',
  userCode = 'QNB_API_KULLANICI_3DPAY',
): string =>
  `085300000009704${merchantPass}${data.OrderId}${data.AuthCode ?? ''}${data.ProcReturnCode}${data['3DStatus']}${data.ResponseRnd}${userCode}`

const callback = (
  OrderId: string,
  AuthCode: string,
  ProcReturnCode: string,
  status: string,
  ResponseRnd: string,
  ResponseHash: string,
): GatewayResponseData => ({ OrderId, AuthCode, ProcReturnCode, '3DStatus': status, ResponseRnd, ResponseHash })

const formInputs = (): Record<string, string> => ({
  MbrId: '5',
  OrderId: '2020110828BC',
  PurchAmount: '100.01',
  TxnType: 'Auth',
  InstallmentCount: '0',
  OkUrl: 'http://localhost/finansbank-payfor/3d/response.php',
  FailUrl: 'http://localhost/finansbank-payfor/3d/response.php',
  Rnd: '0.43625700 1604831630',
})

const FV1 = 'zmSUxYPhmCj7QOzqpk/28LuE1Oc='

describe('PayForPosCrypt', () => {
  let crypt: PayForPosCrypt
  let logger: MockLogger

  beforeEach(() => {
    logger = makeLogger()
    crypt = new PayForPosCrypt(logger as unknown as PosLogger)
  })

  it('supports only PayForPos', () => {
    expect(PayForPosCrypt.supports('PayForPos')).toBe(true)
    expect(PayForPosCrypt.supports('AssecoPos')).toBe(false)
  })

  it('create3DHash', () => {
    // deviation: F6 (the amount is already a string)
    expect(crypt.create3DHash(account, formInputs())).toBe(FV1)
  })

  it.each([
    [callback('20221031FD04', '', 'V033', '1', 'PF638028511007418219', 'rVcKoOOl3jKukGLHcQaVM6ZuznU=')],
    [callback('2022103114B3', 'S86797', '00', '1', 'PF638028538035077529', 'il/SWNG2llQkLgnCbUG6lPYtlgM=')],
    [callback('2022103121CA', 'S28031', '00', '1', 'PF638028543970517651', 'R3sOuVFWDP8nvu9mtVtvLxwlqow=')],
  ])('check3DHash row %#', (data) => {
    expect(crypt.check3DHash(account, { ...data })).toBe(true)
    expect(crypt.check3DHash(account, { ...data, '3DStatus': '' })).toBe(false)
  })

  it('createHash is not implemented', () => {
    expect(() => crypt.createHash(account, {})).toThrow(NotImplementedError)
  })

  describe('check3DHash fixtures', () => {
    // addition: the SHA-1 hashes the bank really sent, with their real callback fields
    it.each([
      [callback('202210317565', '', 'V034', '-1', 'PF638028527847983529', 'Jzj512Gluz+bmMD8sQYrqCuAQ30=')],
      [callback('20221031CFD0', '', 'V033', '1', 'PF638028524588902912', '6OWhNzqTEXUGkY6HN90QKHdP53c=')],
      [callback('202210317223', '', 'MR15', '-1', 'PF638028540963074026', 'n3zpDnIyZcVRGVowGNuMK4rH3x4=')],
      [callback('202210316DBA', '', 'MR15', '-1', 'PF638028546475263865', '7wnXcENucbamQSSzh95kRA8nzN8=')],
    ])('SHA-1 callback %#', (data) => {
      expect(crypt.check3DHash(account, data)).toBe(true)
    })

    // addition: a 44 character hash is SHA-256 (a callback of 2024 carries no HashType and no AuthCode)
    it('SHA-256 callback without AuthCode', () => {
      const data: GatewayResponseData = {
        OrderId: '202403173F72',
        ProcReturnCode: '101310',
        '3DStatus': '-1',
        ResponseRnd: 'PF638462944484307452',
        ResponseHash: 'wWLUtYZD9VUIi9Pl3mAyS02LLsUxWy6lauMfFBiuVDw=',
      }
      expect(crypt.check3DHash(account, data)).toBe(true)
      expect(crypt.check3DHash(account, { ...data, AuthCode: null as never })).toBe(true)
    })

    // addition: SHA-256 hashes of the real fixtures
    it.each([
      [
        callback(
          '20221031CFD0',
          '',
          'V033',
          '1',
          'PF638028524588902912',
          'L1eivLG7RoNs/YltZqO6amrMgAiks1QUE5MEEEDfusI=',
        ),
      ],
      [
        callback(
          '2022103114B3',
          'S86797',
          '00',
          '1',
          'PF638028538035077529',
          'lzV0xMdHte/DAN7/wj8KYH2ea1z3mv6vky89umDO5+w=',
        ),
      ],
      [
        callback(
          '2022103121CA',
          'S28031',
          '00',
          '1',
          'PF638028543970517651',
          'Rq4uKD1lNC7KcDlQPpbKQHRdFufFUVfjNi0fVo06iAI=',
        ),
      ],
    ])('SHA-256 callback %#', (data) => {
      expect(crypt.check3DHash(account, data)).toBe(true)
      expect(crypt.check3DHash(account, { ...data, ResponseHash: digest('sha1', `${signedText(data)}x`) })).toBe(false)
    })

    // addition: the second account signs with its own user code
    it('uses the account user code', () => {
      const data = callback('2022103114B3', 'S86797', '00', '1', 'PF638028538035077529', 'a97tUevmnGoe7vCsuQ52b8Fyo7U=')
      expect(crypt.check3DHash(ziraat, data)).toBe(true)
      expect(crypt.check3DHash(account, data)).toBe(false)
    })

    // addition: the signed text has no separators, so the hash alone does not pin the field boundaries; the
    // gateway pins the shapes of the fields. This is the genuine signature of a re-split callback.
    it('accepts a re-split callback (the gateway has to pin field shapes)', () => {
      const resplit = callback('20221031CFD', '', '0V033', '1', 'PF638028524588902912', '6OWhNzqTEXUGkY6HN90QKHdP53c=')
      expect(crypt.check3DHash(account, resplit)).toBe(true)
    })

    // addition: a correctly signed callback with 3DStatus 2 is still a valid hash (the gateway decides on status)
    it('verifies the hash of a failed 3D status and of another order', () => {
      expect(
        crypt.check3DHash(
          account,
          callback('2022103114B3', 'S86797', '00', '2', 'PF638028538035077529', 'D6tNwfxFB83dTee3Q6FCqbnIsy8='),
        ),
      ).toBe(true)
      expect(
        crypt.check3DHash(
          account,
          callback('2022103114B4', 'S86797', '00', '1', 'PF638028538035077529', 'GEfGUxjEgSNlJQVs1KcfEtmwFKQ='),
        ),
      ).toBe(true)
    })
  })

  describe('check3DHash rejection', () => {
    const base = (): GatewayResponseData => {
      const data = callback('2022103114B3', 'S86797', '00', '1', 'PF638028538035077529', '')
      data.ResponseHash = digest('sha256', signedText(data))
      return data
    }

    it('the unmodified callback is accepted', () => {
      expect(crypt.check3DHash(account, base())).toBe(true)
    })

    it.each([
      ['a changed order id', { OrderId: '2022103114B4' }],
      ['a changed auth code', { AuthCode: 'S86798' }],
      ['a changed return code', { ProcReturnCode: '01' }],
      ['a changed 3D status', { '3DStatus': '2' }],
      ['a changed random', { ResponseRnd: 'PF638028538035077530' }],
      ['an empty hash', { ResponseHash: '' }],
      ['a missing order id', { OrderId: undefined }],
      ['a missing random', { ResponseRnd: undefined }],
      ['a missing return code', { ProcReturnCode: undefined }],
      ['a missing 3D status', { '3DStatus': undefined }],
      ['a missing hash', { ResponseHash: undefined }],
      ['a numeric 3D status', { '3DStatus': 1 as never }],
      ['an object auth code', { AuthCode: {} as never }],
      ['an array order id', { OrderId: ['2022103114B3'] as never }],
    ])('rejects %s', (_name, change) => {
      const data = { ...base(), ...change } as GatewayResponseData
      expect(crypt.check3DHash(account, data)).toBe(false)
    })

    it('rejects a hash in the wrong case', () => {
      const data = base()
      expect(crypt.check3DHash(account, { ...data, ResponseHash: (data.ResponseHash ?? '').toLowerCase() })).toBe(false)
    })

    // a correct signature of another length is not accepted either
    it('rejects an 88 character SHA-512 hash and a 40 character hex SHA-1', () => {
      const data = base()
      const text = signedText(data)
      const sha512 = digest('sha512', text)
      expect(sha512).toHaveLength(88)
      expect(crypt.check3DHash(account, { ...data, ResponseHash: sha512 })).toBe(false)
      const hex = digest('sha1', text, 'hex')
      expect(hex).toHaveLength(40)
      expect(crypt.check3DHash(account, { ...data, ResponseHash: hex })).toBe(false)
    })

    // addition: the signed text has no separators, so dropping, emptying or wrapping a field merges it into its
    // neighbour while the genuine hash still matches; only the shape checks reject these
    describe('re-split callbacks that keep the genuine hash', () => {
      const GENUINE = 'il/SWNG2llQkLgnCbUG6lPYtlgM='
      const genuine = (): GatewayResponseData =>
        callback('2022103114B3', 'S86797', '00', '1', 'PF638028538035077529', GENUINE)

      it('the genuine callback is accepted', () => {
        expect(crypt.check3DHash(account, genuine())).toBe(true)
      })

      it.each([
        ['missing OrderId merged into AuthCode', { OrderId: undefined, AuthCode: '2022103114B3S86797' }],
        ['empty OrderId merged into AuthCode', { OrderId: '', AuthCode: '2022103114B3S86797' }],
        ['null OrderId merged into AuthCode', { OrderId: null, AuthCode: '2022103114B3S86797' }],
        ['missing ProcReturnCode merged into AuthCode', { ProcReturnCode: undefined, AuthCode: 'S8679700' }],
        ['empty ProcReturnCode merged into 3DStatus', { ProcReturnCode: '', AuthCode: 'S86797', '3DStatus': '001' }],
        ['missing 3DStatus merged into ProcReturnCode', { '3DStatus': undefined, ProcReturnCode: '001' }],
        ['empty 3DStatus merged into ResponseRnd', { '3DStatus': '', ResponseRnd: '1PF638028538035077529' }],
        ['missing ResponseRnd merged into 3DStatus', { ResponseRnd: undefined, '3DStatus': '1PF638028538035077529' }],
        ['empty ResponseRnd merged into 3DStatus', { ResponseRnd: '', '3DStatus': '1PF638028538035077529' }],
        ['array AuthCode', { AuthCode: ['S86797'] }],
        ['array OrderId', { OrderId: ['2022103114B3'] }],
        ['number 3DStatus', { '3DStatus': 1 }],
      ])('rejects %s', (_name, change) => {
        const data = { ...genuine(), ...change } as unknown as GatewayResponseData
        expect(crypt.check3DHash(account, data)).toBe(false)
      })
    })

    it('hashFromParams is not implemented', () => {
      expect(() => crypt.hashFromParams(account, {}, 'a:b')).toThrow(NotImplementedError)
    })

    it('ignores an unsigned hash type and inherited values', () => {
      const data = base()
      expect(crypt.check3DHash(account, { ...data, HashType: 'sha1' })).toBe(true)
      const inherited = Object.create({ OrderId: data.OrderId }) as GatewayResponseData
      Object.assign(inherited, { ...data, OrderId: undefined })
      expect(crypt.check3DHash(account, inherited)).toBe(false)
    })

    it('accepts the right digest of either length and rejects the digest of other text', () => {
      const data = base()
      expect(crypt.check3DHash(account, { ...data, ResponseHash: digest('sha1', signedText(data)) })).toBe(true)
      expect(crypt.check3DHash(account, { ...data, ResponseHash: digest('sha256', signedText(data)) })).toBe(true)
      expect(crypt.check3DHash(account, { ...data, ResponseHash: digest('sha256', `${signedText(data)}x`) })).toBe(
        false,
      )
      expect(crypt.check3DHash(account, { ...data, ResponseHash: digest('sha1', `${signedText(data)}x`) })).toBe(false)
    })

    it('needs the merchant password', () => {
      const noKey = AccountFactory.createPayForPosAccount('qnbfinansbank-payfor', '085300000009704', 'U', 'P')
      expect(() => crypt.check3DHash(noKey, base())).toThrow(MissingAccountInfoError)
      expect(() => crypt.create3DHash(noKey, formInputs())).toThrow(MissingAccountInfoError)
    })

    it('logs only the order id and never the generated hash or a credential', () => {
      const data = { ...base(), ResponseHash: digest('sha256', 'something else') }
      expect(crypt.check3DHash(account, data)).toBe(false)

      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(logger.error.mock.calls[0]?.[1]).toEqual({ order_id: '2022103114B3' })
      const logged = JSON.stringify([...logger.error.mock.calls, ...logger.debug.mock.calls])
      expect(logged).not.toContain(digest('sha256', signedText(base())))
      expect(logged).not.toContain(digest('sha1', signedText(base())))
      expect(logged).not.toContain('12345678')
      expect(logged).not.toContain('UcBN0')
    })

    it('truncates a long order id in the log', () => {
      const data = { ...base(), OrderId: 'A'.repeat(500) }
      expect(crypt.check3DHash(account, data)).toBe(false)
      expect(logger.error.mock.calls[0]?.[1]).toEqual({ order_id: 'A'.repeat(64) })
    })
  })

  describe('create3DHash', () => {
    // addition: the hashes the bank echoes back in its callbacks
    it.each([
      [
        'KuJcFyXYZcW8NetghUN7uBgzQPE=',
        '20221031CFD0',
        'http://localhost/finansbank-payfor/3d/response.php',
        '0',
        '94381aefb4b8865c54cce0a1f1c74f12',
      ],
      [
        'lzsn2UeZpuOabSYTwbVfixk0tbg=',
        '2022103114B3',
        'http://localhost/finansbank-payfor/3d-pay/response.php',
        '2',
        'aff83bea26a1d13a0976f9cb6c14ee27',
      ],
      [
        '7FYgYx1LMSNT8DaZx4yc4GqSdDA=',
        '2022103121CA',
        'http://localhost/finansbank-payfor/3d-host/response.php',
        '3',
        '9e7a88deaf70a148fd40551d69503ba1',
      ],
    ])('reproduces the bank hash %s', (expected, OrderId, url, InstallmentCount, Rnd) => {
      const inputs = { ...formInputs(), OrderId, PurchAmount: '1.01', OkUrl: url, FailUrl: url, InstallmentCount, Rnd }
      expect(crypt.create3DHash(account, inputs)).toBe(expected)
    })

    it.each([
      ['a missing installment count', { InstallmentCount: undefined }],
      ['an empty OkUrl', { OkUrl: '' }],
      ['an undefined Rnd', { Rnd: undefined }],
      ['a missing order id', { OrderId: undefined }],
      ['a numeric amount', { PurchAmount: 100.01 }],
    ])('rejects %s and signs nothing', (_name, change) => {
      const spy = vi.spyOn(crypt, 'hashString')
      const inputs = { ...formInputs(), ...change } as unknown as Record<string, string>
      expect(() => crypt.create3DHash(account, inputs)).toThrow(PosError)
      expect(spy).not.toHaveBeenCalled()
      // the same inputs complete are signed, and the signed string never holds "undefined"
      crypt.create3DHash(account, formInputs())
      expect(spy.mock.calls.every(([text]) => !text.includes('undefined'))).toBe(true)
    })
  })
})
