import { beforeEach, describe, expect, it } from 'vitest'
import { InterPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/InterPosRequestValueMapper.js'
import { NotImplementedError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { CARD_TYPE, CURRENCY, LANG, MODEL, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'

describe('InterPosRequestValueMapper', () => {
  let valueMapper: InterPosRequestValueMapper

  beforeEach(() => {
    valueMapper = new InterPosRequestValueMapper()
  })

  it('supports only InterPos', () => {
    expect(InterPosRequestValueMapper.supports('InterPos')).toBe(true)
    expect(InterPosRequestValueMapper.supports('AssecoPos')).toBe(false)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, 'Auth'],
    [TX_TYPE.PAY_PRE_AUTH, 'PreAuth'],
  ])('mapTxType(%s) = %s', (txType, expected) => {
    expect(valueMapper.mapTxType(txType)).toBe(expected)
  })

  it('mapTxType rejects an unknown transaction type', () => {
    expect(() => valueMapper.mapTxType('sales' as TxType)).toThrow(UnsupportedTransactionTypeError)
  })

  it.each([
    [MODEL.THREE_D_SECURE, '3DModel'],
    [MODEL.THREE_D_PAY, '3DPay'],
    [MODEL.NON_SECURE, 'NonSecure'],
  ])('mapSecureType(%s) = %s', (model, expected) => {
    expect(valueMapper.mapSecureType(model)).toBe(expected)
  })

  it('mapRecurringFrequency is not implemented', () => {
    // deviation: F30 (error class)
    expect(() => valueMapper.mapRecurringFrequency('DAY')).toThrow(NotImplementedError)
  })

  it('mapLang falls back to Turkish', () => {
    expect(valueMapper.mapLang(LANG.TR)).toBe('tr')
    expect(valueMapper.mapLang(LANG.EN)).toBe('en')
    expect(valueMapper.mapLang('ru' as never)).toBe('tr')
  })

  it('mapCurrency returns the numeric code as text', () => {
    expect(valueMapper.mapCurrency(CURRENCY.TRY)).toBe('949')
    expect(valueMapper.mapCurrency(CURRENCY.EUR)).toBe('978')
  })

  it.each([
    [CARD_TYPE.VISA, '0'],
    [CARD_TYPE.MASTERCARD, '1'],
  ])('mapCardType(%s) = %s', (cardType, expected) => {
    expect(valueMapper.mapCardType(cardType)).toBe(expected)
  })

  it('exposes its tables', () => {
    expect(Object.keys(valueMapper.getLangMappings())).toHaveLength(2)
    expect(Object.keys(valueMapper.getRecurringOrderFrequencyMappings())).toHaveLength(0)
    expect(Object.keys(valueMapper.getCurrencyMappings())).toHaveLength(6)
    expect(Object.keys(valueMapper.getTxTypeMappings())).toHaveLength(7)
    expect(Object.keys(valueMapper.getSecureTypeMappings())).toHaveLength(4)
    expect(Object.keys(valueMapper.getCardTypeMappings())).toHaveLength(4)
  })

  // addition: the rest of the tables
  it.each([
    [TX_TYPE.PAY_POST_AUTH, 'PostAuth'],
    [TX_TYPE.CANCEL, 'Void'],
    [TX_TYPE.REFUND, 'Refund'],
    [TX_TYPE.REFUND_PARTIAL, 'Refund'],
    [TX_TYPE.STATUS, 'StatusHistory'],
  ])('mapTxType(%s) = %s', (txType, expected) => {
    expect(valueMapper.mapTxType(txType)).toBe(expected)
  })

  it('maps the hosted model and the remaining card types', () => {
    expect(valueMapper.mapSecureType(MODEL.THREE_D_HOST)).toBe('3DHost')
    expect(valueMapper.mapCardType(CARD_TYPE.AMEX)).toBe('2')
    expect(valueMapper.mapCardType(CARD_TYPE.TROY)).toBe('3')
  })
})
