import { type Currency, LANG, MODEL, TX_TYPE } from '../../../PosInterface.js'
import { AbstractRequestValueMapper } from './AbstractRequestValueMapper.js'

export class AssecoPosRequestValueMapper extends AbstractRequestValueMapper {
  protected override langMappings = {
    [LANG.TR]: 'tr',
    [LANG.EN]: 'en',
  }

  protected override txTypeMappings = {
    [TX_TYPE.PAY_AUTH]: 'Auth',
    [TX_TYPE.PAY_PRE_AUTH]: 'PreAuth',
    [TX_TYPE.PAY_POST_AUTH]: 'PostAuth',
    [TX_TYPE.CANCEL]: 'Void',
    [TX_TYPE.REFUND]: 'Credit',
    [TX_TYPE.REFUND_PARTIAL]: 'Credit',
    [TX_TYPE.STATUS]: 'ORDERSTATUS',
    [TX_TYPE.ORDER_HISTORY]: 'ORDERHISTORY',
  }

  protected override recurringOrderFrequencyMappings = {
    DAY: 'D',
    WEEK: 'W',
    MONTH: 'M',
    YEAR: 'Y',
  } as const

  protected override secureTypeMappings = {
    [MODEL.THREE_D_SECURE]: '3d',
    [MODEL.THREE_D_PAY]: '3d_pay',
    [MODEL.THREE_D_PAY_HOSTING]: '3d_pay_hosting',
    [MODEL.THREE_D_HOST]: '3d_host',
    [MODEL.NON_SECURE]: 'regular',
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'AssecoPos'
  }

  override mapCurrency(currency: Currency): string {
    return String(super.mapCurrency(currency))
  }
}
