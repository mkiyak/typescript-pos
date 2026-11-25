import { MissingAccountInfoError } from '../../errors.js'
import { AbstractPosAccount } from './AbstractPosAccount.js'

function requireNonBlank(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MissingAccountInfoError(`ToslaPosAccount.${name} is required.`)
  }
  return value
}

/**
 * Tosla account: the merchant (client) id, the API user and the API password. The password is the secret key every
 * request and callback hash is built from; the account has no separate password. Blank values are rejected at
 * construction so an empty value is never signed or sent.
 */
export class ToslaPosAccount extends AbstractPosAccount {
  constructor(bankName: string, clientId: string, apiUser: string, apiPass: string) {
    super(
      bankName,
      requireNonBlank(clientId, 'clientId'),
      requireNonBlank(apiUser, 'apiUser'),
      '',
      requireNonBlank(apiPass, 'apiPass'),
    )
  }
}
