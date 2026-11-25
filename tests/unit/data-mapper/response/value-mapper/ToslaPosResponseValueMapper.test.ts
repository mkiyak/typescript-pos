import { describe, expect, it } from 'vitest'
import { ToslaPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/ToslaPosResponseValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import {
  CARD_CLASS,
  CARD_FAMILY,
  CARD_TYPE,
  CURRENCY,
  PAYMENT_STATUS,
  TX_TYPE,
} from '../../../../../src/PosInterface.js'

describe('ToslaPosResponseValueMapper', () => {
  const mapper = new ToslaPosResponseValueMapper()

  it('supports', () => {
    expect(ToslaPosResponseValueMapper.supports('ToslaPos')).toBe(true)
    expect(ToslaPosResponseValueMapper.supports('AssecoPos')).toBe(false)
  })

  it.each([
    ['1', TX_TYPE.PAY_AUTH],
    ['2', TX_TYPE.PAY_PRE_AUTH],
    ['3', TX_TYPE.PAY_POST_AUTH],
    ['4', TX_TYPE.CANCEL],
    ['5', TX_TYPE.REFUND],
    [0, null],
    ['', null],
  ])('mapTxType(%j) -> %j', (txType, expected) => {
    expect(mapper.mapTxType(txType)).toBe(expected)
  })

  // addition: numbers the bank sends unquoted read like their text; unknown codes are null
  it.each([
    [1, TX_TYPE.PAY_AUTH],
    [5, TX_TYPE.REFUND],
    [6, null],
    ['constructor', null],
  ])('mapTxType(%j) -> %j (number input and unknown values)', (txType, expected) => {
    expect(mapper.mapTxType(txType)).toBe(expected)
  })

  it.each([
    [0, PAYMENT_STATUS.ERROR],
    [1, PAYMENT_STATUS.PAYMENT_COMPLETED],
    [2, PAYMENT_STATUS.CANCELED],
    [3, PAYMENT_STATUS.PARTIALLY_REFUNDED],
    [4, PAYMENT_STATUS.FULLY_REFUNDED],
    ['blabla', 'blabla'],
  ])('mapOrderStatus(%j) -> %j', (orderStatus, expected) => {
    expect(mapper.mapOrderStatus(orderStatus)).toBe(expected)
  })

  // addition: the pre-authorisation status is in the table although the ported cases never exercise it
  it('mapOrderStatus(5) is a completed pre-authorisation', () => {
    expect(mapper.mapOrderStatus(5)).toBe(PAYMENT_STATUS.PRE_AUTH_COMPLETED)
  })

  it.each([
    ['949', TX_TYPE.PAY_AUTH, CURRENCY.TRY],
    ['949', '', CURRENCY.TRY],
    ['840', '', CURRENCY.USD],
    ['978', '', CURRENCY.EUR],
    ['826', '', CURRENCY.GBP],
    ['392', '', CURRENCY.JPY],
    ['643', '', CURRENCY.RUB],
    ['TRY', '', null],
  ])('mapCurrency(%j, %j) -> %j', (currency, txType, expected) => {
    expect(mapper.mapCurrency(currency, txType as never)).toBe(expected)
  })

  // deviation: T19 NotImplementedError instead of a plain logic exception
  it('mapSecureType is not supported', () => {
    expect(() => mapper.mapSecureType('3D', TX_TYPE.PAY_AUTH)).toThrow(NotImplementedError)
  })

  it.each([
    [null, null],
    ['visa', CARD_TYPE.VISA],
    ['mastercard', CARD_TYPE.MASTERCARD],
    ['master card', CARD_TYPE.MASTERCARD],
    ['amex', CARD_TYPE.AMEX],
    ['americanexpress', CARD_TYPE.AMEX],
    ['american express', CARD_TYPE.AMEX],
    ['troy', CARD_TYPE.TROY],
    ['unknown', null],
  ])('mapCardType(%j) -> %j', (input, expected) => {
    expect(mapper.mapCardType(input)).toBe(expected)
  })

  // addition: names are compared lower-cased and never through inherited members
  it.each([
    ['VISA', CARD_TYPE.VISA],
    ['Master Card', CARD_TYPE.MASTERCARD],
    ['constructor', null],
    ['', null],
  ])('mapCardType(%j) -> %j (case and odd input)', (input, expected) => {
    expect(mapper.mapCardType(input)).toBe(expected)
  })

  it.each([
    [null, null],
    ['Card Finans', CARD_FAMILY.CARDFINANS],
    ['Paraf', 'Paraf'],
    ['unknown', 'unknown'],
  ])('mapCardFamilyName(%j) -> %j', (input, expected) => {
    expect(mapper.mapCardFamilyName(input)).toBe(expected)
  })

  it.each([
    [null, null],
    ['Kredi Kartı', CARD_CLASS.CREDIT],
    ['Banka Kartı', CARD_CLASS.DEBIT],
    ['Ön Ödemeli Kart', CARD_CLASS.PREPAID],
    ['Bilinmeyen', null],
  ])('mapCardClass(%j) -> %j', (input, expected) => {
    expect(mapper.mapCardClass(input)).toBe(expected)
  })
})
