import { PosNetV1Pos } from '../gateway/PosNetV1Pos.js'
import type { PosNetPosAccount } from '../model/account/PosNetPosAccount.js'
import { AbstractPosQuery } from './AbstractPosQuery.js'
import type { QueryType } from './PosQueryInterface.js'

/**
 * Custom queries for PosNetV1Pos: the API fields, the merchant and terminal numbers and the MAC are added to the
 * JSON request. The bank has one URL per operation, so `customQuery()` needs the full `apiUrl` of the operation
 * (on the configured origin) and rejects without it. This bank API offers no normalized history, so `history()`
 * rejects as unsupported.
 *
 * The MAC is computed when the request is built, before the `onPosQueryRequestDataPrepared` hooks run: a hook that
 * changes a signed field (one named in `MACParams`) leaves the MAC stale, so such a hook must also set `MAC`.
 */
export class PosNetV1PosQuery extends AbstractPosQuery<PosNetPosAccount> {
  static override readonly GATEWAY_CLASS: string = PosNetV1Pos.GATEWAY_CLASS

  protected static override supportedQueries: Partial<Record<QueryType, boolean>> = {
    custom_query: true,
    history: false,
  }
}
