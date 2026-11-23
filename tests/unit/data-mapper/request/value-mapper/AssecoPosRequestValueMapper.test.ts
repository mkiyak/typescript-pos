import { beforeEach, describe, expect, it } from 'vitest'
import { AssecoPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/AssecoPosRequestValueMapper.js'
import { UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { CURRENCY, LANG, MODEL, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'

describe('AssecoPosRequestValueMapper', () => {
  let valueMapper: AssecoPosRequestValueMapper

  beforeEach(() => {
    valueMapper = new AssecoPosRequestValueMapper()
  })

  it('supports only AssecoPos', () => {
    expect(AssecoPosRequestValueMapper.supports('AssecoPos')).toBe(true)
    expect(AssecoPosRequestValueMapper.supports('AkbankPos')).toBe(false)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, 'Auth'],
    [TX_TYPE.PAY_PRE_AUTH, 'PreAuth'],
    [TX_TYPE.PAY_POST_AUTH, 'PostAuth'],
  ])('mapTxType(%s) = %s', (txType, expected) => {
    expect(valueMapper.mapTxType(txType)).toBe(expected)
  })

  it('mapTxType rejects an unsupported transaction type', () => {
    expect(() => valueMapper.mapTxType('Auth' as TxType)).toThrow(UnsupportedTransactionTypeError)
  })

  it.each([
    [MODEL.THREE_D_SECURE, '3d'],
    [MODEL.THREE_D_PAY, '3d_pay'],
    [MODEL.THREE_D_HOST, '3d_host'],
    [MODEL.NON_SECURE, 'regular'],
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

  it('mapLang', () => {
    expect(valueMapper.mapLang(LANG.TR)).toBe('tr')
    expect(valueMapper.mapLang(LANG.EN)).toBe('en')
    expect(valueMapper.mapLang('ru' as never)).toBe('tr')
  })

  it('mapCurrency returns the numeric code as a string', () => {
    expect(valueMapper.mapCurrency(CURRENCY.TRY)).toBe('949')
    expect(valueMapper.mapCurrency(CURRENCY.EUR)).toBe('978')
  })

  it('exposes the mapping tables', () => {
    expect(Object.keys(valueMapper.getLangMappings())).toHaveLength(2)
    expect(Object.keys(valueMapper.getRecurringOrderFrequencyMappings())).toHaveLength(4)
    expect(Object.keys(valueMapper.getCurrencyMappings())).toHaveLength(6)
    expect(Object.keys(valueMapper.getTxTypeMappings())).toHaveLength(8)
    expect(Object.keys(valueMapper.getSecureTypeMappings())).toHaveLength(5)
    expect(Object.keys(valueMapper.getCardTypeMappings())).toHaveLength(0)
  })
})
