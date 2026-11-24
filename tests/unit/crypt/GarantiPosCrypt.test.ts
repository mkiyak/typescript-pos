import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GarantiPosCrypt } from '../../../src/crypt/GarantiPosCrypt.js'
import { MissingAccountInfoError, PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosLogger } from '../../../src/logger.js'
import type { GatewayResponseData } from '../../../src/types.js'

const account = AccountFactory.createGarantiPosAccount(
  'garanti',
  '7000679',
  'PROVAUT',
  '123qweASD/',
  '30691298',
  '12345678',
  'PROVRFN',
  '123qweASD/',
)

type MockLogger = { [K in keyof PosLogger]: ReturnType<typeof vi.fn> }

function makeLogger(): MockLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

const callbackData = (): GatewayResponseData => ({
  xid: 'f3ec4783-f48c-475c-a59c-ab25f3170ec5',
  mdstatus: '1',
  mderrormessage: 'Y-status/Challenge authentication via ACS: https://gbemv3dsecure.garanti.com.tr/web/creq',
  txnstatus: '',
  eci: '02',
  cavv: 'xgRlQDz4AAAAAAAAAAAAAAAAAAA=',
  paressyntaxok: '',
  paresverified: '',
  version: '',
  ireqcode: '',
  ireqdetail: '',
  vendorcode: '',
  cavvalgorithm: '',
  md: 'aW5kZXg6MDJ6LjAI5iAcKf/ilXjYIOnTh4t+deHrtwO8ze7tPTL1YCDcBe8KEpuq6HDLYbqQSluL7p3kGcpFzX9s9XcegNhHMsDszxqGd33+p+p5sULGrDF3J2GGfiJDwan4ku7+eiTyS8x2xS9pUy7PTgMGc6jw94aLfXLHskhvY7FYWrymzQ==',
  terminalid: '30691298',
  oid: '2023100354BB',
  authcode: '',
  response: '',
  errmsg: '',
  hostmsg: '',
  procreturncode: '',
  transid: '2023100354BB',
  hostrefnum: '',
  rnd: 'kW094tPzNEhqORzzCsLB',
  hash: '416B6253425E73184F118CC02E3BAA393622059BF6B0865D83F501E55A61339B9EC659CBCF7297EDECC1B17BF6281D90CC0AD8EDF3E1EFE94432ACCEAF79B26E',
  hashparams: 'clientid:oid:authcode:procreturncode:response:mdstatus:cavv:eci:md:rnd:',
  hashparamsval:
    '306912982023100354BB1xgRlQDz4AAAAAAAAAAAAAAAAAAA=02aW5kZXg6MDJ6LjAI5iAcKf/ilXjYIOnTh4t+deHrtwO8ze7tPTL1YCDcBe8KEpuq6HDLYbqQSluL7p3kGcpFzX9s9XcegNhHMsDszxqGd33+p+p5sULGrDF3J2GGfiJDwan4ku7+eiTyS8x2xS9pUy7PTgMGc6jw94aLfXLHskhvY7FYWrymzQ==kW094tPzNEhqORzzCsLB',
  clientid: '30691298',
  MaskedPan: '54066975****1173',
  apiversion: '512',
  orderid: '2023100354BB',
  txninstallmentcount: '',
  terminaluserid: 'PROVAUT',
  secure3dhash:
    'B0EE6F6405ABB6EF014D802880EF3DC72CEA1EFD16E7E346A4CD6F6EE6ED2148FA8DCFD703EAEA9C154C7C200CF42D00A874832D6D3F22F9447EDF241D540286',
  secure3dsecuritylevel: '3D',
  txncurrencycode: '949',
  customeremailaddress: 'mail@customer.com',
  errorurl: 'http://localhost/garanti/3d/response.php',
  terminalmerchantid: '7000679',
  mode: 'TEST',
  terminalprovuserid: 'PROVAUT',
  txnamount: '101',
  successurl: 'http://localhost/garanti/3d/response.php',
  txntype: 'sales',
  customeripaddress: '172.26.0.1',
})

