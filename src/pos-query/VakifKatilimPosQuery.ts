import type { PosQueryHistoryResponse } from '../data-mapper/pos-query/response/QueryResponseDataMapperInterface.js'
import { redactRawHashPassword } from '../gateway/boaCallback.js'
import { VakifKatilimPos } from '../gateway/VakifKatilimPos.js'
import type { BoaPosAccount } from '../model/account/BoaPosAccount.js'
import { AbstractMappedPosQuery } from './AbstractMappedPosQuery.js'
import type { QueryType } from './PosQueryInterface.js'

/**
 * Queries of the Vakıf Katılım gateway. Custom queries go out exactly as given and need an `apiUrl` on the
 * gateway's origin, because the gateway has one path per query; `history` lists the orders of a date range.
 */
export class VakifKatilimPosQuery extends AbstractMappedPosQuery<BoaPosAccount> {
  static override readonly GATEWAY_CLASS: string = VakifKatilimPos.GATEWAY_CLASS

  protected static override supportedQueries: Partial<Record<QueryType, boolean>> = {
    custom_query: true,
    history: true,
  }

  /** The bank may echo the hashed API password, the merchant's signing secret: it never reaches the caller. */
  override async customQuery(
    requestData: Record<string, unknown>,
    apiUrl?: string | null,
  ): Promise<Record<string, unknown>> {
    return redactRawHashPassword(await super.customQuery(requestData, apiUrl))
  }

  override async history(data: Record<string, unknown>): Promise<PosQueryHistoryResponse> {
    const result = await super.history(data)
    return Object.hasOwn(result, 'all') ? { ...result, all: redactRawHashPassword(result.all) } : result
  }
}
