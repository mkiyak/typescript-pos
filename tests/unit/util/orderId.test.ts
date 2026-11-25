import { describe, expect, it } from 'vitest'
import { PosError } from '../../../src/errors.js'
import type { PosOrder } from '../../../src/types.js'
import { existingOrderIdOf, ORDER_ID_PATTERN, orderIdOf } from '../../../src/util/orderId.js'

// addition: L2 one order-id rule for every gateway

const message = (max: number): string =>
  `Order field "id" must be 1-${max} letters, digits, "_" or "-", starting with a letter or digit`
const noUnderscore = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/
const noUnderscoreMessage = 'Order field "id" must be 1-64 letters, digits or "-", starting with a letter or digit'

const of = (id: unknown, ...rest: [number?, RegExp?]): string => orderIdOf({ id } as unknown as PosOrder, ...rest)

describe('ORDER_ID_PATTERN', () => {
  it('is a letter or digit first, then letters, digits, "_" or "-", at most 64', () => {
    expect(ORDER_ID_PATTERN.source).toBe('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')
  })
})

describe('orderIdOf', () => {
  it.each([
    ['A', 'A'],
    ['1', '1'],
    ['order_1-2', 'order_1-2'],
    ['202210121ABC-2', '202210121ABC-2'],
    ['a'.repeat(64), 'a'.repeat(64)],
    [7, '7'],
    [0, '0'],
    [Number.MAX_SAFE_INTEGER, '9007199254740991'],
  ] as const)('accepts %j as %j', (id, expected) => {
    expect(of(id)).toBe(expected)
  })

  it.each([
    ['_a'],
    ['-1'],
    ['a b'],
    ['ä1'],
    ['a'.repeat(65)],
    ['a&b'],
    ['a%20'],
    ['a\n'],
    [' a'],
    ['a.b'],
    ['１'],
    [['a']],
    [true],
    [false],
    [{}],
    [1.5],
    [-1],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [Number.MAX_SAFE_INTEGER + 1],
    [1e21],
    [10n],
    [Symbol('a')],
  ])('rejects %s with the exact message', (id) => {
    expect(() => of(id)).toThrow(PosError)
    expect(() => of(id)).toThrow(message(64))
  })

  it.each([[undefined], [null], ['']])('rejects a missing id (%j) as required', (id) => {
    expect(() => of(id)).toThrow(PosError)
    expect(() => of(id)).toThrow('Order field "id" is required')
  })

  it('reads only an own id, never an inherited one', () => {
    const order = Object.create({ id: 'inherited' }) as PosOrder
    expect(() => orderIdOf(order)).toThrow('Order field "id" is required')
  })

  it.each([[null], ['order'], [7]])('rejects an order that is not an object (%j)', (order) => {
    expect(() => orderIdOf(order as unknown as PosOrder)).toThrow(PosError)
  })

  it('applies a smaller length limit', () => {
    expect(of('a'.repeat(20), 20)).toBe('a'.repeat(20))
    expect(() => of('a'.repeat(21), 20)).toThrow(message(20))
    expect(() => of('_a', 20)).toThrow(message(20))
    expect(of(1234567890, 20)).toBe('1234567890')
  })

  it('applies a pattern without "_" and names the smaller alphabet', () => {
    expect(of('a-b', 64, noUnderscore)).toBe('a-b')
    expect(() => of('a_b', 64, noUnderscore)).toThrow(noUnderscoreMessage)
    expect(() => of('-ab', 64, noUnderscore)).toThrow(noUnderscoreMessage)
  })

  it('the length limit holds even when the pattern allows more', () => {
    expect(() => of('a'.repeat(21), 20, noUnderscore)).toThrow(
      'Order field "id" must be 1-20 letters, digits or "-", starting with a letter or digit',
    )
  })

  // addition: callers that read another field name it in the error
  it('names the given field in the error', () => {
    expect(() => orderIdOf({ id: '_a' } as PosOrder, 64, ORDER_ID_PATTERN, 'recurring_id')).toThrow(
      'Order field "recurring_id" must be 1-64 letters, digits, "_" or "-", starting with a letter or digit',
    )
    expect(() => orderIdOf({ id: '' } as PosOrder, 64, ORDER_ID_PATTERN, 'recurring_id')).toThrow(
      'Order field "recurring_id" is required',
    )
  })
})

// addition: orders created before the shared rule keep working for callbacks and later operations
describe('existingOrderIdOf', () => {
  const existing = (id: unknown, ...rest: [number?, string?]): string =>
    existingOrderIdOf({ id } as unknown as PosOrder, ...rest)
  const existingMessage = (max: number, field = 'id'): string =>
    `Order field "${field}" must be text of 1-${max} characters without control characters, or a non-negative whole number`

  it.each([
    ['INV.2024.1', 'INV.2024.1'],
    ['_legacy1', '_legacy1'],
    ['ord 1', 'ord 1'],
    ['-1', '-1'],
    ['a&b', 'a&b'],
    ['ä1', 'ä1'],
    [' a', ' a'],
    ['Sipariş #1 😀', 'Sipariş #1 😀'],
    ['a'.repeat(64), 'a'.repeat(64)],
    [7, '7'],
    [0, '0'],
    [Number.MAX_SAFE_INTEGER, '9007199254740991'],
  ] as const)('accepts %j as %j', (id, expected) => {
    expect(existing(id)).toBe(expected)
  })

  it.each([
    ['a\n'],
    ['a\r'],
    ['\t'],
    ['a\u0000'],
    ['a\u001f'],
    ['a\u007f'],
    ['a\u0080'],
    ['a\u0085'],
    ['a\u009f'],
    ['\ud800a'],
    ['a\udc00'],
    ['a\ud83d'],
    ['a'.repeat(65)],
    [['a']],
    [true],
    [{}],
    [1.5],
    [-1],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [Number.MAX_SAFE_INTEGER + 1],
    [10n],
    [Symbol('a')],
  ])('rejects %s with the exact message', (id) => {
    expect(() => existing(id)).toThrow(PosError)
    expect(() => existing(id)).toThrow(existingMessage(64))
  })

  it.each([[undefined], [null], ['']])('rejects a missing id (%j) as required', (id) => {
    expect(() => existing(id)).toThrow(PosError)
    expect(() => existing(id)).toThrow('Order field "id" is required')
  })

  it('reads only an own id, never an inherited one', () => {
    const order = Object.create({ id: 'inherited' }) as PosOrder
    expect(() => existingOrderIdOf(order)).toThrow('Order field "id" is required')
  })

  it.each([[null], ['order'], [7]])('rejects an order that is not an object (%j)', (order) => {
    expect(() => existingOrderIdOf(order as unknown as PosOrder)).toThrow(PosError)
  })

  it('applies the bank length limit and names the given field', () => {
    expect(existing(`${'a.b'.repeat(6)}cd`, 20)).toBe('a.ba.ba.ba.ba.ba.bcd')
    expect(() => existing('a'.repeat(21), 20)).toThrow(existingMessage(20))
    expect(() => existing('a\n', 64, 'recurring_id')).toThrow(existingMessage(64, 'recurring_id'))
    expect(() => existing('', 64, 'recurring_id')).toThrow('Order field "recurring_id" is required')
  })

  it('accepts every id the strict rule accepts', () => {
    for (const id of ['A', '1', 'order_1-2', '202210121ABC-2', 'a'.repeat(64), 7, 0]) {
      expect(existing(id)).toBe(of(id))
    }
  })
})
