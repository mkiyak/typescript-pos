import { CARD_CLASS, MODEL, TX_TYPE } from '../../../PosInterface.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import { AbstractRequestValueMapper } from './AbstractRequestValueMapper.js'
import type { RequestTxTypeMappings } from './RequestValueMapperInterface.js'

export class GarantiPosRequestValueMapper extends AbstractRequestValueMapper {
  protected override txTypeMappings: RequestTxTypeMappings = {
    [TX_TYPE.PAY_AUTH]: 'sales',
    [TX_TYPE.PAY_PRE_AUTH]: 'preauth',
    [TX_TYPE.PAY_POST_AUTH]: 'postauth',
    [TX_TYPE.CANCEL]: 'void',
    [TX_TYPE.REFUND]: 'refund',
    [TX_TYPE.REFUND_PARTIAL]: 'refund',
    [TX_TYPE.ORDER_HISTORY]: 'orderhistoryinq',
    [QUERY_TYPE.HISTORY]: 'orderlistinq',
    [QUERY_TYPE.BIN_LIST]: 'bininq',
    [TX_TYPE.STATUS]: 'orderinq',
  }

  protected override recurringOrderFrequencyMappings = {
    DAY: 'D',
    WEEK: 'W',
    MONTH: 'M',
  } as const

  protected override secureTypeMappings = {
    [MODEL.THREE_D_SECURE]: '3D',
    [MODEL.THREE_D_PAY]: '3D_PAY',
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'GarantiPos'
  }

  /** The BIN inquiry card type filter: credit `C`, debit `D`, anything else (or no class) `A` for all. */
  override mapCardClass(cardClass: string | null): string {
    switch (cardClass) {
      case CARD_CLASS.CREDIT:
        return 'C'
      case CARD_CLASS.DEBIT:
        return 'D'
      default:
        return 'A'
    }
  }
}
