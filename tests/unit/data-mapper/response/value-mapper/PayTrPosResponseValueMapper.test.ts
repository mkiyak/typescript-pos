import { describe, expect, it } from 'vitest'
import { PayTrPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/PayTrPosResponseValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import { CARD_CLASS, CARD_FAMILY, CARD_TYPE, CURRENCY, TX_TYPE } from '../../../../../src/PosInterface.js'

describe('PayTrPosResponseValueMapper', () => {
  const mapper = new PayTrPosResponseValueMapper()

  it('supports', () => {
    expect(PayTrPosResponseValueMapper.supports('PayTrPos')).toBe(true)
    expect(PayTrPosResponseValueMapper.supports('AkbankPos')).toBe(false)
  })

  it.each([
    ['TL', CURRENCY.TRY],
    ['TRY', CURRENCY.TRY],
    ['USD', CURRENCY.USD],
    ['EUR', CURRENCY.EUR],
    ['GBP', CURRENCY.GBP],
    ['RUB', CURRENCY.RUB],
    ['JPY', null],
  ])('mapCurrency(%j) -> %j', (currency, expected) => {
    expect(mapper.mapCurrency(currency, TX_TYPE.STATUS)).toBe(expected)
  })

  it.each([
    ['S', TX_TYPE.PAY_AUTH],
    ['I', TX_TYPE.REFUND],
    ['unknown', null],
  ])('mapTxType(%j) -> %j', (raw, expected) => {
    expect(mapper.mapTxType(raw)).toBe(expected)
  })

  it('mapSecureType is not supported', () => {
    // deviation: C6 — the library error type replaces the PHP logic exception
    expect(() => mapper.mapSecureType('3D')).toThrow(NotImplementedError)
  })

  it('mapOrderStatus is not supported', () => {
    // deviation: C6 — the library error type replaces the PHP logic exception
    expect(() => mapper.mapOrderStatus('1')).toThrow(NotImplementedError)
  })

  it.each([
    [null, null],
    ['world', CARD_FAMILY.WORLD],
    ['axess', CARD_FAMILY.AXESS],
    ['cardfinans', CARD_FAMILY.CARDFINANS],
    ['paraf', CARD_FAMILY.PARAF],
    ['advantage', CARD_FAMILY.ADVANTAGE],
    ['bonus', CARD_FAMILY.BONUS],
    ['saglamkart', CARD_FAMILY.SAGLAMKART],
    ['unknown', 'unknown'],
  ])('mapCardFamilyName(%j) -> %j', (input, expected) => {
    expect(mapper.mapCardFamilyName(input)).toBe(expected)
  })

  it.each([
    [null, null],
    ['VISA', CARD_TYPE.VISA],
    ['MASTER', CARD_TYPE.MASTERCARD],
    ['MASTERCARD', CARD_TYPE.MASTERCARD],
    ['AMEX', CARD_TYPE.AMEX],
    ['TROY', CARD_TYPE.TROY],
    ['UNKNOWN', null],
  ])('mapCardType(%j) -> %j', (input, expected) => {
    expect(mapper.mapCardType(input)).toBe(expected)
  })

  it.each([
    [null, null],
    ['credit', CARD_CLASS.CREDIT],
    ['debit', CARD_CLASS.DEBIT],
    ['prepaid', CARD_CLASS.PREPAID],
    ['unknown', null],
  ])('mapCardClass(%j) -> %j', (input, expected) => {
    expect(mapper.mapCardClass(input)).toBe(expected)
  })

  // addition: names that are members of every object, other spellings and non-text values never map
  it.each([
    ['constructor', null],
    ['__proto__', null],
    ['AMERICAN EXPRESS', CARD_TYPE.AMEX],
    ['visa', null],
    [{ a: 1 }, null],
    [1, null],
  ])('mapCardType(%j) is strict', (input, expected) => {
    expect(mapper.mapCardType(input as never)).toBe(expected)
  })

  // addition: inherited member names are not currencies, card classes or families
  it('does not read inherited members', () => {
    expect(mapper.mapCurrency('constructor')).toBeNull()
    expect(mapper.mapCardClass('constructor')).toBeNull()
    expect(mapper.mapCardClass({ a: 1 } as never)).toBeNull()
    expect(mapper.mapCardFamilyName('constructor')).toBe('constructor')
    expect(mapper.mapCardFamilyName({ a: 1 } as never)).toBeNull()
    expect(mapper.mapTxType('constructor')).toBeNull()
  })
})
