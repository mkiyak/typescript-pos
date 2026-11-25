import { isIP } from 'node:net'
import type { PayTrPosCrypt } from '../../../crypt/PayTrPosCrypt.js'
import {
  NotImplementedError,
  PosError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../../../errors.js'
import type { PayTrPosAccount } from '../../../model/account/PayTrPosAccount.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import {
  CURRENCY,
  type Currency,
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
import { parseOrderAmount } from '../../../util/parseOrderAmount.js'
import { isSet } from '../../../util/required.js'
import type { PayTrPosRequestValueFormatter } from '../value-formatter/PayTrPosRequestValueFormatter.js'
import type { PayTrPosRequestValueMapper } from '../value-mapper/PayTrPosRequestValueMapper.js'
import { AbstractRequestDataMapper } from './AbstractRequestDataMapper.js'
import { payTrBasketJson } from './payTrBasket.js'

const GATEWAY_CLASS = 'PayTrPos'

/** Order ids are signed and posted as plain ASCII: a letter or digit first, then letters, digits, `_` and `-`, at most 64. */
const ORDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const IP_PATTERN = /^[0-9A-Fa-f.:]{2,39}$/
const EMAIL_PATTERN = /^[\x21-\x7E]+$/
const URL_PATTERN = /^https?:\/\/[\x21-\x7E]+$/i
const HTTPS_BASE_PATTERN = /^https:\/\/[\x21-\x7E]+$/i
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{1,512}$/
const REFERENCE_PATTERN = /^[A-Za-z0-9]{1,64}$/
// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to find control characters
const CONTROL_CHARACTERS = /[\x00-\x1F\x7F]/

const MAX_INSTALLMENT = 12
const MAX_EMAIL = 100
const MAX_NAME = 60
const MAX_ADDRESS = 400
const MAX_PHONE = 20
const MAX_URL = 400
const MAX_CARD_HOLDER = 50

const CURRENCIES: readonly string[] = [CURRENCY.TRY, CURRENCY.USD, CURRENCY.EUR, CURRENCY.GBP, CURRENCY.RUB]

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The order values every PayTR request depends on, validated. */
export interface PayTrOrderCore {
  orderId: string
  amount: number
  currency: Currency
  installment: number
}

/** The order values of a payment request, validated. */
export interface PayTrOrderFields extends PayTrOrderCore {
  ip: string
  email: string
  name: string
  address: string
  phone: string
}

/** The order id: text or a finite number that reads as letters, digits, `_` and `-`, starting with a letter or digit. */
export function payTrOrderId(order: PosOrder): string {
  const raw: unknown = isRecord(order) ? ownValue(order, 'id') : undefined
  if (raw === undefined || raw === null || raw === '') {
    throw new PosError('Order field "id" is required')
  }
  if (typeof raw !== 'string' && !(typeof raw === 'number' && Number.isFinite(raw))) {
    throw new PosError('The order id must be text or a number.')
  }
  const id = String(raw)
  if (!ORDER_ID_PATTERN.test(id)) {
    throw new PosError(
      'The order id may only hold letters, digits, underscores and hyphens, and must start with a letter or digit (at most 64).',
    )
  }
  return id
}

/** The order amount as a number the formatter accepts; a missing or unreadable amount never gets further. */
export function payTrOrderAmount(order: PosOrder): number {
  const raw: unknown = isRecord(order) ? ownValue(order, 'amount') : undefined
  if (raw === undefined || raw === null || raw === '') {
    throw new PosError('Order field "amount" is required')
  }
  const amount = parseOrderAmount(raw)
  if (Number.isNaN(amount)) {
    throw new PosError('The order amount must be a number.')
  }
  return amount
}

/**
 * Order id, amount, currency and installment count, validated without building anything. The amount is checked for
 * the kuruş range by the formatter when it is formatted; here it only has to be readable.
 */
export function payTrOrderCore(order: PosOrder): PayTrOrderCore {
  const orderId = payTrOrderId(order)
  const amount = payTrOrderAmount(order)

  const rawCurrency: unknown = ownValue(order as Record<string, unknown>, 'currency') ?? CURRENCY.TRY
  if (typeof rawCurrency !== 'string' || !CURRENCIES.includes(rawCurrency)) {
    throw new PosError('The order currency is not supported by PayTR.')
  }

  const installment = parseInstallment(ownValue(order as Record<string, unknown>, 'installment') ?? 0)
  if (installment > MAX_INSTALLMENT) {
    throw new PosError(`The installment count must be 0 or from 2 to ${MAX_INSTALLMENT}.`)
  }

  return { orderId, amount, currency: rawCurrency as Currency, installment }
}

function plainText(value: unknown, what: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max || CONTROL_CHARACTERS.test(value)) {
    throw new PosError(`${what} is required (text of at most ${max} characters)`)
  }
  return value
}

