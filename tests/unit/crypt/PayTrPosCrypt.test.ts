import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayTrPosCrypt } from '../../../src/crypt/PayTrPosCrypt.js'
import { PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosLogger } from '../../../src/logger.js'
import type { GatewayResponseData } from '../../../src/types.js'

type MockLogger = { [K in keyof PosLogger]: ReturnType<typeof vi.fn> }

function makeLogger(): MockLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

// PT: the account the crypt vectors and notification fixtures verify with (salt first, key second).
const SALT = 'YEUaNcdHXqyt7hjt'
const KEY = 'wWwU8buJp6jo1r25'
const PT = AccountFactory.createPayTrPosAccount('paytr', '123456', SALT, KEY)
// PM: the mapper/gateway account, salt and key swapped.
const PM = AccountFactory.createPayTrPosAccount('paytr', '123456', KEY, SALT)

const H = (msg: string, key: string): string => createHmac('sha256', key).update(msg, 'utf8').digest('base64')
const HASH44 = /^[A-Za-z0-9+/]{43}=$/

const NV0 = {
  hash: 'ZDVOQUw4aDJhNR5dWYBC5bD95bLtSOtj9DzzSQ9sUHs=',
  merchant_oid: '202606234E4E',
  status: 'success',
  total_amount: '1001',
}
const NV1 = {
  merchant_oid: '20260624B505',
  status: 'success',
  total_amount: '1001',
  hash: '+jxQ32k1XbdS6i7iBQecCZ7fFhRrStaZBMvbsRzRVZE=',
}
const NV2 = {
  merchant_oid: '20260623E335',
  status: 'success',
  total_amount: '1001',
  hash: 'kwKu739W963OrNp5CSIecYlBpp8x2mql1wDWtSWZhjc=',
}
const NV4 = {
  merchant_oid: 'order-host-fail',
  status: 'failed',
  total_amount: '0',
  hash: 'Gsziv4HgGOh5m6Ao8nhj8mmgaeAtUNq9erZSpJCqw1E=',
}
const NV5 = {
  merchant_oid: 'ORDER42',
  status: 'success',
  total_amount: '1100',
  hash: 'pBFm4R9p/FFX+TO4mhNrY0A9oieV+/MEXN8vUpvCp88=',
}
const NV6 = {
  merchant_oid: 'ORDER42',
  status: 'success',
  total_amount: '1050',
  hash: 'nyBkxGxY4WhyEnO/XVEQMmxTv7TXC2EQ0n9IwCkn4rA=',
}
const NV7 = {
  merchant_oid: 'ORDER42',
  status: 'success',
  total_amount: '1049',
  hash: 'Pt2OXVpV406Fe9yxREZwq13dKgdkH+CycFDaV9wzYis=',
}

const iframe = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  merchant_id: '123456',
  user_ip: '127.0.0.1',
  merchant_oid: 'order-123',
  email: 'test@example.com',
  payment_amount: '10050',
  user_basket: 'W1siUHJvZHVjdCIsIjEwLjUwIiwxXV0=',
  no_installment: '0',
  max_installment: '0',
  currency: 'TL',
  test_mode: '1',
  ...over,
})

