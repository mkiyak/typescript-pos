import {
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
import { AbstractResponseValueMapper } from './AbstractResponseValueMapper.js'

/**
 * Response value mapper of the Kuveyt Turk gateway. Currencies are numeric ISO codes that the bank writes with or
 * without the leading zero, transaction types are the words of the request, and order statuses are small numbers.
 */
export class KuveytPosResponseValueMapper extends AbstractResponseValueMapper {
  protected override currencyMappings: Record<string, Currency> = {
    '0949': CURRENCY.TRY,
    '0840': CURRENCY.USD,
    '0978': CURRENCY.EUR,
  }

  protected override txTypeMappings = {
    [TX_TYPE.PAY_AUTH]: 'Sale',
    [TX_TYPE.CANCEL]: 'SaleReversal',
    [TX_TYPE.STATUS]: 'GetMerchantOrderDetail',
    [TX_TYPE.REFUND]: 'DrawBack',
    [TX_TYPE.REFUND_PARTIAL]: 'PartialDrawback',
  } as Partial<Record<TxType, string>>

  protected override secureTypeMappings: Record<string, PaymentModel> = {
    '3': MODEL.THREE_D_SECURE,
    '0': MODEL.NON_SECURE,
  }

  /** Order status codes of the order detail answer; other codes are returned as sent. */
  protected override orderStatusMappings: Record<string, PaymentStatus> = {
    '1': PAYMENT_STATUS.PAYMENT_COMPLETED,
    '4': PAYMENT_STATUS.FULLY_REFUNDED,
    '5': PAYMENT_STATUS.PARTIALLY_REFUNDED,
    '6': PAYMENT_STATUS.CANCELED,
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'KuveytPos'
  }

  /** Requests use `0949`, answers carry `0949` or `949`: both are padded to four digits before the lookup. */
  override mapCurrency(currency: string | number, apiRequestTxType: TxType | QueryType | null = null): Currency | null {
    return super.mapCurrency(String(currency).padStart(4, '0'), apiRequestTxType)
  }
}
