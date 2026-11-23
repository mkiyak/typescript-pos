import { AbstractPosAccount } from './AbstractPosAccount.js'

export class PayFlexPosAccount extends AbstractPosAccount {
  static readonly MERCHANT_TYPE_STANDARD = 0
  static readonly MERCHANT_TYPE_MAIN_DEALER = 1
  static readonly MERCHANT_TYPE_SUB_DEALER = 2

  private static readonly merchantTypes: readonly number[] = [
    PayFlexPosAccount.MERCHANT_TYPE_STANDARD,
    PayFlexPosAccount.MERCHANT_TYPE_MAIN_DEALER,
    PayFlexPosAccount.MERCHANT_TYPE_SUB_DEALER,
  ]

  private readonly merchantType: number

  constructor(
    bankName: string,
    merchantId: string,
    password: string,
    terminalId: string,
    merchantType: number = PayFlexPosAccount.MERCHANT_TYPE_STANDARD,
    subMerchantId: string | null = null,
  ) {
    super(bankName, merchantId, '', password, null, terminalId, subMerchantId)
    this.merchantType = merchantType
  }

  getMerchantType(): number {
    return this.merchantType
  }

  isSubBranch(): boolean {
    return this.merchantType === PayFlexPosAccount.MERCHANT_TYPE_SUB_DEALER
  }

  static getMerchantTypes(): number[] {
    return [...PayFlexPosAccount.merchantTypes]
  }
}
