import type { ToslaPosCrypt } from '../../../crypt/ToslaPosCrypt.js'
import {
  NotImplementedError,
  PosError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../../../errors.js'
import type { ToslaPosAccount } from '../../../model/account/ToslaPosAccount.js'
import type { CreditCard } from '../../../model/card/CreditCard.js'
import { CURRENCY, LANG, type Lang, MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosHooks, PosOrder, ThreeDFormData } from '../../../types.js'
import { ownValue } from '../../../util/ownValue.js'
import { parseInstallment } from '../../../util/parseInstallment.js'
import { parseOrderAmount } from '../../../util/parseOrderAmount.js'
import { isSet, required } from '../../../util/required.js'
import type { ToslaPosRequestValueFormatter } from '../value-formatter/ToslaPosRequestValueFormatter.js'
import type { ToslaPosRequestValueMapper } from '../value-mapper/ToslaPosRequestValueMapper.js'
import { AbstractRequestDataMapper } from './AbstractRequestDataMapper.js'

/** Order ids are signed and posted as plain ASCII: a letter or digit first, then letters, digits, `_` and `-`, at most 64. */
const ORDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** The one callback URL of the order: http(s) and printable ASCII only, so it cannot smuggle blanks or other schemes. */
const CALLBACK_URL_PATTERN = /^https?:\/\/[\x21-\x7E]+$/i

/** The bank's 3D session id becomes a URL path segment and a form value, so it is held to letters and digits. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9]{1,128}$/

/**
 * Creates request data for Tosla. Every request starts with the account (`clientId`, `apiUser`), carries the body
 * fields and ends with `hash`; the hash covers only the account, a random value and the time span (see the crypt).
 */
export class ToslaPosRequestDataMapper extends AbstractRequestDataMapper<ToslaPosAccount> {
  constructor(
    protected override readonly valueMapper: ToslaPosRequestValueMapper,
    protected override readonly valueFormatter: ToslaPosRequestValueFormatter,
    hooks: PosHooks,
    protected override readonly crypt: ToslaPosCrypt,
    defaultLang: Lang = LANG.TR,
  ) {
    super(valueMapper, valueFormatter, hooks, crypt, defaultLang)
  }

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'ToslaPos'
  }

  /** The request that opens a 3D session; the answer carries the session id the payer's browser is sent to. */
  override create3DFormInitializeRequestData(
    account: ToslaPosAccount,
    order: PosOrder,
    paymentModel: PaymentModel,
    txType: TxType,
    _creditCard: CreditCard | null = null,
  ): Record<string, unknown> {
    this.assertSaleTxType(txType)
    if (paymentModel !== MODEL.THREE_D_PAY && paymentModel !== MODEL.THREE_D_HOST) {
      throw new UnsupportedPaymentModelError(`Unsupported payment model: ${String(paymentModel)}`)
    }
    const callbackUrl = this.callbackUrl(order)
    const orderId = this.orderId(order)
    const amount = this.orderAmount(order)
    const currency = this.currency(order)
    const installmentCount = this.installment(order)
    const timeSpan = this.timeSpan(order)

    return this.sign(account, {
      ...this.accountData(account),
      callbackUrl,
      orderId,
      amount,
      currency,
      installmentCount,
      rnd: this.crypt.generateRandomString(),
      timeSpan,
    })
  }

  create3DPaymentRequestData(
    _account: ToslaPosAccount,
    _order: PosOrder,
    _txType: TxType,
    _responseData: Record<string, unknown>,
  ): Record<string, unknown> {
    throw new NotImplementedError('Tosla has no separate 3D provision request.')
  }

  createNonSecurePaymentRequestData(
    account: ToslaPosAccount,
    order: PosOrder,
    txType: TxType,
    creditCard: CreditCard,
  ): Record<string, unknown> {
    this.assertSaleTxType(txType)
    const orderId = this.orderId(order)
    const amount = this.orderAmount(order)
    const currency = this.currency(order)
    const installmentCount = this.installment(order)
    const timeSpan = this.timeSpan(order)

    return this.sign(account, {
      ...this.accountData(account),
      orderId,
      amount,
      currency,
      installmentCount,
      rnd: this.crypt.generateRandomString(),
      timeSpan,
      cardHolderName: creditCard.getHolderName() ?? '',
      cardNo: creditCard.getNumber(),
      expireDate: this.valueFormatter.formatCardExpDate(creditCard, 'expireDate'),
      cvv: creditCard.getCvv(),
    })
  }

  createNonSecurePostAuthPaymentRequestData(account: ToslaPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = this.orderId(order)
    const amount = this.orderAmount(order)
    const timeSpan = this.timeSpan(order)

    return this.sign(account, {
      ...this.accountData(account),
      orderId,
      amount,
      rnd: this.crypt.generateRandomString(),
      timeSpan,
    })
  }

  createStatusRequestData(account: ToslaPosAccount, order: PosOrder): Record<string, unknown> {
    return this.orderOnlyRequest(account, order)
  }

  createCancelRequestData(account: ToslaPosAccount, order: PosOrder): Record<string, unknown> {
    return this.orderOnlyRequest(account, order)
  }

  createRefundRequestData(account: ToslaPosAccount, order: PosOrder, refundTxType: TxType): Record<string, unknown> {
    if (refundTxType !== TX_TYPE.REFUND && refundTxType !== TX_TYPE.REFUND_PARTIAL) {
      // Every other type is another bank operation; a refund request must never become a sale or a cancel.
      throw new UnsupportedTransactionTypeError(`Unsupported refund transaction type: ${String(refundTxType)}`)
    }
    const orderId = this.orderId(order)
    const amount = this.orderAmount(order)
    const timeSpan = this.timeSpan(order)

    return this.sign(account, {
      ...this.accountData(account),
      orderId,
      rnd: this.crypt.generateRandomString(),
      amount,
      timeSpan,
    })
  }

  createOrderHistoryRequestData(account: ToslaPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = this.orderId(order)
    const transactionDate = this.valueFormatter.formatDateTime(
      this.date(order, 'transaction_date', true),
      'transactionDate',
    )
    const page = this.positiveInteger(order, 'page', 1)
    const pageSize = this.positiveInteger(order, 'page_size', 10)
    const timeSpan = this.timeSpan(order)

    return this.sign(account, {
      ...this.accountData(account),
      orderId,
      transactionDate,
      page,
      pageSize,
      rnd: this.crypt.generateRandomString(),
      timeSpan,
    })
  }

  /**
   * What the payer's browser is sent to after the session was registered. `order` is the bank's registration answer:
   * its `ThreeDSessionId` is checked again here because it becomes a URL path segment (3D Host) or a form value (3D
   * Pay). The 3D Host page is a plain GET; the 3D Pay form carries the card only when one is given (a form without a
   * card lets the payer type it on the page that posts it).
   */
  async create3DFormData(
    _account: ToslaPosAccount,
    order: PosOrder | null,
    paymentModel: PaymentModel,
    txType: TxType,
    gatewayURL: string,
    creditCard: CreditCard | null = null,
  ): Promise<ThreeDFormData> {
    this.assertSaleTxType(txType)
    if (paymentModel !== MODEL.THREE_D_PAY && paymentModel !== MODEL.THREE_D_HOST) {
      throw new UnsupportedPaymentModelError(`Unsupported payment model for the 3D form: ${String(paymentModel)}`)
    }
    const sessionId: unknown = order === null || order === undefined ? undefined : ownValue(order, 'ThreeDSessionId')
    if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
      throw new PosError('3D session id is missing or malformed')
    }

    if (paymentModel === MODEL.THREE_D_HOST) {
      return { gateway: `${gatewayURL}/${sessionId}`, method: 'GET', inputs: {} }
    }

    const inputs: Record<string, string> = { ThreeDSessionId: sessionId }
    if (creditCard !== null && creditCard !== undefined) {
      inputs.CardHolderName = creditCard.getHolderName() ?? ''
      inputs.CardNo = creditCard.getNumber()
      inputs.ExpireDate = this.valueFormatter.formatCardExpDate(creditCard, 'ExpireDate')
      inputs.Cvv = creditCard.getCvv()
    }

    return { gateway: gatewayURL, method: 'POST', inputs }
  }

  /** Status and cancel send nothing but the order id. */
  private orderOnlyRequest(account: ToslaPosAccount, order: PosOrder): Record<string, unknown> {
    const orderId = this.orderId(order)
    const timeSpan = this.timeSpan(order)

    return this.sign(account, {
      ...this.accountData(account),
      orderId,
      rnd: this.crypt.generateRandomString(),
      timeSpan,
    })
  }

  /** Appends the hash last; it is computed over the request as it stands without it. */
  private sign(account: ToslaPosAccount, data: Record<string, unknown>): Record<string, unknown> {
    return { ...data, hash: this.crypt.createHash(account, data) }
  }

  private accountData(account: ToslaPosAccount): { clientId: string; apiUser: string } {
    return { clientId: account.getMerchantId(), apiUser: account.getUsername() }
  }

  private assertSaleTxType(txType: TxType): void {
    if (txType !== TX_TYPE.PAY_AUTH && txType !== TX_TYPE.PAY_PRE_AUTH) {
      throw new UnsupportedTransactionTypeError(`Unsupported transaction type: ${String(txType)}`)
    }
  }

  private orderId(order: PosOrder): string {
    const raw: unknown = this.ownField(order, 'id')
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

  /** The amount in kuruş; a missing, non-numeric, zero, negative or sub-kuruş amount never reaches the bank. */
  private orderAmount(order: PosOrder): number {
    return this.valueFormatter.formatAmount(parseOrderAmount(this.ownField(order, 'amount')))
  }

  private installment(order: PosOrder): number {
    return this.valueFormatter.formatInstallment(parseInstallment(this.ownValueOf(order, 'installment')))
  }

  private currency(order: PosOrder): number {
    const currency: unknown = this.ownValueOf(order, 'currency') ?? CURRENCY.TRY
    if (typeof currency !== 'string') {
      throw new PosError('The order currency must be text.')
    }
    return this.valueMapper.mapCurrency(currency as never)
  }

  private callbackUrl(order: PosOrder): string {
    const url: unknown = this.ownField(order, 'success_url')
    if (typeof url !== 'string' || !CALLBACK_URL_PATTERN.test(url)) {
      throw new PosError('Order field "success_url" must be an http(s) URL without blanks or non-ASCII characters.')
    }
    return url
  }

  /** The request time in Türkiye time; the caller's own `time_span` (a valid Date) wins, the clock is the default. */
  private timeSpan(order: PosOrder): string {
    return this.valueFormatter.formatDateTime(this.date(order, 'time_span', false) ?? new Date(), 'timeSpan')
  }

  private date(order: PosOrder, key: 'time_span' | 'transaction_date', mandatory: true): Date
  private date(order: PosOrder, key: 'time_span' | 'transaction_date', mandatory: false): Date | null
  private date(order: PosOrder, key: 'time_span' | 'transaction_date', mandatory: boolean): Date | null {
    const value: unknown = this.ownValueOf(order, key)
    if (!isSet(value)) {
      if (mandatory) {
        throw new PosError(`Order field "${key}" is required`)
      }
      return null
    }
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new PosError(`Order field "${key}" must be a valid Date`)
    }
    return value
  }

  private positiveInteger(order: PosOrder, key: 'page' | 'page_size', fallback: number): number {
    const value: unknown = this.ownValueOf(order, key)
    if (!isSet(value)) {
      return fallback
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      throw new PosError(`Order field "${key}" must be a whole number of at least 1`)
    }
    return value
  }

  /** An own, present order value (inherited members never count). */
  private ownValueOf(order: PosOrder, key: string): unknown {
    return ownValue(order as Record<string, unknown>, key)
  }

  private ownField(order: PosOrder, key: 'id' | 'amount' | 'success_url'): unknown {
    if (ownValue(order as Record<string, unknown>, key) === undefined) {
      throw new PosError(`Order field "${key}" is required`)
    }
    return required(order, key)
  }
}
