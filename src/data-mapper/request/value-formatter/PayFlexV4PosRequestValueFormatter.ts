import { PosError } from '../../../errors.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import type { TxType } from '../../../PosInterface.js'
import type { RequestValueFormatterInterface } from './RequestValueFormatterInterface.js'

/** Amounts at or above this are rejected: PHP's own rounding becomes erratic beyond ~7e13, far past any real payment. */
const MAX_AMOUNT = 1e13

/**
 * PHP >= 8.4 `number_format($amount, 2, '.', '')`: `_php_math_round(value, 2, HALF_UP)` without pre-rounding, then
 * `%.2f`. The scaled value is rounded half up, but a value whose scaled form lies just below a tie
 * (0.285 * 100 = 28.499999999999996) is still rounded up when it is not below `(floor + 0.5) / 100`.
 * Verified against PHP 8.5 with a differential run.
 */
function numberFormat2(amount: number): string {
  if (!Number.isFinite(amount) || Math.abs(amount) >= MAX_AMOUNT) {
    throw new PosError(`Invalid amount: ${amount}`)
  }

  const magnitude = Math.abs(amount)
  const floor = Math.floor(magnitude * 100)
  const cents = magnitude >= (floor + 0.5) / 100 ? floor + 1 : floor
  const text = (cents / 100).toFixed(2)

  return amount < 0 && cents !== 0 ? `-${text}` : text
}

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
