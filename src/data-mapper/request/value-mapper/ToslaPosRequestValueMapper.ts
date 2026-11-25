import { type Currency, TX_TYPE } from '../../../PosInterface.js'
import { AbstractRequestValueMapper } from './AbstractRequestValueMapper.js'
import type { RequestTxTypeMappings } from './RequestValueMapperInterface.js'

/**
 * Tosla request values. The transaction codes are listed for completeness; the API chooses the operation by its URL
 * path, so the codes are not sent in the request bodies. There is no payment model, language, card type or recurring
 * mapping: those lookups answer "not supported" through the base class.
 */
export class ToslaPosRequestValueMapper extends AbstractRequestValueMapper {
  protected override txTypeMappings: RequestTxTypeMappings = {
    [TX_TYPE.PAY_AUTH]: '1',
    [TX_TYPE.PAY_PRE_AUTH]: '2',
    [TX_TYPE.PAY_POST_AUTH]: '3',
    [TX_TYPE.CANCEL]: '4',
    [TX_TYPE.REFUND]: '5',
    [TX_TYPE.REFUND_PARTIAL]: '5',
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'ToslaPos'
  }

  /** The ISO 4217 numeric code as a number: the bank takes `currency` as a JSON number. */
  override mapCurrency(currency: Currency): number {
    return Number(super.mapCurrency(currency))
  }
}
