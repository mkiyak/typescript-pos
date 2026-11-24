import { noopLogger, type PosLogger } from '../logger.js'
import { type PaymentModel, TX_TYPE } from '../PosInterface.js'
import type { EncodedData } from '../serializer/EncodedData.js'
import { FormEncoder } from '../serializer/FormEncoder.js'
import { XmlDecoder } from '../serializer/XmlDecoder.js'
import type { PosOrder } from '../types.js'
import { AbstractHttpClient, type ClientTxType } from './AbstractHttpClient.js'
import type { HttpTransport } from './HttpTransport.js'

/**
 * The 3D enrollment request (VerifyEnrollmentRequest),
 * posted form-urlencoded to `gateway_3d`; the XML answer (`IPaySecure`) is decoded.
 */
export class PayFlexV4Pos3DFormHttpClient extends AbstractHttpClient {
  static readonly API_NAME_GATEWAY_3D_API = 'gateway_3d'

  constructor(endpoint: string, transport: HttpTransport, logger: PosLogger = noopLogger) {
    super(endpoint, transport, logger)
  }

  static supports(gatewayClass: string, apiName: string): boolean {
    return gatewayClass === 'PayFlexV4Pos' && apiName === PayFlexV4Pos3DFormHttpClient.API_NAME_GATEWAY_3D_API
  }

  supportsTx(txType: ClientTxType, _paymentModel: PaymentModel): boolean {
    return txType === TX_TYPE.INTERNAL_3D_FORM_BUILD
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
    return { data: FormEncoder.encode(requestData), format: 'form' }
  }

  protected override decode(body: string): Promise<Record<string, unknown>> {
    return Promise.resolve(XmlDecoder.decode(body))
  }
}
