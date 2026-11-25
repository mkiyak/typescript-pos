import { IyzicoPos } from '../gateway/IyzicoPos.js'
import type { IyzicoPosAccount } from '../model/account/IyzicoPosAccount.js'
import { AbstractMappedPosQuery } from './AbstractMappedPosQuery.js'
import type { QueryType } from './PosQueryInterface.js'

/**
 * Queries of the iyzico API. Every request is signed by the client from the exact bytes it sends, so a hook may change
 * the prepared data. A custom query needs an `apiUrl` on the API origin (the API has one path per query). History
 * lists the payments of one day (`transaction_date`, Türkiye time) page by page and is a report only: it never
 * confirms a payment. Installment prices take the amount in TL and an optional 6- or 8-digit BIN; the BIN lookup needs
 * a 6- or 8-digit BIN. Installment rates are not offered. The gateway's `orderHistory` lists the records of one order.
 */
export class IyzicoPosQuery extends AbstractMappedPosQuery<IyzicoPosAccount> {
  static override readonly GATEWAY_CLASS: string = IyzicoPos.GATEWAY_CLASS

  protected static override supportedQueries: Partial<Record<QueryType, boolean>> = {
    custom_query: true,
    history: true,
    installment_prices: true,
    bin_list: true,
    installment_rates: false,
  }
}
