import { NotImplementedError, PosError } from '../../../errors.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import type { TxType } from '../../../PosInterface.js'
import { numberFormat2 } from '../../../util/numberFormat2.js'
import type { RequestValueFormatterInterface } from './RequestValueFormatterInterface.js'

export class PayFlexCPV4PosRequestValueFormatter implements RequestValueFormatterInterface {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayFlexCPV4Pos'
  }

  /** 0 => '0', 1 => '0', 2 => '2' */
  formatInstallment(installment: number): string {
    return installment > 1 ? String(installment) : '0'
  }

  /** ex: 10.1 => '10.10' */
  formatAmount(amount: number, _txType: TxType | null = null): string {
    return numberFormat2(amount)
  }

  /** 'ExpireMonth' => 'm' (04), 'ExpireYear' => 'Y' (2024, four digits per guide section 4), 'Expiry' => 'Ym' (202404) */
  formatCardExpDate(card: CreditCard, fieldName: string): string {
    if (fieldName === 'ExpireMonth') {
      return card.getExpirationDate('m')
    }
    if (fieldName === 'ExpireYear') {
      return card.getExpirationDate('Y')
    }
    if (fieldName === 'Expiry') {
      return card.getExpirationDate('Ym')
    }

    throw new PosError('Unsupported field name')
  }

  formatDateTime(_dateTime: Date, _fieldName: string | null = null): string {
    throw new NotImplementedError('Date formatting is not supported.')
  }
}