const request = (type: string, orderId: string | null, amount: number) => ({
  Terminal: { ID: '30691298' },
  Order: { OrderID: orderId },
  Transaction: { Type: type, Amount: amount, CurrencyCode: '949' },
})

describe('GarantiPosCrypt', () => {
  let crypt: GarantiPosCrypt
  let logger: MockLogger

  beforeEach(() => {
    logger = makeLogger()
    crypt = new GarantiPosCrypt(logger as unknown as PosLogger)
  })

  it('supports only GarantiPos', () => {
    expect(GarantiPosCrypt.supports('GarantiPos')).toBe(true)
    expect(GarantiPosCrypt.supports('AssecoPos')).toBe(false)
  })

  it('check3DHash accepts the signed callback and rejects it once mdstatus changes', () => {
    expect(crypt.check3DHash(account, callbackData())).toBe(true)
    expect(crypt.check3DHash(account, { ...callbackData(), mdstatus: '' })).toBe(false)
  })

  it('create3DHash', () => {
    const formInputs = {
      terminalid: '30691298',
      orderid: 'order222',
      txnamount: '10025', // deviation: form inputs are strings in TS
      txninstallmentcount: '',
      txntype: 'sales',
      txncurrencycode: '949',
      successurl: 'https://domain.com/success',
      errorurl: 'https://domain.com/fail_url',
    }
    expect(crypt.create3DHash(account, formInputs)).toBe(
      '372D6CB20B2B699D0A6667DFF46E3AA8CF3F9D8C2BB69A7C411895151FFCFAAB5277CCFE3B3A06035FEEFBFBFD40C79DBE51DBF867D0A24B37335A28F0CEFDE2',
    )
  })

  it.each([
    [
      request('sales', 'order222', 10025),
      '0CFE09F107274C6A07292DA061A4EECAB0F5F0CF87F831F2D3626A3346A941126C52D1D95A3B77ADF5AC348B3D25C76BA5D8D98A29557D087D3367BFFACCD25C',
    ],
    [
      request('preauth', 'order222', 10025),
      '0CFE09F107274C6A07292DA061A4EECAB0F5F0CF87F831F2D3626A3346A941126C52D1D95A3B77ADF5AC348B3D25C76BA5D8D98A29557D087D3367BFFACCD25C',
    ],
    [
      request('void', '4499996', 100),
      'C0C88761726D1844AF49FBE756DBE4586F7339169994CF700AE50AA8EAD0C8E81F5828C3392CE39CFC3F8C976FC3E24B576F4DB55DAF2E7D3A6F6B6E5E89B189',
    ],
    [
      request('refund', '4499996', 202),
      '0F97D922001221B9C90AA692CF5D4082FF6D3EB38BE863A47F9C08E63CD87312270D6F298E5FBBC320654861DA1C6EE826E0C83E904916351A9D3032FA426BAA',
    ],
    [
      {
        Version: 'v0.00',
        Terminal: { ID: '30691298' },
        Customer: { IPAddress: '1.1.111.111', EmailAddress: 'Cem@cem.com' },
        Order: { OrderID: 'SISTD5A61F1682E745B28871872383ABBEB1', GroupID: '', Description: '' },
        Transaction: { Type: 'bininq', Amount: '1', BINInq: { Group: 'A', CardType: 'A' } },
      },
      'B129BF998FF8C97C42D3FC923AA4271656B112549665FA130ACF631EA3EB73D917AEB3D646481564CACE38D1687F7744F82E5A1DBB6966F1512E0AF29B4C067B',
    ],
  ])('createHash %#', (requestData, expected) => {
    expect(crypt.createHash(account, requestData)).toBe(expected)
  })

  describe('additions', () => {
    const refundAccount = AccountFactory.createGarantiPosAccount(
      'garanti',
      '7000679',
      'PROVAUT',
      '123qweASD/',
      '30691298',
      '12345678',
      'PROVRFN',
      'RFNPASS',
    )

    it('addition: void and refund sign with the refund password, sales and preauth do not', () => {
      const voidHash =
        '90F5FB4CC1FCB3B5CAEFDB6ECEA2CE15EE48DDEEE9D41A1FF4F5D0A759D6FDC769F44A727B073B77E3118851AB19CB4D19A5398228ABFE646889816A20F6C7C6'
      expect(crypt.createHash(refundAccount, request('void', '4499996', 100))).toBe(voidHash)
      const refund = crypt.createHash(refundAccount, request('refund', '4499996', 100))
      expect(refund).not.toBe(crypt.createHash(account, request('refund', '4499996', 100)))
      for (const type of ['sales', 'preauth']) {
        expect(crypt.createHash(refundAccount, request(type, '4499996', 100))).toBe(
          crypt.createHash(account, request(type, '4499996', 100)),
        )
      }
    })

    it('addition: non-ASCII input is hashed as UTF-8', () => {
      const unicode = AccountFactory.createGarantiPosAccount(
        'garanti',
        '7000679',
        'PROVAUT',
        'Şifre1',
        '30691298',
        '12345678',
      )
      const requestData = {
        Order: { OrderID: 'sipariş-1' },
        Terminal: { ID: '30691298' },
        Card: { Number: '5555444433332222' },
        Transaction: { Type: 'sales', Amount: 2900, CurrencyCode: '949' },
      }
      expect(crypt.createHash(unicode, requestData)).toBe(
        'CE12CD4BB3E476EDE73130DF7590C49DB4C95DEA5D7C1D449CFEC0482D27F05D6E8D19D62DC9EE9358D9DCD7B9901B91A101C8E7342A407C3634211144654933',
      )
    })

    it('addition: an account without a refund password cannot sign void or refund', () => {
      const noRefund = AccountFactory.createGarantiPosAccount(
        'garanti',
        '7000679',
        'PROVAUT',
        '123qweASD/',
        '30691298',
        '12345678',
      )
      expect(() => crypt.createHash(noRefund, request('void', '1', 100))).toThrow(MissingAccountInfoError)
      expect(() => crypt.createHash(noRefund, request('refund', '1', 100))).toThrow(MissingAccountInfoError)
      expect(() => crypt.createHash(noRefund, request('sales', '1', 100))).not.toThrow()
    })

    it('addition: a missing terminal id is rejected', () => {
      const noTerminal = { Order: { OrderID: '1' }, Terminal: {}, Transaction: { Type: 'sales', Amount: 1 } }
      expect(() => crypt.createHash(account, noTerminal)).toThrow(PosError)
      expect(() => crypt.createHash(account, { ...noTerminal, Terminal: { ID: '' } })).toThrow(PosError)
      expect(() => crypt.createHash(account, { Order: { OrderID: '1' }, Transaction: { Type: 'sales' } })).toThrow(
        PosError,
      )
      expect(() =>
        crypt.create3DHash(account, { orderid: 'a', txntype: 'sales' } as unknown as Record<string, string>),
      ).toThrow(PosError)
    })

    it('addition: a null part hashes as an empty string and "undefined" is never hashed', () => {
      const spy = vi.spyOn(crypt, 'hashString')
      const withNull = crypt.createHash(account, request('sales', null, 100))
      const withEmpty = crypt.createHash(account, request('sales', '', 100))
      expect(withNull).toBe(withEmpty)
      crypt.create3DHash(account, {
        terminalid: '30691298',
        orderid: 'o',
        txnamount: '100',
        txncurrencycode: '949',
        successurl: 'https://a/s',
        errorurl: 'https://a/e',
        txntype: 'sales',
      })
      for (const call of spy.mock.calls) {
        expect(call[0]).not.toContain('undefined')
      }
    })

    it('addition: the callback hash is compared case-insensitively', () => {
      const data = callbackData()
      data.hash = (data.hash as string).toLowerCase()
      expect(crypt.check3DHash(account, data)).toBe(true)
    })

    it('addition: a callback whose hashparams omit mdstatus is rejected even with a valid hash', () => {
      const data = callbackData()
      data.hashparams = 'clientid:oid:authcode:procreturncode:response:cavv:eci:md:rnd:'
      data.hash =
        '7A5EECC4F0CA9C6BD2C3F6588C623D554818BD2CD8E097F533F167A52056699134777C8C79FCEEB372D5AB54D3B17FB49CAA45CB2455EAD718BD2F0E5543069C'
      expect(crypt.check3DHash(account, data)).toBe(false)
    })

    it('addition: a missing or malformed hash or hashparams is false without throwing', () => {
      const noHash = callbackData()
      delete noHash.hash
      expect(crypt.check3DHash(account, noHash)).toBe(false)
      expect(crypt.check3DHash(account, { ...callbackData(), hash: '' })).toBe(false)
      expect(crypt.check3DHash(account, { ...callbackData(), hash: 123 as never })).toBe(false)
      const noParams = callbackData()
      delete noParams.hashparams
      expect(crypt.check3DHash(account, noParams)).toBe(false)
      expect(crypt.check3DHash(account, { ...callbackData(), hashparams: '' })).toBe(false)
    })

    it('addition: the failure log carries the callback hash but neither the generated hash nor the store key', () => {
      const data: GatewayResponseData = { ...callbackData(), mdstatus: '2' }
      expect(crypt.check3DHash(account, data)).toBe(false)
      const [, context] = logger.error.mock.calls[0] as [string, Record<string, unknown>]
      expect(context.expected_hash).toBe(data.hash)
      expect(context).not.toHaveProperty('generated_hash')
      const text = JSON.stringify(logger.error.mock.calls)
      expect(text).not.toContain('12345678')
      // the hash the crypt actually computed for the tampered data
      const signed = [
        'clientid',
        'oid',
        'authcode',
        'procreturncode',
        'response',
        'mdstatus',
        'cavv',
        'eci',
        'md',
        'rnd',
      ]
        .map((name) => data[name] ?? '')
        .join('')
      const generated = crypt.hashString(`${signed}12345678`)
      expect(generated).not.toBe(data.hash)
      expect(text).not.toContain(generated)
    })
  })

  // ---- additions: forged callbacks (fixed field list, own top-level strings only) ----

  describe('addition: forged callback structure', () => {
    const HASH_PARAMS = 'clientid:oid:authcode:procreturncode:response:mdstatus:cavv:eci:md:rnd:'

    /** A signed 3D Pay callback (approved by the bank, 3D failed: mdstatus 0). */
    const payCallback = (): GatewayResponseData => ({
      clientid: '30691298',
      oid: 'order222',
      authcode: '304919',
      procreturncode: '00',
      response: 'Approved',
      mdstatus: '0',
      cavv: 'xgRlQDz4AAAAAAAAAAAAAAAAAAA=',
      eci: '02',
      md: 'MDVALUE123',
      rnd: 'kW094tPzNEhqORzzCsLB',
      hash: 'CD9397BB77CA4D9C672FF18082BB0B41A8999F39E5336D008D27218ED9F981448D66AA91A5FC79E703669256BEF9F0F8BB536FFBF8D6649C1F78BD18513D38D1',
      hashparams: HASH_PARAMS,
    })

    it('the legitimate vectors still verify', () => {
      expect(crypt.check3DHash(account, callbackData())).toBe(true)
      expect(crypt.check3DHash(account, payCallback())).toBe(true)
      expect(
        crypt.check3DHash(account, {
          ...payCallback(),
          mdstatus: '1',
          hash: 'FC9EBD151A59FF5B092106B92A4CEF4C3057BA351A9ED2D06B3BF11CEE90D663640594CAED312544B8C1BE20814ACA7FAD8203B951DB1E5944F8380E29852979',
        }),
      ).toBe(true)
      expect(
        crypt.check3DHash(account, {
          ...payCallback(),
          mdstatus: '1',
          authcode: '',
          procreturncode: '92',
          response: 'Declined',
          hash: '0EE1ADB31B9B03AE933917495356E35A4310609FE0F64727534A14FDCD98BE6596358F994B6AAE6DA81D359EE6CF494943C3A1DF85648CE549212FDB31AB67E8',
        }),
      ).toBe(true)
    })

    it('a regrouping hashparams list is rejected although the generic list hash matches', () => {
      // the signed characters "...Approved0<cavv>02MDVALUE123<rnd>" regrouped so that mdstatus reads "1"
      const signed = payCallback()
      const forged: GatewayResponseData = {
        ...signed,
        f1: `0${signed.cavv}02MDVALUE`,
        mdstatus: '1',
        f2: `23${signed.rnd}`,
        hashparams: 'clientid:oid:authcode:procreturncode:response:f1:mdstatus:f2:',
      }
      expect(crypt.hashFromParams(account, forged, forged.hashparams as string, ':')).toBe(signed.hash)
      expect(crypt.check3DHash(account, forged)).toBe(false)
    })

    it.each([
      ['reordered', 'oid:clientid:authcode:procreturncode:response:mdstatus:cavv:eci:md:rnd:'],
      ['duplicated', 'clientid:oid:authcode:procreturncode:response:mdstatus:mdstatus:cavv:eci:md:rnd:'],
      ['extra name', 'clientid:oid:authcode:procreturncode:response:mdstatus:cavv:eci:md:rnd:xid:'],
      ['without trailing separator', 'clientid:oid:authcode:procreturncode:response:mdstatus:cavv:eci:md:rnd'],
      ['upper-cased', HASH_PARAMS.toUpperCase()],
    ])('a %s hashparams list is rejected even with a hash valid for it', (_name, hashparams) => {
      const data: GatewayResponseData = { ...callbackData(), hashparams }
      data.hash = crypt.hashFromParams(account, data, hashparams, ':')
      expect(crypt.check3DHash(account, data)).toBe(false)
    })

    it('a nested duplicate of a signed field is never read', () => {
      // the signed oid sits in a nested object, the top-level oid belongs to another order
      const forged = {
        x: { oid: '2023100354BB' },
        ...callbackData(),
        oid: 'BIG-ORDER',
      } as unknown as GatewayResponseData
      expect(crypt.hashFromParams(account, forged, HASH_PARAMS, ':')).toBe(callbackData().hash)
      expect(crypt.check3DHash(account, forged)).toBe(false)
    })

    it('a signed field that is not a string is rejected', () => {
      const data = callbackData()
      for (const value of [[data.md], { md: data.md }, 1]) {
        expect(crypt.check3DHash(account, { ...data, md: value } as unknown as GatewayResponseData)).toBe(false)
      }
    })

    it('an inherited hash or hashparams is not used', () => {
      const { hash, hashparams, ...rest } = callbackData()
      const data = Object.assign(Object.create({ hash, hashparams }), rest) as GatewayResponseData
      expect(crypt.check3DHash(account, data)).toBe(false)
    })

    // addition: an empty store key is as missing as a null one
    it('an account with an empty or blank store key cannot verify a callback or sign the 3D form', () => {
      for (const key of ['', '  ']) {
        const empty = AccountFactory.createGarantiPosAccount(
          'garanti',
          '7000679',
          'PROVAUT',
          '123qweASD/',
          '30691298',
          key,
        )
        expect(() => crypt.check3DHash(empty, callbackData())).toThrow(MissingAccountInfoError)
        expect(() => crypt.create3DHash(empty, { terminalid: '30691298', txntype: 'sales' })).toThrow(
          MissingAccountInfoError,
        )
      }
    })

    // addition: an empty refund password is as missing as a null one
    it('an empty or blank refund password cannot sign void or refund', () => {
      for (const refundPassword of ['', ' ']) {
        const empty = AccountFactory.createGarantiPosAccount(
          'garanti',
          '7000679',
          'PROVAUT',
          '123qweASD/',
          '30691298',
          '12345678',
          'PROVRFN',
          refundPassword,
        )
        expect(() => crypt.createHash(empty, request('void', '1', 100))).toThrow(MissingAccountInfoError)
        expect(() => crypt.createHash(empty, request('refund', '1', 100))).toThrow(MissingAccountInfoError)
      }
    })

    it('an account without a store key cannot verify a callback', () => {
      const noKey = AccountFactory.createGarantiPosAccount('garanti', '7000679', 'PROVAUT', '123qweASD/', '30691298')
      expect(() => crypt.check3DHash(noKey, callbackData())).toThrow(MissingAccountInfoError)
    })
  })
})
