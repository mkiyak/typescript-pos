import { createHash } from 'node:crypto'
import iconv from 'iconv-lite'
import type { PayFlexPosAccount } from '../model/account/PayFlexPosAccount.js'
import type { GatewayResponseData } from '../types.js'
import { timingSafeEqualStr } from '../util/timingSafeEqualStr.js'
import { NullCrypt } from './NullCrypt.js'

/**
 * PayFlex V4 (VakifBank / Ziraat PayFlex). Verifies the callback `Hash`
 * that the bank sends with the 3D result (VakifBank 2026 Standard API, section 15).
 */
export class PayFlexV4PosCrypt extends NullCrypt<PayFlexPosAccount> {
  static override supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayFlexV4Pos'
  }

  /**
   * Bank versions that do not send a `Hash` are accepted as is. When a `Hash` key is present it must match:
   * base64(sha256(iso-8859-9(VerifyEnrollmentRequestId + MerchantId + PurchCurrency + PurchAmount(without '.')
   * + Eci(2 chars) + Cavv + MdStatus + Status + password))). The password and the generated hash are never logged.
   */
  override check3DHash(account: PayFlexPosAccount, data: GatewayResponseData): boolean {
    const hashKey = Object.keys(data).find((key) => key.toLowerCase() === 'hash')
    if (hashKey === undefined) {
      return true
    }

    const field = (name: string): string => {
      const value = (data as Record<string, unknown>)[name]
      return typeof value === 'string' ? value : ''
    }

    const hashString =
      field('VerifyEnrollmentRequestId') +
      field('MerchantId') +
      field('PurchCurrency') +
      field('PurchAmount').replaceAll('.', '') +
      field('Eci').padStart(2, '0') +
      field('Cavv') +
      field('MdStatus') +
      field('Status') +
      account.getPassword()

    const expected = this.hashBytes(iconv.encode(hashString, 'ISO-8859-9'))

    if (timingSafeEqualStr(data[hashKey], expected)) {
      this.logger.debug('hash check is successful')
      return true
    }

    this.logger.error('hash check failed', { data })
    return false
  }

  private hashBytes(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('base64')
  }
}
