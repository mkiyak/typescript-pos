import { describe, expect, it } from 'vitest'
import { phpTrim } from '../../../src/util/phpTrim.js'

// addition: shared PHP trim() used by the response mappers and the gateway callback checks
describe('phpTrim', () => {
  it.each([
    [' 1', '1'],
    ['1 ', '1'],
    ['\t\n\r\0\x0B 00 \x0B', '00'],
    ['   ', ''],
    ['', ''],
    ['a b', 'a b'],
  ])('trims %j to %j', (input, expected) => {
    expect(phpTrim(input)).toBe(expected)
  })

  it('keeps characters PHP trim() keeps (non-breaking and other Unicode spaces)', () => {
    expect(phpTrim(' 1 ')).toBe(' 1 ')
    expect(phpTrim('\f1')).toBe('\f1')
  })
})
