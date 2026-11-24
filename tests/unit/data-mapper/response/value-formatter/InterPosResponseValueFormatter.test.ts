import { describe, expect, it } from 'vitest'
import { InterPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/InterPosResponseValueFormatter.js'
import { NotImplementedError } from '../../../../../src/errors.js'

describe('InterPosResponseValueFormatter', () => {
  const formatter = new InterPosResponseValueFormatter()

  it('supports', () => {
    expect(InterPosResponseValueFormatter.supports('InterPos')).toBe(true)
    expect(InterPosResponseValueFormatter.supports('AssecoPos')).toBe(false)
  })

  it.each([
    ['0', '', 0],
    ['1.056,2', '', 1056.2],
    ['1,01', '', 1.01],
  ])('formatAmount(%j, %j) = %j', (amount, txType, expected) => {
    expect(formatter.formatAmount(amount, txType)).toBe(expected)
  })

  // addition: a dotted amount with two decimals reads as thousands (display only, the amount is never sent back)
  it("formatAmount('1.01') reads the dot as a thousands separator and gives 101", () => {
    expect(formatter.formatAmount('1.01', 'pay')).toBe(101)
  })

  // deviation: F30 NotImplementedError instead of a plain not-implemented exception
  it('formatInstallment is not supported', () => {
    expect(() => formatter.formatInstallment()).toThrow(NotImplementedError)
  })

  // addition: numbers and unreadable text read as plain numbers / zero, never NaN
  it.each([
    [101, 101],
    ['', 0],
    ['abc', 0],
    ['1.234.567,89', 1234567.89],
  ])('formatAmount(%j) = %j', (amount, expected) => {
    expect(formatter.formatAmount(amount, 'pay')).toBe(expected)
  })

  // addition: timestamps without an offset are Türkiye time
  it('formatDateTime reads the dotted layout as UTC+03:00', () => {
    expect(formatter.formatDateTime('09.08.2024 10:40:34', 'pay')).toStrictEqual(new Date('2024-08-09T10:40:34+03:00'))
  })
})
