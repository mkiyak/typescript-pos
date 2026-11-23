import { beforeEach, describe, expect, it } from 'vitest'
import { AssecoPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/AssecoPosRequestValueFormatter.js'
import { NotImplementedError, PosError } from '../../../../../src/errors.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'

describe('AssecoPosRequestValueFormatter', () => {
  let formatter: AssecoPosRequestValueFormatter
  // 2024-04-14T16:45:30.000 -> April 2024
  const card = CreditCardFactory.create('5555444433332222', '24', '04', '123', 'ahmet')

  beforeEach(() => {
    formatter = new AssecoPosRequestValueFormatter()
  })

  it('supports only AssecoPos', () => {
    expect(AssecoPosRequestValueFormatter.supports('AssecoPos')).toBe(true)
    expect(AssecoPosRequestValueFormatter.supports('AkbankPos')).toBe(false)
  })

  it.each([
    [0, ''],
    [1, ''],
    [2, '2'],
  ])('formatInstallment(%d) = %j', (installment, expected) => {
    expect(formatter.formatInstallment(installment)).toBe(expected)
  })

  // PHP (string) $float, precision=14. Expected values verified with `php -r 'echo (string) <literal>;'`.
  it.each([
    [1.1, '1.1'],
    [1.0, '1'],
    [10, '10'],
    [10.5, '10.5'],
    [0.1, '0.1'],
    [1.005, '1.005'],
    [1000.01, '1000.01'],
    [100.25, '100.25'],
    [0.1 + 0.2, '0.3'],
    [0, '0'],
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
    ['Ecom_Payment_Card_ExpDate_Month', '04'],
    ['Ecom_Payment_Card_ExpDate_Year', '24'],
    ['Expires', '04/24'],
  ])('formatCardExpDate(%s) = %s', (field, expected) => {
    expect(formatter.formatCardExpDate(card, field)).toBe(expected)
  })

  it('formatDateTime is not implemented', () => {
    expect(() => formatter.formatDateTime(new Date())).toThrow(NotImplementedError)
  })
})
