import { PosError, UnsupportedTransactionTypeError } from '../errors.js'
import { noopLogger, type PosLogger } from '../logger.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../PosInterface.js'
import { QUERY_TYPE } from '../pos-query/PosQueryInterface.js'
import type { EncodedData } from '../serializer/EncodedData.js'
import { encodeIso88591, ISO_8859_1, toIso88591Xml } from '../serializer/iso88591.js'
import { decodeXmlResponseText } from '../serializer/iso88599.js'
import { VakifKatilimPosXmlDecoder } from '../serializer/VakifKatilimPosXmlDecoder.js'
import { XmlEncoder } from '../serializer/XmlEncoder.js'
import type { PosOrder } from '../types.js'
import { ownValue } from '../util/ownValue.js'
import { AbstractHttpClient, type ClientTxType } from './AbstractHttpClient.js'
import { assertPaymentAnswerHasCode } from './boaPaymentAnswer.js'
import type { HttpTransport, HttpTransportResponse } from './HttpTransport.js'

type Node = string | Readonly<Record<string, unknown>>

/**
 * Gateway path of each transaction type. A text is the path for every payment model; a record picks by payment
 * model and then, for reversals and refunds, by the kind of order being reversed (a sale or a pre-authorization).
 */
const PATHS: Readonly<Record<string, Node>> = {
  [TX_TYPE.INTERNAL_3D_FORM_BUILD]: 'ThreeDModelPayGate',
  [TX_TYPE.PAY_AUTH]: {
    [MODEL.NON_SECURE]: 'Non3DPayGate',
    [MODEL.THREE_D_SECURE]: 'ThreeDModelProvisionGate',
  },
  [TX_TYPE.PAY_PRE_AUTH]: { [MODEL.NON_SECURE]: 'PreAuthorizaten' },
  [TX_TYPE.PAY_POST_AUTH]: 'PreAuthorizatenClose',
  [TX_TYPE.CANCEL]: {
    [MODEL.NON_SECURE]: { [TX_TYPE.PAY_AUTH]: 'SaleReversal', [TX_TYPE.PAY_PRE_AUTH]: 'PreAuthorizationReversal' },
  },
  [TX_TYPE.REFUND]: {
    [MODEL.NON_SECURE]: { [TX_TYPE.PAY_AUTH]: 'DrawBack', [TX_TYPE.PAY_PRE_AUTH]: 'PreAuthorizationDrawBack' },
  },
  [TX_TYPE.REFUND_PARTIAL]: { [MODEL.NON_SECURE]: { [TX_TYPE.PAY_AUTH]: 'PartialDrawBack' } },
  [TX_TYPE.STATUS]: 'SelectOrderByMerchantOrderId',
  [TX_TYPE.ORDER_HISTORY]: 'SelectOrder',
  [QUERY_TYPE.HISTORY]: 'SelectOrder',
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** The kind of order a reversal or refund is for, as the caller states it; an unset one means a sale. */
function orderTxTypeOf(order: PosOrder): unknown {
  const value: unknown = order.transaction_type

  return value === undefined || value === null ? null : value
}

/** `encoding="utf-16"` of an XML declaration at the start of the body. */
const UTF16_DECLARATION = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']utf-16["']/i

/**
 * XML posted to the Vakıf Katılım gateway. The body is ISO-8859-1 (characters outside it become numeric references)
 * with the `text/xml; charset=UTF-8` header the bank expects. The 3D form request is answered with the bank's HTML
 * page, which is handed back untouched as `{ html }`; every other answer is XML (an HTML or empty page is a
 * `PosHttpError`). Bodies carry card data and credentials and are never logged.
 */
export class VakifKatilimPosHttpClient extends AbstractHttpClient {
  static readonly API_NAME_PAYMENT_API = 'payment_api'
  /** Older configurations name the payment endpoint `gateway_3d`. */
  static readonly API_NAME_GATEWAY_3D_API = 'gateway_3d'

  constructor(endpoint: string, transport: HttpTransport, logger: PosLogger = noopLogger) {
    super(endpoint, transport, logger)
  }

