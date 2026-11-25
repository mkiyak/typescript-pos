import { beforeEach, describe, expect, it } from 'vitest'
import { IyzicoPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/IyzicoPosRequestValueFormatter.js'
import { PosError } from '../../../../../src/errors.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'

describe('IyzicoPosRequestValueFormatter', () => {
  let formatter: IyzicoPosRequestValueFormatter

  beforeEach(() => {
    formatter = new IyzicoPosRequestValueFormatter()
  })

  it('supports only IyzicoPos', () => {
    expect(IyzicoPosRequestValueFormatter.supports('IyzicoPos')).toBe(true)
    expect(IyzicoPosRequestValueFormatter.supports('AkbankPos')).toBe(false)
  })

  it.each([
    [0, 1],
    [1, 1],
    [2, 2],
    [12, 12],
  ])('formatInstallment(%s) = %s', (installment, expected) => {
    expect(formatter.formatInstallment(installment)).toBe(expected)
  })

  it.each([
    [1, 1],
    [100.25, 100.25],
    [0, 0],
    // addition: R2 half up on the second decimal
    [10.005, 10.01],
  ])('formatAmount(%s) = %s', (amount, expected) => {
    expect(formatter.formatAmount(amount)).toBe(expected)
  })

  it.each([
    ['NaN', Number.NaN],
    ['negative', -1],
    ['1e13', 1e13],
    ['below one kurus', 0.004],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('addition: R2 formatAmount refuses %s', (_name, amount) => {
    expect(() => formatter.formatAmount(amount)).toThrow(PosError)
  })

  it.each([
    ['expireMonth', '04'],
    ['expireYear', '2024'],
  ])('formatCardExpDate(%s) = %s', (field, expected) => {
    // deviation: the formatter takes the card, not a date
    const card = CreditCardFactory.create('4603450000000000', '24', '04', '000', 'John Doe')
    expect(formatter.formatCardExpDate(card, field)).toBe(expected)
  })

  it('formatCardExpDate refuses an unsupported field', () => {
    const card = CreditCardFactory.create('4603450000000000', '24', '04', '000', 'John Doe')
    expect(() => formatter.formatCardExpDate(card, 'unsupportedField')).toThrow(PosError)
  })

  it('formatDateTime gives the day', () => {
    // deviation: R2 the day is read in Türkiye time, not in the server zone
    expect(formatter.formatDateTime(new Date('2024-06-15T00:00:00+03:00'), 'someField')).toBe('2024-06-15')
  })

  it('addition: formatDateTime moves a late UTC evening to the next Türkiye day', () => {
    expect(formatter.formatDateTime(new Date('2024-06-14T21:30:00Z'))).toBe('2024-06-15')
  })

  it('addition: formatDateTime refuses an invalid date', () => {
    expect(() => formatter.formatDateTime(new Date('nope'))).toThrow(PosError)
  })
})
