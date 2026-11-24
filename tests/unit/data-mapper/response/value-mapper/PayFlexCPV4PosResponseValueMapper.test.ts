import { describe, expect, it } from 'vitest'
import { PayFlexCPV4PosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/PayFlexCPV4PosResponseValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import { CURRENCY, TX_TYPE } from '../../../../../src/PosInterface.js'

describe('PayFlexCPV4PosResponseValueMapper', () => {
  const mapper = new PayFlexCPV4PosResponseValueMapper()

  it('supports only PayFlexCPV4Pos', () => {
    expect(PayFlexCPV4PosResponseValueMapper.supports('PayFlexCPV4Pos')).toBe(true)
    expect(PayFlexCPV4PosResponseValueMapper.supports('AssecoPos')).toBe(false)
  })

  it.each([
    ['Sale', TX_TYPE.PAY_AUTH],
    ['Auth', TX_TYPE.PAY_PRE_AUTH],
    ['Capture', TX_TYPE.PAY_POST_AUTH],
    ['Cancel', TX_TYPE.CANCEL],
    ['Refund', TX_TYPE.REFUND],
    // deviation: no history tx type before v0.3
    ['TxnHistory', null],
    ['OrderInquiry', TX_TYPE.STATUS],
    ['', null],
  ])('mapTxType(%j) -> %j', (txType, expected) => {
    expect(mapper.mapTxType(txType)).toBe(expected)
  })

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

  it('mapSecureType is not supported', () => {
    expect(() => mapper.mapSecureType('3D', TX_TYPE.PAY_AUTH)).toThrow(NotImplementedError)
  })
})
