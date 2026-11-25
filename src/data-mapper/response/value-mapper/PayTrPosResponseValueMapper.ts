import {
  CARD_CLASS,
  CARD_FAMILY,
  CARD_TYPE,
  type CardType,
  CURRENCY,
  type Currency,
  TX_TYPE,
  type TxType,
} from '../../../PosInterface.js'
import { ownValue } from '../../../util/ownValue.js'
import { AbstractResponseValueMapper } from './AbstractResponseValueMapper.js'

/** Card types as the gateway prints them (upper case). */
const CARD_TYPES: Readonly<Record<string, CardType>> = {
  VISA: CARD_TYPE.VISA,
  MASTER: CARD_TYPE.MASTERCARD,
  MASTERCARD: CARD_TYPE.MASTERCARD,
  AMEX: CARD_TYPE.AMEX,
  'AMERICAN EXPRESS': CARD_TYPE.AMEX,
  TROY: CARD_TYPE.TROY,
}

const CARD_CLASSES: Readonly<Record<string, string>> = {
  credit: CARD_CLASS.CREDIT,
  debit: CARD_CLASS.DEBIT,
  prepaid: CARD_CLASS.PREPAID,
}

const CARD_FAMILIES: Readonly<Record<string, string>> = {
  world: CARD_FAMILY.WORLD,
  axess: CARD_FAMILY.AXESS,
  cardfinans: CARD_FAMILY.CARDFINANS,
  paraf: CARD_FAMILY.PARAF,
  advantage: CARD_FAMILY.ADVANTAGE,
  bonus: CARD_FAMILY.BONUS,
  saglamkart: CARD_FAMILY.SAGLAMKART,
}

/**
 * Response value mapper of the PayTR gateway. Currencies are printed as `TL` (also `TRY`), the transaction type of a
 * history row is `S` (sale) or `I` (refund). Answers carry no secure type or order status, so those lookups keep the
 * "not supported" behaviour.
 */
export class PayTrPosResponseValueMapper extends AbstractResponseValueMapper {
  protected override currencyMappings: Record<string, Currency> = {
    TL: CURRENCY.TRY,
    TRY: CURRENCY.TRY,
    USD: CURRENCY.USD,
    EUR: CURRENCY.EUR,
    GBP: CURRENCY.GBP,
    RUB: CURRENCY.RUB,
  }

  protected override txTypeMappings: Partial<Record<TxType, string>> = {
    [TX_TYPE.PAY_AUTH]: 'S',
    [TX_TYPE.REFUND]: 'I',
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayTrPos'
  }

  override mapCardType(cardType: string | null): CardType | null {
    return typeof cardType === 'string' ? (ownValue(CARD_TYPES, cardType) ?? null) : null
  }

  override mapCardClass(cardClass: string | null): string | null {
    return typeof cardClass === 'string' ? (ownValue(CARD_CLASSES, cardClass) ?? null) : null
  }

  /** Known family names get their constant; any other name passes through unchanged. */
  override mapCardFamilyName(name: string | null): string | null {
    if (typeof name !== 'string') return null

    return ownValue(CARD_FAMILIES, name) ?? name
  }
}
