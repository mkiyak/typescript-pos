import { noopLogger, type PosLogger } from '../logger.js'
import type { PaymentModel } from '../PosInterface.js'
import type { EncodedData } from '../serializer/EncodedData.js'
import { FormEncoder } from '../serializer/FormEncoder.js'
import { InterPosDecoder } from '../serializer/InterPosDecoder.js'
import type { PosOrder } from '../types.js'
import { AbstractHttpClient, type ClientTxType, requestCredentials } from './AbstractHttpClient.js'
import type { HttpTransport } from './HttpTransport.js'

/**
 * Form-encoded requests posted to the single payment endpoint; the answer is a `Key=Value;;Key=Value` list.
 * Request bodies carry card data and credentials and are never logged.
 */
export class InterPosHttpClient extends AbstractHttpClient {
  static readonly API_NAME_PAYMENT_API = 'payment_api'

  constructor(endpoint: string, transport: HttpTransport, logger: PosLogger = noopLogger) {
    super(endpoint, transport, logger)
  }

  static supports(gatewayClass: string, apiName: string): boolean {
    return gatewayClass === 'InterPos' && apiName === InterPosHttpClient.API_NAME_PAYMENT_API
  }

  supportsTx(_txType: ClientTxType, _paymentModel: PaymentModel): boolean {
    return true
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
    return { data: FormEncoder.encode(requestData), format: 'form' }
  }

  protected override decode(body: string): Promise<Record<string, unknown>> {
    return Promise.resolve(InterPosDecoder.decode(body))
  }
}
