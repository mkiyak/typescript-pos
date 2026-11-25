import { PosError } from '../../../errors.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import type { TxType } from '../../../PosInterface.js'
import { toKurus } from '../../../util/toKurus.js'
import { BANK_TIMEZONE_OFFSET_MINUTES } from '../../response/value-formatter/AbstractResponseValueFormatter.js'
import type { RequestValueFormatterInterface } from './RequestValueFormatterInterface.js'

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

export class IyzicoPosRequestValueFormatter implements RequestValueFormatterInterface {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'IyzicoPos'
  }

  /** iyzico takes the installment as a plain integer, 1 for a single payment. */
  formatInstallment(installment: number): number {
    return Math.max(installment, 1)
  }

  /**
   * iyzico takes amounts as JSON numbers. The number is built from whole kuruş (`kuruş / 100`), so it is the nearest
   * double of the two-decimal amount and its JSON text is that amount (`10.01`, not `10.009999999999998`). Negative,
   * sub-kuruş, non-finite and 1e13 or larger amounts are refused; zero stays zero.
   */
  formatAmount(amount: number, _txType: TxType | null = null): number {
    if (amount === 0) {
      return 0
    }
    return toKurus(amount) / 100
  }

  /** `expireMonth` is `MM`, `expireYear` is `YYYY`. */
  formatCardExpDate(card: CreditCard, fieldName: string): string {
    if (fieldName === 'expireMonth') {
      return card.getExpirationDate('m')
    }
    if (fieldName === 'expireYear') {
      return card.getExpirationDate('Y')
    }
    throw new PosError(`Unsupported field name "${fieldName}"`)
  }

  /** `YYYY-MM-DD` in Türkiye time, independent of the server zone. */
  formatDateTime(dateTime: Date, _fieldName: string | null = null): string {
    if (!(dateTime instanceof Date) || Number.isNaN(dateTime.getTime())) {
      throw new PosError('Invalid date')
    }
    const local = new Date(dateTime.getTime() + BANK_TIMEZONE_OFFSET_MINUTES * 60_000)
    const year = local.getUTCFullYear()
    if (year < 0 || year > 9999) {
      throw new PosError('Date year is out of range')
    }
    return `${pad(year, 4)}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
  }
}
