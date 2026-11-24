import { describe, expect, it } from 'vitest'
import { PosError } from '../../../src/errors.js'
import { parseInstallment } from '../../../src/util/parseInstallment.js'

// addition: one strict installment rule shared by both POSNET gateways
describe('parseInstallment', () => {
  it.each([
    [undefined, 0],
    [null, 0],
    [0, 0],
    [12, 12],
    [99, 99],
    ['0', 0],
    ['03', 3],
    ['12', 12],
  ])('accepts %s', (value, expected) => {
    expect(parseInstallment(value)).toBe(expected)
  })

  it.each([
    '1e1',
    ' 3 ',
    '0x10',
    '+3',
    '-1',
    '1.5',
    '',
    '100',
    100,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    {},
    true,
  ])('rejects %s', (value) => {
    expect(() => parseInstallment(value)).toThrow(PosError)
  })
})
