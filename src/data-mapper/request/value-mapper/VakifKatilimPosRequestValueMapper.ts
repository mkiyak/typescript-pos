import { CURRENCY, type Currency, MODEL } from '../../../PosInterface.js'
import { AbstractRequestValueMapper } from './AbstractRequestValueMapper.js'

/**
 * Vakıf Katılım: numeric currency codes as four-digit text and the security codes of its payment API. The bank has
 * no transaction type, card type, language or recurring fields, so those tables stay empty.
 */
export class VakifKatilimPosRequestValueMapper extends AbstractRequestValueMapper {
  protected override currencyMappings: Partial<Record<Currency, string>> = {
    [CURRENCY.TRY]: '0949',
    [CURRENCY.USD]: '0840',
    [CURRENCY.EUR]: '0978',
    [CURRENCY.GBP]: '0826',
    [CURRENCY.JPY]: '0392',
    [CURRENCY.RUB]: '0810',
  }

  protected override secureTypeMappings = {
    [MODEL.THREE_D_SECURE]: '3',
    [MODEL.NON_SECURE]: '5',
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'VakifKatilimPos'
  }

  override mapCurrency(currency: Currency): string {
    return String(super.mapCurrency(currency))
  }
}
