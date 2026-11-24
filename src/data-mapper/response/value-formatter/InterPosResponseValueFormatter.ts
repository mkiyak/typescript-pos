import { NotImplementedError } from '../../../errors.js'
import { AbstractResponseValueFormatter, phpFloat } from './AbstractResponseValueFormatter.js'

/** Value formatter of the InterPos gateway: amounts are printed with a decimal comma and dotted thousands. */
export class InterPosResponseValueFormatter extends AbstractResponseValueFormatter {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'InterPos'
  }

  override formatInstallment(): number {
    throw new NotImplementedError('Installment formatting is not supported')
  }

  /** `'0'` is 0, `'1.056,2'` is 1056.2 and `'1,01'` is 1.01: dots are thousands separators, the comma is the decimal mark. */
  override formatAmount(amount: string | number, _txType: string): number {
    return phpFloat(String(amount).replaceAll('.', '').replaceAll(',', '.'))
  }
}
