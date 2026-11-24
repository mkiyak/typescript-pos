import { PosError } from '../errors.js'
import type { PosNetPosAccount } from '../model/account/PosNetPosAccount.js'
import type { GatewayResponseData } from '../types.js'
import { ownValue } from '../util/ownValue.js'
import { timingSafeEqualStr } from '../util/timingSafeEqualStr.js'
import { AbstractCrypt } from './AbstractCrypt.js'

/**
 * The only field list the bank signs a 3D callback with. The values are joined without a separator, so the list is
 * fixed here instead of being read from the callback.
 */
export const CALLBACK_MAC_PARAMS = 'ECI:CAVV:MdStatus:MdErrorMessage:MD:SecureTransactionId'

const LOG_VALUE_LIMIT = 64

/** A value that goes into a signed string: an own string, with `null` and absent meaning "empty"; `false` otherwise. */
function callbackText(data: GatewayResponseData, name: string): string | false {
  const value: unknown = ownValue(data, name)
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : false
}

function requiredText(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new PosError(`${what} is required to sign the request.`)
  }
  return value
}

/** A part of the 3D data: text or a number, `null` meaning empty. Nested values are never signed as "Array". */
function signedPart(value: unknown, what: string): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  throw new PosError(`${what} must be text or a number to sign the request.`)
}

/**
 * POSNET JSON API: SHA-256 (base64) over the concatenated values and the key, without separators. Request MACs
 * use the field list the request names itself; the 3D callback is verified only against the fixed list.
 */
export class PosNetV1PosCrypt extends AbstractCrypt<PosNetPosAccount> {
  protected override readonly hashAlgorithm = 'sha256'

  protected override readonly hashSeparator = ''

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PosNetV1Pos'
  }

  /**
   * MAC of the 3D form: merchant, terminal, card number, cvv, expiry (all three or none, the bank page collects
   * them otherwise), amount and the key. Call it after the form hooks, so the signature covers what is posted.
   */
  create3DHash(account: PosNetPosAccount, formInputs: Record<string, string>): string {
    const secretKey = account.getSecretKey()
    const merchantNo = requiredText(ownValue(formInputs, 'MerchantNo'), 'MerchantNo')
    const terminalNo = requiredText(ownValue(formInputs, 'TerminalNo'), 'TerminalNo')
    const amount = requiredText(ownValue(formInputs, 'Amount'), 'Amount')

    const card: unknown[] = [
      ownValue(formInputs, 'CardNo'),
      ownValue(formInputs, 'Cvv'),
      ownValue(formInputs, 'ExpiredDate'),
    ]
    const present = card.filter((value) => value !== undefined && value !== null)
    if (present.length !== 0 && present.length !== card.length) {
      throw new PosError('CardNo, Cvv and ExpiredDate must all be given or all be left out.')
    }
    const cardText =
      present.length === 0
        ? []
        : [requiredText(card[0], 'CardNo'), requiredText(card[1], 'Cvv'), requiredText(card[2], 'ExpiredDate')]

    return this.hashString([merchantNo, terminalNo, ...cardText, amount, secretKey].join(this.hashSeparator))
  }

  /**
   * Checks the signature the bank puts on the 3D callback. It fails closed: the callback must name exactly the
   * fixed list, and every signed value must be an own top-level string (`null`/absent counts as empty, as the bank
   * posts `CAVV null` on failures). The generated MAC is deliberately not logged.
   */
  check3DHash(account: PosNetPosAccount, data: GatewayResponseData): boolean {
    const secretKey = account.getSecretKey()
    const mac: unknown = ownValue(data, 'Mac')
    const macParams: unknown = ownValue(data, 'MacParams')

    if (typeof mac === 'string' && mac !== '' && macParams === CALLBACK_MAC_PARAMS) {
      const values = CALLBACK_MAC_PARAMS.split(':').map((name) => callbackText(data, name))
      if (values.every((value): value is string => value !== false)) {
        const expected = this.hashString(`${values.join(this.hashSeparator)}${secretKey}`)
        if (timingSafeEqualStr(mac, expected)) {
          this.logger.debug('hash check is successful', { order_id: this.orderIdForLog(data) })
          return true
        }
      }
    }

    this.logger.error('hash check failed', { order_id: this.orderIdForLog(data) })
    return false
  }

  /**
   * MAC of the provision request: merchant, terminal, then the 3D session values the bank returned, then the key.
   */
  createHash(account: PosNetPosAccount, requestData: Record<string, unknown>): string {
    const secretKey = account.getSecretKey()
    const threeD: unknown = ownValue(requestData, 'ThreeDSecureData')
    if (threeD === null || typeof threeD !== 'object' || Array.isArray(threeD)) {
      throw new PosError('The 3D secure data is required to sign the request.')
    }
    const session = threeD as Record<string, unknown>
    const parts = [
      requiredText(ownValue(requestData, 'MerchantNo'), 'MerchantNo'),
      requiredText(ownValue(requestData, 'TerminalNo'), 'TerminalNo'),
      ...['SecureTransactionId', 'CavvData', 'Eci', 'MdStatus'].map((name) =>
        signedPart(ownValue(session, name), name),
      ),
    ]

    return this.hashString([...parts, secretKey].join(this.hashSeparator))
  }

  private orderIdForLog(data: GatewayResponseData): string | undefined {
    const orderId: unknown = ownValue(data, 'OrderId')
    return typeof orderId === 'string' ? orderId.slice(0, LOG_VALUE_LIMIT) : undefined
  }
}
