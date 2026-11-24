import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boaCallbackHash, KuveytPosCrypt } from '../../../src/crypt/KuveytPosCrypt.js'
import { NotImplementedError, PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosLogger } from '../../../src/logger.js'
import type { BoaPosAccount } from '../../../src/model/account/BoaPosAccount.js'
import type { GatewayResponseData } from '../../../src/types.js'

type MockLogger = { [K in keyof PosLogger]: ReturnType<typeof vi.fn> }

function makeLogger(): MockLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

const S1 = (text: string): string => createHash('sha1').update(text, 'utf8').digest('base64')

const KM = AccountFactory.createBoaPosAccount('kuveytpos', '80', 'apiuser', '400235', 'Api123')
const KG = AccountFactory.createBoaPosAccount('kuveytpos', '496', 'apiuser1', '400235', 'Api123')
const KT = AccountFactory.createBoaPosAccount('kuveytpos', '496', 'apitest', '400235', 'api123')
const V = AccountFactory.createBoaPosAccount('vakif-katilim', '1', 'APIUSER', '11111', 'kdsnsksl')

const HP_KT = 'poCqMathhevCYY1LVNbWCQWbC5I='
const HP_KG = 'c77dFssAnYSy6O2MJo+5tMYtGVc='
const HP_V = 'h58bUB83xQz2/21SUeOemUgkF5U='

/** The hash of the three signed callback fields followed by the hashed password. */
const CB = (m: string, r: string, o: string, hp: string): string => S1(m + r + o + hp)

let logger: MockLogger
let crypt: KuveytPosCrypt

/** Callback data is untrusted, so the tests feed it values of every shape. */
const verify = (account: BoaPosAccount, data: Record<string, unknown>): boolean =>
  crypt.check3DHash(account, data as GatewayResponseData)

beforeEach(() => {
  logger = makeLogger()
  crypt = new KuveytPosCrypt(logger as unknown as PosLogger)
})

describe('KuveytPosCrypt (ported)', () => {
  it('supports', () => {
    expect(KuveytPosCrypt.supports('KuveytPos')).toBe(true)
    expect(KuveytPosCrypt.supports('VakifKatilimPos')).toBe(true)
    expect(KuveytPosCrypt.supports('AssecoPos')).toBe(false)
  })

  it('hashString', () => {
    expect(crypt.hashString('123')).toBe('QL0AFWMIX8NRZTKeof9cXsvbvu8=')
  })

  it('create3DHash is not implemented', () => {
    expect(() => crypt.create3DHash(KM, {})).toThrow(NotImplementedError)
  })

  // deviation: B2 the callback check is implemented; an empty callback is unsigned
  it('check3DHash of an empty callback is false', () => {
    expect(verify(KM, {})).toBe(false)
  })

  it.each([
    [
      { MerchantId: '80', UserName: 'apiuser', MerchantOrderId: 'ORDER-123', Amount: 7256 },
      'Bf+hZf2c1gf1pTXnEaSGxDpGRr0=',
    ],
    [
      {
        MerchantId: '80',
        UserName: 'apiuser',
        MerchantOrderId: 'ORDER-123',
        Amount: 7256,
        OkUrl: 'http://localhost:44785/Home/Success',
        FailUrl: 'http://localhost:44785/Home/Fail',
      },
      'P3a0zjAklu2g8XDJfTx2qvwHH8g=',
    ],
  ])('createHash %#', (data, expected) => {
    expect(crypt.createHash(KM, data)).toBe(expected)
  })
})

