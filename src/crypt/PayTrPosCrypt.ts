import { createHmac } from 'node:crypto'
import { PosError } from '../errors.js'
import type { PayTrPosAccount } from '../model/account/PayTrPosAccount.js'
import type { GatewayResponseData } from '../types.js'
import { ownValue } from '../util/ownValue.js'
import { timingSafeEqualStr } from '../util/timingSafeEqualStr.js'
import { AbstractCrypt } from './AbstractCrypt.js'

const LOG_VALUE_LIMIT = 64

/** A base64 HMAC-SHA256 digest: 32 bytes, 44 characters with one padding character. */
const HASH_PATTERN = /^[A-Za-z0-9+/]{43}=$/

const HISTORY_FIELDS = ['merchant_id', 'start_date', 'end_date'] as const
const REFUND_FIELDS = ['merchant_id', 'merchant_oid', 'return_amount'] as const
const DIRECT_FIELDS = [
  'merchant_id',
  'user_ip',
  'merchant_oid',
  'email',
  'payment_amount',
  'payment_type',
  'installment_count',
  'currency',
  'test_mode',
  'non_3d',
] as const
const IFRAME_FIELDS = [
  'merchant_id',
  'user_ip',
  'merchant_oid',
  'email',
  'payment_amount',
  'user_basket',
  'no_installment',
  'max_installment',
  'currency',
  'test_mode',
] as const
const RATES_FIELDS = ['merchant_id', 'request_id'] as const
const BIN_FIELDS = ['bin_number', 'merchant_id'] as const
const STATUS_FIELDS = ['merchant_id', 'merchant_oid'] as const

/** PHP `isset`: an own key whose value is neither absent nor null. */
function isSet(data: Record<string, unknown>, name: string): boolean {
  const value: unknown = ownValue(data, name)
  return value !== undefined && value !== null
}

/** A request value that can be signed: an own string (empty allowed) or a finite number. */
function signable(data: Record<string, unknown>, name: string): string {
  const value: unknown = ownValue(data, name)
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
    return String(value)
  }
  throw new PosError(`PayTR request field "${name}" is missing`)
}

/**
 * PayTR: base64 HMAC-SHA256 over the signed values joined without separators and followed by the merchant salt,
 * keyed with the merchant key.
 *
 * The request token is a bearer credential for the body it travels with: it signs no time or nonce, so a logged
 * body plus its token can be replayed verbatim. Neither is logged.
 *
 * The notification signature covers the order id, the status word and the total amount in kuruş, with the secret
 * salt between the order id and the status. The currency, the payment amount, the installment count, the payment
 * type, the test-mode flag and the failure reasons are not signed.
 */
export class PayTrPosCrypt extends AbstractCrypt<PayTrPosAccount> {
  protected override readonly hashAlgorithm = 'sha256'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayTrPos'
  }

  /**
   * Verifies the signature of the server-to-server notification. Never throws: the hash must be an own 44-character
   * base64 string, and the order id, status and total amount must each be an own string, absent or null (those
   * count as empty); any other type makes the check fail instead of being converted to text.
   */
  check3DHash(account: PayTrPosAccount, data: GatewayResponseData): boolean {
    const record: unknown = data
    if (record !== null && typeof record === 'object' && !Array.isArray(record)) {
      const received: unknown = ownValue(data, 'hash')
      if (typeof received === 'string' && HASH_PATTERN.test(received)) {
        const parts = [
          ownValue(data, 'merchant_oid'),
          undefined,
          ownValue(data, 'status'),
          ownValue(data, 'total_amount'),
        ]
        let signed = ''
        let valid = true
        for (const [index, part] of parts.entries()) {
          if (index === 1) {
            signed += account.getPassword()
          } else if (part === undefined || part === null) {
            // an absent value signs as the empty string
          } else if (typeof part === 'string') {
            signed += part
          } else {
            valid = false
          }
        }
        if (valid && timingSafeEqualStr(received, this.hashString(signed, account.getSecretKey()))) {
          this.logger.debug('hash check is successful')
          return true
        }
      }
    }

    this.logger.error('hash check failed', { order_id: this.orderIdForLog(data) })
    return false
  }

  /**
   * Request token. The formula is picked from the keys present, in this order: history (`start_date` and
   * `end_date`), refund (`return_amount`), direct payment (`non_3d`), iFrame token (`no_installment` or
   * `max_installment`), installment rates (`request_id`), BIN query (`bin_number`), else order status.
   */
  createHash(account: PayTrPosAccount, requestData: Record<string, unknown>): string {
    const fields = this.formulaFor(requestData)
    const message = fields.map((name) => signable(requestData, name)).join(this.hashSeparator)
    return this.hashString(message + account.getPassword(), account.getSecretKey())
  }

  create3DHash(account: PayTrPosAccount, formInputs: Record<string, string>): string {
    return this.createHash(account, formInputs)
  }

  override hashFromParams(
    account: PayTrPosAccount,
    data: Record<string, unknown>,
    hashParamsValue: string,
    paramSeparator = ':',
  ): string {
    if (hashParamsValue === '') {
      throw new PosError('hashParamsValue cannot be empty')
    }
    const hashVal = this.buildHashString(data, hashParamsValue.split(paramSeparator), '', account.getPassword())
    return this.hashString(hashVal, account.getSecretKey())
  }

  override hashString(str: string, encryptionKey: string | null = null): string {
    return createHmac('sha256', encryptionKey ?? '')
      .update(str, 'utf8')
      .digest('base64')
  }

  private formulaFor(data: Record<string, unknown>): readonly string[] {
    if (isSet(data, 'start_date') && isSet(data, 'end_date')) return HISTORY_FIELDS
    if (isSet(data, 'return_amount')) return REFUND_FIELDS
    if (isSet(data, 'non_3d')) return DIRECT_FIELDS
    if (isSet(data, 'no_installment') || isSet(data, 'max_installment')) return IFRAME_FIELDS
    if (isSet(data, 'request_id')) return RATES_FIELDS
    if (isSet(data, 'bin_number')) return BIN_FIELDS
    return STATUS_FIELDS
  }

  private orderIdForLog(data: unknown): string | undefined {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined
    const orderId: unknown = ownValue(data as GatewayResponseData, 'merchant_oid')
    return typeof orderId === 'string' ? orderId.slice(0, LOG_VALUE_LIMIT) : undefined
  }
}
