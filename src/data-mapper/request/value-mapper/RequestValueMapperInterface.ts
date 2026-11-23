import type { CardType, Currency, Lang, PaymentModel, TxType } from '../../../PosInterface.js'
import type { PosOrder } from '../../../types.js'

export type RecurringFrequency = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR'

/** A bank value per tx type, or per tx type and payment model. */
export type RequestTxTypeMappings = Partial<Record<TxType, string | Partial<Record<PaymentModel, string>>>>

/** Maps order values to bank values. */
export interface RequestValueMapperInterface {
  getTxTypeMappings(): RequestTxTypeMappings

  /**
   * @throws UnsupportedTransactionTypeError when the tx type (or tx type + model) is not mapped
   * @throws Error when the mapping depends on the payment model and none was given
   */
  mapTxType(txType: TxType, paymentModel?: PaymentModel | null, order?: PosOrder | null): string

  mapSecureType(paymentModel: PaymentModel): string

  getSecureTypeMappings(): Partial<Record<PaymentModel, string>>

  mapCurrency(currency: Currency): string | number

  getCurrencyMappings(): Partial<Record<Currency, string | number>>

  /** Falls back to the TR mapping, then to `lang` itself. */
  mapLang(lang: Lang): string

  getLangMappings(): Partial<Record<Lang, string>>

  getRecurringOrderFrequencyMappings(): Partial<Record<RecurringFrequency, string>>

  mapRecurringFrequency(period: RecurringFrequency | string): string

  /** Keys are CARD_TYPE values. */
  getCardTypeMappings(): Record<string, string>

  mapCardType(cardType: CardType | string): string

  mapCardClass(cardClass: string | null): string
}
