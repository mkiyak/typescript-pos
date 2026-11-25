import { PosError, UnsupportedTransactionTypeError } from '../errors.js'
import { type PaymentModel, TX_TYPE } from '../PosInterface.js'
import { QUERY_TYPE } from '../pos-query/PosQueryInterface.js'
import type { EncodedData } from '../serializer/EncodedData.js'
import { FormEncoder } from '../serializer/FormEncoder.js'
import type { PosOrder } from '../types.js'
import type { ClientTxType } from './AbstractHttpClient.js'
import { AbstractIyzicoPosHttpClient } from './AbstractIyzicoPosHttpClient.js'

// A Map, not a plain object: a transaction type such as "constructor" must never find a route.
const PATHS: ReadonlyMap<string, string> = new Map<string, string>([
  [QUERY_TYPE.HISTORY, 'transactions'],
  [TX_TYPE.ORDER_HISTORY, 'details'],
])

const QUERY_KEY = /^[A-Za-z0-9_.-]{1,64}$/

/**
 * The reporting API: a GET request whose data travels in the query string. The signature covers the URL path and an
 * empty body, as the reporting endpoints expect; the query string is neither signed nor logged.
 */
export class IyzicoPosQueryApiHttpClient extends AbstractIyzicoPosHttpClient {
  static readonly API_NAME_QUERY_API = 'query_api'

  static supports(gatewayClass: string, apiName: string): boolean {
    return gatewayClass === 'IyzicoPos' && apiName === IyzicoPosQueryApiHttpClient.API_NAME_QUERY_API
  }

  supportsTx(txType: ClientTxType, _paymentModel?: PaymentModel): boolean {
    return PATHS.has(txType)
  }

  /** Public here (protected in the base class) so callers can see where a query is sent. */
  override getApiUrl(txType: ClientTxType, _paymentModel?: PaymentModel): string {
    if (typeof txType !== 'string' || (txType as string) === '') {
      throw new PosError('Transaction type is required to generate API URL')
    }
    const path = PATHS.get(txType)
    if (path === undefined) {
      throw new UnsupportedTransactionTypeError(`Unsupported transaction type: ${txType}`)
    }

    return `${this.endpoint.replace(/\/+$/, '')}/${path}`
  }

  protected override httpMethod(): 'GET' {
    return 'GET'
  }

  /** Only plain scalar values with plain names go into the query string; they are percent-encoded. */
  protected override encode(
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    _order: PosOrder,
  ): EncodedData {
    for (const [name, value] of Object.entries(requestData)) {
      const scalar =
        typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
      if (!QUERY_KEY.test(name) || !(scalar || value === null || value === undefined)) {
        throw new PosError('A reporting query carries plain scalar values only.')
      }
    }

    return { data: FormEncoder.encode(requestData), format: 'form' }
  }

  protected override headers(
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
    _encoded: EncodedData,
    url: string,
  ): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: this.authorization(url, '') }
  }
}
