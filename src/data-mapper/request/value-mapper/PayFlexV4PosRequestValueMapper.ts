import { CARD_TYPE, type Currency, TX_TYPE } from '../../../PosInterface.js'
import { AbstractRequestValueMapper } from './AbstractRequestValueMapper.js'

export class PayFlexV4PosRequestValueMapper extends AbstractRequestValueMapper {
  protected override cardTypeMappings: Record<string, string> = {
    [CARD_TYPE.VISA]: '100',
    [CARD_TYPE.MASTERCARD]: '200',
    [CARD_TYPE.TROY]: '300',
    [CARD_TYPE.AMEX]: '400',
  }

  protected override txTypeMappings = {
    [TX_TYPE.PAY_AUTH]: 'Sale',
    [TX_TYPE.PAY_PRE_AUTH]: 'Auth',
    [TX_TYPE.PAY_POST_AUTH]: 'Capture',
    [TX_TYPE.CANCEL]: 'Cancel',
    [TX_TYPE.REFUND]: 'Refund',
    [TX_TYPE.REFUND_PARTIAL]: 'Refund',
    [TX_TYPE.STATUS]: 'status',
  }

  protected override recurringOrderFrequencyMappings = {
    DAY: 'Day',
    MONTH: 'Month',
    YEAR: 'Year',
  } as const

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayFlexV4Pos'
  }

  override mapCurrency(currency: Currency): string {
    return String(super.mapCurrency(currency))
  }
}
