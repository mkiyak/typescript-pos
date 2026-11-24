import type { AkbankPosCrypt } from '../crypt/AkbankPosCrypt.js'
import { PosError } from '../errors.js'
import type { PosLogger } from '../logger.js'
import type { AkbankPosAccount } from '../model/account/AkbankPosAccount.js'
import type { PaymentModel } from '../PosInterface.js'
import { QUERY_TYPE } from '../pos-query/PosQueryInterface.js'
import { AkbankPosJsonDecoder } from '../serializer/AkbankPosJsonDecoder.js'
import type { EncodedData } from '../serializer/EncodedData.js'
import type { PosOrder } from '../types.js'
import { AbstractHttpClient, type ClientTxType } from './AbstractHttpClient.js'
import type { HttpTransport } from './HttpTransport.js'

/**
 * JSON posted to the Akbank API. Every request carries an `auth-hash` header: the HMAC of the exact body string that
 * goes on the wire, so the body is serialised once in `encode()` and that same string is both signed and sent. The
 * transaction report has its own URL; everything else goes to the transaction endpoint.
 */
export class AkbankPosHttpClient extends AbstractHttpClient {
  static readonly API_NAME_PAYMENT_API = 'payment_api'

  constructor(
    endpoint: string,
    transport: HttpTransport,
    logger: PosLogger,
    private readonly crypt: AkbankPosCrypt,
    private readonly account: AkbankPosAccount,
  ) {
    super(endpoint, transport, logger)
  }

  static supports(gatewayClass: string, apiName: string): boolean {
    return gatewayClass === 'AkbankPos' && apiName === AkbankPosHttpClient.API_NAME_PAYMENT_API
  }

  supportsTx(_txType: ClientTxType, _paymentModel: PaymentModel): boolean {
    return true
  }

  /** Public here (protected in the base class) so callers can see where a transaction is posted. */
  override getApiUrl(txType: ClientTxType, _paymentModel: PaymentModel): string {
    if (typeof txType !== 'string' || (txType as string) === '') {
      throw new PosError('Transaction type is required to generate API URL')
    }

    return txType === QUERY_TYPE.HISTORY
      ? `${this.endpoint}/portal/report/transaction`
      : `${this.endpoint}/transaction/process`
  }

  protected override encode(
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    _order: PosOrder,
  ): EncodedData {
    return { data: JSON.stringify(requestData), format: 'json' }
  }

  /** The signature is never logged: together with the body it would let a request be replayed. */
  protected override headers(
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
    encoded: EncodedData,
  ): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'auth-hash': this.crypt.hashString(encoded.data, this.account.getSecretKey()),
    }
  }

  protected override decode(body: string): Promise<Record<string, unknown>> {
    return Promise.resolve(AkbankPosJsonDecoder.decode(body))
  }
}
