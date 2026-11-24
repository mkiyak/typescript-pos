import { createHash } from 'node:crypto'
import { NotImplementedError, PosError } from '../errors.js'
import type { PayForPosAccount } from '../model/account/PayForPosAccount.js'
import type { GatewayResponseData } from '../types.js'
import { ownValue } from '../util/ownValue.js'
import { timingSafeEqualStr } from '../util/timingSafeEqualStr.js'
import { AbstractCrypt } from './AbstractCrypt.js'

const LOG_VALUE_LIMIT = 64

/** Base64 length of a SHA-1 and of a SHA-256 digest. */
const SHA1_BASE64_LENGTH = 28
const SHA256_BASE64_LENGTH = 44

/** The values the 3D form hash covers, in signing order; each must be given as a non-empty string. */
const FORM_HASH_FIELDS = ['MbrId', 'OrderId', 'PurchAmount', 'OkUrl', 'FailUrl', 'TxnType', 'InstallmentCount', 'Rnd']

function requiredText(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new PosError(`${what} is required to sign the request.`)
  }
  return value
}

/** A callback value that is part of the signed text: an own, non-empty string. */
function callbackText(data: GatewayResponseData, name: string): string | null {
  const value: unknown = ownValue(data, name)
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * PayFor: SHA-1 (base64) over the 3D form values and the 3D secret. The bank signs its callback with SHA-1 or SHA-256
 * depending on the merchant's setup; the callback is verified with the algorithm its own hash length says.
 */
export class PayForPosCrypt extends AbstractCrypt<PayForPosAccount> {
  protected override readonly hashAlgorithm = 'sha1'

  protected override readonly hashSeparator = ''

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayForPos'
  }

  /**
   * Hash of the 3D form: member, order, amount, both return URLs, transaction type, installment count and random
   * value, then the 3D secret. Call it after the form hooks, so the signature covers what is posted.
   */
  create3DHash(account: PayForPosAccount, formInputs: Record<string, string>): string {
    const secretKey = account.getSecretKey()
    const parts = FORM_HASH_FIELDS.map((name) => requiredText(ownValue(formInputs, name), name))
    const [mbrId, orderId, amount, okUrl, failUrl, txnType, installment, rnd] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]

    return this.hashString(
      [mbrId, orderId, amount, okUrl, failUrl, txnType, installment, rnd, secretKey].join(this.hashSeparator),
    )
  }

  /**
   * Checks the signature the bank puts on the 3D callback: merchant, 3D secret, order, authorization code, return
   * code, 3D status, random value and user code, concatenated. The callback must hold those values as own top-level
   * strings (the authorization code may be absent), and the signature must be a SHA-1 (28 characters) or a SHA-256
   * (44 characters) digest. Anything else fails closed. The generated hash is deliberately not logged.
   */
  check3DHash(account: PayForPosAccount, data: GatewayResponseData): boolean {
    const secretKey = account.getSecretKey()
    const received = callbackText(data, 'ResponseHash')
    const orderId = callbackText(data, 'OrderId')
    const returnCode = callbackText(data, 'ProcReturnCode')
    const status = callbackText(data, '3DStatus')
    const rnd = callbackText(data, 'ResponseRnd')
    const authCodeValue: unknown = ownValue(data, 'AuthCode')
    const authCode =
      authCodeValue === undefined || authCodeValue === null || authCodeValue === ''
        ? ''
        : typeof authCodeValue === 'string'
          ? authCodeValue
          : null

    const algorithm = this.callbackAlgorithm(received)
    if (
      algorithm !== null &&
      received !== null &&
      orderId !== null &&
      returnCode !== null &&
      status !== null &&
      rnd !== null &&
      authCode !== null
    ) {
      const signed = [
        account.getMerchantId(),
        secretKey,
        orderId,
        authCode,
        returnCode,
        status,
        rnd,
        account.getUsername(),
      ].join(this.hashSeparator)

      if (timingSafeEqualStr(received, this.digest(algorithm, signed))) {
        this.logger.debug('hash check is successful', { order_id: this.orderIdForLog(data) })
        return true
      }
    }

    this.logger.error('hash check failed', { order_id: this.orderIdForLog(data) })
    return false
  }

  createHash(_account: PayForPosAccount, _requestData: Record<string, unknown>): string {
    throw new NotImplementedError('PayFor requests are not signed with a hash.')
  }

  /** The inherited helper appends the secret and searches nested data; both are wrong for this bank. */
  override hashFromParams(
    _account: PayForPosAccount,
    _data: Record<string, unknown>,
    _hashParamsValue: string,
    _paramSeparator = ':',
  ): string {
    throw new NotImplementedError('PayForPos callbacks are verified through check3DHash.')
  }

  private callbackAlgorithm(hash: string | null): 'sha1' | 'sha256' | null {
    if (hash === null) return null
    if (hash.length === SHA1_BASE64_LENGTH) return 'sha1'
    if (hash.length === SHA256_BASE64_LENGTH) return 'sha256'
    return null
  }

  private digest(algorithm: 'sha1' | 'sha256', text: string): string {
    return createHash(algorithm).update(text, 'utf8').digest('base64')
  }

  private orderIdForLog(data: GatewayResponseData): string | undefined {
    const orderId: unknown = ownValue(data, 'OrderId')
    return typeof orderId === 'string' ? orderId.slice(0, LOG_VALUE_LIMIT) : undefined
  }
}
