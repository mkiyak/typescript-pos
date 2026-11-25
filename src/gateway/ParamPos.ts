import type { AbstractHttpClient } from '../client/AbstractHttpClient.js'
import { ParamPosHttpClient } from '../client/ParamPosHttpClient.js'
import { faultMessage } from '../client/soapFault.js'
import { orderValue, readOrderId } from '../data-mapper/request/mapper/paramRequestFields.js'
import { child, isRecord, ownString, POS_INT, parseCode } from '../data-mapper/response/mapper/paramResponseFields.js'
import { TX_APPROVED, TX_DECLINED } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
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
import type { ParamPosAccount } from '../model/account/ParamPosAccount.js'
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
  amountKurus,
  approvalFieldsMalformed,
  type CallbackShape,
  callbackCode,
  callbackHash,
  callbackShape,
  confirmedResult,
  echo,
  flatCallback,
  paramRecordConfirms,
  reportsApproval,
  trustedDecline,
  withoutEchoedGuid,
} from './paramCallback.js'

/** The two 3D models this gateway completes from a callback. */
type CallbackModel = typeof MODEL.THREE_D_SECURE | typeof MODEL.THREE_D_PAY

/** The order values every check compares with, read before the callback is. */
type OrderExpectations = {
  orderId: string
  /** The amount as the caller gave it (validated). */
  amount: number
  /** The amount in kuruş. */
  kurus: number
  /** The installment count, one counting as none (0). */
  installment: number
  currency: string
}

/** What the confirmation of an approval needs besides the order. */
type Approval = {
  /** The receipt number the approval reported (the callback's or the provision answer's). */
  dekont: string
  /** Whether the bank's own answer already shows that money moved (an approved provision). */
  evidence: boolean
  /** The mapped approval (provision answer or callback); only its keys are kept. */
  mapped: PosResponse
  /** The result code of the answer that approved, as canonical integer text. */
  code: string | null
  mdStatus: string | null
  all: unknown
  threeDAll: unknown
}

const UNKNOWN_OUTCOME = 'Bank answer carries no result code; the payment outcome is unknown'
const UNKNOWN_CANCEL_OUTCOME = 'Bank answer carries no result; the outcome is unknown'

/** One installment is a single payment, like none. */
function normalizedInstallment(count: number): number {
  return count <= 1 ? 0 : count
}

/** An own value of a bank record; inherited members read as absent. */
function own(data: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(data, key) ? data[key] : undefined
}

