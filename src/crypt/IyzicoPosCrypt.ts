import { createHmac } from 'node:crypto'
import { NotImplementedError, PosError } from '../errors.js'
import { IyzicoPosAccount } from '../model/account/IyzicoPosAccount.js'
import type { GatewayResponseData } from '../types.js'
import { ownValue } from '../util/ownValue.js'
import { timingSafeEqualStr } from '../util/timingSafeEqualStr.js'
import { AbstractCrypt } from './AbstractCrypt.js'
import { iyzicoSignaturePrice } from './iyzicoPrice.js'

const LOG_VALUE_LIMIT = 64

/** A hex HMAC-SHA256 digest: 32 bytes, 64 characters (compared lower-cased). */
const HASH_PATTERN = /^[0-9a-fA-F]{64}$/

/** The callback fields, in signing order. */
const CALLBACK_FIELDS = ['conversationData', 'conversationId', 'mdStatus', 'paymentId', 'status'] as const

/** The answers that carry a signature. */
export type IyzicoSignedAnswer = 'payment' | 'threeDSInit' | 'checkoutFormInit' | 'checkoutFormRetrieve' | 'refund'

/** The answer fields each signature covers, in signing order. Joined with colons and signed with the secret key. */
export const IYZICO_SIGNED_FIELDS: Readonly<Record<IyzicoSignedAnswer, readonly string[]>> = Object.freeze({
  payment: Object.freeze(['paymentId', 'currency', 'basketId', 'conversationId', 'paidPrice', 'price']),
  threeDSInit: Object.freeze(['paymentId', 'conversationId']),
  checkoutFormInit: Object.freeze(['conversationId', 'token']),
  checkoutFormRetrieve: Object.freeze([
    'paymentStatus',
    'paymentId',
    'currency',
    'basketId',
    'conversationId',
    'paidPrice',
    'price',
    'token',
  ]),
  refund: Object.freeze(['paymentId', 'price', 'currency', 'conversationId']),
})

