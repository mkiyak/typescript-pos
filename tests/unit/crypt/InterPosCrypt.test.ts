import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InterPosCrypt } from '../../../src/crypt/InterPosCrypt.js'
import { MissingAccountInfoError, NotImplementedError, PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosLogger } from '../../../src/logger.js'
import type { GatewayResponseData } from '../../../src/types.js'

type Cb = Record<string, unknown>

type MockLogger = { [K in keyof PosLogger]: ReturnType<typeof vi.fn> }

function makeLogger(): MockLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

const account = AccountFactory.createInterPosAccount('denizbank', '3123', 'InterTestApi', '3', 'gDg1N')
const nonSecure = AccountFactory.createInterPosAccount('denizbank', '3123', 'InterTestApi', '3')

const S1 = (text: string): string => createHash('sha1').update(text, 'utf8').digest('base64')

const HP = 'Version:PurchAmount:Exponent:Currency:OkUrl:FailUrl:MD:OrderId:ProcReturnCode:Response:mdStatus:'
const OK = 'https://domain.com/success'
const FAIL = 'https://domain.com/fail_url'

/** The hash of the eleven signed callback values followed by the merchant password. */
const C = (...v: [string, string, string, string, string, string, string, string, string, string, string]): string =>
  S1(`${v.join('')}gDg1N`)

/** A flat callback carrying the fixed field list and the genuine hash of the values it holds. */
const signedCallback = (
  ...v: [string, string, string, string, string, string, string, string, string, string, string]
): Cb => ({
  Version: v[0],
  PurchAmount: v[1],
  Exponent: v[2],
  Currency: v[3],
  OkUrl: v[4],
  FailUrl: v[5],
  MD: v[6],
  OrderId: v[7],
  ProcReturnCode: v[8],
  Response: v[9],
  mdStatus: v[10],
  HASH: C(...v),
  HASHPARAMS: HP,
})

/** What a check that trusts the announced list would compute: the values named there, in that order, plus the key. */
const looseHash = (data: Cb, list: string): string =>
  S1(
    `${list
      .split(':')
      .map((name) => (name === '' ? '' : String(data[name] ?? '')))
      .join('')}gDg1N`,
  )

const pay = (): Cb => signedCallback('', '1,01', '', '949', OK, FAIL, '', '20221225B83B', '00', 'Approved', '1')

const decline3d = (): Cb => ({
  Version: null,
  ShopCode: '3123',
  MD: null,
  OrderId: '20221225E1DF',
  PurchAmount: '1,01',
  Exponent: null,
  Currency: '949',
  OkUrl: 'http:\\/\\/localhost\\/interpos\\/3d\\/response.php',
  FailUrl: 'http:\\/\\/localhost\\/interpos\\/3d\\/response.php',
  '3DStatus': '0',
  mdStatus: '0',
  ProcReturnCode: '81',
  Response: null,
  HASH: '423AWRAXl0VlEbQjpmAfntT5e3E=',
  HASHPARAMS: HP,
  HASHPARAMSVAL:
    '1,01949http:\\/\\/localhost\\/interpos\\/3d\\/response.phphttp:\\/\\/localhost\\/interpos\\/3d\\/response.php20221225E1DF810',
})

const formInputs = (): Record<string, string> => ({
  ShopCode: '3123',
  OrderId: 'order222',
  PurchAmount: '100.25',
  TxnType: 'Auth',
  InstallmentCount: '',
  OkUrl: OK,
  FailUrl: FAIL,
  Rnd: 'rand',
})

