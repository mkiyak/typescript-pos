import { beforeEach, describe, expect, it } from 'vitest'
import { PosNetV1PosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/PosNetV1PosRequestValueFormatter.js'
import { NotImplementedError, PosError } from '../../../../../src/errors.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'

// deviation: the formatter takes the card instead of a DateTime
const card = CreditCardFactory.create('5555444433332222', '24', '04', '123')

describe('PosNetV1PosRequestValueFormatter', () => {
  let formatter: PosNetV1PosRequestValueFormatter

  beforeEach(() => {
    formatter = new PosNetV1PosRequestValueFormatter()
  })

  it('supports only PosNetV1Pos', () => {
    expect(PosNetV1PosRequestValueFormatter.supports('PosNetV1Pos')).toBe(true)
    expect(PosNetV1PosRequestValueFormatter.supports('AssecoPos')).toBe(false)
    expect(PosNetV1PosRequestValueFormatter.supports('PosNetPos')).toBe(false)
  })

  it.each([
    [0, '0'],
    [1, '0'],
    [2, '2'],
  ])('formatInstallment(%d) = %s', (installment, expected) => {
    expect(formatter.formatInstallment(installment)).toBe(expected)
  })

  it.each([
    [1.1, 110],
    [1.0, 100],
  ])('formatAmount(%d) = %d', (amount, expected) => {
    expect(formatter.formatAmount(amount)).toBe(expected)
  })

  it.each<[string, TxType, PaymentModel, string]>([
    ['ABC123', TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, '00000000000000ABC123'],
    ['ABC123', TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, '00000000000000ABC123'],
    ['ABC123', TX_TYPE.STATUS, MODEL.THREE_D_SECURE, 'TDS_00000000000000ABC123'],
    ['ABC123', TX_TYPE.STATUS, MODEL.NON_SECURE, '000000000000000000ABC123'],
    ['ABC123', TX_TYPE.STATUS, MODEL.THREE_D_PAY, '000000000000000000ABC123'],
  ])('formatOrderId(%s, %s, %s) = %s', (orderId, txType, model, expected) => {
    expect(formatter.formatOrderId(orderId, txType, model)).toBe(expected)
  })

  it('formatOrderId rejects an id longer than the field', () => {
    // deviation: P28 (error class)
    expect(() => formatter.formatOrderId('1234567890123456789AB')).toThrow(PosError)
  })

  it.each(['Expiry', ''])('formatCardExpDate(%j) = 2404', (fieldName) => {
    expect(formatter.formatCardExpDate(card, fieldName)).toBe('2404')
  })

  it('formatDateTime is not implemented', () => {
    expect(() => formatter.formatDateTime(new Date())).toThrow(NotImplementedError)
  })

  // addition: exact kuruş and strict order ids
  it.each([
    [1.13, 113],
    [0.29, 29],
    [19.99, 1999],
    [1.005, 101],
    [0.285, 29],
    [1000, 100000],
  ])('formatAmount(%d) = %d (never truncated)', (amount, expected) => {
    expect(formatter.formatAmount(amount)).toBe(expected)
  })

  it.each([1e13, Number.NaN, Number.POSITIVE_INFINITY])('formatAmount(%d) throws', (amount) => {
    expect(() => formatter.formatAmount(amount)).toThrow(PosError)
  })

  it('formatOrderId pads a 3D lookup id to 24 characters with the V1 prefix', () => {
    expect(formatter.formatOrderId('x'.repeat(20), TX_TYPE.CANCEL, MODEL.THREE_D_SECURE)).toBe(`TDS_${'x'.repeat(20)}`)
    expect(formatter.formatOrderId('x'.repeat(20), TX_TYPE.REFUND, MODEL.NON_SECURE)).toBe(`0000${'x'.repeat(20)}`)
  })

  it.each([
    ['', null],
    ['x'.repeat(21), TX_TYPE.STATUS],
    ['a\n', null],
    ['a\u0000', TX_TYPE.STATUS],
    ['\ud800', null],
  ])('formatOrderId(%j) is rejected', (orderId, txType) => {
    expect(() => formatter.formatOrderId(orderId, txType, MODEL.THREE_D_SECURE)).toThrow(PosError)
  })

  // addition: lookups and callbacks read an existing id (the mappers hold new payments to the shared rule)
  it.each([['x'.repeat(21)], [['a']], [true], [{}], [1.5], [-1], ['a\n']])(
    'formatOrderId(%j) is rejected with the existing-id message',
    (orderId) => {
      expect(() => formatter.formatOrderId(orderId as unknown as string)).toThrow(
        'Order field "id" must be text of 1-20 characters without control characters, or a non-negative whole number',
      )
    },
  )

  // addition: ids of orders created before the shared rule are still padded and sent
  it.each([
    ['_a', '000000000000000000_a'],
    ['-1', '000000000000000000-1'],
    ['ä1', '000000000000000000ä1'],
    ['a b', '00000000000000000a b'],
  ])('formatOrderId(%j) of an existing order = %j', (orderId, expected) => {
    expect(formatter.formatOrderId(orderId)).toBe(expected)
  })

  it('formatOrderId takes a safe integer number as its digits', () => {
    expect(formatter.formatOrderId(7 as unknown as string)).toBe('00000000000000000007')
  })
})
