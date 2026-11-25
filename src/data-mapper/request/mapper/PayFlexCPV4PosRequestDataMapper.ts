import { NotImplementedError, PosError } from '../../../errors.js'
import type { PayFlexPosAccount } from '../../../model/account/PayFlexPosAccount.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { CURRENCY, type PaymentModel, type TxType } from '../../../PosInterface.js'
import type { PosOrder, ThreeDFormData } from '../../../types.js'
import { orderIdOf } from '../../../util/orderId.js'
import { isSet, required, requiredString } from '../../../util/required.js'
import { AbstractRequestDataMapper } from './AbstractRequestDataMapper.js'

/**
 * VakifBank Common Payment guide v2.1 §7 (error 0097): order ids may only hold digits, letters and hyphens. The
 * library-wide rule (a letter or digit first, at most 64) applies on top.
 */
export const ORDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/
/** VakifBank Common Payment guide v2.1 §4/§5: alphanumeric, at most 40 characters, no special or Turkish characters. */
const TRANSACTION_ID_PATTERN = /^[0-9A-Za-z-]{1,40}$/

/**
 * Creates request data for VakifBank Common Payment (the card page is hosted by the bank).
 *
 * The registration (CreateToken) request carries no `HashedData`: VakifBank Common Payment guide v2.1 §5 marks it
 * optional, and its formula needs values that only exist after the 3D step.
 */
