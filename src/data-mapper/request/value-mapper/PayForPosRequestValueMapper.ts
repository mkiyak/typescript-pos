import { type Currency, LANG, MODEL, TX_TYPE } from '../../../PosInterface.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import { AbstractRequestValueMapper } from './AbstractRequestValueMapper.js'
import type { RequestTxTypeMappings } from './RequestValueMapperInterface.js'

export class PayForPosRequestValueMapper extends AbstractRequestValueMapper {
  protected override langMappings = {
    [LANG.TR]: 'TR',
    [LANG.EN]: 'EN',
  }

  protected override txTypeMappings: RequestTxTypeMappings = {
    [TX_TYPE.PAY_AUTH]: 'Auth',
    [TX_TYPE.PAY_PRE_AUTH]: 'PreAuth',
    [TX_TYPE.PAY_POST_AUTH]: 'PostAuth',
    [TX_TYPE.CANCEL]: 'Void',
    [TX_TYPE.REFUND]: 'Refund',
    [TX_TYPE.REFUND_PARTIAL]: 'Refund',
    [QUERY_TYPE.HISTORY]: 'TxnHistory',
    [TX_TYPE.STATUS]: 'OrderInquiry',
  }

  protected override secureTypeMappings = {
    [MODEL.THREE_D_SECURE]: '3DModel',
    [MODEL.THREE_D_PAY]: '3DPay',
    [MODEL.THREE_D_HOST]: '3DHost',
    [MODEL.NON_SECURE]: 'NonSecure',
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayForPos'
  }

  override mapCurrency(currency: Currency): string {
    return String(super.mapCurrency(currency))
  }
}
