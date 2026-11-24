import { TX_APPROVED, TX_DECLINED } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
import {
  HashMismatchError,
  OrderMismatchError,
  type OrderMismatchField,
  PosError,
  UnsupportedFormFormatError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../errors.js'
import type { BoaPosAccount } from '../model/account/BoaPosAccount.js'
import type { CreditCard } from '../model/card/CreditCard.js'
import {
  CURRENCY,
  FORM_FORMAT,
  type FormFormat,
  MODEL,
  type PaymentModel,
  TX_TYPE,
  type TxType,
} from '../PosInterface.js'
import { KuveytPosAuthenticationResponseDecoder } from '../serializer/KuveytPosAuthenticationResponseDecoder.js'
import type { GatewayResponseData, PosOrder, PosResponse } from '../types.js'
import { parseInstallment } from '../util/parseInstallment.js'
import { parseOrderAmount } from '../util/parseOrderAmount.js'
import { toKurus } from '../util/toKurus.js'
import { AbstractGateway, type SupportedTransactions } from './AbstractGateway.js'

/** The response code of an authenticated card and of an approved payment. */
const SUCCESS_CODE = '00'

/** Order ids are plain ASCII so that the signed bytes are unambiguous. */
const ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/

/** The bank's own order id: a positive whole number without leading zeros. */
const BANK_ORDER_ID = /^[1-9]\d{0,18}$/

/** The 3D session value the provision request carries: base64 text. */
const MD = /^[A-Za-z0-9+/=]{1,1024}$/

/** An amount in kuruş as the bank writes it. */
const KURUS = /^(?:0|[1-9]\d{0,14})$/

/** A numeric currency code, with or without the leading zero. */
const CURRENCY_CODE = /^\d{1,4}$/

/** An installment count as the bank writes it. */
const INSTALLMENT_TEXT = /^\d{1,2}$/

/** The bank's name of a sale and its security level of the 3D model. */
const SALE = 'Sale'
const THREE_D_SECURITY = '3'

/** Callback fields that must be plain text whenever they are sent. */
const TEXT_FIELDS = ['ResponseCode', 'MerchantOrderId', 'OrderId', 'HashData', 'MD'] as const

/** Informational decline fields an unsigned declined callback may keep, as bounded plain text. */
const DECLINE_REASON_FIELDS = ['proc_return_code', 'error_code', 'error_message', 'md_error_message'] as const

/** The longest decline reason kept from an unsigned callback. */
const MAX_DECLINE_REASON_LENGTH = 256

/** Callback values are attacker controlled; only this much of one is echoed in errors and logs. */
const MAX_ECHOED_LENGTH = 64

/** Keys of a mapped result that an unsigned callback keeps as they are (the decision and the raw data). */
const KEPT_UNSIGNED_KEYS = new Set(['status', 'all', '3d_all'])

/** Raw bank data keys whose `HashPassword` echoes are replaced before a result is returned. */
const RAW_DATA_KEYS = ['all', '3d_all'] as const

const REDACTED = '***'

/** Deeper raw data than the decoders accept is not walked. */
const MAX_RAW_DEPTH = 64

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** An own value; `null` counts as absent like a missing key. */
function own(data: Record<string, unknown>, key: string): unknown {
  const value: unknown = Object.hasOwn(data, key) ? data[key] : undefined
  return value === null ? undefined : value
}

/** An own value when it is a string, otherwise undefined. */
function ownText(data: Record<string, unknown>, key: string): string | undefined {
  const value = own(data, key)
  return typeof value === 'string' ? value : undefined
}

/** An element the bank marks as having no value (`xsi:nil="true"` and no text). */
function isNil(value: unknown): boolean {
  if (!isRecord(value) || value['@xsi:nil'] !== 'true') return false
  return Object.keys(value).every((key) => key === '@xsi:nil' || (key === '#' && value[key] === ''))
}

/**
 * A bank or callback value read for a comparison: `undefined` when it is absent (missing, null or a nil element),
 * the text when it is a string, and `null` for anything else (a list from a repeated element, a record from an
 * element with attributes or children, a number), which never equals the order's value.
 */
function textOf(data: Record<string, unknown> | null, key: string): string | null | undefined {
  if (data === null) return undefined
  const value = own(data, key)
  if (value === undefined || isNil(value)) return undefined
  return typeof value === 'string' ? value : null
}

/** A scalar value as text; anything else as an empty string. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/** A copy of raw bank data with every echoed `HashPassword` value replaced. */
function withoutHashPassword(value: unknown, depth = 0): unknown {
  if (depth > MAX_RAW_DEPTH) return REDACTED
  if (Array.isArray(value)) return value.map((item) => withoutHashPassword(item, depth + 1))
  if (!isRecord(value)) return value

  const copy: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    const item = value[key]
    copy[key] =
      key.toLowerCase() === 'hashpassword' && item !== '' && item !== null && item !== undefined
        ? REDACTED
        : withoutHashPassword(item, depth + 1)
  }
  return copy
}

