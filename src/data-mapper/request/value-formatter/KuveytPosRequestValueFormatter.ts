import { PosError } from '../../../errors.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import type { TxType } from '../../../PosInterface.js'
import { toKurus } from '../../../util/toKurus.js'
import { BANK_TIMEZONE_OFFSET_MINUTES } from '../../response/value-formatter/AbstractResponseValueFormatter.js'
import type { RequestValueFormatterInterface } from './RequestValueFormatterInterface.js'

export class KuveytPosRequestValueFormatter implements RequestValueFormatterInterface {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'KuveytPos'
  }

  /** 0 => '0', 1 => '0', 2 => '2' */
  formatInstallment(installment: number): string {
    return installment > 1 ? String(installment) : '0'
  }

  /** The amount in kuruş as an integer: 10.01 => 1001, 1.15 => 115 (no truncation of the binary product). */
  formatAmount(amount: number, _txType: TxType | null = null): number {
    return toKurus(amount)
  }

  /** Two-digit year for `CardExpireDateYear`, two-digit month for `CardExpireDateMonth`. */
  formatCardExpDate(card: CreditCard, fieldName: string): string {
    if (fieldName === 'CardExpireDateYear') {
      return card.getExpirationDate('y')
    }
    if (fieldName === 'CardExpireDateMonth') {
      return card.getExpirationDate('m')
    }
    throw new PosError('Unsupported field name')
  }

  /** Türkiye wall-clock time, e.g. 2024-04-14T16:45:30. */
  formatDateTime(dateTime: Date, _fieldName: string | null = null): string {
    if (Number.isNaN(dateTime.getTime())) {
      throw new PosError('Invalid date')
    }
    const local = new Date(dateTime.getTime() + BANK_TIMEZONE_OFFSET_MINUTES * 60_000)
    const two = (n: number): string => String(n).padStart(2, '0')
    const year = String(local.getUTCFullYear()).padStart(4, '0')
    return `${year}-${two(local.getUTCMonth() + 1)}-${two(local.getUTCDate())}T${two(local.getUTCHours())}:${two(local.getUTCMinutes())}:${two(local.getUTCSeconds())}`
  }
}
