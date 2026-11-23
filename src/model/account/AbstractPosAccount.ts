import { MissingAccountInfoError } from '../../errors.js'

const INSPECT = Symbol.for('nodejs.util.inspect.custom')

/** Credentials live in #private fields and never serialize. */
export abstract class AbstractPosAccount {
  readonly #bankName: string
  readonly #merchantId: string
  readonly #username: string
  readonly #password: string
  readonly #secretKey: string | null
  readonly #terminalId: string | null
  readonly #subMerchantId: string | null

  constructor(
    bankName: string,
    merchantId: string,
    username: string,
    password: string,
    secretKey: string | null = null,
    terminalId: string | null = null,
    subMerchantId: string | null = null,
  ) {
    this.#bankName = bankName
    this.#merchantId = merchantId
    this.#username = username
    this.#password = password
    this.#secretKey = secretKey
    this.#terminalId = terminalId
    this.#subMerchantId = subMerchantId
  }

  getMerchantId(): string {
    return this.#merchantId
  }

  getUsername(): string {
    return this.#username
  }

  getPassword(): string {
    return this.#password
  }

  getSecretKey(): string {
    if (this.#secretKey === null) {
      throw new MissingAccountInfoError(`${this.constructor.name}.secretKey is not set.`)
    }
    return this.#secretKey
  }

  getBankName(): string {
    return this.#bankName
  }

  getSubMerchantId(): string | null {
    return this.#subMerchantId
  }

  getTerminalId(): string {
    if (this.#terminalId === null) {
      throw new MissingAccountInfoError(`${this.constructor.name}.terminalId is not set.`)
    }
    return this.#terminalId
  }

  /** Non-secret identifiers only. */
  toJSON(): { bankName: string; merchantId: string } {
    return { bankName: this.#bankName, merchantId: this.#merchantId }
  }

  [INSPECT](): string {
    return `${this.constructor.name} ${JSON.stringify(this.toJSON())}`
  }
}