/**
 * KuveytPos virtual POS (Kuveyt Turk): XML requests, a SOAP service for status, cancel and refund, 3D Secure (the
 * merchant server posts the card to the bank and hands the bank's 3D page to the browser; the browser comes back
 * with `AuthenticationResponse`, URL-encoded XML, and the server sends the provision) and non-secure sales.
 *
 * The bank signs its 3D callback with `HashData`: base64 SHA-1 over `MerchantOrderId`, `ResponseCode` and `OrderId`
 * followed by the SHA-1 of the API password, without separators. Everything else in the callback (the session value
 * `MD`, the messages, the provision references and the whole `VPosMessage` with its amount, currency, installment
 * count, security level, merchant and customer numbers) is unsigned, and the signature covers no amount. The checks
 * below follow from that:
 * - `AuthenticationResponse` must be a non-empty string; it is decoded as hostile XML (size limit, no DOCTYPE or
 *   entity definitions, see `KuveytPosAuthenticationResponseDecoder`), and the raw value is never logged. The
 *   response code, order ids, `HashData` and `MD` must be text and `VPosMessage` a record whenever they are sent
 *   (a repeated element or one with attributes or children is not): otherwise `HashMismatchError('3D callback fields
 *   are malformed')` before the signature is checked.
 * - The signature check cannot be switched off. A callback that carries a `HashData` is always verified first; a
 *   mismatch is a `HashMismatchError`. A callback without one is rejected (`HashMismatchError`) when
 *   `require_3d_hash` is set and whenever it reports success (response code `00`). Otherwise it can only be a
 *   decline, and its result carries no callback value except bounded decline reasons: the order id is the order's,
 *   the payment model and transaction type are the call's, the response and error codes and messages are plain
 *   text of at most 256 characters, and every other field (amount, currency, card mask, references, time) is null.
 *   Only `3d_all` keeps the raw (untrusted) callback. It never provisions or raises a manual review.
 * - A signed callback is authenticated only when its signed response code is exactly `00` and the response mapper
 *   reads it as a success; anything else is a decline mapped as it came (decline codes are free form, so no format
 *   is pinned) and must map as declined, otherwise `PosError`. A signed decline is not bound to the order: its order
 *   id is the bank's echo.
 * - On an authenticated callback, before any request: the signed `MerchantOrderId` (the top-level field, never the
 *   message copy) must be the order id (`OrderMismatchError` on `order_id`, nothing attached), and the signed bank
 *   order id must be a positive whole number without leading zeros (otherwise malformed). The signed values have no
 *   separators, so these two pins fix where they end. Two re-reads keep a genuine signature and pass the pins: a
 *   genuine approval of order `A001` (bank id `5000`) read as order `A` with bank id `1005000`, and a genuine decline
 *   of order `B100` (code `51`, bank id `0`) read as an approval of order `B1` with bank id `510`. Neither can yield
 *   an approval: the provision carries the other session's `MD`, and its answer is bound to the order (below).
 * - `MD` must be base64 of at most 1024 characters (`PosError`). Only the bank can reject a session value of
 *   another payment.
 * - The unsigned message echoes, when sent, must agree with the order and the account: order id, amount in kuruş,
 *   currency, installment count, the 3D security level, the sale transaction type, the merchant and the customer
 *   number (`OrderMismatchError`, nothing attached). They only catch honest mismatches: the provision never uses
 *   them.
 * - The provision request is built from the order (amount in kuruş, currency, installment, order id, the 3D level);
 *   the callback only lends its `MD`. The bank's answer is its own record of the booking: an answer mapped approved
 *   must carry response code `00`, otherwise `PosError`. An answer with response code `00` is a booking whatever
 *   the mapper reads: it must name this order id (also inside its message, when present), the order's amount in
 *   kuruş and the order's currency, and it must map as approved; otherwise `OrderMismatchError` with the result
 *   attached and flagged for manual review. An approval reports the 3D model, and its card mask comes from the
 *   bank's answer only.
 * - Every result has the hashed password the bank echoes (`HashPassword`) replaced in `all` and `3d_all`.
 */
