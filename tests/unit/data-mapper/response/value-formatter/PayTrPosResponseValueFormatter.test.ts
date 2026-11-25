import { describe, expect, it } from 'vitest'
import { PayTrPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/PayTrPosResponseValueFormatter.js'
import { TX_TYPE } from '../../../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../../../src/pos-query/PosQueryInterface.js'

describe('PayTrPosResponseValueFormatter', () => {
  const formatter = new PayTrPosResponseValueFormatter()

  it('supports', () => {
    expect(PayTrPosResponseValueFormatter.supports('PayTrPos')).toBe(true)
    expect(PayTrPosResponseValueFormatter.supports('AkbankPos')).toBe(false)
  })

  it.each([
    ['status_dot_decimal', '10.01', TX_TYPE.STATUS, 10.01],
    ['status_comma_decimal', '1,16', TX_TYPE.STATUS, 1.16],
    ['status_whole', '100.00', TX_TYPE.STATUS, 100],
    ['history_dot_decimal', '10.00', QUERY_TYPE.HISTORY, 10],
    ['history_comma_decimal', '1,16', QUERY_TYPE.HISTORY, 1.16],
    ['refund_decimal', '6.00', TX_TYPE.REFUND, 6],
    ['refund_zero', '0.00', TX_TYPE.REFUND, 0],
    ['callback_cents', '1001', TX_TYPE.PAY_AUTH, 10.01],
    ['callback_pre_auth', '500', TX_TYPE.PAY_PRE_AUTH, 5],
    ['callback_zero', '0', TX_TYPE.PAY_AUTH, 0],
  ])('formatAmount %s', (_name, amount, txType, expected) => {
    expect(formatter.formatAmount(amount, txType)).toBe(expected)
  })

  it.each([
    ['0', 0],
    ['1', 0],
    ['2', 2],
    ['12', 12],
    [null, 0],
  ])('formatInstallment(%j) -> %j', (installment, expected) => {
    expect(formatter.formatInstallment(installment, TX_TYPE.PAY_AUTH)).toBe(expected)
  })

  it.each([
    // deviation: bank times without an offset are Türkiye time, not the server zone
    ['23.06.2026', new Date('2026-06-23T00:00:00+03:00')],
    ['2026-06-23 14:30:00', new Date('2026-06-23T14:30:00+03:00')],
  ])('formatDateTime(%j)', (dateTime, expected) => {
    expect(formatter.formatDateTime(dateTime, TX_TYPE.STATUS)).toEqual(expected)
  })

  // addition: numbers are read like their text
  it('formatAmount accepts numbers', () => {
    expect(formatter.formatAmount(1001, TX_TYPE.PAY_AUTH)).toBe(10.01)
    expect(formatter.formatAmount(10.5, TX_TYPE.STATUS)).toBe(10.5)
  })
})
