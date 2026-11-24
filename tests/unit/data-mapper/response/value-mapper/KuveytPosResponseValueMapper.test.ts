import { describe, expect, it } from 'vitest'
import { KuveytPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/KuveytPosResponseValueMapper.js'
import { CURRENCY, MODEL, PAYMENT_STATUS, TX_TYPE } from '../../../../../src/PosInterface.js'

describe('KuveytPosResponseValueMapper', () => {
  const mapper = new KuveytPosResponseValueMapper()

  it('supports', () => {
    expect(KuveytPosResponseValueMapper.supports('KuveytPos')).toBe(true)
    expect(KuveytPosResponseValueMapper.supports('VakifKatilimPos')).toBe(false)
    expect(KuveytPosResponseValueMapper.supports('AssecoPos')).toBe(false)
  })

  it.each([
    ['Sale', TX_TYPE.PAY_AUTH],
    ['SaleReversal', TX_TYPE.CANCEL],
    ['GetMerchantOrderDetail', TX_TYPE.STATUS],
    ['DrawBack', TX_TYPE.REFUND],
    ['PartialDrawback', TX_TYPE.REFUND_PARTIAL],
    ['', null],
  ])('mapTxType(%j) -> %j', (txType, expected) => {
    expect(mapper.mapTxType(txType)).toBe(expected)
  })

  it.each([
    [1, PAYMENT_STATUS.PAYMENT_COMPLETED],
    [4, PAYMENT_STATUS.FULLY_REFUNDED],
    [5, PAYMENT_STATUS.PARTIALLY_REFUNDED],
    [6, PAYMENT_STATUS.CANCELED],
    [2, 2],
    ['blabla', 'blabla'],
  ])('mapOrderStatus(%j) -> %j', (orderStatus, expected) => {
    expect(mapper.mapOrderStatus(orderStatus)).toBe(expected)
  })

  it.each([
    ['949', TX_TYPE.PAY_AUTH, CURRENCY.TRY],
    ['0949', TX_TYPE.PAY_AUTH, CURRENCY.TRY],
    ['949', '', CURRENCY.TRY],
    ['0949', '', CURRENCY.TRY],
    ['TRY', '', null],
    ['840', '', CURRENCY.USD],
    ['0840', '', CURRENCY.USD],
    ['978', '', CURRENCY.EUR],
    ['826', '', null],
    ['392', '', null],
  ])('mapCurrency(%j, %j) -> %j', (currency, txType, expected) => {
    expect(mapper.mapCurrency(currency, txType as never)).toBe(expected)
  })

  it.each([
    ['3', TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE],
    ['0', TX_TYPE.PAY_AUTH, MODEL.NON_SECURE],
    ['1', TX_TYPE.PAY_AUTH, null],
  ])('mapSecureType(%j, %j) -> %j', (secureType, txType, expected) => {
    expect(mapper.mapSecureType(secureType, txType)).toBe(expected)
  })

  // addition: numeric bank codes, inherited keys and padded text never map to a currency or model by accident
  it('looks values up exactly', () => {
    expect(mapper.mapCurrency(949)).toBe(CURRENCY.TRY)
    expect(mapper.mapCurrency(' 949')).toBeNull()
    expect(mapper.mapCurrency('constructor')).toBeNull()
    expect(mapper.mapSecureType(3)).toBe(MODEL.THREE_D_SECURE)
    expect(mapper.mapSecureType(' 3')).toBeNull()
    expect(mapper.mapSecureType('constructor')).toBeNull()
    expect(mapper.mapTxType('constructor')).toBeNull()
    expect(mapper.mapTxType(' Sale')).toBeNull()
  })
})
