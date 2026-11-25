import { describe, expect, it, vi } from 'vitest'
import { IyzicoPosQueryRequestDataMapper } from '../../../../../src/data-mapper/pos-query/request/IyzicoPosQueryRequestDataMapper.js'
import { IyzicoPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/IyzicoPosRequestValueFormatter.js'
import { IyzicoPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/IyzicoPosRequestValueMapper.js'
import { PosError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { LANG } from '../../../../../src/PosInterface.js'

const account = AccountFactory.createIyzicoPosAccount('iyzico', 'sandbox-apiKey', 'sandbox-secretKey')

function stubCrypt() {
  return { generateRandomString: vi.fn(() => 'rand-conv-id') }
}

function create(crypt: unknown = stubCrypt()) {
  return new IyzicoPosQueryRequestDataMapper(
    new IyzicoPosRequestValueMapper(),
    new IyzicoPosRequestValueFormatter(),
    crypt as never,
    LANG.TR,
  )
}

const sorted = (data: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(data).sort(([a], [b]) => (a < b ? -1 : 1)))

// deviation: dates are written in Türkiye time (UTC+03:00) whatever the server zone is
const DAY = new Date('2022-05-18T00:00:00+03:00')

describe('IyzicoPosQueryRequestDataMapper', () => {
  it('testSupports', () => {
    expect(IyzicoPosQueryRequestDataMapper.supports('IyzicoPos')).toBe(true)
    expect(IyzicoPosQueryRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  it('testIsTestMode', () => {
    const mapper = create()
    expect(mapper.isTestMode()).toBe(false)
    mapper.setTestMode(true)
    expect(mapper.isTestMode()).toBe(true)
  })

  it('testCreateCustomQueryRequestDataIsPassthrough', () => {
    const requestData = { locale: 'tr', conversationId: 'abc123' }
    expect(create().createCustomQueryRequestData(account, requestData)).toEqual(requestData)
  })

  it.each([
    ['default_lang_page_1', { transaction_date: DAY }, { locale: 'tr', transactionDate: '2022-05-18', page: 1 }],
    [
      'explicit_lang_en_page_2',
      { transaction_date: DAY, lang: LANG.EN, page: 2 },
      { locale: 'en', transactionDate: '2022-05-18', page: 2 },
    ],
  ])('testCreateHistoryRequestData %s', (_name, data, expected) => {
    expect(sorted(create().createHistoryRequestData(account, data))).toEqual(sorted(expected))
  })

  it('testCreateInstallmentRatesRequestDataThrows', () => {
    expect(() => create().createInstallmentRatesRequestData(account, {})).toThrow(UnsupportedTransactionTypeError)
  })

  it.each([
    ['with_bin', { bin: '415956' }, { locale: 'tr', conversationId: 'rand-conv-id', binNumber: '415956' }],
    [
      'with_bin_and_explicit_lang',
      { bin: '415956', lang: LANG.EN },
      { locale: 'en', conversationId: 'rand-conv-id', binNumber: '415956' },
    ],
  ])('testCreateBinListRequestData %s', (_name, params, expected) => {
    const crypt = stubCrypt()
    const actual = create(crypt).createBinListRequestData(account, params)
    expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
    expect(sorted(actual)).toEqual(sorted(expected))
  })

  it.each([
    ['without_bin', { amount: 100 }, { locale: 'tr', conversationId: 'rand-conv-id', price: 100 }],
    [
      'with_bin',
      { amount: 100, bin: '54308100' },
      { locale: 'tr', conversationId: 'rand-conv-id', price: 100, binNumber: '54308100' },
    ],
    [
      'with_explicit_lang',
      { amount: 250, lang: LANG.EN },
      { locale: 'en', conversationId: 'rand-conv-id', price: 250 },
    ],
  ])('testCreateInstallmentPricesRequestData %s', (_name, params, expected) => {
    const crypt = stubCrypt()
    const actual = create(crypt).createInstallmentPricesRequestData(account, params)
    expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
    expect(sorted(actual)).toEqual(sorted(expected))
  })

  describe('additions', () => {
    // addition: a BIN has 6 or 8 digits (text or whole number); anything else is refused before a request exists
    it.each([
      [{}],
      [{ bin: '41595' }],
      [{ bin: '4159561' }],
      [{ bin: '415956789' }],
      [{ bin: '41595a' }],
      [{ bin: 415956.5 }],
      [{ bin: null }],
      [{ bin: ['415956'] }],
      [{ bin: { toString: () => '415956' } }],
    ])('getBinList %j is refused', (params) => {
      expect(() => create().createBinListRequestData(account, params as never)).toThrow(PosError)
    })

    // addition: a whole number BIN is accepted as text
    it('a numeric 6-digit BIN is sent as text', () => {
      expect(create().createBinListRequestData(account, { bin: 415956 }).binNumber).toBe('415956')
    })

    // addition: an inherited BIN is not a BIN
    it('an inherited BIN is refused', () => {
      const params = Object.create({ bin: '415956' }) as Record<string, unknown>
      expect(() => create().createBinListRequestData(account, params)).toThrow(PosError)
    })

    // addition: the amount of an installment query is validated like an order amount
    it.each([
      [{}],
      [{ amount: 0 }],
      [{ amount: -1 }],
      [{ amount: 'x' }],
      [{ amount: Number.NaN }],
      [{ amount: 1e13 }],
      [{ amount: 0.001 }],
      [{ amount: { a: 1 } }],
    ])('getInstallmentPrices %j is refused', (params) => {
      expect(() => create().createInstallmentPricesRequestData(account, params as never)).toThrow(PosError)
    })

    // addition: an optional BIN that is given must be valid
    it.each([
      [{ amount: 100, bin: '1234567' }],
      [{ amount: 100, bin: 'abcdef' }],
      [{ amount: 100, bin: 12345 }],
      [{ amount: 100, bin: {} }],
    ])('an invalid optional BIN %j is refused', (params) => {
      expect(() => create().createInstallmentPricesRequestData(account, params as never)).toThrow(PosError)
    })

    // addition: an absent, undefined or null BIN means no BIN
    it('a missing optional BIN is left out', () => {
      for (const bin of [undefined, null]) {
        const actual = create().createInstallmentPricesRequestData(account, { amount: 10, bin })
        expect(Object.hasOwn(actual, 'binNumber')).toBe(false)
      }
    })

    // addition: the price is whole kuruş divided by 100, so its JSON text is the amount (10.01, not 10.009999999999998)
    it('builds the price from whole kuruş', () => {
      expect(create().createInstallmentPricesRequestData(account, { amount: 10.01 }).price).toBe(10.01)
      expect(JSON.stringify(create().createInstallmentPricesRequestData(account, { amount: '10.50' }).price)).toBe(
        '10.5',
      )
      expect(create().createInstallmentPricesRequestData(account, { amount: 0.3 }).price).toBe(0.3)
    })

    // addition: the history day is required and the page is a whole number 1 to 10000
    it.each([
      [{}],
      [{ transaction_date: 'x' }],
      [{ transaction_date: '2022-05-18' }],
      [{ transaction_date: new Date('x') }],
      [{ transaction_date: DAY, page: 0 }],
      [{ transaction_date: DAY, page: 10001 }],
      [{ transaction_date: DAY, page: 1.5 }],
      [{ transaction_date: DAY, page: '2' }],
      [{ transaction_date: DAY, page: Number.NaN }],
    ])('history %j is refused', (data) => {
      expect(() => create().createHistoryRequestData(account, data as never)).toThrow(PosError)
    })

    // addition: the history day is the Türkiye calendar day of the instant
    it('writes the Türkiye calendar day', () => {
      const lateEvening = new Date('2022-05-18T22:30:00Z') // 01:30 the next day in Türkiye
      expect(create().createHistoryRequestData(account, { transaction_date: lateEvening }).transactionDate).toBe(
        '2022-05-19',
      )
    })

    // addition: null page falls back to 1
    it('a null page is page 1', () => {
      expect(create().createHistoryRequestData(account, { transaction_date: DAY, page: null }).page).toBe(1)
    })

    // addition: a non-object input is a PosError, not a TypeError
    it('non-object input is refused', () => {
      expect(() => create().createHistoryRequestData(account, null as never)).toThrow(PosError)
      expect(() => create().createBinListRequestData(account, undefined as never)).toThrow(PosError)
      expect(() => create().createInstallmentPricesRequestData(account, 5 as never)).toThrow(PosError)
    })
  })
})
