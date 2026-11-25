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
  type Currency,
  FORM_FORMAT,
  type FormFormat,
  MODEL,
  type PaymentModel,
  TX_TYPE,
  type TxType,
} from '../PosInterface.js'
import type { GatewayResponseData, PosOrder, PosResponse, ThreeDFormData } from '../types.js'
import { numberFormat2 } from '../util/numberFormat2.js'
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
  MAX_ECHOED_LENGTH,
  MD,
  type Mismatch,
  normalizedInstallment,
  own,
  ownText,
  provisionMismatch,
  redactHashPassword,
  SUCCESS_CODE,
  textOf,
  unsignedDeclineResult,
} from './boaCallback.js'

/** The bank's order status of a completed sale (initial and current). */
const SALE_COMPLETED = '1'

/** An amount as the bank's order records write it: whole units, a dot and two decimals. */
const RECORD_AMOUNT = /^\d{1,13}\.\d{2}$/

/** A zero amount as the bank's order records write it. */
const ZERO_AMOUNT = /^0+(?:\.0+)?$/

/** An authorization code: printable ASCII, no spaces. */
const PROVISION_NUMBER = /^[\x21-\x7E]{1,32}$/

/** The message fields of a provision answer that state a currency. */
const PROVISION_CURRENCY_KEYS = ['CurrencyCode', 'FECCurrencyCode'] as const

/** A transaction the bank reports as successful. */
const TRANSACTION_SUCCESSFUL = '1'

/** The security level of a sale without 3D. */
const NON_SECURE_SECURITY = '5'

/** The order values a bank answer is compared with. */
type OrderExpectations = {
  /** The amount in kuruş as text. */
  kurus: string
  /** The amount with two decimals as the bank's order records write it. */
  amountText: string
  /** The order currency (`TRY`, …). */
  currencyCode: Currency
  /** The bank's numeric code of the order currency. */
  currency: string
  /** The stated installment count (0 for a single payment), or null when the order states none. */
  installment: number | null
}

/** What a confirming status answer yields: its raw record and the first mismatch (null when it confirms). */
type Confirmation = { record: Record<string, unknown>; failure: Mismatch | null }

