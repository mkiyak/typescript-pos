import {
  CARD_CLASS,
  CARD_FAMILY,
  CARD_TYPE,
  type CardType,
  CURRENCY,
  type Currency,
  PAYMENT_STATUS,
  type PaymentModel,
  type PaymentStatus,
  TX_TYPE,
  type TxType,
} from '../../../PosInterface.js'
import { AbstractResponseValueMapper } from './AbstractResponseValueMapper.js'

/** Card type names as the bank prints them, compared lower-cased. */
const CARD_TYPES: Readonly<Record<string, CardType>> = {
  visa: CARD_TYPE.VISA,
  mastercard: CARD_TYPE.MASTERCARD,
  'master card': CARD_TYPE.MASTERCARD,
  amex: CARD_TYPE.AMEX,
  americanexpress: CARD_TYPE.AMEX,
  'american express': CARD_TYPE.AMEX,
  troy: CARD_TYPE.TROY,
}

/** Card classes as the bank prints them (Turkish). */
const CARD_CLASSES: Readonly<Record<string, string>> = {
  'Kredi Kartı': CARD_CLASS.CREDIT,
  'Banka Kartı': CARD_CLASS.DEBIT,
  'Ön Ödemeli Kart': CARD_CLASS.PREPAID,
}

/**
 * Response value mapper of the Tosla gateway. Currencies are numeric ISO codes, transaction types and order statuses
 * are small integers (the bank sends them as numbers, sometimes as text); the answers carry no secure type, so that
 * lookup keeps the "not supported" behaviour.
 */
export class ToslaPosResponseValueMapper extends AbstractResponseValueMapper {
  protected override currencyMappings: Record<string, Currency> = {
    '949': CURRENCY.TRY,
    '840': CURRENCY.USD,
    '978': CURRENCY.EUR,
    '826': CURRENCY.GBP,
    '392': CURRENCY.JPY,
    '643': CURRENCY.RUB,
  }

  protected override txTypeMappings: Partial<Record<TxType, string>> = {
    [TX_TYPE.PAY_AUTH]: '1',
    [TX_TYPE.PAY_PRE_AUTH]: '2',
    [TX_TYPE.PAY_POST_AUTH]: '3',
    [TX_TYPE.CANCEL]: '4',
    [TX_TYPE.REFUND]: '5',
    [TX_TYPE.REFUND_PARTIAL]: '5',
  }

  protected override orderStatusMappings: Record<string, PaymentStatus> = {
    '0': PAYMENT_STATUS.ERROR,
    '1': PAYMENT_STATUS.PAYMENT_COMPLETED,
    '2': PAYMENT_STATUS.CANCELED,
    '3': PAYMENT_STATUS.PARTIALLY_REFUNDED,
    '4': PAYMENT_STATUS.FULLY_REFUNDED,
    '5': PAYMENT_STATUS.PRE_AUTH_COMPLETED,
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'ToslaPos'
  }

  /** The number 0 is the bank's "no transaction type" and maps to nothing; other values are read as their text. */
  override mapTxType(txType: string | number, paymentModel: PaymentModel | null = null): TxType | null {
    if (txType === 0) return null

    return super.mapTxType(String(txType), paymentModel)
  }

  override mapCardType(cardType: string | null): CardType | null {
    if (typeof cardType !== 'string') return null
    const name = cardType.toLowerCase()

    return Object.hasOwn(CARD_TYPES, name) ? (CARD_TYPES[name] ?? null) : null
  }

  override mapCardFamilyName(name: string | null): string | null {
    if (typeof name !== 'string') return null

    return name === 'Card Finans' ? CARD_FAMILY.CARDFINANS : name
  }

  override mapCardClass(cardClass: string | null): string | null {
    if (typeof cardClass !== 'string') return null

    return Object.hasOwn(CARD_CLASSES, cardClass) ? (CARD_CLASSES[cardClass] ?? null) : null
  }
}
