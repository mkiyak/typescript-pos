import { AbstractResponseValueFormatter } from './AbstractResponseValueFormatter.js'

const SUPPORTED = new Set(['AkbankPos', 'PayFlexCPV4Pos', 'PayFlexV4Pos', 'PayForPos'])

/** Default response value formatting. */
export class BasicResponseValueFormatter extends AbstractResponseValueFormatter {
  static supports(gatewayClass: string): boolean {
    return SUPPORTED.has(gatewayClass)
  }
}
