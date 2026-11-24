import { PosError } from '../../../errors.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import type { TxType } from '../../../PosInterface.js'
import { numberFormat2 } from '../../../util/numberFormat2.js'
import type { RequestValueFormatterInterface } from './RequestValueFormatterInterface.js'

/** Calendar date in the bank's time zone (Europe/Istanbul). */
function istanbulParts(dateTime: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dateTime)
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
  return { year: get('year'), month: get('month'), day: get('day') }
}

export class PayFlexV4PosRequestValueFormatter implements RequestValueFormatterInterface {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayFlexV4Pos'
  }

  /** 0 => '0', 1 => '0', 2 => '2' */
  formatInstallment(installment: number): string {
    return installment > 1 ? String(installment) : '0'
  }

  /** ex: 10.1 => '10.10' */
  formatAmount(amount: number, _txType: TxType | null = null): string {
    return numberFormat2(amount)
  }

  /** 'ExpiryDate' => 'ym' (2404), 'Expiry' => 'Ym' (202404) */
  formatCardExpDate(card: CreditCard, fieldName: string): string {
    if (fieldName === 'ExpiryDate') {
      return card.getExpirationDate('ym')
    }
    if (fieldName === 'Expiry') {
      return card.getExpirationDate('Ym')
    }

    throw new PosError('Unsupported field name')
  }

  /** example: 20240414 */
  formatDateTime(dateTime: Date, _fieldName: string | null = null): string {
    if (Number.isNaN(dateTime.getTime())) {
      throw new PosError('Invalid date')
    }
    const { year, month, day } = istanbulParts(dateTime)
    return `${year}${month}${day}`
  }
}
