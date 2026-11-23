import { PosError } from '../../../errors.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import type { TxType } from '../../../PosInterface.js'
import type { RequestValueFormatterInterface } from './RequestValueFormatterInterface.js'

/**
 * PHP `number_format($amount, 2, '.', '')`: PHP rounds half away from zero on the value's 15 significant digit
 * decimal form (1.005 -> "1.01", 2.675 -> "2.68"), unlike `toFixed`, which rounds the binary value.
 */
function numberFormat2(amount: number): string {
  if (!Number.isFinite(amount) || Math.abs(amount) >= 1e15) {
    throw new PosError(`Invalid amount: ${amount}`)
  }

  const negative = amount < 0
  // toFixed(8) of the 15-digit-rounded value is an exact plain decimal string (no exponent form).
  const [intPart = '0', fraction = ''] = Number(Math.abs(amount).toPrecision(15)).toFixed(8).split('.')
  // Work in thousandths, round the third decimal half-up (magnitude => half away from zero).
  const thousandths = BigInt(intPart + fraction.slice(0, 3).padEnd(3, '0'))
  const hundredths = (thousandths + 5n) / 10n
  const text = hundredths.toString().padStart(3, '0')
  const result = `${text.slice(0, -2)}.${text.slice(-2)}`

  return negative && hundredths !== 0n ? `-${result}` : result
}

/** Intl-free calendar date in the bank's time zone (Europe/Istanbul). */
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
