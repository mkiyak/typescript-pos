import { beforeEach, describe, expect, it } from 'vitest'
import { GarantiPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/GarantiPosRequestValueMapper.js'
import { NotImplementedError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { CARD_CLASS, CURRENCY, LANG, MODEL, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../../../src/pos-query/PosQueryInterface.js'

describe('GarantiPosRequestValueMapper', () => {
  let valueMapper: GarantiPosRequestValueMapper

  beforeEach(() => {
    valueMapper = new GarantiPosRequestValueMapper()
  })

  it('supports only GarantiPos', () => {
    expect(GarantiPosRequestValueMapper.supports('GarantiPos')).toBe(true)
    expect(GarantiPosRequestValueMapper.supports('AssecoPos')).toBe(false)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, 'sales'],
    [TX_TYPE.PAY_PRE_AUTH, 'preauth'],
    [QUERY_TYPE.HISTORY, 'orderlistinq'],
    [QUERY_TYPE.BIN_LIST, 'bininq'],
  ])('mapTxType(%s) = %s', (txType, expected) => {
    expect(valueMapper.mapTxType(txType)).toBe(expected)
  })

  it('mapTxType rejects an unsupported transaction type', () => {
    expect(() => valueMapper.mapTxType('sales' as TxType)).toThrow(UnsupportedTransactionTypeError)
  })

  it.each([
    [MODEL.THREE_D_SECURE, '3D'],
    [MODEL.THREE_D_PAY, '3D_PAY'],
  ])('mapSecureType(%s) = %s', (model, expected) => {
    expect(valueMapper.mapSecureType(model)).toBe(expected)
  })

  it.each([
    ['DAY', 'D'],
    ['WEEK', 'W'],
    ['MONTH', 'M'],
  ])('mapRecurringFrequency(%s) = %s', (frequency, expected) => {
    expect(valueMapper.mapRecurringFrequency(frequency)).toBe(expected)
  })

  it('mapLang is not supported', () => {
    // deviation: G16 (error class: NotImplementedError)
    expect(() => valueMapper.mapLang(LANG.TR)).toThrow(NotImplementedError)
  })

  it('mapCurrency', () => {
    expect(valueMapper.mapCurrency(CURRENCY.TRY)).toBe('949')
    expect(valueMapper.mapCurrency(CURRENCY.EUR)).toBe('978')
  })

  it('exposes the mapping tables', () => {
    expect(Object.keys(valueMapper.getLangMappings())).toHaveLength(0)
    expect(Object.keys(valueMapper.getRecurringOrderFrequencyMappings())).toHaveLength(3)
    expect(Object.keys(valueMapper.getCurrencyMappings())).toHaveLength(6)
    expect(Object.keys(valueMapper.getTxTypeMappings())).toHaveLength(10)
    expect(Object.keys(valueMapper.getSecureTypeMappings())).toHaveLength(2)
    expect(Object.keys(valueMapper.getCardTypeMappings())).toHaveLength(0)
  })

  it.each([
    [null, 'A'],
    [CARD_CLASS.CREDIT, 'C'],
    [CARD_CLASS.DEBIT, 'D'],
    [CARD_CLASS.PREPAID, 'A'],
  ])('mapCardClass(%s) = %s', (cardClass, expected) => {
    expect(valueMapper.mapCardClass(cardClass)).toBe(expected)
  })
})
