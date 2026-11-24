import { AbstractPosAccount } from './AbstractPosAccount.js'

/** Garanti account: terminal id, optional store key and separate refund credentials (kept in #private fields). */
export class GarantiPosAccount extends AbstractPosAccount {
  readonly #refundUsername: string | null
  readonly #refundPassword: string | null

  constructor(
    bankName: string,
    merchantId: string,
    username: string,
    password: string,
    terminalId: string,
    secretKey: string | null = null,
    refundUsername: string | null = null,
    refundPassword: string | null = null,
  ) {
    super(bankName, merchantId, username, password, secretKey, terminalId)
    this.#refundUsername = refundUsername
    this.#refundPassword = refundPassword
  }

  getRefundUsername(): string | null {
    return this.#refundUsername
  }

  getRefundPassword(): string | null {
    return this.#refundPassword
  }
}
