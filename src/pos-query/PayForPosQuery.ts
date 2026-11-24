import { PayForPos } from '../gateway/PayForPos.js'
import type { PayForPosAccount } from '../model/account/PayForPosAccount.js'
import { AbstractMappedPosQuery } from './AbstractMappedPosQuery.js'
import type { QueryType } from './PosQueryInterface.js'

/**
 * Queries of the PayFor API. Custom queries get the merchant, user and member id of the account added; `history`
 * lists the transactions of one day (`transaction_date`), while the gateway's `orderHistory` lists those of one order.
 */
export class PayForPosQuery extends AbstractMappedPosQuery<PayForPosAccount> {
  static override readonly GATEWAY_CLASS: string = PayForPos.GATEWAY_CLASS

  protected static override supportedQueries: Partial<Record<QueryType, boolean>> = {
    custom_query: true,
    history: true,
  }
}
