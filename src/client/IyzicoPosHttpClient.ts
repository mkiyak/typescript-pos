import { PosError, UnsupportedTransactionTypeError } from '../errors.js'
import { MODEL, type PaymentModel, TX_TYPE } from '../PosInterface.js'
import { QUERY_TYPE } from '../pos-query/PosQueryInterface.js'
import type { EncodedData } from '../serializer/EncodedData.js'
import type { PosOrder } from '../types.js'
import type { ClientTxType } from './AbstractHttpClient.js'
import { AbstractIyzicoPosHttpClient } from './AbstractIyzicoPosHttpClient.js'

// A Map, not a plain object: a transaction type such as "constructor" must never find a route.
const PATHS: ReadonlyMap<string, string> = new Map<string, string>([
  [TX_TYPE.PAY_AUTH, '/payment/auth'],
  [TX_TYPE.PAY_PRE_AUTH, '/payment/preauth'],
  [TX_TYPE.PAY_POST_AUTH, '/payment/postauth'],
  [TX_TYPE.CANCEL, '/payment/cancel'],
  [TX_TYPE.STATUS, '/payment/detail'],
  [TX_TYPE.REFUND, '/v2/payment/refund'],
  [TX_TYPE.REFUND_PARTIAL, '/v2/payment/refund'],
  [QUERY_TYPE.INSTALLMENT_PRICES, '/payment/iyzipos/installment'],
  [QUERY_TYPE.BIN_LIST, '/payment/bin/check'],
])

/** The payment transactions that start with an authorization; only these use the 3D Secure completion route. */
const THREE_D_COMPLETION_TX: ReadonlySet<string> = new Set([TX_TYPE.PAY_AUTH, TX_TYPE.PAY_PRE_AUTH])

/**
 * JSON posted to the iyzico API. The body is serialised once in `encode()`; that same string is signed (together with
 * the URL path) in `headers()` and sent, so the signature always matches the bytes on the wire.
 */
export class IyzicoPosHttpClient extends AbstractIyzicoPosHttpClient {
  static readonly API_NAME_PAYMENT_API = 'payment_api'

  static supports(gatewayClass: string, apiName: string): boolean {
    return gatewayClass === 'IyzicoPos' && apiName === IyzicoPosHttpClient.API_NAME_PAYMENT_API
  }

  supportsTx(txType: ClientTxType, _paymentModel?: PaymentModel): boolean {
    return (
      PATHS.has(txType) ||
      txType === TX_TYPE.INTERNAL_3D_FORM_BUILD ||
      txType === TX_TYPE.INTERNAL_3D_PAYMENT_STATUS ||
      txType === QUERY_TYPE.CUSTOM_QUERY
    )
  }

  /**
   * The form and checkout initialize requests, the checkout record and the payment record move no money: an HTTP 4xx
   * with iyzico's own failure answer is then read like any failure. After a money request the outcome of a 4xx is
   * unknown, so it stays an HTTP error.
   */
  protected override readsClientErrorBody(txType: ClientTxType, _paymentModel: PaymentModel): boolean {
    return (
      txType === TX_TYPE.INTERNAL_3D_FORM_BUILD ||
      txType === TX_TYPE.INTERNAL_3D_PAYMENT_STATUS ||
      txType === TX_TYPE.STATUS
    )
  }

  /**
   * Public here (protected in the base class) so callers can see where a transaction is posted. `orderTxType` is the
   * kind of payment a 3D form is built for (authorization or pre-authorization).
   */
  override getApiUrl(txType: ClientTxType, paymentModel?: PaymentModel, orderTxType?: ClientTxType): string {
    if (typeof txType !== 'string' || (txType as string) === '') {
      throw new PosError('Transaction type is required to generate API URL')
    }
    const base = this.endpoint.replace(/\/+$/, '')

    if (paymentModel === MODEL.THREE_D_HOST) {
      if (txType === TX_TYPE.INTERNAL_3D_PAYMENT_STATUS) {
        return `${base}/payment/iyzipos/checkoutform/auth/ecom/detail`
      }
      if (txType === TX_TYPE.INTERNAL_3D_FORM_BUILD) {
        if (orderTxType === undefined || (orderTxType as string) === '') {
          throw new PosError('The order transaction type is required to generate the 3D Host form URL')
        }
        if (orderTxType === TX_TYPE.PAY_AUTH) return `${base}/payment/iyzipos/checkoutform/initialize/auth/ecom`
        if (orderTxType === TX_TYPE.PAY_PRE_AUTH) return `${base}/payment/iyzipos/checkoutform/initialize/preauth/ecom`
        throw new PosError(`Unsupported order transaction type: ${orderTxType}`)
      }
    }

    if (txType === TX_TYPE.INTERNAL_3D_FORM_BUILD) {
      return `${base}${orderTxType === TX_TYPE.PAY_PRE_AUTH ? '/payment/3dsecure/initialize/preauth' : '/payment/3dsecure/initialize'}`
    }

    // deviation: only the authorization transactions use the 3D completion route, so a status, cancel or refund
    // asked under the 3D model keeps its own route instead of re-authorizing.
    if (paymentModel === MODEL.THREE_D_SECURE && THREE_D_COMPLETION_TX.has(txType)) {
      return `${base}/payment/v2/3dsecure/auth`
    }

    if (txType === QUERY_TYPE.CUSTOM_QUERY) {
      throw new PosError('iyzico custom queries need an apiUrl')
    }

    const path = PATHS.get(txType)
    if (path === undefined) {
      throw new UnsupportedTransactionTypeError(`Unsupported transaction type: ${txType}`)
    }

    return `${base}${path}`
  }

  protected override encode(
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    _order: PosOrder,
  ): EncodedData {
    let data: string | undefined
    try {
      data = JSON.stringify(requestData)
    } catch {
      data = undefined
    }
    if (typeof data !== 'string') {
      throw new PosError('The request data cannot be serialised as JSON.')
    }

    return { data, format: 'json' }
  }

  /** The header is a bearer credential for this one body: it is never logged. */
  protected override headers(
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
    encoded: EncodedData,
    url: string,
  ): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: this.authorization(url, encoded.data) }
  }
}
