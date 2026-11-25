import { PosError, PosHttpError, UnsupportedTransactionTypeError } from '../errors.js'
import type { PaymentModel } from '../PosInterface.js'
import { QUERY_TYPE } from '../pos-query/PosQueryInterface.js'
import type { PosOrder } from '../types.js'
import { AbstractHttpClient, type ClientTxType } from './AbstractHttpClient.js'
import type { HttpTransportResponse } from './HttpTransport.js'

/** A path every payment model shares, or one path per payment model. */
type PathEntry = string | ReadonlyMap<string, string>

// Maps, not plain objects: a transaction type or payment model such as "constructor" must never find a route.
const PATHS: ReadonlyMap<string, PathEntry> = new Map<string, PathEntry>([
  [
    'pay',
    new Map([
      ['regular', 'Payment'],
      ['3d_pay', 'threeDPayment'],
      ['3d_host', 'threeDPayment'],
    ]),
  ],
  [
    'pre',
    new Map([
      ['3d_pay', 'threeDPreAuth'],
      ['3d_host', 'threeDPreAuth'],
    ]),
  ],
  ['post', 'postAuth'],
  ['cancel', 'void'],
  ['refund', 'refund'],
  ['refund_partial', 'refund'],
  ['status', 'inquiry'],
  ['order_history', 'history'],
  [QUERY_TYPE.INSTALLMENT_RATES, 'GetCommissionAndInstallmentInfo'],
  [QUERY_TYPE.INSTALLMENT_PRICES, 'GetInstallmentOptions'],
])

const UTF8_BOM = [0xef, 0xbb, 0xbf]

/**
 * JSON posted to `<payment_api>/<path>`; the path depends on the transaction and the payment model. A response body
 * must be a JSON object: HTML pages from a firewall, arrays, scalars and empty-but-not-204 answers are errors.
 */
export class ToslaPosHttpClient extends AbstractHttpClient {
  static readonly API_NAME_PAYMENT_API = 'payment_api'

  static supports(gatewayClass: string, apiName: string): boolean {
    return gatewayClass === 'ToslaPos' && apiName === ToslaPosHttpClient.API_NAME_PAYMENT_API
  }

  supportsTx(txType: ClientTxType, paymentModel: PaymentModel): boolean {
    if (txType === QUERY_TYPE.CUSTOM_QUERY) return true

    try {
      this.pathFor(txType, paymentModel)
    } catch (e) {
      if (e instanceof UnsupportedTransactionTypeError) return false
      throw e
    }

    return true
  }

  /** Public here (protected in the base class) so callers can see where a transaction is posted. */
  override getApiUrl(txType: ClientTxType, paymentModel: PaymentModel): string {
    if (!txType || !paymentModel) {
      throw new PosError('Transaction type and payment model are required to generate API URL')
    }

    return `${this.endpoint}/${this.pathFor(txType, paymentModel)}`
  }

  /** A custom query has no path of its own: without the caller's url nothing is sent. */
  override request(
    txType: ClientTxType,
    paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    order: PosOrder,
    url?: string | null,
  ): Promise<Record<string, unknown>> {
    if (txType === QUERY_TYPE.CUSTOM_QUERY && (url === undefined || url === null || url === '')) {
      return Promise.reject(new PosError('Tosla custom queries need an apiUrl'))
    }

    return super.request(txType, paymentModel, requestData, order, url)
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

  private pathFor(txType: string, paymentModel: string): string {
    const entry = PATHS.get(txType)
    const path = typeof entry === 'string' ? entry : entry?.get(paymentModel)
    if (path === undefined) {
      throw new UnsupportedTransactionTypeError(
        `Transaction type [${txType}] is not supported for payment model [${paymentModel}].`,
      )
    }

    return path
  }
}
