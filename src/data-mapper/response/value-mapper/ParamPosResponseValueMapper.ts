import {
  CARD_CLASS,
  CARD_FAMILY,
  CARD_TYPE,
  type CardType,
  CURRENCY,
  type Currency,
  MODEL,
  PAYMENT_STATUS,
  type PaymentModel,
  type PaymentStatus,
  TX_TYPE,
  type TxType,
} from '../../../PosInterface.js'
import { AbstractResponseValueMapper } from './AbstractResponseValueMapper.js'

/** Words of a status record's transaction type. */
const STATUS_TX_TYPES: Readonly<Record<string, TxType>> = {
  SALE: TX_TYPE.PAY_AUTH,
  PRE_AUTH: TX_TYPE.PAY_PRE_AUTH,
  POST_AUTH: TX_TYPE.PAY_POST_AUTH,
}

/** Words of a history record's transaction type (Turkish: sale, cancel, refund). */
const HISTORY_TX_TYPES: Readonly<Record<string, TxType>> = {
  Satış: TX_TYPE.PAY_AUTH,
  İptal: TX_TYPE.CANCEL,
  İade: TX_TYPE.REFUND,
}

const CARD_TYPES: Readonly<Record<string, CardType>> = {
  VISA: CARD_TYPE.VISA,
  MASTER: CARD_TYPE.MASTERCARD,
  AMEX: CARD_TYPE.AMEX,
  TROY: CARD_TYPE.TROY,
}

const CARD_CLASSES: Readonly<Record<string, string>> = {
  'Kredi Kartı': CARD_CLASS.CREDIT,
  'Debit Kart': CARD_CLASS.DEBIT,
  'Ön Ödemeli Kart': CARD_CLASS.PREPAID,
}

const CARD_FAMILIES: Readonly<Record<string, string>> = {
  World: CARD_FAMILY.WORLD,
  Axess: CARD_FAMILY.AXESS,
  Bonus: CARD_FAMILY.BONUS,
  Maximum: CARD_FAMILY.MAXIMUM,
  Paraf: CARD_FAMILY.PARAF,
}

/**
 * Response value mapper of the Param gateways (ParamPos and Param3DHostPos). Status records and history records name
 * the transaction type in different words; a word that is in neither table is "not supported" (the base behaviour of
 * an empty table), so callers decide what an unknown transaction type means.
 */
export class ParamPosResponseValueMapper extends AbstractResponseValueMapper {
  protected override currencyMappings: Record<string, Currency> = {
    TRL: CURRENCY.TRY,
    TL: CURRENCY.TRY,
    EUR: CURRENCY.EUR,
    USD: CURRENCY.USD,
  }

  protected override secureTypeMappings: Record<string, PaymentModel> = {
    NONSECURE: MODEL.NON_SECURE,
    '3D': MODEL.THREE_D_SECURE,
  }

  protected override orderStatusMappings: Record<string, PaymentStatus> = {
    FAIL: PAYMENT_STATUS.ERROR,
    BANK_FAIL: PAYMENT_STATUS.ERROR,
    SUCCESS: PAYMENT_STATUS.PAYMENT_COMPLETED,
    CANCEL: PAYMENT_STATUS.CANCELED,
    REFUND: PAYMENT_STATUS.FULLY_REFUNDED,
    PARTIAL_REFUND: PAYMENT_STATUS.PARTIALLY_REFUNDED,
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'ParamPos' || gatewayClass === 'Param3DHostPos'
  }

  override mapTxType(txType: string | number, paymentModel: PaymentModel | null = null): TxType | null {
    if (typeof txType === 'string') {
      if (Object.hasOwn(STATUS_TX_TYPES, txType)) return STATUS_TX_TYPES[txType] ?? null
      if (Object.hasOwn(HISTORY_TX_TYPES, txType)) return HISTORY_TX_TYPES[txType] ?? null
    }

    return super.mapTxType(txType, paymentModel)
  }

  override mapCardType(cardType: string | null): CardType | null {
    if (typeof cardType !== 'string') return null

    return Object.hasOwn(CARD_TYPES, cardType) ? (CARD_TYPES[cardType] ?? null) : null
  }

  override mapCardClass(cardClass: string | null): string | null {
    if (typeof cardClass !== 'string') return null

    return Object.hasOwn(CARD_CLASSES, cardClass) ? (CARD_CLASSES[cardClass] ?? null) : null
  }

  override mapCardFamilyName(name: string | null): string | null {
    if (typeof name !== 'string') return null

    return Object.hasOwn(CARD_FAMILIES, name) ? (CARD_FAMILIES[name] ?? name) : name
  }
}
