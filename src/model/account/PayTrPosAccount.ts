import { MissingAccountInfoError } from '../../errors.js'
import { AbstractPosAccount } from './AbstractPosAccount.js'

function requireNonBlank(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MissingAccountInfoError(`PayTrPosAccount.${name} is required.`)
  }
  return value
}

/**
 * PayTR account: the merchant id, the merchant salt (appended to every signed message) and the merchant key (the
 * HMAC signing key). The salt is exposed as the account password and the key as the secret key; there is no API
 * user. Blank values are rejected at construction so an empty value is never signed or sent.
 */
export class PayTrPosAccount extends AbstractPosAccount {
  constructor(bankName: string, merchantId: string, merchantSalt: string, merchantKey: string) {
    super(
      bankName,
      requireNonBlank(merchantId, 'merchantId'),
      '',
      requireNonBlank(merchantSalt, 'merchantSalt'),
      requireNonBlank(merchantKey, 'merchantKey'),
    )
  }
}
