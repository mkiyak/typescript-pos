import { beforeEach, describe, expect, it } from 'vitest'
import { ToslaPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/ToslaPosRequestValueMapper.js'
import { NotImplementedError, PosError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { CURRENCY, LANG, MODEL, TX_TYPE } from '../../../../../src/PosInterface.js'

describe('ToslaPosRequestValueMapper', () => {
  let mapper: ToslaPosRequestValueMapper

  beforeEach(() => {
    mapper = new ToslaPosRequestValueMapper()
  })

  it('supports only ToslaPos', () => {
    expect(ToslaPosRequestValueMapper.supports('ToslaPos')).toBe(true)
    expect(ToslaPosRequestValueMapper.supports('AssecoPos')).toBe(false)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, '1'],
    [TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_SECURE, '2'],
  ])('mapTxType(%s, %s) = %s', (txType, model, expected) => {
    expect(mapper.mapTxType(txType, model)).toBe(expected)
  })

  it('rejects an unknown tx type', () => {
    expect(() => mapper.mapTxType('1' as never)).toThrow(UnsupportedTransactionTypeError)
  })

  // deviation: T19 (the unsupported mappings are NotImplementedError)
  it('has no secure type mapping', () => {
    expect(() => mapper.mapSecureType(MODEL.THREE_D_SECURE)).toThrow(NotImplementedError)
  })

  it('has no recurring frequency mapping', () => {
    expect(() => mapper.mapRecurringFrequency('DAY')).toThrow(NotImplementedError)
  })

  it('has no language mapping', () => {
    expect(() => mapper.mapLang(LANG.TR)).toThrow(NotImplementedError)
  })

  it('maps currencies to numbers', () => {
    expect(mapper.mapCurrency(CURRENCY.TRY)).toBe(949)
    expect(mapper.mapCurrency(CURRENCY.EUR)).toBe(978)
  })

  // addition: an unknown currency is refused, never sent as NaN or "undefined"
  it.each(['XXX', 'constructor', '__proto__', ''])('rejects the currency %j', (currency) => {
    expect(() => mapper.mapCurrency(currency as never)).toThrow(PosError)
  })

  it('has the expected table sizes', () => {
    expect(Object.keys(mapper.getLangMappings())).toHaveLength(0)
    expect(Object.keys(mapper.getRecurringOrderFrequencyMappings())).toHaveLength(0)
    expect(Object.keys(mapper.getCurrencyMappings())).toHaveLength(6)
    expect(Object.keys(mapper.getTxTypeMappings())).toHaveLength(6)
    expect(Object.keys(mapper.getSecureTypeMappings())).toHaveLength(0)
    expect(Object.keys(mapper.getCardTypeMappings())).toHaveLength(0)
  })

  // addition: the full tx table
  it('maps every transaction type to its bank code', () => {
    expect(mapper.getTxTypeMappings()).toEqual({
      [TX_TYPE.PAY_AUTH]: '1',
      [TX_TYPE.PAY_PRE_AUTH]: '2',
      [TX_TYPE.PAY_POST_AUTH]: '3',
      [TX_TYPE.CANCEL]: '4',
      [TX_TYPE.REFUND]: '5',
      [TX_TYPE.REFUND_PARTIAL]: '5',
    })
  })
})
