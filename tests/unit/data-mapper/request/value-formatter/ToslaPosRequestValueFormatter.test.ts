import { beforeEach, describe, expect, it } from 'vitest'
import { ToslaPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/ToslaPosRequestValueFormatter.js'
import { PosError } from '../../../../../src/errors.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'

describe('ToslaPosRequestValueFormatter', () => {
  let formatter: ToslaPosRequestValueFormatter
  const card = CreditCardFactory.create('5555444433332222', '24', '04', '123')

  beforeEach(() => {
    formatter = new ToslaPosRequestValueFormatter()
  })

  it('supports only ToslaPos', () => {
    expect(ToslaPosRequestValueFormatter.supports('ToslaPos')).toBe(true)
    expect(ToslaPosRequestValueFormatter.supports('AssecoPos')).toBe(false)
  })

  it.each([
    [0, 0],
    [1, 0],
    [2, 2],
  ])('formatInstallment(%s) = %s', (installment, expected) => {
    expect(formatter.formatInstallment(installment)).toBe(expected)
  })

  it.each([
    [1.1, 110],
    [1, 100],
  ])('formatAmount(%s) = %s', (amount, expected) => {
    expect(formatter.formatAmount(amount)).toBe(expected)
  })

  // addition: exact kurus where truncating multiplication loses one
  it.each([
    [1.15, 115],
    [100.25, 10025],
    [8.2, 820],
    [0.005, 1],
  ])('formatAmount(%s) = %s exactly', (amount, expected) => {
    expect(formatter.formatAmount(amount)).toBe(expected)
  })

  // addition: amounts that cannot be sent
  it.each([0, -1, 0.004, Number.NaN, Number.POSITIVE_INFINITY, 1e13])('formatAmount(%s) is refused', (amount) => {
    expect(() => formatter.formatAmount(amount)).toThrow(PosError)
  })

  // deviation: the formatter takes the card
  it.each([
    ['ExpireDate', '04/24'],
    ['expireDate', '0424'],
  ])('formatCardExpDate %s = %s', (fieldName, expected) => {
    expect(formatter.formatCardExpDate(card, fieldName)).toBe(expected)
  })

  it.each(['abc', ''])('formatCardExpDate rejects the field %j', (fieldName) => {
    expect(() => formatter.formatCardExpDate(card, fieldName)).toThrow(PosError)
  })

  // deviation: T14 (an explicit +03:00 instant; Turkiye time)
  it.each([
    ['timeSpan', '20240414164530'],
    ['transactionDate', '20240414'],
  ])('formatDateTime %s = %s', (fieldName, expected) => {
    expect(formatter.formatDateTime(new Date('2024-04-14T16:45:30+03:00'), fieldName)).toBe(expected)
  })

  it.each(['abc', null, ''])('formatDateTime rejects the field %j', (fieldName) => {
    expect(() => formatter.formatDateTime(new Date('2024-04-14T16:45:30+03:00'), fieldName)).toThrow(PosError)
  })

  // addition: Turkiye time regardless of the server zone; a late UTC evening is already the next day there
  it('formats the Turkiye day and time of a UTC instant', () => {
    const instant = new Date('2024-01-01T21:30:00Z')
    expect(formatter.formatDateTime(instant, 'timeSpan')).toBe('20240102003000')
    expect(formatter.formatDateTime(instant, 'transactionDate')).toBe('20240102')
  })

  // addition: invalid dates
  it.each([new Date(Number.NaN), '2024-04-14' as never, null as never])(
    'formatDateTime rejects the value %j',
    (value) => {
      expect(() => formatter.formatDateTime(value, 'timeSpan')).toThrow(PosError)
    },
  )

  // addition: a year that does not fit four digits would shift the fixed-width text
  it.each([new Date('+010000-01-01T00:00:00Z'), new Date('-000001-06-01T00:00:00Z')])(
    'formatDateTime rejects the year of %j',
    (value) => {
      expect(() => formatter.formatDateTime(value, 'timeSpan')).toThrow(PosError)
      expect(() => formatter.formatDateTime(value, 'transactionDate')).toThrow(PosError)
    },
  )
})
