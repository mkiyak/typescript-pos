import {
  CARD_CLASS,
  CARD_TYPE,
  type CardClass,
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
import { QUERY_TYPE, type QueryType } from '../../../pos-query/PosQueryInterface.js'
import { ownValue } from '../../../util/ownValue.js'
import { AbstractResponseValueMapper } from './AbstractResponseValueMapper.js'

/** Currency names of the order list answer. */
const HISTORY_RESPONSE_CURRENCY_MAPPINGS: Readonly<Record<string, Currency>> = {
  TL: CURRENCY.TRY,
  USD: CURRENCY.USD,
  EUR: CURRENCY.EUR,
  RUB: CURRENCY.RUB,
  JPY: CURRENCY.JPY,
  GBP: CURRENCY.GBP,
}

/** Transaction type names of the order list answer. */
const HISTORY_RESPONSE_TX_TYPES: Readonly<Record<string, TxType>> = {
  Satis: TX_TYPE.PAY_AUTH,
  'On Otorizasyon': TX_TYPE.PAY_PRE_AUTH,
  'On Otorizasyon Kapama': TX_TYPE.PAY_POST_AUTH,
  Iade: TX_TYPE.REFUND,
  Iptal: TX_TYPE.CANCEL,
}

export class GarantiPosResponseValueMapper extends AbstractResponseValueMapper {
  protected override currencyMappings: Record<string, Currency> = {
    '949': CURRENCY.TRY,
    '840': CURRENCY.USD,
    '978': CURRENCY.EUR,
    '826': CURRENCY.GBP,
    '392': CURRENCY.JPY,
    '643': CURRENCY.RUB,
  }

  /** Query types (`orderlistinq`, `bininq`) are not transaction types and never come back as one. */
  protected override txTypeMappings: Partial<Record<TxType, string>> = {
    [TX_TYPE.PAY_AUTH]: 'sales',
    [TX_TYPE.PAY_PRE_AUTH]: 'preauth',
    [TX_TYPE.PAY_POST_AUTH]: 'postauth',
    [TX_TYPE.CANCEL]: 'void',
    [TX_TYPE.REFUND]: 'refund',
    [TX_TYPE.REFUND_PARTIAL]: 'refund',
    [TX_TYPE.ORDER_HISTORY]: 'orderhistoryinq',
    [TX_TYPE.STATUS]: 'orderinq',
  }

  protected override secureTypeMappings: Record<string, PaymentModel> = {
    '3D': MODEL.THREE_D_SECURE,
    '3D_PAY': MODEL.THREE_D_PAY,
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'GarantiPos'
  }

  override mapTxType(txType: string | number, paymentModel: PaymentModel | null = null): TxType | null {
    return ownValue(HISTORY_RESPONSE_TX_TYPES, String(txType)) ?? super.mapTxType(txType, paymentModel)
  }

  override mapSecureType(
    securityType: string | boolean | number,
    apiRequestTxType: TxType | QueryType | null = null,
  ): PaymentModel | null {
    if (apiRequestTxType === QUERY_TYPE.HISTORY) {
      // SafeType of the order list answer: 3D Secure and 3D Pay are both "3D", non-secure is empty.
      if (securityType === '3D') {
        return MODEL.THREE_D_SECURE
      }
      if (securityType === '') {
        return MODEL.NON_SECURE
      }

      return null
    }

    return super.mapSecureType(securityType, apiRequestTxType)
  }

  override mapCardType(cardType: string | null): CardType | null {
    switch (cardType) {
      case 'VISA':
        return CARD_TYPE.VISA
      case 'MASTER':
      case 'MASTERCARD':
        return CARD_TYPE.MASTERCARD
      case 'AMEX':
      case 'AMERICAN EXPRESS':
        return CARD_TYPE.AMEX
      case 'TROY':
        return CARD_TYPE.TROY
      default:
        return null
    }
  }

  override mapCardClass(cardClass: string | null): CardClass | null {
    switch (cardClass) {
      case 'C':
        return CARD_CLASS.CREDIT
      case 'D':
        return CARD_CLASS.DEBIT
      case 'M':
        return CARD_CLASS.PREPAID
      default:
        return null
    }
  }

  override mapCurrency(currency: string | number, apiRequestTxType: TxType | QueryType | null = null): Currency | null {
    if (apiRequestTxType === QUERY_TYPE.HISTORY) {
      return ownValue(HISTORY_RESPONSE_CURRENCY_MAPPINGS, String(currency)) ?? null
    }

    return super.mapCurrency(currency, apiRequestTxType)
  }

  override mapOrderStatus(
    orderStatus: string | number,
    requestTxType: TxType | QueryType | null = null,
    txType: TxType | null = null,
  ): PaymentStatus | string | number {
    if (requestTxType === TX_TYPE.STATUS) {
      // The bank documents no value list for the charge type, so only the pre-auth state is mapped.
      if (orderStatus === 'WAITINGPOSTAUTH') {
        return PAYMENT_STATUS.PRE_AUTH_COMPLETED
      }

      return orderStatus
    }

    if (requestTxType === QUERY_TYPE.HISTORY) {
      if (txType === null) {
        return orderStatus
      }

      // Possible values: Basarili, Basarisiz, Iptal, Onaylandi.
      if (orderStatus === 'Basarili' || orderStatus === 'Onaylandi') {
        if (txType === TX_TYPE.CANCEL) {
          return PAYMENT_STATUS.CANCELED
        }
        if (txType === TX_TYPE.REFUND) {
          // The answer does not tell a partial refund from a full one.
          return PAYMENT_STATUS.FULLY_REFUNDED
        }
        if (txType === TX_TYPE.PAY_AUTH || txType === TX_TYPE.PAY_POST_AUTH) {
          return PAYMENT_STATUS.PAYMENT_COMPLETED
        }
        if (txType === TX_TYPE.PAY_PRE_AUTH) {
          return PAYMENT_STATUS.PRE_AUTH_COMPLETED
        }

        return orderStatus
      }

      // "Iptal" combined with a sale, pre-auth, cancel or refund type is not documented; kept as returned.
      if (orderStatus === 'Iptal') {
        return orderStatus
      }

      return PAYMENT_STATUS.ERROR
    }

    return orderStatus
  }
}