describe('InterPosCrypt', () => {
  let logger: MockLogger
  let crypt: InterPosCrypt

  beforeEach(() => {
    logger = makeLogger()
    crypt = new InterPosCrypt(logger as unknown as PosLogger)
  })

  const check = (data: Cb, who = account): boolean => crypt.check3DHash(who, data as GatewayResponseData)

  it('testSupports', () => {
    expect(InterPosCrypt.supports('InterPos')).toBe(true)
    expect(InterPosCrypt.supports('AssecoPos')).toBe(false)
  })

  describe('testCheck3DHash', () => {
    const rows: [string, Cb][] = [
      [
        'row 1',
        {
          Version: '',
          // deviation: F7 callback values are strings; the reference row passes the integer 320
          PurchAmount: '320',
          Exponent: '',
          Currency: '949',
          OkUrl: 'https://localhost/pos/examples/interpos/3d/success.php',
          FailUrl: 'https://localhost/pos/examples/interpos/3d/fail.php',
          MD: '',
          OrderId: '20220327140D',
          ProcReturnCode: '81',
          Response: '',
          mdStatus: '0',
          HASH: '9DZVckklZFjuoA7sl4MN0l7VDMo=',
          HASHPARAMS: HP,
          HASHPARAMSVAL:
            '320949https://localhost/pos/examples/interpos/3d/success.phphttps://localhost/pos/examples/interpos/3d/fail.php20220327140D810',
        },
      ],
      ['row 2', decline3d()],
      [
        'row 3 (3d pay)',
        {
          Version: '',
          MerchantID: '',
          ShopCode: '3123',
          MD: '',
          OrderId: '20221225B83B',
          PurchAmount: '1,01',
          Exponent: '',
          Currency: '949',
          OkUrl: 'http:\\/\\/localhost\\/interpos\\/3d-pay\\/response.php',
          FailUrl: 'http:\\/\\/localhost\\/interpos\\/3d-pay\\/response.php',
          '3DStatus': '0',
          mdStatus: '0',
          ProcReturnCode: '81',
          Response: '',
          HASH: 'PvDXe6Puf9W2oZnBZuHVp8oWpyY=',
          HASHPARAMS: HP,
          HASHPARAMSVAL:
            '1,01949http:\\/\\/localhost\\/interpos\\/3d-pay\\/response.phphttp:\\/\\/localhost\\/interpos\\/3d-pay\\/response.php20221225B83B810',
        },
      ],
    ]

    it.each(rows)('%s verifies and fails with an altered amount', (_n, data) => {
      expect(check(data)).toBe(true)
      expect(check({ ...data, PurchAmount: '' })).toBe(false)
    })
  })

  it('testCreate3DHash', () => {
    expect(crypt.create3DHash(account, formInputs())).toBe('vEbwP8wnsGrBR9oCjfxP9wlho1g=')
  })

  it('testCreateHash', () => {
    // deviation: F30 the typed error replaces the reference exception
    expect(() => crypt.createHash(account, {})).toThrow(NotImplementedError)
  })

  describe('additions', () => {
    // addition: FV1
    it('signs the form with another random value', () => {
      expect(crypt.create3DHash(account, { ...formInputs(), Rnd: 'rand-12' })).toBe('54l+lsAXyCZlcRvg9m2SyrcSV9M=')
    })

    // addition: FV3, FV4, FV5, FP1, FP2, FP4-FP7 (the signed text of the fixed list; the gateway pins and confirms)
    it.each([
      ['FV3 approved 3D Pay', pay(), 'A9+zYc4QLhaEi0jFT1mFVwQjmGA='],
      [
        'FV3 approved 3D Host',
        signedCallback('', '1,01', '', '949', OK, FAIL, '', '202212256D26', '00', 'Approved', '1'),
        '2BdItiuhkEBGgfHclzZo8MYvcoo=',
      ],
      [
        'FV3 half 3D',
        signedCallback('', '1,01', '', '949', OK, FAIL, '', '20221225B83B', '00', 'Approved', '2'),
        '8Xsn4UljRdUC5t8T/4LFz6GsGQc=',
      ],
      [
        'FV4 3D Secure success',
        signedCallback('', '1', '', '949', OK, FAIL, 'MDVALUE123', '33554969', '', '', '1'),
        '4SLRmgQgs9TDGlbof+TVUbsk5fE=',
      ],
      [
        'FV5 3D Pay decline',
        signedCallback('', '1,01', '', '949', OK, FAIL, '', '20221225B83B', '81', '', '0'),
        'leUqa3qvm7iHDfxk68WbWUOO6Do=',
      ],
      [
        'FP1 reading a',
        signedCallback('', '1,01', '', '949', OK, FAIL, 'MDVALUE123', '1200', '', '', '1'),
        '3hRV0B1GwwBJCnOe73WqjmHUr1I=',
      ],
      [
        'FP1 reading b',
        signedCallback('', '1,01', '', '949', OK, FAIL, 'MDVALUE123', '12', '00', '', '1'),
        '3hRV0B1GwwBJCnOe73WqjmHUr1I=',
      ],
      [
        'FP2 reading a',
        signedCallback('', '1,01', '', '949', OK, FAIL, '', '120', '05', '', '1'),
        'LLJTVZ3RmdIFFEAKemghpfTQPdw=',
      ],
      [
        'FP2 reading b',
        signedCallback('', '1,01', '', '949', OK, FAIL, '', '12', '00', '5', '1'),
        'LLJTVZ3RmdIFFEAKemghpfTQPdw=',
      ],
      [
        'FP4 approved but 3D failed',
        signedCallback('', '1,01', '', '949', OK, FAIL, '', '20221225B83B', '00', 'Approved', '0'),
        'Htdt5+Heq3J7Er/mo/6mFT6vwbY=',
      ],
      [
        'FP5 other order',
        signedCallback('', '1,01', '', '949', OK, FAIL, '', '20221225B83C', '00', 'Approved', '1'),
        'iCBA73PzZwnJawkkBkPneTTgSwA=',
      ],
      [
        'FP6 other currency',
        signedCallback('', '1,01', '', '840', OK, FAIL, '', '20221225B83B', '00', 'Approved', '1'),
        'm5cCvJIDVnQ+bi94Qbv7QJP0AoY=',
      ],
      [
        'FP7 other amount',
        signedCallback('', '2,00', '', '949', OK, FAIL, '', '20221225B83B', '00', 'Approved', '1'),
        'poGCBje6PuBUuENQRdZiaHi6sDE=',
      ],
    ])('%s verifies', (_n, data, expected) => {
      expect(data.HASH).toBe(expected)
      expect(check(data)).toBe(true)
    })

    // addition: FV2 (the 3D Host decline fixture's own hash was made with another merchant password)
    it('verifies the 3D Host decline only with the hash for this merchant password', () => {
      const host: Cb = {
        Version: '',
        MD: '',
        OrderId: '202212256D26',
        PurchAmount: '1,01',
        Exponent: '',
        Currency: '949',
        OkUrl: 'http:\\/\\/localhost\\/interpos\\/3d-host\\/response.php',
        FailUrl: 'http:\\/\\/localhost\\/interpos\\/3d-host\\/response.php',
        mdStatus: '0',
        ProcReturnCode: '81',
        Response: '',
        HASH: 'hmL3n1OMlNnKM4mjk2BgqfFM0rI=',
        HASHPARAMS: HP,
      }
      expect(check(host)).toBe(false)
      expect(check({ ...host, HASH: 'kWR9M0TZtzdmBLqTAKdSzUF+JGo=' })).toBe(true)
    })

    // addition: FP3 (a sender-chosen field list that carries the whole signed text in one field)
    it('rejects a substituted field list although the genuine hash verifies under it', () => {
      const genuine = decline3d()
      const text = genuine.HASHPARAMSVAL as string
      expect(S1(`${text}gDg1N`)).toBe(genuine.HASH)
      const forged: Cb = {
        ...genuine,
        HASHPARAMS: 'Version',
        Version: text,
        OrderId: '12',
        ProcReturnCode: '00',
        mdStatus: '1',
        PurchAmount: '2,00',
        Currency: '840',
      }
      expect(looseHash(forged, 'Version')).toBe(forged.HASH)
      expect(check(forged)).toBe(false)
    })

    // addition: F9 a null (or absent) signed field reads as empty, so its characters can merge into a neighbour while
    // the genuine hash still verifies; the gateway's field formats reject each of these (see InterPos.test.ts)
    it.each([
      ['decline: amount merged with a null currency', { ...decline3d(), PurchAmount: '1,01949', Currency: null }],
      [
        'decline: order id shifted into the return code',
        { ...decline3d(), OrderId: '20221225E1DF8', ProcReturnCode: '1' },
      ],
      ['approval: amount merged with a null currency', { ...pay(), PurchAmount: '1,01949', Currency: null }],
      ['approval: order id shifted into the return code', { ...pay(), OrderId: '20221225B83B0', ProcReturnCode: '0' }],
    ] as Array<[string, Cb]>)('accepted by the crypt; the gateway rejects: %s', (_n, resplit) => {
      expect(check(resplit)).toBe(true)
    })

    // addition: F7 for each of these lists the genuine hash verifies under a check that trusts the announced list
    it.each([
      ['without the trailing colon', HP.slice(0, -1)],
      ['reordered', `PurchAmount:Version:${HP.slice('Version:PurchAmount:'.length)}`],
    ])('rejects the list %s', (_n, list) => {
      const forged: Cb = { ...pay(), HASHPARAMS: list }
      expect(looseHash(forged, list)).toBe(forged.HASH)
      expect(check(forged)).toBe(false)
    })

    // addition: F7
    it('rejects a list with an extra name that its own hash covers', () => {
      const list = `${HP}mdStatus:`
      const forged: Cb = { ...pay(), HASHPARAMS: list }
      forged.HASH = looseHash(forged, list)
      expect(forged.HASH).not.toBe(pay().HASH)
      expect(check(forged)).toBe(false)
    })

    // addition: F7
    it('rejects a callback without HASHPARAMS', () => {
      const { HASHPARAMS: _removed, ...data } = pay()
      expect(check(data)).toBe(false)
      expect(check({ ...data, HASHPARAMS: [HP] })).toBe(false)
    })

    // addition: F7
    it.each([
      ['missing', (d: Cb) => ({ ...d, HASH: undefined })],
      ['empty', (d: Cb) => ({ ...d, HASH: '' })],
      ['lower-cased', (d: Cb) => ({ ...d, HASH: String(d.HASH).toLowerCase() })],
      ['an array holding the genuine hash', (d: Cb) => ({ ...d, HASH: [d.HASH] })],
    ])('rejects a HASH that is %s', (_n, change) => {
      expect(check(change(pay()))).toBe(false)
    })

    // addition: F7 the text of each value below is signed, so only its type makes the check fail
    it('rejects a signed value that is not a string although its text is signed', () => {
      const amount = signedCallback('', '320', '', '949', OK, FAIL, '', '20220327140D', '81', '', '0')
      expect(check(amount)).toBe(true)
      expect(check({ ...amount, PurchAmount: 320 })).toBe(false)

      const md = signedCallback('', '1,01', '', '949', OK, FAIL, '[object Object]', '12', '81', '', '0')
      expect(check(md)).toBe(true)
      expect(check({ ...md, MD: { a: 1 } })).toBe(false)

      const order = signedCallback('', '1,01', '', '949', OK, FAIL, '', 'x', '81', '', '0')
      expect(check(order)).toBe(true)
      expect(check({ ...order, OrderId: ['x'] })).toBe(false)
    })

    // addition: F7 the empty last element of the list never looks up a key named ''
    it('ignores a callback key named with the empty string', () => {
      expect(check({ ...pay(), '': 'zzz' })).toBe(true)
    })

    // addition: F7 a value that sits only in a nested object is not found
    it('does not search nested objects for signed values', () => {
      const { OrderId, ...rest } = decline3d()
      expect(OrderId).toBe('20221225E1DF')
      expect(check({ ...rest, nested: { OrderId } })).toBe(false)
    })

    // addition: F7 inherited names are not values
    it('does not read inherited properties', () => {
      const data = Object.create({ OrderId: '20221225E1DF' }) as Cb
      const { OrderId: _own, ...rest } = decline3d()
      Object.assign(data, rest)
      expect(check(data)).toBe(false)
    })

    // addition: F1
    it('fails with a missing account value when the merchant password is absent', () => {
      expect(() => check(pay(), nonSecure)).toThrow(MissingAccountInfoError)
      expect(() => crypt.create3DHash(nonSecure, formInputs())).toThrow(MissingAccountInfoError)
    })

    // addition: F7 hostile input never throws
    it('never throws for hostile callback input', () => {
      const inputs: Cb[] = [
        {},
        { HASH: 5, HASHPARAMS: 5 },
        { HASH: null, HASHPARAMS: null },
        { ...pay(), OrderId: { toString: 1 } },
        { ...pay(), Version: 1n },
        JSON.parse('{"__proto__": {"HASH": "x"}, "HASH": "y", "HASHPARAMS": "z"}'),
      ]
      for (const input of inputs) expect(check(input)).toBe(false)
    })

    // addition: F7 a failure leaks neither the expected hash, the merchant password nor the callback
    it('logs only the order id on failure', () => {
      const data: Cb = { ...pay(), PurchAmount: '9,99' }
      const generated = looseHash(data, HP)
      expect(check(data)).toBe(false)
      expect(logger.error).toHaveBeenCalledTimes(1)
      const logged = JSON.stringify(logger.error.mock.calls)
      expect(logged).toContain('20221225B83B')
      expect(logged).not.toContain(generated)
      expect(logged).not.toContain('gDg1N')
      expect(logged).not.toContain('9,99')
      expect(logged).not.toContain(String(data.HASH))
      expect(logged).not.toContain(OK)
    })

    // addition: F7
    it('logs a long order id truncated and none for a non-string one', () => {
      check({ ...pay(), OrderId: 'a'.repeat(200) })
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain('a'.repeat(65))
      check({ ...pay(), OrderId: { x: 1 } })
      expect(logger.error).toHaveBeenCalledTimes(2)
      expect(JSON.stringify(logger.error.mock.calls[1])).not.toContain('x')
    })

    // addition: F6
    it.each([
      ['InstallmentCount', undefined],
      ['OkUrl', ''],
      ['Rnd', undefined],
      ['OrderId', ''],
      ['ShopCode', ''],
      ['PurchAmount', ''],
      ['FailUrl', ''],
      ['TxnType', ''],
    ])('refuses to sign a form without a usable %s', (name, value) => {
      const inputs: Record<string, unknown> = { ...formInputs(), [name]: value }
      const spy = vi.spyOn(crypt, 'hashString')
      expect(() => crypt.create3DHash(account, inputs as Record<string, string>)).toThrow(PosError)
      expect(spy).not.toHaveBeenCalled()
    })

    // addition: F6
    it('signs the installment count and never hands the text "undefined" to the hash function', () => {
      const spy = vi.spyOn(crypt, 'hashString')
      crypt.create3DHash(account, { ...formInputs(), InstallmentCount: '3' })
      expect(spy.mock.calls[0]?.[0]).toBe(`3123order222100.25${OK}${FAIL}Auth3randgDg1N`)
    })

    // addition: F6 an own-property check, not a prototype read
    it('does not take form values from the prototype', () => {
      const { Rnd: _rnd, ...rest } = formInputs()
      const inputs = Object.create({ Rnd: 'inherited' }) as Record<string, string>
      Object.assign(inputs, rest)
      expect(() => crypt.create3DHash(account, inputs)).toThrow(PosError)
    })

    // addition: F7 the announced-list helper is not an entry point
    it('does not offer the announced-list helper', () => {
      expect(() => crypt.hashFromParams(account, pay(), 'Version', ':')).toThrow(NotImplementedError)
    })
  })
})
