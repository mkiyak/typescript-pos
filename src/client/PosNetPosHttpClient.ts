import { PosError } from '../errors.js'
import type { PosLogger } from '../logger.js'
import { noopLogger } from '../logger.js'
import type { PaymentModel } from '../PosInterface.js'
import type { EncodedData } from '../serializer/EncodedData.js'
import { decodeXmlResponseText, encodeIso88599, ISO_8859_9, isIso88599Representable } from '../serializer/iso88599.js'
import { XmlDecoder } from '../serializer/XmlDecoder.js'
import { XmlEncoder } from '../serializer/XmlEncoder.js'
import type { PosOrder } from '../types.js'
import { AbstractHttpClient, type ClientTxType } from './AbstractHttpClient.js'
import type { HttpTransport, HttpTransportResponse } from './HttpTransport.js'

const FORM_FIELD = 'xmldata='

/**
 * XML (`posnetRequest`, ISO-8859-9) posted as the single form field `xmldata`.
 *
 * The bank reads the body raw: the XML follows `xmldata=` without URL-encoding (base64 MACs with `+` and `/` are
 * accepted as they are). An `&` would therefore end the form field, a `%` could be taken for an escape, and a
 * character ISO-8859-9 cannot hold would need a character reference that itself starts with `&`. Requests whose XML
 * contains any of these are rejected before anything is sent; Turkish letters are sent as ISO-8859-9 bytes.
 *
 * The encoded body is never logged (the base class logs only the URL and the transaction type). A response is
 * decoded with the charset its XML declaration announces; an HTML or invalid answer is a `PosHttpError`.
 */
export class PosNetPosHttpClient extends AbstractHttpClient {
  static readonly API_NAME_PAYMENT_API = 'payment_api'

  constructor(endpoint: string, transport: HttpTransport, logger: PosLogger = noopLogger) {
    super(endpoint, transport, logger)
  }

  static supports(gatewayClass: string, apiName: string): boolean {
    return gatewayClass === 'PosNetPos' && apiName === PosNetPosHttpClient.API_NAME_PAYMENT_API
  }

  supportsTx(_txType: ClientTxType, _paymentModel: PaymentModel): boolean {
    return true
  }

  /** Public here (protected in the base class) so callers can see where a transaction is posted. */
  override getApiUrl(txType: ClientTxType, paymentModel: PaymentModel): string {
    return super.getApiUrl(txType, paymentModel)
  }

  /**
   * @throws PosError when a value contains `&`, `%` or a character outside ISO-8859-9
   */
  protected override encode(
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    _order: PosOrder,
  ): EncodedData {
    const xml = XmlEncoder.encode(requestData, { rootName: 'posnetRequest', encoding: ISO_8859_9 })
    if (xml.includes('&') || xml.includes('%') || !isIso88599Representable(xml)) {
      throw new PosError('PosNet request values must not contain "&", "%" or characters outside ISO-8859-9')
    }

    return { data: `${FORM_FIELD}${xml}`, format: 'form' }
  }

  protected override decode(body: string): Promise<Record<string, unknown>> {
    return Promise.resolve(XmlDecoder.decode(body))
  }

  protected override requestBody(encoded: EncodedData): Uint8Array {
    return encodeIso88599(encoded.data)
  }

  protected override responseText(response: HttpTransportResponse): string {
    return decodeXmlResponseText(response)
  }

  protected override headers(): Record<string, string> {
    return { 'Content-Type': 'application/x-www-form-urlencoded' }
  }
}
