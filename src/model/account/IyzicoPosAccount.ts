import { MissingAccountInfoError } from '../../errors.js'
import { AbstractPosAccount } from './AbstractPosAccount.js'

function requireNonBlank(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MissingAccountInfoError(`IyzicoPosAccount.${name} is required.`)
  }
  return value
}

/**
 * iyzico account: the API key (kept as the merchant id) and the secret key that signs every request. There is no API
 * user or password. The optional sub merchant key is exposed as the sub merchant id; a blank one means none. Blank
 * credentials are rejected at construction so an empty value is never signed or sent.
 */
export class IyzicoPosAccount extends AbstractPosAccount {
  constructor(bankName: string, apiKey: string, secretKey: string, subMerchantKey: string | null = null) {
    super(
      bankName,
      requireNonBlank(apiKey, 'apiKey'),
      '',
      '',
      requireNonBlank(secretKey, 'secretKey'),
      null,
      typeof subMerchantKey === 'string' && subMerchantKey.trim() !== '' ? subMerchantKey : null,
    )
  }

  getApiKey(): string {
    return this.getMerchantId()
  }
}
