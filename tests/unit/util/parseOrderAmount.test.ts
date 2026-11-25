import { describe, expect, it } from 'vitest'
import { parseOrderAmount } from '../../../src/util/parseOrderAmount.js'

// addition: 2.7 the amount a callback carries as text is read as a plain decimal or not at all
describe('parseOrderAmount', () => {
  it.each([
    ['1', 1],
    ['1.01', 1.01],
    ['10.50', 10.5],
    ['0.5', 0.5],
    ['.5', 0.5],
    ['5.', 5],
    ['+2.25', 2.25],
    ['-3', -3],
    ['  7.5  ', 7.5],
    ['0', 0],
    ['0000012.30', 12.3],
  ])('reads the decimal text %j as %d', (text, expected) => {
    expect(parseOrderAmount(text)).toBe(expected)
  })

  it.each([
    ['hexadecimal text', '0x10'],
    ['exponent text', '1e3'],
    ['capital exponent text', '1E3'],
    ['signed exponent text', '1e+3'],
    ['Infinity text', 'Infinity'],
    ['negative Infinity text', '-Infinity'],
    ['NaN text', 'NaN'],
    ['empty text', ''],
    ['blank text', '   '],
    ['a lone sign', '+'],
    ['a lone point', '.'],
    ['a thousands separator', '1,000.50'],
    ['a decimal comma', '1,5'],
    ['two points', '1.2.3'],
    ['trailing letters', '12abc'],
    ['an inner space', '1 000'],
  ])('reads %s as NaN', (_label, text) => {
    expect(parseOrderAmount(text)).toBeNaN()
  })

  it.each([
    [1, 1],
    [0, 0],
    [1.01, 1.01],
    [-4.5, -4.5],
  ])('keeps the finite number %d', (value, expected) => {
    expect(parseOrderAmount(value)).toBe(expected)
  })

  it.each([
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('reads the number %s as NaN', (_label, value) => {
    expect(parseOrderAmount(value)).toBeNaN()
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a boolean', true],
    ['an array', ['1']],
    ['an object', { amount: '1' }],
    ['a bigint', 1n],
  ])('reads %s as NaN', (_label, value) => {
    expect(parseOrderAmount(value)).toBeNaN()
  })
})
