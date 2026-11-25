import { hideSecrets } from '../client/AbstractHttpClient.js'
import { IyzicoPosHttpClient } from '../client/IyzicoPosHttpClient.js'
import type { IyzicoPosCrypt, IyzicoSignedAnswer } from '../crypt/IyzicoPosCrypt.js'
import {
  asOrder,
  iyzicoAddress,
  iyzicoBasketItems,
  iyzicoBuyer,
  iyzicoOrderCurrency,
  iyzicoOrderId,
  iyzicoOrderInstallment,
  iyzicoOrderKurus,
  iyzicoPaymentId,
} from '../data-mapper/request/mapper/iyzicoOrderFields.js'
import { TX_APPROVED, TX_DECLINED } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
import {
  HashMismatchError,
  OrderMismatchError,
  PosError,
  UnsupportedFormFormatError,
  UnsupportedTransactionTypeError,
} from '../errors.js'
import type { IyzicoPosAccount } from '../model/account/IyzicoPosAccount.js'
import type { CreditCard } from '../model/card/CreditCard.js'
import { FORM_FORMAT, type FormFormat, MODEL, type PaymentModel, TX_TYPE, type TxType } from '../PosInterface.js'
import type { GatewayResponseData, PosOrder, PosResponse, ThreeDFormData } from '../types.js'
import { ownValue } from '../util/ownValue.js'
import { isSet } from '../util/required.js'
import { AbstractGateway, type GatewayConfig, type GatewayDeps, type SupportedTransactions } from './AbstractGateway.js'
import {
  answerOutcome,
  approvedFromAnswer,
  assertCallbackApprovalPins,
  assertCallbackOrder,
  assertFlatIyzicoCallback,
  bindCancelAnswer,
  bindCheckoutRecord,
  bindPaymentAnswer,
  bindRefundAnswer,
  bindStatusPaymentId,
  callbackHasSignature,
  checkoutPaymentCompleted,
  declinedFromAnswer,
  heldForReview,
  type IyzicoPaymentExpectation,
  iyzicoCode,
  iyzicoPlainText,
  MAX_ECHOED_LENGTH,
  MAX_TEXT_LENGTH,
  requireSignedAnswer,
  reviewFlags,
  signedCallbackApproves,
  trustedDecline,
  unsignedCallbackReadsAsApproval,
} from './iyzicoAnswers.js'

/** Checkout form tokens: letters, digits and hyphens. */
const TOKEN = /^[A-Za-z0-9-]{1,128}$/

/** Strict base64: the standard alphabet, padded to whole quads. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/** A hosted page address as the payer's browser receives it: https, printable ASCII, no blanks. */
const HTTPS_PAGE = /^https:\/\/[\x21-\x7E]+$/

const ANSWER_SUCCESS = 'success'

const FORM_FAILURE = 'iyzico 3D form could not be created'
/** A run of 12 to 19 digits, which may be grouped by single spaces or dashes: shaped like a card number. */
const CARD_LIKE_DIGITS = /\d(?:[ -]?\d){11,18}/g

/** The phase a signed payment answer must report for each payment transaction. */
const PHASES = {
  [TX_TYPE.PAY_AUTH]: 'AUTH',
  [TX_TYPE.PAY_PRE_AUTH]: 'PRE_AUTH',
  [TX_TYPE.PAY_POST_AUTH]: 'POST_AUTH',
} as const

type PaymentTxType = typeof TX_TYPE.PAY_AUTH | typeof TX_TYPE.PAY_PRE_AUTH

/** The order values every answer is compared with, read before any request. */
type OrderValues = {
  orderId: string
  /** The amount in kuruş. */
  kurus: number
  currency: string
}

/** How a signed payment answer is turned into a result. */
type PaymentSettlement = {
  order: PosOrder
  orderId: string
  txType: TxType
  paymentModel: PaymentModel
  /** The mapper's view of the answer, computed only once the verdict is known. */
  map: () => PosResponse
  expectation: IyzicoPaymentExpectation
  /** Whether a present 3D status that is not `1` holds the payment for review (3D Secure and hosted payments). */
  checkMdStatus: boolean
}

/** The request the 3D Host result is read with: iyzico's checkout record of the callback's token. */
type CheckoutRequestDataMapper = {
  create3DHostPaymentStatusRequestData(responseData: Record<string, unknown>, order: PosOrder): Record<string, unknown>
}

