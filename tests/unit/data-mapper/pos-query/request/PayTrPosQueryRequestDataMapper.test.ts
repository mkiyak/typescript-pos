import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { PayTrPosCrypt } from '../../../../../src/crypt/PayTrPosCrypt.js'
import { PayTrPosQueryRequestDataMapper } from '../../../../../src/data-mapper/pos-query/request/PayTrPosQueryRequestDataMapper.js'
import { PayTrPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/PayTrPosRequestValueFormatter.js'
import { PayTrPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/PayTrPosRequestValueMapper.js'
import { PosError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { noopLogger } from '../../../../../src/logger.js'

// the mapper account swaps salt and key against the crypt account (stubbed crypt in the mapper cases)
const account = AccountFactory.createPayTrPosAccount('paytr', '123456', 'wWwU8buJp6jo1r25', 'YEUaNcdHXqyt7hjt')
const SALT = 'YEUaNcdHXqyt7hjt'
const KEY = 'wWwU8buJp6jo1r25'
const realAccount = AccountFactory.createPayTrPosAccount('paytr', '123456', SALT, KEY)

function stubCrypt() {
  return {
    generateRandomString: vi.fn(() => 'RAND24'),
    createHash: vi.fn((..._args: unknown[]) => 'mock-token'),
  }
}

function create(crypt: unknown = stubCrypt()) {
  return new PayTrPosQueryRequestDataMapper(
    new PayTrPosRequestValueMapper(),
    new PayTrPosRequestValueFormatter(),
    crypt as never,
  )
}

const real = () => create(new PayTrPosCrypt(noopLogger))
const token = (message: string) =>
  createHmac('sha256', KEY)
    .update(message + SALT, 'utf8')
    .digest('base64')

// deviation: the window is written in Türkiye time (UTC+03:00) whatever the server zone is
const START = new Date('2026-06-01T00:00:00+03:00')
const END = new Date('2026-06-03T23:59:59+03:00')

describe('PayTrPosQueryRequestDataMapper', () => {
  it('testSupports', () => {
    expect(PayTrPosQueryRequestDataMapper.supports('PayTrPos')).toBe(true)
    expect(PayTrPosQueryRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  it('testIsTestMode', () => {
    const mapper = create()
    expect(mapper.isTestMode()).toBe(false)
    mapper.setTestMode(true)
    expect(mapper.isTestMode()).toBe(true)
  })

  it('testCreateCustomQueryRequestDataWithoutToken', () => {
    const crypt = stubCrypt()
    const actual = create(crypt).createCustomQueryRequestData(account, { custom_field: 'value' })

    expect(crypt.createHash).toHaveBeenCalledTimes(1)
    expect(crypt.createHash).toHaveBeenCalledWith(account, { custom_field: 'value', merchant_id: '123456' })
    expect(actual).toEqual({ custom_field: 'value', merchant_id: '123456', paytr_token: 'mock-token' })
  })

  it('testCreateCustomQueryRequestDataWithExistingToken', () => {
    const crypt = stubCrypt()
    const input = { merchant_id: 'override', paytr_token: 'existing-token' }
    const actual = create(crypt).createCustomQueryRequestData(account, input)

    expect(crypt.createHash).not.toHaveBeenCalled()
    expect(actual).toEqual(input)
  })

  it.each([
    [
      'production_mode',
      false,
      { merchant_id: '123456', start_date: '2026-06-01 00:00:00', end_date: '2026-06-03 23:59:59', dummy: 0 },
    ],
    [
      'test_mode',
      true,
      { merchant_id: '123456', start_date: '2026-06-01 00:00:00', end_date: '2026-06-03 23:59:59', dummy: 1 },
    ],
  ])('testCreateHistoryRequestData %s', (_name, testMode, expectedWithoutToken) => {
    // deviation: the report API requires `dummy`, so it is sent as 0 in live mode too and is not signed
    const crypt = stubCrypt()
    const mapper = create(crypt)
    mapper.setTestMode(testMode)

    const actual = mapper.createHistoryRequestData(account, { start_date: START, end_date: END })

    expect(crypt.createHash).toHaveBeenCalledWith(account, expectedWithoutToken)
    expect(Object.keys(actual)).toEqual([...Object.keys(expectedWithoutToken), 'paytr_token'])
    expect(actual).toEqual({ ...expectedWithoutToken, paytr_token: 'mock-token' })
  })

  it('testCreateInstallmentRatesRequestData', () => {
    const crypt = stubCrypt()
    const actual = create(crypt).createInstallmentRatesRequestData(account, {})

    expect(crypt.createHash).toHaveBeenCalledWith(account, { merchant_id: '123456', request_id: 'RAND24' })
    expect(actual).toEqual({ merchant_id: '123456', request_id: 'RAND24', paytr_token: 'mock-token' })
  })

  it('testCreateBinListRequestData', () => {
    const crypt = stubCrypt()
    const actual = create(crypt).createBinListRequestData(account, { bin: '415956' })

    expect(crypt.createHash).toHaveBeenCalledWith(account, { merchant_id: '123456', bin_number: '415956' })
    expect(actual).toEqual({ merchant_id: '123456', bin_number: '415956', paytr_token: 'mock-token' })
  })

  it('installment prices are not offered', () => {
    expect(() => create().createInstallmentPricesRequestData(account, {})).toThrow(UnsupportedTransactionTypeError)
  })

  // addition: mapper x real crypt, every emitted operation is signed with the formula of its endpoint
  describe('with the real crypt', () => {
    it('history token covers merchant_id, start_date, end_date and the salt; dummy is not signed', () => {
      for (const testMode of [false, true]) {
        const mapper = real()
        mapper.setTestMode(testMode)
        const out = mapper.createHistoryRequestData(realAccount, { start_date: START, end_date: END })
        expect(out.paytr_token).toBe(token('1234562026-06-01 00:00:002026-06-03 23:59:59'))
        expect(out.dummy).toBe(testMode ? 1 : 0)
      }
    })

    it('BIN token covers bin_number, merchant_id and the salt', () => {
      const out = real().createBinListRequestData(realAccount, { bin: '415956' })
      expect(out.paytr_token).toBe(token('415956123456'))
    })

    it('rates token covers merchant_id, request_id and the salt', () => {
      const out = real().createInstallmentRatesRequestData(realAccount, {})
      expect(out.request_id).toMatch(/^[0-9A-F]{24}$/)
      expect(out.paytr_token).toBe(token(`123456${out.request_id}`))
    })

    it('a custom query with merchant_oid is signed with the status formula', () => {
      const out = real().createCustomQueryRequestData(realAccount, { merchant_oid: 'X' })
      expect(out).toEqual({ merchant_oid: 'X', merchant_id: '123456', paytr_token: token('123456X') })
    })

    it('a custom query with the refund fields is signed with the refund formula', () => {
      const out = real().createCustomQueryRequestData(realAccount, { merchant_oid: 'X', return_amount: '1.00' })
      expect(out.paytr_token).toBe(token('123456X1.00'))
    })

    it('a custom query naming return_amount without merchant_oid is refused', () => {
      expect(() => real().createCustomQueryRequestData(realAccount, { return_amount: '1.00' })).toThrow(PosError)
    })

    it('a null merchant_id is taken from the account', () => {
      const out = real().createCustomQueryRequestData(realAccount, { merchant_oid: 'X', merchant_id: null })
      expect(out.merchant_id).toBe('123456')
    })
  })

  describe('history input', () => {
    const history = (data: Record<string, unknown>) => create().createHistoryRequestData(account, data)

    it('refuses an end before the start', () => {
      expect(() => history({ start_date: END, end_date: START })).toThrow(PosError)
    })

    it('allows exactly three days and refuses one second more', () => {
      const start = new Date('2026-06-01T00:00:00+03:00')
      expect(() => history({ start_date: start, end_date: new Date(start.getTime() + 3 * 86_400_000) })).not.toThrow()
      expect(() => history({ start_date: start, end_date: new Date(start.getTime() + 3 * 86_400_000 + 1000) })).toThrow(
        PosError,
      )
    })

    it.each([
      ['strings', { start_date: '2026-06-01', end_date: '2026-06-02' }],
      ['invalid dates', { start_date: new Date('x'), end_date: END }],
      ['missing', {}],
      ['inherited', Object.create({ start_date: START, end_date: END })],
    ])('refuses %s', (_name, data) => {
      expect(() => history(data as Record<string, unknown>)).toThrow(PosError)
    })
  })

  describe('BIN input', () => {
    const bin = (params: Record<string, unknown>) => create().createBinListRequestData(account, params)

    it.each([{}, { bin: '41595' }, { bin: 4159561 }, { bin: 'abcdef' }, { bin: null }, { bin: ['415956'] }])(
      'refuses %j before signing',
      (params) => {
        const crypt = stubCrypt()
        expect(() => create(crypt).createBinListRequestData(account, params)).toThrow(PosError)
        expect(crypt.createHash).not.toHaveBeenCalled()
      },
    )

    it('accepts an eight digit number and a six digit string', () => {
      expect(bin({ bin: 41595612 }).bin_number).toBe('41595612')
      expect(bin({ bin: '415956' }).bin_number).toBe('415956')
    })
  })
})
