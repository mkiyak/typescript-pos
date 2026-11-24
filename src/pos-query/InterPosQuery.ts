import { InterPos } from '../gateway/InterPos.js'
import type { InterPosAccount } from '../model/account/InterPosAccount.js'
import { AbstractPosQuery } from './AbstractPosQuery.js'
import type { QueryType } from './PosQueryInterface.js'

/**
 * Custom queries for InterPos: the user code, user password and shop code of the account are added when the caller
 * has not set them, and the data is posted form-urlencoded to the `payment_api` endpoint. The bank API offers no
 * normalized history, so `history()` rejects as unsupported.
 */
export class InterPosQuery extends AbstractPosQuery<InterPosAccount> {
  static override readonly GATEWAY_CLASS: string = InterPos.GATEWAY_CLASS

  protected static override supportedQueries: Partial<Record<QueryType, boolean>> = {
    custom_query: true,
    history: false,
  }
}