function ownRecord(order: PosOrder, key: string): Record<string, unknown> {
  const value: unknown = ownValue(order as Record<string, unknown>, key)
  if (!isRecord(value)) {
    throw new PosError(`Order field "${key}" is required`)
  }
  return value
}

/**
 * Everything a payment request needs from the order: the core values plus the buyer's address, e-mail, name and
 * phone and the client IP, all of which PayTR requires. A missing or unusable value is an error; nothing is ever
 * sent or signed empty.
 */
export function payTrOrderFields(order: PosOrder): PayTrOrderFields {
  const core = payTrOrderCore(order)

  const ip: unknown = ownValue(order as Record<string, unknown>, 'ip')
  if (typeof ip !== 'string' || !IP_PATTERN.test(ip) || isIP(ip) === 0) {
    throw new PosError('Order field "ip" must be the payer\'s IPv4 or IPv6 address')
  }

  const buyer = ownRecord(order, 'buyer')
  const email: unknown = ownValue(buyer, 'email')
  if (
    typeof email !== 'string' ||
    email.length > MAX_EMAIL ||
    !EMAIL_PATTERN.test(email) ||
    email.split('@').length !== 2 ||
    email.startsWith('@') ||
    email.endsWith('@')
  ) {
    throw new PosError(
      'Order field "buyer.email" must be an e-mail address in printable ASCII (at most 100 characters)',
    )
  }
  const name = plainText(ownValue(buyer, 'name'), 'Order field "buyer.name"', MAX_NAME)
  const phone = plainText(ownValue(buyer, 'gsm_number'), 'Order field "buyer.gsm_number"', MAX_PHONE)
  const address = plainText(
    ownValue(ownRecord(order, 'billing_address'), 'address'),
    'Order field "billing_address.address"',
    MAX_ADDRESS,
  )

  return { ...core, ip, email, name, address, phone }
}

/** Creates request data for PayTR. */
export class PayTrPosRequestDataMapper extends AbstractRequestDataMapper<PayTrPosAccount> {
  constructor(
    protected override readonly valueMapper: PayTrPosRequestValueMapper,
    protected override readonly valueFormatter: PayTrPosRequestValueFormatter,
    hooks: PosHooks,
    protected override readonly crypt: PayTrPosCrypt,
    defaultLang: Lang = LANG.TR,
  ) {
    super(valueMapper, valueFormatter, hooks, crypt, defaultLang)
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === GATEWAY_CLASS
  }

  /**
   * The server-to-server token request of the iFrame API (3D Host). The token covers the values in this order and
   * is computed over exactly the body that is sent.
   */
  override create3DFormInitializeRequestData(
    account: PayTrPosAccount,
    order: PosOrder,
    paymentModel: PaymentModel,
    txType: TxType,
    _creditCard: CreditCard | null = null,
  ): Record<string, unknown> {
    this.assertSale(txType)
    if (paymentModel !== MODEL.THREE_D_HOST) {
      throw new UnsupportedPaymentModelError(`Unsupported payment model: ${String(paymentModel)}`)
    }
    const fields = payTrOrderFields(order)
    const okUrl = this.returnUrl(order, 'success_url')
    const failUrl = this.returnUrl(order, 'fail_url')
    const installment = this.valueFormatter.formatInstallment(fields.installment)

    const requestData: Record<string, unknown> = {
      merchant_id: account.getMerchantId(),
      user_ip: fields.ip,
      merchant_oid: fields.orderId,
      email: fields.email,
      payment_amount: this.valueFormatter.formatAmount(fields.amount, TX_TYPE.INTERNAL_3D_FORM_BUILD),
      currency: this.valueMapper.mapCurrency(fields.currency),
      no_installment: installment === 0 ? 1 : 0,
      max_installment: installment,
      test_mode: this.testMode ? 1 : 0,
      lang: this.getLang(order),
      user_basket: Buffer.from(this.basket(order, fields), 'utf8').toString('base64'),
      merchant_ok_url: okUrl,
      merchant_fail_url: failUrl,
      user_name: fields.name,
      user_address: fields.address,
      user_phone: fields.phone,
    }

    return { ...requestData, paytr_token: this.crypt.createHash(account, requestData) }
  }

