import { ToslaPos } from '../gateway/ToslaPos.js'
import type { ToslaPosAccount } from '../model/account/ToslaPosAccount.js'
import { AbstractMappedPosQuery } from './AbstractMappedPosQuery.js'
import type { QueryType } from './PosQueryInterface.js'

/**
 * Queries of the Tosla API. A custom query is signed with the account's credentials like every other request and
 * needs an `apiUrl` on the API origin, because the API has one path per query; a hook that changes the client id, API
 * user, random value or time span of a prepared request invalidates its signature. Installment rates need the
 * 6-digit bin of the card. Installment prices take the amount in TL and answer in TL (the bank itself works in
 * kuruş). There is no history or BIN list query: the gateway's `orderHistory` lists the records of one order.
 */
export class ToslaPosQuery extends AbstractMappedPosQuery<ToslaPosAccount> {
  static override readonly GATEWAY_CLASS: string = ToslaPos.GATEWAY_CLASS

  protected static override supportedQueries: Partial<Record<QueryType, boolean>> = {
    custom_query: true,
    installment_rates: true,
    installment_prices: true,
    history: false,
    bin_list: false,
  }
}
