import { MissingAccountInfoError } from '../../errors.js'
import { AbstractPosAccount } from './AbstractPosAccount.js'

function requireNonBlank(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MissingAccountInfoError(`BoaPosAccount.${name} is required.`)
  }
  return value
}

/**
 * Account of the two banks that share the BOA virtual POS (Kuveyt Turk, Vakif Katilim): store number, the API
 * user created in the POS panel and its password (the secret key), and the customer number. Blank values are
 * rejected at construction so an empty value is never signed or sent; a sub merchant id is optional but, when
 * given, not blank.
 */
export class BoaPosAccount extends AbstractPosAccount {
  constructor(
    bankName: string,
    merchantId: string,
    username: string,
    customerId: string,
    secretKey: string,
    subMerchantId: string | null = null,
  ) {
    super(
      bankName,
      requireNonBlank(merchantId, 'merchantId'),
      requireNonBlank(username, 'username'),
      '',
      requireNonBlank(secretKey, 'secretKey'),
      requireNonBlank(customerId, 'customerId'),
      subMerchantId === null ? null : requireNonBlank(subMerchantId, 'subMerchantId'),
    )
  }

  /** Customer number (the bank calls it `CustomerId`). */
  getCustomerId(): string {
    return this.getTerminalId()
  }
}
