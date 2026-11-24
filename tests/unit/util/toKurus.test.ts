import { describe, expect, it } from 'vitest'
import { PosError } from '../../../src/errors.js'
import { toKurus } from '../../../src/util/toKurus.js'

describe('toKurus', () => {
  // The amounts are exact: no binary floating point truncation (1.15 * 100 = 114.99999999999999).
  it.each([
    [1.1, 110],
    [1.0, 100],
    [10.01, 1001],
    [1.01, 101],
    [9.01, 901],
    [10.0, 1000],
    // addition: KR the multiplication-and-truncate formula gives 114, 819, 28, 434, 1998 here
    [1.15, 115],
    [8.2, 820],
    [0.29, 29],
    [4.35, 435],
    [19.99, 1999],
    [1.005, 101],
    [0.01, 1],
    [99999999.99, 9999999999],
  ])('toKurus(%j) = %j', (amount, expected) => {
    expect(toKurus(amount)).toBe(expected)
  })

  // addition: B6 callers parse decimal text first; the type takes numbers only
  it("'100.25' is parsed by the caller", () => {
    expect(toKurus(Number('100.25'))).toBe(10025)
  })

  it('the result is an integer', () => {
    for (const a of [0.07, 0.57, 1.13, 2.675, 33.33, 1234.56]) expect(Number.isInteger(toKurus(a))).toBe(true)
  })

  // addition: B6
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['1e13', 1e13],
    ['1e20', 1e20],
    ['zero', 0],
    ['negative zero', -0],
    ['negative', -1.5],
    ['below half a kuruş', 0.004],
    ['0.001', 0.001],
  ])('%s -> PosError', (_n, amount) => {
    expect(() => toKurus(amount)).toThrow(PosError)
  })

  it('accepts the largest amount below 1e13', () => {
    expect(toKurus(9999999999999.99)).toBe(Math.round(9999999999999.99 * 100))
  })

  it('half a kuruş rounds up like a two decimal amount', () => {
    expect(toKurus(0.005)).toBe(1)
  })
})
