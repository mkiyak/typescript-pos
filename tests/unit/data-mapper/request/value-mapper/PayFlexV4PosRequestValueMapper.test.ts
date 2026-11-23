import { beforeEach, describe, expect, it } from 'vitest'
import { PayFlexV4PosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/PayFlexV4PosRequestValueMapper.js'
import { NotImplementedError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { CURRENCY, LANG, MODEL, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'

describe('PayFlexV4PosRequestValueMapper', () => {
  let valueMapper: PayFlexV4PosRequestValueMapper

  beforeEach(() => {
    valueMapper = new PayFlexV4PosRequestValueMapper()
  })

  it('supports only PayFlexV4Pos', () => {
    expect(PayFlexV4PosRequestValueMapper.supports('PayFlexV4Pos')).toBe(true)
    expect(PayFlexV4PosRequestValueMapper.supports('AssecoPos')).toBe(false)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, 'Sale'],
    [TX_TYPE.PAY_PRE_AUTH, 'Auth'],
    [TX_TYPE.PAY_POST_AUTH, 'Capture'],
  ])('mapTxType(%s) = %s', (txType, expected) => {
    expect(valueMapper.mapTxType(txType)).toBe(expected)
  })

  it('mapTxType rejects an unsupported transaction type', () => {
    expect(() => valueMapper.mapTxType('Auth' as TxType)).toThrow(UnsupportedTransactionTypeError)
  })

  it('mapSecureType is not supported', () => {
    expect(() => valueMapper.mapSecureType(MODEL.THREE_D_SECURE)).toThrow(NotImplementedError)
  })

  it.each([
    ['DAY', 'Day'],
    ['MONTH', 'Month'],
    ['YEAR', 'Year'],
  ])('mapRecurringFrequency(%s) = %s', (frequency, expected) => {
    expect(valueMapper.mapRecurringFrequency(frequency)).toBe(expected)
  })

  it('mapLang is not supported', () => {
    expect(() => valueMapper.mapLang(LANG.TR)).toThrow(NotImplementedError)
  })

  it('mapCurrency returns the numeric code as a string', () => {
    expect(valueMapper.mapCurrency(CURRENCY.TRY)).toBe('949')
    expect(valueMapper.mapCurrency(CURRENCY.EUR)).toBe('978')
  })

  it('exposes the mapping tables', () => {
    expect(Object.keys(valueMapper.getLangMappings())).toHaveLength(0)
    expect(Object.keys(valueMapper.getRecurringOrderFrequencyMappings())).toHaveLength(3)
    expect(Object.keys(valueMapper.getCurrencyMappings())).toHaveLength(6)
    expect(Object.keys(valueMapper.getTxTypeMappings())).toHaveLength(7)
    expect(Object.keys(valueMapper.getSecureTypeMappings())).toHaveLength(0)
    expect(Object.keys(valueMapper.getCardTypeMappings())).toHaveLength(4)
  })
})
