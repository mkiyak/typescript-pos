import { describe, expect, it } from 'vitest'
import { ToslaPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/ToslaPosResponseValueFormatter.js'
import { NotImplementedError } from '../../../../../src/errors.js'

describe('ToslaPosResponseValueFormatter', () => {
  const formatter = new ToslaPosResponseValueFormatter()

  it('supports', () => {
    expect(ToslaPosResponseValueFormatter.supports('ToslaPos')).toBe(true)
    expect(ToslaPosResponseValueFormatter.supports('AssecoPos')).toBe(false)
  })

  it.each([['1001', '', 10.01]])('formatAmount(%j, %j) = %j', (amount, txType, expected) => {
    expect(formatter.formatAmount(amount, txType)).toBe(expected)
  })

  // deviation: T19 NotImplementedError instead of a plain not-implemented exception
  it('formatInstallment is not supported', () => {
    expect(() => formatter.formatInstallment()).toThrow(NotImplementedError)
  })

  // addition: kuruş integers (numbers or text) divide by 100; unreadable text reads as zero, never NaN
  it.each([
    [101, 1.01],
    ['101', 1.01],
    [0, 0],
    ['', 0],
    ['abc', 0],
  ])('formatAmount(%j) = %j', (amount, expected) => {
    expect(formatter.formatAmount(amount, 'status')).toBe(expected)
  })

  // addition: the inherited parser reads bank times without an offset as Türkiye time
  it('formatDateTime reads a compact bank time as Türkiye time', () => {
    expect(formatter.formatDateTime('20230309221037', 'status')).toStrictEqual(new Date('2023-03-09T22:10:37+03:00'))
  })
})
