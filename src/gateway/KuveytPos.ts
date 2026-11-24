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
import {
  asText,
  BANK_ORDER_ID,
  boaOrderId,
  echo,
  hasAmbiguousResponseCode,
  INSTALLMENT_TEXT,
  isCurrencyCode,
  isRecord,
  MD,
  normalizedInstallment,
  own,
  ownText,
  provisionMismatch,
  redactHashPassword,
  SUCCESS_CODE,
  textOf,
  unsignedDeclineResult,
} from './boaCallback.js'

/** The bank's name of a sale and its security level of the 3D model. */
const SALE = 'Sale'
const THREE_D_SECURITY = '3'

/** Callback fields that must be plain text whenever they are sent. */
const TEXT_FIELDS = ['ResponseCode', 'MerchantOrderId', 'OrderId', 'HashData', 'MD'] as const

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
 * - After a request that can move money (the provision, a sale), an answer without a response code (empty, missing,
 *   nil, text only) is a `PosHttpError` from the HTTP client naming the request URL, and an answer whose response
 *   code is not one plain value (repeated, or with children) an `OrderMismatchError` on `order_status` with the
 *   mapped answer flagged for manual review: neither tells whether the money moved.
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

      return unsignedDeclineResult(declined, boaOrderId(order), txType, paymentModel)
    }

    if (responseCode !== SUCCESS_CODE || !mapperSuccess) {
      const declined = this.responseDataMapper.map3DPaymentData(callback, null, txType, order)
      if (declined.status !== TX_DECLINED) {
        // Never report a payment that skipped the order binding and the provision.
        this.logger.error('3D callback without approval was mapped as approved', {
          order_id: echo(declined.order_id),
          status: echo(declined.status),
        })
        throw new PosError('3D callback without approval was mapped as approved')
      }

      return redactHashPassword(declined)
    }

    const orderId = boaOrderId(order)
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

    const response = redactHashPassword(this.responseDataMapper.map3DPaymentData(callback, provision, txType, order))
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

  /** The sale: an answer whose response code is ambiguous is an unknown outcome, not a decline. */
  override async makeRegularPayment(order: PosOrder, card: CreditCard, txType: TxType): Promise<PosResponse> {
    const paymentModel = MODEL.NON_SECURE
    this.logger.debug('making payment', { model: paymentModel, tx_type: txType })
    if (txType !== TX_TYPE.PAY_AUTH && txType !== TX_TYPE.PAY_PRE_AUTH) {
      throw new UnsupportedTransactionTypeError(`Invalid transaction type "${txType}" provided`)
    }

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createNonSecurePaymentRequestData(this.account, order, txType, card),
      txType,
      order,
      paymentModel,
    )
    const answer = await this.sendRequest(txType, paymentModel, requestData, order)
    const response = redactHashPassword(this.responseDataMapper.mapPaymentResponse(answer, txType, order))
    this.assertClearOutcome(answer, response, order.id)

    return response
  }

  /** @throws UnsupportedPaymentModelError this bank has no pre-authorization */
  override async makeRegularPostPayment(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError('KuveytPos does not support post-authorization')
  }

  override async status(order: PosOrder): Promise<PosResponse> {
    return redactHashPassword(await super.status(order))
  }

  override async cancel(order: PosOrder): Promise<PosResponse> {
    return redactHashPassword(await super.cancel(order))
  }

  override async refund(order: PosOrder): Promise<PosResponse> {
    return redactHashPassword(await super.refund(order))
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
      this.logger.info('3d auth success', { md_status: echo(mdStatus) })
    } else {
      this.logger.error('3d auth fail', { md_status: echo(mdStatus) })
    }

    return success
  }

  private rejectUnsigned(callback: Record<string, unknown>): never {
    this.logger.error('3D callback has no HashData', { order_id: echo(ownText(callback, 'MerchantOrderId')) })
    throw new HashMismatchError('3D callback has no HashData')
  }

  private malformed(callback: Record<string, unknown>, fields: string[]): never {
    this.logger.error('3D callback fields are malformed', {
      order_id: echo(ownText(callback, 'MerchantOrderId')),
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
        order_id: echo(orderId),
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
    check('CurrencyCode', 'currency', expectedCurrency, (text) => isCurrencyCode(text, expectedCurrency))
    const installment = normalizedInstallment(parseInstallment(order.installment))
    check(
      'InstallmentCount',
      'installment',
      String(installment),
      (text) => INSTALLMENT_TEXT.test(text) && normalizedInstallment(Number(text)) === installment,
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
   * `00` is a booking whatever the mapper reads, so it must belong to the order and map as approved. An answer that
   * cannot say whether anything was booked is never a decline.
   */
  private checkProvision(
    provision: Record<string, unknown>,
    response: PosResponse,
    order: PosOrder,
    orderId: string,
  ): PosResponse {
    const evidence: PosResponse = { ...response, requires_manual_review: true }
    this.assertClearOutcome(provision, response, orderId)

    const booked = textOf(provision, 'ResponseCode') === SUCCESS_CODE
    if (response.status === TX_APPROVED && !booked) {
      this.logger.error('3D provision answer without approval was mapped as approved', { order_id: echo(orderId) })
      throw new PosError('3D provision answer without approval was mapped as approved')
    }
    if (!booked) {
      return response
    }

    const mismatch = provisionMismatch(
      provision,
      orderId,
      this.orderKurus(order),
      this.orderCurrency(order),
      ['CurrencyCode'],
      true,
    )
    if (mismatch !== null) {
      this.fail(...mismatch, orderId, evidence)
    }
    if (response.status !== TX_APPROVED) {
      this.fail('order_status', TX_APPROVED, asText(response.status), orderId, evidence)
    }

    const value = own(provision, 'VPosMessage')
    const cardNumber = textOf(isRecord(value) ? value : null, 'CardNumber')
    return {
      ...response,
      payment_model: MODEL.THREE_D_SECURE,
      masked_number: typeof cardNumber === 'string' && cardNumber !== '' ? cardNumber : null,
    }
  }

  /**
   * A money-moving answer whose response code is not one plain value says nothing certain about the money: the
   * mapped answer is attached and flagged for manual review.
   */
  private assertClearOutcome(answer: Record<string, unknown>, response: PosResponse, orderId: unknown): void {
    if (hasAmbiguousResponseCode(answer)) {
      this.logger.error('bank answer has an ambiguous response code', { order_id: echo(orderId) })
      throw new OrderMismatchError('order_status', SUCCESS_CODE, 'ambiguous response code', {
        ...response,
        requires_manual_review: true,
      })
    }
  }

  /** The order amount in kuruş as text; an amount the bank cannot be sent is a `PosError`. */
  private orderKurus(order: PosOrder): string {
    return String(toKurus(parseOrderAmount(order.amount)))
  }

  private orderCurrency(order: PosOrder): string {
    return String(this.requestValueMapper.mapCurrency(order.currency ?? CURRENCY.TRY))
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
      expected: echo(expected),
      actual: echo(actual),
      order_id: echo(orderId),
    })
    throw new OrderMismatchError(field, echo(expected), echo(actual), response)
  }
}
