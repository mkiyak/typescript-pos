import { TX_TYPE, type TxType } from '../../../PosInterface.js'
import { AbstractResponseValueFormatter } from './AbstractResponseValueFormatter.js'

export class AssecoPosResponseValueFormatter extends AbstractResponseValueFormatter {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'AssecoPos'
  }

  /** Status and order history responses return amounts in minor units (`1001` -> 10.01). */
  override formatAmount(amount: string | number, txType: TxType | string): number {
    const value = super.formatAmount(amount, txType)
    if (txType === TX_TYPE.STATUS || txType === TX_TYPE.ORDER_HISTORY) {
      return value / 100
    }

    return value
  }
}
