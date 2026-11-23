import { describe, expect, it } from 'vitest'
import { PayFlexV4PosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/PayFlexV4PosResponseValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import { CURRENCY, MODEL, TX_TYPE } from '../../../../../src/PosInterface.js'

describe('PayFlexV4PosResponseValueMapper', () => {
  const mapper = new PayFlexV4PosResponseValueMapper()

  it('supports', () => {
    expect(PayFlexV4PosResponseValueMapper.supports('PayFlexV4Pos')).toBe(true)
    expect(PayFlexV4PosResponseValueMapper.supports('AssecoPos')).toBe(false)
  })

  it.each([
    ['Sale', TX_TYPE.PAY_AUTH],
    ['Auth', TX_TYPE.PAY_PRE_AUTH],
    ['Capture', TX_TYPE.PAY_POST_AUTH],
    ['Cancel', TX_TYPE.CANCEL],
    ['Refund', TX_TYPE.REFUND],
    ['status', TX_TYPE.STATUS],
    ['', null],
  ])('mapTxType(%j) -> %j', (txType, expected) => {
    expect(mapper.mapTxType(txType)).toBe(expected)
  })

  it('mapTxType does not resolve prototype keys', () => {
    expect(mapper.mapTxType('constructor')).toBeNull()
  })

  // empty order status table -> NotImplementedError
  it('mapOrderStatus is not supported', () => {
    expect(() => mapper.mapOrderStatus('S')).toThrow(NotImplementedError)
  })

  it.each([
    ['949', TX_TYPE.PAY_AUTH, CURRENCY.TRY],
    ['949', '', CURRENCY.TRY],
    ['TRY', '', null],
    ['840', '', CURRENCY.USD],
    ['978', '', CURRENCY.EUR],
    ['826', '', CURRENCY.GBP],
    ['392', '', CURRENCY.JPY],
    ['643', '', CURRENCY.RUB],
  ] as const)('mapCurrency(%j, %j) -> %j', (currency, txType, expected) => {
    expect(mapper.mapCurrency(currency, txType === '' ? null : txType)).toBe(expected)
  })

  it.each([
    ['1', TX_TYPE.PAY_AUTH, MODEL.NON_SECURE],
    ['2', TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE],
    ['3', TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY],
    ['1', '', MODEL.NON_SECURE],
    ['2', '', MODEL.THREE_D_SECURE],
    ['3', '', MODEL.THREE_D_PAY],
    ['4', '', null],
  ] as const)('mapSecureType(%j, %j) -> %j', (secureType, txType, expected) => {
    expect(mapper.mapSecureType(secureType, txType === '' ? null : txType)).toBe(expected)
  })
})
