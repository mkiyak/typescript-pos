import { CardTypeNotSupportedError, CardTypeRequiredError } from '../errors.js'
import { CreditCard } from '../model/card/CreditCard.js'
import type { CardType } from '../PosInterface.js'

/** Structural stand-in for a gateway (avoids a circular import). */
export interface AbstractGatewayLike {
  getCardTypeMapping(): Record<string, string>
}

function createExpiration(expireYear: string, expireMonth: string): { year: number; month: number } {
  // Year: pad to 2 digits with '0', then to 4 with the '20' prefix; month padded to 2.
  const y = expireYear.padStart(2, '0').padStart(4, '20')
  const m = expireMonth.padStart(2, '0')
  const month = Number(m)
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || month < 1 || month > 12) {
    throw new Error('INVALID DATE FORMAT')
  }
  return { year: Number(y), month }
}

export const CreditCardFactory = {
  createForGateway(
    gateway: AbstractGatewayLike,
    number: string,
    expireYear: string,
    expireMonth: string,
    cvv: string,
    cardHolderName: string | null = null,
    cardType: CardType | string | null = null,
  ): CreditCard {
    const card = CreditCardFactory.create(number, expireYear, expireMonth, cvv, cardHolderName, cardType)

    const supported = Object.keys(gateway.getCardTypeMapping())
    if (supported.length > 0) {
      if (cardType === null) {
        throw new CardTypeRequiredError(`Card type is required for ${gateway.constructor.name}`)
      }
      if (!supported.includes(cardType)) {
        throw new CardTypeNotSupportedError(`Card type "${cardType}" is not supported`)
      }
    }
    return card
  },

  create(
    number: string,
    expireYear: string,
    expireMonth: string,
    cvv: string,
    cardHolderName: string | null = null,
    cardType: CardType | string | null = null,
  ): CreditCard {
    return new CreditCard(
      number.replace(/\s+/g, ''),
      createExpiration(expireYear, expireMonth),
      cvv,
      cardHolderName,
      cardType,
    )
  },
} as const
