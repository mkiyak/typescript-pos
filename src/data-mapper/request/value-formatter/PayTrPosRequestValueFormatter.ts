import { PosError } from '../../../errors.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { TX_TYPE, type TxType } from '../../../PosInterface.js'
import { numberFormat2 } from '../../../util/numberFormat2.js'
import { toKurus } from '../../../util/toKurus.js'
import { BANK_TIMEZONE_OFFSET_MINUTES } from '../../response/value-formatter/AbstractResponseValueFormatter.js'
import type { RequestValueFormatterInterface } from './RequestValueFormatterInterface.js'

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

export class PayTrPosRequestValueFormatter implements RequestValueFormatterInterface {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayTrPos'
  }

  /** 0 => 0, 1 => 0, 2 => 2: PayTR takes 0 for a single payment and 2 to 12 for installments. */
  formatInstallment(installment: number): number {
    return installment > 1 ? installment : 0
  }

  /**
   * The iFrame token request takes the amount in kuruş as an integer (10.5 => 1050, 10.005 => 1001, 1.15 => 115);
   * the direct payment and refund requests take a decimal with a dot (`'10.50'`). Both come from the same two-decimal
   * rounding, so the two forms always name the same amount; zero, negative, sub-kuruş, non-finite and absurdly large
   * amounts are refused.
   */
  formatAmount(amount: number, txType: TxType | null = null): number | string {
    const kurus = toKurus(amount)
    return txType === TX_TYPE.INTERNAL_3D_FORM_BUILD ? kurus : numberFormat2(amount)
  }

  /** `expiry_month` is `MM`, `expiry_year` is `YY`. */
  formatCardExpDate(card: CreditCard, fieldName: string): string {
    if (fieldName === 'expiry_month') {
      return card.getExpirationDate('m')
    }
    if (fieldName === 'expiry_year') {
      return card.getExpirationDate('y')
    }
    throw new PosError(`Unsupported field name "${fieldName}"`)
  }

  /** `YYYY-MM-DD HH:mm:ss` in Türkiye time, independent of the server zone. */
  formatDateTime(dateTime: Date, _fieldName: string | null = null): string {
    if (!(dateTime instanceof Date) || Number.isNaN(dateTime.getTime())) {
      throw new PosError('Invalid date')
    }
    const local = new Date(dateTime.getTime() + BANK_TIMEZONE_OFFSET_MINUTES * 60_000)
    const year = local.getUTCFullYear()
    if (year < 0 || year > 9999) {
      throw new PosError('Date year is out of range')
    }
    const day = `${pad(year, 4)}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
    return `${day} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`
  }
}
