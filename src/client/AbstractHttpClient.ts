import { PosError, PosHttpError } from '../errors.js'
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

/** The shortest piece of a secret that is masked where a text was cut through it. */
const MIN_SECRET_PIECE = 3

/**
 * The text with every occurrence of the secrets masked, and a trailing piece of one (a text shortened elsewhere may
 * end inside a secret) masked too. Without secrets the text is returned as it is.
 */
export function hideSecrets(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of secrets) {
    if (secret === '') continue
    out = out.split(secret).join('***')
    // A card-shaped secret may already stand in its masked form (first six and last four digits) in a bank text.
    const maskedForm = maskSensitiveData(secret)
    if (typeof maskedForm === 'string' && maskedForm !== secret && maskedForm !== '') {
      out = out.split(maskedForm).join('***')
    }
    for (let length = secret.length - 1; length >= MIN_SECRET_PIECE; length--) {
      if (out.endsWith(secret.slice(0, length))) {
        out = `${out.slice(0, out.length - length)}***`
        break
      }
    }
  }

  return out
}

function stripQuery(url: string): string {
  return url.split('?')[0] ?? url
}

function appendQuery(url: string, query: string): string {
  if (query === '') return url
  return `${url}${url.includes('?') ? '&' : '?'}${query}`
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

  /**
   * An error carrying a bank text (message, url or body snippet) is rethrown with this request's secrets masked, so a
   * page that echoes them never leaves through the thrown error either. The original error is not chained.
   */
  async request(
    txType: ClientTxType,
    paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    order: PosOrder,
    url?: string | null,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.send(txType, paymentModel, requestData, order, url)
    } catch (e) {
      if (!(e instanceof PosHttpError)) throw e
      const secrets = this.logSecrets(requestData)
      if (secrets.length === 0) throw e
      throw new PosHttpError(hideSecrets(e.message, secrets), {
        url: hideSecrets(e.url, secrets),
        ...(e.status !== undefined ? { status: e.status } : {}),
        ...(e.bodySnippet !== undefined ? { body: hideSecrets(e.bodySnippet, secrets) } : {}),
      })
    }
  }

  private async send(
    txType: ClientTxType,
    paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    order: PosOrder,
    url?: string | null,
  ): Promise<Record<string, unknown>> {
    const apiUrl = url ?? this.getApiUrl(txType, paymentModel)
    // Logs and header builders see the URL without its query string: request values may travel in it.
    const target = stripQuery(apiUrl)
    const encoded = this.encode(txType, paymentModel, requestData, order)
    const method = this.httpMethod(txType, paymentModel)

    this.logger.debug('sending request', { url: target, tx_type: txType, payment_model: paymentModel })

    let response: HttpTransportResponse
    const readsFailure = this.readsClientErrorBody(txType, paymentModel)
    const transportOptions = readsFailure ? { returnClientErrors: true } : undefined
    try {
      const headers = this.headers(txType, paymentModel, encoded, target)
      response =
        method === 'GET'
          ? await this.transport.get(appendQuery(apiUrl, this.queryString(encoded)), headers, transportOptions)
          : await this.transport.post(apiUrl, this.requestBody(encoded), headers, transportOptions)
    } catch (e) {
      const secrets = this.logSecrets(requestData)
      this.logger.error('api request failed', {
        url: target,
        tx_type: txType,
        order_id: order.id,
        error:
          secrets.length === 0 || !(e instanceof Error)
            ? e
            : {
                name: e.name,
                message: hideSecrets(e.message, secrets),
                ...(e instanceof PosHttpError ? { url: hideSecrets(e.url, secrets), status: e.status } : {}),
              },
        ...(e instanceof PosHttpError
          ? {
              status_code: e.status,
              response: e.bodySnippet === undefined ? undefined : hideSecrets(e.bodySnippet, secrets),
            }
          : {}),
      })
      throw e
    }

    this.logger.debug('request completed', { status_code: response.status })

    // Only a request that asked for client errors can get here with a non-2xx status (HTTP 4xx).
    const clientError = response.status < 200 || response.status >= 300
    const refuseClientError = (snippetFrom: string, cause?: unknown): PosHttpError =>
      new PosHttpError(
        `Bank returned HTTP ${response.status}`,
        { url: target, status: response.status, body: snippetFrom },
        cause === undefined ? undefined : { cause },
      )

    if (response.status === 204) {
      this.logger.warn('Response from api is empty', { url: target, tx_type: txType, status_code: 204 })
      return {}
    }

    let decoded: Record<string, unknown>
    try {
      decoded = await this.decode(this.responseText(response, txType), txType, paymentModel)
    } catch (e) {
      const secrets = this.logSecrets(requestData)
      this.logger.error('parsing bank response failed', {
        status_code: response.status,
        response: maskSensitiveData(hideSecrets(response.body, secrets)).slice(0, 500),
        message: hideSecrets(e instanceof Error ? e.message : String(e), secrets),
      })
      if (clientError) throw refuseClientError(response.body, e)
      if (e instanceof PosHttpError && e.url === '') {
        throw new PosHttpError(
          e.message,
          { url: target, status: response.status, ...(e.bodySnippet !== undefined ? { body: e.bodySnippet } : {}) },
          { cause: e },
        )
      }
      throw e
    }

    if (clientError && !this.isReadableFailure(decoded)) throw refuseClientError(response.body)

    this.checkFailResponseData(txType, decoded, order)
    return decoded
  }

  /**
   * Values of this request that must never reach a log line, such as credentials a bank may echo in an error text.
   * None by default; a client whose requests carry credentials in the body names them.
   */
  protected logSecrets(_requestData: Record<string, unknown>): readonly string[] {
    return []
  }

  /**
   * Whether an HTTP 4xx answer of this transaction is read instead of refused, when its body is a readable failure
   * (see `isReadableFailure`). Only for requests that cannot move money. Default: never.
   */
  protected readsClientErrorBody(_txType: ClientTxType, _paymentModel: PaymentModel): boolean {
    return false
  }

  /** What an HTTP 4xx body must be to count as the bank's own failure answer. Default: nothing. */
  protected isReadableFailure(_decoded: Record<string, unknown>): boolean {
    return false
  }

  /** `GET` sends the encoded data as the query string and no body. Default: POST. */
  protected httpMethod(_txType: ClientTxType, _paymentModel: PaymentModel): 'POST' | 'GET' {
    return 'POST'
  }

  /** The query string of a GET request: the encoded data, which must be a form encoding. */
  private queryString(encoded: EncodedData): string {
    if (encoded.format !== 'form') throw new PosError('A GET request carries form-encoded data only.')
    return encoded.data
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

  /** `url` is the request URL without its query string, exactly as it is sent (a signed-URL gateway signs it). */
  protected headers(
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
    encoded: EncodedData,
    _url: string,
  ): Record<string, string> {
    return { 'Content-Type': CONTENT_TYPES[encoded.format] }
  }

  /** Hook for gateways that signal failures inside a 2xx body. Throw to reject. */
  protected checkFailResponseData(_txType: ClientTxType, _data: Record<string, unknown>, _order: PosOrder): void {}
}
