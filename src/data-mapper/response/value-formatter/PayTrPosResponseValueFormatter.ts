import { TX_TYPE } from '../../../PosInterface.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import { AbstractResponseValueFormatter, phpFloat } from './AbstractResponseValueFormatter.js'

/**
 * Value formatter of the PayTR gateway. Notification amounts are integers in kuruş; status and history answers print
 * decimal lira (`10.00`, sometimes `1,16`); refund answers print decimal lira with a dot. The results are display
 * values: callers compare kuruş integers, never these floats.
 */
export class PayTrPosResponseValueFormatter extends AbstractResponseValueFormatter {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayTrPos'
  }

  override formatAmount(amount: string | number, txType: string): number {
    if (txType === TX_TYPE.STATUS || txType === QUERY_TYPE.HISTORY) {
      // "1,16" is 1.16
      return phpFloat(String(amount).replaceAll(',', '.'))
    }
    if (txType === TX_TYPE.REFUND) {
      return phpFloat(amount)
    }

    return phpFloat(amount) / 100
  }
}
