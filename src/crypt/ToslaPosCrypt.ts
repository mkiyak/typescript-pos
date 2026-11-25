import { NotImplementedError, PosError } from '../errors.js'
import type { ToslaPosAccount } from '../model/account/ToslaPosAccount.js'
import type { GatewayResponseData } from '../types.js'
import { ownValue } from '../util/ownValue.js'
import { timingSafeEqualStr } from '../util/timingSafeEqualStr.js'
import { AbstractCrypt } from './AbstractCrypt.js'

const LOG_VALUE_LIMIT = 64

/**
 * The only accepted callback field list (the bank sends it as `HashParameters`). The signed values are concatenated
 * without separators, so a list chosen by the sender (a renamed or reordered list, an extra or a missing name) would
 * let a forged callback regroup the signed characters into other field values while keeping the genuine hash.
 */
export const TOSLA_CALLBACK_HASH_PARAMETERS =
  'ClientId,ApiUser,OrderId,MdStatus,BankResponseCode,BankResponseMessage,RequestStatus'

/** The signed callback values the callback itself supplies, in signing order (client id and api user come from the account). */
const CALLBACK_FIELDS = ['OrderId', 'MdStatus', 'BankResponseCode', 'BankResponseMessage', 'RequestStatus'] as const

/** A base64 SHA-512 digest: 64 bytes, 86 characters and two padding characters. */
const HASH_PATTERN = /^[A-Za-z0-9+/]{86}==$/

/** A request value that can be signed: a non-empty string or a finite number. */
function signable(data: Record<string, unknown>, name: string): string {
  const value: unknown = ownValue(data, name)
  if ((typeof value === 'string' && value !== '') || (typeof value === 'number' && Number.isFinite(value))) {
    return String(value)
  }
  throw new PosError(`Tosla request field "${name}" is missing`)
}

/**
 * Tosla: base64 SHA-512 over the API password followed by the signed values, without separators.
 *
 * The request hash covers the client id, the API user, a random value and a time span, and nothing of the request
 * body (no order id, amount, card or refund amount): it is a bearer credential for whatever body travels with it,
 * valid for as long as the bank accepts the time span. It is therefore never logged.
 *
 * The bank signs these callback fields: the order id, the 3D status, the bank response code and message and the
 * request status, together with the account's client id, API user and password. Everything else in the callback
 * (the callback's own client id, the 3D session id) is not covered, and the callback carries no amount, currency or
 * installment at all: the signature proves only that the bank reports this
 * outcome for this order id.
 */
export class ToslaPosCrypt extends AbstractCrypt<ToslaPosAccount> {
  protected override readonly hashAlgorithm = 'sha512'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'ToslaPos'
  }

  create3DHash(_account: ToslaPosAccount, _formInputs: Record<string, string>): string {
    throw new NotImplementedError('Tosla 3D forms are built by the bank; there is no form hash.')
  }

  /**
   * Checks the signature the bank puts on the 3D callback. The field list is fixed (the one the callback announces
   * must equal it exactly), the hash must be an own 88-character base64 string, and every signed value must be an
   * own top-level string, absent or null (those count as empty); a number, object or array makes the check fail
   * instead of being converted to text. The generated hash, the API password and the callback data are
   * deliberately not logged.
   */
  check3DHash(account: ToslaPosAccount, data: GatewayResponseData): boolean {
    const record: unknown = data
    if (record !== null && typeof record === 'object' && !Array.isArray(record)) {
      const received: unknown = ownValue(data, 'Hash')
      const announced: unknown = ownValue(data, 'HashParameters')
      if (typeof received === 'string' && HASH_PATTERN.test(received) && announced === TOSLA_CALLBACK_HASH_PARAMETERS) {
        const signed = this.signedString(account, data)
        if (signed !== null && timingSafeEqualStr(received, this.hashString(signed))) {
          this.logger.debug('hash check is successful', { order_id: this.orderIdForLog(data) })
          return true
        }
      }
    }

    this.logger.error('hash check failed', { order_id: this.orderIdForLog(data) })
    return false
  }

  /** Request hash: API password, client id, API user, random value, time span. */
  createHash(account: ToslaPosAccount, requestData: Record<string, unknown>): string {
    const parts = ['clientId', 'apiUser', 'rnd', 'timeSpan'].map((name) => signable(requestData, name))
    return this.hashString([account.getSecretKey(), ...parts].join(this.hashSeparator))
  }

  protected override concatenateHashKey(hashKey: string, hashString: string): string {
    return hashKey + hashString
  }

  /** The API password, the account part and the callback values; null when a value is not a string. */
  private signedString(account: ToslaPosAccount, data: GatewayResponseData): string | null {
    let result = account.getSecretKey() + account.getMerchantId() + account.getUsername()
    for (const name of CALLBACK_FIELDS) {
      const value: unknown = ownValue(data, name)
      if (value === undefined || value === null) continue
      if (typeof value !== 'string') return null
      result += value
    }
    return result
  }

  private orderIdForLog(data: unknown): string | undefined {
    if (data === null || typeof data !== 'object') return undefined
    const orderId: unknown = ownValue(data as GatewayResponseData, 'OrderId')
    return typeof orderId === 'string' ? orderId.slice(0, LOG_VALUE_LIMIT) : undefined
  }
}
