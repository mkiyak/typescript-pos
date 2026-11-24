import { PosError } from '../../../errors.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import type { TxType } from '../../../PosInterface.js'
import { QUERY_TYPE, type QueryType } from '../../../pos-query/PosQueryInterface.js'
import { numberFormat2 } from '../../../util/numberFormat2.js'
import { BANK_TIMEZONE_OFFSET_MINUTES } from '../../response/value-formatter/AbstractResponseValueFormatter.js'
import type { RequestValueFormatterInterface } from './RequestValueFormatterInterface.js'

const two = (value: number): string => String(value).padStart(2, '0')

export class GarantiPosRequestValueFormatter implements RequestValueFormatterInterface {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'GarantiPos'
  }

  /** 0 => '', 1 => '', 2 => '2' */
  formatInstallment(installment: number): string {
    return installment > 1 ? String(installment) : ''
  }

  /** The amount in kuruş: 100 => 10000, 10.01 => 1001. Rounded like a two-decimal money format, never truncated. */
  formatAmount(amount: number, _txType: TxType | null = null): number {
    return Number(numberFormat2(amount).replace('.', ''))
  }

  formatCardExpDate(card: CreditCard, fieldName: string): string {
    switch (fieldName) {
      case 'cardexpiredatemonth':
        return card.getExpirationDate('m')
      case 'cardexpiredateyear':
        return card.getExpirationDate('y')
      case 'ExpireDate':
        return card.getExpirationDate('my')
      default:
        throw new PosError('Unsupported field name')
    }
  }

  /** History queries take `14/04/2024 16:45`, everything else `20240414`; both on the Türkiye wall clock. */
  formatDateTime(dateTime: Date, _fieldName: string | null = null, txType: TxType | QueryType | null = null): string {
    if (Number.isNaN(dateTime.getTime())) {
      throw new PosError('Invalid date')
    }

    const local = new Date(dateTime.getTime() + BANK_TIMEZONE_OFFSET_MINUTES * 60_000)
    const day = two(local.getUTCDate())
    const month = two(local.getUTCMonth() + 1)
    const year = String(local.getUTCFullYear()).padStart(4, '0')

    if (txType === QUERY_TYPE.HISTORY) {
      return `${day}/${month}/${year} ${two(local.getUTCHours())}:${two(local.getUTCMinutes())}`
    }

    return `${year}${month}${day}`
  }
}
