import { describe, expect, it } from 'vitest'
import { CardTypeNotSupportedError, CardTypeRequiredError, InvalidCardError, PosError } from '../../../src/errors.js'
import { CreditCardFactory } from '../../../src/factory/CreditCardFactory.js'
import { CARD_TYPE } from '../../../src/PosInterface.js'

const gw = (mapping: Record<string, string>) => ({ getCardTypeMapping: () => mapping })

describe('CreditCardFactory', () => {
  it('createForGateway succeeds with supported card type', () => {
    const card = CreditCardFactory.createForGateway(
      gw({ [CARD_TYPE.VISA]: 'visa' }),
      '4444 5555 6666 7777',
      '22',
      '02',
      '123',
      'john',
      CARD_TYPE.VISA,
    )
    expect(card.getNumber()).toBe('4444555566667777')
    expect(card.getExpirationDate('Ym')).toBe('202202')
    expect(card.getHolderName()).toBe('john')
    expect(card.getCvv()).toBe('123')
  })

  it('throws CardTypeNotSupportedError for unsupported type', () => {
    expect(() =>
      CreditCardFactory.createForGateway(
        gw({ [CARD_TYPE.VISA]: 'visa' }),
        '4444 5555 6666 7777',
        '22',
        '12',
        '123',
        'john',
        CARD_TYPE.AMEX,
      ),
    ).toThrow(CardTypeNotSupportedError)
  })

  it('throws CardTypeRequiredError when type missing but gateway needs it', () => {
    expect(() =>
      CreditCardFactory.createForGateway(
        gw({ [CARD_TYPE.VISA]: 'visa' }),
        '4444 5555 6666 7777',
        '22',
        '12',
        '123',
        'john',
      ),
    ).toThrow(CardTypeRequiredError)
  })

  it('card type is optional when gateway mapping is empty', () => {
    const card = CreditCardFactory.createForGateway(gw({}), '4444 5555 6666 7777', '22', '12', '123', 'john')
    expect(card.getType()).toBeNull()
  })

  it.each([
    ['2', '2', '200202'],
    ['022', '12', '202212'],
    ['2026', '1', '202601'],
  ])('create pads year %s and month %s', (y, m, expected) => {
    expect(CreditCardFactory.create('4444555566667777', y, m, '123').getExpirationDate('Ym')).toBe(expected)
  })

  it.each([
    ['ab', '12'],
    ['22', '13'],
    ['22', '00'],
    ['22', 'xx'],
  ])('create rejects invalid date %s/%s', (y, m) => {
    expect(() => CreditCardFactory.create('4444555566667777', y, m, '123')).toThrow('INVALID DATE FORMAT')
    expect(() => CreditCardFactory.create('4444555566667777', y, m, '123')).toThrow(InvalidCardError)
    expect(() => CreditCardFactory.create('4444555566667777', y, m, '123')).toThrow(PosError)
  })
})
