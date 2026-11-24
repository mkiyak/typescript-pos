import type { KuveytPosCrypt } from '../../../crypt/KuveytPosCrypt.js'
import {
  NotImplementedError,
  PosError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../../../errors.js'
import type { BoaPosAccount } from '../../../model/account/BoaPosAccount.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import {
  CARD_TYPE,
  CURRENCY,
  LANG,
  type Lang,
  MODEL,
  type PaymentModel,
  TX_TYPE,
  type TxType,
} from '../../../PosInterface.js'
import type { PosHooks, PosOrder, ThreeDFormData } from '../../../types.js'
import { ownValue } from '../../../util/ownValue.js'
import { parseInstallment } from '../../../util/parseInstallment.js'
import type { KuveytPosRequestValueFormatter } from '../value-formatter/KuveytPosRequestValueFormatter.js'
import type { KuveytPosRequestValueMapper } from '../value-mapper/KuveytPosRequestValueMapper.js'
import { AbstractRequestDataMapper } from './AbstractRequestDataMapper.js'
import {
  MD_PATTERN,
  optionalTextOf,
  orderAmountOf,
  orderDateOf,
  orderIdOf,
  orderRecordOf,
  orderStringOf,
  orderTextOf,
  orderUrlOf,
} from './boaOrderFields.js'

/** The bank's own order id is a positive integer of at most 19 digits. */
const BANK_ORDER_ID_PATTERN = /^[1-9]\d{0,18}$/

/** A status query without dates looks back this far. */
const STATUS_LOOKBACK_MS = 360 * 24 * 60 * 60 * 1000

type VPosRequest = Record<string, unknown>

/** Creates request data for the Kuveyt Turk virtual POS (3D form start, provision, non-secure sale, cancel, refund, status). */
export class KuveytPosRequestDataMapper extends AbstractRequestDataMapper<BoaPosAccount> {
  static readonly API_VERSION = 'TDV2.0.0'

  constructor(
    protected override readonly valueMapper: KuveytPosRequestValueMapper,
    protected override readonly valueFormatter: KuveytPosRequestValueFormatter,
    hooks: PosHooks,
    protected override readonly crypt: KuveytPosCrypt,
    defaultLang: Lang = LANG.TR,
  ) {
    super(valueMapper, valueFormatter, hooks, crypt, defaultLang)
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'KuveytPos'
  }

  /**
   * The provision request after the bank's 3D page. Everything about money (amount, currency, installment, order id,
   * security model) comes from the order: the callback is posted by the browser and its message is not signed. Only
   * the session value `MD` is taken from the callback, and only as a plain base64 string.
   */
  create3DPaymentRequestData(
    account: BoaPosAccount,
    order: PosOrder,
    txType: TxType,
    responseData: Record<string, unknown>,
  ): Record<string, unknown> {
    this.assertSale(txType)
    const defaults = this.applyPaymentDefaults(order)
    const orderId = orderIdOf(defaults)
    const amount = String(this.valueFormatter.formatAmount(orderAmountOf(defaults)))
    const installment = this.installment(defaults)
    const currency = this.currency(defaults)
    const ip = orderStringOf(defaults, 'ip')
    const md: unknown = ownValue(responseData, 'MD')
    if (typeof md !== 'string' || !MD_PATTERN.test(md)) {
      throw new PosError('3D callback authentication values are malformed')
    }

    const result: Record<string, unknown> = {
      ...this.accountData(account),
      APIVersion: KuveytPosRequestDataMapper.API_VERSION,
      HashData: '',
      CustomerIPAddress: ip,
      KuveytTurkVPosAdditionalData: {
        AdditionalData: {
          Key: 'MD',
          Data: md,
        },
      },
      TransactionType: this.valueMapper.mapTxType(txType),
      InstallmentCount: installment,
      Amount: amount,
      DisplayAmount: amount,
      CurrencyCode: currency,
      MerchantOrderId: orderId,
      TransactionSecurity: this.valueMapper.mapSecureType(MODEL.THREE_D_SECURE),
    }
    result.HashData = this.crypt.createHash(account, result)

    return result
  }

