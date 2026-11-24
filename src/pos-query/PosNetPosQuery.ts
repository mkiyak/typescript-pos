import { PosNetPos } from '../gateway/PosNetPos.js'
import type { PosNetPosAccount } from '../model/account/PosNetPosAccount.js'
import { AbstractPosQuery } from './AbstractPosQuery.js'
import type { QueryType } from './PosQueryInterface.js'

/**
 * Custom queries for PosNetPos: the merchant and terminal numbers are added to the request, and the XML is posted
 * as the `xmldata` form field to the payment API. This bank API offers no normalized history, so `history()` rejects
 * as unsupported.
 */
export class PosNetPosQuery extends AbstractPosQuery<PosNetPosAccount> {
  static override readonly GATEWAY_CLASS: string = PosNetPos.GATEWAY_CLASS

  protected static override supportedQueries: Partial<Record<QueryType, boolean>> = {
    custom_query: true,
    history: false,
  }
}
