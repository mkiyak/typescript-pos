import type { CardType, Currency, PaymentModel, PaymentStatus, TxType } from '../../../PosInterface.js'
import type { QueryType } from '../../../pos-query/PosQueryInterface.js'

/** Maps bank values to library values. */
export interface ResponseValueMapperInterface {
  mapTxType(txType: string | number, paymentModel?: PaymentModel | null): TxType | null

  /** @param apiRequestTxType transaction type of the API request */
  mapSecureType(
    securityType: string | boolean | number,
    apiRequestTxType?: TxType | QueryType | null,
  ): PaymentModel | null

  /** @param apiRequestTxType transaction type of the API request */
  mapCurrency(currency: string | number, apiRequestTxType?: TxType | QueryType | null): Currency | null

  /** Maps the order status of status/history responses; unmapped values are returned as is. */
  mapOrderStatus(
    orderStatus: string | number,
    requestTxType?: TxType | QueryType | null,
    txType?: TxType | null,
  ): PaymentStatus | string | number

  mapCardType(cardType: string | null): CardType | null

  /** Canonical card family name, the input unchanged when unmapped, null for null. */
  mapCardFamilyName(name: string | null): string | null

  mapCardClass(cardClass: string | null): string | null
}
