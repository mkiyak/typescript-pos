import { NotImplementedError, PosError } from '../errors.js'
import type { PosNetPosAccount } from '../model/account/PosNetPosAccount.js'
import type { GatewayResponseData } from '../types.js'
import { ownValue } from '../util/ownValue.js'
import { timingSafeEqualStr } from '../util/timingSafeEqualStr.js'
import { AbstractCrypt } from './AbstractCrypt.js'

/** The order values exactly as they are put on the wire: padded id, amount in kuruş, bank currency code. */
export type PosNetMappedOrder = { id: string; amount: number; currency: string }

const LOG_VALUE_LIMIT = 64

/** A signed field: an own, non-empty string that cannot move a field boundary. */
function signedField(data: GatewayResponseData, name: string): string | null {
  const value: unknown = ownValue(data, name)
  return typeof value === 'string' && value !== '' && !value.includes(';') ? value : null
}

function requiredText(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new PosError(`${what} is required to sign the request.`)
  }
  return value
}

/**
 * POSNET: SHA-256 (base64) over `;`-separated values. Every MAC ends with the "first hash", the digest of the
 * encryption key and the terminal number, so the key itself never appears in a signed string.
 */
export class PosNetPosCrypt extends AbstractCrypt<PosNetPosAccount> {
  protected override readonly hashAlgorithm = 'sha256'

  protected override readonly hashSeparator = ';'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PosNetPos'
  }

  create3DHash(_account: PosNetPosAccount, _formInputs: Record<string, string>): string {
    throw new NotImplementedError('PosNetPos does not sign a 3D form.')
  }

  /**
   * MAC of a request: mapped order id, amount in kuruş, currency, merchant number and the first hash of the terminal.
   * A missing or blank part is an error, never the text "undefined".
   */
  override createHash(
    account: PosNetPosAccount,
    requestData: Record<string, unknown>,
    mappedOrder?: PosNetMappedOrder,
  ): string {
    const secretKey = account.getSecretKey()
    if (mappedOrder === undefined || mappedOrder === null) {
      throw new PosError('The mapped order is required to sign the request.')
    }
    const id = requiredText(mappedOrder.id, 'Order id')
    const currency = requiredText(mappedOrder.currency, 'Currency')
    if (!Number.isSafeInteger(mappedOrder.amount) || mappedOrder.amount < 0) {
      throw new PosError('The amount must be a whole number of kuruş to sign the request.')
    }
    const merchantId = requiredText(ownValue(requestData, 'mid'), 'Merchant number (mid)')
    const terminalId = requiredText(ownValue(requestData, 'tid'), 'Terminal number (tid)')

    return this.hashString(
      [id, mappedOrder.amount, currency, merchantId, this.securityData(secretKey, terminalId)].join(this.hashSeparator),
    )
  }

  /**
   * Checks the MAC the bank returns when it resolves the 3D data: it covers the 3D status first, then the order id,
   * amount and currency, the merchant number and the first hash. Anything that is not an own, non-empty string
   * without the separator fails the check instead of being signed. The generated MAC is deliberately not logged.
   */
  check3DHash(account: PosNetPosAccount, data: GatewayResponseData): boolean {
    const secretKey = account.getSecretKey()
    const mdStatus = signedField(data, 'mdStatus')
    const xid = signedField(data, 'xid')
    const amount = signedField(data, 'amount')
    const currency = signedField(data, 'currency')
    const mac = signedField(data, 'mac')

    if (mdStatus !== null && xid !== null && amount !== null && currency !== null && mac !== null) {
      const signed = [
        mdStatus,
        xid,
        amount,
        currency,
        account.getMerchantId(),
        this.securityData(secretKey, account.getTerminalId()),
      ].join(this.hashSeparator)

      if (timingSafeEqualStr(mac, this.hashString(signed))) {
        this.logger.debug('hash check is successful', { order_id: xid.slice(0, LOG_VALUE_LIMIT) })
        return true
      }
    }

    const orderId: unknown = ownValue(data, 'xid')
    this.logger.error('hash check failed', {
      order_id: typeof orderId === 'string' ? orderId.slice(0, LOG_VALUE_LIMIT) : undefined,
    })
    return false
  }

  /** The generic helper appends the key and searches nested data; neither applies here. */
  override hashFromParams(
    _account: PosNetPosAccount,
    _data: Record<string, unknown>,
    _hashParamsValue: string,
    _paramSeparator = ':',
  ): string {
    throw new NotImplementedError('PosNetPos callbacks are verified through check3DHash.')
  }

  private securityData(secretKey: string, terminalId: string): string {
    return this.hashString(`${secretKey}${this.hashSeparator}${terminalId}`)
  }
}
