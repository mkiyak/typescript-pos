import { PosError } from '../../../errors.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import type { TxType } from '../../../PosInterface.js'
import { numberFormat2 } from '../../../util/numberFormat2.js'
import { BANK_TIMEZONE_OFFSET_MINUTES } from '../../response/value-formatter/AbstractResponseValueFormatter.js'
import type { RequestValueFormatterInterface } from './RequestValueFormatterInterface.js'

export class PayForPosRequestValueFormatter implements RequestValueFormatterInterface {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayForPos'
  }

  /** 0 => '0', 1 => '0', 2 => '2' */
  formatInstallment(installment: number): string {
    return installment > 1 ? String(installment) : '0'
  }

  /**
   * Two decimals with trailing zeros dropped: 10.1 => '10.1', 1 => '1', 100.01 => '100.01'. Sub-kuruş values are
   * rounded, so what is signed and sent is a real amount. The caller rejects zero and negative amounts.
   */
  formatAmount(amount: number, _txType: TxType | null = null): string {
    // numberFormat2 always ends in two decimals, so the zeros stripped here are never part of the integer digits
    return numberFormat2(amount).replace(/0+$/, '').replace(/\.$/, '')
  }

  /** 'my' (0424) */
  formatCardExpDate(card: CreditCard, _fieldName: string): string {
    return card.getExpirationDate('my')
  }

  /** The calendar day in Türkiye, e.g. 20240414. */
  formatDateTime(dateTime: Date, _fieldName: string | null = null): string {
    if (Number.isNaN(dateTime.getTime())) {
      throw new PosError('Invalid date')
    }
    const local = new Date(dateTime.getTime() + BANK_TIMEZONE_OFFSET_MINUTES * 60_000)
    const year = String(local.getUTCFullYear()).padStart(4, '0')
    const month = String(local.getUTCMonth() + 1).padStart(2, '0')
    const day = String(local.getUTCDate()).padStart(2, '0')
    return `${year}${month}${day}`
  }
}
