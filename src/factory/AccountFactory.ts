import { MissingAccountInfoError } from '../errors.js'
import { AkbankPosAccount } from '../model/account/AkbankPosAccount.js'
import { AssecoPosAccount } from '../model/account/AssecoPosAccount.js'
import { GarantiPosAccount } from '../model/account/GarantiPosAccount.js'
import { PayFlexPosAccount } from '../model/account/PayFlexPosAccount.js'
import { PosNetPosAccount } from '../model/account/PosNetPosAccount.js'

/** Account factories for the Asseco, PayFlex, Garanti, Akbank and POSNET gateways. */
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

  createGarantiPosAccount(
    bank: string,
    merchantId: string,
    username: string,
    password: string,
    terminalId: string,
    secretKey: string | null = null,
    refundUsername: string | null = null,
    refundPassword: string | null = null,
  ): GarantiPosAccount {
    return new GarantiPosAccount(
      bank,
      merchantId,
      username,
      password,
      terminalId,
      secretKey,
      refundUsername,
      refundPassword,
    )
  },

  createAkbankPosAccount(
    bank: string,
    merchantSafeId: string,
    terminalSafeId: string,
    secretKey: string,
    subMerchantId: string | null = null,
  ): AkbankPosAccount {
    return new AkbankPosAccount(bank, merchantSafeId, terminalSafeId, secretKey, subMerchantId)
  },

  createPosNetPosAccount(
    bank: string,
    merchantId: string,
    terminalId: string,
    posNetId: string,
    secretKey: string | null = null,
  ): PosNetPosAccount {
    return new PosNetPosAccount(bank, merchantId, posNetId, terminalId, secretKey)
  },
} as const
