import { describe, expect, it } from 'vitest'
import { BoaPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/BoaPosResponseValueFormatter.js'

describe('BoaPosResponseValueFormatter', () => {
  const formatter = new BoaPosResponseValueFormatter()

  it('supports', () => {
    expect(BoaPosResponseValueFormatter.supports('KuveytPos')).toBe(true)
    expect(BoaPosResponseValueFormatter.supports('VakifKatilimPos')).toBe(true)
    expect(BoaPosResponseValueFormatter.supports('AssecoPos')).toBe(false)
  })

  it.each([
    ['101', '', 1.01],
    ['101', 'pay', 1.01],
    ['101', 'status', 101],
    ['101', 'history', 101],
    ['101', 'order_history', 101],
  ])('formatAmount(%j, %j) = %j', (amount, txType, expected) => {
    expect(formatter.formatAmount(amount, txType)).toBe(expected)
  })

  // addition: B12
  it('formatAmount in kuruş', () => {
    expect(formatter.formatAmount('1001', 'pay')).toBe(10.01)
    expect(formatter.formatAmount('0', 'pay')).toBe(0)
  })

  // addition: B13 an offsetless bank time is Türkiye time, extra fraction digits are cut
  it('formatDateTime reads offsetless times as UTC+03:00', () => {
    expect(formatter.formatDateTime('2024-07-01T12:49:44.4281161', 'pay')).toStrictEqual(
      new Date('2024-07-01T12:49:44.428+03:00'),
    )
    expect(formatter.formatDateTime('2023-07-08T23:45:15.797', 'pay')).toStrictEqual(
      new Date('2023-07-08T23:45:15.797+03:00'),
    )
  })
})
