import { beforeEach, describe, expect, it } from 'vitest'
import { InterPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/InterPosRequestValueFormatter.js'
import { NotImplementedError, PosError } from '../../../../../src/errors.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'

describe('InterPosRequestValueFormatter', () => {
  let formatter: InterPosRequestValueFormatter

  beforeEach(() => {
    formatter = new InterPosRequestValueFormatter()
  })

  it('supports only InterPos', () => {
    expect(InterPosRequestValueFormatter.supports('InterPos')).toBe(true)
    expect(InterPosRequestValueFormatter.supports('AssecoPos')).toBe(false)
  })

  it.each([
    [0, ''],
    [1, ''],
    [2, '2'],
  ])('formatInstallment(%s) = %j', (installment, expected) => {
    expect(formatter.formatInstallment(installment)).toBe(expected)
  })

  it.each([
    [1.1, '1.1'],
    [1.0, '1'],
  ])('formatAmount(%s) = %s', (amount, expected) => {
    expect(formatter.formatAmount(amount)).toBe(expected)
  })

  it.each(['', 'Expiry'])('formatCardExpDate(field %j) = 0424', (fieldName) => {
    // deviation: the formatter takes the card
    const card = CreditCardFactory.create('5555444433332222', '24', '04', '123')
    expect(formatter.formatCardExpDate(card, fieldName)).toBe('0424')
  })

  it('formatDateTime is not implemented', () => {
    expect(() => formatter.formatDateTime(new Date())).toThrow(NotImplementedError)
  })

  // addition: two decimals with trailing zeros dropped, sub-kurus rounded like number_format
  it.each([
    [1.005, '1.01'],
    [10.1, '10.1'],
    [100, '100'],
    [100.25, '100.25'],
    [123.1, '123.1'],
    [0.1, '0.1'],
  ])('formatAmount(%s) = %s (more rows)', (amount, expected) => {
    expect(formatter.formatAmount(amount)).toBe(expected)
  })

  it.each([1e13, Number.NaN, Number.POSITIVE_INFINITY])('formatAmount(%s) throws', (amount) => {
    expect(() => formatter.formatAmount(amount)).toThrow(PosError)
  })
})
