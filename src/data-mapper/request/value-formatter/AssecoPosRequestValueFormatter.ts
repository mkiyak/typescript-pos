import { NotImplementedError, PosError } from '../../../errors.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import type { TxType } from '../../../PosInterface.js'
import type { RequestValueFormatterInterface } from './RequestValueFormatterInterface.js'

/**
 * PHP `(string) $float` (the `precision` ini, default 14 significant digits): 1.005 -> "1.005", 10 -> "10",
 * 0.1 + 0.2 -> "0.3". Values PHP would print in exponent form (>= 1e14 or < 1e-4) are rejected.
 */
function phpFloatToString(amount: number): string {
  if (!Number.isFinite(amount)) {
    throw new PosError(`Invalid amount: ${amount}`)
  }
  if (amount === 0) return '0'
  const abs = Math.abs(amount)
  if (abs >= 1e14 || abs < 1e-4) {
    throw new PosError(`Amount out of supported range: ${amount}`)
  }
  return String(Number(amount.toPrecision(14)))
}

export class AssecoPosRequestValueFormatter implements RequestValueFormatterInterface {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'AssecoPos'
  }

  /** 0 => '', 1 => '', 2 => '2' */
  formatInstallment(installment: number): string {
    return installment > 1 ? String(installment) : ''
  }

  formatAmount(amount: number, _txType: TxType | null = null): string {
    return phpFloatToString(amount)
  }

  formatCardExpDate(card: CreditCard, fieldName: string): string {
    switch (fieldName) {
      case 'Ecom_Payment_Card_ExpDate_Month':
        return card.getExpirationDate('m')
      case 'Ecom_Payment_Card_ExpDate_Year':
        return card.getExpirationDate('y')
      case 'Expires':
        return card.getExpirationDate('m/y')
      default:
        throw new PosError('Unsupported field name')
    }
  }

  formatDateTime(_dateTime: Date, _fieldName: string | null = null): string {
    throw new NotImplementedError()
  }
}
