import { describe, expect, it } from 'vitest'
import { GarantiPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/GarantiPosResponseValueMapper.js'
import {
  CARD_CLASS,
  CARD_TYPE,
  CURRENCY,
  MODEL,
  PAYMENT_STATUS,
  TX_TYPE,
  type TxType,
} from '../../../../../src/PosInterface.js'
import { QUERY_TYPE, type QueryType } from '../../../../../src/pos-query/PosQueryInterface.js'

describe('GarantiPosResponseValueMapper', () => {
  const mapper = new GarantiPosResponseValueMapper()

  it('supports', () => {
    expect(GarantiPosResponseValueMapper.supports('GarantiPos')).toBe(true)
    expect(GarantiPosResponseValueMapper.supports('AssecoPos')).toBe(false)
  })

  it.each([
    ['Satis', TX_TYPE.PAY_AUTH],
    ['sales', TX_TYPE.PAY_AUTH],
    ['On Otorizasyon', TX_TYPE.PAY_PRE_AUTH],
    ['On Otorizasyon Kapama', TX_TYPE.PAY_POST_AUTH],
    ['Iade', TX_TYPE.REFUND],
    ['refund', TX_TYPE.REFUND],
    ['Iptal', TX_TYPE.CANCEL],
    ['void', TX_TYPE.CANCEL],
    ['', null],
  ])('mapTxType(%j) -> %j', (txType, expected) => {
    expect(mapper.mapTxType(txType)).toBe(expected)
  })

  // addition: a query type is not a transaction type, so it never maps back (response table has no history/bin_list)
  it.each([
    ['orderlistinq', null],
    ['bininq', null],
    ['preauth', TX_TYPE.PAY_PRE_AUTH],
    ['postauth', TX_TYPE.PAY_POST_AUTH],
    ['orderhistoryinq', TX_TYPE.ORDER_HISTORY],
    ['orderinq', TX_TYPE.STATUS],
    ['constructor', null],
    ['toString', null],
  ])('mapTxType(%j) -> %j (addition)', (txType, expected) => {
    expect(mapper.mapTxType(txType)).toBe(expected)
  })

  it.each([
    ['WAITINGPOSTAUTH', TX_TYPE.STATUS, null, PAYMENT_STATUS.PRE_AUTH_COMPLETED],
    ['APPROVED', TX_TYPE.STATUS, null, 'APPROVED'],
    ['blabla', TX_TYPE.STATUS, null, 'blabla'],

    ['Basarili', QUERY_TYPE.HISTORY, null, 'Basarili'],
    ['blabla', QUERY_TYPE.HISTORY, null, 'blabla'],

    ['Basarili', QUERY_TYPE.HISTORY, TX_TYPE.CANCEL, PAYMENT_STATUS.CANCELED],
    ['Onaylandi', QUERY_TYPE.HISTORY, TX_TYPE.CANCEL, PAYMENT_STATUS.CANCELED],
    ['Basarili', QUERY_TYPE.HISTORY, TX_TYPE.REFUND, PAYMENT_STATUS.FULLY_REFUNDED],
    ['Basarili', QUERY_TYPE.HISTORY, TX_TYPE.PAY_AUTH, PAYMENT_STATUS.PAYMENT_COMPLETED],
    ['Basarili', QUERY_TYPE.HISTORY, TX_TYPE.PAY_POST_AUTH, PAYMENT_STATUS.PAYMENT_COMPLETED],
    ['Basarili', QUERY_TYPE.HISTORY, TX_TYPE.PAY_PRE_AUTH, PAYMENT_STATUS.PRE_AUTH_COMPLETED],
    ['Basarili', QUERY_TYPE.HISTORY, '', 'Basarili'],
    ['Iptal', QUERY_TYPE.HISTORY, '', 'Iptal'],
    ['', QUERY_TYPE.HISTORY, '', PAYMENT_STATUS.ERROR],
    ['blabla', '', '', 'blabla'],
  ] as const)('mapOrderStatus(%j, %j, %j) -> %j', (orderStatus, requestTxType, txType, expected) => {
    expect(mapper.mapOrderStatus(orderStatus, requestTxType as never, txType as never)).toBe(expected)
  })

  // addition: no request type, or an unrelated one, leaves the status untouched (no NotImplementedError)
  it.each([
    ['Basarisiz', QUERY_TYPE.HISTORY, TX_TYPE.PAY_AUTH, PAYMENT_STATUS.ERROR],
    ['Iptal', QUERY_TYPE.HISTORY, TX_TYPE.PAY_AUTH, 'Iptal'],
    ['Basarili', QUERY_TYPE.HISTORY, TX_TYPE.REFUND_PARTIAL, 'Basarili'],
    ['WAITINGPOSTAUTH', null, null, 'WAITINGPOSTAUTH'],
    ['WAITINGPOSTAUTH', TX_TYPE.ORDER_HISTORY, null, 'WAITINGPOSTAUTH'],
  ] as const)('mapOrderStatus(%j, %j, %j) -> %j (addition)', (orderStatus, requestTxType, txType, expected) => {
    expect(mapper.mapOrderStatus(orderStatus, requestTxType as TxType | QueryType | null, txType)).toBe(expected)
  })

  it.each([
    ['949', TX_TYPE.PAY_AUTH, CURRENCY.TRY],
    ['TL', QUERY_TYPE.HISTORY, CURRENCY.TRY],
    ['949', '', CURRENCY.TRY],
    ['TRY', '', null],
    ['840', '', CURRENCY.USD],
    ['USD', QUERY_TYPE.HISTORY, CURRENCY.USD],
    ['978', '', CURRENCY.EUR],
    ['826', '', CURRENCY.GBP],
    ['392', '', CURRENCY.JPY],
    ['643', '', CURRENCY.RUB],
  ] as const)('mapCurrency(%j, %j) -> %j', (currency, txType, expected) => {
    expect(mapper.mapCurrency(currency, txType as never)).toBe(expected)
  })

  // addition: each table answers only its own request type
  it.each([
    ['949', QUERY_TYPE.HISTORY, null],
    ['TL', TX_TYPE.PAY_AUTH, null],
    ['EUR', QUERY_TYPE.HISTORY, CURRENCY.EUR],
    ['RUB', QUERY_TYPE.HISTORY, CURRENCY.RUB],
    ['JPY', QUERY_TYPE.HISTORY, CURRENCY.JPY],
    ['GBP', QUERY_TYPE.HISTORY, CURRENCY.GBP],
    ['constructor', QUERY_TYPE.HISTORY, null],
  ] as const)('mapCurrency(%j, %j) -> %j (addition)', (currency, txType, expected) => {
    expect(mapper.mapCurrency(currency, txType)).toBe(expected)
  })

  it.each([
    ['3D', QUERY_TYPE.HISTORY, MODEL.THREE_D_SECURE],
    ['', QUERY_TYPE.HISTORY, MODEL.NON_SECURE],
    ['abc', QUERY_TYPE.HISTORY, null],
    ['3D', TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE],
    ['3D', TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_SECURE],
    ['3D_PAY', TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY],
    ['3D_PAY', TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_PAY],
  ] as const)('mapSecureType(%j, %j) -> %j', (secureType, txType, expected) => {
    expect(mapper.mapSecureType(secureType, txType)).toBe(expected)
  })

  // addition: the history answer knows only "3D" and "", the callback only "3D" and "3D_PAY"
  it.each([
    ['3D_PAY', QUERY_TYPE.HISTORY, null],
    ['', TX_TYPE.PAY_AUTH, null],
    ['abc', TX_TYPE.PAY_AUTH, null],
    ['constructor', TX_TYPE.PAY_AUTH, null],
  ] as const)('mapSecureType(%j, %j) -> %j (addition)', (secureType, txType, expected) => {
    expect(mapper.mapSecureType(secureType, txType)).toBe(expected)
  })

  it.each([
    [null, null],
    ['VISA', CARD_TYPE.VISA],
    ['MASTER', CARD_TYPE.MASTERCARD],
    ['MASTERCARD', CARD_TYPE.MASTERCARD],
    ['AMEX', CARD_TYPE.AMEX],
    ['TROY', CARD_TYPE.TROY],
    ['UNKNOWN', null],
    // addition: the spelled-out American Express name
    ['AMERICAN EXPRESS', CARD_TYPE.AMEX],
  ])('mapCardType(%j) -> %j', (input, expected) => {
    expect(mapper.mapCardType(input)).toBe(expected)
  })

  it.each([
    [null, null],
    ['C', CARD_CLASS.CREDIT],
    ['D', CARD_CLASS.DEBIT],
    ['M', CARD_CLASS.PREPAID],
    ['X', null],
    // addition: bank codes are case sensitive
    ['c', null],
  ])('mapCardClass(%j) -> %j', (input, expected) => {
    expect(mapper.mapCardClass(input)).toBe(expected)
  })
})
