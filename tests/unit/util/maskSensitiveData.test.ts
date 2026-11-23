import { describe, expect, it } from 'vitest'
import { maskSensitiveData } from '../../../src/util/maskSensitiveData.js'

describe('maskSensitiveData', () => {
  it('masks sensitive keys deeply and case-insensitively', () => {
    const keys = [
      'pan',
      'number',
      'cardnumber',
      'card_number',
      'cv2',
      'cvv',
      'cvc',
      'expiry',
      'expirydate',
      'exp_year',
      'exp_month',
      'ecom_payment_card_expdate_year',
      'ecom_payment_card_expdate_month',
      'password',
      'merchantpassword',
      'storekey',
      'secret_key',
      'store_key',
    ]
    for (const key of keys) {
      const out = maskSensitiveData({ a: { b: [{ [key.toUpperCase()]: 'secretvalue' }] }, [key]: 'x' }) as any
      expect(out.a.b[0][key.toUpperCase()]).not.toBe('secretvalue')
      expect(out[key]).not.toBe('x')
      expect(JSON.stringify(out)).not.toContain('secretvalue')
    }
  })

  it('masks PAN-shaped numbers inside strings as first6****last4', () => {
    expect(maskSensitiveData('card 4111111111111111 used')).toBe('card 411111****1111 used')
    expect(maskSensitiveData({ msg: '<Number>5555555555554444</Number>' })).toEqual({
      msg: '<Number>555555****4444</Number>',
    })
  })

  it('leaves non-sensitive data untouched', () => {
    const data = { order_id: 'ABC123', amount: 10.5, ok: true, nothing: null, list: [1, 'a'] }
    expect(maskSensitiveData(data)).toEqual(data)
    expect(maskSensitiveData('short 123456789012')).toBe('short 123456789012')
  })

  it('does not mutate input', () => {
    const data = { pan: '4111111111111111', nested: { cvv: '123' } }
    const copy = structuredClone(data)
    maskSensitiveData(data)
    expect(data).toEqual(copy)
  })

  it('handles circular references and Error values', () => {
    const a: Record<string, unknown> = { x: 1 }
    a.self = a
    expect(() => maskSensitiveData(a)).not.toThrow()
    expect(maskSensitiveData(new Error('pan 4111111111111111'))).toBeDefined()
  })
})
