import type { TxType } from '../../../PosInterface.js'

export interface ResponseValueFormatterInterface {
  /**
   * @param txType transaction type of the API request
   * @returns installment count (>= 2), or 0 for a single payment
   */
  formatInstallment(installment: string | null | undefined, txType: TxType | string): number

  /** @param txType transaction type of the API request */
  formatAmount(amount: string | number, txType: TxType | string): number

  /**
   * Parses a bank date-time into a Date holding the same wall-clock time in the process time zone
   * (any UTC offset in the input is ignored).
   *
   * @param txType transaction type of the API request
   */
  formatDateTime(dateTime: string, txType: TxType | string): Date
}
