import { describe, expect, it } from 'vitest'
import { AssecoPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/AssecoPosResponseValueFormatter.js'
import { TX_TYPE } from '../../../../../src/PosInterface.js'

describe('AssecoPosResponseValueFormatter', () => {
  const formatter = new AssecoPosResponseValueFormatter()

  it('supports', () => {
    expect(AssecoPosResponseValueFormatter.supports('AssecoPos')).toBe(true)
    expect(AssecoPosResponseValueFormatter.supports('AkbankPos')).toBe(false)
  })

  it.each([
    ['1.00', TX_TYPE.PAY_AUTH, 1.0],
    ['1.00', TX_TYPE.PAY_PRE_AUTH, 1.0],
    ['1.00', TX_TYPE.PAY_POST_AUTH, 1.0],
    ['1.00', TX_TYPE.CANCEL, 1.0],
    ['1.00', TX_TYPE.REFUND, 1.0],
    ['1.00', TX_TYPE.REFUND_PARTIAL, 1.0],
    ['1.00', '', 1.0],
    ['1001', TX_TYPE.STATUS, 10.01],
    ['1001', TX_TYPE.ORDER_HISTORY, 10.01],
  ])('formatAmount(%j, %j) -> %j', (amount, txType, expected) => {
    expect(formatter.formatAmount(amount, txType)).toBe(expected)
  })

  it('divides status / history amounts (minor units) by 100 like PHP', () => {
    expect(formatter.formatAmount('101', TX_TYPE.STATUS)).toBe(1.01)
    expect(formatter.formatAmount('100', TX_TYPE.ORDER_HISTORY)).toBe(1)
    expect(formatter.formatAmount('', TX_TYPE.STATUS)).toBe(0)
  })
})
