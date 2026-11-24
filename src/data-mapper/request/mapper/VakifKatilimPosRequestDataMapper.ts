import type { KuveytPosCrypt } from '../../../crypt/KuveytPosCrypt.js'
import { PosError, UnsupportedTransactionTypeError } from '../../../errors.js'
import type { BoaPosAccount } from '../../../model/account/BoaPosAccount.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { CURRENCY, LANG, type Lang, MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosHooks, PosOrder, ThreeDFormData } from '../../../types.js'
import { ownValue } from '../../../util/ownValue.js'
import { parseInstallment } from '../../../util/parseInstallment.js'
import type { VakifKatilimPosRequestValueFormatter } from '../value-formatter/VakifKatilimPosRequestValueFormatter.js'
import type { VakifKatilimPosRequestValueMapper } from '../value-mapper/VakifKatilimPosRequestValueMapper.js'
import { AbstractRequestDataMapper } from './AbstractRequestDataMapper.js'
import {
  MD_PATTERN,
  ORDER_ID_PATTERN,
  orderAmountOf,
  orderDateOf,
  orderIdOf,
  orderStringOf,
  orderTextOf,
  orderUrlOf,
} from './boaOrderFields.js'

/** The bank page the browser posts to: https and printable ASCII only. */
const GATEWAY_URL_PATTERN = /^https:\/\/[\x21-\x7E]+$/i

/** The request fields every Vakıf Katılım call starts with. */
interface AccountData {
  MerchantId: string
  CustomerId: string
  UserName: string
  SubMerchantId: string
}

/** Creates request data for the Vakıf Katılım virtual POS (3D Secure, 3D Host form, non-secure sale, close, cancel, refund, status, history). */
export class VakifKatilimPosRequestDataMapper extends AbstractRequestDataMapper<BoaPosAccount> {
  static readonly API_VERSION = '1.0.0'

  constructor(
    protected override readonly valueMapper: VakifKatilimPosRequestValueMapper,
    protected override readonly valueFormatter: VakifKatilimPosRequestValueFormatter,
    hooks: PosHooks,
    protected override readonly crypt: KuveytPosCrypt,
    defaultLang: Lang = LANG.TR,
  ) {
    super(valueMapper, valueFormatter, hooks, crypt, defaultLang)
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'VakifKatilimPos'
  }