/** The answer signature check of the iyzico crypt. */
type AnswerSignatureCrypt = Pick<IyzicoPosCrypt, 'checkResponseSignature'>

function isPaymentTx(txType: TxType): txType is PaymentTxType {
  return txType === TX_TYPE.PAY_AUTH || txType === TX_TYPE.PAY_PRE_AUTH
}

/** An own string field; anything else reads as undefined. */
function ownString(data: Record<string, unknown>, key: string): string | undefined {
  const value: unknown = ownValue(data, key)
  return typeof value === 'string' ? value : undefined
}

/**
 * iyzico: 3D Secure (initialize with the card → the bank's page → signed browser callback → authorization), 3D Host
 * (Checkout Form: initialize → iyzico's page → callback with a token → retrieve), non-secure sale and
 * pre-authorization, capture, cancel, full and partial refund, status and order history. Every request carries an
 * `Authorization` header computed by the client from the exact URL path and body it sends; `onRequestDataPrepared`
 * hooks run before that, so a hook may change any field.
 *
 * Forms. The initialize answer must report `success` exactly, otherwise a `PosError` with iyzico's text (plain, at most
 * 256 characters, secrets hidden). A signature on the answer must verify (`HashMismatchError`) and a conversation id on
 * it must be the order id (`OrderMismatchError`, nothing attached). 3D Secure returns the decoded `threeDSHtmlContent`
 * page; it needs the card even with `createWithoutCard`, because iyzico's initialize takes the card. 3D Host never
 * sends a card and returns `checkoutFormContent` (HTML), or with `formFormat: 'array'` the https payment page of the
 * token for a redirect.
 *
 * 3D Secure callback. The body must be a plain record of strings, and the order (id, amount, currency, installment
 * count) must be valid, before anything is read. A callback with a `signature` is always verified (the HMAC over
 * `conversationData:conversationId:mdStatus:paymentId:status`; `disable_3d_hash_check` is ignored), then bound to the
 * order by its conversation id (another order's callback is an `OrderMismatchError` with nothing attached). Only an
 * exact `success` with 3D status exactly `1` and a payment id of plain digits is an approval; any other signed callback
 * is a decline built from the order, and nothing is sent. A callback without a signature is refused when it reads as an
 * approval or `require_3d_hash` is set, otherwise it maps only as a decline carrying the order's id. The signed payment
 * id is the only callback value that reaches the authorization request; the amount, basket id and currency are the
 * order's, and iyzico refuses them unless they match the initialize call of that payment. The signature carries no
 * amount, so the money binding happens on the authorization answer.
 *
 * 3D Host callback. The body carries only a `token` (letters, digits, hyphens), which nothing on the merchant side can
 * verify, so the result always comes from iyzico's signed checkout record of that token. The record must verify, and
 * its token, basket id and conversation id must be this checkout's and this order's: a signed record of another
 * checkout proves nothing about this order (`OrderMismatchError`, nothing attached). Its payment status must be exactly
 * `SUCCESS`, otherwise the checkout did not complete and the result is a decline. The basket total must equal the order
 * amount, and the charged amount may be higher (installment fees on iyzico's page); the result carries the charged
 * amount. `require_3d_hash` has no effect.
 *
 * Answers after a money request (authorization, sale, capture, cancel, refund). Only an exact `success` or `failure`
 * is a result; anything else (empty, 204, not JSON, a byte order mark, another word, an HTTP error) is a `PosHttpError`:
 * money may have moved, so check `status()` or `orderHistory()` before any retry. A `failure` is a decline with the
 * order's id and iyzico's bounded code and text. A `success` must carry a valid answer signature (cancel answers carry
 * none), otherwise it is a `PosHttpError` as well. It is then bound to the order: conversation and basket id, payment
 * id, currency, basket total and charged amount (whole kuruş), and phase; each mismatch is an `OrderMismatchError` with
 * the approved result attached (`paymentMayHaveCompleted`: this request was sent for this order, refund or void it).
 * The result takes the order's id and currency, the signed charged amount and the signed payment id.
 *
 * Fraud review. iyzico answers `fraudStatus` `1` (cleared), `0` (in review: do not ship) or `-1` (rejected). Anything
 * but `1` on a payment, an authorization, a checkout record or a capture, and a 3D status that is present and not `1`
 * on an authorization or a checkout record, makes the result `declined` with `requires_manual_review`: the card was
 * charged or held, but the payment is not cleared; wait for iyzico's decision and check `status()`.
 *
 * Status answers are read-only: a `success` must verify (`HashMismatchError` otherwise) and must name the order id
 * asked for. iyzico's status does not show cancels or refunds; use `orderHistory()`, an unsigned reporting answer.
 */
