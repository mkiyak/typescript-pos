import type { IyzicoPosCrypt } from '../../../crypt/IyzicoPosCrypt.js'
import {
  NotImplementedError,
  PosError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../../../errors.js'
import type { IyzicoPosAccount } from '../../../model/account/IyzicoPosAccount.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { LANG, type Lang, MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosHooks, PosOrder, ThreeDFormData } from '../../../types.js'
import { ownValue } from '../../../util/ownValue.js'
import { isSet } from '../../../util/required.js'
import type { IyzicoPosRequestValueFormatter } from '../value-formatter/IyzicoPosRequestValueFormatter.js'
import type { IyzicoPosRequestValueMapper } from '../value-mapper/IyzicoPosRequestValueMapper.js'
import { AbstractRequestDataMapper } from './AbstractRequestDataMapper.js'
import {
  asOrder,
  hasControlCharacters,
  iyzicoAddress,
  iyzicoBasketItems,
  iyzicoBuyer,
  iyzicoOrderCurrency,
  iyzicoOrderId,
  iyzicoOrderInstallment,
  iyzicoOrderIp,
  iyzicoOrderKurus,
  iyzicoPaymentId,
} from './iyzicoOrderFields.js'

const GATEWAY_CLASS = 'IyzicoPos'

const URL_PATTERN = /^https?:\/\/[\x21-\x7E]+$/i
const TOKEN_PATTERN = /^[A-Za-z0-9-]{1,128}$/

const MAX_URL = 400
const MAX_CARD_HOLDER = 100
const PAYMENT_CHANNELS: readonly string[] = [
  'WEB',
  'MOBILE',
  'MOBILE_WEB',
  'MOBILE_IOS',
  'MOBILE_ANDROID',
  'MOBILE_WINDOWS',
  'MOBILE_TABLET',
  'MOBILE_PHONE',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Creates request data for iyzico. The bodies are signed by the HTTP client over the bytes it sends, never here. */
export class IyzicoPosRequestDataMapper extends AbstractRequestDataMapper<IyzicoPosAccount> {
  constructor(
    protected override readonly valueMapper: IyzicoPosRequestValueMapper,
    protected override readonly valueFormatter: IyzicoPosRequestValueFormatter,
    hooks: PosHooks,
    protected override readonly crypt: IyzicoPosCrypt,
    defaultLang: Lang = LANG.TR,
  ) {
    super(valueMapper, valueFormatter, hooks, crypt, defaultLang)
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === GATEWAY_CLASS
  }

  async create3DFormData(
    _account: IyzicoPosAccount,
    _order: PosOrder | null,
    _paymentModel: PaymentModel,
    _txType: TxType,
    _gatewayURL: string,
    _creditCard: CreditCard | null = null,
    _extraData: Record<string, unknown> | null = null,
  ): Promise<ThreeDFormData | string> {
    throw new NotImplementedError('iyzico builds the 3D form from the initialize answer, not from request data.')
  }

  /** The body of the 3D Secure or Checkout Form initialize request. */
  override create3DFormInitializeRequestData(
    account: IyzicoPosAccount,
    order: PosOrder,
    paymentModel: PaymentModel,
    txType: TxType,
    creditCard: CreditCard | null = null,
  ): Record<string, unknown> {
    this.assertPayment(txType)
    if (paymentModel !== MODEL.THREE_D_SECURE && paymentModel !== MODEL.THREE_D_HOST) {
      throw new UnsupportedPaymentModelError(`Unsupported payment model: ${String(paymentModel)}`)
    }
    if (paymentModel === MODEL.THREE_D_SECURE && (creditCard === null || creditCard === undefined)) {
      throw new PosError('iyzico 3D Secure needs the card')
    }
    return this.paymentBody(account, order, paymentModel, creditCard)
  }

  /**
   * The 3D Secure authorization request. Only the payment id comes from the callback; the conversation id, basket
   * id and amount are the order's, so the bank refuses a payment id that was started for anything else.
   */
  create3DPaymentRequestData(
    _account: IyzicoPosAccount,
    order: PosOrder,
    txType: TxType,
    responseData: Record<string, unknown>,
  ): Record<string, unknown> {
    this.assertPayment(txType)
    const orderId = iyzicoOrderId(order)
    const kurus = iyzicoOrderKurus(order)
    const currency = this.currency(order)
    const callbackPaymentId: unknown = isRecord(responseData) ? ownValue(responseData, 'paymentId') : undefined
    if (typeof callbackPaymentId !== 'string') {
      throw new PosError('The 3D callback carries no payment id')
    }

    return {
      locale: this.getLang(order),
      conversationId: orderId,
      paymentId: iyzicoPaymentId(callbackPaymentId, 'The 3D callback payment id'),
      paidPrice: this.valueFormatter.formatAmount(kurus / 100),
      basketId: orderId,
      currency,
    }
  }

  createNonSecurePaymentRequestData(
    account: IyzicoPosAccount,
    order: PosOrder,
    txType: TxType,
    creditCard: CreditCard,
  ): Record<string, unknown> {
    this.assertPayment(txType)
    if (creditCard === null || creditCard === undefined) {
      throw new PosError('A credit card is required for this transaction.')
    }
    return this.paymentBody(account, order, MODEL.NON_SECURE, creditCard)
  }

  createNonSecurePostAuthPaymentRequestData(_account: IyzicoPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = iyzicoOrderId(order)
    const paymentId = this.transactionId(order)
    const kurus = iyzicoOrderKurus(order)
    const currency = this.currency(order)
    const ip = iyzicoOrderIp(order)

    return {
      locale: this.getLang(order),
      conversationId: orderId,
      paymentId,
      paidPrice: this.valueFormatter.formatAmount(kurus / 100),
      ...(ip === null ? {} : { ip }),
      currency,
    }
  }

  createStatusRequestData(_account: IyzicoPosAccount, order: PosOrder): Record<string, unknown> {
    return this.lookupBody(order)
  }

  createCancelRequestData(_account: IyzicoPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = iyzicoOrderId(order)
    const paymentId = this.transactionId(order)
    const ip = iyzicoOrderIp(order)

    return {
      locale: this.getLang(order),
      conversationId: orderId,
      paymentId,
      ...(ip === null ? {} : { ip }),
    }
  }

  createRefundRequestData(_account: IyzicoPosAccount, order: PosOrder, refundTxType: TxType): Record<string, unknown> {
    if (refundTxType !== TX_TYPE.REFUND && refundTxType !== TX_TYPE.REFUND_PARTIAL) {
      // Every other type is another operation; a refund request must never become a sale.
      throw new UnsupportedTransactionTypeError(`Unsupported refund transaction type: ${String(refundTxType)}`)
    }
    const orderId = iyzicoOrderId(order)
    const paymentId = this.transactionId(order)
    const kurus = iyzicoOrderKurus(order)
    const currency = this.currency(order)
    const ip = iyzicoOrderIp(order)

    return {
      locale: this.getLang(order),
      conversationId: orderId,
      paymentId,
      price: this.valueFormatter.formatAmount(kurus / 100),
      currency,
      ...(ip === null ? {} : { ip }),
    }
  }

  createOrderHistoryRequestData(_account: IyzicoPosAccount, order: PosOrder): Record<string, unknown> {
    return this.lookupBody(order)
  }

  /** The Checkout Form retrieve request; the token is the callback's own text in iyzico's token alphabet. */
  create3DHostPaymentStatusRequestData(
    responseData: Record<string, unknown>,
    order: PosOrder,
  ): Record<string, unknown> {
    const orderId = iyzicoOrderId(order)
    const token: unknown = isRecord(responseData) ? ownValue(responseData, 'token') : undefined
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
      throw new PosError('The 3D Host callback carries no valid token')
    }

    return { locale: this.getLang(order), conversationId: orderId, token }
  }

  /** Status and history take the payment id, the order id or both. */
  private lookupBody(order: PosOrder): Record<string, unknown> {
    const hasId = isSet(ownValue(asOrder(order), 'id'))
    const hasTransaction = isSet(ownValue(asOrder(order), 'transaction_id'))
    if (!hasId && !hasTransaction) {
      throw new PosError('Order id or transaction id is required')
    }
    const body: Record<string, unknown> = { locale: this.getLang(order) }
    if (hasTransaction) {
      body.paymentId = this.transactionId(order)
    }
    if (hasId) {
      const orderId = iyzicoOrderId(order)
      body.paymentConversationId = orderId
      body.conversationId = orderId
    }
    return body
  }

  private transactionId(order: PosOrder): string {
    return iyzicoPaymentId(ownValue(asOrder(order), 'transaction_id'), 'Order field "transaction_id"')
  }

  private currency(order: PosOrder): string {
    return iyzicoOrderCurrency(order, this.valueMapper)
  }

  /**
   * The payment body shared by the direct payment and both initialize requests, in iyzico's documented key order.
   * Everything is validated before anything is built, and the basket must add up to the order amount.
   */
  private paymentBody(
    account: IyzicoPosAccount,
    order: PosOrder,
    paymentModel: PaymentModel,
    creditCard: CreditCard | null,
  ): Record<string, unknown> {
    const orderId = iyzicoOrderId(order)
    const kurus = iyzicoOrderKurus(order)
    const currency = this.currency(order)
    const installment = iyzicoOrderInstallment(order)
    const items = iyzicoBasketItems(order, kurus)
    const buyer = iyzicoBuyer(order)
    const billing = iyzicoAddress(order, 'billing_address', true)
    const shipping = iyzicoAddress(
      order,
      'shipping_address',
      items.some((item) => item.itemType === 'PHYSICAL'),
    )
    const amount = this.valueFormatter.formatAmount(kurus / 100)

    const body: Record<string, unknown> = {
      locale: this.getLang(order),
      conversationId: orderId,
      basketId: orderId,
      price: amount,
      paidPrice: amount,
      currency,
      paymentGroup: 'PRODUCT',
      buyer,
      ...(shipping === null ? {} : { shippingAddress: shipping }),
      billingAddress: billing,
      basketItems: items,
    }

    // Hosted checkout takes the card on iyzico's page: card data is never part of that request.
    if (paymentModel !== MODEL.THREE_D_HOST && creditCard !== null && creditCard !== undefined) {
      body.paymentCard = this.paymentCard(creditCard)
    }

    if (paymentModel !== MODEL.NON_SECURE) {
      body.callbackUrl = this.callbackUrl(order)
    }

    if (paymentModel !== MODEL.THREE_D_HOST) {
      body.paymentChannel = this.paymentChannel(order)
      body.installment = this.valueFormatter.formatInstallment(installment)
    } else {
      body.forceThreeDS = 1
      body.enabledInstallments = this.enabledInstallments(order)
    }

    const subMerchantKey = account.getSubMerchantId()
    if (subMerchantKey !== null) {
      body.subMerchantKey = subMerchantKey
    }

    return body
  }

  private paymentCard(card: CreditCard): Record<string, unknown> {
    const holder = card.getHolderName()
    if (holder === null || holder.trim() === '' || holder.length > MAX_CARD_HOLDER || hasControlCharacters(holder)) {
      throw new PosError(`The card holder name is required (text of at most ${MAX_CARD_HOLDER} characters)`)
    }
    return {
      cardHolderName: holder,
      cardNumber: card.getNumber(),
      expireMonth: this.valueFormatter.formatCardExpDate(card, 'expireMonth'),
      expireYear: this.valueFormatter.formatCardExpDate(card, 'expireYear'),
      cvc: card.getCvv(),
      registerCard: 0,
    }
  }

  private callbackUrl(order: PosOrder): string {
    const url: unknown = ownValue(asOrder(order), 'success_url')
    if (typeof url !== 'string' || url.length > MAX_URL || !URL_PATTERN.test(url)) {
      throw new PosError('Order field "success_url" must be an http(s) URL without blanks or non-ASCII characters.')
    }
    return url
  }

  private paymentChannel(order: PosOrder): string {
    const channel: unknown = ownValue(asOrder(order), 'payment_channel') ?? 'WEB'
    if (typeof channel !== 'string' || !PAYMENT_CHANNELS.includes(channel)) {
      throw new PosError('Order field "payment_channel" is not a payment channel iyzico knows')
    }
    return channel
  }

  private enabledInstallments(order: PosOrder): number[] {
    const raw: unknown = ownValue(asOrder(order), 'enabled_installments') ?? []
    if (
      !Array.isArray(raw) ||
      raw.some((n: unknown) => typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 12) ||
      new Set(raw).size !== raw.length
    ) {
      throw new PosError('Order field "enabled_installments" must list distinct installment counts from 1 to 12')
    }
    return [...(raw as number[])]
  }

  private assertPayment(txType: TxType): void {
    if (txType !== TX_TYPE.PAY_AUTH && txType !== TX_TYPE.PAY_PRE_AUTH) {
      throw new UnsupportedTransactionTypeError(`Unsupported transaction type: ${String(txType)}`)
    }
  }
}
