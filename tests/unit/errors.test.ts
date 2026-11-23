import { describe, expect, it } from 'vitest'
import * as E from '../../src/errors.js'
import { randomHexString } from '../../src/util/random.js'

describe('errors', () => {
  const simpleErrors: Record<string, new (m?: string) => E.PosError> = {
    HashMismatchError: E.HashMismatchError,
    UnsupportedPaymentModelError: E.UnsupportedPaymentModelError,
    UnsupportedTransactionTypeError: E.UnsupportedTransactionTypeError,
    UnsupportedFormFormatError: E.UnsupportedFormFormatError,
    MissingAccountInfoError: E.MissingAccountInfoError,
    CardTypeRequiredError: E.CardTypeRequiredError,
    CardTypeNotSupportedError: E.CardTypeNotSupportedError,
    GatewayClassNotConfiguredError: E.GatewayClassNotConfiguredError,
    NotImplementedError: E.NotImplementedError,
  }

  it.each(Object.keys(simpleErrors))('%s extends PosError and sets name', (n) => {
    const e = new (simpleErrors[n] as new (m?: string) => E.PosError)('boom')
    expect(e).toBeInstanceOf(E.PosError)
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe(n)
    expect(e.message).toBe('boom')
  })

  it('OrderMismatchError carries fields', () => {
    const e = new E.OrderMismatchError('order_id', 'A', 'B')
    expect(e.name).toBe('OrderMismatchError')
    expect([e.field, e.expected, e.actual]).toEqual(['order_id', 'A', 'B'])
    expect(e).toBeInstanceOf(E.PosError)
  })

  it('PosHttpError masks and truncates body snippet', () => {
    const e = new E.PosHttpError('fail', { url: 'https://x', status: 502, body: `${'a'.repeat(600)} 4111111111111111` })
    expect(e.name).toBe('PosHttpError')
    expect(e.status).toBe(502)
    expect(e.url).toBe('https://x')
    expect(e.bodySnippet?.length).toBeLessThanOrEqual(500)
    const m = new E.PosHttpError('fail', { url: 'u', body: 'pan 4111111111111111' })
    expect(m.bodySnippet).toBe('pan 411111****1111')
    expect(new E.PosHttpError('f', { url: 'u' }).bodySnippet).toBeUndefined()
  })
})

describe('randomHexString', () => {
  it('returns uppercase hex of requested length', () => {
    expect(randomHexString()).toMatch(/^[0-9A-F]{24}$/)
    expect(randomHexString(5)).toMatch(/^[0-9A-F]{5}$/)
    expect(randomHexString(0)).toBe('')
  })
})