export class IyzicoPos extends AbstractGateway<IyzicoPosAccount> {
  static readonly NAME = 'IyzicoPos'

  static override readonly GATEWAY_CLASS: string = 'IyzicoPos'

  protected static override readonly testModeAffectsRequests: boolean = false

  protected static override supportedTransactions: SupportedTransactions = {
    [TX_TYPE.PAY_AUTH]: [MODEL.THREE_D_SECURE, MODEL.NON_SECURE, MODEL.THREE_D_HOST],
    [TX_TYPE.PAY_PRE_AUTH]: [MODEL.THREE_D_SECURE, MODEL.NON_SECURE, MODEL.THREE_D_HOST],
    [TX_TYPE.PAY_POST_AUTH]: true,
    [TX_TYPE.CANCEL]: true,
    [TX_TYPE.REFUND]: true,
    [TX_TYPE.REFUND_PARTIAL]: true,
    // iyzico's payment detail does not report cancels or refunds; the order history does.
    [TX_TYPE.STATUS]: true,
    [TX_TYPE.ORDER_HISTORY]: true,
  }

  readonly #checkoutRequestDataMapper: CheckoutRequestDataMapper
  readonly #answerCrypt: AnswerSignatureCrypt

  /**
   * @throws PosError when the request data mapper cannot build the checkout record request or the crypt cannot
   *   verify iyzico's answer signatures
   */
  constructor(config: GatewayConfig, account: IyzicoPosAccount, deps: GatewayDeps<IyzicoPosAccount>) {
    super(config, account, deps)
    const mapper = deps.requestDataMapper as Partial<CheckoutRequestDataMapper>
    if (typeof mapper.create3DHostPaymentStatusRequestData !== 'function') {
      throw new PosError('IyzicoPos needs a request data mapper with create3DHostPaymentStatusRequestData')
    }
    const crypt = deps.crypt as Partial<AnswerSignatureCrypt>
    if (typeof crypt.checkResponseSignature !== 'function') {
      throw new PosError('IyzicoPos needs the iyzico crypt to verify bank answers.')
    }
    this.#checkoutRequestDataMapper = deps.requestDataMapper as unknown as CheckoutRequestDataMapper
    this.#answerCrypt = deps.crypt as unknown as AnswerSignatureCrypt
  }

