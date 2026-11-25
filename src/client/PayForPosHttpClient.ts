import { noopLogger, type PosLogger } from '../logger.js'
import { type PaymentModel, TX_TYPE } from '../PosInterface.js'
import type { EncodedData } from '../serializer/EncodedData.js'
import { PayForPosXmlDecoder } from '../serializer/PayForPosXmlDecoder.js'
import { XmlEncoder } from '../serializer/XmlEncoder.js'
import type { PosOrder } from '../types.js'
import { AbstractHttpClient, type ClientTxType, requestCredentials } from './AbstractHttpClient.js'
import type { HttpTransport } from './HttpTransport.js'

/**
 * XML (`PayforRequest`, UTF-8) posted to the payment API. Payments, inquiries and queries share the endpoint; only the
 * internal 3D form build goes elsewhere. Request bodies carry card data and credentials and are never logged.
 */
export class PayForPosHttpClient extends AbstractHttpClient {
  static readonly API_NAME_PAYMENT_API = 'payment_api'

  constructor(endpoint: string, transport: HttpTransport, logger: PosLogger = noopLogger) {
    super(endpoint, transport, logger)
  }

  static supports(gatewayClass: string, apiName: string): boolean {
    return gatewayClass === 'PayForPos' && apiName === PayForPosHttpClient.API_NAME_PAYMENT_API
  }

  supportsTx(txType: ClientTxType, _paymentModel: PaymentModel): boolean {
    return txType !== TX_TYPE.INTERNAL_3D_FORM_BUILD
  }

  /** Public here (protected in the base class) so callers can see where a transaction is posted. */
  override getApiUrl(txType: ClientTxType, paymentModel: PaymentModel): string {
    return super.getApiUrl(txType, paymentModel)
  }

  /**
   * The request body carries the API user's password (`UserPass`): a bank page that echoes it, in free text too, never
   * shows it in a thrown error or a log line.
   */
  protected override logSecrets(requestData: Record<string, unknown>): readonly string[] {
    return requestCredentials(requestData)
  }

  protected override encode(
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    _order: PosOrder,
  ): EncodedData {
    return {
      data: XmlEncoder.encode(requestData, { rootName: 'PayforRequest', encoding: 'UTF-8' }),
      format: 'xml',
    }
  }

  protected override decode(body: string): Promise<Record<string, unknown>> {
    return Promise.resolve(PayForPosXmlDecoder.decode(body))
  }
}
