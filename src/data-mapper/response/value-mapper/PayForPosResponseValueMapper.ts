import { CURRENCY, type Currency, MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import { AbstractResponseValueMapper } from './AbstractResponseValueMapper.js'

/**
 * Response value mapper of the PayFor gateway. Currencies come back as numeric ISO codes, transaction and
 * secure types as the words of the request. The answers carry no order status table, so `mapOrderStatus`
 * keeps the inherited "not supported" behaviour.
 */
export class PayForPosResponseValueMapper extends AbstractResponseValueMapper {
  protected override currencyMappings: Record<string, Currency> = {
    '949': CURRENCY.TRY,
    '840': CURRENCY.USD,
    '978': CURRENCY.EUR,
    '826': CURRENCY.GBP,
    '392': CURRENCY.JPY,
    '643': CURRENCY.RUB,
  }

  /** The history query is not a transaction type, yet its answer reports the type word of the query. */
  protected override txTypeMappings = {
    [TX_TYPE.PAY_AUTH]: 'Auth',
    [TX_TYPE.PAY_PRE_AUTH]: 'PreAuth',
    [TX_TYPE.PAY_POST_AUTH]: 'PostAuth',
    [TX_TYPE.CANCEL]: 'Void',
    [TX_TYPE.REFUND]: 'Refund',
    [TX_TYPE.REFUND_PARTIAL]: 'Refund',
    [QUERY_TYPE.HISTORY]: 'TxnHistory',
    [TX_TYPE.STATUS]: 'OrderInquiry',
  } as Partial<Record<TxType, string>>

  protected override secureTypeMappings: Record<string, PaymentModel> = {
    '3DModel': MODEL.THREE_D_SECURE,
    '3DPay': MODEL.THREE_D_PAY,
    '3DHost': MODEL.THREE_D_HOST,
    NonSecure: MODEL.NON_SECURE,
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayForPos'
  }
}
