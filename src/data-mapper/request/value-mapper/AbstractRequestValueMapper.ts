import { NotImplementedError, PosError, UnsupportedTransactionTypeError } from '../../../errors.js'
import {
  type CardType,
  CURRENCY,
  type Currency,
  LANG,
  type Lang,
  type PaymentModel,
  type TxType,
} from '../../../PosInterface.js'
import type { QueryType } from '../../../pos-query/PosQueryInterface.js'
import type { PosOrder } from '../../../types.js'
import { ownValue } from '../../../util/ownValue.js'
import type {
  RecurringFrequency,
  RequestTxTypeMappings,
  RequestValueMapperInterface,
} from './RequestValueMapperInterface.js'

function requireMapped<T>(table: Readonly<Partial<Record<string, T>>>, key: string, what: string): T {
  const value = ownValue(table, key)
  if (value === undefined) {
    throw new PosError(`${what} "${key}" is not mapped.`)
  }
  return value
}

export abstract class AbstractRequestValueMapper implements RequestValueMapperInterface {
  protected cardTypeMappings: Record<string, string> = {}

  protected txTypeMappings: RequestTxTypeMappings = {}

  protected recurringOrderFrequencyMappings: Partial<Record<RecurringFrequency, string>> = {}

  protected secureTypeMappings: Partial<Record<PaymentModel, string>> = {}

  protected langMappings: Partial<Record<Lang, string>> = {}

  /** ISO 4217 numeric codes by default; some gateways override. */
  protected currencyMappings: Partial<Record<Currency, string | number>> = {
    [CURRENCY.TRY]: '949',
    [CURRENCY.USD]: '840',
    [CURRENCY.EUR]: '978',
    [CURRENCY.GBP]: '826',
    [CURRENCY.JPY]: '392',
    [CURRENCY.RUB]: '643',
  }

  getTxTypeMappings(): RequestTxTypeMappings {
    return this.txTypeMappings
  }

  mapTxType(
    txType: TxType | QueryType,
    paymentModel: PaymentModel | null = null,
    _order: PosOrder | null = null,
  ): string {
    if (!this.isSupportedTxType(txType, paymentModel)) {
      throw new UnsupportedTransactionTypeError(`Unsupported transaction type: ${txType}`)
    }

    const mapping = ownValue(this.txTypeMappings, txType) as string | Partial<Record<PaymentModel, string>>
    if (typeof mapping === 'string') {
      return mapping
    }

    return ownValue(mapping, paymentModel as PaymentModel) as string
  }

  getSecureTypeMappings(): Partial<Record<PaymentModel, string>> {
    return this.secureTypeMappings
  }

  mapSecureType(paymentModel: PaymentModel): string {
    if (Object.keys(this.secureTypeMappings).length === 0) {
      throw new NotImplementedError('Security type mappings are not supported.')
    }

    return requireMapped(this.secureTypeMappings, paymentModel, 'Payment model')
  }

  mapCurrency(currency: Currency): string | number {
    return requireMapped(this.currencyMappings, currency, 'Currency')
  }

  getCurrencyMappings(): Partial<Record<Currency, string | number>> {
    return this.currencyMappings
  }

  getRecurringOrderFrequencyMappings(): Partial<Record<RecurringFrequency, string>> {
    return this.recurringOrderFrequencyMappings
  }

  mapRecurringFrequency(period: RecurringFrequency | string): string {
    if (Object.keys(this.recurringOrderFrequencyMappings).length === 0) {
      throw new NotImplementedError('Recurring frequency mappings are not supported.')
    }

    return requireMapped(this.recurringOrderFrequencyMappings, period, 'Recurring frequency')
  }

  mapLang(lang: Lang): string {
    if (Object.keys(this.langMappings).length === 0) {
      throw new NotImplementedError('Language mappings are not supported.')
    }

    return ownValue(this.langMappings, lang) ?? ownValue(this.langMappings, LANG.TR) ?? lang
  }

  getLangMappings(): Partial<Record<Lang, string>> {
    return this.langMappings
  }

  getCardTypeMappings(): Record<string, string> {
    return this.cardTypeMappings
  }

  mapCardType(cardType: CardType | string): string {
    if (Object.keys(this.cardTypeMappings).length === 0) {
      throw new NotImplementedError('Card type mappings are not supported.')
    }

    return requireMapped(this.cardTypeMappings, cardType, 'Card type')
  }

  mapCardClass(_cardClass: string | null): string {
    throw new NotImplementedError('Card class mappings are not supported.')
  }

  protected isSupportedTxType(txType: TxType | QueryType, paymentModel: PaymentModel | null = null): boolean {
    const mapping = ownValue(this.txTypeMappings, txType)
    if (mapping === undefined) {
      return false
    }

    if (typeof mapping !== 'string') {
      if (paymentModel === null) {
        throw new PosError(`paymentModel must be provided for the transaction type ${txType}`)
      }

      return ownValue(mapping, paymentModel) !== undefined
    }

    return true
  }
}
