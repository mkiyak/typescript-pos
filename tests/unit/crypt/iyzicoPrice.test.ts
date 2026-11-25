import { describe, expect, it } from 'vitest'
import { iyzicoAnswerKurus, iyzicoSignaturePrice } from '../../../src/crypt/iyzicoPrice.js'

describe('iyzicoSignaturePrice', () => {
  // addition: signature text of a price (trailing zeros removed, at most 8 decimals)
  it.each<[unknown, string]>([
    [100, '100'],
    [10.01, '10.01'],
    [10.5, '10.5'],
    ['10.50', '10.5'],
    ['10.0', '10'],
    ['10.51050', '10.5105'],
    [0.30599401, '0.30599401'],
    [10.209999999999999, '10.21'],
    [0, '0'],
    ['100', '100'],
    ['0.0', '0'],
    ['9999999999999.99999999', '9999999999999.99999999'],
    [9999999999999, '9999999999999'],
  ])('%j signs as %s', (value, expected) => {
    expect(iyzicoSignaturePrice(value)).toBe(expected)
  })

  it.each<[unknown]>([
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [-1],
    [1e13],
    ['1e2'],
    [' 1'],
    ['1 '],
    ['1.123456789'],
    ['-1'],
    ['.5'],
    ['1.'],
    ['12345678901234'],
    [''],
    [true],
    [null],
    [undefined],
    [{}],
    [['1']],
  ])('%j has no signature text', (value) => {
    expect(iyzicoSignaturePrice(value)).toBeNull()
  })
})

describe('iyzicoAnswerKurus', () => {
  // addition: kuruş of an answer amount
  it.each<[unknown, number]>([
    [10.21, 1021],
    ['10.50', 1050],
    [110, 11000],
    ['0.5', 50],
    [0, 0],
    ['10', 1000],
    [10.209999999999999, 1021],
  ])('%j is %d kuruş', (value, expected) => {
    expect(iyzicoAnswerKurus(value)).toBe(expected)
  })

  it.each<[unknown]>([[10.215], [0.30599401], ['1e2'], [-1], [Number.NaN], [null], ['x']])(
    '%j is not a kuruş amount',
    (value) => {
      expect(iyzicoAnswerKurus(value)).toBeNull()
    },
  )
})