describe('KuveytPosCrypt.createHash', () => {
  // addition: B2 RV3 request hashes of the Vakif account equal the expected values
  const URL_R = 'http://localhost/finansbank-payfor/3d/response.php'
  it.each([
    [
      'cancel',
      { MerchantId: '1', UserName: 'APIUSER', MerchantOrderId: '2023070849CD', Amount: 101 },
      '/fcrfEy2juD7L/aTujiLgtJg23M=',
    ],
    [
      'pre-auth cancel and refund',
      { MerchantId: '1', UserName: 'APIUSER', MerchantOrderId: '2023070849CD' },
      '2JEWD55cC2JtLJIxM8KDRz2f6hU=',
    ],
    ['status', { MerchantId: '1', UserName: 'APIUSER', MerchantOrderId: 'order-123' }, '4oNmzFPMeC/tOK8i/XCPNy4W+FU='],
    [
      'provision',
      {
        MerchantId: '1',
        UserName: 'APIUSER',
        MerchantOrderId: '2020110828BC',
        Amount: 100,
        OkUrl: URL_R,
        FailUrl: URL_R,
      },
      'sFxxO809/N3Yif4p/js1UKFMRro=',
    ],
    [
      'enrollment',
      {
        MerchantId: '1',
        UserName: 'APIUSER',
        MerchantOrderId: '2020110828BC',
        Amount: 1001,
        OkUrl: 'http://localhost/finansbank-payfor/3d/success.php',
        FailUrl: 'http://localhost/finansbank-payfor/3d/fail.php',
      },
      'xAV9RXTP58Hy+8KYe1VgYDaZFqs=',
    ],
    [
      'non-secure',
      { MerchantId: '1', UserName: 'APIUSER', MerchantOrderId: '123', Amount: 1000 },
      'AYOjSzXn6dgwiV3U0vXzNTWlO8g=',
    ],
    ['post-auth', { MerchantId: '1', UserName: 'APIUSER', MerchantOrderId: '123' }, 'K0LvOf07C/ayD53wWiykcUCZPc8='],
    ['order history', { MerchantId: '1', UserName: 'APIUSER' }, '58xhdJGlgIZtsid8cvSDlr8EItk='],
  ])('RV3 %s', (_n, data, expected) => {
    expect(crypt.createHash(V, data)).toBe(expected)
  })

  // addition: B2 the hashed password is the SHA-1 of the secret
  it('signs the hashed password, never the plain secret', () => {
    const spy = vi.spyOn(crypt, 'hashString')
    crypt.createHash(KM, { MerchantId: '80', UserName: 'apiuser' })
    expect(spy.mock.calls[0]?.[0]).toBe('Api123')
    expect(spy.mock.calls[1]?.[0]).toBe(`80apiuser${HP_KG}`)
  })

  // addition: B2 null counts as absent
  it('Amount null hashes as absent', () => {
    const a = crypt.createHash(KM, { MerchantId: '80', UserName: 'apiuser', Amount: null, OkUrl: null })
    expect(a).toBe(crypt.createHash(KM, { MerchantId: '80', UserName: 'apiuser' }))
  })

  // addition: B2 a number is converted to text
  it('a numeric Amount equals its text', () => {
    expect(crypt.createHash(KM, { MerchantId: '80', UserName: 'apiuser', Amount: 7256 })).toBe(
      crypt.createHash(KM, { MerchantId: '80', UserName: 'apiuser', Amount: '7256' }),
    )
  })

  // addition: B2 a missing value is never signed as "undefined"
  it.each([
    ['MerchantId missing', { UserName: 'apiuser' }],
    ['MerchantId empty', { MerchantId: '', UserName: 'apiuser' }],
    ['MerchantId number', { MerchantId: 80, UserName: 'apiuser' }],
    ['UserName missing', { MerchantId: '80' }],
    ['UserName empty', { MerchantId: '80', UserName: '' }],
    ['UserName null', { MerchantId: '80', UserName: null }],
    ['Amount boolean', { MerchantId: '80', UserName: 'apiuser', Amount: true }],
    ['OkUrl object', { MerchantId: '80', UserName: 'apiuser', OkUrl: {} }],
    ['FailUrl array', { MerchantId: '80', UserName: 'apiuser', FailUrl: ['x'] }],
    ['MerchantOrderId object', { MerchantId: '80', UserName: 'apiuser', MerchantOrderId: { a: 1 } }],
    ['Amount NaN', { MerchantId: '80', UserName: 'apiuser', Amount: Number.NaN }],
    ['Amount Infinity', { MerchantId: '80', UserName: 'apiuser', Amount: Number.POSITIVE_INFINITY }],
  ])('%s -> PosError, nothing hashed as "undefined"', (_n, data) => {
    const spy = vi.spyOn(crypt, 'hashString')
    expect(() => crypt.createHash(KM, data as Record<string, unknown>)).toThrow(PosError)
    for (const call of spy.mock.calls) expect(call[0]).not.toContain('undefined')
  })

  // addition: B2 inherited members are not request data
  it('inherited fields are not read', () => {
    const data = Object.create({ MerchantId: '80', UserName: 'apiuser' }) as Record<string, unknown>
    expect(() => crypt.createHash(KM, data)).toThrow(PosError)
  })
})

