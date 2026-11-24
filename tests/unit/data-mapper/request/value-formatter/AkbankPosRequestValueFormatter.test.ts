import { beforeEach, describe, expect, it } from 'vitest'
import { AkbankPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/AkbankPosRequestValueFormatter.js'
import { PosError } from '../../../../../src/errors.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'

// deviation: the formatter takes the card instead of a DateTime
const card = CreditCardFactory.create('5555444433332222', '24', '04', '123')

describe('AkbankPosRequestValueFormatter', () => {
  let formatter: AkbankPosRequestValueFormatter

  beforeEach(() => {
    formatter = new AkbankPosRequestValueFormatter()
  })

  it('supports only AkbankPos', () => {
    expect(AkbankPosRequestValueFormatter.supports('AkbankPos')).toBe(true)
    expect(AkbankPosRequestValueFormatter.supports('AssecoPos')).toBe(false)
  })

  it.each([
    [0, 1],
    [1, 1],
    [2, 2],
  ])('formatInstallment(%s) = %s', (installment, expected) => {
    expect(formatter.formatInstallment(installment)).toBe(expected)
  })

  // addition: a malformed installment is rejected instead of being sent
  it.each([Number.NaN, 1.5, -1, Number.POSITIVE_INFINITY])('formatInstallment rejects %s', (installment) => {
    expect(() => formatter.formatInstallment(installment)).toThrow(PosError)
  })

  it.each([
    [1.1, '1.10'],
    [1.0, '1.00'],
    [1, '1.00'],
    [1000.0, '1000.00'],
    // addition: A10 (rounded half up like number_format, never truncated)
    [0.29, '0.29'],
    [1.005, '1.01'],
    [0.285, '0.29'],
  ])('formatAmount(%s) = %s', (amount, expected) => {
    expect(formatter.formatAmount(amount)).toBe(expected)
  })

  // addition: A10
  it.each([1e13, Number.NaN, Number.POSITIVE_INFINITY])('formatAmount rejects %s', (amount) => {
    expect(() => formatter.formatAmount(amount)).toThrow(PosError)
  })

  it.each(['expiredDate', 'expireDate', ''])('formatCardExpDate(%j) = 0424', (fieldName) => {
    expect(formatter.formatCardExpDate(card, fieldName)).toBe('0424')
  })

  it('formatDateTime keeps the wall clock of the offset it was given in', () => {
    // deviation: A12 (the instant carries the Türkiye offset)
    expect(formatter.formatDateTime(new Date('2024-04-14T16:45:30.000+03:00'))).toBe('2024-04-14T16:45:30.000')
  })

  // addition: A12
  it('formatDateTime converts to Türkiye time and zeroes the milliseconds', () => {
    expect(formatter.formatDateTime(new Date('2024-04-14T22:30:15.789Z'))).toBe('2024-04-15T01:30:15.000')
  })

  // addition: A12
  it('formatDateTime rejects an invalid date', () => {
    expect(() => formatter.formatDateTime(new Date('x'))).toThrow(PosError)
  })
})
