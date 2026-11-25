import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToslaPosCrypt } from '../../../../../src/crypt/ToslaPosCrypt.js'
import { ToslaPosQueryRequestDataMapper } from '../../../../../src/data-mapper/pos-query/request/ToslaPosQueryRequestDataMapper.js'
import { ToslaPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/ToslaPosRequestValueFormatter.js'
import { ToslaPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/ToslaPosRequestValueMapper.js'
import { PosError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { noopLogger } from '../../../../../src/logger.js'

const account = AccountFactory.createToslaPosAccount('tosla', '1000000494', 'POS_ENT_Test_001', 'POS_ENT_Test_001!*!*')

function stubCrypt() {
  return {
    generateRandomString: vi.fn(() => 'generated_rnd'),
    createHash: vi.fn((..._args: unknown[]) => 'generated_hash'),
  }
}

function create(crypt: unknown = stubCrypt()) {
  return new ToslaPosQueryRequestDataMapper(
    new ToslaPosRequestValueMapper(),
    new ToslaPosRequestValueFormatter(),
    crypt as never,
  )
}

function sorted(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
}

function withoutTimeSpan(value: Record<string, unknown>): Record<string, unknown> {
  const { timeSpan: _timeSpan, ...rest } = value
  return sorted(rest)
}

/** The request hash recomputed independently: base64(SHA-512(apiPass + clientId + apiUser + rnd + timeSpan)). */
function requestHash(rnd: string, timeSpan: string): string {
  return createHash('sha512')
    .update(`POS_ENT_Test_001!*!*1000000494POS_ENT_Test_001${rnd}${timeSpan}`, 'utf8')
    .digest('base64')
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ToslaPosQueryRequestDataMapper', () => {
  it('testSupports', () => {
    expect(ToslaPosQueryRequestDataMapper.supports('ToslaPos')).toBe(true)
    expect(ToslaPosQueryRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  it('testIsTestMode', () => {
    const mapper = create()
    expect(mapper.isTestMode()).toBe(false)
    mapper.setTestMode(true)
    expect(mapper.isTestMode()).toBe(true)
  })

  describe('testCreateCustomQueryRequestData', () => {
    it('without_account_data', () => {
      const crypt = stubCrypt()
      const actual = create(crypt).createCustomQueryRequestData(account, { bin: 415956 })
      expect(String(actual.timeSpan)).toHaveLength(14)
      expect(withoutTimeSpan(actual)).toEqual(
        sorted({
          apiUser: 'POS_ENT_Test_001',
          bin: 415956,
          clientId: '1000000494',
          hash: 'generated_hash',
          rnd: 'generated_rnd',
        }),
      )
      expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
      expect(crypt.createHash).toHaveBeenCalledTimes(1)
    })

    it('with_all_fields_pre_filled', () => {
      const crypt = stubCrypt()
      const input = {
        apiUser: 'CUSTOMUSER',
        bin: 415956,
        clientId: 'CUSTOMCLIENT',
        hash: 'pre_filled_hash',
        rnd: 'pre_filled_rnd',
        timeSpan: '20241103144302',
      }
      const actual = create(crypt).createCustomQueryRequestData(account, input)
      expect(String(actual.timeSpan)).toHaveLength(14)
      expect(withoutTimeSpan(actual)).toEqual(withoutTimeSpan(input))
      expect(actual.timeSpan).toBe('20241103144302')
      // the account data object is always built, so the random value is generated once; a given hash is never recomputed
      expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
      expect(crypt.createHash).not.toHaveBeenCalled()
    })
  })

  it('testCreateHistoryRequestDataThrows', () => {
    expect(() => create().createHistoryRequestData(account, {})).toThrow(UnsupportedTransactionTypeError)
  })

  it('testCreateInstallmentRatesRequestData', () => {
    const crypt = stubCrypt()
    const actual = create(crypt).createInstallmentRatesRequestData(account, { bin: '415956' })
    expect(String(actual.timeSpan)).toHaveLength(14)
    expect(actual.clientId).toBe('1000000494')
    expect(actual.apiUser).toBe('POS_ENT_Test_001')
    expect(actual.rnd).toBe('generated_rnd')
    expect(actual.bin).toBe('415956')
    expect(actual.hash).toBe('generated_hash')
    expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
    expect(crypt.createHash).toHaveBeenCalledTimes(1)
  })

  it('testCreateInstallmentPricesRequestData', () => {
    const crypt = stubCrypt()
    const actual = create(crypt).createInstallmentPricesRequestData(account, { amount: 500.0 })
    expect(String(actual.timeSpan)).toHaveLength(14)
    expect(actual.clientId).toBe('1000000494')
    expect(actual.apiUser).toBe('POS_ENT_Test_001')
    expect(actual.rnd).toBe('generated_rnd')
    // deviation: Q4 kuruş on the wire, the caller passes TL
    expect(actual.amount).toBe(50000)
    expect(actual.isCommission).toBe(1)
    expect(actual.hash).toBe('generated_hash')
    expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
    expect(crypt.createHash).toHaveBeenCalledTimes(1)
  })

  describe('with the real crypt', () => {
    const real = () => create(new ToslaPosCrypt(noopLogger))

    // addition: the hash equals the independent recomputation of the produced body's rnd and timeSpan
    it('signs the rates, prices and custom bodies', () => {
      for (const body of [
        real().createInstallmentRatesRequestData(account, { bin: '415956' }),
        real().createInstallmentPricesRequestData(account, { amount: 100 }),
        real().createCustomQueryRequestData(account, { bin: 415956 }),
      ]) {
        expect(body.rnd).toMatch(/^[0-9A-F]{24}$/)
        expect(body.hash).toBe(requestHash(String(body.rnd), String(body.timeSpan)))
      }
    })

    // addition: the fixture rnd and timeSpan reproduce the known request hash
    it('reproduces a known request hash', () => {
      expect(requestHash('rand', '20231209214708')).toBe(
        '+XGO1qv+6W7nXZwSsYMaRrWXhi+99jffLvExGsFDodYyNadOG7OQKsygzly5ESDoNIS19oD2U+hSkVeT6UTAFA==',
      )
    })

    // addition: the time span is Türkiye time whatever the server zone is
    it('writes the time span in Türkiye time', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-03-30T21:30:05Z'))
      expect(real().createInstallmentRatesRequestData(account, { bin: '415956' }).timeSpan).toBe('20240331003005')
      expect(real().createCustomQueryRequestData(account, {}).timeSpan).toBe('20240331003005')
    })

    // addition: an undefined caller hash counts as absent and is computed
    it('computes the hash when the caller gave undefined', () => {
      const body = real().createCustomQueryRequestData(account, { bin: 415956, hash: undefined })
      expect(body.hash).toBe(requestHash(String(body.rnd), String(body.timeSpan)))
    })

    // addition: an explicit null hash is computed like an absent one
    it('computes the hash when the caller gave null', () => {
      const body = real().createCustomQueryRequestData(account, { bin: 415956, hash: null })
      expect(body.hash).toBe(requestHash(String(body.rnd), String(body.timeSpan)))
    })

    // addition: a caller hash is kept as given, caller order comes first
    it('keeps the caller hash and key order', () => {
      const body = real().createCustomQueryRequestData(account, { z: 1, hash: 'mine', a: 2 })
      expect(Object.keys(body)).toEqual(['z', 'hash', 'a', 'clientId', 'apiUser', 'rnd', 'timeSpan'])
      expect(body.hash).toBe('mine')
    })

    // addition: the signature covers the merged fields, so a caller timeSpan is what gets signed
    it('signs the caller supplied rnd and time span', () => {
      const body = real().createCustomQueryRequestData(account, { rnd: 'abc', timeSpan: '20231209214708' })
      expect(body.hash).toBe(requestHash('abc', '20231209214708'))
    })

    // addition: rates need a 6-digit bin
    it.each([
      ['a number', 415956, 415956],
      ['a string', '415956', '415956'],
    ])('rates keep a 6-digit bin given as %s', (_n, bin, expected) => {
      expect(real().createInstallmentRatesRequestData(account, { bin }).bin).toBe(expected)
    })

    it.each([
      ['five digits', '41595'],
      ['seven digits', '4159560'],
      ['a letter', '41595a'],
      ['a trailing newline', '415956\n'],
      ['a decimal number', 415956.5],
      ['a negative number', -415956],
      ['five digits as number', 41595],
      ['null', null],
      ['an object', { bin: '415956' }],
      ['an array', ['415956']],
      ['a boolean', true],
    ])('rates reject a bin of %s', (_n, bin) => {
      expect(() => real().createInstallmentRatesRequestData(account, { bin })).toThrow(PosError)
    })

    it('rates reject a missing or inherited bin', () => {
      expect(() => real().createInstallmentRatesRequestData(account, {})).toThrow(PosError)
      expect(() => real().createInstallmentRatesRequestData(account, Object.create({ bin: '415956' }))).toThrow(
        PosError,
      )
    })

    // addition: prices send kuruş exactly
    it.each([
      ['100.5', '100.5', 10050],
      ['a number', 100, 10000],
      ['1.15', 1.15, 115],
      ['8.2', 8.2, 820],
      ['0.01', 0.01, 1],
      ['a padded string', ' 12.34 ', 1234],
    ])('prices send %s as kuruş', (_n, amount, kurus) => {
      const body = real().createInstallmentPricesRequestData(account, { amount })
      expect(body.amount).toBe(kurus)
      expect(body.isCommission).toBe(1)
    })

    it.each([
      ['zero', 0],
      ['negative', -1],
      ['text', 'abc'],
      ['exponent text', '1e3'],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['1e13', 1e13],
      ['half a kuruş', 0.001],
      ['null', null],
      ['an object', {}],
      ['a boolean', true],
    ])('prices reject an amount of %s', (_n, amount) => {
      expect(() => real().createInstallmentPricesRequestData(account, { amount })).toThrow(PosError)
    })

    it('prices reject a missing amount', () => {
      expect(() => real().createInstallmentPricesRequestData(account, {})).toThrow(PosError)
    })
  })
})
