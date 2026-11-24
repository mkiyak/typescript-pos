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
})
