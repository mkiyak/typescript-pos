import { TX_TYPE } from '../../../PosInterface.js'
import { PosNetPosRequestValueMapper } from './PosNetPosRequestValueMapper.js'
import type { RequestTxTypeMappings } from './RequestValueMapperInterface.js'

/** The JSON API shares languages and currency codes with the XML one; only the transaction names differ. */
export class PosNetV1PosRequestValueMapper extends PosNetPosRequestValueMapper {
  protected override txTypeMappings: RequestTxTypeMappings = {
    [TX_TYPE.PAY_AUTH]: 'Sale',
    [TX_TYPE.PAY_PRE_AUTH]: 'Auth',
    [TX_TYPE.PAY_POST_AUTH]: 'Capture',
    [TX_TYPE.CANCEL]: 'Reverse',
    [TX_TYPE.REFUND]: 'Return',
    [TX_TYPE.REFUND_PARTIAL]: 'Return',
    [TX_TYPE.STATUS]: 'TransactionInquiry',
  }

  static override supports(gatewayClass: string): boolean {
    return gatewayClass === 'PosNetV1Pos'
  }
}
