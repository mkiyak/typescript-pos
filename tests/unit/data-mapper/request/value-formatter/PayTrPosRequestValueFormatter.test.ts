import { beforeEach, describe, expect, it } from 'vitest'
import { PayTrPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/PayTrPosRequestValueFormatter.js'
import { PosError } from '../../../../../src/errors.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import { TX_TYPE } from '../../../../../src/PosInterface.js'

describe('PayTrPosRequestValueFormatter', () => {
  let formatter: PayTrPosRequestValueFormatter

  beforeEach(() => {
    formatter = new PayTrPosRequestValueFormatter()
  })

  it('supports only PayTrPos', () => {
    expect(PayTrPosRequestValueFormatter.supports('PayTrPos')).toBe(true)
    expect(PayTrPosRequestValueFormatter.supports('AkbankPos')).toBe(false)
  })

  it.each([
    [0, 0],
    [1, 0],
    [2, 2],
    [12, 12],
  ])('formatInstallment(%s) = %s', (installment, expected) => {
    expect(formatter.formatInstallment(installment)).toBe(expected)
  })

  it.each([
    [10.5, TX_TYPE.INTERNAL_3D_FORM_BUILD, 1050],
    [10.005, TX_TYPE.INTERNAL_3D_FORM_BUILD, 1001],
    [10.5, TX_TYPE.PAY_AUTH, '10.50'],
    [9.99, TX_TYPE.REFUND, '9.99'],
    [50, null, '50.00'],
    // addition: 1.15 keeps its last kuruş in both forms
    [1.15, TX_TYPE.INTERNAL_3D_FORM_BUILD, 115],
    [1.15, null, '1.15'],
  ])('formatAmount(%s, %s) = %s', (amount, txType, expected) => {
    expect(formatter.formatAmount(amount, txType)).toBe(expected)
  })

  // addition: an amount that is not a payable amount never becomes a request value, in either form
  it.each([0, -1, 0.004, Number.NaN, 1e13, Number.POSITIVE_INFINITY])('refuses the amount %s', (amount) => {
    expect(() => formatter.formatAmount(amount, TX_TYPE.INTERNAL_3D_FORM_BUILD)).toThrow(PosError)
    expect(() => formatter.formatAmount(amount)).toThrow(PosError)
  })

  // deviation: the formatter takes the card
  it('formats the card expiry', () => {
    const card = CreditCardFactory.create('4355084355084358', '30', '12', '000')
    expect(formatter.formatCardExpDate(card, 'expiry_month')).toBe('12')
    expect(formatter.formatCardExpDate(card, 'expiry_year')).toBe('30')
  })

  it('refuses an unknown card field', () => {
    const card = CreditCardFactory.create('4355084355084358', '30', '12', '000')
    expect(() => formatter.formatCardExpDate(card, 'invalid_field')).toThrow(
      new PosError('Unsupported field name "invalid_field"'),
    )
  })

  // deviation: Türkiye time (the server zone does not matter)
  it('formats a date time in Türkiye time', () => {
    expect(formatter.formatDateTime(new Date('2025-06-23T14:30:00+03:00'))).toBe('2025-06-23 14:30:00')
    expect(formatter.formatDateTime(new Date('2025-06-23T23:30:00Z'))).toBe('2025-06-24 02:30:00')
  })

  // addition
  it('refuses an invalid date', () => {
    expect(() => formatter.formatDateTime(new Date(Number.NaN))).toThrow(PosError)
  })
})
