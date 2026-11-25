import { MissingAccountInfoError } from '../errors.js'
import { AkbankPosAccount } from '../model/account/AkbankPosAccount.js'
import { AssecoPosAccount } from '../model/account/AssecoPosAccount.js'
import { BoaPosAccount } from '../model/account/BoaPosAccount.js'
import { GarantiPosAccount } from '../model/account/GarantiPosAccount.js'
import { InterPosAccount } from '../model/account/InterPosAccount.js'
import { ParamPosAccount } from '../model/account/ParamPosAccount.js'
import { PayFlexPosAccount } from '../model/account/PayFlexPosAccount.js'
import { PayForPosAccount } from '../model/account/PayForPosAccount.js'
import { PayTrPosAccount } from '../model/account/PayTrPosAccount.js'
import { PosNetPosAccount } from '../model/account/PosNetPosAccount.js'
import { ToslaPosAccount } from '../model/account/ToslaPosAccount.js'

/** Account factories for the Asseco, PayFlex, Garanti, Akbank, POSNET, PayFor, InterPos, BOA (Kuveyt, Vakif Katilim), Tosla, Param and PayTR gateways. */
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

  createPayForPosAccount(
    bank: string,
    merchantId: string,
    userCode: string,
    userPassword: string,
    merchantPass: string | null = null,
    mbrId: string = PayForPosAccount.MBR_ID_FINANSBANK,
  ): PayForPosAccount {
    return new PayForPosAccount(bank, merchantId, userCode, userPassword, merchantPass, mbrId)
  },

  createInterPosAccount(
    bank: string,
    shopCode: string,
    userCode: string,
    userPass: string,
    merchantPass: string | null = null,
  ): InterPosAccount {
    return new InterPosAccount(bank, shopCode, userCode, userPass, merchantPass)
  },

  createBoaPosAccount(
    bank: string,
    merchantId: string,
    username: string,
    customerId: string,
    secretKey: string,
    subMerchantId: string | null = null,
  ): BoaPosAccount {
    return new BoaPosAccount(bank, merchantId, username, customerId, secretKey, subMerchantId)
  },

  createToslaPosAccount(bank: string, clientId: string, apiUser: string, apiPass: string): ToslaPosAccount {
    return new ToslaPosAccount(bank, clientId, apiUser, apiPass)
  },

  createPayTrPosAccount(bank: string, merchantId: string, merchantSalt: string, merchantKey: string): PayTrPosAccount {
    return new PayTrPosAccount(bank, merchantId, merchantSalt, merchantKey)
  },

  /** `terminalId` (`Terminal_ID`) is needed by the hosted payment page only. */
  createParamPosAccount(
    bank: string,
    clientCode: string,
    username: string,
    password: string,
    guid: string,
    terminalId: string | null = null,
  ): ParamPosAccount {
    return new ParamPosAccount(bank, clientCode, username, password, guid, terminalId)
  },
} as const
