import { CURRENCY, type Currency, MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import { AbstractResponseValueMapper } from './AbstractResponseValueMapper.js'

export class PayFlexV4PosResponseValueMapper extends AbstractResponseValueMapper {
  protected override currencyMappings: Record<string, Currency> = {
    '949': CURRENCY.TRY,
    '840': CURRENCY.USD,
    '978': CURRENCY.EUR,
    '826': CURRENCY.GBP,
    '392': CURRENCY.JPY,
    '643': CURRENCY.RUB,
  }

  protected override txTypeMappings: Partial<Record<TxType, string>> = {
    [TX_TYPE.PAY_AUTH]: 'Sale',
    [TX_TYPE.PAY_PRE_AUTH]: 'Auth',
    [TX_TYPE.PAY_POST_AUTH]: 'Capture',
    [TX_TYPE.CANCEL]: 'Cancel',
    [TX_TYPE.REFUND]: 'Refund',
    [TX_TYPE.REFUND_PARTIAL]: 'Refund',
    [TX_TYPE.STATUS]: 'status',
  }

  /** ThreeDSecureType: 1 non-secure, 2 3D Secure, 3 3D Pay. */
  protected override secureTypeMappings: Record<string, PaymentModel> = {
    '1': MODEL.NON_SECURE,
    '2': MODEL.THREE_D_SECURE,
    '3': MODEL.THREE_D_PAY,
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayFlexV4Pos'
  }
}
