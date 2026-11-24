import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CALLBACK_MAC_PARAMS, PosNetV1PosCrypt } from '../../../src/crypt/PosNetV1PosCrypt.js'
import { MissingAccountInfoError, PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosLogger } from '../../../src/logger.js'
import type { GatewayResponseData } from '../../../src/types.js'

const KEY = '10,10,10,10,10,10,10,10'
const account = AccountFactory.createPosNetPosAccount('albaraka', '6700950031', '67540050', '1010272261352072', KEY)

type MockLogger = { [K in keyof PosLogger]: ReturnType<typeof vi.fn> }

function makeLogger(): MockLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

const h = (text: string): string => createHash('sha256').update(text, 'utf8').digest('base64')

const success1 = (): GatewayResponseData => ({
  ECI: '02',
  CAVV: 'jKOBaLBL3hQ+CREBPu1HBQQAAAA=',
  MdStatus: '1',
  MdErrorMessage: 'Authenticated',
  MD: '0161010028947569644,0161010028947569644',
  SecureTransactionId: '1010028947569644',
  Mac: 'r21kMm4nMqvJakjq47Jl+3fk2xrFPrDoTJFQGxkgkfk=',
  MacParams: 'ECI:CAVV:MdStatus:MdErrorMessage:MD:SecureTransactionId',
  OrderId: '123',
})

// the declined callback the bank sent for a failed authentication (CAVV is null)
const declined = (): GatewayResponseData => ({
  ECI: '07',
  CAVV: null as never,
  MdStatus: '0',
  MdErrorMessage: 'Not authenticated',
  MD: '0161010063138198543',
  SecureTransactionId: '1010063138198543',
  Mac: 'ltpqSazdMf67AjmWF0WQ5pOU78F+kjrfkyz7ex+ZvNg=',
  MacParams: 'ECI:CAVV:MdStatus:MdErrorMessage:MD:SecureTransactionId',
  OrderId: '0000000020230622A1C9',
})

const success2 = (): GatewayResponseData => ({
  ECI: '05',
  CAVV: 'AAIBAACZZAAAAABllJFzdQAAAAA=',
  MdStatus: '1',
  MdErrorMessage: 'Y-status/Challenge authentication via ACS: https://certemvacs.bkm.com.tr/acs/creq',
  MD: '0161010063138203939',
  SecureTransactionId: '1010063138203939',
  Mac: 'aw2jry3dZbmDMvIfuyx3sixxY50ysnRhaR3kOXHLJRw=',
  MacParams: 'ECI:CAVV:MdStatus:MdErrorMessage:MD:SecureTransactionId',
  OrderId: '00000000202306226A90',
})

/** The same signature the bank makes: the six values in the pinned order, no separators, then the key. */
function sign(values: (string | null)[]): string {
  return h(`${values.map((v) => v ?? '').join('')}${KEY}`)
}

