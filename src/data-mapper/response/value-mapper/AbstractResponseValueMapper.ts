import { NotImplementedError } from '../../../errors.js'
import type { CardType, Currency, PaymentModel, PaymentStatus, TxType } from '../../../PosInterface.js'
import type { QueryType } from '../../../pos-query/PosQueryInterface.js'
import { ownValue } from '../../../util/ownValue.js'
import type { ResponseValueMapperInterface } from './ResponseValueMapperInterface.js'

/** PHP array-key cast for scalar lookups (`true` -> "1", `false` -> "0"). */
function phpKey(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? '1' : '0'
  return String(value)
}

export abstract class AbstractResponseValueMapper implements ResponseValueMapperInterface {
  /** Bank currency code -> CURRENCY value. */
  protected currencyMappings: Record<string, Currency> = {}

  /** Same table shape as the request value mapper; reverse-looked-up here. */
  protected txTypeMappings: Partial<Record<TxType, string | Partial<Record<PaymentModel, string>>>> = {}

  /** Bank secure type -> MODEL value. */
  protected secureTypeMappings: Record<string, PaymentModel> = {}

  /** Bank order status -> PAYMENT_STATUS value. */
  protected orderStatusMappings: Record<string, PaymentStatus> = {}

  mapTxType(txType: string | number, _paymentModel: PaymentModel | null = null): TxType | null {
    if (Object.keys(this.txTypeMappings).length === 0) {
      throw new NotImplementedError('Transaction type mapping is not supported')
    }

    for (const [mappedTxType, mapping] of Object.entries(this.txTypeMappings)) {
      if (mapping !== undefined && typeof mapping === 'object' && Object.values(mapping).includes(txType as string)) {
        return mappedTxType as TxType
      }
      if (mapping === txType) {
        return mappedTxType as TxType
      }
    }

    return null
  }

  mapSecureType(
    securityType: string | boolean | number,
    _apiRequestTxType: TxType | QueryType | null = null,
  ): PaymentModel | null {
    if (Object.keys(this.secureTypeMappings).length === 0) {
      throw new NotImplementedError('Secure type mapping is not supported')
    }

    return ownValue(this.secureTypeMappings, phpKey(securityType)) ?? null
  }

  mapCurrency(currency: string | number, _apiRequestTxType: TxType | QueryType | null = null): Currency | null {
    return ownValue(this.currencyMappings, phpKey(currency)) ?? null
  }

  mapOrderStatus(
    orderStatus: string | number,
    _requestTxType: TxType | QueryType | null = null,
    _txType: TxType | null = null,
  ): PaymentStatus | string | number {
    if (Object.keys(this.orderStatusMappings).length === 0) {
      throw new NotImplementedError('Order status mapping is not supported.')
    }

    return ownValue(this.orderStatusMappings, phpKey(orderStatus)) ?? orderStatus
  }

  /** Default: null. Override for banks that return the card type. */
  mapCardType(_cardType: string | null): CardType | null {
    return null
  }

  /** Default: pass-through. */
  mapCardFamilyName(name: string | null): string | null {
    return name
  }

  /** Default: null. Override for banks that return the card class. */
  mapCardClass(_cardClass: string | null): string | null {
    return null
  }
}
