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
   * Parses a bank date-time into an absolute Date. An explicit UTC offset in the input is honoured; without one the
   * value is Türkiye time (UTC+03:00, see BANK_TIMEZONE_OFFSET_MINUTES), independent of the server time zone.
   *
   * @throws PosError for unsupported or out-of-range values
   * @param txType transaction type of the API request
   */
  formatDateTime(dateTime: string, txType: TxType | string): Date
}
