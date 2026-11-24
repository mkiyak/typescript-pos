import { PosHttpError } from '../errors.js'
import { createSafeLogger, type PosLogger } from '../logger.js'
import type { PaymentModel, TxType } from '../PosInterface.js'
import type { QueryType } from '../pos-query/PosQueryInterface.js'
import type { EncodedData } from '../serializer/EncodedData.js'
import { JsonDecoder } from '../serializer/JsonDecoder.js'
import type { PosOrder } from '../types.js'
import { maskSensitiveData } from '../util/maskSensitiveData.js'
import type { HttpTransport, HttpTransportResponse } from './HttpTransport.js'

const CONTENT_TYPES: Record<EncodedData['format'], string> = {
  xml: 'text/xml; charset=UTF-8',
  form: 'application/x-www-form-urlencoded',
  json: 'application/json',
}

/** Payment transaction types and query types both go through the HTTP clients. */
export type ClientTxType = TxType | QueryType

/** Encode -> post -> decode. Concrete clients override encode/decode/headers. */
export abstract class AbstractHttpClient {
  protected readonly logger: PosLogger

  constructor(
    protected readonly endpoint: string,
    protected readonly transport: HttpTransport,
    logger: PosLogger,
  ) {
    this.logger = createSafeLogger(logger)
  }

  abstract supportsTx(txType: ClientTxType, paymentModel: PaymentModel): boolean

  async request(
    txType: ClientTxType,
    paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    order: PosOrder,
    url?: string | null,
  ): Promise<Record<string, unknown>> {
    const target = url ?? this.getApiUrl(txType, paymentModel)
    const encoded = this.encode(txType, paymentModel, requestData, order)

    this.logger.debug('sending request', { url: target, tx_type: txType, payment_model: paymentModel })

    let response: HttpTransportResponse
    try {
      response = await this.transport.post(
        target,
        this.requestBody(encoded),
        this.headers(txType, paymentModel, encoded),
      )
    } catch (e) {
      this.logger.error('api request failed', {
        url: target,
        tx_type: txType,
        order_id: order.id,
        error: e,
        ...(e instanceof PosHttpError ? { status_code: e.status, response: e.bodySnippet } : {}),
      })
      throw e
    }

    this.logger.debug('request completed', { status_code: response.status })

    if (response.status === 204) {
      this.logger.warn('Response from api is empty', { url: target, tx_type: txType, status_code: 204 })
      return {}
    }

    let decoded: Record<string, unknown>
    try {
      decoded = await this.decode(this.responseText(response, txType), txType, paymentModel)
    } catch (e) {
      this.logger.error('parsing bank response failed', {
        status_code: response.status,
        response: maskSensitiveData(response.body).slice(0, 500),
        message: e instanceof Error ? e.message : String(e),
      })
      if (e instanceof PosHttpError && e.url === '') {
        throw new PosHttpError(
          e.message,
          { url: target, status: response.status, ...(e.bodySnippet !== undefined ? { body: e.bodySnippet } : {}) },
          { cause: e },
        )
      }
      throw e
    }

    this.checkFailResponseData(txType, decoded, order)
    return decoded
  }

  /** Overridable for gateways whose URL depends on the transaction. */
  protected getApiUrl(_txType: ClientTxType, _paymentModel: PaymentModel): string {
    return this.endpoint
  }

  /** Default: JSON. */
  protected encode(
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    _order: PosOrder,
  ): EncodedData {
    return { data: JSON.stringify(requestData), format: 'json' }
  }

  /** Default: JSON. */
  protected decode(body: string, _txType: ClientTxType, _paymentModel: PaymentModel): Promise<Record<string, unknown>> {
    return Promise.resolve(JsonDecoder.decode(body))
  }

  /** The bytes put on the wire. Default: the encoded string (sent as UTF-8). */
  protected requestBody(encoded: EncodedData): string | Uint8Array {
    return encoded.data
  }

  /** The response body handed to `decode()`. Default: the body decoded as UTF-8. */
  protected responseText(response: HttpTransportResponse, _txType?: ClientTxType): string {
    return response.body
  }

  protected headers(_txType: ClientTxType, _paymentModel: PaymentModel, encoded: EncodedData): Record<string, string> {
    return { 'Content-Type': CONTENT_TYPES[encoded.format] }
  }

  /** Hook for gateways that signal failures inside a 2xx body. Throw to reject. */
  protected checkFailResponseData(_txType: ClientTxType, _data: Record<string, unknown>, _order: PosOrder): void {}
}
