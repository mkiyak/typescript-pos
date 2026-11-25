import { beforeEach, describe, expect, it } from 'vitest'
import { IyzicoPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/IyzicoPosRequestValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import { CURRENCY, LANG, MODEL } from '../../../../../src/PosInterface.js'

describe('IyzicoPosRequestValueMapper', () => {
  let valueMapper: IyzicoPosRequestValueMapper

  beforeEach(() => {
    valueMapper = new IyzicoPosRequestValueMapper()
  })

  it('supports only IyzicoPos', () => {
    expect(IyzicoPosRequestValueMapper.supports('IyzicoPos')).toBe(true)
    expect(IyzicoPosRequestValueMapper.supports('AkbankPos')).toBe(false)
  })

  it.each([
    [CURRENCY.TRY, 'TRY'],
    [CURRENCY.USD, 'USD'],
    [CURRENCY.EUR, 'EUR'],
    [CURRENCY.GBP, 'GBP'],
    [CURRENCY.JPY, 'JPY'],
    [CURRENCY.RUB, 'RUB'],
  ])('mapCurrency(%s) = %s', (currency, expected) => {
    expect(valueMapper.mapCurrency(currency)).toBe(expected)
  })

  it('maps languages and falls back to Turkish', () => {
    expect(valueMapper.mapLang(LANG.TR)).toBe('tr')
    expect(valueMapper.mapLang(LANG.EN)).toBe('en')
    // deviation: the language type is closed in TypeScript, the unknown language is passed through a cast
    expect(valueMapper.mapLang('ru' as never)).toBe('tr')
  })

  it('has no transaction type table', () => {
    expect(valueMapper.getTxTypeMappings()).toEqual({})
  })

  it('has six currencies', () => {
    expect(Object.keys(valueMapper.getCurrencyMappings())).toHaveLength(6)
  })

  it('has two languages', () => {
    expect(Object.keys(valueMapper.getLangMappings())).toHaveLength(2)
  })

  it('has no secure type table', () => {
    expect(valueMapper.getSecureTypeMappings()).toEqual({})
  })

  it('mapSecureType is not implemented', () => {
    // deviation: C7 the reference throws a LogicException, the port a NotImplementedError
    expect(() => valueMapper.mapSecureType(MODEL.THREE_D_SECURE)).toThrow(NotImplementedError)
  })

  it('has no recurring frequency table', () => {
    expect(valueMapper.getRecurringOrderFrequencyMappings()).toEqual({})
  })

  it('mapRecurringFrequency is not implemented', () => {
    // deviation: C7 the reference throws a LogicException, the port a NotImplementedError
    expect(() => valueMapper.mapRecurringFrequency('MONTH')).toThrow(NotImplementedError)
  })

  it('has no card type table', () => {
    expect(valueMapper.getCardTypeMappings()).toEqual({})
  })

  it('mapCardType is not implemented', () => {
    // deviation: C7 the reference throws a LogicException, the port a NotImplementedError
    expect(() => valueMapper.mapCardType('VISA')).toThrow(NotImplementedError)
  })
})
