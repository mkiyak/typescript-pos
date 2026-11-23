import { describe, expect, it } from 'vitest'
import { timingSafeEqualStr } from '../../../src/util/timingSafeEqualStr.js'

describe('timingSafeEqualStr', () => {
  it('compares strings', () => {
    expect(timingSafeEqualStr('abc', 'abc')).toBe(true)
    expect(timingSafeEqualStr('abc', 'abd')).toBe(false)
    expect(timingSafeEqualStr('abc', 'ab')).toBe(false)
  })

  it('returns false for non-strings without throwing', () => {
    expect(timingSafeEqualStr(undefined, 'a')).toBe(false)
    expect(timingSafeEqualStr(123, '123')).toBe(false)
    expect(timingSafeEqualStr('a', null)).toBe(false)
  })

  it('handles multibyte strings with equal char length but different byte length', () => {
    expect(timingSafeEqualStr('ş', 's')).toBe(false)
    expect(timingSafeEqualStr('şş', 'şş')).toBe(true)
  })
})