  /** The request that makes the bank return its own 3D page (card data is posted to the bank, the answer is HTML). */
  override create3DFormInitializeRequestData(
    account: BoaPosAccount,
    order: PosOrder,
    paymentModel: PaymentModel,
    txType: TxType,
    creditCard: CreditCard | null = null,
  ): Record<string, unknown> {
    if (paymentModel !== MODEL.THREE_D_SECURE) {
      throw new UnsupportedPaymentModelError(`Unsupported payment model: ${String(paymentModel)}`)
    }
    this.assertSale(txType)
    const defaults = this.applyPaymentDefaults(order)
    const orderId = orderIdOf(defaults)
    const kurus = this.valueFormatter.formatAmount(orderAmountOf(defaults))
    const installment = this.installment(defaults)
    const currency = this.currency(defaults)
    const okUrl = orderUrlOf(defaults, 'success_url')
    const failUrl = orderUrlOf(defaults, 'fail_url')
    const ip = orderStringOf(defaults, 'ip')
    const channel = orderStringOf(defaults, 'payment_channel')
    const buyer = orderRecordOf(defaults, 'buyer')
    const billing = orderRecordOf(defaults, 'billing_address')

    const requestData: Record<string, unknown> = {
      ...this.accountData(account),
      APIVersion: KuveytPosRequestDataMapper.API_VERSION,
      TransactionType: this.valueMapper.mapTxType(txType),
      TransactionSecurity: this.valueMapper.mapSecureType(paymentModel),
      InstallmentCount: installment,
      Amount: kurus,
      // The bank wants DisplayAmount equal to Amount.
      DisplayAmount: kurus,
      CurrencyCode: currency,
      MerchantOrderId: orderId,
      OkUrl: okUrl,
      FailUrl: failUrl,
      DeviceData: {
        ClientIP: ip,
        DeviceChannel: channel,
      },
      CardHolderData: {
        BillAddrCity: optionalTextOf(billing, 'city'),
        BillAddrCountry: optionalTextOf(billing, 'country'),
        BillAddrLine1: optionalTextOf(billing, 'address'),
        BillAddrPostCode: optionalTextOf(billing, 'zip_code'),
        BillAddrState: optionalTextOf(billing, 'state'),
        Email: optionalTextOf(buyer, 'email'),
        MobilePhone: {
          Cc: optionalTextOf(buyer, 'gsm_number_cc'),
          Subscriber: optionalTextOf(buyer, 'gsm_number'),
        },
      },
    }

    if (creditCard !== null && creditCard !== undefined) {
      const type = creditCard.getType()
      requestData.CardHolderName = creditCard.getHolderName() ?? ''
      requestData.CardType = type !== null ? this.valueMapper.mapCardType(type) : ''
      requestData.CardNumber = creditCard.getNumber()
      requestData.CardExpireDateYear = this.valueFormatter.formatCardExpDate(creditCard, 'CardExpireDateYear')
      requestData.CardExpireDateMonth = this.valueFormatter.formatCardExpDate(creditCard, 'CardExpireDateMonth')
      requestData.CardCVV2 = creditCard.getCvv()
    }

    requestData.HashData = this.crypt.createHash(account, requestData)

    return requestData
  }

