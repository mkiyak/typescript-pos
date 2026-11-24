import type { RequestValueMapperInterface } from '../data-mapper/request/value-mapper/RequestValueMapperInterface.js'
import { PosError, UnsupportedTransactionTypeError } from '../errors.js'
import type { PosLogger } from '../logger.js'
import type { PaymentModel } from '../PosInterface.js'
import { QUERY_TYPE } from '../pos-query/PosQueryInterface.js'
import type { EncodedData } from '../serializer/EncodedData.js'
import { JsonDecoder } from '../serializer/JsonDecoder.js'
import type { PosOrder } from '../types.js'
import { AbstractHttpClient, type ClientTxType } from './AbstractHttpClient.js'
import type { HttpTransport } from './HttpTransport.js'

/**
 * JSON posted to the POSNET JSON API (Albaraka). Every transaction type has its own URL: the endpoint followed by
 * the bank's name of the transaction (`…/Sale`, `…/Reverse`, …). A custom query has no transaction name, so it is
 * sent only to the full URL the caller passes. An unmapped transaction type is refused before anything is sent.
 *
 * The body is never logged (the base class logs only the URL and the transaction type). An HTML or invalid answer
 * is a `PosHttpError`.
 */
export class PosNetV1PosHttpClient extends AbstractHttpClient {
  static readonly API_NAME_PAYMENT_API = 'payment_api'

  constructor(
    endpoint: string,
    transport: HttpTransport,
    logger: PosLogger,
    private readonly requestValueMapper: RequestValueMapperInterface,
  ) {
    super(endpoint, transport, logger)
  }

  static supports(gatewayClass: string, apiName: string): boolean {
    return gatewayClass === 'PosNetV1Pos' && apiName === PosNetV1PosHttpClient.API_NAME_PAYMENT_API
  }

  supportsTx(txType: ClientTxType, _paymentModel: PaymentModel): boolean {
    if (txType === QUERY_TYPE.CUSTOM_QUERY) {
      return true
    }
    try {
      this.requestValueMapper.mapTxType(txType)
    } catch (e) {
      if (e instanceof UnsupportedTransactionTypeError) {
        return false
      }
      throw e
    }

    return true
  }

  /**
   * Public here (protected in the base class) so callers can see where a transaction is posted.
   *
   * @throws PosError when no transaction type is given, or for a custom query (it needs the full URL)
   * @throws UnsupportedTransactionTypeError when the bank has no URL for the transaction type
   */
  override getApiUrl(txType: ClientTxType, _paymentModel: PaymentModel): string {
    if (typeof txType !== 'string' || (txType as string) === '') {
      throw new PosError('Transaction type is required to generate API URL')
    }
    if (txType === QUERY_TYPE.CUSTOM_QUERY) {
      throw new PosError('PosNetV1 custom queries need the full API URL (apiUrl)')
    }

    return `${this.endpoint}/${this.requestValueMapper.mapTxType(txType)}`
  }

  protected override encode(
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    _order: PosOrder,
  ): EncodedData {
    return { data: JSON.stringify(requestData), format: 'json' }
  }

  protected override headers(): Record<string, string> {
    return { 'Content-Type': 'application/json' }
  }

  protected override decode(body: string): Promise<Record<string, unknown>> {
    return Promise.resolve(JsonDecoder.decode(body))
  }
}
