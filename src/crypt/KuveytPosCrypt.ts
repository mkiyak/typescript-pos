import { createHash } from 'node:crypto'
import { NotImplementedError, PosError } from '../errors.js'
import type { BoaPosAccount } from '../model/account/BoaPosAccount.js'
import type { GatewayResponseData } from '../types.js'
import { ownValue } from '../util/ownValue.js'
import { timingSafeEqualStr } from '../util/timingSafeEqualStr.js'
import { AbstractCrypt } from './AbstractCrypt.js'

const LOG_VALUE_LIMIT = 64

/** Base64 SHA-1: 27 characters and one padding character. */
const HASH_PATTERN = /^[A-Za-z0-9+/]{27}=$/

/** Request fields that may be absent (payment-less requests have no order or amount, non 3D requests no URLs). */
const OPTIONAL_FIELDS = ['MerchantOrderId', 'Amount', 'OkUrl', 'FailUrl'] as const

/**
 * Signature of a 3D callback: base64 SHA-1 over the three signed values followed by the hashed password,
 * concatenated without separators.
 */
export function boaCallbackHash(
  hashedPassword: string,
  merchantOrderId: string,
  responseCode: string,
  orderId: string,
): string {
  return createHash('sha1')
    .update(`${merchantOrderId}${responseCode}${orderId}${hashedPassword}`, 'utf8')
    .digest('base64')
}

function requiredText(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new PosError(`${what} is required to sign the request.`)
  }
  return value
}

function optionalText(value: unknown, what: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  throw new PosError(`${what} must be text or a number to sign the request.`)
}

/**
 * Kuveyt Turk and Vakif Katilim (BOA): SHA-1 (base64) over the request values and the SHA-1 of the API password.
 *
 * The bank signs only three callback fields: `MerchantOrderId`, `ResponseCode` and `OrderId`, followed by the hashed
 * password, with no separator between them. Everything else in the callback (the authentication packet `MD`, the
 * messages, the provision numbers and the whole `VPosMessage` including its amount, currency, installment count
 * and security model) is not covered, and the signature covers no amount at all. Because the three values run
 * together, one genuine signature also fits other splits of the same text; callers must pin the order id and the
 * bank id themselves.
 */
export class KuveytPosCrypt extends AbstractCrypt<BoaPosAccount> {
  protected override readonly hashAlgorithm = 'sha1'

  protected override readonly hashSeparator = ''

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'KuveytPos' || gatewayClass === 'VakifKatilimPos'
  }

  create3DHash(_account: BoaPosAccount, _formInputs: Record<string, string>): string {
    throw new NotImplementedError('BOA 3D forms are built by the bank; there is no form hash.')
  }

  /**
   * Checks the signature of the 3D callback. It fails closed and never throws: the signature must look like a
   * base64 SHA-1 and the three signed values must be own top-level strings (an absent, null, numeric or nested
   * value is not merged into its neighbours). Neither the computed hash, nor the password, nor the callback data is
   * logged; only the order id is.
   */
  check3DHash(account: BoaPosAccount, data: GatewayResponseData): boolean {
    if (typeof data !== 'object' || data === null) {
      this.logger.error('hash check failed', { order_id: undefined })
      return false
    }
    const received: unknown = ownValue(data, 'HashData')
    const merchantOrderId: unknown = ownValue(data, 'MerchantOrderId')
    const responseCode: unknown = ownValue(data, 'ResponseCode')
    const orderId: unknown = ownValue(data, 'OrderId')

    if (
      typeof received === 'string' &&
      HASH_PATTERN.test(received) &&
      typeof merchantOrderId === 'string' &&
      typeof responseCode === 'string' &&
      typeof orderId === 'string'
    ) {
      const expected = boaCallbackHash(this.hashString(account.getSecretKey()), merchantOrderId, responseCode, orderId)
      if (timingSafeEqualStr(received, expected)) {
        this.logger.debug('hash check is successful', { order_id: this.orderIdForLog(merchantOrderId) })
        return true
      }
    }

    this.logger.error('hash check failed', { order_id: this.orderIdForLog(merchantOrderId) })
    return false
  }

  /**
   * Request signature: merchant, order, amount, both return URLs and user name, then the hashed password. Absent
   * order, amount and URL fields sign as empty; a missing merchant or user name, or a value that is not text or a
   * number, is an error instead of a signed `undefined`.
   */
  createHash(account: BoaPosAccount, requestData: Record<string, unknown>): string {
    const merchantId = requiredText(ownValue(requestData, 'MerchantId'), 'MerchantId')
    const userName = requiredText(ownValue(requestData, 'UserName'), 'UserName')
    const [merchantOrderId, amount, okUrl, failUrl] = OPTIONAL_FIELDS.map((name) =>
      optionalText(ownValue(requestData, name), name),
    ) as [string, string, string, string]
    const hashedPassword = this.hashString(account.getSecretKey())

    return this.hashString(
      [merchantId, merchantOrderId, amount, okUrl, failUrl, userName, hashedPassword].join(this.hashSeparator),
    )
  }

  private orderIdForLog(merchantOrderId: unknown): string | undefined {
    return typeof merchantOrderId === 'string' ? merchantOrderId.slice(0, LOG_VALUE_LIMIT) : undefined
  }
}
