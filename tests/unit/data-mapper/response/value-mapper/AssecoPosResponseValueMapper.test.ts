import { describe, expect, it } from 'vitest'
import { AssecoPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/AssecoPosResponseValueMapper.js'
import { CURRENCY, MODEL, PAYMENT_STATUS, TX_TYPE } from '../../../../../src/PosInterface.js'

describe('AssecoPosResponseValueMapper', () => {
  const mapper = new AssecoPosResponseValueMapper()

  it('supports', () => {
    expect(AssecoPosResponseValueMapper.supports('AssecoPos')).toBe(true)
    expect(AssecoPosResponseValueMapper.supports('AkbankPos')).toBe(false)
  })

  it.each([
    ['S', TX_TYPE.PAY_AUTH],
    ['C', TX_TYPE.REFUND],
    ['', null],
  ])('mapTxType(%j) -> %j', (txType, expected) => {
    expect(mapper.mapTxType(txType)).toBe(expected)
  })

  it('mapTxType does not resolve prototype keys', () => {
    expect(mapper.mapTxType('constructor')).toBeNull()
  })

  it.each([
    ['D', PAYMENT_STATUS.ERROR],
    ['ERR', PAYMENT_STATUS.ERROR],
    ['A', PAYMENT_STATUS.PAYMENT_COMPLETED],
    ['C', PAYMENT_STATUS.PAYMENT_COMPLETED],
    ['S', PAYMENT_STATUS.PAYMENT_COMPLETED],
    ['PN', PAYMENT_STATUS.PAYMENT_PENDING],
    ['CNCL', PAYMENT_STATUS.CANCELED],
    ['V', PAYMENT_STATUS.CANCELED],
    ['blabla', 'blabla'],
  ])('mapOrderStatus(%j) -> %j', (orderStatus, expected) => {
    expect(mapper.mapOrderStatus(orderStatus)).toBe(expected)
  })

  it.each([
    ['949', TX_TYPE.PAY_AUTH, CURRENCY.TRY],
    ['949', '', CURRENCY.TRY],
    ['840', '', CURRENCY.USD],
    ['978', '', CURRENCY.EUR],
    ['826', '', CURRENCY.GBP],
    ['392', '', CURRENCY.JPY],
    ['643', '', CURRENCY.RUB],
    ['TRY', '', null],
  ] as const)('mapCurrency(%j, %j) -> %j', (currency, txType, expected) => {
    expect(mapper.mapCurrency(currency, txType === '' ? null : txType)).toBe(expected)
  })

  it.each([
    ['3d', TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE],
    ['3d', TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_SECURE],
    ['3d', '', MODEL.THREE_D_SECURE],
    ['3d_pay', TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY],
    ['3d_pay', '', MODEL.THREE_D_PAY],
    ['3d_pay_hosting', TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY_HOSTING],
    ['3d_host', TX_TYPE.PAY_AUTH, MODEL.THREE_D_HOST],
    ['regular', TX_TYPE.PAY_AUTH, MODEL.NON_SECURE],
    ['regular', TX_TYPE.PAY_POST_AUTH, MODEL.NON_SECURE],
  ] as const)('mapSecureType(%j, %j) -> %j', (secureType, txType, expected) => {
    expect(mapper.mapSecureType(secureType, txType === '' ? null : txType)).toBe(expected)
  })
})