  /**
   * The 3D Secure page (HTML) or the 3D Host checkout (HTML, or the payment page for `formFormat: 'array'`).
   *
   * @throws UnsupportedFormFormatError for 3D Secure with `formFormat: 'array'`
   * @throws PosError when the order is invalid, the card is missing for 3D Secure or passed for 3D Host, iyzico
   *   refuses the initialize request, or its answer holds no usable page
   * @throws HashMismatchError when the answer signature does not verify
   * @throws OrderMismatchError when the answer names another conversation
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
    const secure = paymentModel === MODEL.THREE_D_SECURE
    if (secure && formFormat === FORM_FORMAT.ARRAY) {
      throw new UnsupportedFormFormatError('iyzico 3D Secure returns an HTML page only')
    }
    // iyzico's 3D Secure initialize takes the card: there is no page without it.
    if (secure && (card === null || card === undefined)) {
      throw new PosError('iyzico 3D Secure needs the card')
    }
    const values = this.paymentOrderValues(order, txType)
    this.assertPaymentBody(order, values.kurus)

    this.logger.debug('preparing iyzico 3D form data', { tx_type: txType, model: paymentModel })
    const requestTxType = TX_TYPE.INTERNAL_3D_FORM_BUILD
    const requestData = await this.dispatchRequestDataPrepared(
      await this.requestDataMapper.create3DFormInitializeRequestData(
        this.account,
        order,
        paymentModel,
        txType,
        secure ? card : null,
      ),
      requestTxType,
      order,
      paymentModel,
    )
    const { answer } = await this.send(requestTxType, paymentModel, requestData, order, txType)

    this.assertFormAnswer(
      answer,
      values.orderId,
      secure ? 'threeDSInit' : 'checkoutFormInit',
      txType,
      secure ? card : null,
    )

    return secure
      ? this.threeDSecurePage(answer, values.orderId)
      : this.checkoutPage(answer, values.orderId, formFormat)
  }

  /**
   * Completes a 3D Secure payment from the browser callback.
   *
   * @throws PosError when the body is not a flat record of strings or the order is invalid
   * @throws UnsupportedTransactionTypeError when the transaction is not a payment or a pre-authorization
   * @throws HashMismatchError when the signature does not verify, an unsigned callback reads as an approval or a
   *   signature is required, or the fields of a signed approval are malformed
   * @throws OrderMismatchError when the callback belongs to another order (nothing attached), or the signed answer
   *   does not fit the order (approved result attached)
   * @throws PosHttpError when the authorization answer does not tell the outcome or cannot be verified
   */
  async make3DPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    _card: CreditCard | null = null,
  ): Promise<PosResponse> {
    const paymentModel = MODEL.THREE_D_SECURE
    const body = this.flatCallback(gatewayResponseData)
    // Every order value is checked before anything is read, so a bad order never turns a booked payment into an error.
    const values = this.paymentOrderValues(order, txType)
    const paymentTx = txType as PaymentTxType

    if (!callbackHasSignature(body)) {
      return this.unsignedCallback(body, order, values.orderId, paymentTx)
    }
    if (!this.crypt.check3DHash(this.account, body)) {
      this.logger.error('3D callback hash mismatch', { order_id: values.orderId })
      throw new HashMismatchError('3D callback hash mismatch')
    }
    this.guard(values.orderId, txType, () => assertCallbackOrder(body, values.orderId))

    if (!signedCallbackApproves(body)) {
      // A signed decline moves no money: no request, no format pins, nothing but the order's id and the 3D status.
      this.logger.info('3D callback reports no approval', { order_id: values.orderId })
      return trustedDecline(this.responseDataMapper.map3DPaymentData(body, null, txType, order), order, body)
    }
    const paymentId = this.guard(values.orderId, txType, () => assertCallbackApprovalPins(body, values.orderId))

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.create3DPaymentRequestData(this.account, order, txType, body),
      txType,
      order,
      paymentModel,
    )
    const { answer, url } = await this.send(txType, paymentModel, requestData, order)

    return this.settlePayment(answer, url, {
      order,
      orderId: values.orderId,
      txType,
      paymentModel,
      map: () => this.responseDataMapper.map3DPaymentData(body, answer, txType, order),
      expectation: {
        orderId: values.orderId,
        paymentId,
        kurus: values.kurus,
        paidPriceRule: 'equal',
        currency: values.currency,
        phase: PHASES[paymentTx],
      },
      checkMdStatus: true,
    })
  }

  /** @throws UnsupportedTransactionTypeError iyzico has no 3D Pay model */
  async make3DPayPayment(
    _gatewayResponseData: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
  ): Promise<PosResponse> {
    throw new UnsupportedTransactionTypeError('IyzicoPos does not support the 3D Pay model')
  }

  /**
   * Completes a 3D Host (Checkout Form) payment from the browser callback, which carries only the token: the result
   * is read from iyzico's signed checkout record.
   *
   * @throws PosError when the body is not a flat record of strings, carries no valid token, or the order is invalid
   * @throws UnsupportedTransactionTypeError when the transaction is not a payment or a pre-authorization
   * @throws PosHttpError when the record does not tell the result or cannot be verified (safe to retry: read only)
   * @throws OrderMismatchError when the record belongs to another checkout (nothing attached), or does not fit the
   *   order (approved result attached)
   */
  async make3DHostPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
  ): Promise<PosResponse> {
    const paymentModel = MODEL.THREE_D_HOST
    const body = this.flatCallback(gatewayResponseData)
    const values = this.paymentOrderValues(order, txType)
    const token = ownString(body, 'token')
    if (token === undefined || !TOKEN.test(token)) {
      this.logger.error('3D Host callback carries no valid token', { order_id: values.orderId })
      throw new PosError('3D Host callback carries no valid token')
    }

    const requestTxType = TX_TYPE.INTERNAL_3D_PAYMENT_STATUS
    const requestData = await this.dispatchRequestDataPrepared(
      this.#checkoutRequestDataMapper.create3DHostPaymentStatusRequestData(body, order),
      requestTxType,
      order,
      paymentModel,
    )
    const { answer, url } = await this.send(requestTxType, paymentModel, requestData, order)

    return this.guard(values.orderId, txType, () => {
      if (answerOutcome(answer, url) !== ANSWER_SUCCESS) {
        return declinedFromAnswer(
          this.responseDataMapper.map3DHostResponseData(answer, txType, order),
          values.orderId,
          answer,
        )
      }
      requireSignedAnswer(this.iyzicoCrypt(), this.account, answer, 'checkoutFormRetrieve', url)
      bindCheckoutRecord(answer, { orderId: values.orderId, token })
      if (!checkoutPaymentCompleted(answer)) {
        this.logger.info('checkout did not complete', { order_id: values.orderId })
        return this.incompleteCheckout(answer, order, txType)
      }

      // The record is mapped as a payment answer: the 3D field is judged by the review rule below, in one place.
      const approved: PosResponse = {
        ...approvedFromAnswer(
          this.responseDataMapper.mapPaymentResponse(answer, txType, order),
          order,
          answer,
          paymentModel,
          txType,
        ),
        md_status: this.responseDataMapper.extractMdStatus(answer),
        md_error_message: null,
        transaction_security: null,
      }
      bindPaymentAnswer(
        answer,
        {
          orderId: values.orderId,
          kurus: values.kurus,
          paidPriceRule: 'atLeast',
          currency: values.currency,
          phase: PHASES[txType as PaymentTxType],
        },
        approved,
      )

      return this.reviewed(answer, approved, true, values.orderId)
    })
  }

  /**
   * The non-secure sale or pre-authorization.
   *
   * @throws PosError when the order is invalid (before any request)
   * @throws PosHttpError when the answer does not tell the outcome or cannot be verified
   * @throws OrderMismatchError when the signed answer does not fit the order (approved result attached)
   */
  override async makeRegularPayment(order: PosOrder, card: CreditCard, txType: TxType): Promise<PosResponse> {
    const paymentModel = MODEL.NON_SECURE
    this.logger.debug('making payment', { model: paymentModel, tx_type: txType })
    const values = this.paymentOrderValues(order, txType)
    this.assertPaymentBody(order, values.kurus)

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createNonSecurePaymentRequestData(this.account, order, txType, card),
      txType,
      order,
      paymentModel,
    )
    const { answer, url } = await this.send(txType, paymentModel, requestData, order)

    return this.settlePayment(answer, url, {
      order,
      orderId: values.orderId,
      txType,
      paymentModel,
      map: () => this.responseDataMapper.mapPaymentResponse(answer, txType, order),
      expectation: {
        orderId: values.orderId,
        kurus: values.kurus,
        paidPriceRule: 'equal',
        currency: values.currency,
        phase: PHASES[txType as PaymentTxType],
      },
      checkMdStatus: false,
    })
  }

  /**
   * The capture of a pre-authorization (`order.transaction_id` is its iyzico payment id; `order.amount` is the amount
   * captured). The answer's basket total is the pre-authorized one, so only the captured amount is bound.
   *
   * @throws PosError when the order is invalid (before any request)
   * @throws PosHttpError when the answer does not tell the outcome or cannot be verified
   * @throws OrderMismatchError when the signed answer does not fit the order (approved result attached)
   */
  override async makeRegularPostPayment(order: PosOrder): Promise<PosResponse> {
    const txType = TX_TYPE.PAY_POST_AUTH
    const paymentModel = MODEL.NON_SECURE
    this.logger.debug('making payment', { model: paymentModel, tx_type: txType })
    const values = this.orderValues(order)
    const paymentId = this.transactionId(order)

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createNonSecurePostAuthPaymentRequestData(this.account, order),
      txType,
      order,
      paymentModel,
    )
    const { answer, url } = await this.send(txType, paymentModel, requestData, order)

    return this.settlePayment(answer, url, {
      order,
      orderId: values.orderId,
      txType,
      paymentModel,
      map: () => this.responseDataMapper.mapPaymentResponse(answer, txType, order),
      expectation: {
        orderId: values.orderId,
        paymentId,
        kurus: values.kurus,
        paidPriceRule: 'ignorePrice',
        currency: values.currency,
        phase: PHASES[txType],
      },
      checkMdStatus: false,
    })
  }

  /**
   * Full refund, or partial refund when `order.order_amount` is set and `order.amount` is lower
   * (`order.transaction_id` is the iyzico payment id). After an answer without a result, check `orderHistory()`
   * before any retry: a retried refund may refund twice.
   *
   * @throws PosError when the order is invalid (before any request)
   * @throws PosHttpError when the answer does not tell the outcome or cannot be verified
   * @throws OrderMismatchError when the signed answer does not fit the refund (approved result attached)
   */
  override async refund(order: PosOrder): Promise<PosResponse> {
    const paymentModel = MODEL.NON_SECURE
    const values = this.orderValues(order)
    const paymentId = this.transactionId(order)
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
    const { answer, url } = await this.send(txType, paymentModel, requestData, order)

    return this.guard(values.orderId, txType, () => {
      const outcome = answerOutcome(answer, url)
      const mapped = this.responseDataMapper.mapRefundResponse(answer)
      if (outcome !== ANSWER_SUCCESS) {
        return declinedFromAnswer(mapped, values.orderId, answer)
      }
      requireSignedAnswer(this.iyzicoCrypt(), this.account, answer, 'refund', url)
      const approved = this.mappedApproval(mapped, values.orderId)
      bindRefundAnswer(
        answer,
        { orderId: values.orderId, paymentId, kurus: values.kurus, currency: values.currency },
        approved,
      )

      return approved
    })
  }

  /**
   * Cancels a payment (`order.transaction_id` is the iyzico payment id). Cancel answers carry no signature; the
   * conversation id and payment id, when printed, must be the order's.
   *
   * @throws PosError when the order is invalid (before any request)
   * @throws PosHttpError when the answer does not tell the outcome
   * @throws OrderMismatchError when the answer names another order or payment (approved result attached)
   */
  override async cancel(order: PosOrder): Promise<PosResponse> {
    const txType = TX_TYPE.CANCEL
    const paymentModel = MODEL.NON_SECURE
    const orderId = iyzicoOrderId(order)
    const paymentId = this.transactionId(order)

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createCancelRequestData(this.account, order),
      txType,
      order,
      paymentModel,
    )
    const { answer, url } = await this.send(txType, paymentModel, requestData, order)

    return this.guard(orderId, txType, () => {
      const outcome = answerOutcome(answer, url)
      const mapped = this.responseDataMapper.mapCancelResponse(answer)
      if (outcome !== ANSWER_SUCCESS) {
        return declinedFromAnswer(mapped, orderId, answer)
      }
      const approved = this.mappedApproval(mapped, orderId)
      bindCancelAnswer(answer, { orderId, paymentId }, approved)

      return approved
    })
  }

  /**
   * The payment record (`/payment/detail`). A `success` answer must verify and, when an order id is asked for, name
   * it. It does not show cancels or refunds: use `orderHistory()` for those.
   *
   * @throws PosError when neither an order id nor a transaction id is given, or one is malformed
   * @throws HashMismatchError when a `success` answer does not verify
   * @throws OrderMismatchError when the answer names another order id (nothing attached)
   */
  override async status(order: PosOrder): Promise<PosResponse> {
    const txType = TX_TYPE.STATUS
    const paymentModel = MODEL.NON_SECURE
    const orderId = isSet(ownValue(asOrder(order), 'id')) ? iyzicoOrderId(order) : null
    const paymentId = isSet(ownValue(asOrder(order), 'transaction_id')) ? this.transactionId(order) : null

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createStatusRequestData(this.account, order),
      txType,
      order,
      paymentModel,
    )
    const { answer, url } = await this.send(txType, paymentModel, requestData, order)

    this.guard(orderId ?? '', txType, () => {
      if (ownValue(answer, 'status') === ANSWER_SUCCESS) {
        requireSignedAnswer(this.iyzicoCrypt(), this.account, answer, 'payment', url, true)
      }
      if (orderId !== null && Object.hasOwn(answer, 'conversationId') && answer.conversationId !== orderId) {
        throw new OrderMismatchError(
          'order_id',
          orderId,
          iyzicoPlainText(answer.conversationId, MAX_ECHOED_LENGTH) ?? '',
        )
      }
      if (paymentId !== null) bindStatusPaymentId(answer, paymentId)
    })

    return this.responseDataMapper.mapStatusResponse(answer)
  }

  // ---- private ----

  /** The crypt as the answer checks need it; the constructor made sure it verifies answer signatures. */
  private iyzicoCrypt(): IyzicoPosCrypt {
    return this.#answerCrypt as IyzicoPosCrypt
  }

  private flatCallback(gatewayResponseData: GatewayResponseData): Record<string, string> {
    try {
      return assertFlatIyzicoCallback(gatewayResponseData)
    } catch (e) {
      this.logger.error('3D callback is not a flat record of strings')
      throw e
    }
  }

  /** The order id, the amount in kuruş and the currency (and a valid installment count); a bad value is a `PosError`. */
  private orderValues(order: PosOrder): OrderValues {
    const orderId = iyzicoOrderId(order)
    const kurus = iyzicoOrderKurus(order)
    const currency = iyzicoOrderCurrency(order, this.requestValueMapper)
    iyzicoOrderInstallment(order)

    return { orderId, kurus, currency }
  }

  /** The order values of a payment or pre-authorization; any other transaction type is refused first. */
  private paymentOrderValues(order: PosOrder, txType: TxType): OrderValues {
    if (!isPaymentTx(txType)) {
      throw new UnsupportedTransactionTypeError(`Invalid transaction type "${String(txType)}" provided`)
    }
    return this.orderValues(order)
  }

  /** The payer, the addresses and a basket that adds up to the order amount, checked before any payment request. */
  private assertPaymentBody(order: PosOrder, kurus: number): void {
    const items = iyzicoBasketItems(order, kurus)
    iyzicoBuyer(order)
    iyzicoAddress(order, 'billing_address', true)
    iyzicoAddress(
      order,
      'shipping_address',
      items.some((item) => item.itemType === 'PHYSICAL'),
    )
  }

  private transactionId(order: PosOrder): string {
    return iyzicoPaymentId(ownValue(asOrder(order), 'transaction_id'), 'Order field "transaction_id"')
  }

  /**
   * Sends a request with the client registered for it. The payment client is given the URL explicitly, so a 3D form
   * goes to the route of the payment kind it is built for; the same URL names the request in errors.
   */
  private async send(
    txType: TxType,
    paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    order: PosOrder,
    orderTxType?: TxType,
  ): Promise<{ answer: Record<string, unknown>; url: string }> {
    const client = this.getClient(txType, paymentModel)
    const url = client instanceof IyzicoPosHttpClient ? client.getApiUrl(txType, paymentModel, orderTxType) : null
    const answer = await client.request(txType, paymentModel, requestData, order, url)

    return { answer, url: url ?? this.config.gateway_endpoints.payment_api }
  }

  /** Runs a check and logs a refusal with the order id and the error kind only (bank values stay out of logs). */
  private guard<T>(orderId: string, txType: TxType, check: () => T): T {
    try {
      return check()
    } catch (e) {
      this.logger.error('bank answer refused', {
        order_id: orderId,
        tx_type: txType,
        error: e instanceof Error ? e.name : 'unknown',
        ...(e instanceof OrderMismatchError ? { field: e.field } : {}),
      })
      throw e
    }
  }

  /** A callback without a signature: a decline built from the order at most, never an approval. */
  private unsignedCallback(
    body: Record<string, string>,
    order: PosOrder,
    orderId: string,
    txType: PaymentTxType,
  ): PosResponse {
    if (unsignedCallbackReadsAsApproval(body) || this.config.require_3d_hash === true) {
      this.logger.error('3D callback has no hash', { order_id: orderId })
      throw new HashMismatchError('3D callback has no hash')
    }

    return trustedDecline(this.responseDataMapper.map3DPaymentData(body, null, txType, order), order, body)
  }

  /** The verdict, signature, binding and review of a payment answer, in that order. */
  private settlePayment(answer: Record<string, unknown>, url: string, run: PaymentSettlement): PosResponse {
    return this.guard(run.orderId, run.txType, () => {
      const outcome = answerOutcome(answer, url)
      const mapped = run.map()
      if (outcome !== ANSWER_SUCCESS) {
        return declinedFromAnswer(mapped, run.orderId, answer)
      }
      requireSignedAnswer(this.iyzicoCrypt(), this.account, answer, 'payment', url)
      const approved = approvedFromAnswer(mapped, run.order, answer, run.paymentModel, run.txType)
      bindPaymentAnswer(answer, run.expectation, approved)

      return this.reviewed(answer, approved, run.checkMdStatus, run.orderId)
    })
  }

  private reviewed(
    answer: Parameters<typeof reviewFlags>[0],
    approved: PosResponse,
    checkMdStatus: boolean,
    orderId: string,
  ): PosResponse {
    if (!reviewFlags(answer, checkMdStatus).manualReview) {
      this.logger.info('signed answer approves the order', { order_id: orderId })
      return approved
    }
    this.logger.warn('charged payment held for manual review', { order_id: orderId })

    return heldForReview(approved)
  }

  /** An approved cancel or refund mapping with the order's id; a mapping that is not an approval is a `PosError`. */
  private mappedApproval(mapped: PosResponse, orderId: string): PosResponse {
    if (mapped.status !== TX_APPROVED) {
      throw new PosError('A successful bank answer was not mapped as approved')
    }

    return { ...mapped, order_id: orderId }
  }

  /** A signed checkout record of this order whose payment did not complete: a decline with the record's state. */
  private incompleteCheckout(answer: Record<string, unknown>, order: PosOrder, txType: TxType): PosResponse {
    const decline = trustedDecline(
      { status: TX_DECLINED, transaction_type: txType, payment_model: MODEL.THREE_D_HOST },
      order,
      {},
    )

    return {
      ...decline,
      proc_return_code: iyzicoCode(ownValue(answer, 'paymentStatus')),
      md_status: this.responseDataMapper.extractMdStatus(answer),
      '3d_all': null,
      all: answer,
    }
  }

  /**
   * The initialize answer: an exact `success`, a valid signature when it carries one, and this order's conversation
   * id when it names one.
   */
  private assertFormAnswer(
    answer: Record<string, unknown>,
    orderId: string,
    kind: IyzicoSignedAnswer,
    txType: TxType,
    card: CreditCard | null,
  ): void {
    if (ownValue(answer, 'status') !== ANSWER_SUCCESS) {
      this.logger.error('3D form generation failed', { order_id: orderId, tx_type: txType })
      const text = iyzicoPlainText(ownValue(answer, 'errorMessage'), MAX_TEXT_LENGTH)
      // A bank text may echo what it was sent: the account secret, the card's own number and anything shaped like a
      // card number are masked.
      const secrets = [this.account.getSecretKey(), ...(card === null ? [] : [card.getNumber()])]
      throw new PosError(
        text === null
          ? FORM_FAILURE
          : `${FORM_FAILURE}: ${hideSecrets(text, secrets).replace(CARD_LIKE_DIGITS, '***')}`,
      )
    }
    if (Object.hasOwn(answer, 'signature') && !this.iyzicoCrypt().checkResponseSignature(this.account, answer, kind)) {
      this.logger.error('3D form answer signature mismatch', { order_id: orderId })
      throw new HashMismatchError('Bank answer signature mismatch')
    }
    if (Object.hasOwn(answer, 'conversationId') && answer.conversationId !== orderId) {
      this.logger.error('3D form answer names another conversation', { order_id: orderId })
      throw new OrderMismatchError('order_id', orderId, iyzicoPlainText(answer.conversationId, MAX_ECHOED_LENGTH) ?? '')
    }
  }

  /** The bank's 3D Secure page: strict base64 of non-empty UTF-8 text. */
  private threeDSecurePage(answer: Record<string, unknown>, orderId: string): string {
    const content = ownValue(answer, 'threeDSHtmlContent')
    let html = ''
    if (typeof content === 'string' && content.length % 4 === 0 && BASE64.test(content)) {
      try {
        html = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(content, 'base64'))
      } catch {
        html = ''
      }
    }
    if (html === '') {
      this.logger.error('3D Secure page is missing or unreadable', { order_id: orderId })
      throw new PosError('iyzico 3D form answer carries no readable 3D Secure page')
    }

    return html
  }

  /** The checkout of the token: its HTML, or its https payment page for a redirect. */
  private checkoutPage(
    answer: Record<string, unknown>,
    orderId: string,
    formFormat: FormFormat | null,
  ): ThreeDFormData | string {
    const token = ownValue(answer, 'token')
    if (typeof token !== 'string' || !TOKEN.test(token)) {
      this.logger.error('checkout answer carries no valid token', { order_id: orderId })
      throw new PosError('iyzico checkout answer carries no valid token')
    }
    if (formFormat === FORM_FORMAT.ARRAY) {
      const page = ownValue(answer, 'paymentPageUrl')
      if (typeof page !== 'string' || !HTTPS_PAGE.test(page) || !URL.canParse(page)) {
        this.logger.error('checkout answer carries no https payment page', { order_id: orderId })
        throw new PosError('iyzico checkout answer carries no https payment page')
      }
      return { gateway: page, method: 'GET', inputs: {} }
    }
    const content = ownValue(answer, 'checkoutFormContent')
    if (typeof content !== 'string' || content === '') {
      this.logger.error('checkout answer carries no checkout form', { order_id: orderId })
      throw new PosError('iyzico checkout answer carries no checkout form')
    }

    return content
  }
}