/**
 * Vakıf Katılım virtual POS: XML requests to one gateway, 3D Secure (the merchant server posts the card to the bank
 * and hands the bank's 3D page to the browser; the browser comes back with a form and the server sends the
 * provision), 3D Host (the browser posts a form to the bank's common payment page and comes back with the result),
 * non-secure sales and pre-authorizations with their close, status, cancel, full refund and order history.
 *
 * The bank signs its 3D callbacks with `HashData`: base64 SHA-1 over `MerchantOrderId`, `ResponseCode` and `OrderId`
 * followed by the SHA-1 of the API password (`HashPassword`), without separators. Everything else in a callback (the
 * session value `MD`, messages, provision references) is unsigned, and the signature covers no amount. The checks
 * below follow from that:
 * - The callback is a flat form: any value that is not a string is a `PosError` before anything else.
 * - The signature check cannot be switched off. A callback that carries a `HashData` is always verified first; a
 *   mismatch is a `HashMismatchError`. A callback without one is rejected (`HashMismatchError`) when
 *   `require_3d_hash` is set and whenever it reports success (response code `00`). Otherwise it can only be a
 *   decline, and its result carries no callback value except bounded decline reasons: the order id is the order's,
 *   the payment model and transaction type are the call's, the response and error codes and messages are plain text
 *   of at most 256 characters, and every other field is null. It never provisions, confirms or raises a manual
 *   review.
 * - A signed callback reports success only when its signed response code is exactly `00` and the response mapper
 *   reads it as a success; anything else is a decline mapped as it came (decline codes are free form) and must map
 *   as declined, otherwise `PosError`. A signed decline is not bound to the order: its order id is the bank's echo.
 * - On a successful callback, before any request: the signed `MerchantOrderId` must be the order id
 *   (`OrderMismatchError` on `order_id`, nothing attached) and the signed bank order id a positive whole number
 *   without leading zeros (otherwise malformed). The signed values have no separators, so these two pins fix where
 *   they end. Two re-reads keep a genuine signature and pass the pins (a genuine approval of order `A001` with bank
 *   id `5000` read as order `A` with bank id `1005000`; a genuine decline of order `B100` with code `51` and bank id
 *   `0` read as an approval of order `B1` with bank id `510`); neither can yield an approval, see below.
 * - 3D Secure: `MD` must be base64 of at most 1024 characters (`PosError`); only the bank can reject a session value
 *   of another payment. The provision request is built from the order (amount in kuruş, installment, order id,
 *   return URLs, the 3D level); the callback only lends its `MD`. The bank's answer is its own record of the
 *   booking: an answer mapped approved must carry response code `00`, otherwise `PosError`. An answer with response
 *   code `00` is a booking whatever the mapper reads: it must name this order id (also inside its message, when
 *   present), the order's amount in kuruş and, when it states one, the order's currency, and it must map as
 *   approved; otherwise `OrderMismatchError` with the result attached and flagged for manual review. The order's
 *   amount, currency and installment are validated before the provision is sent.
 * - After a request that can move money (the provision, a sale, a pre-authorization, its close), an answer without a
 *   response code (empty, missing, nil, text only) is a `PosHttpError` from the HTTP client naming the request URL,
 *   and an answer whose response code is not one plain value an `OrderMismatchError` on `order_status` with the
 *   mapped answer flagged for manual review: neither tells whether the money moved. Cancel, refund and status
 *   answers are mapped as they come.
 * - 3D Host: the form the browser posts to the bank is unsigned, so the payer can change its amount and currency,
 *   and it carries `HashPassword`, so the payer can also sign any callback. A 3D Host callback therefore proves
 *   nothing by itself: every approval is confirmed with exactly one signed status request for the order id, and only
 *   the bank's record decides. The answer must hold exactly one order record (several records for one order id mean
 *   it was reversed); the record must name this order id, report response code `00`, a successful transaction
 *   (transaction status `1`) that was not a non-secure sale (security level `5`), a completed sale (initial and
 *   current order status `1`), the order's amount and currency, no cancelled or refunded amount, and an
 *   authorization code; when the order states an installment count, the record's must match. The order's amount,
 *   currency and installment are validated before the status request. Any other answer is an `OrderMismatchError`
 *   with the result flagged for manual review (the attached result carries the order id and no unsigned callback
 *   reference or bank order id); transport errors of the status request propagate. A confirmed result takes its
 *   authorization code, references, bank order id, amount and currency from the record, never from the callback.
 * - Every result has the hashed password the bank echoes (`HashPassword`) replaced in `all` and `3d_all`.
 */
export class VakifKatilimPos extends AbstractGateway<BoaPosAccount> {
  static readonly NAME = 'VakifKatilim'

  static override readonly GATEWAY_CLASS: string = 'VakifKatilimPos'

  protected static override readonly testModeAffectsRequests: boolean = false

  protected static override supportedTransactions: SupportedTransactions = {
    [TX_TYPE.PAY_AUTH]: [MODEL.NON_SECURE, MODEL.THREE_D_SECURE, MODEL.THREE_D_HOST],
    [TX_TYPE.PAY_PRE_AUTH]: [MODEL.NON_SECURE],
    [TX_TYPE.PAY_POST_AUTH]: true,
    [TX_TYPE.STATUS]: true,
    [TX_TYPE.CANCEL]: true,
    [TX_TYPE.REFUND]: true,
    // The bank's refund request carries no amount: a "partial" refund would refund everything.
    [TX_TYPE.REFUND_PARTIAL]: false,
    [TX_TYPE.ORDER_HISTORY]: true,
  }

