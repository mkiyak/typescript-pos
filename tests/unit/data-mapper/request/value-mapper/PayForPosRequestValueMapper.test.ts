import { beforeEach, describe, expect, it } from 'vitest'
import { PayForPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/PayForPosRequestValueMapper.js'
import { NotImplementedError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { CURRENCY, LANG, MODEL, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'

describe('PayForPosRequestValueMapper', () => {
  let valueMapper: PayForPosRequestValueMapper

  beforeEach(() => {
    valueMapper = new PayForPosRequestValueMapper()
  })

  it('supports only PayForPos', () => {
    expect(PayForPosRequestValueMapper.supports('PayForPos')).toBe(true)
    expect(PayForPosRequestValueMapper.supports('AssecoPos')).toBe(false)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, 'Auth'],
    [TX_TYPE.PAY_PRE_AUTH, 'PreAuth'],
    [TX_TYPE.PAY_POST_AUTH, 'PostAuth'],
  ])('mapTxType(%s) = %s', (txType, expected) => {
    expect(valueMapper.mapTxType(txType)).toBe(expected)
  })

  it('mapTxType rejects a bank code as a transaction type', () => {
    expect(() => valueMapper.mapTxType('Auth' as TxType)).toThrow(UnsupportedTransactionTypeError)
  })

  it.each([
    [MODEL.THREE_D_SECURE, '3DModel'],
    [MODEL.THREE_D_PAY, '3DPay'],
    [MODEL.THREE_D_HOST, '3DHost'],
    [MODEL.NON_SECURE, 'NonSecure'],
  ])('mapSecureType(%s) = %s', (model, expected) => {
    expect(valueMapper.mapSecureType(model)).toBe(expected)
  })

  it('mapRecurringFrequency is not implemented', () => {
    // deviation: F28 (error class)
    expect(() => valueMapper.mapRecurringFrequency('DAY')).toThrow(NotImplementedError)
  })

  it('mapLang falls back to Turkish', () => {
    expect(valueMapper.mapLang(LANG.TR)).toBe('TR')
    expect(valueMapper.mapLang(LANG.EN)).toBe('EN')
    expect(valueMapper.mapLang('ru' as never)).toBe('TR')
  })

  it('mapCurrency', () => {
    expect(valueMapper.mapCurrency(CURRENCY.TRY)).toBe('949')
    expect(valueMapper.mapCurrency(CURRENCY.EUR)).toBe('978')
  })

  it('exposes its tables', () => {
    expect(Object.keys(valueMapper.getLangMappings())).toHaveLength(2)
    expect(Object.keys(valueMapper.getRecurringOrderFrequencyMappings())).toHaveLength(0)
    expect(Object.keys(valueMapper.getCurrencyMappings())).toHaveLength(6)
    expect(Object.keys(valueMapper.getTxTypeMappings())).toHaveLength(8)
    expect(Object.keys(valueMapper.getSecureTypeMappings())).toHaveLength(4)
    expect(Object.keys(valueMapper.getCardTypeMappings())).toHaveLength(0)
  })

  // addition: the rest of the transaction table
  it.each([
    [TX_TYPE.CANCEL, 'Void'],
    [TX_TYPE.REFUND, 'Refund'],
    [TX_TYPE.REFUND_PARTIAL, 'Refund'],
    [TX_TYPE.STATUS, 'OrderInquiry'],
    ['history', 'TxnHistory'],
  ])('mapTxType(%s) = %s', (txType, expected) => {
    expect(valueMapper.mapTxType(txType as TxType)).toBe(expected)
  })
})
