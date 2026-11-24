import { beforeEach, describe, expect, it } from 'vitest'
import { PayFlexCPV4PosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/PayFlexCPV4PosRequestValueFormatter.js'
import { NotImplementedError, PosError } from '../../../../../src/errors.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import { CARD_TYPE } from '../../../../../src/PosInterface.js'

describe('PayFlexCPV4PosRequestValueFormatter', () => {
  let formatter: PayFlexCPV4PosRequestValueFormatter
  // expiry 2024-04
  const card = CreditCardFactory.create('5555444433332222', '2024', '04', '122', 'ahmet', CARD_TYPE.VISA)

  beforeEach(() => {
    formatter = new PayFlexCPV4PosRequestValueFormatter()
  })

  it('supports only PayFlexCPV4Pos', () => {
    expect(PayFlexCPV4PosRequestValueFormatter.supports('PayFlexCPV4Pos')).toBe(true)
    expect(PayFlexCPV4PosRequestValueFormatter.supports('AssecoPos')).toBe(false)
  })

  it.each([
    [0, '0'],
    [1, '0'],
    [2, '2'],
  ])('formatInstallment(%s) = %s', (installment, expected) => {
    expect(formatter.formatInstallment(installment)).toBe(expected)
  })

  it.each([
    [1, '1.00'],
    [1.1, '1.10'],
  ])('formatAmount(%s) = %s', (amount, expected) => {
    expect(formatter.formatAmount(amount)).toBe(expected)
  })

  it.each(['abc', ''])('formatCardExpDate rejects unsupported field %j', (field) => {
    expect(() => formatter.formatCardExpDate(card, field)).toThrow(PosError)
  })

  it.each([
    ['ExpireMonth', '04'],
    // deviation: R4 guide §4 four-digit year
    ['ExpireYear', '2024'],
    ['Expiry', '202404'],
  ])('formatCardExpDate(%s) = %s', (field, expected) => {
    expect(formatter.formatCardExpDate(card, field)).toBe(expected)
  })

  it('formatDateTime is not supported', () => {
    expect(() => formatter.formatDateTime(new Date('2024-04-14T16:45:30.000Z'))).toThrow(NotImplementedError)
  })
})
