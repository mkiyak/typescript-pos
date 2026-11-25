import { PosError } from '../../../errors.js'
import { TX_TYPE } from '../../../PosInterface.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import { AbstractResponseValueFormatter } from './AbstractResponseValueFormatter.js'

const EPOCH_MILLISECONDS = /^\d{1,16}$/
const DECIMAL = /^\d{1,13}(?:\.\d+)?$/
/** Amounts at or above this are not payments (the request side refuses them too). */
const MAX_AMOUNT = 1e13

/**
 * Value formatter of the iyzico gateway. Payment, cancel, refund and status answers print `systemTime` as epoch
 * milliseconds; the reporting answers print `YYYY-MM-DD HH:mm:ss` (Türkiye time) or ISO text with an offset.
 * Amounts are display values (iyzico prints lira with decimals): callers compare kuruş integers, never these floats.
 */
export class IyzicoPosResponseValueFormatter extends AbstractResponseValueFormatter {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'IyzicoPos'
  }

  /** @throws PosError for a value that is not a finite number from 0 up to (not including) 1e13, or a decimal text */
  override formatAmount(amount: string | number, _txType: string): number {
    if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && amount < MAX_AMOUNT) return amount
    if (typeof amount === 'string' && DECIMAL.test(amount)) return Number(amount)

    throw new PosError('The amount of the bank answer is not readable')
  }

  /** @throws PosError for a time that cannot be read */
  override formatDateTime(dateTime: string, txType: string): Date {
    if (txType === QUERY_TYPE.HISTORY || txType === TX_TYPE.ORDER_HISTORY) {
      return super.formatDateTime(dateTime, txType)
    }

    if (!EPOCH_MILLISECONDS.test(dateTime)) {
      throw new PosError('The time of the bank answer is not readable')
    }
    const date = new Date(Math.floor(Number(dateTime) / 1000) * 1000)
    if (Number.isNaN(date.getTime())) {
      throw new PosError('The time of the bank answer is not readable')
    }

    return date
  }
}
