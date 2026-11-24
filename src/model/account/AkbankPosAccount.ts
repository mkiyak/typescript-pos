import { MissingAccountInfoError } from '../../errors.js'
import { AbstractPosAccount } from './AbstractPosAccount.js'

function requireNonBlank(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MissingAccountInfoError(`AkbankPosAccount.${name} is required.`)
  }
  return value
}

/**
 * Akbank (new API) account: merchant and terminal safe ids plus the secret key that signs every request. Blank
 * credentials are rejected at construction so an empty value is never signed or sent; a blank sub merchant id means
 * no sub merchant.
 */
export class AkbankPosAccount extends AbstractPosAccount {
  constructor(
    bankName: string,
    merchantSafeId: string,
    terminalSafeId: string,
    secretKey: string,
    subMerchantId: string | null = null,
  ) {
    super(
      bankName,
      requireNonBlank(merchantSafeId, 'merchantSafeId'),
      '',
      '',
      requireNonBlank(secretKey, 'secretKey'),
      requireNonBlank(terminalSafeId, 'terminalSafeId'),
      typeof subMerchantId === 'string' && subMerchantId.trim() !== '' ? subMerchantId : null,
    )
  }
}
