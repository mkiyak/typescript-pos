import { CURRENCY, type Currency, LANG, type Lang } from '../../../PosInterface.js'
import { AbstractRequestValueMapper } from './AbstractRequestValueMapper.js'

/**
 * iyzico request values: ISO 4217 currency letters and the two languages. The operation is chosen by the endpoint,
 * so there are no transaction type, payment model, card type or recurring tables; those lookups answer "not
 * supported" through the base class.
 */
export class IyzicoPosRequestValueMapper extends AbstractRequestValueMapper {
  protected override currencyMappings: Partial<Record<Currency, string | number>> = {
    [CURRENCY.TRY]: 'TRY',
    [CURRENCY.USD]: 'USD',
    [CURRENCY.EUR]: 'EUR',
    [CURRENCY.GBP]: 'GBP',
    [CURRENCY.JPY]: 'JPY',
    [CURRENCY.RUB]: 'RUB',
  }

  protected override langMappings: Partial<Record<Lang, string>> = {
    [LANG.TR]: 'tr',
    [LANG.EN]: 'en',
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'IyzicoPos'
  }
}
