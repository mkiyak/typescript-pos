import { beforeEach, describe, expect, it } from 'vitest'
import { ParamPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/ParamPosRequestValueFormatter.js'
import { PosError } from '../../../../../src/errors.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import { TX_TYPE } from '../../../../../src/PosInterface.js'

describe('ParamPosRequestValueFormatter', () => {
  let formatter: ParamPosRequestValueFormatter
  const card = CreditCardFactory.create('5555444433332222', '24', '04', '123')

  beforeEach(() => {
    formatter = new ParamPosRequestValueFormatter()
  })

  it('supports ParamPos and Param3DHostPos', () => {
    expect(ParamPosRequestValueFormatter.supports('ParamPos')).toBe(true)
    expect(ParamPosRequestValueFormatter.supports('Param3DHostPos')).toBe(true)
    expect(ParamPosRequestValueFormatter.supports('AssecoPos')).toBe(false)
  })

  it.each([
    [0, '1'],
    [1, '1'],
    [2, '2'],
  ])('formatInstallment(%s) = %s', (installment, expected) => {
    expect(formatter.formatInstallment(installment)).toBe(expected)
  })

  it.each([
    [1.0, TX_TYPE.PAY_AUTH, '1,00'],
    [1000.0, TX_TYPE.PAY_AUTH, '1000,00'],
    [1.0, TX_TYPE.CANCEL, '1.00'],
    [1000.0, TX_TYPE.CANCEL, '1000.00'],
    [1.0, TX_TYPE.REFUND, '1.00'],
    [1000.0, TX_TYPE.REFUND, '1000.00'],
    [1.0, TX_TYPE.REFUND_PARTIAL, '1.00'],
    [1000.0, TX_TYPE.REFUND_PARTIAL, '1000.00'],
  ])('formatAmount(%s, %s) = %s', (amount, txType, expected) => {
    expect(formatter.formatAmount(amount, txType)).toBe(expected)
  })

  // addition: P1 (exact kuruş text, no float drift)
  it.each([
    [1.15, TX_TYPE.PAY_AUTH, '1,15'],
    [1.15, TX_TYPE.PAY_PRE_AUTH, '1,15'],
    [1.15, TX_TYPE.PAY_POST_AUTH, '1,15'],
    [1.15, TX_TYPE.CANCEL, '1.15'],
    [1.15, TX_TYPE.REFUND, '1.15'],
    [1000.25, TX_TYPE.PAY_AUTH, '1000,25'],
    [8.2, TX_TYPE.PAY_AUTH, '8,20'],
    [0.285, TX_TYPE.REFUND_PARTIAL, '0.29'],
    [1.0049999, TX_TYPE.PAY_AUTH, '1,00'],
    [9999999999999, TX_TYPE.PAY_AUTH, '9999999999999,00'],
  ])('formatAmount(%s, %s) = %s exactly', (amount, txType, expected) => {
    expect(formatter.formatAmount(amount, txType)).toBe(expected)
  })

  // addition: P1 (a bank request never carries these)
  it.each([0, -1, 0.004, 0.0049, Number.NaN, Number.POSITIVE_INFINITY, 1e13, 1e20])(
    'formatAmount refuses %s',
    (amount) => {
      expect(() => formatter.formatAmount(amount, TX_TYPE.PAY_AUTH)).toThrow(PosError)
      expect(() => formatter.formatAmount(amount, TX_TYPE.REFUND)).toThrow(PosError)
    },
  )

  // deviation: the formatter takes the card (the expiry stays inside the card object)
  it.each([
    ['KK_SK_Yil', '2024'],
    ['KK_SK_Ay', '04'],
  ])('formatCardExpDate(card, %s) = %s', (fieldName, expected) => {
    expect(formatter.formatCardExpDate(card, fieldName)).toBe(expected)
  })

  it.each(['abc', '', 'kk_sk_ay', 'constructor'])('rejects the unsupported card field %j', (fieldName) => {
    expect(() => formatter.formatCardExpDate(card, fieldName)).toThrow(PosError)
  })

  // deviation: the bank wall clock is Türkiye time, whatever the server zone is
  it('formatDateTime renders Türkiye time', () => {
    expect(formatter.formatDateTime(new Date('2024-04-14T16:45:30+03:00'))).toBe('14.04.2024 16:45:30')
    expect(formatter.formatDateTime(new Date('2024-04-14T13:45:30Z'))).toBe('14.04.2024 16:45:30')
    expect(formatter.formatDateTime(new Date('2024-12-31T22:00:00Z'))).toBe('01.01.2025 01:00:00')
  })

  // addition: an invalid date never becomes "NaN.NaN.NaN"
  it('formatDateTime refuses an invalid date', () => {
    expect(() => formatter.formatDateTime(new Date(Number.NaN))).toThrow(PosError)
    expect(() => formatter.formatDateTime('2024-01-01' as never)).toThrow(PosError)
  })
})