  /**
   * @throws PosError when the callback is not a flat form of strings, or `MD` or the order is malformed
   * @throws HashMismatchError when a present `HashData` does not verify, a required one is missing, or the signed
   *   fields are malformed
   * @throws OrderMismatchError when the callback does not belong to the order (nothing is sent), or when the bank's
   *   booking does not belong to the order or cannot be read (result attached, flagged for manual review)
   * @throws PosHttpError when the provision request fails or its answer carries no response code
   */
  async make3DPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    _card: CreditCard | null = null,
  ): Promise<PosResponse> {
    const paymentModel = MODEL.THREE_D_SECURE
    const callback = this.flatCallback(gatewayResponseData)
    const authenticated = this.isAuthenticated(callback, order, txType, paymentModel)
    if (authenticated !== true) {
      return (
        authenticated ?? this.signedDecline(this.responseDataMapper.map3DPaymentData(callback, null, txType, order))
      )
    }

    const orderId = boaOrderId(order)
    this.assertSignedFieldsBound(callback, orderId)
    this.assertSessionValue(callback, orderId)
    // Every order value the bank's answer is compared with fails here, before any request.
    const expected = this.orderExpectations(order)

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.create3DPaymentRequestData(this.account, order, txType, callback),
      txType,
      order,
      paymentModel,
    )
    const provision = await this.sendRequest(txType, paymentModel, requestData, order)

    const response = redactHashPassword(this.responseDataMapper.map3DPaymentData(callback, provision, txType, order))
    this.logger.debug('finished 3D payment', { mapped_response: response })

    return this.checkProvision(provision, response, orderId, expected)
  }

  /** @throws UnsupportedPaymentModelError this bank has no 3D Pay model */
  async make3DPayPayment(
    _gatewayResponseData: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
  ): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError('VakifKatilimPos does not support the 3D Pay model')
  }

  /**
   * @throws PosError when the callback is not a flat form of strings or the order is malformed
   * @throws HashMismatchError when a present `HashData` does not verify, a required one is missing, or the signed
   *   fields are malformed
   * @throws OrderMismatchError when the callback does not belong to the order (nothing is sent), or when the bank's
   *   status record does not confirm the payment (result attached, flagged for manual review)
   * @throws PosHttpError when the status request fails
   */
  async make3DHostPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
  ): Promise<PosResponse> {
    const paymentModel = MODEL.THREE_D_HOST
    const callback = this.flatCallback(gatewayResponseData)
    const authenticated = this.isAuthenticated(callback, order, txType, paymentModel)
    if (authenticated !== true) {
      return authenticated ?? this.signedDecline(this.responseDataMapper.map3DHostResponseData(callback, txType, order))
    }

    const orderId = boaOrderId(order)
    this.assertSignedFieldsBound(callback, orderId)
    // Every order value the bank's record is compared with fails here, before any request.
    const expected = this.orderExpectations(order)

    const response = redactHashPassword(this.responseDataMapper.map3DHostResponseData(callback, txType, order))
    if (response.status !== TX_APPROVED) {
      // The callback's own reading and the mapper disagree: nothing is confirmed or approved.
      this.logger.error('3D Host callback with response code 00 was not mapped as approved', {
        order_id: echo(orderId),
      })
      throw new PosError('3D Host callback with response code 00 was not mapped as approved')
    }

    return this.confirmHostedPayment(response, orderId, expected)
  }

  /**
   * 3D Host: the form the browser posts to the bank's common payment page (it carries the hashed API password; the
   * amount in it is not signed, which is why every 3D Host approval is confirmed with the bank). 3D Secure: the
   * bank's 3D page as HTML, after the server posted the card and the signed order to the bank; the card is not needed
   * afterwards and must not be stored, and the page is the bank's markup, untrusted.
   * `createWithoutCard` has no effect: the card goes from your server to the bank, never to the browser.
   *
   * @throws UnsupportedFormFormatError for `formFormat: 'html'` with 3D Host and `formFormat: 'array'` with 3D Secure
   * @throws PosError when the bank answers with an empty page
   */
  async get3DFormData(
    order: PosOrder,
    paymentModel: PaymentModel,
    txType: TxType,
    card: CreditCard | null = null,
    createWithoutCard = false,
    formFormat: FormFormat | null = null,
  ): Promise<ThreeDFormData | string> {
    this.check3DFormInputs(paymentModel, txType, card, createWithoutCard)

    this.logger.debug('preparing 3D form data', { payment_model: paymentModel, tx_type: txType })

    if (paymentModel === MODEL.THREE_D_HOST) {
      if (formFormat === FORM_FORMAT.HTML) {
        throw new UnsupportedFormFormatError('Unsupported 3D form format!')
      }

      return this.requestDataMapper.create3DFormData(
        this.account,
        order,
        paymentModel,
        txType,
        this.get3DGatewayURL(paymentModel),
      )
    }

    if (formFormat === FORM_FORMAT.ARRAY) {
      throw new UnsupportedFormFormatError('Unsupported 3D form format!')
    }

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

  /** The sale and the pre-authorization: an answer whose response code is ambiguous is an unknown outcome, not a decline. */
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

  /** The close of a pre-authorization: an answer whose response code is ambiguous is an unknown outcome. */
  override async makeRegularPostPayment(order: PosOrder): Promise<PosResponse> {
    const txType = TX_TYPE.PAY_POST_AUTH
    const paymentModel = MODEL.NON_SECURE
    this.logger.debug('making payment', { model: paymentModel, tx_type: txType })

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createNonSecurePostAuthPaymentRequestData(this.account, order),
      txType,
      order,
      paymentModel,
    )
    const answer = await this.sendRequest(txType, paymentModel, requestData, order)
    const response = redactHashPassword(this.responseDataMapper.mapPaymentResponse(answer, txType, order))
    this.assertClearOutcome(answer, response, order.id)

    return response
  }

  override async status(order: PosOrder): Promise<PosResponse> {
    return redactHashPassword(await super.status(order))
  }

  override async cancel(order: PosOrder): Promise<PosResponse> {
    return redactHashPassword(await super.cancel(order))
  }

  /**
   * @throws UnsupportedTransactionTypeError for a partial refund: the bank's request carries no amount
   * @throws PosHttpError when the refund answer carries no response code: the refund may have gone through, check
   *   `status` before any retry
   */
  override async refund(order: PosOrder): Promise<PosResponse> {
    const orderAmount = order.order_amount
    if (orderAmount !== undefined && orderAmount !== null && Number(order.amount) < Number(orderAmount)) {
      throw new UnsupportedTransactionTypeError('Partial refunds are not supported: the bank request carries no amount')
    }

    return redactHashPassword(await super.refund(order))
  }

  override async orderHistory(order: PosOrder): Promise<PosResponse> {
    return redactHashPassword(await super.orderHistory(order))
  }

  /**
   * A bank callback is a flat form of strings. A nested value could be read differently by the signature check, the
   * response mapper and the request mapper, so it is refused before anything else.
   */
  private flatCallback(gatewayResponseData: GatewayResponseData): Record<string, unknown> {
    const data: unknown = gatewayResponseData
    if (!isRecord(data)) {
      throw new PosError('3D callback data must be a record')
    }
    // own property names include non-enumerable ones, which a spread or `Object.entries` would skip
    for (const key of Object.getOwnPropertyNames(data)) {
      const value: unknown = data[key]
      if (typeof value !== 'string') {
        const field = key.slice(0, MAX_ECHOED_LENGTH)
        this.logger.error('3D callback field is not a string', { field, type: value === null ? 'null' : typeof value })
        throw new PosError(`3D callback field "${field}" must be a string`)
      }
    }

    return data
  }

  /**
   * Verifies a present `HashData` and decides whether the callback reports success. Returns `true` for a signed
   * success, `null` for a signed decline, and the trusted result of an unsigned decline.
   */
  private isAuthenticated(
    callback: Record<string, unknown>,
    order: PosOrder,
    txType: TxType,
    paymentModel: PaymentModel,
  ): true | null | PosResponse {
    const signed = this.verifyPresentHash(callback)
    const responseCode = ownText(callback, 'ResponseCode')
    const mapperSuccess = this.isMapperSuccess(callback)

    if (!signed) {
      if (responseCode === SUCCESS_CODE || mapperSuccess || this.config.require_3d_hash === true) {
        this.logger.error('3D callback has no HashData', { order_id: echo(ownText(callback, 'MerchantOrderId')) })
        throw new HashMismatchError('3D callback has no HashData')
      }
      const declined =
        paymentModel === MODEL.THREE_D_HOST
          ? this.responseDataMapper.map3DHostResponseData(callback, txType, order)
          : this.responseDataMapper.map3DPaymentData(callback, null, txType, order)

      return unsignedDeclineResult(declined, boaOrderId(order), txType, paymentModel)
    }

    return responseCode === SUCCESS_CODE && mapperSuccess ? true : null
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

  /** A signed decline is mapped as it came, and must map as declined. */
  private signedDecline(declined: PosResponse): PosResponse {
    if (declined.status !== TX_DECLINED) {
      // Never report a payment that skipped the order binding and the bank's record.
      this.logger.error('3D callback without approval was mapped as approved', {
        order_id: echo(declined.order_id),
        status: echo(declined.status),
      })
      throw new PosError('3D callback without approval was mapped as approved')
    }

    return redactHashPassword(declined)
  }

  /**
   * The signed values run together without separators: the signed order id must be this order's and the bank id a
   * whole number without leading zeros, which fixes both ends of the response code.
   */
  private assertSignedFieldsBound(callback: Record<string, unknown>, orderId: string): void {
    const callbackOrderId = ownText(callback, 'MerchantOrderId') ?? ''
    if (callbackOrderId !== orderId) {
      this.fail('order_id', orderId, callbackOrderId, orderId)
    }
    if (!BANK_ORDER_ID.test(ownText(callback, 'OrderId') ?? '')) {
      this.logger.error('3D callback fields are malformed', { order_id: echo(orderId), fields: ['OrderId'] })
      throw new HashMismatchError('3D callback fields are malformed')
    }
  }

  /** The unsigned session value travels into the provision request: plain base64 only. */
  private assertSessionValue(callback: Record<string, unknown>, orderId: string): void {
    if (!MD.test(ownText(callback, 'MD') ?? '')) {
      this.logger.error('3D callback authentication values are malformed', { order_id: echo(orderId), fields: ['MD'] })
      throw new PosError('3D callback authentication values are malformed')
    }
  }

  /**
   * The provision answer is the bank's record of the booking. An approval needs the bank's own `00`; an answer with
   * `00` is a booking whatever the mapper reads, so it must belong to the order and map as approved. An answer that
   * cannot say whether anything was booked is never a decline.
   */
  private checkProvision(
    provision: Record<string, unknown>,
    response: PosResponse,
    orderId: string,
    expected: OrderExpectations,
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
      expected.kurus,
      expected.currency,
      PROVISION_CURRENCY_KEYS,
      false,
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
      order_id: orderId,
      payment_model: MODEL.THREE_D_SECURE,
      masked_number: typeof cardNumber === 'string' && cardNumber !== '' ? cardNumber : null,
    }
  }

  /**
   * Every 3D Host approval is confirmed by the bank's own order record before it is returned; the authorization
   * code, references, bank order id, amount and currency come from that record. A failure attaches the result with
   * the order id and without the callback's unsigned references, flagged for manual review: a genuine payment whose
   * record lags or differs still needs attention.
   */
  private async confirmHostedPayment(
    response: PosResponse,
    orderId: string,
    expected: OrderExpectations,
  ): Promise<PosResponse> {
    const { record, failure } = await this.bankRecordConfirms(orderId, expected)
    if (failure !== null) {
      const evidence: PosResponse = {
        ...response,
        order_id: orderId,
        remote_order_id: null,
        auth_code: null,
        ref_ret_num: null,
        transaction_id: null,
        requires_manual_review: true,
      }
      this.fail(...failure, orderId, evidence)
    }

    this.logger.info('3D Host payment confirmed by the bank order record', { order_id: echo(orderId) })
    const installment = textOf(record, 'InstallmentCount')

    return {
      ...response,
      order_id: orderId,
      auth_code: textOf(record, 'ProvNumber') ?? null,
      ref_ret_num: textOf(record, 'RRN') ?? null,
      transaction_id: textOf(record, 'Stan') ?? null,
      remote_order_id: textOf(record, 'OrderId') ?? null,
      amount: Number(textOf(record, 'FirstAmount')),
      currency: expected.currencyCode,
      installment_count:
        typeof installment === 'string' && INSTALLMENT_TEXT.test(installment)
          ? normalizedInstallment(Number(installment))
          : null,
    }
  }

  /**
   * One signed status request for the order id, and the first way in which the bank's answer does not show exactly
   * one completed, open sale of this order id, amount and currency (null when it does). Every check reads the answer
   * exactly as the bank sent it.
   */
  private async bankRecordConfirms(orderId: string, expected: OrderExpectations): Promise<Confirmation> {
    const statusOrder: PosOrder = { id: orderId }
    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createStatusRequestData(this.account, statusOrder),
      TX_TYPE.STATUS,
      statusOrder,
      MODEL.NON_SECURE,
    )
    const answer = await this.sendRequest(TX_TYPE.STATUS, MODEL.NON_SECURE, requestData, statusOrder)
    const mapped = this.responseDataMapper.mapStatusResponse(answer)

    const orderData = own(answer, 'VPosOrderData')
    const contract = isRecord(orderData) ? own(orderData, 'OrderContract') : undefined
    const record = isRecord(contract) ? contract : {}
    const closed = (failure: Mismatch): Confirmation => ({ record, failure })

    if (mapped.status !== TX_APPROVED || textOf(answer, 'ResponseCode') !== SUCCESS_CODE) {
      return closed(['order_status', TX_APPROVED, asText(mapped.status)])
    }
    // A list means several records for one order id (a sale and its reversal): the sale is not open.
    if (!isRecord(contract)) {
      return closed(['order_status', 'one order record', Array.isArray(contract) ? 'several records' : 'no record'])
    }

    const recordOrderId = textOf(record, 'MerchantOrderId')
    if (recordOrderId !== orderId) {
      return closed(['order_id', orderId, recordOrderId ?? ''])
    }

    for (const [key, wanted] of [
      ['ResponseCode', SUCCESS_CODE],
      ['TransactionStatus', TRANSACTION_SUCCESSFUL],
      ['OrderStatus', SALE_COMPLETED],
      ['LastOrderStatus', SALE_COMPLETED],
    ] as const) {
      const actual = textOf(record, key)
      if (actual !== wanted) {
        return closed(['order_status', `${key} ${wanted}`, `${key} ${actual ?? ''}`])
      }
    }

    // A sale without 3D (which anyone holding the hashed password could make through the API) is no 3D Host payment.
    const security = textOf(record, 'TransactionSecurity')
    if (security !== undefined && (security === null || security === NON_SECURE_SECURITY)) {
      return closed(['order_status', 'a 3D transaction', `TransactionSecurity ${security ?? ''}`])
    }

    const amount = textOf(record, 'FirstAmount')
    if (typeof amount !== 'string' || !RECORD_AMOUNT.test(amount) || amount !== expected.amountText) {
      return closed(['amount', expected.amountText, amount ?? ''])
    }

    const currency = textOf(record, 'FEC')
    if (typeof currency !== 'string' || !isCurrencyCode(currency, expected.currency)) {
      return closed(['currency', expected.currency, currency ?? ''])
    }

    const installmentFailure = this.installmentMismatch(record, expected.installment)
    if (installmentFailure !== null) {
      return closed(installmentFailure)
    }

    for (const key of ['CancelAmount', 'DrawbackAmount'] as const) {
      const reversed = textOf(record, key)
      if (reversed !== undefined && reversed !== '' && (reversed === null || !ZERO_AMOUNT.test(reversed))) {
        return closed(['order_status', 'open', `${key} ${reversed ?? ''}`])
      }
    }

    if (!PROVISION_NUMBER.test(textOf(record, 'ProvNumber') ?? '')) {
      return closed(['order_status', TX_APPROVED, 'no authorization code'])
    }

    return { record, failure: null }
  }

  /**
   * The bank's page may offer installments, so a record's count is compared only when the order states one; one
   * installment is a single payment, like none.
   */
  private installmentMismatch(record: Record<string, unknown>, expected: number | null): Mismatch | null {
    if (expected === null) {
      return null
    }
    const text = textOf(record, 'InstallmentCount')
    if (text === undefined) {
      return expected === 0 ? null : ['installment', String(expected), '']
    }
    if (text === null || !INSTALLMENT_TEXT.test(text) || normalizedInstallment(Number(text)) !== expected) {
      return ['installment', String(expected), text ?? '']
    }

    return null
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

  /**
   * The order values a bank answer is compared with, read once before any request: an amount the bank cannot be
   * sent, a currency it does not know or an installment count that is not one is a `PosError` while no money moved.
   */
  private orderExpectations(order: PosOrder): OrderExpectations {
    const amount = parseOrderAmount(order.amount)
    const currencyCode = order.currency ?? CURRENCY.TRY
    const installment =
      order.installment === undefined || order.installment === null
        ? null
        : normalizedInstallment(parseInstallment(order.installment))

    return {
      kurus: String(toKurus(amount)),
      amountText: numberFormat2(amount),
      currencyCode,
      currency: String(this.requestValueMapper.mapCurrency(currencyCode)),
      installment,
    }
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
