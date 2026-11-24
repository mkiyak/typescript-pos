import { beforeEach, describe, expect, it } from 'vitest'
import { KuveytPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/KuveytPosRequestValueFormatter.js'
import { PosError } from '../../../../../src/errors.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'

describe('KuveytPosRequestValueFormatter', () => {
  let formatter: KuveytPosRequestValueFormatter
  const card = CreditCardFactory.create('5555444433332222', '24', '04', '123')

  beforeEach(() => {
    formatter = new KuveytPosRequestValueFormatter()
  })

  it('supports only KuveytPos', () => {
    expect(KuveytPosRequestValueFormatter.supports('KuveytPos')).toBe(true)
    expect(KuveytPosRequestValueFormatter.supports('AssecoPos')).toBe(false)
  })

  it.each([
    [0, '0'],
    [1, '0'],
    [2, '2'],
  ])('formatInstallment(%s) = %s', (installment, expected) => {
    expect(formatter.formatInstallment(installment)).toBe(expected)
  })

  it.each([
    [1.1, 110],
    [1.0, 100],
  ])('formatAmount(%s) = %s', (amount, expected) => {
    expect(formatter.formatAmount(amount)).toBe(expected)
  })

  // addition: B6 (exact kuruş; multiplying by 100 and truncating loses one)
  it.each([
    [1.15, 115],
    [8.2, 820],
    [0.29, 29],
    [10.01, 1001],
    [19.99, 1999],
  ])('formatAmount(%s) = %s (exact kuruş)', (amount, expected) => {
    expect(formatter.formatAmount(amount)).toBe(expected)
  })

  // addition: B6
  it.each([0, -1, 0.004, Number.NaN, Number.POSITIVE_INFINITY, 1e13])('formatAmount(%s) throws', (amount) => {
    expect(() => formatter.formatAmount(amount)).toThrow(PosError)
  })

  // deviation: the formatter takes the card
  it.each([
    ['CardExpireDateMonth', '04'],
    ['CardExpireDateYear', '24'],
  ])('formatCardExpDate(%s) = %s', (fieldName, expected) => {
    expect(formatter.formatCardExpDate(card, fieldName)).toBe(expected)
  })

  // deviation: B14 (error class)
  it.each(['abc', ''])('formatCardExpDate rejects the field "%s"', (fieldName) => {
    expect(() => formatter.formatCardExpDate(card, fieldName)).toThrow(PosError)
  })

  it('formatDateTime', () => {
    // deviation: B13 (an explicit +03:00 instant)
    expect(formatter.formatDateTime(new Date('2024-04-14T16:45:30+03:00'))).toBe('2024-04-14T16:45:30')
  })

  // addition: B13 (Türkiye time whatever the instant's own offset)
  it('formatDateTime uses Türkiye time for a UTC instant', () => {
    expect(formatter.formatDateTime(new Date('2024-04-14T22:30:00Z'))).toBe('2024-04-15T01:30:00')
  })

  // addition: an invalid date never becomes "NaN-NaN"
  it('formatDateTime rejects an invalid date', () => {
    expect(() => formatter.formatDateTime(new Date('x'))).toThrow(PosError)
  })
})
