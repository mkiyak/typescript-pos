import { CURRENCY, type Currency, LANG, type Lang } from '../../../PosInterface.js'
import { AbstractRequestValueMapper } from './AbstractRequestValueMapper.js'

/**
 * PayTR request values: currency and language codes only. The operation is chosen by the endpoint, so there are no
 * transaction type, payment model, card type or recurring tables; those lookups answer "not supported" through the
 * base class.
 */
export class PayTrPosRequestValueMapper extends AbstractRequestValueMapper {
  protected override currencyMappings: Partial<Record<Currency, string | number>> = {
    [CURRENCY.TRY]: 'TL',
    [CURRENCY.USD]: 'USD',
    [CURRENCY.EUR]: 'EUR',
    [CURRENCY.GBP]: 'GBP',
    [CURRENCY.RUB]: 'RUB',
  }

  protected override langMappings: Partial<Record<Lang, string>> = {
    [LANG.TR]: 'tr',
    [LANG.EN]: 'en',
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayTrPos'
  }
}
