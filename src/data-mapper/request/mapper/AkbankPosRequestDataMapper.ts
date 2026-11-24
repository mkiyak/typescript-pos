import { NotImplementedError, PosError } from '../../../errors.js'
import type { AkbankPosAccount } from '../../../model/account/AkbankPosAccount.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { CURRENCY, MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosOrder, ThreeDFormData } from '../../../types.js'
import { isSet, required, requiredString } from '../../../util/required.js'
import { AbstractRequestDataMapper } from './AbstractRequestDataMapper.js'

const GATEWAY_CLASS = 'AkbankPos'

/** Creates request data for Akbank (new API) gateway requests. */
export class AkbankPosRequestDataMapper extends AbstractRequestDataMapper<AkbankPosAccount> {
  static readonly API_VERSION = '1.00'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === GATEWAY_CLASS
  }

  create3DPaymentRequestData(
    account: AkbankPosAccount,
    order: PosOrder,
    txType: TxType,
    responseData: Record<string, unknown>,
  ): Record<string, unknown> {
    // The 3D values are signed into the provision request, so each must be a real string from the callback.
    const secureValue = (key: string): string => {
      const value = responseData[key]
      if (typeof value !== 'string' || value === '') {
        throw new PosError(`Callback field "${key}" is required`)
      }
      return value
    }

    return {
      ...this.getRequestAccountData(account),
      version: AkbankPosRequestDataMapper.API_VERSION,
      txnCode: this.valueMapper.mapTxType(txType, MODEL.NON_SECURE),
      requestDateTime: this.now(),
      randomNumber: this.crypt.generateRandomString(),
      order: { orderId: String(required(order, 'id')) },
      transaction: {
        amount: this.valueFormatter.formatAmount(required(order, 'amount')),
        currencyCode: this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY),
        motoInd: 0,
        installCount: this.valueFormatter.formatInstallment(order.installment ?? 0),
      },
      secureTransaction: {
        secureId: secureValue('secureId'),
        secureEcomInd: secureValue('secureEcomInd'),
        secureData: secureValue('secureData'),
        secureMd: secureValue('secureMd'),
      },
      customer: { ipAddress: required(order, 'ip') },
    }
  }

  createNonSecurePaymentRequestData(
    account: AkbankPosAccount,
    order: PosOrder,
    txType: TxType,
    creditCard: CreditCard,
  ): Record<string, unknown> {
    const recurring = isSet(order.recurring) ? (order.recurring as Record<string, unknown>) : null
    // A recurring payment is a single first charge: the bank takes no installments for it.
    const installment = recurring === null ? (order.installment ?? 0) : 0

    const requestData: Record<string, unknown> = {
      ...this.getRequestAccountData(account),
      version: AkbankPosRequestDataMapper.API_VERSION,
      txnCode: this.valueMapper.mapTxType(txType, MODEL.NON_SECURE),
      requestDateTime: this.now(),
      randomNumber: this.crypt.generateRandomString(),
      card: {
        cardNumber: creditCard.getNumber(),
        cvv2: creditCard.getCvv(),
        expireDate: this.valueFormatter.formatCardExpDate(creditCard, 'expireDate'),
      },
      transaction: {
        amount: this.valueFormatter.formatAmount(required(order, 'amount')),
        currencyCode: this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY),
        motoInd: recurring === null ? 0 : 1,
        installCount: this.valueFormatter.formatInstallment(installment),
      },
      customer: { ipAddress: required(order, 'ip') },
    }

    if (recurring === null) {
      requestData.order = { orderId: String(required(order, 'id')) }
    } else {
      requestData.recurring = this.createRecurringData(recurring)
      requestData.order = { orderTrackId: String(required(order, 'id')) }
    }

    return requestData
  }

  createNonSecurePostAuthPaymentRequestData(account: AkbankPosAccount, order: PosOrder): Record<string, unknown> {
    return {
      ...this.getRequestAccountData(account),
      version: AkbankPosRequestDataMapper.API_VERSION,
      txnCode: this.valueMapper.mapTxType(TX_TYPE.PAY_POST_AUTH),
      requestDateTime: this.now(),
      randomNumber: this.crypt.generateRandomString(),
      order: { orderId: String(required(order, 'id')) },
      transaction: {
        amount: this.valueFormatter.formatAmount(required(order, 'amount')),
        currencyCode: this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY),
      },
      customer: { ipAddress: required(order, 'ip') },
    }
  }

  createStatusRequestData(_account: AkbankPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new NotImplementedError('The bank has no order status request; use the order history.')
  }

  createCancelRequestData(account: AkbankPosAccount, order: PosOrder): Record<string, unknown> {
    const requestData: Record<string, unknown> = {
      ...this.getRequestAccountData(account),
      txnCode: this.valueMapper.mapTxType(TX_TYPE.CANCEL),
      version: AkbankPosRequestDataMapper.API_VERSION,
      requestDateTime: this.now(),
      randomNumber: this.crypt.generateRandomString(),
    }

    if ('recurringOrderInstallmentNumber' in order) {
      // Cancels a recurring instruction (or one of its installments) that has not been provisioned yet.
      const installmentNumber = order.recurringOrderInstallmentNumber
      if (isSet(installmentNumber)) {
        // Without a recurringOrder the whole instruction is cancelled; with one, only that installment.
        requestData.recurring = { recurringOrder: installmentNumber }
        if (order.recurring_payment_is_pending === true) {
          requestData.txnCode = '1013'
        }
      } else {
        requestData.txnCode = '1013'
      }
      requestData.order = { orderTrackId: String(required(order, 'recurring_id')) }
    } else {
      requestData.order = { orderId: String(required(order, 'id')) }
    }

    return requestData
  }

  /** Without a transaction field the bank refunds the full amount; the amount is always sent here. */
  createRefundRequestData(account: AkbankPosAccount, order: PosOrder, refundTxType: TxType): Record<string, unknown> {
    const requestData: Record<string, unknown> = {
      ...this.getRequestAccountData(account),
      version: AkbankPosRequestDataMapper.API_VERSION,
      txnCode: this.valueMapper.mapTxType(refundTxType),
      requestDateTime: this.now(),
      randomNumber: this.crypt.generateRandomString(),
      transaction: {
        amount: this.valueFormatter.formatAmount(required(order, 'amount')),
        currencyCode: this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY),
      },
    }

    if (isSet(order.recurringOrderInstallmentNumber)) {
      // Only recurring and forward-dated sales that were provisioned can be refunded.
      requestData.recurring = { recurringOrder: order.recurringOrderInstallmentNumber }
      requestData.order = { orderTrackId: String(required(order, 'recurring_id')) }
    } else {
      requestData.order = { orderId: String(required(order, 'id')) }
    }

    return requestData
  }

  createOrderHistoryRequestData(account: AkbankPosAccount, order: PosOrder): Record<string, unknown> {
    return {
      ...this.getRequestAccountData(account),
      version: AkbankPosRequestDataMapper.API_VERSION,
      txnCode: this.valueMapper.mapTxType(TX_TYPE.ORDER_HISTORY, MODEL.NON_SECURE),
      requestDateTime: this.now(),
      randomNumber: this.crypt.generateRandomString(),
      order: isSet(order.recurring_id)
        ? { orderTrackId: String(order.recurring_id) }
        : { orderId: String(required(order, 'id')) },
    }
  }

  async create3DFormData(
    account: AkbankPosAccount,
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
      paymentModel: this.valueMapper.mapSecureType(paymentModel),
      txnCode: this.valueMapper.mapTxType(txType, paymentModel),
      merchantSafeId: account.getMerchantId(),
      terminalSafeId: account.getTerminalId(),
      orderId: String(required(order, 'id')),
      lang: this.getLang(order),
      amount: String(this.valueFormatter.formatAmount(required(order, 'amount'))),
      currencyCode: String(this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY)),
      installCount: String(this.valueFormatter.formatInstallment(order.installment ?? 0)),
      okUrl: String(required(order, 'success_url')),
      failUrl: String(required(order, 'fail_url')),
      randomNumber: this.crypt.generateRandomString(),
      requestDateTime: this.now(),
    }

    const subMerchantId = account.getSubMerchantId()
    if (subMerchantId !== null) {
      inputs.subMerchantId = subMerchantId
    }

    if (creditCard !== null) {
      inputs.creditCard = creditCard.getNumber()
      inputs.expiredDate = this.valueFormatter.formatCardExpDate(creditCard, 'expiredDate')
      inputs.cvv = creditCard.getCvv()
    }

    // The hash covers whatever the hooks left in the form, so it is computed last.
    inputs = await this.dispatchBefore3DFormHashCalculated(
      inputs,
      account.getBankName(),
      txType,
      paymentModel,
      GATEWAY_CLASS,
    )
    const hash = this.crypt.create3DHash(account, inputs)

    return { gateway: gatewayURL, method: 'POST', inputs: { ...inputs, hash } }
  }

  private now(): string {
    return this.valueFormatter.formatDateTime(new Date(), 'requestDateTime')
  }

  private getRequestAccountData(account: AkbankPosAccount): Record<string, unknown> {
    const data: Record<string, unknown> = {
      terminal: {
        merchantSafeId: account.getMerchantId(),
        terminalSafeId: account.getTerminalId(),
      },
    }

    const subMerchantId = account.getSubMerchantId()
    if (subMerchantId !== null) {
      data.subMerchant = { subMerchantId }
    }

    return data
  }

  private createRecurringData(recurring: Record<string, unknown>): Record<string, unknown> {
    const what = 'Recurring'
    // The values are validated here and sent as given (numbers stay numbers).
    requiredString(recurring, 'frequency', what)
    requiredString(recurring, 'installment', what)

    return {
      frequencyInterval: recurring.frequency,
      frequencyCycle: this.valueMapper.mapRecurringFrequency(requiredString(recurring, 'frequencyType', what)),
      numberOfPayments: recurring.installment,
    }
  }
}
