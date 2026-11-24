import { PosNetPosRequestValueFormatter } from './PosNetPosRequestValueFormatter.js'

/** Order ids, amounts and expiry dates are written as in the XML API; installments and the 3D prefix differ. */
export class PosNetV1PosRequestValueFormatter extends PosNetPosRequestValueFormatter {
  protected override readonly threeDPrefix = 'TDS_'

  static override supports(gatewayClass: string): boolean {
    return gatewayClass === 'PosNetV1Pos'
  }

  /** 0 => '0', 1 => '0', 2 => '2' */
  override formatInstallment(installment: number): string {
    return installment > 1 ? String(installment) : '0'
  }
}
