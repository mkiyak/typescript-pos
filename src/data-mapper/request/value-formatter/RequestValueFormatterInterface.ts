import type { CreditCard } from '../../../model/card/CreditCard.js'
import type { TxType } from '../../../PosInterface.js'
import type { QueryType } from '../../../pos-query/PosQueryInterface.js'

/** Formats values for the bank API. */
export interface RequestValueFormatterInterface {
  formatInstallment(installment: number): string | number

  formatAmount(amount: number, txType?: TxType | null): string | number

  /**
   * Formats the card expiry for the given request field (the card is passed and its `getExpirationDate(format)` is used).
   *
   * @throws Error when the field name is not supported
   */
  formatCardExpDate(card: CreditCard, fieldName: string): string

  /** @throws Error when the field name is not supported */
  formatDateTime(dateTime: Date, fieldName?: string | null, txType?: TxType | QueryType | null): string
}
