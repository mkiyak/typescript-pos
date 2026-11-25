import { describe, expect, it } from 'vitest'
import { IyzicoPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/IyzicoPosResponseValueMapper.js'
import {
  CARD_CLASS,
  CARD_FAMILY,
  CARD_TYPE,
  CURRENCY,
  MODEL,
  PAYMENT_STATUS,
  TX_TYPE,
} from '../../../../../src/PosInterface.js'

describe('IyzicoPosResponseValueMapper', () => {
  const mapper = new IyzicoPosResponseValueMapper()

  it('supports', () => {
    expect(IyzicoPosResponseValueMapper.supports('IyzicoPos')).toBe(true)
    expect(IyzicoPosResponseValueMapper.supports('AkbankPos')).toBe(false)
  })

  it.each([
    ['AUTH', TX_TYPE.PAY_AUTH],
    ['PRE_AUTH', TX_TYPE.PAY_PRE_AUTH],
    ['POST_AUTH', TX_TYPE.PAY_POST_AUTH],
    ['CANCEL', TX_TYPE.CANCEL],
    ['PAYMENT', TX_TYPE.PAY_AUTH],
    ['REFUND', TX_TYPE.REFUND],
    ['UNKNOWN', null],
    // addition: inherited names are not transaction types
    ['constructor', null],
  ])('mapTxType(%j) -> %j', (raw, expected) => {
    expect(mapper.mapTxType(raw)).toBe(expected)
  })

  it.each([
    ['SUCCESS', TX_TYPE.STATUS, 'SUCCESS'],
    ['CANCELED', TX_TYPE.ORDER_HISTORY, PAYMENT_STATUS.CANCELED],
    ['REFUNDED', TX_TYPE.ORDER_HISTORY, PAYMENT_STATUS.FULLY_REFUNDED],
    ['PARTIALLY_REFUNDED', TX_TYPE.ORDER_HISTORY, PAYMENT_STATUS.PARTIALLY_REFUNDED],
    ['TOTALLY_REFUNDED', TX_TYPE.ORDER_HISTORY, 'TOTALLY_REFUNDED'],
    ['anything', null, 'anything'],
    // addition: inherited names pass through
    ['constructor', TX_TYPE.ORDER_HISTORY, 'constructor'],
  ])('mapOrderStatus(%j, %j) -> %j', (status, tx, expected) => {
    expect(mapper.mapOrderStatus(status, tx)).toBe(expected)
  })

  it.each([
    [null, MODEL.NON_SECURE],
    [0, MODEL.NON_SECURE],
    [1, MODEL.THREE_D_SECURE],
    [99, null],
    // addition: booleans
    [false, MODEL.NON_SECURE],
    [true, MODEL.THREE_D_SECURE],
  ])('mapSecureType(%j) -> %j', (raw, expected) => {
    expect(mapper.mapSecureType(raw)).toBe(expected)
  })

  it.each([
    ['TRY', CURRENCY.TRY],
    ['USD', CURRENCY.USD],
    ['EUR', CURRENCY.EUR],
    ['GBP', CURRENCY.GBP],
    ['JPY', CURRENCY.JPY],
    ['RUB', CURRENCY.RUB],
    ['XYZ', null],
  ])('mapCurrency(%j) -> %j', (raw, expected) => {
    expect(mapper.mapCurrency(raw)).toBe(expected)
  })

  it.each([
    [null, null],
    ['MASTER_CARD', CARD_TYPE.MASTERCARD],
    ['VISA', CARD_TYPE.VISA],
    ['TROY', CARD_TYPE.TROY],
    ['AMERICAN_EXPRESS', CARD_TYPE.AMEX],
    ['UNKNOWN', null],
  ])('mapCardType(%j) -> %j', (raw, expected) => {
    expect(mapper.mapCardType(raw)).toBe(expected)
  })

  it.each([
    [null, null],
    ['Paraf', CARD_FAMILY.PARAF],
    ['Axess', CARD_FAMILY.AXESS],
    ['Bonus', CARD_FAMILY.BONUS],
    ['World', CARD_FAMILY.WORLD],
    ['Maximum', CARD_FAMILY.MAXIMUM],
    ['CardFinans', CARD_FAMILY.CARDFINANS],
    ['Advantage', CARD_FAMILY.ADVANTAGE],
    ['unknown', 'unknown'],
  ])('mapCardFamilyName(%j) -> %j', (raw, expected) => {
    expect(mapper.mapCardFamilyName(raw)).toBe(expected)
  })

  it.each([
    [null, null],
    ['CREDIT_CARD', CARD_CLASS.CREDIT],
    ['DEBIT_CARD', CARD_CLASS.DEBIT],
    ['PREPAID_CARD', CARD_CLASS.PREPAID],
    ['UNKNOWN', null],
  ])('mapCardClass(%j) -> %j', (raw, expected) => {
    expect(mapper.mapCardClass(raw)).toBe(expected)
  })
})
