import { AkbankPos } from '../gateway/AkbankPos.js'
import type { AkbankPosAccount } from '../model/account/AkbankPosAccount.js'
import { AbstractMappedPosQuery } from './AbstractMappedPosQuery.js'
import type { QueryType } from './PosQueryInterface.js'

/**
 * Queries of the Akbank API. A custom query gets the terminal, version, request time and a random number added and
 * is signed by the client; `history` lists the transactions of one batch (`batch_num`) or of a date range
 * (`start_date`, `end_date`) of at most one day.
 */
export class AkbankPosQuery extends AbstractMappedPosQuery<AkbankPosAccount> {
  static override readonly GATEWAY_CLASS: string = AkbankPos.GATEWAY_CLASS

  protected static override supportedQueries: Partial<Record<QueryType, boolean>> = {
    custom_query: true,
    history: true,
  }
}
