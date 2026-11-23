import { PosError } from '../../../errors.js'
import type { PayFlexPosAccount } from '../../../model/account/PayFlexPosAccount.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { CURRENCY, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosOrder, ThreeDFormData } from '../../../types.js'
import { AbstractRequestDataMapper } from './AbstractRequestDataMapper.js'

/** PHP isset(): neither undefined nor null. */
function isSet<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null
}

/**
 * Returns a required order field. Missing (undefined/null) values and empty strings are rejected instead of being
 * cast to the literal "undefined" and posted to the bank.
 *
 * @throws PosError when the field is missing
 */
function required<K extends keyof PosOrder>(order: PosOrder, key: K): NonNullable<PosOrder[K]> {
  const value = order[key]
  if (!isSet(value) || value === '') {
    throw new PosError(`Order field "${String(key)}" is required`)
  }

  return value as NonNullable<PosOrder[K]>
}

/** Same rule for a field of the bank's 3D enrollment response. */
function requiredResponse(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  if (!isSet(value) || value === '') {
    throw new PosError(`3D response field "${key}" is required`)
  }

  return String(value)
}

/**
 * Creates request data for PayFlex V4 (VakifBank / Ziraat PayFlex) gateway requests. `MerchantType` comes from the
 * account (0 standard, 1 main dealer, 2 sub dealer), never hard-coded.
 */
