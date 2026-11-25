import { NotImplementedError } from '../../../errors.js'
import { AbstractResponseValueFormatter, phpFloat } from './AbstractResponseValueFormatter.js'

/** Value formatter of the Tosla gateway: amounts are integers in kuruş, shown here as lira. */
export class ToslaPosResponseValueFormatter extends AbstractResponseValueFormatter {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'ToslaPos'
  }

  override formatInstallment(): number {
    throw new NotImplementedError('Installment formatting is not supported')
  }

  /** `'1001'` is 10.01. A display value only: callers compare kuruş integers, never this float. */
  override formatAmount(amount: string | number, _txType: string): number {
    return phpFloat(amount) / 100
  }
}
