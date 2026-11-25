import { beforeEach, describe, expect, it } from 'vitest'
import { PayTrPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/PayTrPosRequestValueMapper.js'
import { NotImplementedError, PosError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { CURRENCY, LANG, MODEL, TX_TYPE } from '../../../../../src/PosInterface.js'

describe('PayTrPosRequestValueMapper', () => {
  let mapper: PayTrPosRequestValueMapper

  beforeEach(() => {
    mapper = new PayTrPosRequestValueMapper()
  })

  it('supports only PayTrPos', () => {
    expect(PayTrPosRequestValueMapper.supports('PayTrPos')).toBe(true)
    expect(PayTrPosRequestValueMapper.supports('AkbankPos')).toBe(false)
  })

  it.each([
    [CURRENCY.TRY, 'TL'],
    [CURRENCY.USD, 'USD'],
    [CURRENCY.EUR, 'EUR'],
    [CURRENCY.GBP, 'GBP'],
    [CURRENCY.RUB, 'RUB'],
  ])('mapCurrency(%s) = %s', (currency, expected) => {
    expect(mapper.mapCurrency(currency)).toBe(expected)
  })

  it('has five currencies', () => {
    expect(Object.keys(mapper.getCurrencyMappings())).toHaveLength(5)
  })

  // addition: a currency without a mapping is refused, never sent as "undefined"
  it('refuses a currency without a mapping', () => {
    expect(() => mapper.mapCurrency(CURRENCY.JPY)).toThrow(PosError)
    expect(() => mapper.mapCurrency('constructor' as never)).toThrow(PosError)
  })

  it.each([
    ['tr', LANG.TR],
    ['en', LANG.EN],
    ['tr', 'ru'],
  ])('mapLang gives %s for %s', (mapped, lang) => {
    expect(mapper.mapLang(lang as never)).toBe(mapped)
  })

  it('has two languages', () => {
    expect(Object.keys(mapper.getLangMappings())).toHaveLength(2)
  })

  it('has no transaction type mapping', () => {
    expect(mapper.getTxTypeMappings()).toEqual({})
  })

  it('refuses to map a transaction type', () => {
    expect(() => mapper.mapTxType(TX_TYPE.PAY_AUTH)).toThrow(UnsupportedTransactionTypeError)
  })

  it('has no secure type mapping', () => {
    expect(mapper.getSecureTypeMappings()).toEqual({})
  })

  // deviation: C6 (the unsupported mappings are NotImplementedError)
  it('refuses to map a secure type', () => {
    expect(() => mapper.mapSecureType(MODEL.THREE_D_SECURE)).toThrow(NotImplementedError)
  })

  it('has no recurring frequency mapping', () => {
    expect(mapper.getRecurringOrderFrequencyMappings()).toEqual({})
  })

  // deviation: C6
  it('refuses to map a recurring frequency', () => {
    expect(() => mapper.mapRecurringFrequency('MONTH')).toThrow(NotImplementedError)
  })

  it('has no card type mapping', () => {
    expect(mapper.getCardTypeMappings()).toEqual({})
  })

  // deviation: C6
  it('refuses to map a card type', () => {
    expect(() => mapper.mapCardType('VISA')).toThrow(NotImplementedError)
  })
})
