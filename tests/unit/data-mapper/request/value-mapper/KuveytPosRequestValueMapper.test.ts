import { beforeEach, describe, expect, it } from 'vitest'
import { KuveytPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/KuveytPosRequestValueMapper.js'
import { NotImplementedError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { CARD_TYPE, CURRENCY, LANG, MODEL, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'

describe('KuveytPosRequestValueMapper', () => {
  let valueMapper: KuveytPosRequestValueMapper

  beforeEach(() => {
    valueMapper = new KuveytPosRequestValueMapper()
  })

  it('supports only KuveytPos', () => {
    expect(KuveytPosRequestValueMapper.supports('KuveytPos')).toBe(true)
    expect(KuveytPosRequestValueMapper.supports('AssecoPos')).toBe(false)
  })

  it('mapTxType(pay) = Sale', () => {
    expect(valueMapper.mapTxType(TX_TYPE.PAY_AUTH)).toBe('Sale')
  })

  it('mapTxType rejects a bank code as a transaction type', () => {
    expect(() => valueMapper.mapTxType('Auth' as TxType)).toThrow(UnsupportedTransactionTypeError)
  })

  it.each([
    [MODEL.THREE_D_SECURE, '3'],
    [MODEL.NON_SECURE, '0'],
  ])('mapSecureType(%s) = %s', (model, expected) => {
    expect(valueMapper.mapSecureType(model)).toBe(expected)
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

  it('table sizes', () => {
    expect(Object.keys(valueMapper.getLangMappings())).toHaveLength(0)
    expect(Object.keys(valueMapper.getRecurringOrderFrequencyMappings())).toHaveLength(0)
    expect(Object.keys(valueMapper.getCurrencyMappings())).toHaveLength(3)
    expect(Object.keys(valueMapper.getTxTypeMappings())).toHaveLength(5)
    expect(Object.keys(valueMapper.getSecureTypeMappings())).toHaveLength(2)
    expect(Object.keys(valueMapper.getCardTypeMappings())).toHaveLength(3)
  })

  it.each([
    [CARD_TYPE.VISA, 'Visa'],
    [CARD_TYPE.MASTERCARD, 'MasterCard'],
    [CARD_TYPE.TROY, 'Troy'],
  ])('mapCardType(%s) = %s', (cardType, expected) => {
    expect(valueMapper.mapCardType(cardType)).toBe(expected)
  })
})
