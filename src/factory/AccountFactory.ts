import { MissingAccountInfoError } from '../errors.js'
import { AssecoPosAccount } from '../model/account/AssecoPosAccount.js'
import { PayFlexPosAccount } from '../model/account/PayFlexPosAccount.js'

/** Account factories for the Asseco and PayFlex gateways. */
export const AccountFactory = {
  createAssecoPosAccount(
    bank: string,
    clientId: string,
    username: string,
    password: string,
    secretKey: string | null = null,
  ): AssecoPosAccount {
    return new AssecoPosAccount(bank, clientId, username, password, secretKey)
  },

  createPayFlexPosAccount(
    bank: string,
    merchantId: string,
    password: string,
    terminalNo: string,
    merchantType: number = PayFlexPosAccount.MERCHANT_TYPE_STANDARD,
    subMerchantId: string | null = null,
  ): PayFlexPosAccount {
    if (merchantType === PayFlexPosAccount.MERCHANT_TYPE_SUB_DEALER && subMerchantId === null) {
      throw new MissingAccountInfoError('SubMerchantId is required for sub branches!')
    }
    if (!PayFlexPosAccount.getMerchantTypes().includes(merchantType)) {
      throw new MissingAccountInfoError('Invalid MerchantType!')
    }
    return new PayFlexPosAccount(bank, merchantId, password, terminalNo, merchantType, subMerchantId)
  },
} as const