describe('KuveytPosCrypt callback signature', () => {
  const CV1 = {
    MerchantOrderId: '2024042111A0',
    ResponseCode: '00',
    OrderId: '155767806',
    HashData: 'dlO20ZLqs4W5FfgY0VmUSBUpwoM=',
  }

  // addition: CV1 genuine Kuveyt TDV2 callback
  it('CV1 genuine callback verifies', () => {
    expect(verify(KT, { ...CV1, MD: 'x', VPosMessage: { Amount: '1' } })).toBe(true)
    expect(CB('2024042111A0', '00', '155767806', HP_KT)).toBe(CV1.HashData)
  })

  // addition: CV2 genuine classic Kuveyt callback
  it('CV2 boaCallbackHash', () => {
    expect(boaCallbackHash('Hiorgg24rNeRdHUvMCg//mOJn4U=', 'MP-15', '00', '86483278')).toBe(
      'mOw0JGvy1JVWqDDmFyaDTvKz9Fk=',
    )
  })

  // addition: CV3 genuine Vakif callbacks
  it('CV3 genuine Vakif callbacks', () => {
    const hp = 'DoxoW84N1hKFdV09SF4/FruhHm8='
    expect(boaCallbackHash(hp, '2024070152BF', '00', '6373034')).toBe('tilHwVYboCx82++WZXg0I81LW6w=')
    expect(boaCallbackHash(hp, '20240701F2F6', 'MPIAuthenticationStatusN', '0')).toBe('SVdI+hHXxg8GO0wY0hAcfRWpHyo=')
  })

  // addition: KS1-KS3, VS1-VS3 with their accounts
  it.each([
    ['KS1', KG, 'MP-15', '00', '86483278', 'fKhJ/ZYX0uG42wAVd4Eiff3KDAU='],
    ['KS2', KG, '2024042111A0', '00', '155767806', 'xg2w5Ag0VAzlgVi+SfQdfVhPvaQ='],
    ['KS3', KG, '2020110828BC', 'HashDataError', '0', 'aSsSPGkfWmsIyydlSiG700uT0Mk='],
    ['VS1', V, '2024070152BF', '00', '6373034', 'liWp8z35PbP2d4OYaoEDW3yY6IE='],
    ['VS2', V, '20240701F2F6', 'MPIAuthenticationStatusN', '0', 'Tu83EVuM6lhmSlsFkIA1AbexU6M='],
    ['VS3', V, '202407019FDB', '00', '6373641', 'M49Yh3MBXwWPKz8slNJDPdksIhs='],
  ])('%s verifies', (_n, account, m, r, o, hash) => {
    expect(verify(account, { MerchantOrderId: m, ResponseCode: r, OrderId: o, HashData: hash })).toBe(true)
  })

  const GOOD = (): Record<string, unknown> => ({ ...CV1 })

  // addition: B2 a forged or malformed signature
  it.each([
    ['altered', { HashData: 'dlO20ZLqs4W5FfgY0VmUSBUpwoN=' }],
    ['lower-cased', { HashData: CV1.HashData.toLowerCase() }],
    ['27 chars', { HashData: CV1.HashData.slice(0, 27) }],
    ['29 chars', { HashData: `${CV1.HashData}A` }],
    ['null', { HashData: null }],
    ['empty', { HashData: '' }],
    ['absent', { HashData: undefined }],
    ['array', { HashData: [CV1.HashData] }],
    ['object', { HashData: { a: CV1.HashData } }],
    ['trailing space', { HashData: `${CV1.HashData} ` }],
    ['no padding', { HashData: 'dlO20ZLqs4W5FfgY0VmUSBUpwoMA' }],
  ])('HashData %s -> false', (_n, patch) => {
    const data = { ...GOOD(), ...patch }
    expect(verify(KT, data)).toBe(false)
  })

  // addition: B2 a wrong or non-string signed field
  it.each([
    ['MerchantOrderId number', { MerchantOrderId: 2024042111 }],
    ['MerchantOrderId object', { MerchantOrderId: { a: '2024042111A0' } }],
    ['MerchantOrderId array', { MerchantOrderId: ['2024042111A0'] }],
    ['MerchantOrderId null', { MerchantOrderId: null }],
    ['MerchantOrderId missing', { MerchantOrderId: undefined }],
    ['ResponseCode missing', { ResponseCode: undefined }],
    ['ResponseCode null', { ResponseCode: null }],
    ['ResponseCode number', { ResponseCode: 0 }],
    ['OrderId missing', { OrderId: undefined }],
    ['OrderId number', { OrderId: 155767806 }],
    ['OrderId array', { OrderId: ['155767806'] }],
    ['OrderId changed', { OrderId: '155767807' }],
    ['MerchantOrderId changed', { MerchantOrderId: '2024042111A1' }],
  ])('%s -> false and never throws', (_n, patch) => {
    const data = { ...GOOD(), ...patch }
    expect(verify(KT, data)).toBe(false)
  })

  // addition: B2 inherited members are not callback data
  it('inherited callback fields are not read', () => {
    const data = Object.create(GOOD()) as Record<string, unknown>
    expect(verify(KT, data)).toBe(false)
  })

  // addition: B2 each signed field and the signature on its own inherited, the rest own
  it.each(['HashData', 'MerchantOrderId', 'ResponseCode', 'OrderId'])('an inherited %s is not read', (name) => {
    const all = GOOD()
    const own = { ...all }
    delete own[name]
    const data = Object.assign(Object.create({ [name]: all[name] }) as Record<string, unknown>, own)
    expect(data[name]).toBe(all[name])
    expect(verify(KT, data)).toBe(false)
  })

  // addition: B2 the fields are matched by exact name
  it('differently cased names are not read', () => {
    expect(
      verify(KT, {
        merchantorderid: CV1.MerchantOrderId,
        responsecode: CV1.ResponseCode,
        orderid: CV1.OrderId,
        hashdata: CV1.HashData,
      }),
    ).toBe(false)
  })

  // addition: B2 the other merchant's password does not verify
  it('account KM (other password) on a KT callback -> false', () => {
    expect(verify(KM, GOOD())).toBe(false)
    expect(verify(V, GOOD())).toBe(false)
  })

  // addition: B5 the signed values carry no separators. BP1 and BP2 are genuine hashes that re-read as other fields
  it('BP1 and BP2 both readings verify (the gateway pins and confirms)', () => {
    expect(CB('A001', '00', '5000', HP_V)).toBe('/WQ7tidBSATFRSQfgbHJkElx+VY=')
    expect(CB('A', '00', '1005000', HP_V)).toBe('/WQ7tidBSATFRSQfgbHJkElx+VY=')
    expect(CB('B100', '51', '0', HP_V)).toBe('gpWj+xZY1T1Z6pCTLWtr/zNaCTA=')
    expect(CB('B1', '00', '510', HP_V)).toBe('gpWj+xZY1T1Z6pCTLWtr/zNaCTA=')
    const hash = '/WQ7tidBSATFRSQfgbHJkElx+VY='
    expect(verify(V, { MerchantOrderId: 'A001', ResponseCode: '00', OrderId: '5000', HashData: hash })).toBe(true)
    expect(verify(V, { MerchantOrderId: 'A', ResponseCode: '00', OrderId: '1005000', HashData: hash })).toBe(true)
    const hash2 = 'gpWj+xZY1T1Z6pCTLWtr/zNaCTA='
    expect(verify(V, { MerchantOrderId: 'B100', ResponseCode: '51', OrderId: '0', HashData: hash2 })).toBe(true)
    expect(verify(V, { MerchantOrderId: 'B1', ResponseCode: '00', OrderId: '510', HashData: hash2 })).toBe(true)
  })

  // addition: B5 re-splits that keep the genuine HashData. Where a field is moved into a neighbour the crypt can
  // reject only the shapes that are not strings; the rest is accepted by the crypt and left to the gateway pins.
  describe('re-splits that keep the genuine HashData', () => {
    const hash = CB('A001', '00', '5000', HP_V)
    const check = (data: Record<string, unknown>): boolean => verify(V, { HashData: hash, ...data })

    // rejected by the crypt: a signed field that is not an own string
    it.each([
      ['ResponseCode merged into MerchantOrderId (absent)', { MerchantOrderId: 'A00100', OrderId: '5000' }],
      [
        'ResponseCode merged into MerchantOrderId (null)',
        { MerchantOrderId: 'A00100', ResponseCode: null, OrderId: '5000' },
      ],
      ['OrderId merged into ResponseCode (absent)', { MerchantOrderId: 'A001', ResponseCode: '005000' }],
      ['OrderId merged into ResponseCode (null)', { MerchantOrderId: 'A001', ResponseCode: '005000', OrderId: null }],
      ['MerchantOrderId merged into ResponseCode (absent)', { ResponseCode: 'A001005000', OrderId: '' }],
      ['everything in OrderId', { OrderId: 'A001005000' }],
      ['ResponseCode as array', { MerchantOrderId: 'A001', ResponseCode: ['00'], OrderId: '5000' }],
      ['OrderId as array', { MerchantOrderId: 'A001', ResponseCode: '00', OrderId: ['5000'] }],
      ['OrderId as number', { MerchantOrderId: 'A001', ResponseCode: '00', OrderId: 5000 }],
    ])('crypt rejects: %s', (_n, data) => {
      expect(check(data)).toBe(false)
    })

    // accepted by the crypt; the gateway rejects (its order id, bank id and status pins decide)
    it.each([
      [
        'empty ResponseCode and OrderId, all text in MerchantOrderId',
        { MerchantOrderId: 'A001005000', ResponseCode: '', OrderId: '' },
      ],
      [
        'empty MerchantOrderId, all text in ResponseCode',
        { MerchantOrderId: '', ResponseCode: 'A0010050', OrderId: '00' },
      ],
      ['empty MerchantOrderId, all text in OrderId', { MerchantOrderId: '', ResponseCode: '', OrderId: 'A001005000' }],
      ['approval code moved into the order id', { MerchantOrderId: 'A00', ResponseCode: '10', OrderId: '05000' }],
      ['bank id grown into the order id', { MerchantOrderId: 'A0010050', ResponseCode: '00', OrderId: '' }],
    ])('accepted by the crypt; the gateway rejects: %s', (_n, data) => {
      expect(check(data)).toBe(true)
    })
  })

  // addition: B2 failure logging names the order only
  it('a failed check logs the order id and nothing else sensitive', () => {
    const data = {
      ...GOOD(),
      HashData: 'dlO20ZLqs4W5FfgY0VmUSBUpwoN=',
      MD: 'secret-md',
      VPosMessage: { HashPassword: HP_KT },
    }
    expect(verify(KT, data)).toBe(false)
    expect(logger.error).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify([
      logger.debug.mock.calls,
      logger.error.mock.calls,
      logger.warn.mock.calls,
      logger.info.mock.calls,
    ])
    expect(logger.error.mock.calls[0]?.[1]).toStrictEqual({ order_id: '2024042111A0' })
    for (const secret of [CV1.HashData, 'api123', HP_KT, 'secret-md', 'dlO20ZLqs4W5FfgY0VmUSBUpwoN=']) {
      expect(logged).not.toContain(secret)
    }
  })

  it('a successful check logs the order id only', () => {
    expect(verify(KT, GOOD())).toBe(true)
    const logged = JSON.stringify([logger.debug.mock.calls, logger.error.mock.calls])
    expect(logger.error).not.toHaveBeenCalled()
    for (const secret of [CV1.HashData, 'api123', HP_KT]) expect(logged).not.toContain(secret)
  })

  it('a failed check on a long or missing order id logs at most 64 characters', () => {
    const long = 'x'.repeat(200)
    verify(KT, { ...GOOD(), MerchantOrderId: undefined, OrderId: long, HashData: 'a' })
    expect(logger.error.mock.calls[0]?.[1]).toStrictEqual({ order_id: undefined })
    verify(KT, { ...GOOD(), MerchantOrderId: long, HashData: 'a' })
    const ctx = logger.error.mock.calls[1]?.[1] as { order_id?: string }
    expect(ctx.order_id).toHaveLength(64)
  })

  // addition: B2 the callback hash helper is deterministic and signs the password last
  it('boaCallbackHash concatenates without separators', () => {
    expect(boaCallbackHash('p', 'a', 'b', 'c')).toBe(S1('abcp'))
  })
})
