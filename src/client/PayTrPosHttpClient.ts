import { PosError, PosHttpError, UnsupportedTransactionTypeError } from '../errors.js'
import type { PosLogger } from '../logger.js'
import type { PaymentModel } from '../PosInterface.js'
import { QUERY_TYPE } from '../pos-query/PosQueryInterface.js'
import type { EncodedData } from '../serializer/EncodedData.js'
import { FormEncoder } from '../serializer/FormEncoder.js'
import { JsonDecoder } from '../serializer/JsonDecoder.js'
import type { PosOrder } from '../types.js'
import { AbstractHttpClient, type ClientTxType } from './AbstractHttpClient.js'
import type { HttpTransport, HttpTransportResponse } from './HttpTransport.js'

// A Map, not a plain object: a transaction type such as "constructor" must never find a route.
const PATHS: ReadonlyMap<string, string> = new Map<string, string>([
  ['3d_form_build', 'odeme/api/get-token'],
  ['pay', 'odeme'],
  [QUERY_TYPE.CUSTOM_QUERY, 'odeme'],
  ['refund', 'odeme/iade'],
  ['refund_partial', 'odeme/iade'],
  ['status', 'odeme/durum-sorgu'],
  [QUERY_TYPE.HISTORY, 'rapor/islem-dokumu'],
  [QUERY_TYPE.INSTALLMENT_RATES, 'odeme/taksit-oranlari'],
  [QUERY_TYPE.BIN_LIST, 'odeme/api/bin-detail'],
])

const UTF8_BOM = [0xef, 0xbb, 0xbf]

/**
 * Form-encoded requests, one URL per transaction, JSON answers. A response body must be a JSON object: HTML pages
 * from a firewall, arrays, scalars and empty-but-not-204 answers are errors.
 */
export class PayTrPosHttpClient extends AbstractHttpClient {
  static readonly API_NAME_PAYMENT_API = 'payment_api'

  /**
   * @param accountSecrets the account's merchant key and salt. They are never part of a request body, but a bank
   *   text may echo them, and they are masked (also in card-masked form) in every log line and error snippet.
   */
  constructor(
    endpoint: string,
    transport: HttpTransport,
    logger: PosLogger,
    private readonly accountSecrets: readonly string[] = [],
  ) {
    super(endpoint, transport, logger)
  }

  static supports(gatewayClass: string, apiName: string): boolean {
    return gatewayClass === 'PayTrPos' && apiName === PayTrPosHttpClient.API_NAME_PAYMENT_API
  }

  supportsTx(txType: ClientTxType, _paymentModel?: PaymentModel): boolean {
    return PATHS.has(txType)
  }

  /** Public here (protected in the base class) so callers can see where a transaction is posted. */
  override getApiUrl(txType: ClientTxType, _paymentModel?: PaymentModel): string {
    if (!txType) {
      throw new PosError('Transaction type is required to generate PayTR API URL')
    }
    const path = PATHS.get(txType)
    if (path === undefined) {
      throw new UnsupportedTransactionTypeError(`Transaction type [${txType}] is not supported.`)
    }

    return `${this.endpoint.replace(/\/+$/, '')}/${path}`
  }

  /** The request token, the merchant key and the salt: none of them may reach a log line, even inside a bank text. */
  protected override logSecrets(requestData: Record<string, unknown>): readonly string[] {
    const token = Object.hasOwn(requestData, 'paytr_token') ? requestData.paytr_token : undefined

    return [...this.accountSecrets, ...(typeof token === 'string' && token !== '' ? [token] : [])]
  }

  protected override encode(
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    _order: PosOrder,
  ): EncodedData {
    return { data: FormEncoder.encode(requestData), format: 'form' }
  }

  /**
   * The JSON decoder reads an empty body as `{}`; here a 200 answer without a body would pass for "no fields" and
   * hide that the bank said nothing, so it is an error (a 204 never gets this far).
   */
  protected override decode(
    body: string,
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
  ): Promise<Record<string, unknown>> {
    if (body.trim() === '') {
      return Promise.reject(new PosHttpError('Bank response is empty', { url: '' }))
    }

    return Promise.resolve(JsonDecoder.decode(body))
  }

  /**
   * A byte order mark is not expected from the bank, and the text decoder would drop it without a trace, so an answer
   * that starts with one is refused instead of being read as if it were clean.
   */
  protected override responseText(response: HttpTransportResponse): string {
    if (UTF8_BOM.every((byte, i) => response.bytes[i] === byte)) {
      throw new PosHttpError('Bank response starts with a byte order mark', { url: '', status: response.status })
    }

    return response.body
  }
}