describe('PayTrPosCrypt', () => {
  let logger: MockLogger
  let crypt: PayTrPosCrypt

  beforeEach(() => {
    logger = makeLogger()
    crypt = new PayTrPosCrypt(logger as unknown as PosLogger)
  })

  const check = (data: unknown, who = PT): boolean => crypt.check3DHash(who, data as GatewayResponseData)

  it('testSupports', () => {
    expect(PayTrPosCrypt.supports('PayTrPos')).toBe(true)
    expect(PayTrPosCrypt.supports('AkbankPos')).toBe(false)
  })

  describe('check3DHash', () => {
    it('success_real_callback_data', () => {
      expect(check(NV0)).toBe(true)
    })
    it('wrong_hash', () => {
      expect(check({ ...NV0, hash: 'wronghash==' })).toBe(false)
    })
    it('missing_hash_key', () => {
      const { hash: _hash, ...rest } = NV0
      expect(check(rest)).toBe(false)
    })
    it('empty_data', () => {
      expect(check({})).toBe(false)
    })

    // addition: the notification fixtures verify with PT and with no other key order
    it.each([
      ['NV1', NV1],
      ['NV2', NV2],
      ['NV4', NV4],
      ['NV5', NV5],
      ['NV6', NV6],
      ['NV7', NV7],
    ])('%s verifies with PT and not with PM', (_n, body) => {
      expect(check(body)).toBe(true)
      expect(check(body, PM)).toBe(false)
    })

    // addition: a hash of another length or type never verifies and never throws
    it.each([
      ['43 chars', NV0.hash.slice(0, 43)],
      ['45 chars', `${NV0.hash}A`],
      ['null', null],
      ['array', [NV0.hash]],
      ['object', {}],
      ['number', 5],
    ])('hash %s is false', (_n, hash) => {
      expect(check({ ...NV0, hash })).toBe(false)
    })

    // addition: the signed values are own strings only
    it.each([
      ['number order id', { merchant_oid: 5 }],
      ['object order id', { merchant_oid: {} }],
      ['array status', { status: ['success'] }],
      ['number total', { total_amount: 1001 }],
      ['boolean status', { status: true }],
    ])('%s is false', (_n, over) => {
      expect(check({ ...NV0, ...over })).toBe(false)
    })

    // addition: an absent total counts as the empty string
    it('an absent total_amount signs as the empty string', () => {
      const hash = H(`ORDER42${SALT}failed`, KEY)
      expect(check({ merchant_oid: 'ORDER42', status: 'failed', hash })).toBe(true)
      expect(check({ merchant_oid: 'ORDER42', status: 'failed', total_amount: null, hash })).toBe(true)
      expect(check({ merchant_oid: 'ORDER42', status: 'failed', total_amount: '', hash })).toBe(true)
    })

    // addition: inherited values never count
    it('ignores inherited fields', () => {
      const body = Object.create({ merchant_oid: NV0.merchant_oid, status: 'success', total_amount: '1001' })
      body.hash = NV0.hash
      expect(check(body)).toBe(false)
      expect(check(Object.create(NV0))).toBe(false)
    })

    // addition: any input shape returns false instead of throwing
    it.each([null, undefined, 'x', 5, true, [], [NV0]])('non-object %j is false', (value) => {
      expect(check(value)).toBe(false)
    })

    // addition: only the order id is logged on failure
    it('logs the order id only on failure', () => {
      check({ ...NV0, hash: `${'A'.repeat(43)}=` })
      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(logger.error).toHaveBeenCalledWith('hash check failed', { order_id: NV0.merchant_oid })
      const logged = JSON.stringify([...logger.error.mock.calls, ...logger.debug.mock.calls])
      expect(logged).not.toContain(NV0.hash)
      expect(logged).not.toContain(SALT)
      expect(logged).not.toContain(KEY)
      expect(logged).not.toContain(H(`${NV0.merchant_oid}${SALT}success1001`, KEY))
    })

    // addition: a long or non-string order id never reaches the log
    it('logs a long order id cut and a non-string order id not at all', () => {
      check({ ...NV0, merchant_oid: 'o'.repeat(200) })
      expect(logger.error).toHaveBeenLastCalledWith('hash check failed', { order_id: 'o'.repeat(64) })
      check({ ...NV0, merchant_oid: { a: 1 } })
      expect(logger.error).toHaveBeenLastCalledWith('hash check failed', { order_id: undefined })
    })

    // addition: success logs no data
    it('logs nothing sensitive on success', () => {
      expect(check(NV0)).toBe(true)
      expect(logger.error).not.toHaveBeenCalled()
      expect(JSON.stringify(logger.debug.mock.calls)).not.toContain(NV0.hash)
    })

    // addition: the signed message is order id, salt, status, total; the salt separates the order id from the rest,
    // so every regrouping that still verifies is the original or a body whose status is not exactly "success"
    it.each([
      ['NV4', NV4],
      ['NV1', NV1],
    ])('%s: every regrouping around the salt that verifies is the original or no approval', (_n, body) => {
      const message = `${body.merchant_oid}${SALT}${body.status}${body.total_amount}`
      let verified = 0
      for (let i = 0; i <= message.length; i++) {
        if (message.slice(i, i + SALT.length) !== SALT) continue
        const rest = message.slice(i + SALT.length)
        for (let k = 0; k <= rest.length; k++) {
          const candidate = {
            merchant_oid: message.slice(0, i),
            status: rest.slice(0, k),
            total_amount: rest.slice(k),
            hash: body.hash,
          }
          if (!check(candidate)) continue
          verified++
          const original =
            candidate.merchant_oid === body.merchant_oid &&
            candidate.status === body.status &&
            candidate.total_amount === body.total_amount
          expect(original || candidate.status !== 'success').toBe(true)
        }
      }
      expect(verified).toBeGreaterThan(1)
    })
  })

  describe('createHash', () => {
    const cases: [string, Record<string, unknown>, string][] = [
      [
        'RV-C1 history',
        { merchant_id: '123456', start_date: '2026-06-01 00:00:00', end_date: '2026-06-03 23:59:59' },
        'wlPtqQINumrhu5CNYON0mQzbzhSLWM8699d9htCoy14=',
      ],
      ['RV-C2 iframe_token', iframe(), 'O5CaLankrigiiPDh3G75lLWdRX6wrEXGbLRjt37tuzY='],
      [
        'RV-C3 direct_payment',
        {
          merchant_id: '123456',
          user_ip: '127.0.0.1',
          merchant_oid: 'order-456',
          email: 'test@example.com',
          payment_amount: '5000',
          payment_type: 'card',
          installment_count: '0',
          currency: 'TL',
          test_mode: '1',
          non_3d: '1',
        },
        'guwHEsodarZg3KTuihE7fpb+qAdKI0IQMUkrGFWZDO0=',
      ],
      [
        'RV-C4 refund',
        { merchant_id: '123456', merchant_oid: 'order-789', return_amount: '5000' },
        '7ZqQEds0nem2gCqpLltwuNlmV9f7KHVlc73qeiNjwMg=',
      ],
      [
        'RV-C5 status_query',
        { merchant_id: '123456', merchant_oid: 'order-999' },
        'mIFJNpzMuo/gd9pcPNBinujmMVlEkR3DHZ6stLoQo/s=',
      ],
      [
        'RV-C6 installment_rates',
        { merchant_id: '123456', request_id: 'REQ12345' },
        'dx7O59UIbRaErFkP72oGXtQb/TgwFs8l/Qznl06iLls=',
      ],
      [
        'RV-C7 bin_query',
        { merchant_id: '123456', bin_number: '415956' },
        'lAB6uLq369TxD4S7VDGIzOYt6Fy3XKicfn15Xy1TiBM=',
      ],
    ]

    it.each(cases)('%s', (_n, data, expected) => {
      expect(crypt.createHash(PT, data)).toBe(expected)
    })

    it('create3DHash equals createHash for the iframe row', () => {
      expect(crypt.create3DHash(PT, iframe() as Record<string, string>)).toBe(crypt.createHash(PT, iframe()))
    })

    // addition: numbers sign as their decimal text, with the mapper's typed data and the mapper account
    it('RV1 typed iframe data (numbers) with PM', () => {
      const data = iframe({
        payment_amount: 1050,
        user_basket: 'W1sib3JkZXItMTIzIiwxMC41LDFdXQ==',
        no_installment: 1,
        max_installment: 0,
        test_mode: 0,
      })
      expect(crypt.createHash(PM, data)).toBe('OXyeQ9gQWRMM8dTZofjEuFCfKbNuMT6A3KA/eP3N4kk=')
      expect(crypt.createHash(PM, { ...data, payment_amount: '1050', no_installment: '1', test_mode: '0' })).toBe(
        'OXyeQ9gQWRMM8dTZofjEuFCfKbNuMT6A3KA/eP3N4kk=',
      )
    })

    // addition: the other mapper rows with the mapper account
    it('RV6 / RV2 / RV3 / RV4 / RV5 with PM', () => {
      expect(
        crypt.createHash(
          PM,
          iframe({
            payment_amount: 1050,
            user_basket: 'W1sib3JkZXItMTIzIiwxMC41LDFdXQ==',
            no_installment: 0,
            max_installment: 3,
            test_mode: 1,
          }),
        ),
      ).toBe('7Y07/sUOqF8MJMEisuM2GqPjFKLucvB69lC9GS/A6+U=')
      expect(
        crypt.createHash(PM, {
          merchant_id: '123456',
          user_ip: '127.0.0.1',
          merchant_oid: 'order-123',
          email: 'test@example.com',
          payment_amount: '10.50',
          payment_type: 'card',
          installment_count: 0,
          currency: 'TL',
          test_mode: 0,
          non_3d: 0,
        }),
      ).toBe('X9qZPa0RdLpsTTYr+y1NBageAScLfdhp2MNOaIN5yJQ=')
      expect(
        crypt.createHash(PM, {
          merchant_id: '123456',
          user_ip: '127.0.0.1',
          merchant_oid: 'order-456',
          email: 'test@example.com',
          payment_amount: '50.00',
          payment_type: 'card',
          installment_count: 0,
          currency: 'TL',
          test_mode: 0,
          non_3d: 1,
        }),
      ).toBe('hu4O255FoK8oj8GBf/rW/nd37dl/Ya8Vr2rOtEF/cvc=')
      expect(crypt.createHash(PM, { merchant_id: '123456', merchant_oid: 'order-789', return_amount: '10.50' })).toBe(
        'ByvrSgSWGMqJY96KIJep2xRDBYzrBn63swqbsPLHPHI=',
      )
      expect(crypt.createHash(PM, { merchant_id: '123456', merchant_oid: 'order-999' })).toBe(
        'afNe9t3Xywh1Em6wDB5RKyc6A4rbI7uVh47XyaRHOs8=',
      )
    })

    // addition: a formula field that is absent, null, boolean or composite is an error, never a signed "undefined"
    it.each([
      [
        'iframe without user_basket',
        (() => {
          const { user_basket: _b, ...rest } = iframe()
          return rest
        })(),
        'user_basket',
      ],
      ['refund without merchant_oid', { merchant_id: '123456', return_amount: '5000' }, 'merchant_oid'],
      ['status without merchant_oid', { merchant_id: '123456' }, 'merchant_oid'],
      ['status without merchant_id', { merchant_oid: 'o' }, 'merchant_id'],
      ['null value', iframe({ email: null }), 'email'],
      ['true value', iframe({ email: true }), 'email'],
      ['false value', iframe({ email: false }), 'email'],
      ['object value', iframe({ email: {} }), 'email'],
      ['array value', iframe({ email: ['a'] }), 'email'],
      ['NaN value', iframe({ payment_amount: Number.NaN }), 'payment_amount'],
      ['Infinity value', iframe({ payment_amount: Number.POSITIVE_INFINITY }), 'payment_amount'],
      ['bin without merchant_id', { bin_number: '415956' }, 'merchant_id'],
      ['history without merchant_id', { start_date: 'a', end_date: 'b' }, 'merchant_id'],
      ['rates without request_id value', { merchant_id: '1', request_id: null }, 'merchant_oid'],
    ])('%s throws PosError naming the field', (_n, data, name) => {
      const spy = vi.spyOn(crypt, 'hashString')
      expect(() => crypt.createHash(PT, data as Record<string, unknown>)).toThrow(PosError)
      expect(() => crypt.createHash(PT, data as Record<string, unknown>)).toThrow(
        `PayTR request field "${name}" is missing`,
      )
      for (const call of spy.mock.calls) expect(call[0]).not.toContain('undefined')
    })

    // addition: inherited and nested values are not formula fields
    it('does not read inherited or nested values', () => {
      const inherited = Object.create({ merchant_oid: 'o' }) as Record<string, unknown>
      inherited.merchant_id = '123456'
      expect(() => crypt.createHash(PT, inherited)).toThrow('PayTR request field "merchant_oid" is missing')
      expect(() => crypt.createHash(PT, { merchant_id: '1', nested: { merchant_oid: 'o' } })).toThrow(
        'PayTR request field "merchant_oid" is missing',
      )
    })

    // addition: an empty string is signed as empty (custom queries)
    it('signs an empty string as empty', () => {
      expect(crypt.createHash(PT, { merchant_id: '123456', merchant_oid: '' })).toBe(H(`123456${SALT}`, KEY))
    })

    // addition: formula detection order
    it('a body with non_3d and no_installment uses the direct formula', () => {
      const direct = {
        merchant_id: '1',
        user_ip: 'i',
        merchant_oid: 'o',
        email: 'e',
        payment_amount: 'a',
        payment_type: 'card',
        installment_count: '0',
        currency: 'TL',
        test_mode: '0',
        non_3d: '1',
      }
      const both = { ...direct, no_installment: '1' }
      expect(crypt.createHash(PT, both)).toBe(crypt.createHash(PT, direct))
    })

    it('null non_3d does not select the direct formula', () => {
      expect(crypt.createHash(PT, iframe({ non_3d: null }))).toBe(crypt.createHash(PT, iframe()))
    })

    it('start_date alone falls through to the status formula', () => {
      expect(crypt.createHash(PT, { merchant_id: '1', merchant_oid: 'o', start_date: 'x' })).toBe(
        crypt.createHash(PT, { merchant_id: '1', merchant_oid: 'o' }),
      )
    })

    it('request_id wins over bin_number and return_amount over both', () => {
      expect(crypt.createHash(PT, { merchant_id: '1', request_id: 'r', bin_number: '415956' })).toBe(
        crypt.createHash(PT, { merchant_id: '1', request_id: 'r' }),
      )
      expect(
        crypt.createHash(PT, { merchant_id: '1', merchant_oid: 'o', return_amount: '5', bin_number: '415956' }),
      ).toBe(crypt.createHash(PT, { merchant_id: '1', merchant_oid: 'o', return_amount: '5' }))
    })

    it('return_amount wins over request_id and a refund over the iframe fields', () => {
      const refund = { merchant_id: '1', merchant_oid: 'o', return_amount: '5' }
      expect(crypt.createHash(PT, { ...refund, request_id: 'r', no_installment: '1' })).toBe(
        crypt.createHash(PT, refund),
      )
    })

    // addition: R9 the Direct API token signs adjacent values without separators; the library cannot see the shift,
    // the notification amount check catches the outcome
    it('SP1: a regrouped email and amount give the same token (documents the residual)', () => {
      const row = (email: string, amount: string): Record<string, unknown> => ({
        merchant_id: '123456',
        user_ip: '127.0.0.1',
        merchant_oid: 'ORDER42',
        email,
        payment_amount: amount,
        payment_type: 'card',
        installment_count: '0',
        currency: 'TL',
        test_mode: '0',
        non_3d: '0',
      })
      const a = crypt.createHash(PM, row('a@b.co', '10.50'))
      expect(a).toBe('7Xj5VLDN0Fvh+CqANIguJOR+k7wuqrYjSdKUpZ3zZGg=')
      // accepted by the crypt; the gateway rejects the outcome through the notification's signed total amount
      expect(crypt.createHash(PM, row('a@b.co1', '0.50'))).toBe(a)
    })
  })

  describe('generateRandomString / hashString / hashFromParams', () => {
    it.each([
      [undefined, 24],
      [16, 16],
    ])('generateRandomString(%s) has %s hex chars', (length, expected) => {
      const s = length === undefined ? crypt.generateRandomString() : crypt.generateRandomString(length)
      expect(s).toHaveLength(expected)
      expect(s).toMatch(/^[0-9A-F]+$/)
    })

    it('hashString of test-string (empty key)', () => {
      expect(crypt.hashString('test-string')).toBe('HdQYuvtRLkP0h8lE1t71qtcxH/Nl25OCqp3JdoO8Sao=')
      expect(crypt.hashString('test-string', null)).toBe('HdQYuvtRLkP0h8lE1t71qtcxH/Nl25OCqp3JdoO8Sao=')
    })

    it('hashString keys the HMAC and yields 44 base64 chars', () => {
      expect(crypt.hashString('x', KEY)).toBe(H('x', KEY))
      expect(crypt.hashString('x', KEY)).toMatch(HASH44)
    })

    // deviation: C6 PosError replaces the invalid-argument error
    it('hashFromParams with empty params throws', () => {
      expect(() => crypt.hashFromParams(PT, {}, '', ':')).toThrow(PosError)
      expect(() => crypt.hashFromParams(PT, {}, '', ':')).toThrow('hashParamsValue cannot be empty')
    })

    // addition: the salt is appended and the key signs
    it('hashFromParams signs the named values plus the salt with the key', () => {
      expect(crypt.hashFromParams(PT, { a: '1', b: '2' }, 'a:b', ':')).toBe(H(`12${SALT}`, KEY))
    })
  })
})
