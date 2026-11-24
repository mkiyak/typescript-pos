import { CARD_TYPE, CURRENCY, type Currency, MODEL, TX_TYPE } from '../../../PosInterface.js'
import { AbstractRequestValueMapper } from './AbstractRequestValueMapper.js'
import type { RequestTxTypeMappings } from './RequestValueMapperInterface.js'

/** Kuveyt Turk: numeric currency codes as four-digit text, no language or recurring tables. */
export class KuveytPosRequestValueMapper extends AbstractRequestValueMapper {
  protected override currencyMappings: Partial<Record<Currency, string>> = {
    [CURRENCY.TRY]: '0949',
    [CURRENCY.USD]: '0840',
    [CURRENCY.EUR]: '0978',
  }

  protected override cardTypeMappings: Record<string, string> = {
    [CARD_TYPE.VISA]: 'Visa',
    [CARD_TYPE.MASTERCARD]: 'MasterCard',
    [CARD_TYPE.TROY]: 'Troy',
  }

  protected override txTypeMappings: RequestTxTypeMappings = {
    [TX_TYPE.PAY_AUTH]: 'Sale',
    [TX_TYPE.CANCEL]: 'SaleReversal',
    [TX_TYPE.STATUS]: 'GetMerchantOrderDetail',
    [TX_TYPE.REFUND]: 'DrawBack',
    [TX_TYPE.REFUND_PARTIAL]: 'PartialDrawback',
  }

  protected override secureTypeMappings = {
    [MODEL.THREE_D_SECURE]: '3',
    [MODEL.NON_SECURE]: '0',
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'KuveytPos'
  }

  override mapCurrency(currency: Currency): string {
    return String(super.mapCurrency(currency))
  }
}
