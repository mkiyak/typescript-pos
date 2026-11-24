import { UnsupportedTransactionTypeError } from '../errors.js'
import { noopLogger, type PosLogger } from '../logger.js'
import { MODEL, type PaymentModel, TX_TYPE } from '../PosInterface.js'
import type { EncodedData } from '../serializer/EncodedData.js'
import { encodeIso88591, ISO_8859_1, toIso88591Xml } from '../serializer/iso88591.js'
import { decodeXmlResponseText } from '../serializer/iso88599.js'
import { XmlDecoder } from '../serializer/XmlDecoder.js'
import { XmlEncoder } from '../serializer/XmlEncoder.js'
import type { PosOrder } from '../types.js'
import { ownValue } from '../util/ownValue.js'
import { AbstractHttpClient, type ClientTxType } from './AbstractHttpClient.js'
import { assertPaymentAnswerHasCode } from './boaPaymentAnswer.js'
import type { HttpTransport, HttpTransportResponse } from './HttpTransport.js'

/** Gateway path of each transaction type and payment model. */
const PATHS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  [TX_TYPE.PAY_AUTH]: {
    [MODEL.NON_SECURE]: 'Non3DPayGate',
    [MODEL.THREE_D_SECURE]: 'ThreeDModelProvisionGate',
  },
  [TX_TYPE.INTERNAL_3D_FORM_BUILD]: {
    [MODEL.THREE_D_SECURE]: 'ThreeDModelPayGate',
  },
}

/**
 * XML posted to the Kuveyt Turk gateway. The body is ISO-8859-1 (characters outside it become numeric references)
 * with the `text/xml; charset=UTF-8` header the bank expects. The 3D form request is answered with the bank's HTML
 * page, which is handed back untouched as `{ html }`; every other answer is XML (an HTML or empty page is a
 * `PosHttpError`). Bodies carry card data and credentials and are never logged.
 */
export class KuveytPosHttpClient extends AbstractHttpClient {
  static readonly API_NAME_PAYMENT_API = 'payment_api'
  /** Older configurations name the payment endpoint `gateway_3d`. */
  static readonly API_NAME_GATEWAY_3D_API = 'gateway_3d'

  constructor(endpoint: string, transport: HttpTransport, logger: PosLogger = noopLogger) {
    super(endpoint, transport, logger)
  }

  static supports(gatewayClass: string, apiName: string): boolean {
    return (
      gatewayClass === 'KuveytPos' &&
      (apiName === KuveytPosHttpClient.API_NAME_PAYMENT_API || apiName === KuveytPosHttpClient.API_NAME_GATEWAY_3D_API)
    )
  }

  supportsTx(txType: ClientTxType, paymentModel: PaymentModel): boolean {
    return this.pathOf(txType, paymentModel) !== undefined
  }

  /**
   * Public here (protected in the base class) so callers can see where a transaction is posted.
   *
   * @throws UnsupportedTransactionTypeError when the bank has no path for the transaction type and payment model
   */
  override getApiUrl(txType: ClientTxType, paymentModel: PaymentModel): string {
    const path = this.pathOf(txType, paymentModel)
    if (path === undefined) {
      throw new UnsupportedTransactionTypeError(
        `Transaction type [${String(txType)}] is not supported for payment model [${String(paymentModel)}]`,
      )
    }

    return `${this.endpoint}/${path}`
  }

  /**
   * The answer to the provision or a sale must carry a response code: one that does not says nothing about the
   * money and is an unknown outcome (`PosHttpError` naming the request URL), never a decline.
   */
  override async request(
    txType: ClientTxType,
    paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    order: PosOrder,
    url?: string | null,
  ): Promise<Record<string, unknown>> {
    const target = url ?? this.getApiUrl(txType, paymentModel)
    const answer = await super.request(txType, paymentModel, requestData, order, target)
    assertPaymentAnswerHasCode(txType, answer, target)

    return answer
  }

  private pathOf(txType: ClientTxType, paymentModel: PaymentModel): string | undefined {
    const byModel = ownValue(PATHS, txType) as Record<string, string> | undefined
    if (byModel === undefined) return undefined

    return ownValue(byModel, paymentModel) as string | undefined
  }

  protected override encode(
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    _order: PosOrder,
  ): EncodedData {
    return {
      data: XmlEncoder.encode(requestData, { rootName: 'KuveytTurkVPosMessage', encoding: ISO_8859_1 }),
      format: 'xml',
    }
  }

  protected override requestBody(encoded: EncodedData): Uint8Array {
    return encodeIso88591(toIso88591Xml(encoded.data))
  }

  /** The form page is HTML in UTF-8; only XML answers follow the charset of their declaration. */
  protected override responseText(response: HttpTransportResponse, txType?: ClientTxType): string {
    return txType === TX_TYPE.INTERNAL_3D_FORM_BUILD ? response.body : decodeXmlResponseText(response)
  }

  protected override decode(
    body: string,
    txType: ClientTxType,
    _paymentModel: PaymentModel,
  ): Promise<Record<string, unknown>> {
    if (txType === TX_TYPE.INTERNAL_3D_FORM_BUILD) {
      return Promise.resolve({ html: body })
    }

    return Promise.resolve(XmlDecoder.decode(body))
  }
}
