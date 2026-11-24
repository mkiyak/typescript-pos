import type { RequestValueMapperInterface } from '../data-mapper/request/value-mapper/RequestValueMapperInterface.js'
import { PosHttpError } from '../errors.js'
import type { PosLogger } from '../logger.js'
import { type PaymentModel, TX_TYPE } from '../PosInterface.js'
import type { EncodedData } from '../serializer/EncodedData.js'
import { decodeXmlResponseText } from '../serializer/iso88599.js'
import { KuveytPosSoapApiXmlDecoder } from '../serializer/KuveytPosSoapApiXmlDecoder.js'
import { KuveytPosSoapApiXmlEncoder } from '../serializer/KuveytPosSoapApiXmlEncoder.js'
import type { PosOrder } from '../types.js'
import { maskSensitiveData } from '../util/maskSensitiveData.js'
import { AbstractHttpClient, type ClientTxType } from './AbstractHttpClient.js'
import type { HttpTransport, HttpTransportResponse } from './HttpTransport.js'

const SOAP_ACTION_PREFIX = 'http://boa.net/BOA.Integration.VirtualPos/Service/IVirtualPosService/'
const FAULT_KEY = /^(?:[A-Za-z_][\w.-]*:)?Fault$/
const FAULT_STRING_KEY = /^(?:[A-Za-z_][\w.-]*:)?faultstring$/
const FAULT_STRING_IN_TEXT = /<(?:[A-Za-z_][\w.-]*:)?faultstring\b[^>]*>([^<]*)</i
const FAULT_MAX = 256
const FALLBACK_FAULT = 'Bank request failed'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** A bank-supplied fault text, made safe to put in an error message: masked, no control characters, at most 256 characters. */
function faultMessage(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
  const clean = maskSensitiveData(text.replace(/[\u0000-\u001F\u007F]/g, ' ').trim())

  return clean === '' ? FALLBACK_FAULT : clean.slice(0, FAULT_MAX)
}

function faultTextOf(fault: Record<string, unknown>): string {
  const key = Object.keys(fault).find((k) => FAULT_STRING_KEY.test(k))
  const value = key === undefined ? undefined : fault[key]
  const text = typeof value === 'string' ? value : isRecord(value) && typeof value['#'] === 'string' ? value['#'] : ''

  return faultMessage(text)
}

/**
 * SOAP 1.1 requests (status, cancel, refund) posted to the Kuveyt Turk query endpoint. The envelope is written by
 * hand and the `SOAPAction` header follows the bank's name of the transaction. A fault in the answer becomes a
 * `PosHttpError` carrying the (masked, shortened) fault text; the request body and the answer are never logged.
 */
export class KuveytPosSoapApiHttpClient extends AbstractHttpClient {
  static readonly API_NAME_QUERY_API = 'query_api'

  constructor(
    endpoint: string,
    transport: HttpTransport,
    logger: PosLogger,
    private readonly requestValueMapper: RequestValueMapperInterface,
  ) {
    super(endpoint, transport, logger)
  }

  static supports(gatewayClass: string, apiName: string): boolean {
    return gatewayClass === 'KuveytPos' && apiName === KuveytPosSoapApiHttpClient.API_NAME_QUERY_API
  }

  supportsTx(txType: ClientTxType, _paymentModel: PaymentModel): boolean {
    return (
      txType === TX_TYPE.STATUS ||
      txType === TX_TYPE.CANCEL ||
      txType === TX_TYPE.REFUND ||
      txType === TX_TYPE.REFUND_PARTIAL
    )
  }

  /** Public here (protected in the base class) so callers can see where a transaction is posted. */
  override getApiUrl(txType: ClientTxType, paymentModel: PaymentModel): string {
    return super.getApiUrl(txType, paymentModel)
  }

  /**
   * A non-2xx answer keeps the transport's `PosHttpError` (status included); when its masked body snippet holds a
   * SOAP fault, the fault text is added to the message.
   */
  override async request(
    txType: ClientTxType,
    paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    order: PosOrder,
    url?: string | null,
  ): Promise<Record<string, unknown>> {
    try {
      return await super.request(txType, paymentModel, requestData, order, url)
    } catch (e) {
      if (e instanceof PosHttpError && e.status !== undefined && e.bodySnippet !== undefined) {
        const text = FAULT_STRING_IN_TEXT.exec(e.bodySnippet)?.[1]
        if (text !== undefined) {
          throw new PosHttpError(
            `Bank SOAP fault: ${faultMessage(text)}`,
            { url: e.url, status: e.status },
            { cause: e },
          )
        }
      }
      throw e
    }
  }

  protected override encode(
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    _order: PosOrder,
  ): EncodedData {
    return { data: KuveytPosSoapApiXmlEncoder.encode(requestData), format: 'xml' }
  }

  protected override headers(
    txType: ClientTxType,
    _paymentModel: PaymentModel,
    _encoded: EncodedData,
  ): Record<string, string> {
    return {
      'Content-Type': 'text/xml; charset=UTF-8',
      SOAPAction: `${SOAP_ACTION_PREFIX}${this.requestValueMapper.mapTxType(txType)}`,
    }
  }

  protected override responseText(response: HttpTransportResponse): string {
    return decodeXmlResponseText(response)
  }

  protected override decode(body: string): Promise<Record<string, unknown>> {
    const decoded = KuveytPosSoapApiXmlDecoder.decode(body)
    const faultKey = Object.keys(decoded).find((key) => FAULT_KEY.test(key))
    if (faultKey !== undefined) {
      const fault = decoded[faultKey]
      throw new PosHttpError(`Bank SOAP fault: ${isRecord(fault) ? faultTextOf(fault) : FALLBACK_FAULT}`, { url: '' })
    }

    return Promise.resolve(decoded)
  }
}
