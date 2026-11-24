import { PosError } from '../../../errors.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import type { TxType } from '../../../PosInterface.js'
import { numberFormat2 } from '../../../util/numberFormat2.js'
import { BANK_TIMEZONE_OFFSET_MINUTES } from '../../response/value-formatter/AbstractResponseValueFormatter.js'
import type { RequestValueFormatterInterface } from './RequestValueFormatterInterface.js'

const pad = (value: number, width = 2): string => String(value).padStart(width, '0')

export class AkbankPosRequestValueFormatter implements RequestValueFormatterInterface {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'AkbankPos'
  }

  /** 0 => 1, 1 => 1, 2 => 2 */
  formatInstallment(installment: number): number {
    if (!Number.isInteger(installment) || installment < 0) {
      throw new PosError(`Invalid installment: ${installment}`)
    }
    return Math.max(installment, 1)
  }

  /** Two decimals as a string (1.1 => '1.10'); the bank takes the amount as a JSON string. */
  formatAmount(amount: number, _txType: TxType | null = null): string {
    return numberFormat2(amount)
  }

  /** Month and two-digit year (`0424`) for every field. */
  formatCardExpDate(card: CreditCard, _fieldName: string): string {
    return card.getExpirationDate('my')
  }

  /** Türkiye wall clock with a literal `.000`, e.g. 2024-04-14T16:45:30.000 */
  formatDateTime(dateTime: Date, _fieldName: string | null = null): string {
    if (Number.isNaN(dateTime.getTime())) {
      throw new PosError('Invalid date')
    }

    const local = new Date(dateTime.getTime() + BANK_TIMEZONE_OFFSET_MINUTES * 60_000)
    const date = `${pad(local.getUTCFullYear(), 4)}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
    const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`

    return `${date}T${time}.000`
  }
}
