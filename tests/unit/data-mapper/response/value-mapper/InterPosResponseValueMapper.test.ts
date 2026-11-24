import { describe, expect, it } from 'vitest'
import { InterPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/InterPosResponseValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import { CURRENCY, TX_TYPE } from '../../../../../src/PosInterface.js'

describe('InterPosResponseValueMapper', () => {
  const mapper = new InterPosResponseValueMapper()

  it('supports', () => {
    expect(InterPosResponseValueMapper.supports('InterPos')).toBe(true)
    expect(InterPosResponseValueMapper.supports('AssecoPos')).toBe(false)
  })

  // deviation: F30 NotImplementedError instead of a plain logic exception
  it('mapTxType is not supported', () => {
    expect(() => mapper.mapTxType('Auth')).toThrow(NotImplementedError)
  })

  // deviation: F30 NotImplementedError instead of a plain logic exception
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

  // deviation: F30 NotImplementedError instead of a plain logic exception
  it('mapSecureType is not supported', () => {
    expect(() => mapper.mapSecureType('3DModel', TX_TYPE.PAY_AUTH)).toThrow(NotImplementedError)
  })

  // addition: prototype keys and unknown numeric codes are not currencies
  it.each(['__proto__', 'constructor', 'toString', '950', ''])('mapCurrency(%j) -> null', (currency) => {
    expect(mapper.mapCurrency(currency)).toBeNull()
  })
})
