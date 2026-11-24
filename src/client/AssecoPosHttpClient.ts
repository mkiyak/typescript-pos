import type { PosLogger } from '../logger.js'
import { noopLogger } from '../logger.js'
import type { PaymentModel } from '../PosInterface.js'
import type { EncodedData } from '../serializer/EncodedData.js'
import { decodeXmlResponseText, encodeIso88599, ISO_8859_9, toIso88599Xml } from '../serializer/iso88599.js'
import { XmlDecoder } from '../serializer/XmlDecoder.js'
import { XmlEncoder } from '../serializer/XmlEncoder.js'
import type { PosOrder } from '../types.js'
import { AbstractHttpClient, type ClientTxType } from './AbstractHttpClient.js'
import type { HttpTransport, HttpTransportResponse } from './HttpTransport.js'

/**
 * XML (`CC5Request`, ISO-8859-9) posted to the payment API.
 *
 * The body is sent as ISO-8859-9 bytes without a Content-Type header, and a response is decoded
 * with the charset its XML declaration announces (UTF-8 when there is none or it is unknown).
 */
export class AssecoPosHttpClient extends AbstractHttpClient {
  static readonly API_NAME_PAYMENT_API = 'payment_api'

  constructor(endpoint: string, transport: HttpTransport, logger: PosLogger = noopLogger) {
    super(endpoint, transport, logger)
  }

  static supports(gatewayClass: string, apiName: string): boolean {
    return gatewayClass === 'AssecoPos' && apiName === AssecoPosHttpClient.API_NAME_PAYMENT_API
  }

  supportsTx(_txType: ClientTxType, _paymentModel: PaymentModel): boolean {
    return true
  }

  override getApiUrl(txType: ClientTxType, paymentModel: PaymentModel): string {
    return super.getApiUrl(txType, paymentModel)
  }

  protected override encode(
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    _order: PosOrder,
  ): EncodedData {
    return {
      data: XmlEncoder.encode(requestData, { rootName: 'CC5Request', encoding: ISO_8859_9 }),
      format: 'xml',
    }
  }

  protected override decode(body: string): Promise<Record<string, unknown>> {
    return Promise.resolve(XmlDecoder.decode(body))
  }

  protected override requestBody(encoded: EncodedData): Uint8Array {
    return encodeIso88599(toIso88599Xml(encoded.data))
  }

  protected override responseText(response: HttpTransportResponse): string {
    return decodeXmlResponseText(response)
  }

  protected override headers(): Record<string, string> {
    return {}
  }
}
