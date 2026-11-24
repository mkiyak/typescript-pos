import { beforeEach, describe, expect, it } from 'vitest'
import { PayForPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/PayForPosRequestValueFormatter.js'
import { PosError } from '../../../../../src/errors.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'

describe('PayForPosRequestValueFormatter', () => {
  let formatter: PayForPosRequestValueFormatter
  const card = CreditCardFactory.create('5555444433332222', '24', '04', '123')

  beforeEach(() => {
    formatter = new PayForPosRequestValueFormatter()
  })

  it('supports only PayForPos', () => {
    expect(PayForPosRequestValueFormatter.supports('PayForPos')).toBe(true)
    expect(PayForPosRequestValueFormatter.supports('AssecoPos')).toBe(false)
  })

  it.each([
    [0, '0'],
    [1, '0'],
    [2, '2'],
  ])('formatInstallment(%s) = %s', (installment, expected) => {
    expect(formatter.formatInstallment(installment)).toBe(expected)
  })

  it.each([
    [1.1, '1.1'],
    [1.0, '1'],
  ])('formatAmount(%s) = %s', (amount, expected) => {
    expect(formatter.formatAmount(amount)).toBe(expected)
  })

  // deviation: F28/F3 (the formatter takes the card, not a date)
  it.each(['', 'abc'])('formatCardExpDate with field "%s"', (fieldName) => {
    expect(formatter.formatCardExpDate(card, fieldName)).toBe('0424')
  })

  it('formatDateTime', () => {
    // deviation: F22 (an explicit +03:00 instant)
    expect(formatter.formatDateTime(new Date('2024-04-14T16:45:30.000+03:00'))).toBe('20240414')
  })

  // addition: sub-kurus amounts are rounded like number_format, two-decimal amounts are kept as PHP prints them
  it.each([
    [1.005, '1.01'],
    [0.285, '0.29'],
    [10.1, '10.1'],
    [10.1, '10.1'],
    [100, '100'],
    [100.01, '100.01'],
    [0.1, '0.1'],
    [1000000.5, '1000000.5'],
  ])('formatAmount(%s) = %s (two decimals, zeros stripped)', (amount, expected) => {
    expect(formatter.formatAmount(amount)).toBe(expected)
  })

  // addition: no scientific notation, no NaN text
  it.each([1e13, Number.NaN, Number.POSITIVE_INFINITY])('formatAmount(%s) throws', (amount) => {
    expect(() => formatter.formatAmount(amount)).toThrow(PosError)
  })

  // addition: the request date is the Turkish calendar day, whatever the server time zone
  it('formatDateTime uses the Turkish calendar day', () => {
    expect(formatter.formatDateTime(new Date('2022-05-17T21:30:00Z'))).toBe('20220518')
    expect(formatter.formatDateTime(new Date('2022-05-17T20:59:59Z'))).toBe('20220517')
  })

  it('formatDateTime rejects an invalid date', () => {
    expect(() => formatter.formatDateTime(new Date('nope'))).toThrow(PosError)
  })
})
