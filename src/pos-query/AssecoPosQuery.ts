import { AssecoPos } from '../gateway/AssecoPos.js'
import type { AssecoPosAccount } from '../model/account/AssecoPosAccount.js'
import { AbstractPosQuery } from './AbstractPosQuery.js'
import type { QueryType } from './PosQueryInterface.js'

/**
 * Custom queries for AssecoPos: the request is built by the query request mapper and sent through the gateway's own
 * HTTP client. This bank API offers no normalized history, so `history()` rejects as unsupported.
 */
export class AssecoPosQuery extends AbstractPosQuery<AssecoPosAccount> {
  static override readonly GATEWAY_CLASS: string = AssecoPos.GATEWAY_CLASS

  protected static override supportedQueries: Partial<Record<QueryType, boolean>> = {
    custom_query: true,
    history: false,
  }
}
