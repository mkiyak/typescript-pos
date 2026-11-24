import { beforeEach, describe, expect, it } from 'vitest'
import { GarantiPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/GarantiPosRequestValueFormatter.js'
import { PosError } from '../../../../../src/errors.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import { TX_TYPE } from '../../../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../../../src/pos-query/PosQueryInterface.js'

// deviation: the formatter takes the card instead of a DateTime
const card = CreditCardFactory.create('5555444433332222', '24', '04', '123')

describe('GarantiPosRequestValueFormatter', () => {
  let formatter: GarantiPosRequestValueFormatter

  beforeEach(() => {
    formatter = new GarantiPosRequestValueFormatter()
  })

  it('supports only GarantiPos', () => {
    expect(GarantiPosRequestValueFormatter.supports('GarantiPos')).toBe(true)
    expect(GarantiPosRequestValueFormatter.supports('AssecoPos')).toBe(false)
  })

  it.each([
    [0, ''],
    [1, ''],
    [2, '2'],
  ])('formatInstallment(%s) = %j', (installment, expected) => {
    expect(formatter.formatInstallment(installment)).toBe(expected)
  })

  it.each([
    [1.1, 110],
    [1.0, 100],
  ])('formatAmount(%s) = %s', (amount, expected) => {
    expect(formatter.formatAmount(amount)).toBe(expected)
  })

  it.each(['abc', ''])('formatCardExpDate rejects the field %j', (fieldName) => {
    // deviation: G16 (error class: PosError)
    expect(() => formatter.formatCardExpDate(card, fieldName)).toThrow(PosError)
  })

  it.each([
    ['cardexpiredatemonth', '04'],
    ['cardexpiredateyear', '24'],
    ['ExpireDate', '0424'],
  ])('formatCardExpDate(%s) = %s', (fieldName, expected) => {
    expect(formatter.formatCardExpDate(card, fieldName)).toBe(expected)
  })

  // deviation: G9 (the instant is Türkiye time, +03:00)
  const date = new Date('2024-04-14T16:45:30+03:00')

  it.each([
    ['StartDate', QUERY_TYPE.HISTORY, '14/04/2024 16:45'],
    ['StartDate', null, '20240414'],
    ['StartDate', TX_TYPE.PAY_AUTH, '20240414'],
    ['EndDate', null, '20240414'],
    [null, null, '20240414'],
  ])('formatDateTime(%s, %s) = %s', (fieldName, txType, expected) => {
    expect(formatter.formatDateTime(date, fieldName, txType)).toBe(expected)
  })

  describe('additions', () => {
    it.each([
      [0.29, 29],
      [0.57, 57],
      [4.35, 435],
      [19.99, 1999],
      [1.005, 101],
      [100.25, 10025],
      [0.01, 1],
    ])('addition: formatAmount(%s) = %s keeps every kuruş', (amount, expected) => {
      expect(formatter.formatAmount(amount)).toBe(expected)
    })

    it.each([1e13, Number.NaN, Number.POSITIVE_INFINITY])('addition: formatAmount(%s) is rejected', (amount) => {
      expect(() => formatter.formatAmount(amount)).toThrow(PosError)
    })

    it('addition: the date is the Türkiye calendar day', () => {
      expect(formatter.formatDateTime(new Date('2024-04-14T22:30:00Z'), 'StartDate', null)).toBe('20240415')
      expect(formatter.formatDateTime(new Date('2024-04-14T22:30:00Z'), 'StartDate', QUERY_TYPE.HISTORY)).toBe(
        '15/04/2024 01:30',
      )
    })

    it('addition: an invalid date is rejected', () => {
      expect(() => formatter.formatDateTime(new Date('x'))).toThrow(PosError)
    })
  })
})
