import { CURRENCY, type Currency, TX_TYPE, type TxType } from '../../../PosInterface.js'
import { AbstractResponseValueMapper } from './AbstractResponseValueMapper.js'

/** Response value mapper of the POSNET XML gateway; order status and secure type tables do not exist. */
export class PosNetPosResponseValueMapper extends AbstractResponseValueMapper {
  protected override currencyMappings: Record<string, Currency> = {
    TL: CURRENCY.TRY,
    US: CURRENCY.USD,
    EU: CURRENCY.EUR,
    GB: CURRENCY.GBP,
    JP: CURRENCY.JPY,
    RU: CURRENCY.RUB,
  }

  protected override txTypeMappings: Partial<Record<TxType, string>> = {
    [TX_TYPE.PAY_AUTH]: 'Sale',
    [TX_TYPE.PAY_PRE_AUTH]: 'Auth',
    [TX_TYPE.PAY_POST_AUTH]: 'Capt',
    [TX_TYPE.CANCEL]: 'reverse',
    [TX_TYPE.REFUND]: 'return',
    [TX_TYPE.REFUND_PARTIAL]: 'return',
    [TX_TYPE.STATUS]: 'agreement',
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PosNetPos'
  }
}
