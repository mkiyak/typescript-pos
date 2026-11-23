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
      'cvv2val',
      'expires',
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

  it('masks sensitive values inside XML bodies', () => {
    const xml =
      '<Request><Cvv2Val>123</Cvv2Val><Expires>12/30</Expires><Password>pw</Password><Pan>4111111111111111</Pan>' +
      '<MerchantPassword >x</MerchantPassword><Cvv>999</Cvv><Expiry>1230</Expiry><ExpiryDate>1230</ExpiryDate><Name>Ali</Name></Request>'
    const out = maskSensitiveData(xml)
    expect(out).toBe(
      '<Request><Cvv2Val>***</Cvv2Val><Expires>***</Expires><Password>***</Password><Pan>***</Pan>' +
        '<MerchantPassword >***</MerchantPassword><Cvv>***</Cvv><Expiry>***</Expiry><ExpiryDate>***</ExpiryDate><Name>Ali</Name></Request>',
    )
  })

  it('masks sensitive values inside urlencoded bodies', () => {
    const body = 'cv2=123&CVV=456&Cvv2Val=789&expires=1230&PASSWORD=p&MerchantPassword=q&pan=4111111111111111&oid=A1'
    expect(maskSensitiveData(body)).toBe(
      'cv2=***&CVV=***&Cvv2Val=***&expires=***&PASSWORD=***&MerchantPassword=***&pan=***&oid=A1',
    )
  })

  it('masks class instances by walking own properties', () => {
    class CreditCard {
      pan = '4111111111111111'
      cvv = '123'
      holder = 'Ali'
    }
    expect(maskSensitiveData(new CreditCard())).toEqual({ pan: '***', cvv: '***', holder: 'Ali' })
  })

  it('replaces exotic objects with placeholders', () => {
    expect(maskSensitiveData(new Map([['pan', '4111111111111111']]))).toBe('[Map]')
    expect(maskSensitiveData(new URLSearchParams('cvv=123'))).toBe('[URLSearchParams]')
    expect(maskSensitiveData(Buffer.from('4111111111111111'))).toBe('[Uint8Array]')
    expect(maskSensitiveData({ b: Buffer.from('x') })).toEqual({ b: '[Uint8Array]' })
  })

  it('masks 13-19 digit numeric values and exact PAN shapes', () => {
    expect(maskSensitiveData({ n: 4111111111111111n })).toEqual({ n: '411111****1111' })
    expect(maskSensitiveData({ n: 4111111111111 })).toEqual({ n: '411111****1111' })
    expect(maskSensitiveData('id_4111111111111111x 12345678901234567890')).toBe(
      'id_411111****1111x 12345678901234567890',
    )
    expect(maskSensitiveData({ n: 12345 })).toEqual({ n: 12345 })
  })

  it('caps nesting depth', () => {
    let deep: Record<string, unknown> = { v: 1 }
    for (let i = 0; i < 20000; i++) deep = { n: deep }
    expect(() => maskSensitiveData(deep)).not.toThrow()
  })
})
