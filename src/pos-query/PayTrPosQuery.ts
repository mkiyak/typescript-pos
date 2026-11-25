import { PayTrPos } from '../gateway/PayTrPos.js'
import type { PayTrPosAccount } from '../model/account/PayTrPosAccount.js'
import { AbstractMappedPosQuery } from './AbstractMappedPosQuery.js'
import type { QueryType } from './PosQueryInterface.js'

/**
 * Queries of the PayTR service. A custom query signs the caller's fields with the formula the field names select
 * (status, refund, history, BIN, rates) and adds `merchant_id`; the decoded answer is returned as the bank sent it.
 * History needs `start_date` and `end_date` as `Date` values (written in Türkiye time, at most three days apart); it
 * only lists records and never confirms a payment: payments are confirmed by the signed notification alone.
 * Installment rates take no parameter. The BIN list needs a 6- or 8-digit `bin`. Installment prices are not offered.
 */
export class PayTrPosQuery extends AbstractMappedPosQuery<PayTrPosAccount> {
  static override readonly GATEWAY_CLASS: string = PayTrPos.GATEWAY_CLASS

  protected static override supportedQueries: Partial<Record<QueryType, boolean>> = {
    custom_query: true,
    history: true,
    installment_rates: true,
    bin_list: true,
    installment_prices: false,
  }
}