  /**
   * The provision request after the bank's 3D page. Everything about money (amount, installment, order id, return
   * URLs) comes from the order: the callback is posted by the browser and only its session value `MD` is taken, as
   * a plain base64 string.
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
    const okUrl = orderUrlOf(defaults, 'success_url')
    const failUrl = orderUrlOf(defaults, 'fail_url')
    const installment = this.installment(defaults)
    const amount = this.valueFormatter.formatAmount(orderAmountOf(defaults))
    const md: unknown = ownValue(responseData, 'MD')
    if (typeof md !== 'string' || !MD_PATTERN.test(md)) {
      throw new PosError('3D callback authentication values are malformed')
    }

    const result: Record<string, unknown> = {
      ...this.accountData(account),
      OkUrl: okUrl,
      FailUrl: failUrl,
      HashData: '',
      APIVersion: VakifKatilimPosRequestDataMapper.API_VERSION,
      AdditionalData: {
        AdditionalDataList: {
          VPosAdditionalData: {
            Key: 'MD',
            Data: md,
          },
        },
      },
      InstallmentCount: installment,
      Amount: amount,
      MerchantOrderId: orderId,
      TransactionSecurity: this.valueMapper.mapSecureType(MODEL.THREE_D_SECURE),
    }
    result.HashData = this.sign(account, result)

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
      throw new PosError(`Unsupported payment model: ${String(paymentModel)}`)
    }
    this.assertSale(txType)
    const defaults = this.applyPaymentDefaults(order)
    const orderId = orderIdOf(defaults)
    const kurus = this.valueFormatter.formatAmount(orderAmountOf(defaults))
    const installment = this.installment(defaults)
    const currency = this.currency(defaults)
    const okUrl = orderUrlOf(defaults, 'success_url')
    const failUrl = orderUrlOf(defaults, 'fail_url')

    const requestData: Record<string, unknown> = {
      ...this.accountData(account),
      APIVersion: VakifKatilimPosRequestDataMapper.API_VERSION,
      HashPassword: this.crypt.hashString(account.getSecretKey()),
      TransactionSecurity: this.valueMapper.mapSecureType(paymentModel),
      InstallmentCount: installment,
      Amount: kurus,
      // The bank wants DisplayAmount equal to Amount.
      DisplayAmount: kurus,
      FECCurrencyCode: currency,
      MerchantOrderId: orderId,
      OkUrl: okUrl,
      FailUrl: failUrl,
    }

    if (creditCard !== null && creditCard !== undefined) {
      this.addCard(requestData, creditCard, false)
    }

    requestData.HashData = this.sign(account, requestData)

    return requestData
  }

  createNonSecurePaymentRequestData(
    account: BoaPosAccount,
    order: PosOrder,
    txType: TxType,
    creditCard: CreditCard,
  ): Record<string, unknown> {
    // The bank takes a pre-authorization on the same body; only the path differs.
    if (txType !== TX_TYPE.PAY_AUTH && txType !== TX_TYPE.PAY_PRE_AUTH) {
      throw new UnsupportedTransactionTypeError(`Unsupported transaction type: ${String(txType)}`)
    }
    const defaults = this.applyPaymentDefaults(order)
    const orderId = orderIdOf(defaults)
    const installment = this.installment(defaults)
    const kurus = this.valueFormatter.formatAmount(orderAmountOf(defaults))
    const currency = this.currency(defaults)

    const requestData: Record<string, unknown> = {
      ...this.accountData(account),
      APIVersion: VakifKatilimPosRequestDataMapper.API_VERSION,
      HashPassword: this.crypt.hashString(account.getSecretKey()),
      MerchantOrderId: orderId,
      InstallmentCount: installment,
      Amount: kurus,
      FECCurrencyCode: currency,
      CurrencyCode: currency,
      TransactionSecurity: this.valueMapper.mapSecureType(MODEL.NON_SECURE),
    }
    this.addCard(requestData, creditCard, true)
    requestData.HashData = this.sign(account, requestData)

    return requestData
  }

  createNonSecurePostAuthPaymentRequestData(account: BoaPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = orderIdOf(order)
    const remoteOrderId = this.remoteOrderId(order)
    const ip = orderStringOf(order, 'ip')

    const inputs: Record<string, unknown> = {
      ...this.accountData(account),
      HashPassword: this.crypt.hashString(account.getSecretKey()),
      MerchantOrderId: orderId,
      OrderId: remoteOrderId,
      CustomerIPAddress: ip,
    }
    inputs.HashData = this.sign(account, inputs)

    return inputs
  }

  createStatusRequestData(account: BoaPosAccount, order: PosOrder): Record<string, unknown> {
    const result: Record<string, unknown> = {
      ...this.accountData(account),
      MerchantOrderId: orderIdOf(order),
    }
    result.HashData = this.sign(account, result)

    return result
  }

  createCancelRequestData(account: BoaPosAccount, order: PosOrder): Record<string, unknown> {
    const orderTxType = this.orderTxType(order)
    const orderId = orderIdOf(order)
    const remoteOrderId = this.remoteOrderId(order)
    // The pre-authorization is reversed as a whole, so its request carries no amount.
    const kurus = orderTxType === TX_TYPE.PAY_PRE_AUTH ? null : this.valueFormatter.formatAmount(orderAmountOf(order))

    const result: Record<string, unknown> = {
      ...this.accountData(account),
      HashPassword: this.crypt.hashString(account.getSecretKey()),
      MerchantOrderId: orderId,
      OrderId: remoteOrderId,
      PaymentType: '1',
    }
    if (kurus !== null) {
      result.Amount = kurus
    }
    result.HashData = this.sign(account, result)

    return result
  }

  createRefundRequestData(account: BoaPosAccount, order: PosOrder, refundTxType: TxType): Record<string, unknown> {
    if (refundTxType === TX_TYPE.REFUND_PARTIAL) {
      // Never send a "partial" refund that cannot say how much: the request has no amount and would refund it all.
      throw new UnsupportedTransactionTypeError('Partial refunds are not supported: the bank request carries no amount')
    }
    if (refundTxType !== TX_TYPE.REFUND) {
      // Every other type maps to another bank operation; a refund request must never become a sale or a cancel.
      throw new UnsupportedTransactionTypeError(`Unsupported refund transaction type: ${String(refundTxType)}`)
    }
    this.orderTxType(order)
    const orderId = orderIdOf(order)
    const remoteOrderId = this.remoteOrderId(order)

    const result: Record<string, unknown> = {
      ...this.accountData(account),
      HashPassword: this.crypt.hashString(account.getSecretKey()),
      MerchantOrderId: orderId,
      OrderId: remoteOrderId,
    }
    result.HashData = this.sign(account, result)

    return result
  }

  /**
   * The form the browser posts to the bank's common payment page (3D Host only). It carries the hashed API
   * password and no card data; the amount and currency in it are not signed, so the gateway confirms the result
   * with the bank before trusting it.
   */
  override async create3DFormData(
    account: BoaPosAccount,
    order: PosOrder | null,
    paymentModel: PaymentModel,
    txType: TxType,
    gatewayURL: string,
    _creditCard?: CreditCard | null,
    _extraData?: Record<string, unknown> | null,
  ): Promise<ThreeDFormData | string> {
    if (paymentModel !== MODEL.THREE_D_HOST) {
      throw new PosError(
        'A 3D form is only built for the 3D Host model; the bank returns ready HTML for the other models.',
      )
    }
    this.assertSale(txType)
    if (order === null || order === undefined) {
      throw new PosError('An order is required to build the 3D form')
    }
    const defaults = this.applyPaymentDefaults(order)
    const orderId = orderIdOf(defaults)
    const kurus = this.valueFormatter.formatAmount(orderAmountOf(defaults))
    const currency = this.currency(defaults)
    const okUrl = orderUrlOf(defaults, 'success_url')
    const failUrl = orderUrlOf(defaults, 'fail_url')
    if (typeof gatewayURL !== 'string' || !GATEWAY_URL_PATTERN.test(gatewayURL)) {
      throw new PosError('The 3D form gateway must be an https URL of printable ASCII characters.')
    }

    const inputs: Record<string, string> = {
      UserName: account.getUsername(),
      HashPassword: this.crypt.hashString(account.getSecretKey()),
      MerchantId: account.getMerchantId(),
      MerchantOrderId: orderId,
      Amount: String(kurus),
      FECCurrencyCode: currency,
      OkUrl: okUrl,
      FailUrl: failUrl,
      PaymentType: '1',
    }

    return {
      gateway: gatewayURL,
      method: 'POST',
      inputs,
    }
  }

