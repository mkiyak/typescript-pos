import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TOSLA_CALLBACK_HASH_PARAMETERS, ToslaPosCrypt } from '../../../src/crypt/ToslaPosCrypt.js'
import { NotImplementedError, PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosLogger } from '../../../src/logger.js'
import type { GatewayResponseData } from '../../../src/types.js'

type Cb = Record<string, unknown>

type MockLogger = { [K in keyof PosLogger]: ReturnType<typeof vi.fn> }

function makeLogger(): MockLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

const TA = AccountFactory.createToslaPosAccount('tosla', '1000000494', 'POS_ENT_Test_001', 'POS_ENT_Test_001!*!*')
const OTHER = AccountFactory.createToslaPosAccount('tosla', '1000000495', 'POS_ENT_Test_001', 'POS_ENT_Test_001!*!*')
const SECRET = 'POS_ENT_Test_001!*!*'
const P = '1000000494POS_ENT_Test_001'
const HP = 'ClientId,ApiUser,OrderId,MdStatus,BankResponseCode,BankResponseMessage,RequestStatus'

const S5 = (text: string): string => createHash('sha512').update(text, 'utf8').digest('base64')

/** The request hash: password, client id, api user, random value, time span. */
const RQ = (rnd: string, ts: string): string => S5(`${SECRET}1000000494POS_ENT_Test_001${rnd}${ts}`)

/** The callback hash: password, client id and api user, then the five signed callback values. */
const CB = (o: string, md: string, code: string, msg: string, req: string): string =>
  S5(`${SECRET}${P}${o}${md}${code}${msg}${req}`)

/** A flat callback carrying the fixed field list and the genuine hash of the values it holds. */
const callback = (o: string, md: string, code: string, msg: string, req: string): Cb => ({
  ClientId: '1000000494',
  OrderId: o,
  MdStatus: md,
  ThreeDSessionId: 'P40D18956D9C94188ABF6C87B37075AF7B1029577C4BF4BADB8E86058919000F4',
  BankResponseCode: code,
  BankResponseMessage: msg,
  RequestStatus: req,
  HashParameters: HP,
  Hash: CB(o, md, code, msg, req),
})

const CV1 = 'CgibjWkLpfx+Cz6cVlbH1ViSW74ouKACVOW0Vrt2SfqPMt+V3hfIx/4LnOgcInFhPci/qcnIMgdN0RptHSmFOg=='
const CV2 = 'A+bjgxp/uIQjpsY+cEpUJcu+m6xXMgpDz7DOjtQ8TgKgJaFFsLGKkpNKOYzInqfkJ6U9+S8mxGFBv4o4WqC4hg=='
const CV3 = 'C7Vbcr3adDhlWEr9vT9oFHikjrjEiv5DSBORu0YnOATkF/YirOziwouAGk8vqB29oeyPBnlFgBih7bLN9YWweQ=='
const RP1 = '4vdPQvhJ8eyjpdLPFOsSIwphXYI3Lr96iLjU0KKrTEd8bYUJDoaqenW7VEjqxhyMZOhSJQo7pq7CqkZY8g67lw=='
const HV1 = 'IhkLeIo7ZAdYIG+6XqnppnExSdaQg4hekLlwSG4P47t50mEa//dHf06WWu2yApnG4f+tVrhQSFCK6FEaj3qAUg=='

