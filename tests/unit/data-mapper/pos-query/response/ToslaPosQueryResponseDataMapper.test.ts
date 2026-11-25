import { describe, expect, it, vi } from 'vitest'
import { ToslaPosQueryResponseDataMapper } from '../../../../../src/data-mapper/pos-query/response/ToslaPosQueryResponseDataMapper.js'
import { ToslaPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/ToslaPosResponseValueFormatter.js'
import { ToslaPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/ToslaPosResponseValueMapper.js'
import { UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { noopLogger } from '../../../../../src/logger.js'

function create(logger = noopLogger) {
  return new ToslaPosQueryResponseDataMapper(
    new ToslaPosResponseValueFormatter(),
    new ToslaPosResponseValueMapper(),
    logger,
  )
}
const mapper = create()

type Raw = Record<string, unknown>

const rate = (installment: number, r = 1, constant = 0) => ({ installment, rate: r, constant })

function ratesAnswer(installmentRate: unknown, over: Raw = {}): Raw {
  return {
    CardPrefix: 415956,
    BankId: 13,
    BankCode: '0111',
    BankName: 'QNB FinansBank',
    CardName: 'Card Finans',
    CardClass: 'Kredi Kartı',
    CardType: 'Visa',
    Country: 'TR',
    CommissionPackages: [{ packageName: null, InstallmentRate: installmentRate, BankCommission: 1.1 }],
    Code: 0,
    Message: '',
    ...over,
  }
}

const installmentRates = (result: { installment_rates: Array<{ rates: unknown[] }> }) =>
  result.installment_rates[0]?.rates

function pricesAnswer(options: unknown, over: Raw = {}): Raw {
  return { IsExist: false, InstallmentOptions: options, Code: 0, Message: 'Başarılı', ...over }
}

const installmentPrices = (result: { installment_prices: Array<{ prices: unknown[] }> }) =>
  result.installment_prices[0]?.prices

describe('ToslaPosQueryResponseDataMapper', () => {
  it('testSupports', () => {
    expect(ToslaPosQueryResponseDataMapper.supports('ToslaPos')).toBe(true)
    expect(ToslaPosQueryResponseDataMapper.supports('AssecoPos')).toBe(false)
  })

  it('testMapHistoryResponseThrows', () => {
    expect(() => mapper.mapHistoryResponse({})).toThrow(UnsupportedTransactionTypeError)
  })

  it('the bin list is not offered either', () => {
    expect(() => mapper.mapBinListResponse({})).toThrow(UnsupportedTransactionTypeError)
  })

  describe('testMapInstallmentRatesResponse', () => {
    it('success', () => {
      const input = ratesAnswer({
        T1: { Rate: 0, Constant: 0 },
        ...Object.fromEntries(Array.from({ length: 11 }, (_v, i) => [`T${i + 2}`, { Rate: 1, Constant: 0 }])),
      })
      const actual = mapper.mapInstallmentRatesResponse(input)
      expect(actual.all).toBe(input)
      expect({ ...actual, all: undefined }).toEqual({
        status: 'approved',
        error_message: null,
        installment_rates: [
          {
            bank_code: 111,
            bank_name: 'QNB FinansBank',
            card_prefix: '415956',
            card_type: 'visa',
            card_class: 'credit',
            card_family: null,
            rates: Array.from({ length: 11 }, (_v, i) => rate(i + 2)),
          },
        ],
        all: undefined,
      })
    })

    it('success_no_installment_rates', () => {
      const input = ratesAnswer({})
      const actual = mapper.mapInstallmentRatesResponse(input)
      expect(actual.all).toBe(input)
      expect({ ...actual, all: undefined }).toEqual({
        status: 'approved',
        error_message: null,
        installment_rates: [],
        all: undefined,
      })
    })

    it('failed', () => {
      const input = { Code: 1, Message: 'Geçersiz istek' }
      const actual = mapper.mapInstallmentRatesResponse(input)
      expect(actual.all).toBe(input)
      expect({ ...actual, all: undefined }).toEqual({
        status: 'declined',
        error_message: 'Geçersiz istek',
        installment_rates: [],
        all: undefined,
      })
    })
  })

  describe('testMapInstallmentPricesResponse', () => {
    it('success', () => {
      const input = pricesAnswer([
        { Installment: 1, Title: 'Tek Çekim', Amount: 10000, Currency: 949 },
        { Installment: 2, Title: '2 Taksit', Amount: 10101, Currency: 949 },
        { Installment: 3, Title: '3 Taksit', Amount: 10101, Currency: 949 },
      ])
      const actual = mapper.mapInstallmentPricesResponse(input)
      expect(actual.all).toBe(input)
      // deviation: Q4 the bank answers kuruş, the library answers TL
      expect({ ...actual, all: undefined }).toEqual({
        status: 'approved',
        error_message: null,
        installment_prices: [
          {
            bank_code: null,
            bank_name: null,
            card_prefix: null,
            card_type: null,
            card_class: null,
            card_family: null,
            prices: [
              { installment: 1, installment_price: 100, total_price: 100 },
              { installment: 2, installment_price: 50.51, total_price: 101.01 },
              { installment: 3, installment_price: 33.67, total_price: 101.01 },
            ],
          },
        ],
        all: undefined,
      })
    })

    it('failed', () => {
      const input = { Code: 1, Message: 'Geçersiz istek' }
      const actual = mapper.mapInstallmentPricesResponse(input)
      expect(actual.all).toBe(input)
      expect({ ...actual, all: undefined }).toEqual({
        status: 'declined',
        error_message: 'Geçersiz istek',
        installment_prices: [],
        all: undefined,
      })
    })
  })

  // addition: strict parsing of the installment answers
  describe('rates parsing', () => {
    it.each([
      ['a string', '0'],
      ['a missing code', undefined],
      ['null', null],
      ['true', true],
      ['1', 1],
      ['-0 as text', '-0'],
      ['an object', {}],
      ['0.5', 0.5],
    ])('Code %s is declined', (_n, code) => {
      const input = ratesAnswer({ T2: { Rate: 1 } }, { Code: code })
      const actual = mapper.mapInstallmentRatesResponse(input)
      expect(actual.status).toBe('declined')
      expect(actual.installment_rates).toEqual([])
    })

    it('drops entries with bad keys or values and sorts the rest', () => {
      const warn = vi.fn()
      const m = create({ debug() {}, info() {}, warn, error() {} })
      const input = ratesAnswer({
        T12: { Rate: '2.5', Constant: '0.25' },
        T1: { Rate: 1 },
        TT2: { Rate: 1 },
        T2x: { Rate: 1 },
        T02: { Rate: 1 },
        T100: { Rate: 1 },
        T0: { Rate: 1 },
        T3: { Rate: '1,5' },
        T4: { Rate: {} },
        T5: { Rate: 3.5 },
        T6: { Rate: Number.NaN },
        T7: { Rate: Number.POSITIVE_INFINITY },
        T8: { Rate: '1e2' },
        T16: { Rate: 1_000_000 },
        T17: { Constant: -1_234_567.5 },
        T9: { Rate: ' 1' },
        T10: { Rate: [1] },
        T11: { Constant: true },
        T13: 'x',
        T14: null,
        T15: [],
        T2: { Rate: 0.5 },
        __proto__x: { Rate: 1 },
      })
      const actual = m.mapInstallmentRatesResponse(input)
      expect(installmentRates(actual)).toEqual([rate(2, 0.5, 0), rate(5, 3.5, 0), rate(12, 2.5, 0.25)])
      const logged = JSON.stringify(warn.mock.calls)
      expect(logged).toContain('T3')
      expect(logged).not.toContain('1,5')
    })

    it('absent and null Rate or Constant read as 0', () => {
      const actual = mapper.mapInstallmentRatesResponse(ratesAnswer({ T2: {}, T3: { Rate: null, Constant: null } }))
      expect(installmentRates(actual)).toEqual([rate(2, 0, 0), rate(3, 0, 0)])
    })

    it('keeps negative and 6-decimal strict decimal text', () => {
      const actual = mapper.mapInstallmentRatesResponse(
        ratesAnswer({ T2: { Rate: '-1.5', Constant: '123456.123456' }, T3: { Rate: '1234567' } }),
      )
      expect(installmentRates(actual)).toEqual([rate(2, -1.5, 123456.123456)])
    })

    it.each([
      ['an empty object', {}],
      ['null', null],
      ['an empty list', []],
      ['a list of a number', [5]],
      ['a list with a non-record first item', ['x']],
      ['a list whose first item has no rates', [{}]],
      ['a list whose rate table is a list', [{ InstallmentRate: [{ Rate: 1 }] }]],
      ['a text', 'T2'],
    ])('CommissionPackages as %s gives no rates but stays approved', (_n, packages) => {
      const actual = mapper.mapInstallmentRatesResponse({ Code: 0, Message: '', CommissionPackages: packages })
      expect(actual.status).toBe('approved')
      expect(actual.installment_rates).toEqual([])
    })

    it('only the first package is read', () => {
      const actual = mapper.mapInstallmentRatesResponse(
        ratesAnswer(
          { T2: { Rate: 1 } },
          { CommissionPackages: [{ InstallmentRate: { T2: { Rate: 1 } } }, { InstallmentRate: { T3: {} } }] },
        ),
      )
      expect(installmentRates(actual)).toEqual([rate(2)])
    })

    it('sorts T12, T2, T5 numerically', () => {
      const actual = mapper.mapInstallmentRatesResponse(ratesAnswer({ T12: {}, T2: {}, T5: {} }))
      expect((installmentRates(actual) as Array<{ installment: number }>).map((r) => r.installment)).toEqual([2, 5, 12])
    })

    it.each([
      ['BankCode X', { BankCode: 'X' }, 'bank_code', null],
      ['BankCode 5 digits', { BankCode: '01111' }, 'bank_code', null],
      ['BankCode number', { BankCode: 111 }, 'bank_code', 111],
      ['BankCode 5 digit number', { BankCode: 11111 }, 'bank_code', null],
      ['BankCode 4 digit number', { BankCode: 9999 }, 'bank_code', 9999],
      ['BankCode negative', { BankCode: -1 }, 'bank_code', null],
      ['BankCode fraction', { BankCode: 1.5 }, 'bank_code', null],
      ['BankCode object', { BankCode: {} }, 'bank_code', null],
      ['BankCode padded text', { BankCode: ' 111' }, 'bank_code', null],
      ['CardPrefix 4 digits', { CardPrefix: '4159' }, 'card_prefix', null],
      ['CardPrefix 4 digit number', { CardPrefix: 4159 }, 'card_prefix', null],
      ['CardPrefix 8 digits', { CardPrefix: '41595612' }, 'card_prefix', '41595612'],
      ['CardPrefix 9 digits', { CardPrefix: '415956123' }, 'card_prefix', null],
      ['CardPrefix letters', { CardPrefix: '41595a' }, 'card_prefix', null],
      ['CardPrefix object', { CardPrefix: {} }, 'card_prefix', null],
      ['CardPrefix fraction', { CardPrefix: 415956.5 }, 'card_prefix', null],
      ['CardType number', { CardType: 5 }, 'card_type', null],
      ['CardType unknown', { CardType: 'Unknown' }, 'card_type', null],
      ['CardType object', { CardType: {} }, 'card_type', null],
      ['CardClass object', { CardClass: {} }, 'card_class', null],
      ['CardClass unknown', { CardClass: 'x' }, 'card_class', null],
      ['BankName object', { BankName: {} }, 'bank_name', null],
      ['BankName number', { BankName: 5 }, 'bank_name', null],
      ['BankName 300 chars', { BankName: 'x'.repeat(300) }, 'bank_name', 'x'.repeat(256)],
    ])('%s', (_n, over, field, expected) => {
      const actual = mapper.mapInstallmentRatesResponse(ratesAnswer({ T2: {} }, over))
      expect(actual.installment_rates[0]?.[field as 'bank_code']).toBe(expected)
    })

    it('a long declined Message is cut to 256 characters', () => {
      const actual = mapper.mapInstallmentRatesResponse({ Code: 5, Message: 'm'.repeat(300) })
      expect(actual.error_message).toBe('m'.repeat(256))
    })

    it.each([
      ['an object', {}],
      ['a number', 5],
      ['a list', ['x']],
      ['empty text', ''],
      ['blank text', '  '],
      ['missing', undefined],
    ])('a declined Message of %s gives no message', (_n, message) => {
      const actual = mapper.mapInstallmentRatesResponse({ Code: 5, Message: message })
      expect(actual.error_message).toBeNull()
    })

    it('a declined answer carries no rates even when the body has them', () => {
      const actual = mapper.mapInstallmentRatesResponse(ratesAnswer({ T2: {} }, { Code: 2 }))
      expect(actual.installment_rates).toEqual([])
    })

    it('an inherited Code does not count', () => {
      const actual = mapper.mapInstallmentRatesResponse(Object.create({ Code: 0 }))
      expect(actual.status).toBe('declined')
    })
  })

  describe('prices parsing', () => {
    it('drops unusable options and sorts the rest', () => {
      const warn = vi.fn()
      const m = create({ debug() {}, info() {}, warn, error() {} })
      const input = pricesAnswer([
        { Installment: 3, Amount: '10101' },
        { Installment: 0, Amount: 100 },
        { Installment: '2.5', Amount: 100 },
        { Installment: 2.5, Amount: 100 },
        { Installment: 100, Amount: 100 },
        { Installment: 2, Amount: -1 },
        { Installment: 2, Amount: '1e3' },
        { Installment: 2, Amount: 100.5 },
        { Installment: 2, Amount: Number.POSITIVE_INFINITY },
        { Installment: 2, Amount: Number.NaN },
        { Installment: 2, Amount: 1e15 },
        { Installment: 2, Amount: '1000000000000000' },
        { Installment: 2, Amount: {} },
        { Installment: 2, Amount: null },
        { Installment: 2 },
        { Amount: 100 },
        { Installment: '02', Amount: 100 },
        null,
        'x',
        [],
        { Installment: 1, Amount: 0 },
        { Installment: 2, Amount: ' 100' },
        { Installment: 12, Amount: 120000 },
      ])
      const actual = m.mapInstallmentPricesResponse(input)
      expect(installmentPrices(actual)).toEqual([
        { installment: 1, installment_price: 0, total_price: 0 },
        { installment: 3, installment_price: 33.67, total_price: 101.01 },
        { installment: 12, installment_price: 100, total_price: 1200 },
      ])
      expect(warn).toHaveBeenCalled()
    })

    it('accepts a string amount and installment', () => {
      const actual = mapper.mapInstallmentPricesResponse(pricesAnswer([{ Installment: '2', Amount: '10101' }]))
      expect(installmentPrices(actual)).toEqual([{ installment: 2, installment_price: 50.51, total_price: 101.01 }])
    })

    it('sorts unsorted options and keeps duplicates in answer order', () => {
      const actual = mapper.mapInstallmentPricesResponse(
        pricesAnswer([
          { Installment: 6, Amount: 600 },
          { Installment: 2, Amount: 200 },
          { Installment: 2, Amount: 202 },
          { Installment: 1, Amount: 100 },
        ]),
      )
      expect(installmentPrices(actual)).toEqual([
        { installment: 1, installment_price: 1, total_price: 1 },
        { installment: 2, installment_price: 1, total_price: 2 },
        { installment: 2, installment_price: 1.01, total_price: 2.02 },
        { installment: 6, installment_price: 1, total_price: 6 },
      ])
    })

    // addition: a total that does not divide evenly is rounded up to the next kuruş
    it('rounds 10001 kuruş over 3 installments to 33.34', () => {
      const actual = mapper.mapInstallmentPricesResponse(pricesAnswer([{ Installment: 3, Amount: 10001 }]))
      expect(installmentPrices(actual)).toEqual([{ installment: 3, installment_price: 33.34, total_price: 100.01 }])
    })

    // addition: the largest kuruş value the mapper accepts, and one more
    it('accepts the maximum kuruş value and drops the next one', () => {
      const actual = mapper.mapInstallmentPricesResponse(
        pricesAnswer([
          { Installment: 1, Amount: 999_999_999_999_999 },
          { Installment: 2, Amount: 1_000_000_000_000_000 },
        ]),
      )
      expect(installmentPrices(actual)).toEqual([
        { installment: 1, installment_price: 9_999_999_999_999.99, total_price: 9_999_999_999_999.99 },
      ])
    })

    it('rounds the per-installment kuruş half up in integer arithmetic', () => {
      // 10005 / 2 = 5002.5 kuruş -> 5003 -> 50.03 (a float multiply by 100 would drift)
      const actual = mapper.mapInstallmentPricesResponse(pricesAnswer([{ Installment: 2, Amount: 10005 }]))
      expect(installmentPrices(actual)).toEqual([{ installment: 2, installment_price: 50.03, total_price: 100.05 }])
    })

    it.each([
      ['an object', {}],
      ['null', null],
      ['text', 'x'],
      ['an empty list', []],
      ['a list of unusable items', [1, 'a']],
    ])('InstallmentOptions as %s gives no prices but stays approved', (_n, options) => {
      const actual = mapper.mapInstallmentPricesResponse(pricesAnswer(options))
      expect(actual.status).toBe('approved')
      expect(actual.installment_prices).toEqual([])
    })

    it.each([
      ['a string', '0'],
      ['a missing code', undefined],
      ['true', true],
      ['1', 1],
    ])('Code %s is declined', (_n, code) => {
      const actual = mapper.mapInstallmentPricesResponse(
        pricesAnswer([{ Installment: 1, Amount: 100 }], { Code: code }),
      )
      expect(actual.status).toBe('declined')
      expect(actual.installment_prices).toEqual([])
    })

    it('a long declined Message is cut to 256 characters', () => {
      const actual = mapper.mapInstallmentPricesResponse({ Code: 5, Message: 'm'.repeat(300) })
      expect(actual.error_message).toBe('m'.repeat(256))
    })

    it('an approved answer carries no error message even with a Message', () => {
      const actual = mapper.mapInstallmentPricesResponse(pricesAnswer([], { Message: 'Başarılı' }))
      expect(actual.error_message).toBeNull()
    })
  })
})
