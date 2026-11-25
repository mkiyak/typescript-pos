import { hideSecrets } from '../client/AbstractHttpClient.js'
import { PayTrPosHttpClient } from '../client/PayTrPosHttpClient.js'
import {
  payTrOrderAmount,
  payTrOrderCore,
  payTrOrderFields,
  payTrOrderId,
} from '../data-mapper/request/mapper/PayTrPosRequestDataMapper.js'
import { payTrDecimalKurus, payTrPlainText } from '../data-mapper/response/mapper/PayTrPosResponseDataMapper.js'
import { TX_APPROVED, TX_DECLINED } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { PayTrPosResponseValueMapper } from '../data-mapper/response/value-mapper/PayTrPosResponseValueMapper.js'
import {
  HashMismatchError,
  OrderMismatchError,
  type OrderMismatchField,
  PosError,
  PosHttpError,
  UnsupportedFormFormatError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../errors.js'
import type { PayTrPosAccount } from '../model/account/PayTrPosAccount.js'
import type { CreditCard } from '../model/card/CreditCard.js'
import {
  type Currency,
  FORM_FORMAT,
  type FormFormat,
  MODEL,
  type PaymentModel,
  TX_TYPE,
  type TxType,
} from '../PosInterface.js'
import type { GatewayResponseData, PosOrder, PosResponse, ThreeDFormData } from '../types.js'
import { ownValue } from '../util/ownValue.js'
import { toKurus } from '../util/toKurus.js'
import { AbstractGateway, type SupportedTransactions } from './AbstractGateway.js'
import {
  approvedNotificationResult,
  echo,
  flatNotification,
  MAX_TEXT_LENGTH,
  NOTIFICATION_SUCCESS,
  notificationOrderId,
  ownText,
  paymentAmountMatches,
  readsAsApproval,
  signedDecline,
  signedTotalKurus,
  totalAmountAccepted,
  trustedBrowserDecline,
} from './payTrNotification.js'

/** An iFrame token becomes a URL path segment. */
const TOKEN = /^[A-Za-z0-9._~-]{1,512}$/

/** A total amount in kuruş as a sale answer may echo it: a positive whole number without padding. */
const KURUS = /^[1-9]\d{0,14}$/

/** The answer word of a processed request. */
const SUCCESS = 'success'

/** The answer word of a non-secure sale whose result PayTR will report to the notification URL instead. */
const WAIT_CALLBACK = 'wait_callback'

/** The answer words of a refused request. */
const SALE_DECLINED = new Set(['failed'])
const REFUND_DECLINED = new Set(['failed', 'error'])

/** Currency names of notifications (`TL`, `TRY`, …); a stateless table. */
const CURRENCY_NAMES = new PayTrPosResponseValueMapper()

const TOKEN_FAILURE = 'PayTR iFrame token request failed'

type NotifiedModel = typeof MODEL.THREE_D_PAY | typeof MODEL.THREE_D_HOST

/** The order values a notification or a bank answer is compared with, read before anything else. */
type OrderExpectations = {
  orderId: string
  /** The amount in kuruş. */
  kurus: number
  currency: Currency
  installment: number
}

/**
 * PayTR virtual POS: 3D Host (iFrame API: the server asks for a token, the payer's browser opens PayTR's page for
 * it), 3D Pay (Direct API: a form the payer's browser posts to PayTR, with or without the card), non-secure sales,
 * status, and full and partial refunds. Every request is signed with a token over its own fields and the merchant
 * salt, keyed with the merchant key. `onRequestDataPrepared` hooks run after the token is computed: a hook that changes
 * a signed field makes PayTR refuse the request (it never goes out signed over other values).
 *
 * The result of a 3D Host or 3D Pay payment is never delivered by the browser. PayTR posts it server to server to
 * the notification URL configured in the merchant panel, signed with `hash`: base64 HMAC-SHA256 with the merchant
 * key over the order id, the merchant salt, the status word and the total amount in kuruş, without separators. The
 * currency, the payment amount, the installment count, the test flag and the failure reasons are not signed. The
 * success page receives nothing; the fail page receives only a `fail_message`. Both flows end in one call:
 * `payment(MODEL.THREE_D_PAY | MODEL.THREE_D_HOST, order, 'pay', null, body)`, with the order the body belongs to
 * (`PayTrPos.notificationOrderId(body)` reads the order id to look it up; that id is not verified). A non-secure sale
 * also produces a notification; handle it with `MODEL.THREE_D_PAY`. The checks:
 * - The body is a plain record of strings, otherwise a `PosError` before anything else. Then the order is validated
 *   (id, amount, currency, installment count), so a bad order fails while nothing was read. An empty body is a
 *   `PosError`: the success page receives no data, only "the payment is being processed" can be shown there.
 * - A body without a `hash` (or with an empty one) is a browser return. It is rejected (`HashMismatchError`) when
 *   `require_3d_hash` is set, and always when it reads as an approval (a status `success` in any case or padding, or
 *   a positive total amount). Otherwise its result is a decline built from the order: the order's id, the fail
 *   page's text as plain text of at most 256 characters, and nothing else (no amount, code or reference). It never
 *   changes an order; only a verified notification does.
 * - A present `hash` is always verified (`disable_3d_hash_check` is ignored); a mismatch is a `HashMismatchError`.
 *   No request is ever sent for a notification: it comes from PayTR's server and is signed with a key the browser
 *   never sees, over the order id, the status and the amount.
 * - A verified notification must name this order, otherwise an `OrderMismatchError('order_id')` with nothing
 *   attached: the handler loaded the wrong order, whose own notification deals with it.
 * - Only the exact status `success` is an approval. Any other verified notification is a decline with the order's
 *   id, the failure code when it is a short token, the failure text as plain text of at most 256 characters, and no
 *   amount, currency or installment count; a decline that the mapper does not map as declined is a `PosError`.
 * - An approval's total must be a positive whole number of kuruş without padding, otherwise
 *   `HashMismatchError('3D callback fields are malformed')`. The secret salt separates the order id from the
 *   status, and with the status exactly `success` and the total digits only no other reading of a genuine signature
 *   is an approval. A notification flagged `test_mode` `1` never approves an order of a gateway that is not in test
 *   mode (`OrderMismatchError('test_mode')`, nothing attached): a test payment moves no money, and one notification
 *   URL may serve a staging store with the same order ids. The total must equal the order amount in kuruş, or be at
 *   least the order amount for an installment order (the payer may pick a plan with a fee); the unsigned
 *   `payment_amount` and `currency`, when sent, must be the order's. Each of these is an `OrderMismatchError` with
 *   the approved result attached (`paymentMayHaveCompleted`: the signature proves this order was charged; refund
 *   it). The approved result takes the order's id and currency and the signed total as its amount.
 * - PayTR reports one final status and no separate 3D result, so a payment is never approved by the bank and failed
 *   by 3D at the same time.
 * - The library keeps no state: a repeated notification gives the same result each time. The merchant answers `OK`
 *   (plain text, nothing else) once the result is stored, also to duplicates and verified declines, acts on the
 *   first verified result and never downgrades an approved order because of a later notification; PayTR repeats a
 *   notification until it gets `OK`. Answer an error for a `HashMismatchError` or `PosError` and investigate.
 *
 * The 3D Pay form, its token included, is in the payer's browser, and the token signs adjacent values without
 * separators: the payer can regroup them (for example move a digit from the amount into the e-mail) and PayTR still
 * accepts the form. The library cannot prevent that; the notification check above catches every such payment (its
 * signed total differs from the order amount, or it names another order). The 3D Host token request is made server
 * to server and has no such residual, so 3D Host is the recommended model.
 *
 * After a non-secure sale or a refund, an answer whose status is not one of the documented words (empty, 204, blank,
 * not JSON, padded, `wait_callback` for a sale) is a `PosHttpError` naming the request URL: it does not tell whether
 * money moved, so it is never a decline a merchant could retry. An approved answer for another order id or with
 * another amount is an `OrderMismatchError` with the result attached. Status answers are mapped as they come.
 */
export class PayTrPos extends AbstractGateway<PayTrPosAccount> {
  static readonly NAME = 'PayTrPos'

  static override readonly GATEWAY_CLASS: string = 'PayTrPos'

  protected static override readonly testModeAffectsRequests: boolean = true

  protected static override supportedTransactions: SupportedTransactions = {
    [TX_TYPE.PAY_AUTH]: [MODEL.THREE_D_HOST, MODEL.THREE_D_PAY, MODEL.NON_SECURE],
    [TX_TYPE.STATUS]: true,
    [TX_TYPE.REFUND]: true,
    [TX_TYPE.REFUND_PARTIAL]: true,
  }

  /**
   * The order id a notification names, to look the order up before calling `payment()`. It is not verified:
   * `payment()` verifies the signature and binds the notification to the order it is given.
   *
   * @throws PosError when the body has no own `merchant_oid` in the order id format
   */
  static notificationOrderId(body: unknown): string {
    return notificationOrderId(body)
  }

  /** @throws UnsupportedPaymentModelError PayTR has no 3D Secure model with a separate provision */
  async make3DPayment(
    _gatewayResponseData: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
    _card: CreditCard | null = null,
  ): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError('PayTrPos does not support the 3D Secure model')
  }

  /**
   * The notification (or the fail page's return) of a 3D Pay payment or a non-secure sale.
   *
   * @throws PosError when the body is not a flat record of strings, is empty, or the order is malformed
   * @throws HashMismatchError when the hash does not verify, an unsigned body reads as an approval or a hash is
   *   required, or the signed total of an approval is malformed
   * @throws OrderMismatchError when the notification does not belong to the order (nothing attached), is a test
   *   payment for a live gateway (nothing attached), or its amount or currency does not fit the order (approved
   *   result attached)
   */
  async make3DPayPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
  ): Promise<PosResponse> {
    return this.completeNotification(gatewayResponseData, order, txType, MODEL.THREE_D_PAY)
  }

  /** The notification (or the fail page's return) of a 3D Host payment; same checks as `make3DPayPayment`. */
  async make3DHostPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
  ): Promise<PosResponse> {
    return this.completeNotification(gatewayResponseData, order, txType, MODEL.THREE_D_HOST)
  }

  /**
   * 3D Host: one signed token request, then the PayTR page of the token (GET, no inputs) for an iframe `src` or a
   * redirect; it holds no secret. 3D Pay: no request; the POST form of the Direct API. With a card the form holds the
   * card (render it into an auto-submitted form, never log or store it); with `createWithoutCard` the payer's browser
   * adds `cc_owner`, `card_number`, `expiry_month` (`01`–`12`), `expiry_year` (two digits) and `cvv` and posts
   * straight to PayTR. Render every input attribute-escaped: the basket is JSON text with quotes.
   *
   * @throws UnsupportedFormFormatError for `formFormat: 'html'`
   * @throws PosError when the token request is refused or its answer holds no usable token
   */
  async get3DFormData(
    order: PosOrder,
    paymentModel: PaymentModel,
    txType: TxType,
    card: CreditCard | null = null,
    createWithoutCard = false,
    formFormat: FormFormat | null = null,
  ): Promise<ThreeDFormData> {
    this.check3DFormInputs(paymentModel, txType, card, createWithoutCard)

    if (formFormat === FORM_FORMAT.HTML) {
      throw new UnsupportedFormFormatError('Unsupported 3D form format!')
    }

    if (paymentModel === MODEL.THREE_D_HOST) {
      return this.initIFramePayment(order, txType)
    }

    this.logger.debug('preparing 3D Pay form data', { tx_type: txType })

    return this.requestDataMapper.create3DFormData(
      this.account,
      order,
      paymentModel,
      txType,
      this.get3DGatewayURL(paymentModel),
      this.cardForForm(card, createWithoutCard),
    ) as Promise<ThreeDFormData>
  }

  /**
   * The non-secure sale. Only `success` and `failed` are results; anything else is an unknown outcome.
   *
   * @throws PosError when the order is malformed (before any request)
   * @throws PosHttpError when the answer does not tell the outcome (`wait_callback`, empty, unreadable)
   * @throws OrderMismatchError when an approval names another order id or another total (result attached)
   */
  override async makeRegularPayment(order: PosOrder, card: CreditCard, txType: TxType): Promise<PosResponse> {
    const paymentModel = MODEL.NON_SECURE
    this.logger.debug('making payment', { model: paymentModel, tx_type: txType })
    if (!this.gatewayClass().isSupportedTransaction(txType, paymentModel)) {
      throw new UnsupportedTransactionTypeError(`Invalid transaction type "${txType}" provided`)
    }
    // Every order value is checked before the request, so a bad order never turns a booked payment into an error.
    const fields = payTrOrderFields(order)
    const expected = { ...fields, kurus: toKurus(fields.amount) }

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createNonSecurePaymentRequestData(this.account, order, txType, card),
      txType,
      order,
      paymentModel,
    )
    const { answer, status } = await this.sendMoneyRequest(txType, requestData, order, SALE_DECLINED)

    const mapped = this.responseDataMapper.mapPaymentResponse(answer, txType, order)
    if (status !== SUCCESS) {
      return this.bankDecline(mapped, expected.orderId)
    }

    const response = this.bankApproval(mapped, expected.orderId, { currency: expected.currency })
    this.assertAnswerOrderId(answer, expected.orderId, response)
    const total = ownText(answer, 'total_amount')
    if (Object.hasOwn(answer, 'total_amount')) {
      const kurus = total !== undefined && KURUS.test(total) ? Number(total) : null
      if (kurus === null || !totalAmountAccepted(kurus, expected.kurus, expected.installment)) {
        this.fail('amount', String(expected.kurus), echo(total), expected.orderId, response)
      }
    }

    return response
  }

  /**
   * Full refund, or partial refund when `order.order_amount` is set and `order.amount` is lower. Only `success`,
   * `failed` and `error` are results; anything else is an unknown outcome: query `status()` and compare its refunds
   * (by `reference_no`) before retrying, since a retried refund may refund twice.
   *
   * @throws PosError when the order id or the amount is malformed (before any request)
   * @throws PosHttpError when the answer does not tell the outcome
   * @throws OrderMismatchError when an approval names another order id or another amount (result attached)
   */
  override async refund(order: PosOrder): Promise<PosResponse> {
    const paymentModel = MODEL.NON_SECURE
    const orderId = payTrOrderId(order)
    const kurus = toKurus(payTrOrderAmount(order))
    let txType: TxType = TX_TYPE.REFUND
    const orderAmount = order.order_amount
    if (orderAmount !== undefined && orderAmount !== null && Number(order.amount) < Number(orderAmount)) {
      txType = TX_TYPE.REFUND_PARTIAL
    }

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createRefundRequestData(this.account, order, txType),
      txType,
      order,
      paymentModel,
    )
    const { answer, status } = await this.sendMoneyRequest(txType, requestData, order, REFUND_DECLINED)

    const mapped = this.responseDataMapper.mapRefundResponse(answer)
    if (status !== SUCCESS) {
      return this.bankDecline(mapped, orderId)
    }

    const response = this.bankApproval(mapped, orderId, {})
    this.assertAnswerOrderId(answer, orderId, response)
    if (Object.hasOwn(answer, 'return_amount') && payTrDecimalKurus(answer.return_amount) !== kurus) {
      this.fail('amount', String(kurus), echo(ownText(answer, 'return_amount')), orderId, response)
    }

    return response
  }

  private async initIFramePayment(order: PosOrder, txType: TxType): Promise<ThreeDFormData> {
    const paymentModel = MODEL.THREE_D_HOST
    const requestTxType = TX_TYPE.INTERNAL_3D_FORM_BUILD
    this.logger.debug('fetching PayTR iFrame token', { tx_type: txType })

    const requestData = await this.dispatchRequestDataPrepared(
      await this.requestDataMapper.create3DFormInitializeRequestData(this.account, order, paymentModel, txType),
      requestTxType,
      order,
      paymentModel,
    )
    const answer = await this.sendRequest(requestTxType, paymentModel, requestData, order)

    const token = ownText(answer, 'token')
    if (ownText(answer, 'status') !== SUCCESS || token === undefined || !TOKEN.test(token)) {
      this.logger.error(TOKEN_FAILURE, { status: echo(ownText(answer, 'status')) })
      const reason = payTrPlainText(answer, 'reason', MAX_TEXT_LENGTH)
      // A bank text may echo what it was sent; the request token and the account secrets are masked.
      const sentToken = ownText(requestData, 'paytr_token')
      const secrets = [sentToken ?? '', this.account.getPassword(), this.account.getSecretKey()]
      throw new PosError(reason === null ? TOKEN_FAILURE : `${TOKEN_FAILURE}: ${hideSecrets(reason, secrets)}`)
    }

    return this.requestDataMapper.create3DFormData(
      this.account,
      order,
      paymentModel,
      txType,
      this.get3DGatewayURL(paymentModel),
      null,
      answer,
    ) as Promise<ThreeDFormData>
  }

  private async completeNotification(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    paymentModel: NotifiedModel,
  ): Promise<PosResponse> {
    // A direct call skips the table check of `payment()`; a notification only ever reports a sale.
    if (txType !== TX_TYPE.PAY_AUTH) {
      throw new UnsupportedTransactionTypeError(`Invalid transaction type "${txType}" provided`)
    }
    const body = this.flatBody(gatewayResponseData)
    if (Object.getOwnPropertyNames(body).length === 0) {
      throw new PosError('PayTR reports the payment result to the notification URL; the success page receives no data')
    }
    // Every order value the notification is compared with fails here, before anything is read.
    const expected = this.orderExpectations(order)

    const hash = ownText(body, 'hash')
    if (hash === undefined || hash === '') {
      return this.browserReturn(body, expected.orderId, order, txType, paymentModel)
    }

    if (!this.crypt.check3DHash(this.account, body)) {
      this.logger.error('3D callback hash mismatch', { order_id: echo(ownText(body, 'merchant_oid')) })
      throw new HashMismatchError('3D callback hash mismatch')
    }

    const notifiedOrderId = ownText(body, 'merchant_oid') ?? ''
    if (notifiedOrderId !== expected.orderId) {
      this.fail('order_id', expected.orderId, notifiedOrderId, expected.orderId)
    }

    const mapped = this.mapNotification(body, txType, order, paymentModel)
    if (ownText(body, 'status') !== NOTIFICATION_SUCCESS) {
      if (mapped.status !== TX_DECLINED) {
        this.logger.error('3D callback without approval was mapped as approved', { order_id: expected.orderId })
      }
      return signedDecline(mapped, body, expected.orderId)
    }

    return this.approveNotification(body, mapped, expected, txType, paymentModel)
  }

  /** The checks of a verified approval of this order, in order; the approved result is attached from the third on. */
  private approveNotification(
    body: Record<string, string>,
    mapped: PosResponse,
    expected: OrderExpectations,
    txType: TxType,
    paymentModel: NotifiedModel,
  ): PosResponse {
    let total: number
    try {
      total = signedTotalKurus(body)
    } catch (e) {
      this.logger.error('3D callback fields are malformed', { order_id: expected.orderId, fields: ['total_amount'] })
      throw e
    }

    // On a live gateway only an absent, empty or "0" flag is accepted: any other spelling of a test flag is refused.
    const testFlag = ownValue(body, 'test_mode')
    if (!this.isTestMode() && testFlag !== undefined && testFlag !== '' && testFlag !== '0') {
      this.fail('test_mode', '0', typeof testFlag === 'string' ? testFlag : '[unreadable]', expected.orderId)
    }

    const response = approvedNotificationResult(
      mapped,
      body,
      expected.orderId,
      expected.currency,
      total,
      paymentModel,
      txType,
    )

    if (!totalAmountAccepted(total, expected.kurus, expected.installment)) {
      this.fail('amount', String(expected.kurus), String(total), expected.orderId, response)
    }

    const paymentAmount = ownText(body, 'payment_amount')
    if (paymentAmount !== undefined && !paymentAmountMatches(paymentAmount, expected.kurus)) {
      this.fail('amount', String(expected.kurus), echo(paymentAmount), expected.orderId, response)
    }

    const currency = ownText(body, 'currency')
    if (currency !== undefined && CURRENCY_NAMES.mapCurrency(currency) !== expected.currency) {
      this.fail('currency', expected.currency, echo(currency), expected.orderId, response)
    }

    this.logger.info('verified notification approves the order', { order_id: expected.orderId })

    return response
  }

  /** The fail page's return (or any body without a hash): a bounded decline at most, never an approval. */
  private browserReturn(
    body: Record<string, string>,
    orderId: string,
    order: PosOrder,
    txType: TxType,
    paymentModel: NotifiedModel,
  ): PosResponse {
    if (readsAsApproval(body) || this.config.require_3d_hash === true) {
      this.logger.error('3D callback has no hash', { order_id: orderId })
      throw new HashMismatchError('3D callback has no hash')
    }
    // The mapped result is not used: only the order's id and the failure text are kept.
    this.mapNotification(body, txType, order, paymentModel)

    return trustedBrowserDecline(body, orderId, txType, paymentModel)
  }

  private mapNotification(
    body: Record<string, string>,
    txType: TxType,
    order: PosOrder,
    paymentModel: NotifiedModel,
  ): PosResponse {
    return paymentModel === MODEL.THREE_D_HOST
      ? this.responseDataMapper.map3DHostResponseData(body, txType, order)
      : this.responseDataMapper.map3DPayResponseData(body, txType, order)
  }

  private flatBody(gatewayResponseData: GatewayResponseData): Record<string, string> {
    try {
      return flatNotification(gatewayResponseData)
    } catch (e) {
      this.logger.error('3D callback is not a flat record of strings')
      throw e
    }
  }

  /** The order id, the amount in kuruş, the currency and the installment count; a malformed value is a `PosError`. */
  private orderExpectations(order: PosOrder): OrderExpectations {
    const core = payTrOrderCore(order)

    return {
      orderId: core.orderId,
      kurus: toKurus(core.amount),
      currency: core.currency,
      installment: core.installment,
    }
  }

  /**
   * Sends a sale or refund and reads its status word before anything is mapped: only the documented result words
   * tell whether money moved.
   */
  private async sendMoneyRequest(
    txType: TxType,
    requestData: Record<string, unknown>,
    order: PosOrder,
    declineWords: ReadonlySet<string>,
  ): Promise<{ answer: Record<string, unknown>; status: string }> {
    const paymentModel = MODEL.NON_SECURE
    const client = this.getClient(txType, paymentModel)
    const answer = await client.request(txType, paymentModel, requestData, order, null)
    const url =
      client instanceof PayTrPosHttpClient ? client.getApiUrl(txType) : this.config.gateway_endpoints.payment_api
    const status = ownText(answer, 'status')
    const orderId = ownText(requestData, 'merchant_oid')

    if (status === WAIT_CALLBACK && txType === TX_TYPE.PAY_AUTH) {
      this.logger.warn('payment outcome pending', { order_id: echo(orderId), tx_type: txType })
      throw new PosHttpError('Payment outcome pending: PayTR reports it to the notification URL', { url })
    }
    if (status === undefined || (status !== SUCCESS && !declineWords.has(status))) {
      this.logger.error('bank answer carries no result', { order_id: echo(orderId), tx_type: txType })
      throw new PosHttpError('Bank answer carries no result; the payment outcome is unknown', { url })
    }

    return { answer, status }
  }

  /** A refused sale or refund: the mapped decline with the order's id. */
  private bankDecline(mapped: PosResponse, orderId: string): PosResponse {
    if (mapped.status !== TX_DECLINED) {
      this.logger.error('refused request was not mapped as declined', { order_id: orderId })
      throw new PosError('Refused request was not mapped as declined')
    }

    return { ...mapped, order_id: orderId }
  }

  /** An approved sale or refund: the mapped approval with the order's id (and, for a sale, its currency). */
  private bankApproval(mapped: PosResponse, orderId: string, extra: { currency?: Currency }): PosResponse {
    if (mapped.status !== TX_APPROVED) {
      this.logger.error('approved request was not mapped as approved', { order_id: orderId })
      throw new PosError('Approved request was not mapped as approved')
    }

    return { ...mapped, order_id: orderId, ...extra }
  }

  /** An approval names this order id when it names one. */
  private assertAnswerOrderId(answer: Record<string, unknown>, orderId: string, response: PosResponse): void {
    if (!Object.hasOwn(answer, 'merchant_oid')) return
    const answerOrderId = ownText(answer, 'merchant_oid')
    if (answerOrderId !== orderId) {
      this.fail('order_id', orderId, echo(answerOrderId), orderId, response)
    }
  }

  private fail(
    field: OrderMismatchField,
    expected: string,
    actual: string,
    orderId: string,
    response?: PosResponse,
  ): never {
    this.logger.error(`${field} does not match the order`, {
      field,
      expected: echo(expected),
      actual: echo(actual),
      order_id: echo(orderId),
    })
    throw new OrderMismatchError(field, echo(expected), echo(actual), response)
  }
}
