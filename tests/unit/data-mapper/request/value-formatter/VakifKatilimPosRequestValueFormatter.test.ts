import { beforeEach, describe, expect, it } from 'vitest'
import { VakifKatilimPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/VakifKatilimPosRequestValueFormatter.js'
import { PosError } from '../../../../../src/errors.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'

describe('VakifKatilimPosRequestValueFormatter', () => {
  let formatter: VakifKatilimPosRequestValueFormatter
  const card = CreditCardFactory.create('5555444433332222', '24', '04', '123')

  beforeEach(() => {
    formatter = new VakifKatilimPosRequestValueFormatter()
  })

  it('supports only VakifKatilimPos', () => {
    expect(VakifKatilimPosRequestValueFormatter.supports('VakifKatilimPos')).toBe(true)
    expect(VakifKatilimPosRequestValueFormatter.supports('AssecoPos')).toBe(false)
    expect(VakifKatilimPosRequestValueFormatter.supports('KuveytPos')).toBe(false)
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

  // deviation: B13 (explicit +03:00 instants)
  it.each(['StartDate', 'EndDate'])('formatDateTime(%s) is the Türkiye calendar day', (fieldName) => {
    expect(formatter.formatDateTime(new Date('2024-04-14T16:45:30+03:00'), fieldName)).toBe('2024-04-14')
  })

  // addition: B13 (Türkiye day whatever the instant's own offset)
  it('formatDateTime moves a late UTC instant to the next Türkiye day', () => {
    expect(formatter.formatDateTime(new Date('2024-04-14T22:30:00Z'), 'StartDate')).toBe('2024-04-15')
    expect(formatter.formatDateTime(new Date('2024-04-14T20:59:59Z'), 'EndDate')).toBe('2024-04-14')
  })

  // deviation: B14 (error class)
  it.each(['abc', null, ''])('formatDateTime rejects the field %j', (fieldName) => {
    expect(() => formatter.formatDateTime(new Date('2024-04-14T16:45:30+03:00'), fieldName)).toThrow(PosError)
  })

  // addition: an invalid date never becomes "NaN-NaN-NaN"
  it('formatDateTime rejects an invalid date', () => {
    expect(() => formatter.formatDateTime(new Date('x'), 'StartDate')).toThrow(PosError)
  })
})