export class KuveytPos extends AbstractGateway<BoaPosAccount> {
  static readonly NAME = 'KuveytPos'

  static override readonly GATEWAY_CLASS: string = 'KuveytPos'

  protected static override readonly testModeAffectsRequests: boolean = false

  protected static override supportedTransactions: SupportedTransactions = {
    [TX_TYPE.PAY_AUTH]: [MODEL.NON_SECURE, MODEL.THREE_D_SECURE],
    [TX_TYPE.PAY_PRE_AUTH]: false,
    [TX_TYPE.PAY_POST_AUTH]: false,
    [TX_TYPE.STATUS]: true,
    [TX_TYPE.CANCEL]: true,
    [TX_TYPE.REFUND]: true,
    [TX_TYPE.REFUND_PARTIAL]: true,
    [TX_TYPE.ORDER_HISTORY]: false,
  }

  /**
   * @throws PosError when `AuthenticationResponse` is missing or not valid XML, or `MD` or the order is malformed
   * @throws HashMismatchError when a present `HashData` does not verify, a required one is missing, or the signed
   *   fields are malformed
   * @throws OrderMismatchError when the callback does not belong to the order or account (nothing is sent), or when
   *   the bank's booking does not belong to the order (result attached, flagged for manual review)
   */
  async make3DPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    _card: CreditCard | null = null,
  ): Promise<PosResponse> {
    const paymentModel = MODEL.THREE_D_SECURE
    const callback = this.decodeCallback(gatewayResponseData)

    this.assertCallbackShape(callback)
    const signed = this.verifyPresentHash(callback)
    const responseCode = ownText(callback, 'ResponseCode')
    const mapperSuccess = this.isMapperSuccess(callback)

    if (!signed) {
      if (responseCode === SUCCESS_CODE || mapperSuccess || this.config.require_3d_hash === true) {
        this.rejectUnsigned(callback)
      }
      const declined = this.responseDataMapper.map3DPaymentData(callback, null, txType, order)

      return this.unsignedResult(declined, order, txType, paymentModel)
    }

    if (responseCode !== SUCCESS_CODE || !mapperSuccess) {
      const declined = this.responseDataMapper.map3DPaymentData(callback, null, txType, order)
      if (declined.status !== TX_DECLINED) {
        // Never report a payment that skipped the order binding and the provision.
        this.logger.error('3D callback without approval was mapped as approved', {
          order_id: this.echo(declined.order_id),
          status: this.echo(declined.status),
        })
        throw new PosError('3D callback without approval was mapped as approved')
      }

      return this.redacted(declined)
    }

    const orderId = this.orderIdOf(order)
    this.assertSignedFieldsBound(callback, orderId)
    this.assertSessionValue(callback, orderId)
    this.assertEchoesMatchOrder(callback, order, orderId)

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.create3DPaymentRequestData(this.account, order, txType, callback),
      txType,
      order,
      paymentModel,
    )
    const provision = await this.sendRequest(txType, paymentModel, requestData, order)

    const response = this.redacted(this.responseDataMapper.map3DPaymentData(callback, provision, txType, order))
    this.logger.debug('finished 3D payment', { mapped_response: response })

    return this.checkProvision(provision, response, order, orderId)
  }

  /** @throws UnsupportedPaymentModelError this bank offers 3D Secure only */
  async make3DPayPayment(
    _gatewayResponseData: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
  ): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError('KuveytPos does not support the 3D Pay model')
  }

  /** @throws UnsupportedPaymentModelError this bank offers 3D Secure only */
  async make3DHostPayment(
    _gatewayResponseData: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
  ): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError('KuveytPos does not support the 3D Host model')
  }

  /**
   * The bank's 3D page as HTML: the server posts the card and the signed order to the bank, which answers with the
   * page the browser must show. The card is not needed afterwards and must not be stored; the page is the bank's
   * markup, untrusted.
   *
   * @throws UnsupportedFormFormatError for `formFormat: 'array'` (there is no form to post from the browser)
   * @throws PosError when the bank answers with an empty page
   */
  async get3DFormData(
    order: PosOrder,
    paymentModel: PaymentModel,
    txType: TxType,
    card: CreditCard | null = null,
    createWithoutCard = false,
    formFormat: FormFormat | null = null,
  ): Promise<string> {
    this.check3DFormInputs(paymentModel, txType, card, createWithoutCard)

    if (formFormat === FORM_FORMAT.ARRAY) {
      throw new UnsupportedFormFormatError('Unsupported 3D form format!')
    }

    this.logger.debug('preparing 3D form data', { payment_model: paymentModel, tx_type: txType })

    const requestTxType = TX_TYPE.INTERNAL_3D_FORM_BUILD
    const requestData = await this.dispatchRequestDataPrepared(
      await this.requestDataMapper.create3DFormInitializeRequestData(this.account, order, paymentModel, txType, card),
      requestTxType,
      order,
      paymentModel,
    )
    const answer = await this.sendRequest(requestTxType, paymentModel, requestData, order)

    const html: unknown = Object.hasOwn(answer, 'html') ? answer.html : undefined
    if (typeof html !== 'string' || html.trim() === '') {
      this.logger.error('3D form data could not be created', { payment_model: paymentModel })
      throw new PosError('3D form data could not be created')
    }

    return html
  }

  override async makeRegularPayment(order: PosOrder, card: CreditCard, txType: TxType): Promise<PosResponse> {
    return this.redacted(await super.makeRegularPayment(order, card, txType))
  }

  /** @throws UnsupportedPaymentModelError this bank has no pre-authorization */
  override async makeRegularPostPayment(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError('KuveytPos does not support post-authorization')
  }

  override async status(order: PosOrder): Promise<PosResponse> {
    return this.redacted(await super.status(order))
  }

  override async cancel(order: PosOrder): Promise<PosResponse> {
    return this.redacted(await super.cancel(order))
  }

  override async refund(order: PosOrder): Promise<PosResponse> {
    return this.redacted(await super.refund(order))
  }

  override async orderHistory(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedTransactionTypeError('KuveytPos does not support order history')
  }

  /** The decoded `AuthenticationResponse`; the raw value is never logged. */
  private decodeCallback(gatewayResponseData: GatewayResponseData): Record<string, unknown> {
    const data: unknown = gatewayResponseData
    const value = isRecord(data) ? own(data, 'AuthenticationResponse') : undefined
    if (typeof value !== 'string' || value === '') {
      this.logger.error('3D callback has no AuthenticationResponse')
      throw new PosError('AuthenticationResponse is missing')
    }

    return KuveytPosAuthenticationResponseDecoder.decode(value)
  }

  /**
   * The signed fields and the session value are read as text by the signature check, the mapper and the request
   * mapper alike; a list (repeated element) or a record (attributes, children) could be read differently by each, so
   * it is refused before anything else. An empty `VPosMessage` element counts as absent.
   */
  private assertCallbackShape(callback: Record<string, unknown>): void {
    const malformed: string[] = TEXT_FIELDS.filter((key) => {
      const value = own(callback, key)
      return value !== undefined && typeof value !== 'string'
    })
    const message = own(callback, 'VPosMessage')
    if (message !== undefined && message !== '' && !isRecord(message)) {
      malformed.push('VPosMessage')
    }

    if (malformed.length > 0) {
      this.malformed(callback, malformed)
    }
  }

  /** Verifies a present `HashData`; returns whether the callback was signed. */
  private verifyPresentHash(callback: Record<string, unknown>): boolean {
    const hash = own(callback, 'HashData')
    if (hash === undefined || hash === '') {
      return false
    }
    if (!this.crypt.check3DHash(this.account, callback as GatewayResponseData)) {
      throw new HashMismatchError('3D callback hash mismatch')
    }

    return true
  }

  /** The response mapper's reading of the callback's 3D result. */
  private isMapperSuccess(callback: Record<string, unknown>): boolean {
    const mdStatus = this.responseDataMapper.extractMdStatus(callback)
    const success = this.responseDataMapper.is3dAuthSuccess(mdStatus)
    if (success) {
      this.logger.info('3d auth success', { md_status: this.echo(mdStatus) })
    } else {
      this.logger.error('3d auth fail', { md_status: this.echo(mdStatus) })
    }

    return success
  }

  private rejectUnsigned(callback: Record<string, unknown>): never {
    this.logger.error('3D callback has no HashData', { order_id: this.echo(ownText(callback, 'MerchantOrderId')) })
    throw new HashMismatchError('3D callback has no HashData')
  }

  private malformed(callback: Record<string, unknown>, fields: string[]): never {
    this.logger.error('3D callback fields are malformed', {
      order_id: this.echo(ownText(callback, 'MerchantOrderId')),
      fields,
    })
    throw new HashMismatchError('3D callback fields are malformed')
  }

  /**
   * The signed values run together without separators: the signed order id must be this order's (the top-level
   * field, never the message copy) and the bank id a whole number without leading zeros, which fixes both ends of
   * the response code.
   */
  private assertSignedFieldsBound(callback: Record<string, unknown>, orderId: string): void {
    const callbackOrderId = ownText(callback, 'MerchantOrderId') ?? ''
    if (callbackOrderId !== orderId) {
      this.fail('order_id', orderId, callbackOrderId, orderId)
    }
    if (!BANK_ORDER_ID.test(ownText(callback, 'OrderId') ?? '')) {
      this.malformed(callback, ['OrderId'])
    }
  }

  /** The unsigned session value travels into the provision request: plain base64 only. */
  private assertSessionValue(callback: Record<string, unknown>, orderId: string): void {
    if (!MD.test(ownText(callback, 'MD') ?? '')) {
      this.logger.error('3D callback authentication values are malformed', {
        order_id: this.echo(orderId),
        fields: ['MD'],
      })
      throw new PosError('3D callback authentication values are malformed')
    }
  }

  /**
   * The message echoes the 3D form. It is not signed, so these checks only catch honest mismatches (a callback of
   * another form, a changed basket); nothing the provision sends is taken from it.
   */
  private assertEchoesMatchOrder(callback: Record<string, unknown>, order: PosOrder, orderId: string): void {
    const value = own(callback, 'VPosMessage')
    const message = isRecord(value) ? value : null
    // An amount the bank cannot be sent fails here, before any request, with or without a message.
    const expectedAmount = this.orderKurus(order)
    if (message === null) return

    const check = (key: string, field: OrderMismatchField, expected: string, accepts: (text: string) => boolean) => {
      const text = textOf(message, key)
      if (text !== undefined && (text === null || !accepts(text))) {
        this.fail(field, expected, text ?? '', orderId)
      }
    }

    check('MerchantOrderId', 'order_id', orderId, (text) => text === orderId)
    check('Amount', 'amount', expectedAmount, (text) => text === expectedAmount)
    const expectedCurrency = this.orderCurrency(order)
    check('CurrencyCode', 'currency', expectedCurrency, (text) => this.isCurrency(text, expectedCurrency))
    const installment = this.normalizedInstallment(parseInstallment(order.installment))
    check(
      'InstallmentCount',
      'installment',
      String(installment),
      (text) => INSTALLMENT_TEXT.test(text) && this.normalizedInstallment(Number(text)) === installment,
    )
    check('TransactionSecurity', 'payment_model', THREE_D_SECURITY, (text) => text === THREE_D_SECURITY)
    check('TransactionType', 'transaction_type', SALE, (text) => text === SALE)
    const merchantId = this.account.getMerchantId()
    check('MerchantId', 'merchant_id', merchantId, (text) => text === '' || text === merchantId)
    const customerId = this.account.getCustomerId()
    check('CustomerId', 'terminal_id', customerId, (text) => text === '' || text === customerId)
  }

  /**
   * The provision answer is the bank's record of the booking. An approval needs the bank's own `00`; an answer with
   * `00` is a booking whatever the mapper reads, so it must belong to the order and map as approved.
   */
  private checkProvision(
    provision: Record<string, unknown>,
    response: PosResponse,
    order: PosOrder,
    orderId: string,
  ): PosResponse {
    const booked = textOf(provision, 'ResponseCode') === SUCCESS_CODE
    if (response.status === TX_APPROVED && !booked) {
      this.logger.error('3D provision answer without approval was mapped as approved', { order_id: this.echo(orderId) })
      throw new PosError('3D provision answer without approval was mapped as approved')
    }
    if (!booked) {
      return response
    }

    const evidence: PosResponse = { ...response, requires_manual_review: true }
    const message = this.assertProvisionMatchesOrder(provision, order, orderId, evidence)
    if (response.status !== TX_APPROVED) {
      this.fail('order_status', TX_APPROVED, asText(response.status), orderId, evidence)
    }

    const cardNumber = textOf(message, 'CardNumber')
    return {
      ...response,
      payment_model: MODEL.THREE_D_SECURE,
      masked_number: typeof cardNumber === 'string' && cardNumber !== '' ? cardNumber : null,
    }
  }

  /**
   * A booking must name this order id (top level and, when present, inside its message), the order's amount in
   * kuruş and the order's currency. Returns the booking's message.
   */
  private assertProvisionMatchesOrder(
    provision: Record<string, unknown>,
    order: PosOrder,
    orderId: string,
    evidence: PosResponse,
  ): Record<string, unknown> | null {
    const bookedOrderId = textOf(provision, 'MerchantOrderId')
    if (bookedOrderId !== orderId) {
      this.fail('order_id', orderId, bookedOrderId ?? '', orderId, evidence)
    }

    const value = own(provision, 'VPosMessage')
    const message = isRecord(value) ? value : null
    const expectedAmount = this.orderKurus(order)
    const amount = textOf(message, 'Amount')
    if (typeof amount !== 'string' || !KURUS.test(amount) || amount !== expectedAmount) {
      this.fail('amount', expectedAmount, amount ?? '', orderId, evidence)
    }

    const messageOrderId = textOf(message, 'MerchantOrderId')
    if (messageOrderId !== undefined && messageOrderId !== orderId) {
      this.fail('order_id', orderId, messageOrderId ?? '', orderId, evidence)
    }

    const expectedCurrency = this.orderCurrency(order)
    const currency = textOf(message, 'CurrencyCode')
    if (typeof currency !== 'string' || !this.isCurrency(currency, expectedCurrency)) {
      this.fail('currency', expectedCurrency, currency ?? '', orderId, evidence)
    }

    return message
  }

  /** A numeric currency code, the leading zero optional, equal to the order's. */
  private isCurrency(text: string, expected: string): boolean {
    return CURRENCY_CODE.test(text) && text.padStart(4, '0') === expected
  }

  /** The order amount in kuruş as text; an amount the bank cannot be sent is a `PosError`. */
  private orderKurus(order: PosOrder): string {
    return String(toKurus(parseOrderAmount(order.amount)))
  }

  private orderCurrency(order: PosOrder): string {
    return String(this.requestValueMapper.mapCurrency(order.currency ?? CURRENCY.TRY))
  }

  /** One installment is a single payment, like none. */
  private normalizedInstallment(count: number): number {
    return count > 1 ? count : 0
  }

  /**
   * The result of an unsigned declined callback, built from trusted data only: every value the callback could have
   * chosen is dropped (null) and replaced by the order's id and the call's transaction type and payment model. Its
   * decline reasons grant nothing and a merchant needs them for a genuine decline, so they stay as informational
   * plain text of bounded length (anything but a string becomes null). The raw data is kept, without the echoed
   * hashed password.
   */
  private unsignedResult(
    response: PosResponse,
    order: PosOrder,
    txType: TxType,
    paymentModel: PaymentModel,
  ): PosResponse {
    const orderId = this.orderIdOf(order)
    const result: PosResponse = { ...response }
    delete result.requires_manual_review
    for (const key of Object.keys(result)) {
      if (!KEPT_UNSIGNED_KEYS.has(key)) result[key] = null
    }
    for (const key of DECLINE_REASON_FIELDS) {
      if (!Object.hasOwn(response, key)) continue
      const reason: unknown = response[key]
      result[key] = typeof reason === 'string' ? reason.slice(0, MAX_DECLINE_REASON_LENGTH) : null
    }

    return this.redacted({
      ...result,
      status: TX_DECLINED,
      order_id: orderId,
      transaction_type: txType,
      payment_model: paymentModel,
    })
  }

  /** The response with the hashed password the bank echoes replaced in its raw data. */
  private redacted(response: PosResponse): PosResponse {
    let result = response
    for (const key of RAW_DATA_KEYS) {
      if (Object.hasOwn(response, key) && response[key] !== null && typeof response[key] === 'object') {
        result = { ...result, [key]: withoutHashPassword(response[key]) }
      }
    }

    return result
  }

  /** The order id every binding compares with: letters, digits, `_` and `-`, at most 64 characters. */
  private orderIdOf(order: PosOrder): string {
    const id: unknown = order.id
    const text = typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id)) ? String(id) : ''
    if (!ORDER_ID.test(text)) {
      throw new PosError('The order id may only hold letters, digits, underscores and hyphens (at most 64).')
    }

    return text
  }

  /** A callback value shortened for logs. */
  private echo(value: unknown): string {
    return asText(value).slice(0, MAX_ECHOED_LENGTH)
  }

  private fail(
    field: OrderMismatchField,
    expected: string,
    actual: string,
    orderId: string,
    response?: PosResponse,
  ): never {
    this.logger.error(`3D callback ${field} does not match the order`, {
      field,
      expected: this.echo(expected),
      actual: this.echo(actual),
      order_id: this.echo(orderId),
    })
    throw new OrderMismatchError(field, this.echo(expected), this.echo(actual), response)
  }
}
