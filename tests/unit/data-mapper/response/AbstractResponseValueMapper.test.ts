import { describe, expect, it } from 'vitest'
import { AbstractResponseValueMapper } from '../../../../src/data-mapper/response/value-mapper/AbstractResponseValueMapper.js'
import { NotImplementedError } from '../../../../src/errors.js'
import { CURRENCY, MODEL, PAYMENT_STATUS, TX_TYPE } from '../../../../src/PosInterface.js'

class Mapped extends AbstractResponseValueMapper {
  protected override currencyMappings = { '949': CURRENCY.TRY, '840': CURRENCY.USD }
  protected override txTypeMappings = {
    [TX_TYPE.PAY_AUTH]: 'Auth',
    [TX_TYPE.PAY_PRE_AUTH]: { [MODEL.THREE_D_SECURE]: '3DPre', [MODEL.NON_SECURE]: 'PreAuth' },
  }
  protected override secureTypeMappings = { '3d': MODEL.THREE_D_SECURE, '1': MODEL.THREE_D_PAY }
  protected override orderStatusMappings = { S: PAYMENT_STATUS.PAYMENT_COMPLETED }
}
class Empty extends AbstractResponseValueMapper {}

describe('AbstractResponseValueMapper', () => {
  const m = new Mapped()
  const e = new Empty()

  it('reverse-maps tx types (string and per-model mappings)', () => {
    expect(m.mapTxType('Auth')).toBe(TX_TYPE.PAY_AUTH)
    expect(m.mapTxType('PreAuth')).toBe(TX_TYPE.PAY_PRE_AUTH)
    expect(m.mapTxType('3DPre')).toBe(TX_TYPE.PAY_PRE_AUTH)
    expect(m.mapTxType('Unknown')).toBeNull()
  })

  it('compares tx types strictly', () => {
    class Numeric extends AbstractResponseValueMapper {
      protected override txTypeMappings = { [TX_TYPE.PAY_AUTH]: '1' }
    }
    expect(new Numeric().mapTxType(1)).toBeNull()
    expect(new Numeric().mapTxType('1')).toBe(TX_TYPE.PAY_AUTH)
  })

  it('maps secure type, currency and order status', () => {
    expect(m.mapSecureType('3d', TX_TYPE.PAY_AUTH)).toBe(MODEL.THREE_D_SECURE)
    expect(m.mapSecureType(true, TX_TYPE.PAY_AUTH)).toBe(MODEL.THREE_D_PAY)
    expect(m.mapSecureType('x', TX_TYPE.PAY_AUTH)).toBeNull()
    expect(m.mapCurrency('949', TX_TYPE.PAY_AUTH)).toBe(CURRENCY.TRY)
    expect(m.mapCurrency(840, TX_TYPE.PAY_AUTH)).toBe(CURRENCY.USD)
    expect(m.mapCurrency('000', TX_TYPE.PAY_AUTH)).toBeNull()
    expect(m.mapCurrency('constructor', TX_TYPE.PAY_AUTH)).toBeNull()
    expect(m.mapOrderStatus('S')).toBe(PAYMENT_STATUS.PAYMENT_COMPLETED)
    expect(m.mapOrderStatus('ZZ')).toBe('ZZ')
  })

  it('throws NotImplementedError when a mapping table is empty', () => {
    expect(() => e.mapTxType('Auth')).toThrow(NotImplementedError)
    expect(() => e.mapSecureType('3d', TX_TYPE.PAY_AUTH)).toThrow(NotImplementedError)
    expect(() => e.mapOrderStatus('S')).toThrow(NotImplementedError)
  })

  it('has card defaults', () => {
    expect(e.mapCardType('VISA')).toBeNull()
    expect(e.mapCardFamilyName('Bonus')).toBe('Bonus')
    expect(e.mapCardFamilyName(null)).toBeNull()
    expect(e.mapCardClass('credit')).toBeNull()
  })
})
