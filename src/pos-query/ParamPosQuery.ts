import { redactEchoedCredentials } from '../data-mapper/pos-query/response/ParamPosQueryResponseDataMapper.js'
import { ParamPos } from '../gateway/ParamPos.js'
import type { ParamPosAccount } from '../model/account/ParamPosAccount.js'
import { AbstractMappedPosQuery } from './AbstractMappedPosQuery.js'
import type { QueryType } from './PosQueryInterface.js'

/**
 * Queries of the Param TurkPos service. A custom query takes one SOAP action with its fields as a record; the
 * account's client code, API user, API password and merchant key are added to it, and an answer that echoes one of
 * them is returned with `***` in its place. History needs `start_date` and `end_date` (both are read as Türkiye
 * time) and can be limited with `order_status` and `transaction_type`; it only reports records. Installment rates
 * take no parameter. The BIN list takes an optional `bin` of 6 or 8 digits. Installment prices are not offered.
 */
export class ParamPosQuery extends AbstractMappedPosQuery<ParamPosAccount> {
  static override readonly GATEWAY_CLASS: string = ParamPos.GATEWAY_CLASS

  protected static override supportedQueries: Partial<Record<QueryType, boolean>> = {
    custom_query: true,
    history: true,
    installment_rates: true,
    bin_list: true,
    installment_prices: false,
  }

  override async customQuery(
    requestData: Record<string, unknown>,
    apiUrl?: string | null,
  ): Promise<Record<string, unknown>> {
    const answer = await super.customQuery(requestData, apiUrl)

    return redactEchoedCredentials(answer, [this.account.getSecretKey(), this.account.getPassword()]) as Record<
      string,
      unknown
    >
  }
}