export class PayFlexV4PosRequestDataMapper extends AbstractRequestDataMapper<PayFlexPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayFlexV4Pos'
  }

  create3DPaymentRequestData(
    account: PayFlexPosAccount,
    order: PosOrder,
    txType: TxType,
    responseData: Record<string, unknown>,
    creditCard: CreditCard | null = null,
  ): Record<string, unknown> {
    if (creditCard === null) {
      throw new PosError('Ödemeyi tamamlamak için kart bilgiler zorunlu!')
    }

    const o = this.applyPaymentDefaults(order)

    const requestData: Record<string, unknown> = {
      ...this.getRequestAccountData(account),
      TransactionType: this.valueMapper.mapTxType(txType),
      TransactionId: String(required(o, 'id')),
      CurrencyAmount: this.valueFormatter.formatAmount(required(o, 'amount')),
      CurrencyCode: this.valueMapper.mapCurrency(o.currency),
      ECI: requiredResponse(responseData, 'Eci'),
      CAVV: requiredResponse(responseData, 'Cavv'),
      MpiTransactionId: requiredResponse(responseData, 'VerifyEnrollmentRequestId'),
      OrderId: String(required(o, 'id')),
      ClientIp: String(o.ip),
      TransactionDeviceSource: '0', // ECommerce
      CardHoldersName: creditCard.getHolderName(),
      Cvv: creditCard.getCvv(),
      Pan: creditCard.getNumber(),
      Expiry: this.valueFormatter.formatCardExpDate(creditCard, 'Expiry'),
    }

    if (o.installment) {
      requestData.NumberOfInstallments = this.valueFormatter.formatInstallment(o.installment)
    }

    return requestData
  }

  create3DFormInitializeRequestData(
    account: PayFlexPosAccount,
    order: PosOrder,
    _paymentModel: PaymentModel,
    _txType: TxType,
    creditCard: CreditCard | null = null,
  ): Record<string, unknown> {
    if (creditCard === null) {
      throw new PosError('Bu işlem için kredi kartı bilgileri gereklidir.')
    }

    const o = this.applyPaymentDefaults(order)
    const cardType = creditCard.getType()

    const requestData: Record<string, unknown> = {
      MerchantId: account.getMerchantId(),
      MerchantPassword: account.getPassword(),
      MerchantType: account.getMerchantType(),
      PurchaseAmount: this.valueFormatter.formatAmount(required(o, 'amount')),
      VerifyEnrollmentRequestId: this.crypt.generateRandomString(),
      Currency: this.valueMapper.mapCurrency(o.currency),
      SuccessUrl: required(o, 'success_url'),
      FailureUrl: required(o, 'fail_url'),
      Pan: creditCard.getNumber(),
      ExpiryDate: this.valueFormatter.formatCardExpDate(creditCard, 'ExpiryDate'),
      BrandName: cardType !== null ? this.valueMapper.mapCardType(cardType) : null,
      IsRecurring: 'false',
    }

    if (o.installment) {
      requestData.InstallmentCount = this.valueFormatter.formatInstallment(o.installment)
    }

    if (account.isSubBranch()) {
      requestData.SubMerchantId = account.getSubMerchantId()
    }

    if (isSet(order.recurring)) {
      return { ...requestData, ...this.createRecurringData(order.recurring as Record<string, unknown>) }
    }

    return requestData
  }

  createNonSecurePaymentRequestData(
    account: PayFlexPosAccount,
    order: PosOrder,
    txType: TxType,
    creditCard: CreditCard,
  ): Record<string, unknown> {
    const o = this.applyPaymentDefaults(order)

    return {
      ...this.getRequestAccountData(account),
      TransactionType: this.valueMapper.mapTxType(txType),
      OrderId: String(required(o, 'id')),
      CurrencyAmount: this.valueFormatter.formatAmount(required(o, 'amount')),
      CurrencyCode: this.valueMapper.mapCurrency(o.currency),
      ClientIp: String(o.ip),
      TransactionDeviceSource: '0',
      Pan: creditCard.getNumber(),
      Expiry: this.valueFormatter.formatCardExpDate(creditCard, 'Expiry'),
      Cvv: creditCard.getCvv(),
    }
  }

  createNonSecurePostAuthPaymentRequestData(account: PayFlexPosAccount, order: PosOrder): Record<string, unknown> {
    return {
      ...this.getRequestAccountData(account),
      TransactionType: this.valueMapper.mapTxType(TX_TYPE.PAY_POST_AUTH),
      ReferenceTransactionId: String(required(order, 'transaction_id')),
      CurrencyAmount: String(this.valueFormatter.formatAmount(required(order, 'amount'))),
      CurrencyCode: String(this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY)),
      ClientIp: String(order.ip ?? ''),
    }
  }

  createStatusRequestData(account: PayFlexPosAccount, order: PosOrder): Record<string, unknown> {
    return {
      MerchantCriteria: {
        HostMerchantId: account.getMerchantId(),
        MerchantPassword: account.getPassword(),
      },
      TransactionCriteria: {
        // TransactionId or OrderId is required; when both are sent the bank uses TransactionId.
        // With OrderId only, the successful transaction of that order (else the last one) is reported.
        TransactionId: String(order.transaction_id ?? ''),
        OrderId: String(required(order, 'id')),
        AuthCode: '',
      },
    }
  }

  createCancelRequestData(account: PayFlexPosAccount, order: PosOrder): Record<string, unknown> {
    return {
      MerchantId: account.getMerchantId(),
      Password: account.getPassword(),
      TransactionType: this.valueMapper.mapTxType(TX_TYPE.CANCEL),
      ReferenceTransactionId: String(required(order, 'transaction_id')),
      ClientIp: String(order.ip ?? ''),
    }
  }

  createRefundRequestData(account: PayFlexPosAccount, order: PosOrder, refundTxType: TxType): Record<string, unknown> {
    return {
      MerchantId: account.getMerchantId(),
      Password: account.getPassword(),
      TransactionType: this.valueMapper.mapTxType(refundTxType),
      ReferenceTransactionId: String(required(order, 'transaction_id')),
      ClientIp: String(order.ip ?? ''),
      CurrencyAmount: String(this.valueFormatter.formatAmount(required(order, 'amount'))),
    }
  }

  createOrderHistoryRequestData(_account: PayFlexPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new PosError('Not implemented: order history is not supported by PayFlex V4')
  }

  /**
   * The ACS redirect form is built from the enrollment response (`extraData`: PaReq, TermUrl, MD, ACSUrl); no
   * hash is calculated, so the Before3DFormHashCalculated hook is not dispatched.
   */
  async create3DFormData(
    _account: PayFlexPosAccount,
    _order: PosOrder | null,
    _paymentModel: PaymentModel,
    _txType: TxType,
    _gatewayURL: string,
    _creditCard: CreditCard | null = null,
    extraData: Record<string, unknown> | null = null,
  ): Promise<ThreeDFormData> {
    if (extraData === null) {
      throw new PosError('extraData can not be null')
    }

    return {
      gateway: requiredResponse(extraData, 'ACSUrl'),
      method: 'POST',
      inputs: {
        PaReq: requiredResponse(extraData, 'PaReq'),
        TermUrl: requiredResponse(extraData, 'TermUrl'),
        MD: requiredResponse(extraData, 'MD'),
      },
    }
  }

  private applyPaymentDefaults(
    order: PosOrder,
  ): PosOrder & { installment: number; currency: NonNullable<PosOrder['currency']> } {
    return {
      ...order,
      installment: order.installment ?? 0,
      currency: order.currency ?? CURRENCY.TRY,
      ip: order.ip ?? '',
    }
  }

  private getRequestAccountData(account: PayFlexPosAccount): {
    MerchantId: string
    Password: string
    TerminalNo: string
  } {
    return {
      MerchantId: account.getMerchantId(),
      Password: account.getPassword(),
      TerminalNo: account.getTerminalId(),
    }
  }

  private createRecurringData(recurring: Record<string, unknown>): Record<string, string> {
    const endDate = recurring.endDate
    if (!(endDate instanceof Date)) {
      throw new PosError('Recurring endDate must be a Date')
    }
    const startDate = recurring.startDate

    return {
      IsRecurring: 'true',
      RecurringFrequency: String(recurring.frequency),
      // Day|Month|Year
      RecurringFrequencyType: this.valueMapper.mapRecurringFrequency(String(recurring.frequencyType)),
      // total number of repetitions
      RecurringInstallmentCount: String(recurring.installment),
      // the ACS rejects the transaction when this date is after the card expiry date
      RecurringEndDate: this.valueFormatter.formatDateTime(endDate, 'RecurringEndDate'),
      TriggerDate: startDate instanceof Date ? this.valueFormatter.formatDateTime(startDate, 'TriggerDate') : '',
    }
  }
}
