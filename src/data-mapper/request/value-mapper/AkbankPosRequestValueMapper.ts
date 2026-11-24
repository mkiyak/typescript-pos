import { CURRENCY, type Currency, LANG, MODEL, TX_TYPE } from '../../../PosInterface.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import { AbstractRequestValueMapper } from './AbstractRequestValueMapper.js'
import type { RequestTxTypeMappings } from './RequestValueMapperInterface.js'

export class AkbankPosRequestValueMapper extends AbstractRequestValueMapper {
  protected override txTypeMappings: RequestTxTypeMappings = {
    [TX_TYPE.PAY_AUTH]: {
      [MODEL.NON_SECURE]: '1000',
      [MODEL.THREE_D_SECURE]: '3000',
      [MODEL.THREE_D_PAY]: '3000',
      [MODEL.THREE_D_HOST]: '3000',
    },
    [TX_TYPE.PAY_PRE_AUTH]: {
      [MODEL.NON_SECURE]: '1004',
      [MODEL.THREE_D_SECURE]: '3004',
      [MODEL.THREE_D_PAY]: '3004',
      [MODEL.THREE_D_HOST]: '3004',
    },
    [TX_TYPE.PAY_POST_AUTH]: '1005',
    [TX_TYPE.REFUND]: '1002',
    [TX_TYPE.REFUND_PARTIAL]: '1002',
    [TX_TYPE.CANCEL]: '1003',
    [TX_TYPE.ORDER_HISTORY]: '1010',
    [QUERY_TYPE.HISTORY]: '1009',
  }

  protected override currencyMappings: Partial<Record<Currency, string | number>> = {
    [CURRENCY.TRY]: 949,
    [CURRENCY.USD]: 840,
    [CURRENCY.EUR]: 978,
    [CURRENCY.GBP]: 826,
    [CURRENCY.JPY]: 392,
    [CURRENCY.RUB]: 643,
  }

  protected override recurringOrderFrequencyMappings = {
    DAY: 'D',
    WEEK: 'W',
    MONTH: 'M',
    YEAR: 'Y',
  } as const

  protected override secureTypeMappings = {
    [MODEL.THREE_D_SECURE]: '3D',
    [MODEL.THREE_D_PAY]: '3D_PAY',
    [MODEL.THREE_D_HOST]: '3D_PAY_HOSTING',
    [MODEL.NON_SECURE]: 'PAY_HOSTING',
  }

  protected override langMappings = {
    [LANG.TR]: 'TR',
    [LANG.EN]: 'EN',
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'AkbankPos'
  }
}
