import { beforeEach, describe, expect, it } from 'vitest'
import { ParamPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/ParamPosRequestValueMapper.js'
import { NotImplementedError, PosError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { CURRENCY, LANG, MODEL, TX_TYPE } from '../../../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../../../src/pos-query/PosQueryInterface.js'

describe('ParamPosRequestValueMapper', () => {
  let mapper: ParamPosRequestValueMapper

  beforeEach(() => {
    mapper = new ParamPosRequestValueMapper()
  })

  it('supports ParamPos and Param3DHostPos', () => {
    expect(ParamPosRequestValueMapper.supports('ParamPos')).toBe(true)
    expect(ParamPosRequestValueMapper.supports('Param3DHostPos')).toBe(true)
    expect(ParamPosRequestValueMapper.supports('AssecoPos')).toBe(false)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { currency: CURRENCY.USD }, 'TP_Islem_Odeme_WD'],
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { currency: CURRENCY.USD }, 'TP_Islem_Odeme_WD'],
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { currency: CURRENCY.TRY }, 'TP_WMD_UCD'],
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, null, 'TP_WMD_UCD'],
    [TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, null, 'TP_WMD_UCD'],
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY, null, 'Pos_Odeme'],
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_HOST, null, 'TO_Pre_Encrypting_OOS'],
    [TX_TYPE.PAY_PRE_AUTH, MODEL.NON_SECURE, null, 'TP_Islem_Odeme_OnProv_WMD'],
    [TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_SECURE, null, 'TP_Islem_Odeme_OnProv_WMD'],
    [TX_TYPE.PAY_POST_AUTH, MODEL.NON_SECURE, null, 'TP_Islem_Odeme_OnProv_Kapa'],
    [TX_TYPE.REFUND, MODEL.NON_SECURE, null, 'TP_Islem_Iptal_Iade_Kismi2'],
    [TX_TYPE.REFUND_PARTIAL, MODEL.NON_SECURE, null, 'TP_Islem_Iptal_Iade_Kismi2'],
    [TX_TYPE.CANCEL, MODEL.NON_SECURE, null, 'TP_Islem_Iptal_Iade_Kismi2'],
    [TX_TYPE.CANCEL, MODEL.THREE_D_SECURE, { transaction_type: TX_TYPE.PAY_PRE_AUTH }, 'TP_Islem_Iptal_OnProv'],
    [TX_TYPE.STATUS, MODEL.NON_SECURE, null, 'TP_Islem_Sorgulama4'],
    [QUERY_TYPE.HISTORY, MODEL.NON_SECURE, null, 'TP_Islem_Izleme'],
    [QUERY_TYPE.BIN_LIST, MODEL.NON_SECURE, null, 'BIN_SanalPos'],
  ])('mapTxType(%s, %s, %j) = %s', (txType, model, order, expected) => {
    expect(mapper.mapTxType(txType, model, order)).toBe(expected)
  })

  it('answers an unknown tx type with UnsupportedTransactionTypeError', () => {
    expect(() => mapper.mapTxType('3000' as never, null)).toThrow(UnsupportedTransactionTypeError)
  })

  // deviation: C8 (a missing payment model is a PosError)
  it('needs a payment model for a pay request', () => {
    expect(() => mapper.mapTxType(TX_TYPE.PAY_AUTH, null)).toThrow(PosError)
  })

  // addition: only a sale is redirected to the foreign currency operation; the cancel, refund, status and
  // post-auth of a foreign currency order keep their usual operation
  it.each([
    [TX_TYPE.CANCEL, 'TP_Islem_Iptal_Iade_Kismi2'],
    [TX_TYPE.REFUND, 'TP_Islem_Iptal_Iade_Kismi2'],
    [TX_TYPE.STATUS, 'TP_Islem_Sorgulama4'],
    [TX_TYPE.PAY_POST_AUTH, 'TP_Islem_Odeme_OnProv_Kapa'],
  ])('does not send %s of a USD order to the foreign sale operation', (txType, expected) => {
    expect(mapper.mapTxType(txType, MODEL.NON_SECURE, { currency: CURRENCY.USD })).toBe(expected)
  })

  // addition: a USD pre-auth cancel is still the pre-auth cancel
  it('cancels a USD pre-authorization with the pre-auth cancel', () => {
    expect(mapper.mapTxType(TX_TYPE.CANCEL, null, { currency: CURRENCY.USD, transaction_type: 'pre' })).toBe(
      'TP_Islem_Iptal_OnProv',
    )
  })

  // addition: inherited members never count as order values
  it('ignores inherited order members', () => {
    const order = Object.create({ currency: CURRENCY.USD }) as Record<string, unknown>
    expect(mapper.mapTxType(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, order)).toBe('TP_WMD_UCD')
  })

  it.each([
    [MODEL.THREE_D_SECURE, '3D'],
    [MODEL.THREE_D_PAY, '3D'],
    [MODEL.NON_SECURE, 'NS'],
  ])('mapSecureType(%s) = %s', (model, expected) => {
    expect(mapper.mapSecureType(model)).toBe(expected)
  })

  // deviation: C8 (NotImplementedError instead of LogicException)
  it('has no recurring frequency mapping', () => {
    expect(() => mapper.mapRecurringFrequency('DAY')).toThrow(NotImplementedError)
  })

  it('has no language mapping', () => {
    expect(() => mapper.mapLang(LANG.TR)).toThrow(NotImplementedError)
  })

  it('maps currencies to the bank codes', () => {
    expect(mapper.mapCurrency(CURRENCY.TRY)).toBe('1000')
    expect(mapper.mapCurrency(CURRENCY.USD)).toBe('1001')
    expect(mapper.mapCurrency(CURRENCY.EUR)).toBe('1002')
    expect(mapper.mapCurrency(CURRENCY.GBP)).toBe('1003')
  })

  // addition: an unknown currency is refused, never sent as "undefined"
  it.each(['XXX', 'JPY', 'constructor', '__proto__', ''])('rejects the currency %j', (currency) => {
    expect(() => mapper.mapCurrency(currency as never)).toThrow(PosError)
  })

  it('has the expected table sizes', () => {
    expect(Object.keys(mapper.getLangMappings())).toHaveLength(0)
    expect(Object.keys(mapper.getRecurringOrderFrequencyMappings())).toHaveLength(0)
    expect(Object.keys(mapper.getCurrencyMappings())).toHaveLength(4)
    expect(Object.keys(mapper.getTxTypeMappings())).toHaveLength(10)
    expect(Object.keys(mapper.getSecureTypeMappings())).toHaveLength(3)
    expect(Object.keys(mapper.getCardTypeMappings())).toHaveLength(0)
  })
})
