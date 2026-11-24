import { describe, expect, it } from 'vitest'
import { PosNetPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/PosNetPosResponseValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import { CURRENCY, TX_TYPE } from '../../../../../src/PosInterface.js'

describe('PosNetPosResponseValueMapper', () => {
  const mapper = new PosNetPosResponseValueMapper()

  it('supports', () => {
    expect(PosNetPosResponseValueMapper.supports('PosNetPos')).toBe(true)
    expect(PosNetPosResponseValueMapper.supports('AssecoPos')).toBe(false)
  })

  it.each([
    ['Sale', TX_TYPE.PAY_AUTH],
    ['Auth', TX_TYPE.PAY_PRE_AUTH],
    ['Capt', TX_TYPE.PAY_POST_AUTH],
    ['reverse', TX_TYPE.CANCEL],
    ['return', TX_TYPE.REFUND],
    ['agreement', TX_TYPE.STATUS],
    ['', null],
    ['blabla', null],
  ])('mapTxType(%j) -> %j', (txType, expected) => {
    expect(mapper.mapTxType(txType)).toBe(expected)
  })

  // deviation: P28 NotImplementedError instead of a plain logic exception
  it('mapOrderStatus is not supported', () => {
    expect(() => mapper.mapOrderStatus('S')).toThrow(NotImplementedError)
  })

  it.each([
    ['TL', TX_TYPE.PAY_AUTH, CURRENCY.TRY],
    ['TL', '', CURRENCY.TRY],
    ['US', '', CURRENCY.USD],
    ['EU', '', CURRENCY.EUR],
    ['GB', '', CURRENCY.GBP],
    ['JP', '', CURRENCY.JPY],
    ['RU', '', CURRENCY.RUB],
    ['TRY', '', null],
  ])('mapCurrency(%j, %j) -> %j', (currency, txType, expected) => {
    expect(mapper.mapCurrency(currency, txType as never)).toBe(expected)
  })

  // deviation: P28 NotImplementedError instead of a plain logic exception
  it('mapSecureType is not supported', () => {
    expect(() => mapper.mapSecureType('3DModel', TX_TYPE.PAY_AUTH)).toThrow(NotImplementedError)
  })
})
