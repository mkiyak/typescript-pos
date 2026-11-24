import { describe, expect, it } from 'vitest'
import { PosNetV1PosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/PosNetV1PosResponseValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import { CURRENCY, PAYMENT_STATUS, TX_TYPE } from '../../../../../src/PosInterface.js'

describe('PosNetV1PosResponseValueMapper', () => {
  const mapper = new PosNetV1PosResponseValueMapper()

  it('supports', () => {
    expect(PosNetV1PosResponseValueMapper.supports('PosNetV1Pos')).toBe(true)
    expect(PosNetV1PosResponseValueMapper.supports('AssecoPos')).toBe(false)
  })

  it.each([
    ['Sale', TX_TYPE.PAY_AUTH],
    ['Auth', TX_TYPE.PAY_PRE_AUTH],
    ['Capture', TX_TYPE.PAY_POST_AUTH],
    ['Reverse', TX_TYPE.CANCEL],
    ['Return', TX_TYPE.REFUND],
    ['TransactionInquiry', TX_TYPE.STATUS],
    ['', null],
    ['blabla', null],
  ])('mapTxType(%j) -> %j', (txType, expected) => {
    expect(mapper.mapTxType(txType)).toBe(expected)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, PAYMENT_STATUS.PAYMENT_COMPLETED],
    [TX_TYPE.CANCEL, PAYMENT_STATUS.CANCELED],
    [TX_TYPE.REFUND, PAYMENT_STATUS.FULLY_REFUNDED],
    ['blabla', 'blabla'],
  ])('mapOrderStatus(%j) -> %j', (orderStatus, expected) => {
    expect(mapper.mapOrderStatus(orderStatus)).toBe(expected)
  })

  it.each([
    ['TL', TX_TYPE.STATUS, CURRENCY.TRY],
    ['US', TX_TYPE.STATUS, CURRENCY.USD],
    ['EU', TX_TYPE.STATUS, CURRENCY.EUR],
    ['GB', TX_TYPE.STATUS, CURRENCY.GBP],
    ['JP', TX_TYPE.STATUS, CURRENCY.JPY],
    ['RU', TX_TYPE.STATUS, CURRENCY.RUB],
    ['949', TX_TYPE.PAY_AUTH, CURRENCY.TRY],
    ['840', TX_TYPE.PAY_AUTH, CURRENCY.USD],
    ['978', TX_TYPE.PAY_AUTH, CURRENCY.EUR],
    ['826', TX_TYPE.PAY_AUTH, CURRENCY.GBP],
    ['392', TX_TYPE.PAY_AUTH, CURRENCY.JPY],
    ['643', TX_TYPE.PAY_AUTH, CURRENCY.RUB],
    ['TRY', '', null],
  ])('mapCurrency(%j, %j) -> %j', (currency, txType, expected) => {
    expect(mapper.mapCurrency(currency, txType as never)).toBe(expected)
  })

  // deviation: P28 NotImplementedError instead of a plain logic exception
  it('mapSecureType is not supported', () => {
    expect(() => mapper.mapSecureType('3DModel', TX_TYPE.PAY_AUTH)).toThrow(NotImplementedError)
  })

  // addition: the two currency tables never leak into each other
  it.each([
    ['TL', TX_TYPE.PAY_AUTH],
    ['TL', null],
    ['949', TX_TYPE.STATUS],
    ['constructor', TX_TYPE.PAY_AUTH],
    ['constructor', TX_TYPE.STATUS],
    ['__proto__', null],
  ])('mapCurrency(%j, %j) -> null (addition)', (currency, txType) => {
    expect(mapper.mapCurrency(currency, txType as never)).toBeNull()
  })

  // addition: numeric callback codes are looked up as their text
  it('mapCurrency accepts a numeric code', () => {
    expect(mapper.mapCurrency(949, TX_TYPE.PAY_AUTH)).toBe(CURRENCY.TRY)
    expect(mapper.mapCurrency(949)).toBe(CURRENCY.TRY)
  })
})
