import { IyzicoPosCrypt } from '../crypt/IyzicoPosCrypt.js'
import { PosError, PosHttpError } from '../errors.js'
import type { PosLogger } from '../logger.js'
import { IyzicoPosAccount } from '../model/account/IyzicoPosAccount.js'
import type { PaymentModel } from '../PosInterface.js'
import { JsonDecoder } from '../serializer/JsonDecoder.js'
import { AbstractHttpClient, type ClientTxType } from './AbstractHttpClient.js'
import type { HttpTransport, HttpTransportResponse } from './HttpTransport.js'

const UTF8_BOM = [0xef, 0xbb, 0xbf]

/**
 * What both iyzico clients share: every request carries an `Authorization` header computed from the exact URL path
 * and body that go on the wire, answers must be JSON objects, and the secret key is masked in every log line and
 * error snippet. The credentials live in true private fields, so a JSON or inspect dump of a client shows none.
 */
export abstract class AbstractIyzicoPosHttpClient extends AbstractHttpClient {
  readonly #crypt: IyzicoPosCrypt
  readonly #account: IyzicoPosAccount

  constructor(
    endpoint: string,
    transport: HttpTransport,
    logger: PosLogger,
    crypt: IyzicoPosCrypt,
    account: IyzicoPosAccount,
  ) {
    super(endpoint, transport, logger)
    if (!(crypt instanceof IyzicoPosCrypt)) {
      throw new PosError('The iyzico clients need the iyzico crypt to sign requests.')
    }
    if (!(account instanceof IyzicoPosAccount)) {
      throw new PosError('The iyzico clients need an iyzico account to sign requests.')
    }
    this.#crypt = crypt
    this.#account = account
  }

  /** The `Authorization` value for a request to `url` with exactly this body. It is never logged. */
  protected authorization(url: string, body: string): string {
    return this.#crypt.authorizationHeader(this.#account, url, body)
  }

  /** The secret key may be echoed by a bank text; it must not reach a log line or a thrown error. */
  protected override logSecrets(_requestData: Record<string, unknown>): readonly string[] {
    return [this.#account.getSecretKey()]
  }

  /** Only a request that cannot move money may read a client error body; see the iyzico clients. */
  protected override isReadableFailure(decoded: Record<string, unknown>): boolean {
    return Object.hasOwn(decoded, 'status') && decoded.status === 'failure'
  }

  /**
   * The JSON decoder reads an empty body as `{}`; here a 200 answer without a body would pass for "no fields" and
   * hide that the bank said nothing, so it is an error (a 204 never gets this far).
   */
  protected override decode(
    body: string,
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
  ): Promise<Record<string, unknown>> {
    if (body.trim() === '') {
      return Promise.reject(new PosHttpError('Bank response is empty', { url: '' }))
    }

    return Promise.resolve(JsonDecoder.decode(body))
  }

  /** A byte order mark is not expected from the bank, and the text decoder would drop it silently: refuse it. */
  protected override responseText(response: HttpTransportResponse): string {
    if (UTF8_BOM.every((byte, i) => response.bytes[i] === byte)) {
      throw new PosHttpError('Bank response starts with a byte order mark', { url: '', status: response.status })
    }

    return response.body
  }
}
