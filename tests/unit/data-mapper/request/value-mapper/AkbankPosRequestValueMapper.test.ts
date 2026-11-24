import { beforeEach, describe, expect, it } from 'vitest'
import { AkbankPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/AkbankPosRequestValueMapper.js'
import { NotImplementedError, PosError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { CURRENCY, LANG, MODEL, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'

describe('AkbankPosRequestValueMapper', () => {
  let valueMapper: AkbankPosRequestValueMapper

  beforeEach(() => {
    valueMapper = new AkbankPosRequestValueMapper()
  })

  it('supports only AkbankPos', () => {
    expect(AkbankPosRequestValueMapper.supports('AkbankPos')).toBe(true)
    expect(AkbankPosRequestValueMapper.supports('AssecoPos')).toBe(false)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, '3000'],
    [TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_SECURE, '3004'],
    [TX_TYPE.PAY_PRE_AUTH, MODEL.NON_SECURE, '1004'],
  ])('mapTxType(%s, %s) = %s', (txType, model, expected) => {
    expect(valueMapper.mapTxType(txType, model)).toBe(expected)
  })

  it('mapTxType rejects a bank code as a transaction type', () => {
    expect(() => valueMapper.mapTxType('3000' as TxType, null)).toThrow(UnsupportedTransactionTypeError)
  })

  it('mapTxType needs the payment model for a model-keyed type', () => {
    // deviation: A22 (error class: PosError)
    expect(() => valueMapper.mapTxType(TX_TYPE.PAY_AUTH, null)).toThrow(PosError)
  })

  it.each([
    [MODEL.THREE_D_SECURE, '3D'],
    [MODEL.THREE_D_PAY, '3D_PAY'],
    [MODEL.THREE_D_HOST, '3D_PAY_HOSTING'],
    [MODEL.NON_SECURE, 'PAY_HOSTING'],
  ])('mapSecureType(%s) = %s', (model, expected) => {
    expect(valueMapper.mapSecureType(model)).toBe(expected)
  })

  it.each([
    ['DAY', 'D'],
    ['WEEK', 'W'],
    ['MONTH', 'M'],
    ['YEAR', 'Y'],
  ])('mapRecurringFrequency(%s) = %s', (frequency, expected) => {
    expect(valueMapper.mapRecurringFrequency(frequency)).toBe(expected)
  })

  it('mapLang falls back to TR', () => {
    expect(valueMapper.mapLang(LANG.TR)).toBe('TR')
    expect(valueMapper.mapLang(LANG.EN)).toBe('EN')
    expect(valueMapper.mapLang('ru' as never)).toBe('TR')
  })

  it('mapCurrency returns numeric codes', () => {
    expect(valueMapper.mapCurrency(CURRENCY.TRY)).toBe(949)
    expect(valueMapper.mapCurrency(CURRENCY.EUR)).toBe(978)
  })

  it('exposes the mapping tables', () => {
    expect(Object.keys(valueMapper.getLangMappings())).toHaveLength(2)
    expect(Object.keys(valueMapper.getRecurringOrderFrequencyMappings())).toHaveLength(4)
    expect(Object.keys(valueMapper.getCurrencyMappings())).toHaveLength(6)
    expect(Object.keys(valueMapper.getTxTypeMappings())).toHaveLength(8)
    expect(Object.keys(valueMapper.getSecureTypeMappings())).toHaveLength(4)
    expect(Object.keys(valueMapper.getCardTypeMappings())).toHaveLength(0)
  })

  it('mapCardClass is not supported', () => {
    // deviation: A22 (error class: NotImplementedError)
    expect(() => valueMapper.mapCardClass(null)).toThrow(NotImplementedError)
  })
})
