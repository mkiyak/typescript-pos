import { MissingAccountInfoError, PosError } from '../../../errors.js'
import type { GarantiPosAccount } from '../../../model/account/GarantiPosAccount.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { CURRENCY, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosOrder, ThreeDFormData } from '../../../types.js'
import { orderIdOf } from '../../../util/orderId.js'
import { isSet, required, requiredString } from '../../../util/required.js'
import { AbstractRequestDataMapper } from './AbstractRequestDataMapper.js'

const GATEWAY_CLASS = 'GarantiPos'

const API_VERSION = '512'

/** Marks an e-commerce (not mail order) transaction. */
const MOTO = 'N'

type TerminalData = {
  ProvUserID: string
  UserID: string
  HashData: string
  ID: string
  MerchantID: string
}

/** Creates request data for Garanti (GVP) gateway requests. */
export class GarantiPosRequestDataMapper extends AbstractRequestDataMapper<GarantiPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === GATEWAY_CLASS
  }

  create3DPaymentRequestData(
    account: GarantiPosAccount,
    order: PosOrder,
    txType: TxType,
    responseData: Record<string, unknown>,
  ): Record<string, unknown> {
    const callback = 'Callback'
    const result: Record<string, unknown> = {
      Mode: this.getMode(),
      Version: API_VERSION,
      Terminal: this.getTerminalData(account),
      Customer: {
        IPAddress: requiredString(responseData, 'customeripaddress', callback),
      },
      Order: {
        OrderID: requiredString(responseData, 'orderid', callback),
      },
      Transaction: {
        Type: requiredString(responseData, 'txntype', callback),
        InstallmentCnt: this.valueFormatter.formatInstallment(order.installment ?? 0),
        Amount: requiredString(responseData, 'txnamount', callback),
        CurrencyCode: requiredString(responseData, 'txncurrencycode', callback),
        CardholderPresentCode: '13', // 13 for 3D secure payment
        MotoInd: MOTO,
        Secure3D: {
          AuthenticationCode: responseData.cavv ?? '',
          SecurityLevel: responseData.eci ?? '',
          TxnID: responseData.xid ?? '',
          Md: responseData.md ?? '',
        },
      },
    }

    if (isSet(order.recurring)) {
      result.Recurring = this.createRecurringData(order.recurring as Record<string, unknown>, txType)
    }

    return this.sign(account, result)
  }

  createNonSecurePaymentRequestData(
    account: GarantiPosAccount,
    order: PosOrder,
    txType: TxType,
    creditCard: CreditCard,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {
      Mode: this.getMode(),
      Version: API_VERSION,
      Terminal: this.getTerminalData(account),
      Customer: {
        IPAddress: required(order, 'ip'),
      },
      Card: this.getCardData(creditCard),
      Order: {
        OrderID: orderIdOf(order),
      },
      Transaction: {
        Type: this.valueMapper.mapTxType(txType),
        InstallmentCnt: this.valueFormatter.formatInstallment(order.installment ?? 0),
        Amount: this.valueFormatter.formatAmount(required(order, 'amount')),
        CurrencyCode: this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY),
        CardholderPresentCode: '0',
        MotoInd: MOTO,
      },
    }

    if (isSet(order.recurring)) {
      result.Recurring = this.createRecurringData(order.recurring as Record<string, unknown>, txType)
    }

    return this.sign(account, result)
  }

  createNonSecurePostAuthPaymentRequestData(account: GarantiPosAccount, order: PosOrder): Record<string, unknown> {
    const result: Record<string, unknown> = {
      Mode: this.getMode(),
      Version: API_VERSION,
      Terminal: this.getTerminalData(account),
      Customer: {
        IPAddress: order.ip ?? '',
      },
      Order: {
        OrderID: orderIdOf(order),
      },
      Transaction: {
        Type: this.valueMapper.mapTxType(TX_TYPE.PAY_POST_AUTH),
        Amount: this.valueFormatter.formatAmount(required(order, 'amount')),
        CurrencyCode: this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY),
        OriginalRetrefNum: required(order, 'ref_ret_num'),
      },
    }

    return this.sign(account, result)
  }

  createStatusRequestData(account: GarantiPosAccount, order: PosOrder): Record<string, unknown> {
    return this.sign(account, this.createInquiryRequestData(account, order, TX_TYPE.STATUS))
  }

  createOrderHistoryRequestData(account: GarantiPosAccount, order: PosOrder): Record<string, unknown> {
    return this.sign(account, this.createInquiryRequestData(account, order, TX_TYPE.ORDER_HISTORY))
  }

  createCancelRequestData(account: GarantiPosAccount, order: PosOrder): Record<string, unknown> {
    // the bank needs a fixed amount of 1 (100 kuruş) for a cancel
    return this.sign(account, this.createReversalRequestData(account, order, TX_TYPE.CANCEL, 1))
  }

  createRefundRequestData(account: GarantiPosAccount, order: PosOrder, refundTxType: TxType): Record<string, unknown> {
    return this.sign(account, this.createReversalRequestData(account, order, refundTxType, required(order, 'amount')))
  }

  async create3DFormData(
    account: GarantiPosAccount,
    order: PosOrder | null,
    paymentModel: PaymentModel,
    txType: TxType,
    gatewayURL: string,
    creditCard: CreditCard | null = null,
    _extraData: Record<string, unknown> | null = null,
  ): Promise<ThreeDFormData> {
    if (order === null) {
      throw new PosError('Order data is required to create the 3D form data')
    }

    let inputs: Record<string, string> = {
      secure3dsecuritylevel: this.valueMapper.mapSecureType(paymentModel),
      mode: this.getMode(),
      apiversion: API_VERSION,
      terminalprovuserid: account.getUsername(),
      terminaluserid: account.getUsername(),
      terminalmerchantid: account.getMerchantId(),
      terminalid: account.getTerminalId(),
      txntype: this.valueMapper.mapTxType(txType),
      txnamount: String(this.valueFormatter.formatAmount(required(order, 'amount'))),
      txncurrencycode: String(this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY)),
      txninstallmentcount: String(this.valueFormatter.formatInstallment(order.installment ?? 0)),
      orderid: orderIdOf(order),
      successurl: String(required(order, 'success_url')),
      errorurl: String(required(order, 'fail_url')),
      customeripaddress: String(required(order, 'ip')),
    }

    if (creditCard !== null) {
      inputs.cardnumber = creditCard.getNumber()
      inputs.cardexpiredatemonth = this.valueFormatter.formatCardExpDate(creditCard, 'cardexpiredatemonth')
      inputs.cardexpiredateyear = this.valueFormatter.formatCardExpDate(creditCard, 'cardexpiredateyear')
      inputs.cardcvv2 = creditCard.getCvv()
    }

    inputs = await this.dispatchBefore3DFormHashCalculated(
      inputs,
      account.getBankName(),
      txType,
      paymentModel,
      GATEWAY_CLASS,
    )

    const secure3dhash = this.crypt.create3DHash(account, inputs)

    return { gateway: gatewayURL, method: 'POST', inputs: { ...inputs, secure3dhash } }
  }

  /** Status and order history look up one order; the bank ignores the amount but wants a fixed one. */
  private createInquiryRequestData(
    account: GarantiPosAccount,
    order: PosOrder,
    txType: TxType,
  ): Record<string, unknown> {
    return {
      Mode: this.getMode(),
      Version: API_VERSION,
      Terminal: this.getTerminalData(account),
      Customer: {
        IPAddress: order.ip ?? '',
      },
      Order: {
        OrderID: orderIdOf(order),
      },
      Transaction: {
        Type: this.valueMapper.mapTxType(txType),
        InstallmentCnt: this.valueFormatter.formatInstallment(0),
        Amount: this.valueFormatter.formatAmount(1),
        CurrencyCode: this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY),
        CardholderPresentCode: '0',
        MotoInd: MOTO,
      },
    }
  }

  /** Cancel and refund are sent with the refund user and point at the original transaction. */
  private createReversalRequestData(
    account: GarantiPosAccount,
    order: PosOrder,
    txType: TxType,
    amount: number,
  ): Record<string, unknown> {
    return {
      Mode: this.getMode(),
      Version: API_VERSION,
      Terminal: this.getTerminalData(account, true),
      Customer: {
        IPAddress: order.ip ?? '',
      },
      Order: {
        OrderID: orderIdOf(order),
      },
      Transaction: {
        Type: this.valueMapper.mapTxType(txType),
        InstallmentCnt: this.valueFormatter.formatInstallment(0),
        Amount: this.valueFormatter.formatAmount(amount),
        CurrencyCode: this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY),
        CardholderPresentCode: '0',
        MotoInd: MOTO,
        OriginalRetrefNum: required(order, 'ref_ret_num'),
      },
    }
  }

  /**
   * Signs the request: the hash is computed over the data with an empty `HashData`; the result is a copy that
   * carries the hash, so the object that was hashed is left untouched.
   */
  private sign(account: GarantiPosAccount, result: Record<string, unknown>): Record<string, unknown> {
    const hashData = this.crypt.createHash(account, result)

    return { ...result, Terminal: { ...(result.Terminal as TerminalData), HashData: hashData } }
  }

  private getMode(): string {
    return this.isTestMode() ? 'TEST' : 'PROD'
  }

  private getTerminalData(account: GarantiPosAccount, isRefund = false): TerminalData {
    let username = account.getUsername()
    if (isRefund) {
      const refundUsername = account.getRefundUsername()
      if (refundUsername === null || refundUsername.trim() === '') {
        throw new MissingAccountInfoError('Refund username is required for cancel and refund requests.')
      }
      username = refundUsername
    }

    return {
      ProvUserID: username,
      UserID: username,
      HashData: '',
      ID: account.getTerminalId(),
      MerchantID: account.getMerchantId(),
    }
  }

  private getCardData(creditCard: CreditCard): { Number: string; ExpireDate: string; CVV2: string } {
    return {
      Number: creditCard.getNumber(),
      ExpireDate: this.valueFormatter.formatCardExpDate(creditCard, 'ExpireDate'),
      CVV2: creditCard.getCvv(),
    }
  }

  /**
   * Recurring payment plan: `Type` R is a fixed amount plan, frequency type is month, week or day.
   */
  private createRecurringData(recurring: Record<string, unknown>, txType: TxType): Record<string, string> {
    const what = 'Recurring'
    const startDate = recurring.startDate
    if (isSet(startDate) && !(startDate instanceof Date)) {
      throw new PosError('Recurring field "startDate" must be a Date')
    }

    return {
      TotalPaymentNum: requiredString(recurring, 'installment', what),
      FrequencyType: this.valueMapper.mapRecurringFrequency(requiredString(recurring, 'frequencyType', what)),
      FrequencyInterval: requiredString(recurring, 'frequency', what),
      Type: 'R',
      StartDate: isSet(startDate) ? this.valueFormatter.formatDateTime(startDate, 'StartDate', txType) : '',
    }
  }
}
