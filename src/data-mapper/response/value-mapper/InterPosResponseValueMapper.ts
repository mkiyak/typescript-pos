import { CURRENCY, type Currency } from '../../../PosInterface.js'
import { AbstractResponseValueMapper } from './AbstractResponseValueMapper.js'

/**
 * Response value mapper of the InterPos gateway. Currencies come back as numeric ISO codes; the answers carry no
 * transaction type, secure type or order status words, so those lookups keep the inherited "not supported" behaviour.
 */
export class InterPosResponseValueMapper extends AbstractResponseValueMapper {
  protected override currencyMappings: Record<string, Currency> = {
    '949': CURRENCY.TRY,
    '840': CURRENCY.USD,
    '978': CURRENCY.EUR,
    '826': CURRENCY.GBP,
    '392': CURRENCY.JPY,
    '643': CURRENCY.RUB,
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'InterPos'
  }
}