  /** The Direct API body of a sale made with the card held by the merchant (synchronous answer). */
  createNonSecurePaymentRequestData(
    account: PayTrPosAccount,
    order: PosOrder,
    txType: TxType,
    creditCard: CreditCard,
  ): Record<string, unknown> {
    this.assertSale(txType)
    const requestData = this.directData(account, order, MODEL.NON_SECURE, creditCard)

    return { ...requestData, paytr_token: this.crypt.createHash(account, requestData) }
  }

  create3DPaymentRequestData(
    _account: PayTrPosAccount,
    _order: PosOrder,
    _txType: TxType,
    _responseData: Record<string, unknown>,
  ): Record<string, unknown> {
    throw new NotImplementedError(
      'PayTR reports the payment result to the notification URL; there is no 3D provision request.',
    )
  }

  createNonSecurePostAuthPaymentRequestData(_account: PayTrPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new NotImplementedError('PayTR does not support post-authorization.')
  }

  createStatusRequestData(account: PayTrPosAccount, order: PosOrder): Record<string, unknown> {
    const requestData = { merchant_id: account.getMerchantId(), merchant_oid: payTrOrderId(order) }

    return { ...requestData, paytr_token: this.crypt.createHash(account, requestData) }
  }

  createCancelRequestData(_account: PayTrPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new NotImplementedError('PayTR does not support cancel; use refund.')
  }

  /**
   * The refund request. `reference_no` (optional, own text of letters and digits) is sent after the token: it is not
   * signed, and lets the merchant find this refund in the status answer later.
   */
  createRefundRequestData(account: PayTrPosAccount, order: PosOrder, refundTxType: TxType): Record<string, unknown> {
    if (refundTxType !== TX_TYPE.REFUND && refundTxType !== TX_TYPE.REFUND_PARTIAL) {
      // Every other type is another operation; a refund request must never become a sale.
      throw new UnsupportedTransactionTypeError(`Unsupported refund transaction type: ${String(refundTxType)}`)
    }
    const orderId = payTrOrderId(order)
    const returnAmount = this.valueFormatter.formatAmount(payTrOrderAmount(order))
    const referenceNo = this.referenceNo(order)

    const requestData = {
      merchant_id: account.getMerchantId(),
      merchant_oid: orderId,
      return_amount: returnAmount,
    }
    const signed = { ...requestData, paytr_token: this.crypt.createHash(account, requestData) }

    return referenceNo === null ? signed : { ...signed, reference_no: referenceNo }
  }

  createOrderHistoryRequestData(_account: PayTrPosAccount, _order: PosOrder): Record<string, unknown> {
    throw new NotImplementedError('PayTR order history is available through the query API.')
  }

  /**
   * What the payer's browser is sent to. 3D Host: a plain GET to the PayTR payment page of the token obtained from
   * the iFrame token request (`extraData.token`). 3D Pay: a POST form for the Direct API; with a card the card
   * fields are included, without one the payer's browser adds them on the page that posts the form (the token
   * never covers card data), so card details go from the browser straight to PayTR.
   */
  async create3DFormData(
    account: PayTrPosAccount,
    order: PosOrder | null,
    paymentModel: PaymentModel,
    txType: TxType,
    gatewayURL: string,
    creditCard: CreditCard | null = null,
    extraData: Record<string, unknown> | null = null,
  ): Promise<ThreeDFormData> {
    this.assertSale(txType)
    if (paymentModel !== MODEL.THREE_D_HOST && paymentModel !== MODEL.THREE_D_PAY) {
      throw new UnsupportedPaymentModelError(`Unsupported payment model for the 3D form: ${String(paymentModel)}`)
    }
    if (typeof gatewayURL !== 'string' || !HTTPS_BASE_PATTERN.test(gatewayURL) || /[?#]/.test(gatewayURL)) {
      throw new PosError('The 3D form address must be an https URL without query or fragment.')
    }

    if (paymentModel === MODEL.THREE_D_HOST) {
      const token: unknown = isRecord(extraData) ? ownValue(extraData, 'token') : undefined
      if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
        throw new PosError('3D form could not be created: invalid token')
      }
      return { gateway: `${gatewayURL}/${token}`, method: 'GET', inputs: {} }
    }

    if (order === null || order === undefined) {
      throw new PosError('The order is required to build the 3D form.')
    }
    const data = this.directData(account, order, MODEL.THREE_D_PAY, creditCard)
    let inputs: Record<string, string> = {}
    for (const [key, value] of Object.entries(data)) {
      inputs[key] = String(value)
    }
    inputs = await this.dispatchBefore3DFormHashCalculated(
      inputs,
      account.getBankName(),
      txType,
      paymentModel,
      GATEWAY_CLASS,
    )

    return {
      gateway: gatewayURL,
      method: 'POST',
      inputs: { ...inputs, paytr_token: this.crypt.create3DHash(account, inputs) },
    }
  }

