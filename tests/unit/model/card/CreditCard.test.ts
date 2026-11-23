import { describe, expect, it } from 'vitest'
import { CreditCard } from '../../../../src/model/card/CreditCard.js'
import { CARD_TYPE } from '../../../../src/PosInterface.js'

const exp = { year: 2026, month: 2 }

describe('CreditCard', () => {
  it('exposes getters', () => {
    const card = new CreditCard('4444555566667777', exp, '123', 'John Doe', CARD_TYPE.VISA)
    expect(card.getNumber()).toBe('4444555566667777')
    expect(card.getExpirationDate('Ym')).toBe('202602')
    expect(card.getCvv()).toBe('123')
    expect(card.getHolderName()).toBe('John Doe')
    expect(card.getType()).toBe(CARD_TYPE.VISA)
  })

  it('strips spaces from the number', () => {
    expect(new CreditCard('4444 5555 6666 7777', exp, '123').getNumber()).toBe('4444555566667777')
  })

  it('holder name and type default to null', () => {
    const card = new CreditCard('4444555566667777', exp, '123')
    expect(card.getHolderName()).toBeNull()
    expect(card.getType()).toBeNull()
  })

  it('setHolderName returns self and accepts null', () => {
    const card = new CreditCard('4444555566667777', exp, '123', 'John Doe')
    expect(card.setHolderName('Jane Doe')).toBe(card)
    expect(card.getHolderName()).toBe('Jane Doe')
    card.setHolderName(null)
    expect(card.getHolderName()).toBeNull()
  })

  it.each([
    ['Y', '2026'],
    ['y', '26'],
    ['m', '02'],
    ['n', '2'],
    ['ym', '2602'],
    ['Ym', '202602'],
    ['my', '0226'],
    ['mY', '022026'],
    ['m/y', '02/26'],
    ['Y-m-d', '2026-02-01'],
  ])('formats expiration date with %s', (fmt, expected) => {
    expect(new CreditCard('4444555566667777', exp, '123').getExpirationDate(fmt)).toBe(expected)
  })

  it('getExpireYear / getExpireMonth use sensible default formats', () => {
    const card = new CreditCard('4444555566667777', exp, '123')
    expect(card.getExpireYear()).toBe('2026')
    expect(card.getExpireYear('y')).toBe('26')
    expect(card.getExpireMonth()).toBe('02')
    expect(card.getExpireMonth('n')).toBe('2')
  })

  it('toJSON never contains full PAN or CVV', () => {
    const card = new CreditCard('4444555566667777', exp, '987', 'John Doe', CARD_TYPE.VISA)
    const json = JSON.stringify(card)
    expect(json).not.toContain('4444555566667777')
    expect(json).not.toContain('987')
    expect(json).toContain('444455****7777')
    expect(json).toContain('John Doe')
  })

  it('does not leak PAN or CVV through enumerable properties', () => {
    const card = new CreditCard('4444555566667777', exp, '987')
    expect(JSON.stringify({ ...card })).not.toContain('4444555566667777')
    expect(Object.keys(card)).toEqual([])
  })
})
