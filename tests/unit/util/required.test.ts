import { describe, expect, it } from 'vitest'
import { PosError } from '../../../src/errors.js'
import { isSet, required, requiredString } from '../../../src/util/required.js'

describe('required helpers', () => {
  it('isSet follows PHP isset', () => {
    expect(isSet(undefined)).toBe(false)
    expect(isSet(null)).toBe(false)
    expect(isSet(0)).toBe(true)
    expect(isSet('')).toBe(true)
  })

  it('required returns present values, including 0', () => {
    expect(required({ amount: 0 }, 'amount')).toBe(0)
    expect(required({ id: 'a1' }, 'id')).toBe('a1')
  })

  it.each([undefined, null, ''])('required rejects %s', (value) => {
    expect(() => required({ id: value as never }, 'id')).toThrow(PosError)
  })

  it('requiredString stringifies and rejects missing values', () => {
    expect(requiredString({ n: 3 }, 'n', 'Recurring')).toBe('3')
    expect(() => requiredString({}, 'n', 'Recurring')).toThrow(/Recurring field "n"/)
    expect(() => requiredString({ n: '' }, 'n', 'Recurring')).toThrow(PosError)
  })
})
