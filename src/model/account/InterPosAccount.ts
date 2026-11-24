import { MissingAccountInfoError } from '../../errors.js'
import { AbstractPosAccount } from './AbstractPosAccount.js'

function requireNonBlank(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MissingAccountInfoError(`InterPosAccount.${name} is required.`)
  }
  return value
}

/**
 * InterPos (Denizbank) account: shop code, API user code and password and, when 3D payments are used, the 3D secure
 * merchant password (the secret key). Blank values are rejected at construction so an empty value is never signed
 * or sent; a blank merchant password counts as missing, an omitted one only disables 3D.
 */
export class InterPosAccount extends AbstractPosAccount {
  constructor(
    bankName: string,
    shopCode: string,
    userCode: string,
    userPass: string,
    merchantPass: string | null = null,
  ) {
    super(
      bankName,
      requireNonBlank(shopCode, 'shopCode'),
      requireNonBlank(userCode, 'userCode'),
      requireNonBlank(userPass, 'userPass'),
      merchantPass === null ? null : requireNonBlank(merchantPass, 'merchantPass'),
    )
  }
}
