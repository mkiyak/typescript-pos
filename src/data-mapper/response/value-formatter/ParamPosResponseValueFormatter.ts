import { PosError } from '../../../errors.js'
import { TX_TYPE } from '../../../PosInterface.js'
import { AbstractResponseValueFormatter } from './AbstractResponseValueFormatter.js'

/** Status records print amounts with a dot; every other answer may print a comma or a dot. */
const DOT_AMOUNT = /^\d{1,13}(?:\.\d{1,4})?$/
const ANY_AMOUNT = /^\d{1,13}(?:[.,]\d{1,4})?$/

const DOTTED_DAY_MONTH = /^(\d{1,2})\.(\d{1,2})\.(?=\d{4}(?:[T ]|$))/

/** Value formatter of the Param gateways. */
export class ParamPosResponseValueFormatter extends AbstractResponseValueFormatter {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'ParamPos' || gatewayClass === 'Param3DHostPos'
  }

  /**
   * A display value read from strict amount text (digits with at most four decimals, a comma or a dot). Anything
   * else (empty, signs, exponents, thousands separators, padding) is an error rather than zero or a prefix.
   * Callers compare amounts as integer kuruş, never with this float.
   */
  override formatAmount(amount: string | number, txType: string): number {
    if (typeof amount === 'number') {
      if (!Number.isFinite(amount) || amount < 0) {
        throw new PosError('Unsupported amount')
      }

      return amount
    }
    const pattern = txType === TX_TYPE.STATUS ? DOT_AMOUNT : ANY_AMOUNT
    if (typeof amount !== 'string' || !pattern.test(amount)) {
      throw new PosError(`Unsupported amount: "${String(amount).slice(0, 32)}"`)
    }

    return Number(amount.replace(',', '.'))
  }

  /** The bank prints one- or two-digit days and months (`5.01.2025 14:52:20`); they are padded before parsing. */
  override formatDateTime(dateTime: string, txType: string): Date {
    if (typeof dateTime !== 'string') {
      throw new PosError('Unsupported date time format')
    }
    const value = dateTime.trim().replace(DOTTED_DAY_MONTH, (_match, day: string, month: string) => {
      return `${day.padStart(2, '0')}.${month.padStart(2, '0')}.`
    })

    return super.formatDateTime(value, txType)
  }
}
