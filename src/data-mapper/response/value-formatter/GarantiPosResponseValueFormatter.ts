import type { TxType } from '../../../PosInterface.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import { AbstractResponseValueFormatter } from './AbstractResponseValueFormatter.js'

export class GarantiPosResponseValueFormatter extends AbstractResponseValueFormatter {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'GarantiPos'
  }

  override formatInstallment(installment: string | null | undefined, txType: TxType | string): number {
    if (installment === null || installment === undefined) {
      return 0
    }

    // The order list answer writes a single payment as "Pesin" or "1".
    if (txType === QUERY_TYPE.HISTORY && (installment === 'Pesin' || installment === '1')) {
      return 0
    }

    return super.formatInstallment(installment, txType)
  }

  /** Amounts come in minor units: `100001` -> 1000.01. */
  override formatAmount(amount: string | number, txType: TxType | string): number {
    return super.formatAmount(amount, txType) / 100
  }
}