  createNonSecurePaymentRequestData(
    account: BoaPosAccount,
    order: PosOrder,
    txType: TxType,
    creditCard: CreditCard,
  ): Record<string, unknown> {
    this.assertSale(txType)
    const defaults = this.applyPaymentDefaults(order)
    const orderId = orderIdOf(defaults)
    const kurus = this.valueFormatter.formatAmount(orderAmountOf(defaults))
    const installment = this.installment(defaults)
    const currency = this.currency(defaults)

    const requestData: Record<string, unknown> = {
      ...this.accountData(account),
      APIVersion: KuveytPosRequestDataMapper.API_VERSION,
      HashData: '',
      TransactionType: this.valueMapper.mapTxType(txType),
      TransactionSecurity: '1',
      MerchantOrderId: orderId,
      Amount: kurus,
      DisplayAmount: kurus,
      CurrencyCode: currency,
      InstallmentCount: installment,
      CardHolderName: creditCard.getHolderName() ?? '',
      CardNumber: creditCard.getNumber(),
      CardExpireDateYear: this.valueFormatter.formatCardExpDate(creditCard, 'CardExpireDateYear'),
      CardExpireDateMonth: this.valueFormatter.formatCardExpDate(creditCard, 'CardExpireDateMonth'),
      CardCVV2: creditCard.getCvv(),
    }
    requestData.HashData = this.crypt.createHash(account, requestData)

    return requestData
  }

  createNonSecurePostAuthPaymentRequestData(_account: BoaPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new NotImplementedError('Not supported')
  }

  createStatusRequestData(account: BoaPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = orderIdOf(order)
    const currency = this.currency(order)
    const now = Date.now()
    const startDate = orderDateOf(order, 'start_date', new Date(now - STATUS_LOOKBACK_MS))
    const endDate = orderDateOf(order, 'end_date', new Date(now))
    const remoteOrderId = this.optionalBankOrderId(order)

    const vposMessage: Record<string, unknown> = {
      ...this.accountData(account),
      ...this.vposMessageBody(TX_TYPE.STATUS, orderId, currency, 0, 0, 0, 0),
    }
    vposMessage.HashData = this.crypt.createHash(account, vposMessage)

    const request: VPosRequest = {
      IsFromExternalNetwork: true,
      BusinessKey: 0,
      ResourceId: 0,
      ActionId: 0,
      LanguageId: 0,
      CustomerId: account.getCustomerId(),
      MailOrTelephoneOrder: true,
      Amount: 0,
      MerchantId: account.getMerchantId(),
      MerchantOrderId: orderId,
      // With the bank's own order id only that transaction comes back; 0 lists every order of the merchant order id in the range.
      OrderId: remoteOrderId ?? 0,
      // The bank answers with a SOAP fault when the dates are missing or invalid.
      StartDate: this.valueFormatter.formatDateTime(startDate, 'StartDate'),
      EndDate: this.valueFormatter.formatDateTime(endDate, 'EndDate'),
      TransactionType: 0,
      VPosMessage: vposMessage,
    }

    return { [String(vposMessage.TransactionType)]: { request } }
  }

  createCancelRequestData(account: BoaPosAccount, order: PosOrder): Record<string, unknown> {
    return this.reversalRequest(account, order, TX_TYPE.CANCEL, 'full')
  }

  createRefundRequestData(account: BoaPosAccount, order: PosOrder, refundTxType: TxType): Record<string, unknown> {
    if (refundTxType !== TX_TYPE.REFUND && refundTxType !== TX_TYPE.REFUND_PARTIAL) {
      // Every other type maps to another bank operation; a refund request must never become a sale or a cancel.
      throw new UnsupportedTransactionTypeError(`Unsupported refund transaction type: ${String(refundTxType)}`)
    }

    return this.reversalRequest(account, order, refundTxType, 'refund')
  }

  /** The bank returns its own 3D page, so there is no form to build here. */
  override async create3DFormData(
    _account: BoaPosAccount,
    _order: PosOrder | null,
    _paymentModel: PaymentModel,
    _txType: TxType,
    _gatewayURL: string,
    _creditCard?: CreditCard | null,
    _extraData?: Record<string, unknown> | null,
  ): Promise<ThreeDFormData | string> {
    throw new NotImplementedError('Not supported')
  }

  createOrderHistoryRequestData(_account: BoaPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new NotImplementedError('Not supported')
  }

