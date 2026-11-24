import { beforeEach, describe, expect, it } from 'vitest'
import { PosNetV1PosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/PosNetV1PosRequestValueMapper.js'
import { NotImplementedError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { CURRENCY, LANG, MODEL, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'

describe('PosNetV1PosRequestValueMapper', () => {
  let valueMapper: PosNetV1PosRequestValueMapper

  beforeEach(() => {
    valueMapper = new PosNetV1PosRequestValueMapper()
  })

  it('supports only PosNetV1Pos', () => {
    expect(PosNetV1PosRequestValueMapper.supports('PosNetV1Pos')).toBe(true)
    expect(PosNetV1PosRequestValueMapper.supports('AssecoPos')).toBe(false)
    expect(PosNetV1PosRequestValueMapper.supports('PosNetPos')).toBe(false)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, 'Sale'],
    [TX_TYPE.PAY_PRE_AUTH, 'Auth'],
    [TX_TYPE.PAY_POST_AUTH, 'Capture'],
  ])('mapTxType(%s) = %s', (txType, expected) => {
    expect(valueMapper.mapTxType(txType)).toBe(expected)
  })

  it('mapTxType rejects a bank code as a transaction type', () => {
    expect(() => valueMapper.mapTxType('Sale' as TxType)).toThrow(UnsupportedTransactionTypeError)
  })

  it('mapSecureType is not implemented', () => {
    // deviation: P28 (error class)
    expect(() => valueMapper.mapSecureType(MODEL.THREE_D_SECURE)).toThrow(NotImplementedError)
  })

  it('mapRecurringFrequency is not implemented', () => {
    // deviation: P28 (error class)
    expect(() => valueMapper.mapRecurringFrequency('DAY')).toThrow(NotImplementedError)
  })

  it('mapLang falls back to Turkish', () => {
    expect(valueMapper.mapLang(LANG.TR)).toBe('tr')
    expect(valueMapper.mapLang(LANG.EN)).toBe('en')
    expect(valueMapper.mapLang('ru' as never)).toBe('tr')
  })

  it('mapCurrency', () => {
    expect(valueMapper.mapCurrency(CURRENCY.TRY)).toBe('TL')
    expect(valueMapper.mapCurrency(CURRENCY.EUR)).toBe('EU')
  })

  it('exposes its tables', () => {
    expect(Object.keys(valueMapper.getLangMappings())).toHaveLength(2)
    expect(Object.keys(valueMapper.getRecurringOrderFrequencyMappings())).toHaveLength(0)
    expect(Object.keys(valueMapper.getCurrencyMappings())).toHaveLength(6)
    expect(Object.keys(valueMapper.getTxTypeMappings())).toHaveLength(7)
    expect(Object.keys(valueMapper.getSecureTypeMappings())).toHaveLength(0)
    expect(Object.keys(valueMapper.getCardTypeMappings())).toHaveLength(0)
  })

  // addition: the remaining wire names
  it.each([
    [TX_TYPE.CANCEL, 'Reverse'],
    [TX_TYPE.REFUND, 'Return'],
    [TX_TYPE.REFUND_PARTIAL, 'Return'],
    [TX_TYPE.STATUS, 'TransactionInquiry'],
  ])('mapTxType(%s) = %s', (txType, expected) => {
    expect(valueMapper.mapTxType(txType)).toBe(expected)
  })

  it.each([
    [CURRENCY.USD, 'US'],
    [CURRENCY.GBP, 'GB'],
    [CURRENCY.JPY, 'JP'],
    [CURRENCY.RUB, 'RU'],
  ])('mapCurrency(%s) = %s', (currency, expected) => {
    expect(valueMapper.mapCurrency(currency)).toBe(expected)
  })
})
