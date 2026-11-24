import { describe, expect, it } from 'vitest'
import { VakifKatilimPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/VakifKatilimPosResponseValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import { CURRENCY, MODEL, PAYMENT_STATUS, TX_TYPE } from '../../../../../src/PosInterface.js'

describe('VakifKatilimPosResponseValueMapper', () => {
  const mapper = new VakifKatilimPosResponseValueMapper()

  it('supports', () => {
    expect(VakifKatilimPosResponseValueMapper.supports('VakifKatilimPos')).toBe(true)
    expect(VakifKatilimPosResponseValueMapper.supports('KuveytPos')).toBe(false)
    expect(VakifKatilimPosResponseValueMapper.supports('AssecoPos')).toBe(false)
  })

  // deviation: B14, a plain error becomes NotImplementedError; the gateway has no transaction type table
  it('mapTxType is not supported', () => {
    expect(() => mapper.mapTxType('Sale')).toThrow(NotImplementedError)
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
    ['840', '', CURRENCY.USD],
    ['0840', '', CURRENCY.USD],
    ['978', '', CURRENCY.EUR],
    ['826', '', CURRENCY.GBP],
    ['0826', '', CURRENCY.GBP],
    ['392', '', CURRENCY.JPY],
    ['810', '', CURRENCY.RUB],
    ['TRY', '', null],
  ])('mapCurrency(%j, %j) -> %j', (currency, txType, expected) => {
    expect(mapper.mapCurrency(currency, txType as never)).toBe(expected)
  })

  it.each([
    ['3', TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE],
    ['5', TX_TYPE.PAY_AUTH, MODEL.NON_SECURE],
    ['0', TX_TYPE.PAY_AUTH, null],
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
    expect(mapper.mapOrderStatus('constructor')).toBe('constructor')
  })
})