  /**
   * The Direct API fields in the order PayTR documents them. A given card adds its five fields; without one (3D Pay
   * only) they are left out for the payer's browser to add.
   */
  private directData(
    account: PayTrPosAccount,
    order: PosOrder,
    paymentModel: PaymentModel,
    creditCard: CreditCard | null,
  ): Record<string, unknown> {
    const secure = paymentModel !== MODEL.NON_SECURE
    const hasCard = creditCard !== null && creditCard !== undefined
    if (!secure && !hasCard) {
      throw new PosError('A credit card is required for this transaction.')
    }
    const fields = payTrOrderFields(order)
    const okUrl = secure ? this.returnUrl(order, 'success_url') : null
    const failUrl = secure ? this.returnUrl(order, 'fail_url') : null
    const flag = secure ? 0 : 1
    const testFlag = this.testMode ? 1 : 0

    const data: Record<string, unknown> = {
      merchant_id: account.getMerchantId(),
      user_ip: fields.ip,
      merchant_oid: fields.orderId,
      email: fields.email,
      payment_amount: this.valueFormatter.formatAmount(fields.amount),
      installment_count: this.valueFormatter.formatInstallment(fields.installment),
      currency: this.valueMapper.mapCurrency(fields.currency),
      non_3d: flag,
      sync_mode: flag,
      user_name: fields.name,
      user_address: fields.address,
      user_phone: fields.phone,
      test_mode: testFlag,
      debug_on: testFlag,
      client_lang: this.getLang(order),
      // The Direct API takes the basket as plain JSON; only the iFrame token request base64-encodes it.
      user_basket: this.basket(order, fields),
      payment_type: 'card',
    }

    if (hasCard) {
      const holder = creditCard.getHolderName()
      if (
        holder === null ||
        holder.trim() === '' ||
        holder.length > MAX_CARD_HOLDER ||
        CONTROL_CHARACTERS.test(holder)
      ) {
        throw new PosError(`The card holder name is required (text of at most ${MAX_CARD_HOLDER} characters)`)
      }
      data.cc_owner = holder
      data.card_number = creditCard.getNumber()
      data.expiry_month = this.valueFormatter.formatCardExpDate(creditCard, 'expiry_month')
      data.expiry_year = this.valueFormatter.formatCardExpDate(creditCard, 'expiry_year')
      data.cvv = creditCard.getCvv()
    }

    if (okUrl !== null && failUrl !== null) {
      data.merchant_ok_url = okUrl
      data.merchant_fail_url = failUrl
    }

    return data
  }

  /** The basket text for the amount that is charged (the two-decimal amount, as a number). */
  private basket(order: PosOrder, fields: PayTrOrderFields): string {
    return payTrBasketJson(order, fields.orderId, Number(this.valueFormatter.formatAmount(fields.amount)))
  }

  private returnUrl(order: PosOrder, key: 'success_url' | 'fail_url'): string {
    const url: unknown = ownValue(order as Record<string, unknown>, key)
    if (typeof url !== 'string' || url.length > MAX_URL || !URL_PATTERN.test(url)) {
      throw new PosError(`Order field "${key}" must be an http(s) URL without blanks or non-ASCII characters.`)
    }
    return url
  }

  private referenceNo(order: PosOrder): string | null {
    const value: unknown = ownValue(order as Record<string, unknown>, 'reference_no')
    if (!isSet(value)) {
      return null
    }
    if (typeof value !== 'string' || !REFERENCE_PATTERN.test(value)) {
      throw new PosError('Order field "reference_no" must be 1 to 64 letters or digits')
    }
    return value
  }

  private assertSale(txType: TxType): void {
    if (txType !== TX_TYPE.PAY_AUTH) {
      throw new UnsupportedTransactionTypeError(`Unsupported transaction type: ${String(txType)}`)
    }
  }
}
