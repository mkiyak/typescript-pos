import { describe, expect, it } from 'vitest'
import {
  hasControlCharacters,
  iyzicoAddress,
  iyzicoBasketItems,
  iyzicoBuyer,
  iyzicoOrderId,
  iyzicoOrderInstallment,
  iyzicoOrderIp,
  iyzicoOrderKurus,
  iyzicoPaymentId,
} from '../../../../../src/data-mapper/request/mapper/iyzicoOrderFields.js'
import { PosError } from '../../../../../src/errors.js'

describe('iyzicoOrderFields', () => {
  describe('iyzicoOrderId', () => {
    it.each([
      ['order-001', 'order-001'],
      [42, '42'],
      ['A', 'A'],
      ['a'.repeat(64), 'a'.repeat(64)],
    ])('accepts %j', (id, expected) => {
      expect(iyzicoOrderId({ id } as never)).toBe(expected)
    })

    it.each([
      [''],
      ['a b'],
      ['-a'],
      ['_a'],
      ['a'.repeat(65)],
      [Number.NaN],
      [['a']],
      [{}],
      [null],
      [undefined],
      [true],
    ])('refuses %j', (id) => {
      expect(() => iyzicoOrderId({ id } as never)).toThrow(PosError)
    })

    it('does not read an inherited id', () => {
      expect(() => iyzicoOrderId(Object.create({ id: 'a' }))).toThrow(PosError)
    })
  })

  describe('iyzicoOrderKurus', () => {
    it.each([
      [100, 10000],
      [10.01, 1001],
      [0.3, 30],
      ['10.50', 1050],
      [1.15, 115],
      [10.005, 1001],
    ])('%j is %i kurus', (amount, kurus) => {
      expect(iyzicoOrderKurus({ amount } as never)).toBe(kurus)
    })

    it.each([
      [0],
      [-1],
      ['abc'],
      [''],
      [null],
      [undefined],
      [1e13],
      [Number.NaN],
      [Number.POSITIVE_INFINITY],
      [0.004],
      [[1]],
      ['1e2'],
    ])('refuses %j', (amount) => {
      expect(() => iyzicoOrderKurus({ amount } as never)).toThrow(PosError)
    })
  })

  describe('iyzicoOrderInstallment', () => {
    it.each([
      [undefined, 1],
      [0, 1],
      [1, 1],
      [12, 12],
      ['3', 3],
    ])('%j is %i', (installment, expected) => {
      expect(iyzicoOrderInstallment({ installment } as never)).toBe(expected)
    })

    it.each([[13], [-1], [1.5], ['x'], ['1e1']])('refuses %j', (installment) => {
      expect(() => iyzicoOrderInstallment({ installment } as never)).toThrow(PosError)
    })
  })

  describe('iyzicoOrderIp', () => {
    it('is null when absent and the text when valid', () => {
      expect(iyzicoOrderIp({})).toBeNull()
      expect(iyzicoOrderIp({ ip: null } as never)).toBeNull()
      expect(iyzicoOrderIp({ ip: '127.0.0.1' })).toBe('127.0.0.1')
      expect(iyzicoOrderIp({ ip: '2001:db8::1' })).toBe('2001:db8::1')
    })

    it.each([['a b'], ['1'], [5], ['1.2.3.4\n'], ['x'.repeat(40)]])('refuses %j', (ip) => {
      expect(() => iyzicoOrderIp({ ip } as never)).toThrow(PosError)
    })
  })

  describe('iyzicoPaymentId', () => {
    it.each([
      ['1', '1'],
      ['35790626', '35790626'],
      [35790626, '35790626'],
      ['9'.repeat(20), '9'.repeat(20)],
    ])('accepts %j', (value, expected) => {
      expect(iyzicoPaymentId(value, 'x')).toBe(expected)
    })

    it.each([
      ['0'],
      ['01'],
      ['1a'],
      [''],
      ['1'.repeat(21)],
      [0],
      [-1],
      [1.5],
      [2 ** 60],
      [['1']],
      [null],
      [undefined],
      ['１'],
    ])('refuses %j', (value) => {
      expect(() => iyzicoPaymentId(value, 'x')).toThrow(PosError)
    })
  })

  describe('iyzicoBuyer and iyzicoAddress', () => {
    const buyer = {
      id: 'b',
      name: 'N',
      surname: 'S',
      identity_number: '1',
      email: 'a@b.c',
      registration_address: 'addr',
      city: 'c',
      country: 'k',
      ip: '1.2.3.4',
    }

    it('optional buyer fields become empty text and the key order is fixed', () => {
      const actual = iyzicoBuyer({ buyer })
      expect(actual.gsmNumber).toBe('')
      expect(actual.zipCode).toBe('')
      expect(actual.registrationDate).toBe('')
      expect(Object.keys(actual)).toEqual([
        'id',
        'name',
        'surname',
        'identityNumber',
        'email',
        'gsmNumber',
        'registrationAddress',
        'city',
        'country',
        'zipCode',
        'ip',
        'registrationDate',
        'lastLoginDate',
      ])
    })

    it('does not read inherited buyer fields', () => {
      expect(() => iyzicoBuyer({ buyer: Object.create(buyer) })).toThrow(PosError)
    })

    it('an absent optional address is null, a required one is an error', () => {
      expect(iyzicoAddress({}, 'shipping_address', false)).toBeNull()
      expect(() => iyzicoAddress({}, 'shipping_address', true)).toThrow(PosError)
      expect(() => iyzicoAddress({ shipping_address: 'x' }, 'shipping_address', false)).toThrow(PosError)
    })
  })

  describe('iyzicoBasketItems', () => {
    const item = (price: unknown) => ({ id: 'i', name: 'n', category1: 'c', item_type: 'VIRTUAL', price })

    it('adds the kurus exactly', () => {
      const items = iyzicoBasketItems({ basket_items: [item(0.3), item(9.71)] }, 1001)
      expect(items.map((i) => i.price)).toEqual([0.3, 9.71])
    })

    it('many small items add up without drift', () => {
      const items = Array.from({ length: 10 }, () => item(0.1))
      expect(iyzicoBasketItems({ basket_items: items }, 100)).toHaveLength(10)
      expect(() => iyzicoBasketItems({ basket_items: items }, 101)).toThrow(PosError)
    })

    it('refuses a sum that differs by one kurus', () => {
      expect(() => iyzicoBasketItems({ basket_items: [item(0.3), item(9.7)] }, 1001)).toThrow(
        'Basket item prices must add up to the order amount',
      )
    })

    it('does not read inherited items', () => {
      expect(() => iyzicoBasketItems(Object.create({ basket_items: [item(1)] }), 100)).toThrow(PosError)
    })
  })

  it('hasControlCharacters finds controls, separators and bidi controls', () => {
    expect(hasControlCharacters('plain text')).toBe(false)
    expect(hasControlCharacters('a\u0000b'.replace('\\u0000', String.fromCharCode(0)))).toBe(true)
    expect(hasControlCharacters(`a${String.fromCharCode(0x2029)}b`)).toBe(true)
    expect(hasControlCharacters(`a${String.fromCharCode(0x202e)}b`)).toBe(true)
    expect(hasControlCharacters('a\tb')).toBe(true)
  })
})
