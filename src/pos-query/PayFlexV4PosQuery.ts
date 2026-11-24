import { PayFlexV4Pos } from '../gateway/PayFlexV4Pos.js'
import type { PayFlexPosAccount } from '../model/account/PayFlexPosAccount.js'
import { AbstractPosQuery } from './AbstractPosQuery.js'
import type { QueryType } from './PosQueryInterface.js'

/**
 * Custom queries for PayFlexV4Pos: the request is built by the query request mapper and sent through the gateway's own
 * HTTP client. This bank API offers no normalized history, so `history()` rejects as unsupported.
 */
export class PayFlexV4PosQuery extends AbstractPosQuery<PayFlexPosAccount> {
  static override readonly GATEWAY_CLASS: string = PayFlexV4Pos.GATEWAY_CLASS

  protected static override supportedQueries: Partial<Record<QueryType, boolean>> = {
    custom_query: true,
    history: false,
  }
}