/**
 * Param (TURK Elektronik Para) TurkPos virtual POS: SOAP requests to one web service. 3D Secure (the bank builds the
 * card-check page; the card-check callback is followed by a provision request), 3D Pay (the browser is sent to the
 * bank's page, which charges the card and posts the payment result), 3D payments in a foreign currency (like 3D Pay,
 * for the 3D Secure model), non-secure sales, 3D Secure and non-secure pre-authorizations with their
 * post-authorization, status, cancel, full and partial refund. The hosted collection page is `Param3DHostPos`.
 *
 * The bank signs two callback shapes with base64 SHA-1. The card-check callback (`islemHash`) covers its session id,
 * `md`, the 3D result and the order id, followed by the merchant GUID; it carries no signed amount. The payment result
 * callback (`TURKPOS_RETVAL_Hash`) covers the client code, the merchant GUID, the receipt number, the collected
 * amount, the order id and the merchant's transaction id; it echoes the merchant GUID it is signed with, so anyone who
 * has seen one callback of this merchant can sign any other. A valid signature therefore proves nothing on its own:
 * - A callback is a flat form of strings: any other value at its top level is a `PosError` before anything else. It
 *   must have exactly one of the two shapes, and the shape must fit the call: the card check for a 3D Secure order in
 *   Turkish lira, the payment result for 3D Pay and for a 3D Secure order in a foreign currency (a foreign currency
 *   3D pre-authorization does not exist). Then the order is validated (id, amount, installment, currency), so a bad
 *   order fails while nothing was read.
 * - The signature check cannot be switched off (`disable_3d_hash_check` is ignored). A present signature is always
 *   verified first, also on a decline; a mismatch is a `HashMismatchError`. A callback without a signature is rejected
 *   (`HashMismatchError`) when `require_3d_hash` is set and whenever it reads as an approval (3D result `1`, or a
 *   result code or receipt number above zero, padding ignored).
 * - Every decline, signed or not, returns a result built from trusted data only: the order's id, the call's
 *   transaction type and payment model, the bank's result code and text (bounded) or the one-digit 3D result; every
 *   other value is null and `all` keeps the raw callback without the echoed GUID. A decline is never flagged for
 *   manual review, and a decline whose mapping reads approved is a `PosError`.
 * - An approval has its signed fields pinned to their exact formats (the values run together without separators),
 *   otherwise `HashMismatchError('3D callback fields are malformed')`, and must name this order before any request
 *   (`OrderMismatchError`, nothing attached): the card check's order id and, when sent, its amount in exact kuruş; the
 *   payment result's order id. The card check's `md` may end in digits and an order id may start with them, so a
 *   genuine approval can also verify for another order whose id is a suffix of the real one; that re-read cannot be
 *   approved, because the provision answer and the status record must both name this order.
 * - A card check with 3D result `1` is provisioned with one request (no provision on any other 3D result, so a payment
 *   approved although 3D Secure failed cannot occur on this path). An answer without a result code, or with a success
 *   code but no receipt, is a `PosHttpError` naming the URL: the outcome is unknown, so it is never a decline a
 *   merchant could retry. A declined provision is returned as the bank's decline for this order. An approved one must
 *   name this order (otherwise `OrderMismatchError` with the result attached and flagged for manual review).
 * - Every approval (provisioned card check, 3D Pay, foreign currency) is confirmed with exactly one status request for
 *   the order id before it is returned. The bank's record must show a successful payment of this order with the
 *   reported receipt, of the transaction type (`SALE`, or `PRE_AUTH` for `pre`), the order amount in exact kuruş,
 *   nothing refunded and the order's installment count (one counting as none); it carries no currency. A record that
 *   does not confirm is an `OrderMismatchError`. The result is attached and flagged for manual review only when the
 *   bank shows money moved (an approved provision, or a record of a successful payment of this order with a
 *   receipt): a payment result callback anyone could forge raises no alert by itself. Errors of the status request
 *   propagate (the payment may have completed: query `status` before retrying).
 * - A confirmed result takes its order id, amount and currency from the order and its authorization code, host
 *   reference, transaction id, card mask, installment count and time from the bank's record, never from the callback.
 *   The echoed GUID never appears in returned data or attached results.
 * - After a non-secure sale, pre-authorization or post-authorization, an answer without the operation's result, without
 *   an integer result code, or with a success code but no transaction id (sale, pre-authorization) is a `PosHttpError`
 *   naming the URL; an approval for another order id is an `OrderMismatchError` with the result attached. A cancel or
 *   refund answer without a result or result code is a `PosHttpError` as well. All order values are validated before
 *   a request is sent.
 */
export class ParamPos extends AbstractGateway<ParamPosAccount> {
  static readonly NAME = 'ParamPos'

  static override readonly GATEWAY_CLASS: string = 'ParamPos'

  protected static override readonly testModeAffectsRequests: boolean = false

  protected static override supportedTransactions: SupportedTransactions = {
    [TX_TYPE.PAY_AUTH]: [MODEL.THREE_D_SECURE, MODEL.THREE_D_PAY, MODEL.NON_SECURE],
    [TX_TYPE.PAY_PRE_AUTH]: [MODEL.THREE_D_SECURE, MODEL.NON_SECURE],
    [TX_TYPE.ORDER_HISTORY]: false,
    [TX_TYPE.PAY_POST_AUTH]: true,
    [TX_TYPE.CANCEL]: true,
    [TX_TYPE.REFUND]: true,
    [TX_TYPE.REFUND_PARTIAL]: true,
    [TX_TYPE.STATUS]: true,
  }

