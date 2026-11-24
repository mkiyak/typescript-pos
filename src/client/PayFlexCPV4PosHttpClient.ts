import { noopLogger, type PosLogger } from '../logger.js'
import { type PaymentModel, TX_TYPE, type TxType } from '../PosInterface.js'
import type { EncodedData } from '../serializer/EncodedData.js'
import { FormEncoder } from '../serializer/FormEncoder.js'
import { JsonDecoder } from '../serializer/JsonDecoder.js'
import { XmlDecoder } from '../serializer/XmlDecoder.js'
import type { PosOrder } from '../types.js'
import { AbstractHttpClient } from './AbstractHttpClient.js'
import type { HttpTransport } from './HttpTransport.js'

/**
 * VakifBank Common Payment API (VakifBank Common Payment guide v2.1 §3). `payment_api` is the `commonPayment`
 * base address: the registration is posted form-urlencoded to `/CreateToken` (§4), every other request (the
 * transaction query, §6.5) is posted as JSON to `/GetVposTransaction`.
 *
 * Answers are requested as JSON; an XML answer (a body starting with `<`) is decoded too, and an HTML page is
 * rejected with `PosHttpError`.
 */
export class PayFlexCPV4PosHttpClient extends AbstractHttpClient {
  static readonly API_NAME_PAYMENT_API: string = 'payment_api'
  /** Accepted for configs that name the endpoint `gateway_3d`. */
  static readonly API_NAME_GATEWAY_3D: string = 'gateway_3d'

  constructor(endpoint: string, transport: HttpTransport, logger: PosLogger = noopLogger) {
    super(endpoint, transport, logger)
  }

  static supports(gatewayClass: string, apiName: string): boolean {
    return (
      gatewayClass === 'PayFlexCPV4Pos' &&
      (apiName === PayFlexCPV4PosHttpClient.API_NAME_PAYMENT_API ||
        apiName === PayFlexCPV4PosHttpClient.API_NAME_GATEWAY_3D)
    )
  }

  supportsTx(_txType: TxType, _paymentModel: PaymentModel): boolean {
    return true
  }

  override getApiUrl(txType: TxType, _paymentModel: PaymentModel): string {
    const base = this.endpoint.endsWith('/') ? this.endpoint.slice(0, -1) : this.endpoint
    if (txType === TX_TYPE.INTERNAL_3D_FORM_BUILD) {
      return `${base}/CreateToken`
    }

    return `${base}/GetVposTransaction`
  }

  protected override encode(
    txType: TxType,
    _paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    _order: PosOrder,
  ): EncodedData {
    if (txType === TX_TYPE.INTERNAL_3D_FORM_BUILD) {
      return { data: FormEncoder.encode(requestData), format: 'form' }
    }

    return { data: JSON.stringify(requestData), format: 'json' }
  }

  protected override headers(txType: TxType, paymentModel: PaymentModel, encoded: EncodedData): Record<string, string> {
    return { ...super.headers(txType, paymentModel, encoded), Accept: 'application/json' }
  }

  protected override decode(body: string): Promise<Record<string, unknown>> {
    if (body.trimStart().startsWith('<')) {
      return Promise.resolve(XmlDecoder.decode(body))
    }

    return Promise.resolve(JsonDecoder.decode(body))
  }
}
