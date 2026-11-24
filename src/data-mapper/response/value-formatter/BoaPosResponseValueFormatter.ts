import { AbstractResponseValueFormatter, phpFloat } from './AbstractResponseValueFormatter.js'

/** Transaction types whose answers already carry the amount in lira. */
const LIRA_TYPES = new Set(['status', 'order_history', 'history'])

/** Value formatter of the BOA gateways (Kuveyt Turk, Vakif Katilim): payment answers carry amounts in kuruş. */
export class BoaPosResponseValueFormatter extends AbstractResponseValueFormatter {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'KuveytPos' || gatewayClass === 'VakifKatilimPos'
  }

  /** For display only: checks compare the bank's kuruş text, never this float. */
  override formatAmount(amount: string | number, txType: string): number {
    return LIRA_TYPES.has(txType) ? phpFloat(amount) : phpFloat(amount) / 100
  }
}