  /** Cancel and refund share one shape; they differ in the type, and a refund shows no display amount. */
  private reversalRequest(
    account: BoaPosAccount,
    order: PosOrder,
    txType: TxType,
    kind: 'full' | 'refund',
  ): Record<string, unknown> {
    const orderId = orderIdOf(order)
    const remoteOrderId = this.bankOrderId(order)
    const refRetNum = orderTextOf(order, 'ref_ret_num')
    const authCode = orderTextOf(order, 'auth_code')
    const transactionId = orderTextOf(order, 'transaction_id')
    const kurus = this.valueFormatter.formatAmount(orderAmountOf(order))
    const currency = this.currency(order)

    const vposMessage: Record<string, unknown> = {
      ...this.accountData(account),
      ...this.vposMessageBody(txType, orderId, currency, kurus, kind === 'full' ? kurus : 0, kurus, 0),
    }
    vposMessage.HashData = this.crypt.createHash(account, vposMessage)

    const request: VPosRequest = {
      IsFromExternalNetwork: true,
      BusinessKey: 0,
      ResourceId: 0,
      ActionId: 0,
      LanguageId: 0,
      CustomerId: account.getCustomerId(),
      MailOrTelephoneOrder: true,
      Amount: kurus,
      MerchantId: account.getMerchantId(),
      OrderId: remoteOrderId,
      RRN: refRetNum,
      Stan: transactionId,
      ProvisionNumber: authCode,
      VPosMessage: vposMessage,
    }

    return { [String(vposMessage.TransactionType)]: { request } }
  }

  /** The message inside the SOAP request, without the account fields and the hash value. */
  private vposMessageBody(
    txType: TxType,
    orderId: string,
    currency: string,
    amount: number,
    displayAmount: number,
    cancelAmount: number,
    installmentCount: number,
  ): Record<string, unknown> {
    return {
      APIVersion: KuveytPosRequestDataMapper.API_VERSION,
      InstallmentMaturityCommisionFlag: 0,
      HashData: '',
      SubMerchantId: 0,
      // The bank accepts any card type here; Visa is the usual default.
      CardType: this.valueMapper.mapCardType(CARD_TYPE.VISA),
      BatchID: 0,
      TransactionType: this.valueMapper.mapTxType(txType),
      InstallmentCount: installmentCount,
      Amount: amount,
      DisplayAmount: displayAmount,
      CancelAmount: cancelAmount,
      MerchantOrderId: orderId,
      FECAmount: 0,
      CurrencyCode: currency,
      QeryId: 0,
      DebtId: 0,
      SurchargeAmount: 0,
      SGKDebtAmount: 0,
      TransactionSecurity: 1,
    }
  }

  private accountData(account: BoaPosAccount): { MerchantId: string; CustomerId: string; UserName: string } {
    return {
      MerchantId: account.getMerchantId(),
      CustomerId: account.getCustomerId(),
      UserName: account.getUsername(),
    }
  }

  /** A copy of the order with the payment defaults; the caller's object is not touched. */
  private applyPaymentDefaults(order: PosOrder): PosOrder {
    return { ...order, installment: order.installment ?? 0, currency: order.currency ?? CURRENCY.TRY }
  }

  private assertSale(txType: TxType): void {
    if (txType !== TX_TYPE.PAY_AUTH) {
      throw new UnsupportedTransactionTypeError(`Unsupported transaction type: ${String(txType)}`)
    }
  }

  private installment(order: PosOrder): string {
    return this.valueFormatter.formatInstallment(parseInstallment(order.installment))
  }

  private currency(order: PosOrder): string {
    return this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY)
  }

  private bankOrderId(order: PosOrder): string {
    const id = orderTextOf(order, 'remote_order_id')
    if (!BANK_ORDER_ID_PATTERN.test(id)) {
      throw new PosError('The bank order id must be a positive whole number.')
    }
    return id
  }

  private optionalBankOrderId(order: PosOrder): string | null {
    const value: unknown = order.remote_order_id
    // Zero and empty text mean "every order of the merchant order id", like an absent value.
    if (value === undefined || value === null || value === 0 || value === '') return null
    return this.bankOrderId(order)
  }
}
