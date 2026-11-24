import { noopLogger, type PosLogger } from '../logger.js'
import { type PaymentModel, TX_TYPE } from '../PosInterface.js'
import type { EncodedData } from '../serializer/EncodedData.js'
import { FormEncoder } from '../serializer/FormEncoder.js'
import { XmlDecoder } from '../serializer/XmlDecoder.js'
import { XmlEncoder } from '../serializer/XmlEncoder.js'
import type { PosOrder } from '../types.js'
import { AbstractHttpClient, type ClientTxType } from './AbstractHttpClient.js'
import type { HttpTransport } from './HttpTransport.js'

/**
 * Payment, capture, cancel and refund requests. The XML
 * (`VposRequest`, no XML declaration) is sent form-urlencoded as `prmstr=<xml>` to `payment_api`.
 */
export class PayFlexV4PosHttpClient extends AbstractHttpClient {
  static readonly API_NAME_PAYMENT_API: string = 'payment_api'

  constructor(endpoint: string, transport: HttpTransport, logger: PosLogger = noopLogger) {
    super(endpoint, transport, logger)
  }

  static supports(gatewayClass: string, apiName: string): boolean {
    return gatewayClass === 'PayFlexV4Pos' && apiName === PayFlexV4PosHttpClient.API_NAME_PAYMENT_API
  }

  supportsTx(txType: ClientTxType, _paymentModel: PaymentModel): boolean {
    return txType !== TX_TYPE.INTERNAL_3D_FORM_BUILD && txType !== TX_TYPE.STATUS
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
    return { data: FormEncoder.encode({ prmstr: this.encodeXml(requestData) }), format: 'form' }
  }

  /** The XML document put into `prmstr`. */
  protected encodeXml(requestData: Record<string, unknown>): string {
    return XmlEncoder.encode(requestData, { rootName: 'VposRequest', omitDeclaration: true })
  }

  protected override decode(body: string): Promise<Record<string, unknown>> {
    return Promise.resolve(XmlDecoder.decode(body))
  }
}
