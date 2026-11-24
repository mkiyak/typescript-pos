import { NotImplementedError } from '../../../errors.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import type { TxType } from '../../../PosInterface.js'
import { numberFormat2 } from '../../../util/numberFormat2.js'
import type { RequestValueFormatterInterface } from './RequestValueFormatterInterface.js'

export class InterPosRequestValueFormatter implements RequestValueFormatterInterface {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'InterPos'
  }

  /** 0 => '', 1 => '', 2 => '2' */
  formatInstallment(installment: number): string {
    return installment > 1 ? String(installment) : ''
  }

  /**
   * Two decimals with trailing zeros dropped: 1.1 => '1.1', 1 => '1', 100.25 => '100.25'. Sub-kuruş values are
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

  formatDateTime(_dateTime: Date, _fieldName: string | null = null): string {
    throw new NotImplementedError('Date formatting is not used by this gateway.')
  }
}