  createOrderHistoryRequestData(account: BoaPosAccount, order: PosOrder): Record<string, unknown> {
    const startDate = orderDateOf(order, 'start_date', null)
    const endDate = orderDateOf(order, 'end_date', null)
    const provNumber = this.optionalAuthCode(order)

    const result: Record<string, unknown> = {
      ...this.accountData(account),
      StartDate: this.valueFormatter.formatDateTime(startDate, 'StartDate'),
      EndDate: this.valueFormatter.formatDateTime(endDate, 'EndDate'),
      LowerLimit: 0,
      UpperLimit: 100,
      ProvNumber: provNumber,
      OrderStatus: null,
      TranResult: null,
      OrderNo: null,
    }
    result.HashData = this.sign(account, result)

    return result
  }

  /** Card fields of the enrollment and the sale; the holder name is empty text, never `null`. */
  private addCard(requestData: Record<string, unknown>, creditCard: CreditCard, holderLast: boolean): void {
    const holder = creditCard.getHolderName() ?? ''
    if (!holderLast) {
      requestData.CardHolderName = holder
    }
    requestData.CardNumber = creditCard.getNumber()
    requestData.CardExpireDateYear = this.valueFormatter.formatCardExpDate(creditCard, 'CardExpireDateYear')
    requestData.CardExpireDateMonth = this.valueFormatter.formatCardExpDate(creditCard, 'CardExpireDateMonth')
    requestData.CardCVV2 = creditCard.getCvv()
    if (holderLast) {
      requestData.CardHolderName = holder
    }
  }

  /** Signs a snapshot of the fields, so the crypt sees exactly what is sent and cannot alter it. */
  private sign(account: BoaPosAccount, fields: Record<string, unknown>): string {
    return this.crypt.createHash(account, { ...fields })
  }

  private accountData(account: BoaPosAccount): AccountData {
    return {
      MerchantId: account.getMerchantId(),
      CustomerId: account.getCustomerId(),
      UserName: account.getUsername(),
      SubMerchantId: account.getSubMerchantId() ?? '0',
    }
  }

  /** A copy of the order with the payment defaults; the caller's object is not touched. */
  private applyPaymentDefaults(order: PosOrder): PosOrder {
    return { ...order, installment: order.installment ?? 0, currency: order.currency ?? CURRENCY.TRY }
  }

  /** Only a sale can be paid through the 3D flows. */
  private assertSale(txType: TxType): void {
    if (txType !== TX_TYPE.PAY_AUTH) {
      throw new UnsupportedTransactionTypeError(`Unsupported transaction type: ${String(txType)}`)
    }
  }

  /** The kind of transaction being reversed: a sale or a pre-authorization; absent means a sale. */
  private orderTxType(order: PosOrder): TxType | null {
    const value: unknown = order.transaction_type
    if (value === undefined || value === null) return null
    if (value !== TX_TYPE.PAY_AUTH && value !== TX_TYPE.PAY_PRE_AUTH) {
      throw new PosError('The order transaction type must be "pay" or "pre".')
    }
    return value
  }

  private installment(order: PosOrder): string {
    return this.valueFormatter.formatInstallment(parseInstallment(order.installment))
  }

  private currency(order: PosOrder): string {
    return this.valueMapper.mapCurrency(order.currency ?? CURRENCY.TRY)
  }

  /** The bank's own order id, posted as plain text. */
  private remoteOrderId(order: PosOrder): string {
    const id = orderTextOf(order, 'remote_order_id')
    if (!ORDER_ID_PATTERN.test(id)) {
      throw new PosError('The bank order id may only hold letters, digits, underscores and hyphens (at most 64).')
    }
    return id
  }

  /** The optional provision number filter of the history query. */
  private optionalAuthCode(order: PosOrder): string | null {
    const value: unknown = order.auth_code
    if (value === undefined || value === null || value === '') return null
    if (typeof value === 'string') return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    throw new PosError('Order field "auth_code" must be text')
  }
}
