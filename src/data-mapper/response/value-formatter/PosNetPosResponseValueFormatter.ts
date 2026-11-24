import type { TxType } from '../../../PosInterface.js'
import { AbstractResponseValueFormatter, phpFloat, phpInt } from './AbstractResponseValueFormatter.js'

/** Value formatter shared by both POSNET gateways. */
export class PosNetPosResponseValueFormatter extends AbstractResponseValueFormatter {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PosNetPos' || gatewayClass === 'PosNetV1Pos'
  }

  /** Status answers print amounts as "1.056,2"; everything else is a whole number of minor units. */
  override formatAmount(amount: string | number, txType: TxType | string): number {
    if (txType === 'status') {
      return phpFloat(String(amount).replaceAll('.', '').replaceAll(',', '.'))
    }

    return phpInt(String(amount)) / 100
  }
}
