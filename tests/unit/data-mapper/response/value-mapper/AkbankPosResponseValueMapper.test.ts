import { describe, expect, it } from 'vitest'
import { AkbankPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/AkbankPosResponseValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import { CURRENCY, PAYMENT_STATUS, TX_TYPE } from '../../../../../src/PosInterface.js'

describe('AkbankPosResponseValueMapper', () => {
  const mapper = new AkbankPosResponseValueMapper()

  it('supports', () => {
    expect(AkbankPosResponseValueMapper.supports('AkbankPos')).toBe(true)
    expect(AkbankPosResponseValueMapper.supports('AssecoPos')).toBe(false)
  })

  it.each([
    ['1000', TX_TYPE.PAY_AUTH],
    ['3000', TX_TYPE.PAY_AUTH],
    ['1004', TX_TYPE.PAY_PRE_AUTH],
    ['3004', TX_TYPE.PAY_PRE_AUTH],
    ['1005', TX_TYPE.PAY_POST_AUTH],
    ['1002', TX_TYPE.REFUND],
    ['1003', TX_TYPE.CANCEL],
    ['1010', TX_TYPE.ORDER_HISTORY],
    // deviation: A19 a query type is not a transaction type, so the response table has no history row
    ['1009', null],
    // addition: unknown and inherited names never map
    ['9999', null],
    ['constructor', null],
  ])('mapTxType(%j) -> %j', (txType, expected) => {
    expect(mapper.mapTxType(txType)).toBe(expected)
  })

  // deviation: A20 the reference logic lives in mapOrderStatusDetailed, the interface method has no pre-auth/recurring arguments
  it.each([
    ['N', null, false, PAYMENT_STATUS.PAYMENT_COMPLETED],
    ['N', 'O', false, PAYMENT_STATUS.PRE_AUTH_COMPLETED],
    ['N', 'C', false, PAYMENT_STATUS.PAYMENT_COMPLETED],
    ['S', null, false, PAYMENT_STATUS.ERROR],
    ['V', null, false, PAYMENT_STATUS.CANCELED],
    ['R', null, false, PAYMENT_STATUS.FULLY_REFUNDED],
    ['Başarılı', null, false, PAYMENT_STATUS.PAYMENT_COMPLETED],
    ['Başarısız', null, false, PAYMENT_STATUS.ERROR],
    ['İptal', null, false, PAYMENT_STATUS.CANCELED],
    ['S', null, true, PAYMENT_STATUS.PAYMENT_COMPLETED],
    ['W', null, true, PAYMENT_STATUS.PAYMENT_PENDING],
    ['V', null, true, PAYMENT_STATUS.CANCELED],
    ['C', null, true, PAYMENT_STATUS.CANCELED],
    ['blabla', null, true, 'blabla'],
    ['blabla', null, false, 'blabla'],
  ])('mapOrderStatusDetailed(%j, %j, %j) -> %j', (orderStatus, preAuthStatus, isRecurring, expected) => {
    expect(mapper.mapOrderStatusDetailed(orderStatus, preAuthStatus, isRecurring)).toBe(expected)
  })

  // addition: the interface method maps the non-recurring table without pre-auth handling; inherited names stay unmapped
  it.each([
    ['N', PAYMENT_STATUS.PAYMENT_COMPLETED],
    ['W', 'W'],
    ['constructor', 'constructor'],
    ['toString', 'toString'],
  ])('mapOrderStatus(%j) -> %j', (orderStatus, expected) => {
    expect(mapper.mapOrderStatus(orderStatus)).toBe(expected)
  })

  it('mapOrderStatusDetailed keeps inherited names unmapped (addition)', () => {
    expect(mapper.mapOrderStatusDetailed('constructor', null, true)).toBe('constructor')
    expect(mapper.mapOrderStatusDetailed('toString', 'O', false)).toBe('toString')
  })

  it.each([
    [949, TX_TYPE.PAY_AUTH, CURRENCY.TRY],
    [949, '', CURRENCY.TRY],
    [840, '', CURRENCY.USD],
    [978, '', CURRENCY.EUR],
    [826, '', CURRENCY.GBP],
    [392, '', CURRENCY.JPY],
    [643, '', CURRENCY.RUB],
    [1, '', null],
  ])('mapCurrency(%j, %j) -> %j', (currency, txType, expected) => {
    expect(mapper.mapCurrency(currency, txType as never)).toBe(expected)
  })

  it('mapSecureType is not supported', () => {
    expect(() => mapper.mapSecureType('3D', TX_TYPE.PAY_AUTH)).toThrow(NotImplementedError)
  })

  it('mapCardFamilyName', () => {
    expect(mapper.mapCardFamilyName('paraf')).toBe('paraf')
    expect(mapper.mapCardFamilyName(null)).toBeNull()
  })

  it('mapCardClass', () => {
    expect(mapper.mapCardClass(null)).toBeNull()
    expect(mapper.mapCardClass('CREDIT_CARD')).toBeNull()
  })

  it('mapCardType', () => {
    expect(mapper.mapCardType(null)).toBeNull()
    expect(mapper.mapCardType('VISA')).toBeNull()
  })
})
