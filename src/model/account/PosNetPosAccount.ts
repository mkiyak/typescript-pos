import { MissingAccountInfoError } from '../../errors.js'
import { AbstractPosAccount } from './AbstractPosAccount.js'

function requireNonBlank(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MissingAccountInfoError(`PosNetPosAccount.${name} is required.`)
  }
  return value
}

/**
 * POSNET account (Yapı Kredi, Albaraka): merchant number, terminal number and POSNET id, plus the secret key (the
 * 3D secure encryption key) when 3D payments are used. Blank values are rejected at construction so an empty value
 * is never signed or sent; a blank secret key counts as missing.
 */
export class PosNetPosAccount extends AbstractPosAccount {
  constructor(
    bankName: string,
    merchantId: string,
    posNetId: string,
    terminalId: string,
    secretKey: string | null = null,
    subMerchantId: string | null = null,
  ) {
    super(
      bankName,
      requireNonBlank(merchantId, 'merchantId'),
      requireNonBlank(posNetId, 'posNetId'),
      '',
      secretKey === null ? null : requireNonBlank(secretKey, 'secretKey'),
      requireNonBlank(terminalId, 'terminalId'),
      typeof subMerchantId === 'string' && subMerchantId.trim() !== '' ? subMerchantId : null,
    )
  }

  /** The POSNET id the bank assigns to the merchant (kept in the username slot). */
  getPosNetId(): string {
    return this.getUsername()
  }
}
