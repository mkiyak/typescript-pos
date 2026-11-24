import { MissingAccountInfoError } from '../../errors.js'
import { AbstractPosAccount } from './AbstractPosAccount.js'

function requireNonBlank(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MissingAccountInfoError(`PayForPosAccount.${name} is required.`)
  }
  return value
}

/**
 * PayFor account (QNB Finansbank, Ziraat Katilim): merchant number, authorization user code and password, the
 * institution code (`mbrId`) and, when 3D payments are used, the 3D secure merchant password (the secret key).
 * Blank values are rejected at construction so an empty value is never signed or sent; a blank merchant password
 * counts as missing. The institution code is one to four digits.
 */
export class PayForPosAccount extends AbstractPosAccount {
  static readonly MBR_ID_FINANSBANK = '5'
  static readonly MBR_ID_ZIRAAT_KATILIM = '12'

  readonly #mbrId: string

  constructor(
    bankName: string,
    merchantId: string,
    userCode: string,
    userPassword: string,
    merchantPass: string | null = null,
    mbrId: string = PayForPosAccount.MBR_ID_FINANSBANK,
  ) {
    super(
      bankName,
      requireNonBlank(merchantId, 'merchantId'),
      requireNonBlank(userCode, 'userCode'),
      requireNonBlank(userPassword, 'userPassword'),
      merchantPass === null ? null : requireNonBlank(merchantPass, 'merchantPass'),
    )
    if (typeof mbrId !== 'string' || !/^[0-9]{1,4}$/.test(mbrId)) {
      throw new MissingAccountInfoError('PayForPosAccount.mbrId must be an institution code of one to four digits.')
    }
    this.#mbrId = mbrId
  }

  /** Institution code the bank assigns to the merchant's institution. */
  getMbrId(): string {
    return this.#mbrId
  }
}
