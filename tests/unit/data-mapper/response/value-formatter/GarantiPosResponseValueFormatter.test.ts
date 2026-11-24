import { describe, expect, it } from 'vitest'
import { GarantiPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/GarantiPosResponseValueFormatter.js'
import { TX_TYPE } from '../../../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../../../src/pos-query/PosQueryInterface.js'

describe('GarantiPosResponseValueFormatter', () => {
  const formatter = new GarantiPosResponseValueFormatter()

  it('supports', () => {
    expect(GarantiPosResponseValueFormatter.supports('GarantiPos')).toBe(true)
    expect(GarantiPosResponseValueFormatter.supports('AssecoPos')).toBe(false)
  })

  it.each([
    ['1001', TX_TYPE.PAY_AUTH, 10.01],
    ['1001', TX_TYPE.PAY_PRE_AUTH, 10.01],
    ['1001', TX_TYPE.PAY_POST_AUTH, 10.01],
    ['1001', TX_TYPE.CANCEL, 10.01],
    ['1001', TX_TYPE.REFUND, 10.01],
    ['1001', TX_TYPE.REFUND_PARTIAL, 10.01],
    ['1001', TX_TYPE.STATUS, 10.01],
    ['1001', TX_TYPE.ORDER_HISTORY, 10.01],
    ['1001', '', 10.01],
  ] as const)('formatAmount(%j, %j) -> %j', (amount, txType, expected) => {
    expect(formatter.formatAmount(amount, txType)).toBe(expected)
  })

  it.each([
    ['1', TX_TYPE.PAY_AUTH, 0],
    ['1', '', 0],
    ['0', TX_TYPE.PAY_AUTH, 0],
    ['0', '', 0],
    [null, TX_TYPE.PAY_AUTH, 0],
    [null, '', 0],
    ['1', QUERY_TYPE.HISTORY, 0],
    ['Pesin', QUERY_TYPE.HISTORY, 0],
  ] as const)('formatInstallment(%j, %j) -> %j', (installment, txType, expected) => {
    expect(formatter.formatInstallment(installment, txType)).toBe(expected)
  })

  // addition: installments of two or more still pass through, also for the order list answer
  it.each([
    ['3', TX_TYPE.PAY_AUTH, 3],
    ['12', QUERY_TYPE.HISTORY, 12],
    [undefined, QUERY_TYPE.HISTORY, 0],
  ] as const)('formatInstallment(%j, %j) -> %j (addition)', (installment, txType, expected) => {
    expect(formatter.formatInstallment(installment, txType)).toBe(expected)
  })

  // addition: minor units divide exactly like the amount strings of the bank answers
  it.each([
    ['0', 0],
    ['101', 1.01],
    ['100001', 1000.01],
    [101, 1.01],
  ] as const)('formatAmount(%j) -> %j (addition)', (amount, expected) => {
    expect(formatter.formatAmount(amount, TX_TYPE.PAY_AUTH)).toBe(expected)
  })
})
