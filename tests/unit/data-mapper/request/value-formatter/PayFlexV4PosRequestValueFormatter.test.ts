import { beforeEach, describe, expect, it } from 'vitest'
import { PayFlexV4PosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/PayFlexV4PosRequestValueFormatter.js'
import { PosError } from '../../../../../src/errors.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'

describe('PayFlexV4PosRequestValueFormatter', () => {
  let formatter: PayFlexV4PosRequestValueFormatter
  // 2024-04-14T16:45:30.000 -> April 2024
  const card = CreditCardFactory.create('5555444433332222', '24', '04', '123', 'ahmet')

  beforeEach(() => {
    formatter = new PayFlexV4PosRequestValueFormatter()
  })

  it('supports only PayFlexV4Pos', () => {
    expect(PayFlexV4PosRequestValueFormatter.supports('PayFlexV4Pos')).toBe(true)
    expect(PayFlexV4PosRequestValueFormatter.supports('AssecoPos')).toBe(false)
  })

  it.each([
    [0, '0'],
    [1, '0'],
    [2, '2'],
  ])('formatInstallment(%d) = %j', (installment, expected) => {
    expect(formatter.formatInstallment(installment)).toBe(expected)
  })

  // Expected values verified with `php -r 'echo number_format(<literal>, 2, ".", "");'`.
  it.each([
    [1, '1.00'],
    [1.1, '1.10'],
    [10, '10.00'],
    [10.5, '10.50'],
    [0.1, '0.10'],
    [1.005, '1.01'],
    [1000.01, '1000.01'],
    [100.25, '100.25'],
    [0.285, '0.29'],
    [2.675, '2.68'],
    [1.455, '1.46'],
    [0.125, '0.13'],
    [99999999.995, '100000000.00'],
    [1.0049999, '1.00'],
    [0, '0.00'],
  ])('formatAmount(%d) = %j', (amount, expected) => {
    expect(formatter.formatAmount(amount)).toBe(expected)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1e15])('formatAmount rejects %d', (amount) => {
    expect(() => formatter.formatAmount(amount)).toThrow(PosError)
  })

  it.each(['abc', ''])('formatCardExpDate rejects unsupported field %j', (field) => {
    expect(() => formatter.formatCardExpDate(card, field)).toThrow(PosError)
  })

  it.each([
    ['ExpiryDate', '2404'],
    ['Expiry', '202404'],
  ])('formatCardExpDate(%s) = %s', (field, expected) => {
    expect(formatter.formatCardExpDate(card, field)).toBe(expected)
  })

  it('formatDateTime', () => {
    expect(formatter.formatDateTime(new Date('2024-04-14T13:45:30.000Z'))).toBe('20240414')
  })

  it('formatDateTime uses the Istanbul calendar day', () => {
    expect(formatter.formatDateTime(new Date('2024-04-14T22:30:00.000Z'))).toBe('20240415')
  })

  it('formatDateTime rejects an invalid date', () => {
    expect(() => formatter.formatDateTime(new Date(Number.NaN))).toThrow(PosError)
  })
})