  static supports(gatewayClass: string, apiName: string): boolean {
    return (
      gatewayClass === 'VakifKatilimPos' &&
      (apiName === VakifKatilimPosHttpClient.API_NAME_PAYMENT_API ||
        apiName === VakifKatilimPosHttpClient.API_NAME_GATEWAY_3D_API)
    )
  }

  /** A custom query has no route of its own but is supported: the caller names the url. */
  supportsTx(txType: ClientTxType, paymentModel: PaymentModel): boolean {
    return txType === QUERY_TYPE.CUSTOM_QUERY || this.pathOf(txType, paymentModel, null) !== undefined
  }

  /**
   * Public here (protected in the base class) so callers can see where a transaction is posted.
   *
   * @param orderTxType the kind of order a cancel or refund is for (`pay` or `pre`); unset means a sale
   * @throws UnsupportedTransactionTypeError when the bank has no path for the transaction type and payment model
   * @throws PosError for a custom query, which has no path
   */
  override getApiUrl(txType: ClientTxType, paymentModel: PaymentModel, orderTxType: TxType | null = null): string {
    if (txType === QUERY_TYPE.CUSTOM_QUERY) {
      throw new PosError('Vakıf Katılım custom queries need an apiUrl')
    }

    const path = this.pathOf(txType, paymentModel, orderTxType)
    if (path === undefined) {
      throw new UnsupportedTransactionTypeError(
        `Transaction type [${String(txType)}] is not supported for payment model [${String(paymentModel)}]`,
      )
    }

    return `${this.endpoint}/${path}`
  }

  /**
   * The kind of the order being reversed is read from the order the gateway already passes along. The answer to a
   * request that can move money (provision, sale, pre-authorization, close) must carry a response code: one that
   * does not says nothing about the money and is an unknown outcome (`PosHttpError` naming the request URL).
   */
  override async request(
    txType: ClientTxType,
    paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    order: PosOrder,
    url?: string | null,
  ): Promise<Record<string, unknown>> {
    const target = url ?? this.getApiUrl(txType, paymentModel, orderTxTypeOf(order) as TxType | null)
    const answer = await super.request(txType, paymentModel, requestData, order, target)
    assertPaymentAnswerHasCode(txType, answer, target)

    return answer
  }

  private pathOf(txType: unknown, paymentModel: unknown, orderTxType: unknown): string | undefined {
    if (typeof txType !== 'string' || typeof paymentModel !== 'string') return undefined

    const byTx = ownValue(PATHS, txType)
    if (typeof byTx === 'string') return byTx
    const byModel = isRecord(byTx) ? ownValue(byTx as Record<string, Node>, paymentModel) : undefined
    if (typeof byModel === 'string') return byModel
    if (!isRecord(byModel)) return undefined

    const kind = orderTxType ?? TX_TYPE.PAY_AUTH
    if (typeof kind !== 'string') return undefined
    const path = ownValue(byModel as Record<string, Node>, kind)

    return typeof path === 'string' ? path : undefined
  }

  protected override encode(
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    _order: PosOrder,
  ): EncodedData {
    return {
      data: XmlEncoder.encode(requestData, { rootName: 'VPosMessageContract', encoding: ISO_8859_1 }),
      format: 'xml',
    }
  }

  protected override requestBody(encoded: EncodedData): Uint8Array {
    return encodeIso88591(toIso88591Xml(encoded.data))
  }

  /**
   * The bank sometimes announces `utf-16` on text that is UTF-8; such an answer is read as UTF-8. Any other declared
   * charset is honoured.
   */
  protected override responseText(response: HttpTransportResponse): string {
    const head = Buffer.from(response.bytes.subarray(0, 200)).toString('latin1')
    if (UTF16_DECLARATION.test(head)) return response.body

    return decodeXmlResponseText(response)
  }

  protected override decode(
    body: string,
    txType: ClientTxType,
    _paymentModel: PaymentModel,
  ): Promise<Record<string, unknown>> {
    if (txType === TX_TYPE.INTERNAL_3D_FORM_BUILD) {
      return Promise.resolve({ html: body })
    }

    return Promise.resolve(VakifKatilimPosXmlDecoder.decode(body))
  }
}