  /**
   * Registers the payment with the bank (one signed request with the card) and returns what the browser is sent to:
   * the bank's card-check page as an HTML string (3D Secure in Turkish lira) or a GET form to the bank's page (3D
   * Pay, foreign currency). Nothing later needs the card, so it must not be stored.
   *
   * @throws UnsupportedFormFormatError for `formFormat: 'html'`
   * @throws PosError when the bank refuses the registration (its text masked and shortened) or answers without a
   *   result
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

    if (formFormat === FORM_FORMAT.HTML) {
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

    // The answer of the operation the request was built for; any other record is no answer to it.
    const operation =
      txType === TX_TYPE.PAY_PRE_AUTH
        ? this.requestValueMapper.mapTxType(txType, paymentModel)
        : this.requestValueMapper.mapTxType(txType, paymentModel, order)
    const result = child(child(answer, `${operation}Response`), `${operation}Result`)
    if (result === null) {
      this.logger.error('3D form answer has no result', { operation })
      throw new PosError('3D form could not be created: unknown error')
    }
    const code = parseCode(own(result, 'Sonuc'))
    if (code === null || code <= 0) {
      const text = ownString(result, 'Sonuc_Str')
      this.logger.error('3D form could not be created', { code: echo(own(result, 'Sonuc')) })
      throw new PosError(
        `3D form could not be created: ${text === null ? 'unknown error' : faultMessage(text, this.secrets())}`,
      )
    }

    return this.requestDataMapper.create3DFormData(this.account, order, paymentModel, txType, '', null, answer)
  }

  /**
   * Completes a 3D Secure payment: the card check of an order in Turkish lira (provision, then the bank's
   * confirmation), or the payment result of an order in a foreign currency (the bank's confirmation).
   *
   * @throws PosError when the callback is not a flat form of strings, does not fit the order, or the order is malformed
   * @throws HashMismatchError when a present hash does not verify, a required hash is missing, or the signed fields of
   *   an approval are malformed
   * @throws OrderMismatchError when an approval does not belong to the order (nothing sent), or the provision answer or
   *   the status record does not confirm it (result attached and flagged only with the bank's evidence)
   * @throws PosHttpError when the provision outcome is unknown or a request fails
   */
  async make3DPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    _card: CreditCard | null = null,
  ): Promise<PosResponse> {
    return this.completeCallback(gatewayResponseData, order, txType, MODEL.THREE_D_SECURE)
  }

  /** Completes a 3D Pay payment from its payment result callback; same rules as `make3DPayment`. */
  async make3DPayPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
  ): Promise<PosResponse> {
    return this.completeCallback(gatewayResponseData, order, txType, MODEL.THREE_D_PAY)
  }

  /** @throws UnsupportedPaymentModelError the hosted collection page is `Param3DHostPos` */
  async make3DHostPayment(
    _gatewayResponseData: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
  ): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError('Use Param3DHostPos for the 3D Host model')
  }

  /**
   * The non-secure sale or pre-authorization: an unclear answer is an unknown outcome, not a decline.
   *
   * @throws PosHttpError when the answer carries no result, no result code, or a success code without transaction id
   * @throws OrderMismatchError when an approval names another order id (result attached)
   */
  override async makeRegularPayment(order: PosOrder, card: CreditCard, txType: TxType): Promise<PosResponse> {
    const paymentModel = MODEL.NON_SECURE
    this.logger.debug('making payment', { model: paymentModel, tx_type: txType })
    if (txType !== TX_TYPE.PAY_AUTH && txType !== TX_TYPE.PAY_PRE_AUTH) {
      throw new UnsupportedTransactionTypeError(`Invalid transaction type "${txType}" provided`)
    }
    const expected = this.orderExpectations(order)

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createNonSecurePaymentRequestData(this.account, order, txType, card),
      txType,
      order,
      paymentModel,
    )

    return this.sendMoneyRequest(txType, requestData, order, expected.orderId, expected.currency)
  }

  /** The post-authorization: same rules as the sale (it answers without a transaction id). */
  override async makeRegularPostPayment(order: PosOrder): Promise<PosResponse> {
    const txType = TX_TYPE.PAY_POST_AUTH
    const paymentModel = MODEL.NON_SECURE
    this.logger.debug('making payment', { model: paymentModel, tx_type: txType })
    const orderId = readOrderId(order)
    toKurus(parseOrderAmount(orderValue(order, 'amount')))

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createNonSecurePostAuthPaymentRequestData(this.account, order),
      txType,
      order,
      paymentModel,
    )

    return this.sendMoneyRequest(txType, requestData, order, orderId, CURRENCY.TRY)
  }

  /** @throws PosHttpError when the answer carries no result or result code (the outcome is unknown) */
  override async cancel(order: PosOrder): Promise<PosResponse> {
    const txType = TX_TYPE.CANCEL
    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createCancelRequestData(this.account, order),
      txType,
      order,
      MODEL.NON_SECURE,
    )
    const answer = await this.sendCancelRequest(txType, requestData, order)

    return this.responseDataMapper.mapCancelResponse(answer)
  }

  /**
   * Full refund, or partial refund when `order.order_amount` is set and `order.amount` is lower.
   *
   * @throws PosHttpError when the answer carries no result or result code (the outcome is unknown)
   */
  override async refund(order: PosOrder): Promise<PosResponse> {
    let txType: TxType = TX_TYPE.REFUND
    const orderAmount = order.order_amount
    if (orderAmount !== undefined && orderAmount !== null && Number(order.amount) < Number(orderAmount)) {
      txType = TX_TYPE.REFUND_PARTIAL
    }
    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createRefundRequestData(this.account, order, txType),
      txType,
      order,
      MODEL.NON_SECURE,
    )
    const answer = await this.sendCancelRequest(txType, requestData, order)

    return this.responseDataMapper.mapRefundResponse(answer)
  }

  /** @throws UnsupportedTransactionTypeError Param has no order history request */
  override async orderHistory(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedTransactionTypeError('ParamPos does not support order history')
  }

  private async completeCallback(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    paymentModel: CallbackModel,
  ): Promise<PosResponse> {
    const callback = flatCallback(gatewayResponseData, this.logger)
    const shape = callbackShape(callback)
    this.assertCallbackFitsCall(shape, order, txType, paymentModel)
    // Every order value the callback and the bank's answers are compared with fails here, before anything is read.
    const expected = this.orderExpectations(order)

    if (callbackHash(callback, shape) !== undefined) {
      if (!this.crypt.check3DHash(this.account, callback as GatewayResponseData)) {
        throw new HashMismatchError('3D callback hash mismatch')
      }
    } else if (reportsApproval(callback, shape) || this.config.require_3d_hash === true) {
      this.logger.error('3D callback has no hash', { order_id: echo(expected.orderId) })
      throw new HashMismatchError('3D callback has no hash')
    }

    if (!reportsApproval(callback, shape)) {
      return this.decline(callback, shape, order, expected, txType, paymentModel)
    }

    const malformed = approvalFieldsMalformed(callback, shape)
    if (malformed.length > 0) {
      this.logger.error('3D callback fields are malformed', { order_id: echo(expected.orderId), fields: malformed })
      throw new HashMismatchError('3D callback fields are malformed')
    }
    this.assertCallbackBelongsToOrder(callback, shape, expected)

    if (shape === 'md') {
      return this.provision(callback, order, expected, txType)
    }

    const mapped = this.responseDataMapper.map3DPayResponseData(callback, txType, order)
    if (mapped.status !== TX_APPROVED) {
      this.logger.error('3D callback approval was not mapped as approved', { order_id: echo(expected.orderId) })
      throw new PosError('3D callback approval was not mapped as approved')
    }

    return this.confirmWithStatus(expected, txType, paymentModel, {
      dekont: ownString(callback, 'TURKPOS_RETVAL_Dekont_ID') ?? '',
      evidence: false,
      mapped,
      code: callbackCode(callback, shape),
      mdStatus: null,
      all: callback,
      threeDAll: null,
    })
  }

  /**
   * The card check is for a 3D Secure order in Turkish lira; the payment result is for 3D Pay and for a 3D Secure
   * order in a foreign currency. A sale or a pre-authorization only; foreign currency and 3D Pay have no
   * pre-authorization.
   */
  private assertCallbackFitsCall(
    shape: CallbackShape,
    order: PosOrder,
    txType: TxType,
    paymentModel: CallbackModel,
  ): void {
    if (txType !== TX_TYPE.PAY_AUTH && txType !== TX_TYPE.PAY_PRE_AUTH) {
      throw new UnsupportedTransactionTypeError(`Unsupported transaction type: ${String(txType)}`)
    }
    const currency = this.orderCurrency(order)
    const expectedShape: CallbackShape =
      paymentModel === MODEL.THREE_D_SECURE && currency === CURRENCY.TRY ? 'md' : 'turkpos'
    if (shape !== expectedShape) {
      this.logger.error('3D callback does not fit the payment model', { payment_model: paymentModel, shape })
      throw new PosError('Unexpected 3D callback for this payment model')
    }
    if (shape === 'turkpos' && txType === TX_TYPE.PAY_PRE_AUTH) {
      if (paymentModel === MODEL.THREE_D_PAY) {
        throw new UnsupportedTransactionTypeError('Param 3D Pay has no pre-authorization')
      }
      throw new PosError('Param 3D pre-authorization supports TRY only')
    }
  }

  /** A decline, signed or not: the trusted result, after the mapping confirmed it is no approval. */
  private decline(
    callback: Record<string, unknown>,
    shape: CallbackShape,
    order: PosOrder,
    expected: OrderExpectations,
    txType: TxType,
    paymentModel: CallbackModel,
  ): PosResponse {
    const mapped =
      shape === 'md'
        ? this.responseDataMapper.map3DPaymentData(callback, null, txType, order)
        : this.responseDataMapper.map3DPayResponseData(callback, txType, order)
    if (mapped.status !== TX_DECLINED) {
      // The approval would skip the field pins, the order binding and the bank's confirmation.
      this.logger.error('3D callback without approval was mapped as approved', { order_id: echo(expected.orderId) })
      throw new PosError('3D callback without approval was mapped as approved')
    }

    return trustedDecline(mapped, callback, shape, expected.orderId, txType, paymentModel)
  }

  /**
   * The approval belongs to the order before any request; nothing is attached, because the callback may belong to
   * another order, whose own handler deals with it. The amount and currency of a payment result prove nothing and are
   * compared with the bank's record only.
   */
  private assertCallbackBelongsToOrder(
    callback: Record<string, unknown>,
    shape: CallbackShape,
    expected: OrderExpectations,
  ): void {
    const idField = shape === 'md' ? 'orderId' : 'TURKPOS_RETVAL_Siparis_ID'
    const callbackOrderId = ownString(callback, idField) ?? ''
    if (callbackOrderId !== expected.orderId) {
      this.fail('order_id', expected.orderId, callbackOrderId, expected.orderId)
    }
    if (shape === 'md' && Object.hasOwn(callback, 'transactionAmount') && callback.transactionAmount !== undefined) {
      if (amountKurus(callback.transactionAmount, 'comma') !== expected.kurus) {
        // No provision is sent, so no money moves: a payer who completed an older cart is not charged.
        this.fail(
          'amount',
          numberFormat2(expected.amount).replace('.', ','),
          String(callback.transactionAmount),
          expected.orderId,
        )
      }
    }
  }

  /** The provision of an approved card check, then the bank's confirmation. */
  private async provision(
    callback: Record<string, unknown>,
    order: PosOrder,
    expected: OrderExpectations,
    txType: TxType,
  ): Promise<PosResponse> {
    const paymentModel = MODEL.THREE_D_SECURE
    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.create3DPaymentRequestData(this.account, order, txType, callback),
      txType,
      order,
      paymentModel,
    )
    const client = this.getClient(txType, paymentModel)
    const answer = await client.request(txType, paymentModel, requestData, order, null)

    const result = child(child(answer, 'TP_WMD_PayResponse'), 'TP_WMD_PayResult')
    const code = result === null ? null : parseCode(own(result, 'Sonuc'))
    if (result === null || code === null) {
      this.unknownOutcome(client, txType, paymentModel, expected.orderId)
    }
    const dekont = ownString(result, 'Dekont_ID') ?? ''
    // A success code without a receipt contradicts itself: whether money moved is unknown.
    if (code > 0 && !POS_INT.test(dekont)) {
      this.unknownOutcome(client, txType, paymentModel, expected.orderId)
    }

    const mapped = this.responseDataMapper.map3DPaymentData(callback, answer, txType, order)
    if (code <= 0) {
      if (mapped.status !== TX_DECLINED) {
        this.logger.error('declined provision was mapped as approved', { order_id: echo(expected.orderId) })
        throw new PosError('Declined provision was mapped as approved')
      }

      return this.withOrderId(mapped, expected.orderId)
    }

    const answerOrderId = ownString(result, 'Siparis_ID') ?? ''
    if (answerOrderId !== expected.orderId) {
      this.fail('order_id', expected.orderId, answerOrderId, expected.orderId, {
        ...this.withOrderId(mapped, expected.orderId),
        requires_manual_review: true,
      })
    }

    return this.confirmWithStatus(expected, txType, MODEL.THREE_D_SECURE, {
      dekont,
      evidence: true,
      mapped,
      code: String(code),
      mdStatus: '1',
      all: answer,
      threeDAll: callback,
    })
  }

  /**
   * Exactly one status request for the order id; the approval stands only when the bank's record confirms it (see the
   * class description). The references of the result come from the record.
   */
  private async confirmWithStatus(
    expected: OrderExpectations,
    txType: TxType,
    paymentModel: CallbackModel,
    approval: Approval,
  ): Promise<PosResponse> {
    const statusOrder: PosOrder = { id: expected.orderId }
    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createStatusRequestData(this.account, statusOrder),
      TX_TYPE.STATUS,
      statusOrder,
      MODEL.NON_SECURE,
    )
    const answer = await this.sendRequest(TX_TYPE.STATUS, MODEL.NON_SECURE, requestData, statusOrder)
    const check = paramRecordConfirms(answer, {
      siparisId: expected.orderId,
      dekont: approval.dekont,
      kurus: expected.kurus,
      installment: expected.installment,
      transactionType: txType === TX_TYPE.PAY_PRE_AUTH ? 'PRE_AUTH' : 'SALE',
    })
    const values = {
      order: { orderId: expected.orderId, amount: expected.amount, currency: expected.currency },
      paymentModel,
      txType,
      code: approval.code,
      mdStatus: approval.mdStatus,
      record: check.record,
      transactionTime: null,
      all: approval.all,
      threeDAll: approval.threeDAll,
    }

    if (check.failure !== null) {
      const [field, wanted, actual] = check.failure
      if (approval.evidence) {
        // The provision answer is the bank's own word that money moved; the record of another order is not used.
        this.fail(field, wanted, actual, expected.orderId, {
          ...this.withOrderId(approval.mapped, expected.orderId),
          requires_manual_review: true,
        })
      }
      if (check.evidence) {
        this.fail(field, wanted, actual, expected.orderId, {
          ...confirmedResult(approval.mapped, values),
          requires_manual_review: true,
        })
      }
      // A payment result anyone could forge must not raise payment alerts.
      this.fail(field, wanted, actual, expected.orderId)
    }

    const status = this.responseDataMapper.mapStatusResponse(answer)
    const time = isRecord(status) && status.transaction_time instanceof Date ? status.transaction_time : null
    this.logger.info('payment confirmed by the bank status record', { order_id: echo(expected.orderId) })

    return confirmedResult(approval.mapped, { ...values, transactionTime: time })
  }

  /**
   * Sends a sale, pre-authorization or post-authorization. The answer must hold the operation's result with an
   * integer result code and, for an approved sale or pre-authorization, a transaction id; otherwise nobody knows
   * whether money moved. An approval naming another order id is flagged.
   */
  private async sendMoneyRequest(
    txType: TxType,
    requestData: Record<string, unknown>,
    order: PosOrder,
    orderId: string,
    currency: string,
  ): Promise<PosResponse> {
    const paymentModel = MODEL.NON_SECURE
    const client = this.getClient(txType, paymentModel)
    const answer = await client.request(txType, paymentModel, requestData, order, null)

    const operation =
      txType === TX_TYPE.PAY_PRE_AUTH
        ? 'TP_Islem_Odeme_OnProv_WMD'
        : txType === TX_TYPE.PAY_POST_AUTH
          ? 'TP_Islem_Odeme_OnProv_Kapa'
          : currency !== CURRENCY.TRY
            ? 'TP_Islem_Odeme_WD'
            : 'TP_WMD_UCD'
    const result = child(child(answer, `${operation}Response`), `${operation}Result`)
    const code = result === null ? null : parseCode(own(result, 'Sonuc'))
    if (result === null || code === null) {
      this.unknownOutcome(client, txType, paymentModel, orderId)
    }
    if (code > 0 && txType !== TX_TYPE.PAY_POST_AUTH && !POS_INT.test(ownString(result, 'Islem_ID') ?? '')) {
      this.unknownOutcome(client, txType, paymentModel, orderId)
    }

    const response = this.responseDataMapper.mapPaymentResponse(answer, txType, order)
    if (code > 0 !== (response.status === TX_APPROVED)) {
      // The mapping reads the answer differently from its result code: whether money moved is unknown.
      this.unknownOutcome(client, txType, paymentModel, orderId)
    }
    if (response.status === TX_APPROVED && Object.hasOwn(result, 'Siparis_ID')) {
      const answerOrderId = ownString(result, 'Siparis_ID') ?? ''
      if (answerOrderId !== orderId) {
        this.fail('order_id', orderId, answerOrderId, orderId, response)
      }
    }

    return response
  }

  /** Sends a cancel or refund; an answer without a result or result code leaves the outcome unknown. */
  private async sendCancelRequest(
    txType: TxType,
    requestData: Record<string, unknown>,
    order: PosOrder,
  ): Promise<Record<string, unknown>> {
    const paymentModel = MODEL.NON_SECURE
    const client = this.getClient(txType, paymentModel)
    const answer = await client.request(txType, paymentModel, requestData, order, null)

    const result =
      child(child(answer, 'TP_Islem_Iptal_Iade_Kismi2Response'), 'TP_Islem_Iptal_Iade_Kismi2Result') ??
      child(child(answer, 'TP_Islem_Iptal_OnProvResponse'), 'TP_Islem_Iptal_OnProvResult')
    if (result === null || parseCode(own(result, 'Sonuc')) === null) {
      this.logger.error('bank answer carries no result', { tx_type: txType })
      throw new PosHttpError(UNKNOWN_CANCEL_OUTCOME, { url: this.requestUrl(client, txType, paymentModel) })
    }

    return answer
  }

  private unknownOutcome(
    client: AbstractHttpClient,
    txType: TxType,
    paymentModel: PaymentModel,
    orderId: string,
  ): never {
    this.logger.error('bank answer carries no result code', { order_id: echo(orderId), tx_type: txType })
    throw new PosHttpError(UNKNOWN_OUTCOME, { url: this.requestUrl(client, txType, paymentModel) })
  }

  /** The URL a request was posted to. */
  private requestUrl(client: AbstractHttpClient, txType: TxType, paymentModel: PaymentModel): string {
    return client instanceof ParamPosHttpClient
      ? client.getApiUrl(txType, paymentModel)
      : this.config.gateway_endpoints.payment_api
  }

  /** A mapped result with the order's id and without the echoed GUID in its raw data. */
  private withOrderId(mapped: PosResponse, orderId: string): PosResponse {
    const result: PosResponse = { ...mapped, order_id: orderId }
    if (Object.hasOwn(mapped, 'all')) result.all = withoutEchoedGuid(mapped.all)
    if (Object.hasOwn(mapped, '3d_all')) result['3d_all'] = withoutEchoedGuid(mapped['3d_all'])

    return result
  }

  /**
   * The order values every check compares with, read once before the callback is: the order id, the amount (and in
   * kuruş), the installment count and the currency, which must be one the bank knows. A value the bank cannot have
   * been sent is a `PosError`.
   */
  private orderExpectations(order: PosOrder): OrderExpectations {
    const orderId = readOrderId(order)
    const amount = parseOrderAmount(orderValue(order, 'amount'))
    const kurus = toKurus(amount)
    const installment = normalizedInstallment(parseInstallment(orderValue(order, 'installment')))
    const currency = this.orderCurrency(order)
    this.requestValueMapper.mapCurrency(currency as Currency)

    return { orderId, amount, kurus, installment, currency }
  }

  /** The order currency (Turkish lira when absent); anything but text is a `PosError`. */
  private orderCurrency(order: PosOrder): string {
    const currency: unknown = orderValue(order, 'currency') ?? CURRENCY.TRY
    if (typeof currency !== 'string') {
      throw new PosError('The order currency must be text.')
    }

    return currency
  }

  /** The account's credentials, masked in any bank text that is shown. */
  private secrets(): string[] {
    return [this.account.getPassword(), this.account.getSecretKey(), this.account.getUsername()]
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
