import { CARD_TYPE, type Currency, LANG, MODEL, TX_TYPE } from '../../../PosInterface.js'
import { AbstractRequestValueMapper } from './AbstractRequestValueMapper.js'
import type { RequestTxTypeMappings } from './RequestValueMapperInterface.js'

export class InterPosRequestValueMapper extends AbstractRequestValueMapper {
  protected override langMappings = {
    [LANG.TR]: 'tr',
    [LANG.EN]: 'en',
  }

  protected override cardTypeMappings: Record<string, string> = {
    [CARD_TYPE.VISA]: '0',
    [CARD_TYPE.MASTERCARD]: '1',
    [CARD_TYPE.AMEX]: '2',
    [CARD_TYPE.TROY]: '3',
  }

  protected override txTypeMappings: RequestTxTypeMappings = {
    [TX_TYPE.PAY_AUTH]: 'Auth',
    [TX_TYPE.PAY_PRE_AUTH]: 'PreAuth',
    [TX_TYPE.PAY_POST_AUTH]: 'PostAuth',
    [TX_TYPE.CANCEL]: 'Void',
    [TX_TYPE.REFUND]: 'Refund',
    [TX_TYPE.REFUND_PARTIAL]: 'Refund',
    [TX_TYPE.STATUS]: 'StatusHistory',
  }

  protected override secureTypeMappings = {
    [MODEL.THREE_D_SECURE]: '3DModel',
    [MODEL.THREE_D_PAY]: '3DPay',
    [MODEL.THREE_D_HOST]: '3DHost',
    [MODEL.NON_SECURE]: 'NonSecure',
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'InterPos'
  }

  override mapCurrency(currency: Currency): string {
    return String(super.mapCurrency(currency))
  }
}