export class PayFlexCPV4PosRequestDataMapper extends AbstractRequestDataMapper<PayFlexPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayFlexCPV4Pos'
  }

  create3DPaymentRequestData(
    _account: PayFlexPosAccount,
    _order: PosOrder,
    _txType: TxType,
    _responseData: Record<string, unknown>,
    _creditCard: CreditCard | null = null,
  ): Record<string, unknown> {
    throw new NotImplementedError('Common payment completes the payment on the bank page')
  }

  /**
   * Query (GetVposTransaction) body built from the callback data. At least one of `TransactionId` / `PaymentToken`
   * is needed (VakifBank Common Payment guide v2.1 §6.5).
   */
  create3DPaymentStatusRequestData(
    account: PayFlexPosAccount,
    responseData: Record<string, unknown>,
  ): Record<string, string> {
    return this.createQueryData(account, responseData.TransactionId, responseData.PaymentToken, '3D response')
  }

  /**
   * Registration (CreateToken) body. Field set and the `MerchantId` rule follow VakifBank Common Payment guide
   * v2.1 §4/§5: `MerchantId` is `1`, or the sub merchant id for sub-dealer accounts.
   */
  create3DFormInitializeRequestData(
    account: PayFlexPosAccount,
    order: PosOrder,
    _paymentModel: PaymentModel,
    txType: TxType,
    creditCard: CreditCard | null = null,
  ): Record<string, string> {
    const orderId = orderIdOf(order, 64, ORDER_ID_PATTERN)

    let transactionId: string
    if (isSet(order.transaction_id) && order.transaction_id !== '') {
      transactionId = order.transaction_id
      if (!TRANSACTION_ID_PATTERN.test(transactionId)) {
        throw new PosError('Order field "transaction_id" must be 1-40 characters of digits, letters and hyphens')
      }
    } else {
      transactionId = this.crypt.generateRandomString(32)
    }

    const requestData: Record<string, string> = {
      HostMerchantId: account.getMerchantId(),
      MerchantId: this.getMerchantId(account),
      MerchantPassword: account.getPassword(),
      HostTerminalId: account.getTerminalId(),
      TransactionType: this.valueMapper.mapTxType(txType),
      TransactionId: transactionId,
      AmountCode: String(this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY)),
      Amount: String(this.valueFormatter.formatAmount(required(order, 'amount'))),
      OrderId: orderId,
      // 3D is always applied; "Half Secure" (AllowNotEnrolledCard true) can be opted into with a request hook.
      IsSecure: 'true',
      AllowNotEnrolledCard: 'false',
      SuccessUrl: required(order, 'success_url'),
      FailUrl: required(order, 'fail_url'),
      RequestLanguage: this.getLang(order),
      // printed on the card holder statement
      Extract: '',
      // merchant defined extra items
      CustomItems: '',
    }

    if (creditCard !== null) {
      const cardType = creditCard.getType()
      requestData.BrandNumber = cardType !== null ? this.valueMapper.mapCardType(cardType) : ''
      requestData.CVV = creditCard.getCvv()
      requestData.PAN = creditCard.getNumber()
      requestData.ExpireMonth = this.valueFormatter.formatCardExpDate(creditCard, 'ExpireMonth')
      requestData.ExpireYear = this.valueFormatter.formatCardExpDate(creditCard, 'ExpireYear')
      requestData.CardHoldersName = creditCard.getHolderName() ?? ''
    }

    if (order.installment) {
      requestData.InstallmentCount = String(this.valueFormatter.formatInstallment(order.installment))
    }

    return requestData
  }

  createNonSecurePaymentRequestData(
    _account: PayFlexPosAccount,
    _order: PosOrder,
    _txType: TxType,
    _creditCard: CreditCard,
  ): Record<string, unknown> {
    throw new NotImplementedError('Common payment has no non-secure payment')
  }

  createNonSecurePostAuthPaymentRequestData(_account: PayFlexPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new NotImplementedError('Common payment has no post authorization')
  }

  /** Query (GetVposTransaction) body from the order's `transaction_id` / `payment_token`. */
  createStatusRequestData(account: PayFlexPosAccount, order: PosOrder): Record<string, string> {
    return this.createQueryData(account, order.transaction_id, order.payment_token, 'Order')
  }

  createCancelRequestData(_account: PayFlexPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new NotImplementedError('Common payment has no cancel')
  }

  createRefundRequestData(
    _account: PayFlexPosAccount,
    _order: PosOrder,
    _refundTxType: TxType,
  ): Record<string, unknown> {
    throw new NotImplementedError('Common payment has no refund')
  }

  createOrderHistoryRequestData(_account: PayFlexPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new NotImplementedError('Common payment has no order history')
  }

  /** The browser is sent to the bank page with a GET carrying the payment token; no hash is calculated. */
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
      gateway: requiredString(extraData, 'CommonPaymentUrl', '3D response'),
      method: 'GET',
      inputs: { Ptkn: requiredString(extraData, 'PaymentToken', '3D response') },
    }
  }

  private getMerchantId(account: PayFlexPosAccount): string {
    const sub = account.getSubMerchantId()
    return account.isSubBranch() && sub ? sub : '1'
  }

  private createQueryData(
    account: PayFlexPosAccount,
    transactionId: unknown,
    paymentToken: unknown,
    what: string,
  ): Record<string, string> {
    const data: Record<string, string> = {
      HostMerchantId: account.getMerchantId(),
      MerchantId: this.getMerchantId(account),
      Password: account.getPassword(),
    }
    const [a, b] = what === 'Order' ? ['transaction_id', 'payment_token'] : ['TransactionId', 'PaymentToken']
    // An id of another type is refused: dropping it silently would query by the other id alone.
    for (const [id, name] of [
      [transactionId, a],
      [paymentToken, b],
    ] as const) {
      if (isSet(id) && typeof id !== 'string') {
        throw new PosError(`${what} field "${name}" must be a string`)
      }
    }
    if (typeof transactionId === 'string' && transactionId !== '') {
      data.TransactionId = transactionId
    }
    if (typeof paymentToken === 'string' && paymentToken !== '') {
      data.PaymentToken = paymentToken
    }
    if (data.TransactionId === undefined && data.PaymentToken === undefined) {
      throw new PosError(`${what} field "${a}" or "${b}" is required`)
    }

    return data
  }
}