const PRICE_FIELDS: ReadonlySet<string> = new Set(['price', 'paidPrice'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireIyzicoAccount(account: unknown): IyzicoPosAccount {
  if (!(account instanceof IyzicoPosAccount)) {
    throw new PosError('IyzicoPosAccount is required for the iyzico signature.')
  }
  return account
}

/** An own, non-empty string request value; anything else (absent, other type, empty when not allowed) is missing. */
function requiredString(data: Record<string, unknown>, name: string, allowEmpty: boolean): string {
  const value: unknown = ownValue(data, name)
  if (typeof value === 'string' && (allowEmpty || value !== '')) return value
  throw new PosError(`iyzico authorization field "${name}" is missing`)
}

/**
 * iyzico: lowercase hex HMAC-SHA256 keyed with the secret key.
 *
 * Request authorization signs the random key, the request path (without the query string) and the exact request body,
 * so the header is a bearer credential for that one body: no time or nonce is documented, which means a logged header
 * together with its body can be replayed verbatim. Neither is logged.
 *
 * The 3D Secure callback signature covers the conversation data, the conversation id, the 3D status, the payment id
 * and the status, joined with colons; it carries no amount, so the money binding happens on the authorization answer.
 * Because the values are joined with colons and any string is accepted as a value, a signed text with extra colons
 * verifies under several field splits; callers pin the fields that decide an approval (order id, 3D status, payment
 * id digits, status) so only the split that puts the colons into the conversation data can approve.
 *
 * Answers carry a signature too (see {@link IYZICO_SIGNED_FIELDS}); prices inside it are written without trailing
 * zeros.
 */
export class IyzicoPosCrypt extends AbstractCrypt<IyzicoPosAccount> {
  protected override readonly hashAlgorithm = 'sha256'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'IyzicoPos'
  }

  /**
   * Verifies the signature of the 3D Secure callback. Never throws for bad data: the signature must be an own
   * 64-character hex string, and each of the five fields an own string or absent (absent signs as empty); any other
   * type makes the check fail instead of being converted to text.
   */
  check3DHash(account: IyzicoPosAccount, data: GatewayResponseData): boolean {
    const iyzico = requireIyzicoAccount(account)
    const record: unknown = data
    if (isRecord(record)) {
      const received: unknown = ownValue(record, 'signature')
      if (typeof received === 'string' && HASH_PATTERN.test(received)) {
        const parts: string[] = []
        let valid = true
        for (const name of CALLBACK_FIELDS) {
          const value: unknown = ownValue(record, name)
          if (value === undefined) {
            parts.push('')
          } else if (typeof value === 'string') {
            parts.push(value)
          } else {
            valid = false
          }
        }
        const expected = this.hashString(parts.join(':'), iyzico.getSecretKey())
        if (valid && timingSafeEqualStr(received.toLowerCase(), expected)) {
          this.logger.debug('hash check is successful')
          return true
        }
      }
    }

    this.logger.error('hash check failed', { order_id: this.orderIdForLog(record) })
    return false
  }

  /**
   * Verifies the signature of a bank answer over the fixed field list of its kind. Every field must be an own
   * string or safe integer (prices: see the price rules), absent or other types fail; the signature must be an own
   * 64-character hex string. Never throws for bad data.
   */
  checkResponseSignature(
    account: IyzicoPosAccount,
    answer: Record<string, unknown>,
    kind: IyzicoSignedAnswer,
  ): boolean {
    const iyzico = requireIyzicoAccount(account)
    const fields = Object.hasOwn(IYZICO_SIGNED_FIELDS, kind) ? IYZICO_SIGNED_FIELDS[kind] : undefined
    const record: unknown = answer
    if (fields !== undefined && isRecord(record)) {
      const received: unknown = ownValue(record, 'signature')
      if (typeof received === 'string' && HASH_PATTERN.test(received)) {
        const parts: string[] = []
        for (const name of fields) {
          const part = this.answerPart(record, name)
          if (part === null) break
          parts.push(part)
        }
        if (parts.length === fields.length) {
          const expected = this.hashString(parts.join(':'), iyzico.getSecretKey())
          if (timingSafeEqualStr(received.toLowerCase(), expected)) {
            this.logger.debug('answer signature check is successful')
            return true
          }
        }
      }
    }

    this.logger.error('answer signature check failed', { kind, order_id: this.orderIdForLog(record) })
    return false
  }

  create3DHash(_account: IyzicoPosAccount, _formInputs: Record<string, string>): string {
    throw new NotImplementedError('iyzico 3D forms are built by the bank; there is no form hash.')
  }

  /** Signature over `rnd + uri + requestBody`. Each part must be an own string (the body may be empty). */
  createHash(account: IyzicoPosAccount, requestData: Record<string, unknown>): string {
    const record: Record<string, unknown> = isRecord(requestData) ? requestData : {}
    const rnd = requiredString(record, 'rnd', false)
    const uri = requiredString(record, 'uri', false)
    const requestBody = requiredString(record, 'requestBody', true)
    return this.hashString([rnd, uri, requestBody].join(this.hashSeparator), account.getSecretKey())
  }

  /**
   * The `Authorization` header: `IYZWSv2 ` followed by the base64 of the API key, a random key and the signature.
   * The signature covers the path of `url` (never its query string) and `body`, which must be the exact text sent.
   */
  authorizationHeader(
    account: IyzicoPosAccount,
    url: string,
    body: string,
    rnd: string = this.generateRandomString(),
  ): string {
    const iyzico = requireIyzicoAccount(account)
    let path: string
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:') throw new PosError('iyzico requests need an https URL')
      path = parsed.pathname
    } catch (error) {
      if (error instanceof PosError) throw error
      throw new PosError('iyzico requests need an https URL')
    }
    const signature = this.createHash(iyzico, { rnd, uri: path, requestBody: body })
    const parts = `apiKey:${iyzico.getApiKey()}&randomKey:${rnd}&signature:${signature}`
    return `IYZWSv2 ${Buffer.from(parts, 'utf8').toString('base64')}`
  }

  override hashString(str: string, encryptionKey: string | null = null): string {
    if (encryptionKey === null) {
      throw new PosError('Encryption key is required.')
    }
    return createHmac('sha256', encryptionKey).update(str, 'utf8').digest('hex')
  }

  private answerPart(answer: Record<string, unknown>, name: string): string | null {
    const value: unknown = ownValue(answer, name)
    if (PRICE_FIELDS.has(name)) return iyzicoSignaturePrice(value)
    if (typeof value === 'string') return value
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
    return null
  }

  private orderIdForLog(data: unknown): string | undefined {
    if (!isRecord(data)) return undefined
    const orderId: unknown = ownValue(data, 'conversationId')
    return typeof orderId === 'string' ? orderId.slice(0, LOG_VALUE_LIMIT) : undefined
  }
}