describe('ToslaPosCrypt', () => {
  let logger: MockLogger
  let crypt: ToslaPosCrypt

  beforeEach(() => {
    logger = makeLogger()
    crypt = new ToslaPosCrypt(logger as unknown as PosLogger)
  })

  const check = (data: unknown, who = TA): boolean => crypt.check3DHash(who, data as GatewayResponseData)

  it('testSupports', () => {
    expect(ToslaPosCrypt.supports('ToslaPos')).toBe(true)
    expect(ToslaPosCrypt.supports('AssecoPos')).toBe(false)
  })

  it('testCreate3DHash', () => {
    // deviation: T19 the typed error replaces the reference exception
    expect(() => crypt.create3DHash(TA, {})).toThrow(NotImplementedError)
  })

  it('testCreateHash', () => {
    const requestData = {
      clientId: '1000000494',
      apiUser: 'POS_ENT_Test_001',
      timeSpan: '20231209201121',
      rnd: 'rand',
    }
    expect(crypt.createHash(TA, requestData)).toBe(
      'BwZ05tt0aNgIgtrrqmlTwSIaeetpQyyGLH6xTsQbHae7ANCIVKmLHPxYWk5XP3Li5fr4La1bZS9/43OihP0dig==',
    )
  })

  describe('testCheck3DHash', () => {
    const genuine: Cb = {
      ClientId: '1000000494',
      OrderId: '202312034E91',
      MdStatus: '1',
      ThreeDSessionId: 'P40D18956D9C94188ABF6C87B37075AF7B1029577C4BF4BADB8E86058919000F4',
      BankResponseCode: '00',
      BankResponseMessage: '',
      RequestStatus: '1',
      HashParameters: HP,
      Hash: CV1,
    }

    it('verifies the genuine callback and fails with an altered MdStatus', () => {
      expect(check(genuine)).toBe(true)
      expect(check({ ...genuine, MdStatus: '' })).toBe(false)
    })
  })

  describe('additions', () => {
    // addition: CV2, CV3, HV1 the hashes the bank computes (PHP-verified)
    it.each([
      ['CV2 genuine 3D Host approval', callback('20231203626F', '1', '00', '', '1'), CV2],
      ['CV3 genuine decline', callback('20231203E148', '0', 'MD:0', '', '0'), CV3],
      ['HV1 approval with half 3D', callback('20231203626F', '2', '00', '', '1'), HV1],
    ] as const)('%s verifies against the literal hash', (_n, data, literal) => {
      expect(data.Hash).toBe(literal)
      expect(check(data)).toBe(true)
    })

    // addition: RP1 one signed text, two readings; the crypt cannot tell them apart, the gateway pins reject the second
    it('RP1 accepts both readings of the same signed text (accepted by the crypt; the gateway rejects)', () => {
      const approval = callback('A1001', '1', '00', '', '1')
      const resplit = callback('A', '1', '00', '1100', '1')
      expect(approval.Hash).toBe(RP1)
      expect(resplit.Hash).toBe(RP1)
      expect(check(approval)).toBe(true)
      expect(check(resplit)).toBe(true)
    })

    // addition: the announced field list is never trusted
    it.each([
      ['reordered', 'ApiUser,ClientId,OrderId,MdStatus,BankResponseCode,BankResponseMessage,RequestStatus'],
      ['shortened', 'ClientId,ApiUser,OrderId'],
      ['padded', ` ${HP}`],
      ['trailing comma', `${HP},`],
      ['one field', 'OrderId'],
      ['empty', ''],
    ])('rejects a %s HashParameters list that keeps the genuine hash', (_n, list) => {
      expect(check({ ...callback('202312034E91', '1', '00', '', '1'), HashParameters: list })).toBe(false)
    })

    // addition: a renamed list that makes a forged field split hash to the genuine value is still rejected
    it('rejects a list renamed to cover the genuine text through one field', () => {
      const data = callback('A1001', '1', '00', '', '1')
      // a sender-chosen list that would regroup the signed characters of the genuine approval
      const forged = {
        ...data,
        OrderId: 'A',
        BankResponseMessage: '1100',
        HashParameters: 'ClientId,ApiUser,OrderId,BankResponseMessage,MdStatus',
      }
      expect(check(forged)).toBe(false)
    })

    it('rejects a missing HashParameters', () => {
      const { HashParameters: _omit, ...rest } = callback('202312034E91', '1', '00', '', '1')
      expect(check(rest)).toBe(false)
    })

    // addition: the hash itself must be an own 88-character base64 string
    it.each([
      ['one char altered', (h: string) => `${h.slice(0, 10)}${h[10] === 'A' ? 'B' : 'A'}${h.slice(11)}`],
      ['87 chars', (h: string) => h.slice(0, -1)],
      ['lower-cased', (h: string) => h.toLowerCase()],
      ['empty', () => ''],
      ['null', () => null],
      ['array', (h: string) => [h]],
      ['number', () => 5],
      ['object', (h: string) => ({ h })],
    ])('rejects a Hash that is %s', (_n, mutate) => {
      const data = callback('202312034E91', '1', '00', '', '1')
      expect(check({ ...data, Hash: mutate(data.Hash as string) })).toBe(false)
    })

    it('rejects a missing Hash', () => {
      const { Hash: _omit, ...rest } = callback('202312034E91', '1', '00', '', '1')
      expect(check(rest)).toBe(false)
    })

    // addition: signed values are own top-level strings only
    it.each([
      ['OrderId number', { OrderId: 5 }],
      ['OrderId object', { OrderId: {} }],
      ['OrderId array', { OrderId: ['202312034E91'] }],
      ['MdStatus number', { MdStatus: 1 }],
      ['BankResponseCode number', { BankResponseCode: 0 }],
      ['BankResponseMessage object', { BankResponseMessage: { a: 'b' } }],
      ['RequestStatus number', { RequestStatus: 1 }],
      ['RequestStatus boolean', { RequestStatus: true }],
    ])('rejects a callback whose %s is not a string', (_n, patch) => {
      expect(check({ ...callback('202312034E91', '1', '00', '', '1'), ...patch })).toBe(false)
    })

    it('does not read nested or inherited values', () => {
      const nested = {
        Wrapper: {
          OrderId: '202312034E91',
          MdStatus: '1',
          BankResponseCode: '00',
          BankResponseMessage: '',
          RequestStatus: '1',
        },
        HashParameters: HP,
        Hash: CV1,
      }
      expect(check(nested)).toBe(false)
      const inherited = Object.create({ ...callback('202312034E91', '1', '00', '', '1') }) as Cb
      expect(check(inherited)).toBe(false)
    })

    // addition: an absent or null message counts as empty, like the bank's own signing
    it('treats an absent or null signed value as empty', () => {
      const { BankResponseMessage: _omit, ...without } = callback('20231203E148', '0', 'MD:0', '', '0')
      expect(check(without)).toBe(true)
      expect(check({ ...without, BankResponseMessage: null })).toBe(true)
      const { BankResponseMessage: _omit2, ...cv1 } = callback('202312034E91', '1', '00', '', '1')
      expect(cv1.Hash).toBe(CV1)
      expect(check(cv1)).toBe(true)
    })

    // addition: the account's client id is what is signed; the callback's own ClientId is unsigned (bound by the gateway)
    it('signs the account client id and api user, not the callback ClientId', () => {
      expect(check({ ...callback('202312034E91', '1', '00', '', '1'), ClientId: '999' })).toBe(true)
      expect(check({ ...callback('202312034E91', '1', '00', '', '1'), ApiUser: 'attacker' })).toBe(true)
    })

    it('rejects a callback hashed for another account', () => {
      expect(check(callback('202312034E91', '1', '00', '', '1'), OTHER)).toBe(false)
    })

    it.each([null, undefined, 'x', 5, [], true])(
      'returns false for a non-object callback %j and never throws',
      (data) => {
        expect(check(data)).toBe(false)
      },
    )

    it('exports the single accepted field list', () => {
      expect(TOSLA_CALLBACK_HASH_PARAMETERS).toBe(HP)
    })

    // addition: nothing secret reaches the log
    it('logs only the order id on failure', () => {
      const data = { ...callback('202312034E91', '1', '00', '', '1'), MdStatus: '' }
      expect(check(data)).toBe(false)
      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(logger.error).toHaveBeenCalledWith('hash check failed', { order_id: '202312034E91' })
      const everything = JSON.stringify([
        logger.debug.mock.calls,
        logger.info.mock.calls,
        logger.warn.mock.calls,
        logger.error.mock.calls,
      ])
      expect(everything).not.toContain(CB('202312034E91', '', '00', '', '1'))
      expect(everything).not.toContain(CV1)
      expect(everything).not.toContain('POS_ENT_Test_001!*!*')
      expect(everything).not.toContain('P40D18956')
    })

    it('logs a success with the order id only', () => {
      expect(check(callback('202312034E91', '1', '00', '', '1'))).toBe(true)
      expect(logger.debug).toHaveBeenCalledWith('hash check is successful', { order_id: '202312034E91' })
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('does not log an order id that is not a string', () => {
      expect(check({ ...callback('x', '1', '00', '', '1'), OrderId: { a: 1 } })).toBe(false)
      expect(logger.error).toHaveBeenCalledWith('hash check failed', { order_id: undefined })
    })

    it('shortens a long order id in the log', () => {
      check({ ...callback('x', '1', '00', '', '1'), OrderId: 'A'.repeat(300) })
      const context = logger.error.mock.calls[0]?.[1] as { order_id: string }
      expect(context.order_id).toHaveLength(64)
    })

    // addition: RV2-RV5 request hashes (PHP-verified)
    it.each([
      [
        'RV2',
        'rand-212s',
        '20231209215355',
        'jcgZOAf/m/E1uwYXmOPrdgqXRuEmVuG3Q14yri0okhULvRDbAicyAU8hflUP634yRRSZkOnIOeLZNqXfLhzz7g==',
      ],
      [
        'RV3',
        'rand',
        '20231209214708',
        '+XGO1qv+6W7nXZwSsYMaRrWXhi+99jffLvExGsFDodYyNadOG7OQKsygzly5ESDoNIS19oD2U+hSkVeT6UTAFA==',
      ],
      [
        'RV4',
        'raranra',
        '20231209213944',
        'bLp8WNYiaKrnW+EfwHuUZ1ovao0laSeuU/DqUMhjI40QNWdcHJWRKpkoE+eb1U07GGDgsIKKvx9nh84s6K1+pQ==',
      ],
      [
        'RV5',
        'rand-123',
        '20231209215355',
        'csrJh00U/nYGim8jPp9uddRdRvEWZf8pYu9Elss5RtA9JQt6DRkXxrTTY4iYQt5iABp5bj+/RYhlnTflyD9eBw==',
      ],
    ])('%s createHash matches the literal', (_n, rnd, timeSpan, literal) => {
      const data = { clientId: '1000000494', apiUser: 'POS_ENT_Test_001', rnd, timeSpan }
      expect(crypt.createHash(TA, data)).toBe(literal)
      expect(RQ(rnd, timeSpan)).toBe(literal)
    })

    it('createHash ignores the key order and any extra body field', () => {
      const a = crypt.createHash(TA, {
        timeSpan: '20231209201121',
        rnd: 'rand',
        apiUser: 'POS_ENT_Test_001',
        clientId: '1000000494',
      })
      const b = crypt.createHash(TA, {
        clientId: '1000000494',
        apiUser: 'POS_ENT_Test_001',
        rnd: 'rand',
        timeSpan: '20231209201121',
        amount: 99,
        orderId: 'x',
      })
      expect(a).toBe(b)
    })

    it.each([
      ['clientId missing', { apiUser: 'u', rnd: 'r', timeSpan: 't' }],
      ['clientId blank', { clientId: '', apiUser: 'u', rnd: 'r', timeSpan: 't' }],
      ['rnd empty', { clientId: 'c', apiUser: 'u', rnd: '', timeSpan: 't' }],
      ['timeSpan undefined', { clientId: 'c', apiUser: 'u', rnd: 'r', timeSpan: undefined }],
      ['timeSpan null', { clientId: 'c', apiUser: 'u', rnd: 'r', timeSpan: null }],
      ['apiUser object', { clientId: 'c', apiUser: {}, rnd: 'r', timeSpan: 't' }],
      ['apiUser array', { clientId: 'c', apiUser: ['u'], rnd: 'r', timeSpan: 't' }],
      ['rnd NaN', { clientId: 'c', apiUser: 'u', rnd: Number.NaN, timeSpan: 't' }],
      ['timeSpan boolean', { clientId: 'c', apiUser: 'u', rnd: 'r', timeSpan: true }],
    ])('createHash rejects %s with a PosError and never hashes "undefined"', (_n, data) => {
      const spy = vi.spyOn(crypt, 'hashString')
      expect(() => crypt.createHash(TA, data)).toThrow(PosError)
      expect(spy).not.toHaveBeenCalled()
    })

    it('createHash does not read inherited fields', () => {
      const inherited = Object.create({ clientId: 'c', apiUser: 'u', rnd: 'r', timeSpan: 't' }) as Record<
        string,
        unknown
      >
      expect(() => crypt.createHash(TA, inherited)).toThrow(PosError)
    })

    it('createHash hashes a numeric timeSpan like the string', () => {
      const base = { clientId: '1000000494', apiUser: 'POS_ENT_Test_001', rnd: 'rand' }
      expect(crypt.createHash(TA, { ...base, timeSpan: 20231209201121 })).toBe(
        crypt.createHash(TA, { ...base, timeSpan: '20231209201121' }),
      )
    })

    it('createHash hashes only defined text', () => {
      const spy = vi.spyOn(crypt, 'hashString')
      crypt.createHash(TA, {
        clientId: '1000000494',
        apiUser: 'POS_ENT_Test_001',
        rnd: 'rand',
        timeSpan: '20231209201121',
      })
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0]?.[0]).not.toContain('undefined')
      expect(spy.mock.calls[0]?.[0]).toBe(`${SECRET}1000000494POS_ENT_Test_001rand20231209201121`)
    })

    it('createHash never logs', () => {
      crypt.createHash(TA, {
        clientId: '1000000494',
        apiUser: 'POS_ENT_Test_001',
        rnd: 'rand',
        timeSpan: '20231209201121',
      })
      for (const fn of Object.values(logger)) expect(fn).not.toHaveBeenCalled()
    })

    it('generates 24 uppercase hex characters', () => {
      expect(crypt.generateRandomString()).toMatch(/^[0-9A-F]{24}$/)
    })
  })
})
