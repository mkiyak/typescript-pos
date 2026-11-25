import { describe, expect, it } from 'vitest'
import { PosError } from '../../../src/errors.js'
import type { PosOrder } from '../../../src/types.js'
import { ORDER_ID_PATTERN, orderIdOf } from '../../../src/util/orderId.js'

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
})
