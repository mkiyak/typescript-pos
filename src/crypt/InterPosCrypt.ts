import { NotImplementedError, PosError } from '../errors.js'
import type { InterPosAccount } from '../model/account/InterPosAccount.js'
import type { GatewayResponseData } from '../types.js'
import { ownValue } from '../util/ownValue.js'
import { timingSafeEqualStr } from '../util/timingSafeEqualStr.js'
import { AbstractCrypt } from './AbstractCrypt.js'

const LOG_VALUE_LIMIT = 64

/**
 * The only accepted callback field list (the bank sends it as `HASHPARAMS`). The signed values are concatenated
 * without separators, so a list chosen by the sender (a single field that carries the whole signed text, a
 * reordering, an extra or a missing name) would let a forged callback regroup the signed characters into other field
 * values while keeping the genuine hash. The trailing colon is part of the list.
 */
const HASH_PARAMS = 'Version:PurchAmount:Exponent:Currency:OkUrl:FailUrl:MD:OrderId:ProcReturnCode:Response:mdStatus:'

/** The values the 3D form hash covers, in signing order. Only the installment count may be empty. */
const FORM_HASH_FIELDS = [
  'ShopCode',
  'OrderId',
  'PurchAmount',
  'OkUrl',
  'FailUrl',
  'TxnType',
  'InstallmentCount',
  'Rnd',
]

function requiredText(value: unknown, what: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (value === '' && !allowEmpty)) {
    throw new PosError(`${what} is required to sign the request.`)
  }
  return value
}

/**
 * Denizbank (InterPos): SHA-1 (base64) over the 3D form values and the merchant password.
 *
 * The bank signs these callback fields: `Version`, `PurchAmount`, `Exponent`, `Currency`, `OkUrl`, `FailUrl`, `MD`,
 * `OrderId`, `ProcReturnCode`, `Response` and `mdStatus`, followed by the merchant password. Everything else in the
 * callback (the 3D status, the ECI and CAVV values, the shop code, the card and host fields, error texts and the
 * echoed `HASHPARAMSVAL`) is not covered by the signature.
 */
export class InterPosCrypt extends AbstractCrypt<InterPosAccount> {
  protected override readonly hashAlgorithm = 'sha1'

  protected override readonly hashSeparator = ''

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'InterPos'
  }

  /**
   * Hash of the 3D form: shop, order, amount, both return URLs, transaction type, installment count and random
   * value, then the merchant password. Call it after the form hooks, so the signature covers what is posted.
   */
  create3DHash(account: InterPosAccount, formInputs: Record<string, string>): string {
    const secretKey = account.getSecretKey()
    const parts = FORM_HASH_FIELDS.map((name) =>
      requiredText(ownValue(formInputs, name), name, name === 'InstallmentCount'),
    )

    return this.hashString([...parts, secretKey].join(this.hashSeparator))
  }

  /**
   * Checks the signature the bank puts on the 3D callback. The field list is fixed (the one the callback announces
   * must equal it exactly), and every signed value must be an own top-level string, absent or null (those count as
   * empty); a number, object or array makes the check fail instead of being converted to text. The generated hash,
   * the merchant password and the callback data are deliberately not logged.
   */
  check3DHash(account: InterPosAccount, data: GatewayResponseData): boolean {
    const secretKey = account.getSecretKey()
    const received: unknown = ownValue(data, 'HASH')
    const announced: unknown = ownValue(data, 'HASHPARAMS')

    if (typeof received === 'string' && received !== '' && announced === HASH_PARAMS) {
      const signed = this.signedString(data)
      if (signed !== null && timingSafeEqualStr(received, this.hashString(signed + secretKey))) {
        this.logger.debug('hash check is successful', { order_id: this.orderIdForLog(data) })
        return true
      }
    }

    this.logger.error('hash check failed', { order_id: this.orderIdForLog(data) })
    return false
  }

  createHash(_account: InterPosAccount, _requestData: Record<string, unknown>): string {
    throw new NotImplementedError('InterPos requests are not signed with a hash.')
  }

  /** The inherited helper takes the field list from the callback and searches nested data; both are wrong here. */
  override hashFromParams(
    _account: InterPosAccount,
    _data: Record<string, unknown>,
    _hashParamsValue: string,
    _paramSeparator = ':',
  ): string {
    throw new NotImplementedError('InterPos callbacks are verified through check3DHash.')
  }

  /** The concatenated callback values of the fixed field list; null when one of them is not a string. */
  private signedString(data: GatewayResponseData): string | null {
    let result = ''
    for (const name of HASH_PARAMS.split(':')) {
      // The list ends with a colon, so its last element is empty and names no field.
      if (name === '') continue
      const value: unknown = ownValue(data, name)
      if (value === undefined || value === null) continue
      if (typeof value !== 'string') return null
      result += value
    }
    return result
  }

  private orderIdForLog(data: GatewayResponseData): string | undefined {
    const orderId: unknown = ownValue(data, 'OrderId')
    return typeof orderId === 'string' ? orderId.slice(0, LOG_VALUE_LIMIT) : undefined
  }
}