describe('PosNetV1PosCrypt', () => {
  let logger: MockLogger
  let crypt: PosNetV1PosCrypt

  beforeEach(() => {
    logger = makeLogger()
    crypt = new PosNetV1PosCrypt(logger as unknown as PosLogger)
  })

  it('supports only PosNetV1Pos', () => {
    expect(PosNetV1PosCrypt.supports('PosNetV1Pos')).toBe(true)
    expect(PosNetV1PosCrypt.supports('AssecoPos')).toBe(false)
    expect(PosNetV1PosCrypt.supports('PosNetPos')).toBe(false)
  })

  it('exports the pinned callback signature list', () => {
    expect(CALLBACK_MAC_PARAMS).toBe('ECI:CAVV:MdStatus:MdErrorMessage:MD:SecureTransactionId')
  })

  it.each([
    [
      {
        MACParams: 'MerchantNo:TerminalNo:ReferenceCode:OrderId',
        MerchantNo: '6700950031',
        TerminalNo: '67540050',
        ReferenceCode: '021459486690000191',
        OrderId: null,
      },
      'qhLo/2Ro+vT81i0SMV/VHifDV9VzQQgK+7d8hlId9YM=',
    ],
    [
      {
        MerchantNo: '6700950031',
        TerminalNo: '67540050',
        MACParams: 'MerchantNo:TerminalNo:CardNo:Cvc2:ExpireDate:Amount',
        CardInformationData: { Amount: '175', CardNo: '5400619360964581', ExpireDate: '2001', Cvc2: '056' },
      },
      'xuhPbpcPJ6kVs7JeIXS8f06Cv0mb9cNPMfjp1HiB7Ew=',
    ],
  ])('hashFromParams row %#', (data, expected) => {
    expect(crypt.hashFromParams(account, data, data.MACParams, ':')).toBe(expected)
  })

  it('hashFromParams rejects an empty parameter list', () => {
    // deviation: P28 (error class)
    expect(() => crypt.hashFromParams(account, {}, '', ':')).toThrow(PosError)
    expect(() => crypt.hashFromParams(account, {}, '', ':')).toThrow('hashParamsValue cannot be empty')
  })

  it.each([
    ['1', 'kAKxvbwXvmrM6lapGx1UcRTs454tsSuPrBXV7oA7L7w='],
    ['', 'RRYxriTO++OHc4cQ3VIp0z9HMrFy/Msm3Dw2t+sEXCA='],
  ])('createHash with MdStatus %j', (mdStatus, expected) => {
    expect(
      crypt.createHash(account, {
        MerchantNo: '6700950031',
        TerminalNo: '67540050',
        ThreeDSecureData: {
          MerchantNo: '6700950031',
          TerminalNo: '67540050',
          SecureTransactionId: '1010028947569644',
          CavvData: 'jKOBaLBL3hQ+CREBPu1HBQQAAAA=',
          Eci: '02',
          MdStatus: mdStatus,
        },
      }),
    ).toBe(expected)
  })

  it('create3DHash signs the card form', () => {
    expect(
      crypt.create3DHash(account, {
        MerchantNo: '6700950031',
        TerminalNo: '67540050',
        Amount: '175',
        CardNo: '5400619360964581',
        ExpiredDate: '2001',
        Cvv: '056',
      }),
    ).toBe('xuhPbpcPJ6kVs7JeIXS8f06Cv0mb9cNPMfjp1HiB7Ew=')
  })

  it('check3DHash accepts the bank MAC and rejects an empty ECI', () => {
    expect(crypt.check3DHash(account, success1())).toBe(true)
    expect(crypt.check3DHash(account, { ...success1(), ECI: '' })).toBe(false)
  })

  // addition: all three bank callbacks, fail-closed behaviour, planning vectors
  describe('check3DHash additions', () => {
    it.each([
      ['successful callback', success1],
      ['declined callback with CAVV null', declined],
      ['challenge callback with a long message', success2],
    ])('verifies the %s', (_name, make) => {
      expect(crypt.check3DHash(account, make())).toBe(true)
    })

    it('verifies a callback whose CAVV is absent', () => {
      const data = declined()
      delete data.CAVV
      expect(crypt.check3DHash(account, data)).toBe(true)
    })

    it('also verifies the re-split declined callback: the MAC is genuine, so the format rule in the gateway is what stops it', () => {
      // The same characters, cut at other places: only the signature of the concatenation matters here.
      const resplit: GatewayResponseData = {
        ...declined(),
        CAVV: '0Not authenticated0',
        MdStatus: '1',
        MdErrorMessage: '',
        MD: '61010063138198543',
      }
      expect(crypt.check3DHash(account, resplit)).toBe(true)
    })

    it('rejects a MacParams list in another order', () => {
      const data = success1()
      const reordered = 'CAVV:ECI:MdStatus:MdErrorMessage:MD:SecureTransactionId'
      data.MacParams = reordered
      data.Mac = sign([
        data.CAVV as string,
        data.ECI as string,
        '1',
        'Authenticated',
        data.MD as string,
        data.SecureTransactionId as string,
      ])
      expect(crypt.check3DHash(account, data)).toBe(false)
    })

    it('rejects a MacParams subset even with a matching MAC', () => {
      const data = success1()
      data.MacParams = 'MdStatus:SecureTransactionId'
      data.Mac = sign(['1', '1010028947569644'])
      expect(crypt.check3DHash(account, data)).toBe(false)
    })

    it('rejects a lower-cased Mac', () => {
      const data = success1()
      data.Mac = (data.Mac as string).toLowerCase()
      expect(crypt.check3DHash(account, data)).toBe(false)
    })

    it.each(['Mac', 'MacParams'])('rejects a callback without %s', (name) => {
      const data = success1()
      delete data[name]
      expect(crypt.check3DHash(account, data)).toBe(false)
    })

    it.each(['Mac', 'MacParams'])('rejects an empty %s', (name) => {
      expect(crypt.check3DHash(account, { ...success1(), [name]: '' })).toBe(false)
    })

    it('rejects a MacParams list that is not the pinned one even when the MAC is the genuine one', () => {
      expect(crypt.check3DHash(account, { ...success1(), MacParams: 'MdStatus:SecureTransactionId' })).toBe(false)
      expect(crypt.check3DHash(account, { ...success1(), MacParams: `${CALLBACK_MAC_PARAMS}:OrderId` })).toBe(false)
      expect(
        crypt.check3DHash(account, {
          ...success1(),
          MacParams: 'CAVV:ECI:MdStatus:MdErrorMessage:MD:SecureTransactionId',
        }),
      ).toBe(false)
    })

    it('rejects an object or array where a signed value belongs, even when its text would give a valid MAC, and does not throw', () => {
      // 'x' signed as CAVV; an array holding 'x' turns into the same text if it is ever cast
      const text: GatewayResponseData = { ...success1(), CAVV: 'x' }
      text.Mac = sign(['02', 'x', '1', 'Authenticated', text.MD as string, text.SecureTransactionId as string])
      expect(crypt.check3DHash(account, text)).toBe(true)
      expect(crypt.check3DHash(account, { ...text, CAVV: ['x'] as never })).toBe(false)
      expect(crypt.check3DHash(account, { ...text, CAVV: { toString: () => 'x' } as never })).toBe(false)
      expect(crypt.check3DHash(account, { ...success1(), CAVV: { a: 1 } as never })).toBe(false)
    })

    it('rejects a number where a string belongs, even when its text would give a valid MAC', () => {
      expect(crypt.check3DHash(account, { ...success1(), MdStatus: 1 as never })).toBe(false)
    })

    it('ignores inherited and nested values', () => {
      const data = success1()
      delete data.SecureTransactionId
      expect(
        crypt.check3DHash(account, { ...data, nested: { SecureTransactionId: '1010028947569644' } } as never),
      ).toBe(false)
    })

    it('rejects a tampered MdErrorMessage', () => {
      expect(crypt.check3DHash(account, { ...success1(), MdErrorMessage: 'Authenticated ' })).toBe(false)
    })

    it('does not log the generated MAC or the key', () => {
      crypt.check3DHash(account, { ...success1(), MD: 'tampered' })
      crypt.check3DHash(account, success1())
      const logged = JSON.stringify([...logger.error.mock.calls, ...logger.debug.mock.calls])
      expect(logged).not.toContain(KEY)
      expect(logged).not.toContain(
        sign(['02', 'jKOBaLBL3hQ+CREBPu1HBQQAAAA=', '1', 'Authenticated', 'tampered', '1010028947569644']),
      )
      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(logger.error.mock.calls[0]?.[1]).toEqual({ order_id: '123' })
    })

    it('a missing secret is a configuration error', () => {
      const noSecret = AccountFactory.createPosNetPosAccount('albaraka', '6700950031', '67540050', '1010272261352072')
      expect(() => crypt.check3DHash(noSecret, success1())).toThrow(MissingAccountInfoError)
    })
  })

  describe('create3DHash additions', () => {
    it('signs the host-page form (no card)', () => {
      expect(crypt.create3DHash(account, { MerchantNo: '6700950031', TerminalNo: '67540050', Amount: '29' })).toBe(
        'myI7crNpAToKnoldyv0Z9x89MhFu0Ix9EwOTpgxPqf0=',
      )
    })

    it('rejects a card number without a cvv', () => {
      expect(() =>
        crypt.create3DHash(account, {
          MerchantNo: '6700950031',
          TerminalNo: '67540050',
          Amount: '29',
          CardNo: '5400619360964581',
        }),
      ).toThrow(PosError)
    })

    it('rejects an empty card field', () => {
      expect(() =>
        crypt.create3DHash(account, {
          MerchantNo: '6700950031',
          TerminalNo: '67540050',
          Amount: '29',
          CardNo: '5400619360964581',
          Cvv: '',
          ExpiredDate: '2001',
        }),
      ).toThrow(PosError)
    })

    it.each(['MerchantNo', 'TerminalNo', 'Amount'])('rejects a missing or empty %s', (name) => {
      const inputs: Record<string, string> = { MerchantNo: '6700950031', TerminalNo: '67540050', Amount: '29' }
      inputs[name] = ''
      expect(() => crypt.create3DHash(account, inputs)).toThrow(PosError)
      delete inputs[name]
      expect(() => crypt.create3DHash(account, inputs)).toThrow(PosError)
    })

    it('a missing secret is a configuration error', () => {
      const noSecret = AccountFactory.createPosNetPosAccount('albaraka', '6700950031', '67540050', '1010272261352072')
      expect(() => crypt.create3DHash(noSecret, { MerchantNo: '1', TerminalNo: '2', Amount: '3' })).toThrow(
        MissingAccountInfoError,
      )
    })
  })

  describe('createHash additions', () => {
    const request = (three: unknown) => ({ MerchantNo: '6700950031', TerminalNo: '67540050', ThreeDSecureData: three })

    it('needs the 3D data', () => {
      expect(() => crypt.createHash(account, { MerchantNo: '6700950031', TerminalNo: '67540050' })).toThrow(PosError)
      expect(() => crypt.createHash(account, request(null))).toThrow(PosError)
    })

    it('signs a numeric MdStatus and a null CavvData like the bank text', () => {
      const withNumber = crypt.createHash(
        account,
        request({ SecureTransactionId: '1', CavvData: null, Eci: '07', MdStatus: 1 }),
      )
      expect(withNumber).toBe(h(['6700950031', '67540050', '1', '', '07', '1', KEY].join('')))
    })

    it('rejects a nested value instead of signing "Array"', () => {
      expect(() =>
        crypt.createHash(account, request({ SecureTransactionId: ['1'], CavvData: '', Eci: '07', MdStatus: 1 })),
      ).toThrow(PosError)
    })

    it('rejects a missing merchant or terminal number', () => {
      expect(() =>
        crypt.createHash(account, {
          TerminalNo: '67540050',
          ThreeDSecureData: { SecureTransactionId: '1', CavvData: '', Eci: '07', MdStatus: 1 },
        }),
      ).toThrow(PosError)
    })

    it('a missing secret is a configuration error', () => {
      const noSecret = AccountFactory.createPosNetPosAccount('albaraka', '6700950031', '67540050', '1010272261352072')
      expect(() =>
        crypt.createHash(noSecret, request({ SecureTransactionId: '1', CavvData: '', Eci: '07', MdStatus: 1 })),
      ).toThrow(MissingAccountInfoError)
    })
  })
})
