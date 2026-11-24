import { GarantiPos } from '../gateway/GarantiPos.js'
import type { GarantiPosAccount } from '../model/account/GarantiPosAccount.js'
import { AbstractMappedPosQuery } from './AbstractMappedPosQuery.js'
import type { QueryType } from './PosQueryInterface.js'

/**
 * Queries of the Garanti (GVP) API. Custom queries get the terminal and its signature added; `history` lists the
 * transactions of a date range (the bank allows at most 30 days per request); the BIN list can be filtered by
 * `bin` and `card_class`.
 */
export class GarantiPosQuery extends AbstractMappedPosQuery<GarantiPosAccount> {
  static override readonly GATEWAY_CLASS: string = GarantiPos.GATEWAY_CLASS

  protected static override supportedQueries: Partial<Record<QueryType, boolean>> = {
    custom_query: true,
    history: true,
    bin_list: true,
  }
}
