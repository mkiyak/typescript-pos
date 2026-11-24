import { beforeEach, describe, expect, it } from 'vitest'
import { PayFlexCPV4PosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/PayFlexCPV4PosRequestValueMapper.js'
import { NotImplementedError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { CURRENCY, LANG, type Lang, MODEL, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'

describe('PayFlexCPV4PosRequestValueMapper', () => {
  let valueMapper: PayFlexCPV4PosRequestValueMapper

  beforeEach(() => {
    valueMapper = new PayFlexCPV4PosRequestValueMapper()
  })

  it('supports only PayFlexCPV4Pos', () => {
    expect(PayFlexCPV4PosRequestValueMapper.supports('PayFlexCPV4Pos')).toBe(true)
    expect(PayFlexCPV4PosRequestValueMapper.supports('AssecoPos')).toBe(false)
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

  it('mapRecurringFrequency is not supported', () => {
    expect(() => valueMapper.mapRecurringFrequency('DAY')).toThrow(NotImplementedError)
  })

  it('mapLang', () => {
    expect(valueMapper.mapLang(LANG.TR)).toBe('tr-TR')
    expect(valueMapper.mapLang(LANG.EN)).toBe('en-US')
    expect(valueMapper.mapLang('ru' as Lang)).toBe('tr-TR')
  })

  it('mapCurrency returns the numeric code as a string', () => {
    expect(valueMapper.mapCurrency(CURRENCY.TRY)).toBe('949')
    expect(valueMapper.mapCurrency(CURRENCY.EUR)).toBe('978')
  })

  it('getLangMappings', () => {
    expect(Object.keys(valueMapper.getLangMappings())).toHaveLength(2)
  })

  it('getRecurringOrderFrequencyMappings', () => {
    expect(Object.keys(valueMapper.getRecurringOrderFrequencyMappings())).toHaveLength(0)
  })

  it('getCurrencyMappings', () => {
    expect(Object.keys(valueMapper.getCurrencyMappings())).toHaveLength(6)
  })

  it('getTxTypeMappings', () => {
    // deviation: the history query type arrives with PosQuery (v0.3)
    expect(Object.keys(valueMapper.getTxTypeMappings())).toHaveLength(7)
  })

  it('getSecureTypeMappings', () => {
    expect(Object.keys(valueMapper.getSecureTypeMappings())).toHaveLength(0)
  })

  it('getCardTypeMappings', () => {
    expect(Object.keys(valueMapper.getCardTypeMappings())).toHaveLength(4)
  })
})
