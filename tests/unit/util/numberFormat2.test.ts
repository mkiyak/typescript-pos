import { describe, expect, it } from 'vitest'
import { PosError } from '../../../src/errors.js'
import { numberFormat2 } from '../../../src/util/numberFormat2.js'

describe('numberFormat2', () => {
  // addition: shared two-decimal amount formatter
  it.each([
    [1, '1.00'],
    [1.1, '1.10'],
    [0.285, '0.29'],
    [1.005, '1.01'],
    [-0.001, '0.00'],
  ])('formats %s as %s', (amount, expected) => {
    expect(numberFormat2(amount)).toBe(expected)
  })

  it('rejects 1e13 and NaN', () => {
    expect(() => numberFormat2(1e13)).toThrow(PosError)
    expect(() => numberFormat2(Number.NaN)).toThrow(PosError)
  })

  // addition: an amount just below 1e13 that rounds up to 1e13 is refused like 1e13 itself
  it('rejects an amount that rounds up to 1e13 and keeps the largest one that does not', () => {
    expect(() => numberFormat2(9999999999999.996)).toThrow(PosError)
    expect(() => numberFormat2(-9999999999999.996)).toThrow(PosError)
    expect(numberFormat2(9999999999999.99)).toBe('9999999999999.99')
  })
})
