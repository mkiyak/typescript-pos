import { PosError } from '../../../errors.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import type { TxType } from '../../../PosInterface.js'
import { toKurus } from '../../../util/toKurus.js'
import { BANK_TIMEZONE_OFFSET_MINUTES } from '../../response/value-formatter/AbstractResponseValueFormatter.js'
import type { RequestValueFormatterInterface } from './RequestValueFormatterInterface.js'

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

export class ToslaPosRequestValueFormatter implements RequestValueFormatterInterface {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'ToslaPos'
  }

  /** 0 => 0, 1 => 0, 2 => 2: one installment means a single payment. */
  formatInstallment(installment: number): number {
    return installment > 1 ? installment : 0
  }

  /**
   * The amount in kuruş as an integer (10.01 => 1001, 1.15 => 115). Computed from the two-decimal text of the
   * amount, so no kuruş is lost to floating point; zero, negative, sub-kuruş and absurdly large amounts are refused.
   */
  formatAmount(amount: number, _txType: TxType | null = null): number {
    return toKurus(amount)
  }

  /** `ExpireDate` (3D form) is `MM/YY`; `expireDate` (API request) is `MMYY`. */
  formatCardExpDate(card: CreditCard, fieldName: string): string {
    if (fieldName === 'ExpireDate') {
      return card.getExpirationDate('m/y')
    }
    if (fieldName === 'expireDate') {
      return card.getExpirationDate('my')
    }
    throw new PosError('Unsupported card expiry field')
  }

  /**
   * Türkiye time: `timeSpan` is `YYYYMMDDHHmmss`, `transactionDate` is `YYYYMMDD`. Independent of the server zone.
   */
  formatDateTime(dateTime: Date, fieldName: string | null = null): string {
    if (fieldName !== 'timeSpan' && fieldName !== 'transactionDate') {
      throw new PosError('Unsupported date field')
    }
    if (!(dateTime instanceof Date) || Number.isNaN(dateTime.getTime())) {
      throw new PosError('Invalid date')
    }
    const local = new Date(dateTime.getTime() + BANK_TIMEZONE_OFFSET_MINUTES * 60_000)
    const day = `${pad(local.getUTCFullYear(), 4)}${pad(local.getUTCMonth() + 1, 2)}${pad(local.getUTCDate(), 2)}`
    if (fieldName === 'transactionDate') {
      return day
    }
    return `${day}${pad(local.getUTCHours(), 2)}${pad(local.getUTCMinutes(), 2)}${pad(local.getUTCSeconds(), 2)}`
  }
}
