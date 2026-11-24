import { describe, expect, it } from 'vitest'
import { PayForPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/PayForPosResponseValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import { CURRENCY, MODEL, TX_TYPE } from '../../../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../../../src/pos-query/PosQueryInterface.js'

describe('PayForPosResponseValueMapper', () => {
  const mapper = new PayForPosResponseValueMapper()

  it('supports', () => {
    expect(PayForPosResponseValueMapper.supports('PayForPos')).toBe(true)
    expect(PayForPosResponseValueMapper.supports('AssecoPos')).toBe(false)
  })

  it.each([
    ['Auth', TX_TYPE.PAY_AUTH],
    ['PreAuth', TX_TYPE.PAY_PRE_AUTH],
    ['PostAuth', TX_TYPE.PAY_POST_AUTH],
    ['Void', TX_TYPE.CANCEL],
    ['Refund', TX_TYPE.REFUND],
    ['TxnHistory', QUERY_TYPE.HISTORY],
    ['OrderInquiry', TX_TYPE.STATUS],
    ['blabla', null],
  ])('mapTxType(%j) -> %j', (txType, expected) => {
    expect(mapper.mapTxType(txType)).toBe(expected)
  })

  // deviation: F28 NotImplementedError instead of a plain logic exception
  it('mapOrderStatus is not supported', () => {
    expect(() => mapper.mapOrderStatus('S')).toThrow(NotImplementedError)
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
  ])('mapCurrency(%j, %j) -> %j', (currency, txType, expected) => {
    expect(mapper.mapCurrency(currency, txType as never)).toBe(expected)
  })

  it.each([
    ['3DModel', TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE],
    ['3DModel', '', MODEL.THREE_D_SECURE],
    ['3DPay', '', MODEL.THREE_D_PAY],
    ['3DHost', '', MODEL.THREE_D_HOST],
    ['NonSecure', '', MODEL.NON_SECURE],
    ['blabla', '', null],
  ])('mapSecureType(%j, %j) -> %j', (secureType, txType, expected) => {
    expect(mapper.mapSecureType(secureType, txType as never)).toBe(expected)
  })

  // addition: the partial refund shares the bank word of the refund and maps back to the full refund type
  it('mapTxType never returns the partial refund type and ignores inherited keys', () => {
    expect(mapper.mapTxType('Refund')).toBe(TX_TYPE.REFUND)
    expect(mapper.mapTxType('constructor')).toBeNull()
    expect(mapper.mapSecureType('constructor')).toBeNull()
    expect(mapper.mapCurrency('__proto__')).toBeNull()
  })
})
