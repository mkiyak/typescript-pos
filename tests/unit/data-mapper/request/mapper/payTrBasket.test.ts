import { describe, expect, it } from 'vitest'
import { payTrBasketJson, phpJsonEncode } from '../../../../../src/data-mapper/request/mapper/payTrBasket.js'
import { PosError } from '../../../../../src/errors.js'
import type { PosOrder } from '../../../../../src/types.js'

describe('phpJsonEncode', () => {
  // The expected texts are what PHP 8.5 json_encode writes with its default flags.
  it.each([
    [[['Gözlük/Ç', 10.5, 1]], '[["G\\u00f6zl\\u00fck\\/\\u00c7",10.5,1]]'],
    [[['a"b\\c', 50, 2]], '[["a\\"b\\\\c",50,2]]'],
    [[['😀', 0.3, 1]], '[["\\ud83d\\ude00",0.3,1]]'],
    [[['tab\there\nline', 9.71, 1]], '[["tab\\there\\nline",9.71,1]]'],
    [[["ctl\u001f<>&'", 1, 1]], '[["ctl\\u001f<>&\'",1,1]]'],
  ])('writes %j like PHP', (value, expected) => {
    expect(phpJsonEncode(value)).toBe(expected)
  })

  it('writes pure ASCII', () => {
    const text = phpJsonEncode(['İşçğüö/ü€'])
    expect([...text].every((char) => char.charCodeAt(0) < 128)).toBe(true)
  })

  it('refuses a value that has no JSON form', () => {
    expect(() => phpJsonEncode(undefined)).toThrow(PosError)
  })
})

describe('payTrBasketJson', () => {
  const order = (basketItems?: unknown): PosOrder => ({ id: 'order-1', amount: 10.5, basket_items: basketItems })

  it('falls back to one row with the order id and the amount', () => {
    expect(payTrBasketJson({ id: 'order-1' }, 'order-1', 10.5)).toBe('[["order-1",10.5,1]]')
    expect(payTrBasketJson(order([]), 'order-1', 50)).toBe('[["order-1",50,1]]')
    expect(payTrBasketJson(order(null), 'order-1', 50)).toBe('[["order-1",50,1]]')
  })

  it('writes the items as name, price and count', () => {
    expect(
      payTrBasketJson(
        order([
          { name: 'Binocular', item_count: 1, price: 0.3 },
          { name: 'Game code', item_count: 1, price: 9.71 },
        ]),
        'order-1',
        10.01,
      ),
    ).toBe('[["Binocular",0.3,1],["Game code",9.71,1]]')
  })

  it('keeps a price given as text as text and a count given as digits as a number', () => {
    expect(payTrBasketJson(order([{ name: 'A', item_count: '3', price: '9.50' }]), 'o', 1)).toBe('[["A","9.50",3]]')
  })

  it('escapes the item name', () => {
    expect(payTrBasketJson(order([{ name: 'Gözlük/Ç', item_count: 1, price: 10.5 }]), 'o', 1)).toBe(
      '[["G\\u00f6zl\\u00fck\\/\\u00c7",10.5,1]]',
    )
  })

  it.each([
    ['an empty entry', [[]]],
    ['a string entry', ['x']],
    ['null', [null]],
    ['price 0', [{ name: 'A', price: 0, item_count: 1 }]],
    ['negative price', [{ name: 'A', price: -1, item_count: 1 }]],
    ['price 1e13', [{ name: 'A', price: 1e13, item_count: 1 }]],
    ['exponent price', [{ name: 'A', price: 1e-7, item_count: 1 }]],
    ['NaN price', [{ name: 'A', price: Number.NaN, item_count: 1 }]],
    ['comma price', [{ name: 'A', price: '1,5', item_count: 1 }]],
    ['zero text price', [{ name: 'A', price: '0.00', item_count: 1 }]],
    ['three decimal text price', [{ name: 'A', price: '1.005', item_count: 1 }]],
    ['missing price', [{ name: 'A', item_count: 1 }]],
    ['count 0', [{ name: 'A', price: 1, item_count: 0 }]],
    ['count 1.5', [{ name: 'A', price: 1, item_count: 1.5 }]],
    ['count 10000', [{ name: 'A', price: 1, item_count: 10000 }]],
    ['count missing', [{ name: 'A', price: 1 }]],
    ['empty name', [{ name: '', price: 1, item_count: 1 }]],
    ['blank name', [{ name: '  ', price: 1, item_count: 1 }]],
    ['long name', [{ name: 'x'.repeat(101), price: 1, item_count: 1 }]],
    ['number name', [{ name: 5, price: 1, item_count: 1 }]],
    ['too many items', Array.from({ length: 101 }, () => ({ name: 'A', price: 1, item_count: 1 }))],
    ['not a list', 'A'],
    // addition: inherited members never count
    ['inherited fields', [Object.create({ name: 'A', price: 1, item_count: 1 })]],
  ])('refuses %s', (_label, items) => {
    expect(() => payTrBasketJson(order(items), 'order-1', 1)).toThrow(PosError)
  })

  it('refuses a sparse list', () => {
    // biome-ignore lint/suspicious/noSparseArray: a sparse list is the case under test
    expect(() => payTrBasketJson(order([, { name: 'A', price: 1, item_count: 1 }]), 'o', 1)).toThrow(PosError)
  })
})
