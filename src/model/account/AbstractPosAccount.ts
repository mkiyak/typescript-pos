export abstract class AbstractPosAccount {
  constructor(
    protected readonly bankName: string,
    protected readonly merchantId: string,
    protected readonly username: string,
    protected readonly password: string,
    protected readonly secretKey: string | null = null,
    protected readonly terminalId: string | null = null,
    protected readonly subMerchantId: string | null = null,
  ) {}

  getMerchantId(): string {
    return this.merchantId
  }

  getUsername(): string {
    return this.username
  }

  getPassword(): string {
    return this.password
  }

  getSecretKey(): string {
    if (this.secretKey === null) {
      throw new Error(`${this.constructor.name}.secretKey is not set.`)
    }
    return this.secretKey
  }

  getBankName(): string {
    return this.bankName
  }

  getSubMerchantId(): string | null {
    return this.subMerchantId
  }

  getTerminalId(): string {
    if (this.terminalId === null) {
      throw new Error(`${this.constructor.name}.terminalId is not set.`)
    }
    return this.terminalId
  }
}
