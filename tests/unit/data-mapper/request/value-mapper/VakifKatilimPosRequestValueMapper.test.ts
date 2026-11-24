import { beforeEach, describe, expect, it } from 'vitest'
import { VakifKatilimPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/VakifKatilimPosRequestValueMapper.js'
import { NotImplementedError, PosError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { CURRENCY, LANG, MODEL, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'

describe('VakifKatilimPosRequestValueMapper', () => {
  let valueMapper: VakifKatilimPosRequestValueMapper

  beforeEach(() => {
    valueMapper = new VakifKatilimPosRequestValueMapper()
  })

  it('supports only VakifKatilimPos', () => {
    expect(VakifKatilimPosRequestValueMapper.supports('VakifKatilimPos')).toBe(true)
    expect(VakifKatilimPosRequestValueMapper.supports('AssecoPos')).toBe(false)
    expect(VakifKatilimPosRequestValueMapper.supports('KuveytPos')).toBe(false)
  })

  it('mapTxType rejects every type (the bank has no tx type field)', () => {
    expect(() => valueMapper.mapTxType(TX_TYPE.PAY_AUTH)).toThrow(UnsupportedTransactionTypeError)
    expect(() => valueMapper.mapTxType('pay' as TxType)).toThrow(UnsupportedTransactionTypeError)
  })

  it.each([
    [MODEL.THREE_D_SECURE, '3'],
    [MODEL.NON_SECURE, '5'],
  ])('mapSecureType(%s) = %s', (model, expected) => {
    expect(valueMapper.mapSecureType(model)).toBe(expected)
  })

  it('mapSecureType rejects a model without a code', () => {
    expect(() => valueMapper.mapSecureType(MODEL.THREE_D_PAY)).toThrow(PosError)
  })

  it('mapRecurringFrequency is not implemented', () => {
    // deviation: B14 (error class)
    expect(() => valueMapper.mapRecurringFrequency('DAY')).toThrow(NotImplementedError)
  })

  it('mapLang is not implemented', () => {
    // deviation: B14 (error class)
    expect(() => valueMapper.mapLang(LANG.TR)).toThrow(NotImplementedError)
  })

  it('mapCurrency', () => {
    expect(valueMapper.mapCurrency(CURRENCY.TRY)).toBe('0949')
    expect(valueMapper.mapCurrency(CURRENCY.EUR)).toBe('0978')
  })

  // addition: every currency is four-digit text
  it.each([
    [CURRENCY.USD, '0840'],
    [CURRENCY.GBP, '0826'],
    [CURRENCY.JPY, '0392'],
    [CURRENCY.RUB, '0810'],
  ])('mapCurrency(%s) = %s', (currency, expected) => {
    expect(valueMapper.mapCurrency(currency)).toBe(expected)
  })

  it('table sizes', () => {
    expect(Object.keys(valueMapper.getLangMappings())).toHaveLength(0)
    expect(Object.keys(valueMapper.getRecurringOrderFrequencyMappings())).toHaveLength(0)
    expect(Object.keys(valueMapper.getCurrencyMappings())).toHaveLength(6)
    expect(Object.keys(valueMapper.getTxTypeMappings())).toHaveLength(0)
    expect(Object.keys(valueMapper.getSecureTypeMappings())).toHaveLength(2)
    expect(Object.keys(valueMapper.getCardTypeMappings())).toHaveLength(0)
  })

  it('mapCardType is not implemented', () => {
    // deviation: B14 (error class)
    expect(() => valueMapper.mapCardType('visa')).toThrow(NotImplementedError)
  })
})
