import { describe, expect, it } from 'vitest'
import { AbstractRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/AbstractRequestValueMapper.js'
import { NotImplementedError, PosError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { CURRENCY, LANG, MODEL, TX_TYPE } from '../../../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../../../src/pos-query/PosQueryInterface.js'

class MappedValueMapper extends AbstractRequestValueMapper {
  protected override txTypeMappings = {
    [TX_TYPE.PAY_AUTH]: 'Auth',
    [TX_TYPE.PAY_PRE_AUTH]: { [MODEL.THREE_D_SECURE]: '3DPre', [MODEL.NON_SECURE]: 'PreAuth' },
  }
  protected override secureTypeMappings = { [MODEL.THREE_D_SECURE]: '3d' }
  protected override langMappings = { [LANG.TR]: 'tr-TR' }
  protected override cardTypeMappings = { visa: '1' }
  protected override recurringOrderFrequencyMappings = { DAY: 'D' }
}

class QueryValueMapper extends AbstractRequestValueMapper {
  protected override txTypeMappings = { [QUERY_TYPE.HISTORY]: 'orderlistinq' }
}

class EmptyValueMapper extends AbstractRequestValueMapper {}

describe('AbstractRequestValueMapper', () => {
  const mapper = new MappedValueMapper()
  const empty = new EmptyValueMapper()

  // addition: query types are valid mapping keys
  it('maps query types', () => {
    expect(new QueryValueMapper().mapTxType(QUERY_TYPE.HISTORY)).toBe('orderlistinq')
  })

  it('maps string tx types', () => {
    expect(mapper.mapTxType(TX_TYPE.PAY_AUTH)).toBe('Auth')
  })

  it('maps per-payment-model tx types', () => {
    expect(mapper.mapTxType(TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_SECURE)).toBe('3DPre')
    expect(mapper.mapTxType(TX_TYPE.PAY_PRE_AUTH, MODEL.NON_SECURE)).toBe('PreAuth')
  })

  it('throws UnsupportedTransactionTypeError for unmapped tx types or models', () => {
    expect(() => mapper.mapTxType(TX_TYPE.REFUND)).toThrow(UnsupportedTransactionTypeError)
    expect(() => mapper.mapTxType(TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_PAY)).toThrow(UnsupportedTransactionTypeError)
  })

  it('requires a payment model when the mapping depends on it', () => {
    expect(() => mapper.mapTxType(TX_TYPE.PAY_PRE_AUTH)).toThrow(
      'paymentModel must be provided for the transaction type pre',
    )
    expect(() => mapper.mapTxType(TX_TYPE.PAY_PRE_AUTH)).toThrow(PosError)
  })

  it('has ISO 4217 currency mappings by default', () => {
    expect(empty.getCurrencyMappings()).toEqual({
      TRY: '949',
      USD: '840',
      EUR: '978',
      GBP: '826',
      JPY: '392',
      RUB: '643',
    })
    expect(empty.mapCurrency(CURRENCY.EUR)).toBe('978')
  })

  it('maps languages with TR fallback', () => {
    expect(mapper.mapLang(LANG.TR)).toBe('tr-TR')
    expect(mapper.mapLang(LANG.EN)).toBe('tr-TR')
  })

  it('maps secure type, card type and recurring frequency', () => {
    expect(mapper.mapSecureType(MODEL.THREE_D_SECURE)).toBe('3d')
    expect(mapper.mapCardType('visa')).toBe('1')
    expect(mapper.mapRecurringFrequency('DAY')).toBe('D')
  })

  it('throws NotImplementedError when a mapping table is empty', () => {
    expect(() => empty.mapSecureType(MODEL.THREE_D_SECURE)).toThrow(NotImplementedError)
    expect(() => empty.mapLang(LANG.TR)).toThrow(NotImplementedError)
    expect(() => empty.mapCardType('visa')).toThrow(NotImplementedError)
    expect(() => empty.mapRecurringFrequency('DAY')).toThrow(NotImplementedError)
    expect(() => empty.mapCardClass(null)).toThrow(NotImplementedError)
  })

  it('throws instead of returning undefined for unknown keys', () => {
    expect(() => mapper.mapSecureType(MODEL.THREE_D_PAY)).toThrow(/not mapped/)
    expect(() => mapper.mapCardType('amex')).toThrow(/not mapped/)
    expect(() => mapper.mapCardType('constructor')).toThrow(/not mapped/)
    expect(() => empty.mapCurrency('XXX' as never)).toThrow(/not mapped/)
    expect(() => mapper.mapCardType('amex')).toThrow(PosError)
    expect(() => empty.mapCurrency('XXX' as never)).toThrow(PosError)
    expect(() => mapper.mapRecurringFrequency('YEAR')).toThrow(PosError)
  })

  it('exposes its mapping tables', () => {
    expect(mapper.getTxTypeMappings()).toHaveProperty(TX_TYPE.PAY_AUTH, 'Auth')
    expect(mapper.getSecureTypeMappings()).toEqual({ '3d': '3d' })
    expect(mapper.getLangMappings()).toEqual({ tr: 'tr-TR' })
    expect(mapper.getCardTypeMappings()).toEqual({ visa: '1' })
    expect(mapper.getRecurringOrderFrequencyMappings()).toEqual({ DAY: 'D' })
  })
})
