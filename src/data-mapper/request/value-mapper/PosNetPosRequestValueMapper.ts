import { CURRENCY, type Currency, LANG, TX_TYPE } from '../../../PosInterface.js'
import { AbstractRequestValueMapper } from './AbstractRequestValueMapper.js'
import type { RequestTxTypeMappings } from './RequestValueMapperInterface.js'

export class PosNetPosRequestValueMapper extends AbstractRequestValueMapper {
  protected override langMappings = {
    [LANG.TR]: 'tr',
    [LANG.EN]: 'en',
  }

  protected override txTypeMappings: RequestTxTypeMappings = {
    [TX_TYPE.PAY_AUTH]: 'Sale',
    [TX_TYPE.PAY_PRE_AUTH]: 'Auth',
    [TX_TYPE.PAY_POST_AUTH]: 'Capt',
    [TX_TYPE.CANCEL]: 'reverse',
    [TX_TYPE.REFUND]: 'return',
    [TX_TYPE.REFUND_PARTIAL]: 'return',
    [TX_TYPE.STATUS]: 'agreement',
  }

  protected override currencyMappings: Partial<Record<Currency, string | number>> = {
    [CURRENCY.TRY]: 'TL',
    [CURRENCY.USD]: 'US',
    [CURRENCY.EUR]: 'EU',
    [CURRENCY.GBP]: 'GB',
    [CURRENCY.JPY]: 'JP',
    [CURRENCY.RUB]: 'RU',
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PosNetPos'
  }
}
