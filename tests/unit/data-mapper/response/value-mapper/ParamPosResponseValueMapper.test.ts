import { describe, expect, it } from 'vitest'
import { ParamPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/ParamPosResponseValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import {
  CARD_CLASS,
  CARD_FAMILY,
  CARD_TYPE,
  CURRENCY,
  MODEL,
  PAYMENT_STATUS,
  TX_TYPE,
} from '../../../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../../../src/pos-query/PosQueryInterface.js'

describe('ParamPosResponseValueMapper', () => {
  const mapper = new ParamPosResponseValueMapper()

  it('supports', () => {
    expect(ParamPosResponseValueMapper.supports('ParamPos')).toBe(true)
    expect(ParamPosResponseValueMapper.supports('Param3DHostPos')).toBe(true)
    expect(ParamPosResponseValueMapper.supports('AssecoPos')).toBe(false)
  })

  // deviation: C8 NotImplementedError instead of a LogicException
  it('mapTxType of an unknown word is not supported', () => {
    expect(() => mapper.mapTxType('Auth')).toThrow(NotImplementedError)
  })

  // addition: the status words and the history words both map, the first table wins
  it.each([
    ['SALE', TX_TYPE.PAY_AUTH],
    ['PRE_AUTH', TX_TYPE.PAY_PRE_AUTH],
    ['POST_AUTH', TX_TYPE.PAY_POST_AUTH],
    ['Satış', TX_TYPE.PAY_AUTH],
    ['İptal', TX_TYPE.CANCEL],
    ['İade', TX_TYPE.REFUND],
  ])('mapTxType(%j) = %j', (input, expected) => {
    expect(mapper.mapTxType(input)).toBe(expected)
  })

  // addition: inherited members and other kinds never map
  it.each(['constructor', '__proto__', 'toString'])('mapTxType(%j) does not read inherited members', (input) => {
    expect(() => mapper.mapTxType(input)).toThrow(NotImplementedError)
  })

  it.each([
    [null, null],
    ['World', CARD_FAMILY.WORLD],
    ['Axess', CARD_FAMILY.AXESS],
    ['Bonus', CARD_FAMILY.BONUS],
    ['Maximum', CARD_FAMILY.MAXIMUM],
    ['Paraf', CARD_FAMILY.PARAF],
    ['Diğer Banka Kartları', 'Diğer Banka Kartları'],
    ['Ziraat', 'Ziraat'],
  ])('mapCardFamilyName(%j) = %j', (input, expected) => {
    expect(mapper.mapCardFamilyName(input)).toBe(expected)
  })

  it.each([
    ['SUCCESS', PAYMENT_STATUS.PAYMENT_COMPLETED],
    ['FAIL', PAYMENT_STATUS.ERROR],
    ['BANK_FAIL', PAYMENT_STATUS.ERROR],
    ['CANCEL', PAYMENT_STATUS.CANCELED],
    ['REFUND', PAYMENT_STATUS.FULLY_REFUNDED],
    ['PARTIAL_REFUND', PAYMENT_STATUS.PARTIALLY_REFUNDED],
    ['blabla', 'blabla'],
    ['blabla', 'blabla'],
  ])('mapOrderStatus(%j) = %j', (input, expected) => {
    expect(mapper.mapOrderStatus(input)).toBe(expected)
  })

  it.each([
    ['TL', TX_TYPE.PAY_AUTH, CURRENCY.TRY],
    ['TL', '', CURRENCY.TRY],
    ['TRL', '', CURRENCY.TRY],
    ['EUR', '', CURRENCY.EUR],
    ['USD', '', CURRENCY.USD],
    ['949', '', null],
  ])('mapCurrency(%j, %j) = %j', (currency, txType, expected) => {
    expect(mapper.mapCurrency(currency, txType as never)).toBe(expected)
  })

  it.each([
    ['3D', QUERY_TYPE.HISTORY, MODEL.THREE_D_SECURE],
    ['NONSECURE', QUERY_TYPE.HISTORY, MODEL.NON_SECURE],
    ['abc', QUERY_TYPE.HISTORY, null],
    ['3D', TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE],
    ['3D', TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_SECURE],
  ])('mapSecureType(%j, %j) = %j', (secureType, txType, expected) => {
    expect(mapper.mapSecureType(secureType, txType as never)).toBe(expected)
  })

  it.each([
    [null, null],
    ['VISA', CARD_TYPE.VISA],
    ['MASTER', CARD_TYPE.MASTERCARD],
    ['AMEX', CARD_TYPE.AMEX],
    ['TROY', CARD_TYPE.TROY],
    ['UNKNOWN', null],
  ])('mapCardType(%j) = %j', (input, expected) => {
    expect(mapper.mapCardType(input)).toBe(expected)
  })

  it.each([
    [null, null],
    ['Kredi Kartı', CARD_CLASS.CREDIT],
    ['Debit Kart', CARD_CLASS.DEBIT],
    ['Ön Ödemeli Kart', CARD_CLASS.PREPAID],
    ['unknown', null],
  ])('mapCardClass(%j) = %j', (input, expected) => {
    expect(mapper.mapCardClass(input)).toBe(expected)
  })

  // addition: inherited members never map to a card type or class
  it.each(['constructor', 'toString'])('card tables ignore inherited member %j', (input) => {
    expect(mapper.mapCardType(input)).toBeNull()
    expect(mapper.mapCardClass(input)).toBeNull()
  })
})
