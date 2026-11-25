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
import type { QueryType } from '../../../pos-query/PosQueryInterface.js'
import { ownValue } from '../../../util/ownValue.js'
import { AbstractResponseValueMapper } from './AbstractResponseValueMapper.js'

const CARD_TYPES: Readonly<Record<string, CardType>> = {
  MASTER_CARD: CARD_TYPE.MASTERCARD,
  VISA: CARD_TYPE.VISA,
  TROY: CARD_TYPE.TROY,
  AMERICAN_EXPRESS: CARD_TYPE.AMEX,
}

const CARD_CLASSES: Readonly<Record<string, string>> = {
  CREDIT_CARD: CARD_CLASS.CREDIT,
  DEBIT_CARD: CARD_CLASS.DEBIT,
  PREPAID_CARD: CARD_CLASS.PREPAID,
}

const CARD_FAMILIES: Readonly<Record<string, string>> = {
  Paraf: CARD_FAMILY.PARAF,
  Axess: CARD_FAMILY.AXESS,
  Bonus: CARD_FAMILY.BONUS,
  World: CARD_FAMILY.WORLD,
  Maximum: CARD_FAMILY.MAXIMUM,
  CardFinans: CARD_FAMILY.CARDFINANS,
  Advantage: CARD_FAMILY.ADVANTAGE,
}

/** Transaction kinds that only the reporting answers print. */
const HISTORY_TX_TYPES: Readonly<Record<string, TxType>> = {
  CANCEL: TX_TYPE.CANCEL,
  PAYMENT: TX_TYPE.PAY_AUTH,
  REFUND: TX_TYPE.REFUND,
}

/** Refund and cancel states of the reporting answers; every other state passes through unchanged. */
const ORDER_HISTORY_STATUSES: Readonly<Record<string, PaymentStatus>> = {
  CANCELED: PAYMENT_STATUS.CANCELED,
  PARTIALLY_REFUNDED: PAYMENT_STATUS.PARTIALLY_REFUNDED,
  REFUNDED: PAYMENT_STATUS.FULLY_REFUNDED,
}

/**
 * Response value mapper of the iyzico gateway. The `phase` of a payment answer is `AUTH`, `PRE_AUTH` or `POST_AUTH`;
 * the reporting answers add `PAYMENT`, `CANCEL` and `REFUND`. A payment is 3D Secure when `threeDS` is `1` or `true`
 * and a regular payment when it is `0`, `false` or `null`.
 */
export class IyzicoPosResponseValueMapper extends AbstractResponseValueMapper {
  protected override currencyMappings: Record<string, Currency> = {
    TRY: CURRENCY.TRY,
    USD: CURRENCY.USD,
    EUR: CURRENCY.EUR,
    GBP: CURRENCY.GBP,
    JPY: CURRENCY.JPY,
    RUB: CURRENCY.RUB,
  }

  protected override orderStatusMappings: Record<string, PaymentStatus> = {
    SUCCESS: PAYMENT_STATUS.PAYMENT_COMPLETED,
    FAILURE: PAYMENT_STATUS.ERROR,
    INIT_THREEDS: PAYMENT_STATUS.PAYMENT_PENDING,
    CALLBACK_THREEDS: PAYMENT_STATUS.PAYMENT_PENDING,
    CALLBACK_PECCO: PAYMENT_STATUS.PAYMENT_PENDING,
    BKM_POS_PENDING: PAYMENT_STATUS.PAYMENT_PENDING,
  }

  protected override secureTypeMappings: Record<string, PaymentModel> = {
    '0': MODEL.NON_SECURE,
    '1': MODEL.THREE_D_SECURE,
  }

  protected override txTypeMappings: Partial<Record<TxType, string>> = {
    [TX_TYPE.PAY_AUTH]: 'AUTH',
    [TX_TYPE.PAY_PRE_AUTH]: 'PRE_AUTH',
    [TX_TYPE.PAY_POST_AUTH]: 'POST_AUTH',
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'IyzicoPos'
  }

  override mapCardFamilyName(name: string | null): string | null {
    if (typeof name !== 'string') return null

    return ownValue(CARD_FAMILIES, name) ?? name
  }

  override mapCardType(cardType: string | null): CardType | null {
    return typeof cardType === 'string' ? (ownValue(CARD_TYPES, cardType) ?? null) : null
  }

  override mapCardClass(cardClass: string | null): string | null {
    return typeof cardClass === 'string' ? (ownValue(CARD_CLASSES, cardClass) ?? null) : null
  }

  override mapTxType(txType: string | number, paymentModel: PaymentModel | null = null): TxType | null {
    const mapped = super.mapTxType(txType, paymentModel)
    if (mapped !== null) return mapped

    return typeof txType === 'string' ? (ownValue(HISTORY_TX_TYPES, txType) ?? null) : null
  }

  /**
   * Only the reporting answers carry a state worth translating (cancel and refund states); a payment or status
   * answer keeps iyzico's own word, and so does any state that has no library equivalent.
   */
  override mapOrderStatus(
    orderStatus: string | number,
    requestTxType: TxType | QueryType | null = null,
  ): PaymentStatus | string | number {
    if (requestTxType === TX_TYPE.ORDER_HISTORY && typeof orderStatus === 'string') {
      return ownValue(ORDER_HISTORY_STATUSES, orderStatus) ?? orderStatus
    }

    return orderStatus
  }

  /** A payment without 3D Secure prints `threeDS` as `null`, `0` or `false`. */
  override mapSecureType(
    securityType: string | boolean | number | null,
    apiRequestTxType: TxType | QueryType | null = null,
  ): PaymentModel | null {
    if (securityType === null) return MODEL.NON_SECURE

    return super.mapSecureType(securityType, apiRequestTxType)
  }
}
