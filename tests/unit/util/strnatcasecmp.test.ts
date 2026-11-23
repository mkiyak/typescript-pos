import { describe, expect, it } from 'vitest'
import { strnatcasecmp } from '../../../src/util/strnatcasecmp.js'

describe('strnatcasecmp', () => {
  it('sorts gateway form keys like PHP', () => {
    const keys = [
      'amount',
      'BillToCompany',
      'clientid',
      'currency',
      'failUrl',
      'hashAlgorithm',
      'Instalment',
      'lang',
      'oid',
      'okUrl',
      'rnd',
      'storetype',
      'TranType',
    ]
    const shuffled = [...keys].reverse()
    expect(shuffled.sort(strnatcasecmp)).toEqual(keys)
  })

  it('compares digit runs numerically', () => {
    expect(strnatcasecmp('img12', 'img10')).toBeGreaterThan(0)
    expect(strnatcasecmp('img2', 'img10')).toBeLessThan(0)
  })

  it('is case-insensitive', () => {
    expect(strnatcasecmp('ABC', 'abc')).toBe(0)
    expect(strnatcasecmp('a', 'B')).toBeLessThan(0)
  })

  it('handles leading zeros as PHP does', () => {
    expect(strnatcasecmp('x1', 'x01')).toBeGreaterThan(0)
  })

  it('folds with toupper so underscore sorts after letters', () => {
    expect(strnatcasecmp('_a', 'a')).toBeGreaterThan(0)
  })

  it('handles empty and prefix strings', () => {
    expect(strnatcasecmp('', '')).toBe(0)
    expect(strnatcasecmp('', 'a')).toBeLessThan(0)
    expect(strnatcasecmp('a', '')).toBeGreaterThan(0)
    expect(strnatcasecmp('a', 'ab')).toBeLessThan(0)
  })

  it('skips whitespace', () => {
    expect(strnatcasecmp('a  b', 'a b')).toBe(0)
  })
})
