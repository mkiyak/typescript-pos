import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
    InvalidCardError: E.InvalidCardError,
  }

  it.each(Object.keys(simpleErrors))('%s extends PosError and sets name', (n) => {
    const e = new (simpleErrors[n] as new (m?: string) => E.PosError)('boom')
    expect(e).toBeInstanceOf(E.PosError)
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe(n)
    expect(e.message).toBe('boom')
  })

  // addition: common payment mismatch fields
  it.each(['transaction_id', 'transaction_type'] as const)('OrderMismatchError accepts field %s', (field) => {
    expect(new E.OrderMismatchError(field, 'a', 'b').field).toBe(field)
  })

  it('OrderMismatchError carries fields', () => {
    const e = new E.OrderMismatchError('order_id', 'A', 'B')
    expect(e.name).toBe('OrderMismatchError')
    expect([e.field, e.expected, e.actual]).toEqual(['order_id', 'A', 'B'])
    expect(e).toBeInstanceOf(E.PosError)
  })

  it.each(['currency', 'merchant_id'] as const)('OrderMismatchError supports the %s field', (field) => {
    const e = new E.OrderMismatchError(field, '949', '840')
    expect(e.field).toBe(field)
    expect(e.message).toBe(`Callback ${field} mismatch: expected "949", got "840"`)
  })

  it('OrderMismatchError masks the raw bank data attached in response.all', () => {
    const response = {
      status: 'declined' as const,
      order_id: 'A',
      proc_return_code: '00',
      error_code: null,
      error_message: null,
      transaction_id: 'T1',
      all: { oid: 'A', Password: 'secret', pan: '4111111111111111', note: 'card 4111111111111111' },
    }
    const e = new E.OrderMismatchError('order_id', 'A', 'B', response)
    expect(e.response?.transaction_id).toBe('T1')
    expect(e.response?.all).toEqual({ oid: 'A', Password: '***', pan: '***', note: 'card 411111****1111' })
    expect(response.all.Password).toBe('secret')
  })

  describe('OrderMismatchError.paymentMayHaveCompleted', () => {
    const base = { order_id: 'A', error_code: null, error_message: null, all: {} }

    it('is false without a response', () => {
      expect(new E.OrderMismatchError('amount', '1', '2').paymentMayHaveCompleted).toBe(false)
    })

    it.each([
      ['approved', '00', true],
      ['approved', null, true],
      ['declined', '00', true],
      ['declined', '99', false],
      ['declined', null, false],
    ] as const)('status %s + proc_return_code %s -> %s', (status, code, expected) => {
      const response = { ...base, status, proc_return_code: code, requires_manual_review: false }
      const e = new E.OrderMismatchError('amount', '100', '1.00', response)
      expect(e.paymentMayHaveCompleted).toBe(expected)
      expect(e.response?.requires_manual_review).toBe(expected)
      // the caller's object is never mutated
      expect(response.requires_manual_review).toBe(false)
    })
  })

  it('src/ never throws a plain Error (every library error is a PosError)', () => {
    const root = join(import.meta.dirname, '../../src')
    const offenders = (readdirSync(root, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /\b(new|throw)\s+(Type|Range|Syntax)?Error\(/.test(readFileSync(join(root, f), 'utf8')))
    expect(offenders).toEqual([])
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
