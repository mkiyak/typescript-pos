import type { RequestDataMapperInterface } from '../data-mapper/request/mapper/RequestDataMapperInterface.js'
import {
  OrderMismatchError,
  type OrderMismatchField,
  PosError,
  UnsupportedFormFormatError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../errors.js'
import type { PayFlexPosAccount } from '../model/account/PayFlexPosAccount.js'
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
import type { GatewayResponseData, PosOrder, PosResponse, ThreeDFormData } from '../types.js'
import { numberFormat2 } from '../util/numberFormat2.js'
import { existingOrderIdOf } from '../util/orderId.js'
import { parseOrderAmount } from '../util/parseOrderAmount.js'
import { AbstractGateway, type GatewayConfig, type GatewayDeps, type SupportedTransactions } from './AbstractGateway.js'

type Raw = Record<string, unknown>

/** The request data mapper this gateway needs: it also builds the transaction query from the callback. */
type CpRequestDataMapper = RequestDataMapperInterface<PayFlexPosAccount> & {
  create3DPaymentStatusRequestData(account: PayFlexPosAccount, responseData: Raw): Record<string, string>
}

const SUCCESS_CODE = '0000'

/** Query answer `Amount`: digits with at most two decimals after a dot or a comma (`1.01`, `1,01`, `100`). */
const ANSWER_AMOUNT = /^(\d+)(?:[.,](\d{1,2}))?$/

const NO_IDS_MESSAGE =
  'Callback carries no TransactionId or PaymentToken; the result cannot be confirmed with the bank.'

/** A plain decimal order amount (no hex, exponent or Infinity, which `Number()` would accept). */

const ALTERNATIVE =
  'use a PayFlexV4Pos gateway (bank "vakifbank") with transaction_id = the common payment TransactionId'

/** Own property value, or undefined. */
function own(data: Raw, key: string): unknown {
  return Object.hasOwn(data, key) ? data[key] : undefined
}

/** Own property value, with null treated as absent. */
function value(data: Raw, key: string): unknown {
  return own(data, key) ?? undefined
}

function asText(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

/** A non-empty string value, or null. */
function nonEmpty(data: Raw, key: string): string | null {
  const v = value(data, key)
  if (v === undefined) return null
  const s = String(v)
  return s === '' ? null : s
}

/** First non-empty string among several candidate keys, or null. */
function firstNonEmptyString(data: Raw, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = value(data, key)
    if (typeof v === 'string' && v !== '') return v
  }

  return null
}

/**
 * What an `OrderMismatchError` says about a payment token that differs from the order's: a token opens the bank's card
 * page for its payment, so neither token is put into the error (whose message is often logged).
 */
const ORDER_TOKEN = 'the payment token of this order'
const OTHER_TOKEN = 'another payment token'

/** What a log line may say about two payment tokens that differ: their lengths, never the tokens. */
function tokenLengths(expected: string, actual: string): { expected_length: number; actual_length: number } {
  return { expected_length: expected.length, actual_length: actual.length }
}

/** A non-empty string, or null. */
function nonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

/** The query answer amount in whole cents; null for anything but the strict decimal shape. */
function answerCents(v: unknown): bigint | null {
  if (typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))) return null
  const match = ANSWER_AMOUNT.exec(String(v))
  if (match === null) return null

  return BigInt(match[1] as string) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
}

/**
 * The order amount in the whole cents sent to the bank (two-decimal `number_format`, so 100.005 is 10001);
 * null when the amount is not a finite number or a plain decimal string.
 */
function orderCents(v: unknown): bigint | null {
  const amount = parseOrderAmount(v)
  if (Number.isNaN(amount)) return null

  try {
    return BigInt(numberFormat2(amount).replace('.', ''))
  } catch (e) {
    if (e instanceof PosError) return null
    throw e
  }
}

/**
 * VakifBank Common Payment (Ortak Ödeme): the card page is hosted by the bank.
 *
 * - `get3DFormData` registers the payment (`CreateToken`) and returns a GET redirect to `CommonPaymentUrl`
 *   carrying `Ptkn`. It continues only when the answer has a payment token and an `https:` payment URL and
 *   reports no error (`ErrorCode` empty or `0000`, `StatusCode` absent or `0`); anything else is a `PosError`.
 * - The browser callback to the success/fail URL is informational only and carries no signature
 *   (VakifBank Common Payment guide v2.1 §5, §6.4). `make3DPayPayment` / `make3DHostPayment` therefore always ask
 *   the transaction query API (`GetVposTransaction`, guide §6.5); only the query answer decides the status, in
 *   both directions.
 * - When the order carries its own `transaction_id` and/or `payment_token` (the values used for the
 *   registration), the query is built from those order values only. A callback `TransactionId` /
 *   `PaymentToken` that contradicts them is an `OrderMismatchError('transaction_id')` with
 *   `paymentMayHaveCompleted: false` and no HTTP call (for a payment token, its `expected` / `actual` describe the
 *   tokens instead of carrying them). This stops a replay of an earlier transaction of a reused
 *   order id (the query API does not report later cancels or refunds). Without order ids the callback
 *   `TransactionId` / `PaymentToken` are queried; a callback with neither id is returned as declined without an
 *   HTTP call.
 * - An approved query answer must belong to the order: `OrderID` / `OrderId` equals the order id, `Amount`
 *   equals the order amount in the cents sent to the bank, `AmountCode` / `CurrencyCode` the order currency (an
 *   answer without a currency code is accepted only for TRY), and when present `HostMerchantId` the account
 *   merchant id, `TransactionType` the requested transaction type, `TransactionId` the order (or else callback)
 *   transaction id and `PaymentToken` the order payment token. A mismatch is an `OrderMismatchError` with
 *   `paymentMayHaveCompleted: true`.
 * - A callback that says approved (`Rc` / `RC` / `ResultCode` `0000`) while the query does not confirm it is
 *   returned as declined with `requires_manual_review: true`.
 * - `require_3d_hash` does not apply: there is no callback hash to verify; the query and the order binding
 *   above take its place.
 * - The registration sends `AllowNotEnrolledCard` `false`, so the bank charges only after full 3-D Secure
 *   authentication. Merchants who accept "half secure" payments set it to `'true'` in an
 *   `onRequestDataPrepared` hook (guide §5).
 * - `status()` queries a transaction by `transaction_id` or `payment_token`. Capture, cancel and refund go
 *   through a `PayFlexV4Pos` gateway (bank `vakifbank`) with `transaction_id` set to the common payment
 *   `TransactionId` (guide §8).
 */
export class PayFlexCPV4Pos extends AbstractGateway<PayFlexPosAccount> {
  static readonly NAME = 'PayFlex-Common-Payment-V4'

  static override readonly GATEWAY_CLASS: string = 'PayFlexCPV4Pos'

  protected static override supportedTransactions: SupportedTransactions = {
    [TX_TYPE.PAY_AUTH]: [MODEL.THREE_D_PAY, MODEL.THREE_D_HOST],
    [TX_TYPE.PAY_PRE_AUTH]: [MODEL.THREE_D_PAY, MODEL.THREE_D_HOST],
    [TX_TYPE.PAY_POST_AUTH]: false,
    [TX_TYPE.STATUS]: true,
    [TX_TYPE.CANCEL]: false,
    [TX_TYPE.REFUND]: false,
    [TX_TYPE.REFUND_PARTIAL]: false,
    [TX_TYPE.ORDER_HISTORY]: false,
  }

  private readonly cpRequestDataMapper: CpRequestDataMapper

  constructor(config: GatewayConfig, account: PayFlexPosAccount, deps: GatewayDeps<PayFlexPosAccount>) {
    super(config, account, deps)
    const mapper = deps.requestDataMapper as Partial<CpRequestDataMapper>
    if (typeof mapper.create3DPaymentStatusRequestData !== 'function') {
      throw new PosError('PayFlexCPV4Pos needs a request data mapper with create3DPaymentStatusRequestData')
    }
    this.cpRequestDataMapper = deps.requestDataMapper as CpRequestDataMapper
  }

  /**
   * Registers the payment and returns the redirect (GET `CommonPaymentUrl?Ptkn=…`) to the bank card page.
   * `createWithoutCard` has no effect: the card goes from your server to the bank, never to the browser.
   *
   * @throws UnsupportedFormFormatError for `formFormat: 'html'`
   * @throws PosError when the registration is not accepted
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

    const requestTxType = TX_TYPE.INTERNAL_3D_FORM_BUILD
    const requestData = await this.dispatchRequestDataPrepared(
      await this.requestDataMapper.create3DFormInitializeRequestData(this.account, order, paymentModel, txType, card),
      requestTxType,
      order,
      paymentModel,
    )
    const answer = await this.sendRequest(requestTxType, paymentModel, requestData, order)

    this.assertRegistered(answer)

    this.logger.debug('preparing 3D form data')

    return (await this.requestDataMapper.create3DFormData(
      this.account,
      null,
      paymentModel,
      txType,
      '',
      null,
      answer,
    )) as ThreeDFormData
  }

  async make3DPayment(
    _gatewayResponseData: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
    _card: CreditCard | null = null,
  ): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError('Common payment supports the 3D Pay and 3D Host models only')
  }

  /**
   * @throws OrderMismatchError when the approved query answer belongs to another payment
   * @throws PosHttpError when the query fails or answers something that is not JSON/XML (e.g. an HTML page)
   */
  make3DPayPayment(gatewayResponseData: GatewayResponseData, order: PosOrder, txType: TxType): Promise<PosResponse> {
    return this.completeHostedPayment(gatewayResponseData, order, txType, MODEL.THREE_D_PAY)
  }

  /**
   * @throws OrderMismatchError when the approved query answer belongs to another payment
   * @throws PosHttpError when the query fails or answers something that is not JSON/XML (e.g. an HTML page)
   */
  make3DHostPayment(gatewayResponseData: GatewayResponseData, order: PosOrder, txType: TxType): Promise<PosResponse> {
    return this.completeHostedPayment(gatewayResponseData, order, txType, MODEL.THREE_D_HOST)
  }

  override async makeRegularPayment(_order: PosOrder, _card: CreditCard, _txType: TxType): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError('Common payment has no non-secure payment')
  }

  override async makeRegularPostPayment(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedTransactionTypeError(`Common payment has no post authorization; ${ALTERNATIVE}`)
  }

  override async cancel(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedTransactionTypeError(`Common payment has no cancel; ${ALTERNATIVE}`)
  }

  override async refund(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedTransactionTypeError(`Common payment has no refund; ${ALTERNATIVE}`)
  }

  override async orderHistory(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedTransactionTypeError('Common payment has no order history')
  }

  /**
   * Registration succeeds only with a payment token, an `https:` payment URL and no error code
   * (VakifBank Common Payment guide v2.1 §4: `ErrorCode` is set only on failure).
   */
  private assertRegistered(answer: Raw): void {
    const errorCode = nonEmpty(answer, 'ErrorCode')
    const statusCode = nonEmpty(answer, 'StatusCode')
    const token = nonEmpty(answer, 'PaymentToken')
    const url = nonEmpty(answer, 'CommonPaymentUrl')

    const failed =
      token === null ||
      url === null ||
      (errorCode !== null && errorCode !== SUCCESS_CODE) ||
      (statusCode !== null && statusCode !== '0')

    if (failed) {
      this.logger.error('payment register fail response', answer)
      const message =
        nonEmpty(answer, 'ResponseMessage') ??
        nonEmpty(answer, 'ErrorMessage') ??
        nonEmpty(answer, 'StatusDescription') ??
        'Common payment registration failed'
      throw new PosError(message, {
        cause: { code: value(answer, 'ErrorCode') ?? value(answer, 'StatusCode') ?? null },
      })
    }

    let parsed: URL | null
    try {
      parsed = new URL(url)
    } catch {
      parsed = null
    }
    if (parsed?.protocol !== 'https:') {
      // The URL may carry the payment token in its query: only where it points is logged.
      this.logger.error('payment register response has no https payment URL', {
        url_scheme: parsed?.protocol ?? null,
        url_host: parsed?.host ?? null,
      })
      throw new PosError('Common payment URL must be an https: URL')
    }
  }

  /**
   * Confirms the browser callback with the transaction query (VakifBank Common Payment guide v2.1 §6.4, §6.5) and
   * binds an approved answer to the order. The callback result code never decides the status.
   *
   * @throws OrderMismatchError (`paymentMayHaveCompleted: false`, no HTTP call) when the callback ids contradict
   *   the order's `transaction_id` / `payment_token`
   */
  private async completeHostedPayment(
    callback: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    paymentModel: typeof MODEL.THREE_D_PAY | typeof MODEL.THREE_D_HOST,
  ): Promise<PosResponse> {
    if (txType !== TX_TYPE.PAY_AUTH && txType !== TX_TYPE.PAY_PRE_AUTH) {
      throw new UnsupportedTransactionTypeError(`Invalid transaction type "${txType}" provided`)
    }

    // Read as an existing id before anything is sent (the order may predate the registration's stricter rule), so
    // an array or object never turns into the text of a matching id. A missing id is '' and never matches.
    const expectedOrderId =
      order.id === undefined || order.id === null || order.id === '' ? '' : existingOrderIdOf(order)

    const cb = callback as Raw
    const callbackSaysApproved = firstNonEmptyString(cb, 'Rc', 'RC', 'ResultCode') === SUCCESS_CODE
    const map = (data: Raw): PosResponse =>
      paymentModel === MODEL.THREE_D_PAY
        ? this.responseDataMapper.map3DPayResponseData(data, txType, order)
        : this.responseDataMapper.map3DHostResponseData(data, txType, order)

    const orderTransactionId = nonEmptyString(order.transaction_id)
    const orderPaymentToken = nonEmptyString(order.payment_token)
    const callbackTransactionId = nonEmpty(cb, 'TransactionId')
    const callbackPaymentToken = nonEmpty(cb, 'PaymentToken')

    if (orderTransactionId !== null && callbackTransactionId !== null && callbackTransactionId !== orderTransactionId) {
      this.rejectCallbackId(orderTransactionId, callbackTransactionId)
    }
    if (orderPaymentToken !== null && callbackPaymentToken !== null && callbackPaymentToken !== orderPaymentToken) {
      this.rejectCallbackId(orderPaymentToken, callbackPaymentToken, true)
    }

    const queryByOrder = orderTransactionId !== null || orderPaymentToken !== null

    if (!queryByOrder && callbackTransactionId === null && callbackPaymentToken === null) {
      this.logger.error('3D callback has no TransactionId or PaymentToken to confirm', {
        callback_says_approved: callbackSaysApproved,
      })
      // mapped from an empty answer so nothing from the browser data looks approved
      const response: PosResponse = {
        ...map({}),
        status: 'declined',
        proc_return_code: null,
        error_code: null,
        error_message: NO_IDS_MESSAGE,
        all: cb,
      }
      if (callbackSaysApproved) response.requires_manual_review = true

      return response
    }

    const queryTxType = TX_TYPE.INTERNAL_3D_PAYMENT_STATUS
    const queryModel = MODEL.NON_SECURE
    const query = await this.dispatchRequestDataPrepared(
      queryByOrder
        ? this.requestDataMapper.createStatusRequestData(this.account, order)
        : this.cpRequestDataMapper.create3DPaymentStatusRequestData(this.account, cb),
      queryTxType,
      order,
      queryModel,
    )
    const answer = await this.sendRequest(queryTxType, queryModel, query, order)
    const response = map(answer)

    if (response.status === 'approved') {
      this.assertAnswerMatchesOrder(
        answer,
        expectedOrderId,
        orderTransactionId ?? callbackTransactionId,
        orderPaymentToken,
        order,
        txType,
        response,
      )
      this.logger.debug('finished 3D payment', { mapped_response: response })

      return response
    }

    if (callbackSaysApproved) {
      this.logger.error('3D callback says approved but the transaction query does not confirm it', {
        proc_return_code: response.proc_return_code,
        error_code: response.error_code,
      })

      return { ...response, requires_manual_review: true }
    }

    this.logger.debug('finished 3D payment', { mapped_response: response })

    return response
  }

  /**
   * A callback id that contradicts the order's own id: rejected before any HTTP call. A payment token opens the
   * bank's card page for its payment, so a token mismatch is logged by length only.
   */
  private rejectCallbackId(expected: string, actual: string, isPaymentToken = false): never {
    if (isPaymentToken) {
      this.logger.error('3D callback id does not match the order', {
        field: 'payment_token',
        ...tokenLengths(expected, actual),
      })
      throw new OrderMismatchError('transaction_id', ORDER_TOKEN, OTHER_TOKEN)
    }
    this.logger.error('3D callback id does not match the order', { expected, actual })
    throw new OrderMismatchError('transaction_id', expected, actual)
  }

  /** Binds an approved query answer to the order (fail closed: a missing required value never matches). */
  private assertAnswerMatchesOrder(
    answer: Raw,
    expectedOrderId: string,
    expectedTransactionId: string | null,
    expectedPaymentToken: string | null,
    order: PosOrder,
    txType: TxType,
    response: PosResponse,
  ): void {
    const fail = (field: OrderMismatchField, expected: string, actual: string, isPaymentToken = false): never => {
      if (isPaymentToken) {
        this.logger.error(`transaction query ${field} does not match the payment`, {
          field: 'payment_token',
          ...tokenLengths(expected, actual),
        })
        throw new OrderMismatchError(field, ORDER_TOKEN, OTHER_TOKEN, response)
      }
      this.logger.error(`transaction query ${field} does not match the payment`, { expected, actual })
      throw new OrderMismatchError(field, expected, actual, response)
    }

    const answerOrderId = value(answer, 'OrderID') ?? value(answer, 'OrderId')
    if (expectedOrderId === '' || typeof answerOrderId !== 'string' || answerOrderId !== expectedOrderId) {
      fail('order_id', expectedOrderId, asText(answerOrderId))
    }

    // compared in the whole cents actually sent; null (missing or malformed on either side) never matches
    const answerAmount = answerCents(value(answer, 'Amount'))
    const orderAmount = orderCents(order.amount)
    if (answerAmount === null || orderAmount === null || answerAmount !== orderAmount) {
      fail('amount', asText(order.amount), asText(value(answer, 'Amount')))
    }

    const expectedCurrency = String(this.requestValueMapper.mapCurrency(order.currency ?? CURRENCY.TRY))
    const answerCurrency = value(answer, 'AmountCode') ?? value(answer, 'CurrencyCode')
    if (answerCurrency === undefined) {
      if (expectedCurrency !== '949') fail('currency', expectedCurrency, '')
    } else if (String(answerCurrency) !== expectedCurrency) {
      fail('currency', expectedCurrency, asText(answerCurrency))
    }

    // the query is authenticated with the merchant credentials (VakifBank Common Payment guide v2.1 §6.5), so an
    // absent value is accepted
    const answerMerchantId = value(answer, 'HostMerchantId')
    if (answerMerchantId !== undefined && String(answerMerchantId) !== this.account.getMerchantId()) {
      fail('merchant_id', this.account.getMerchantId(), asText(answerMerchantId))
    }

    const answerTxType = value(answer, 'TransactionType')
    if (answerTxType !== undefined) {
      const expectedTxType = this.requestValueMapper.mapTxType(txType)
      if (String(answerTxType) !== expectedTxType) {
        fail('transaction_type', expectedTxType, asText(answerTxType))
      }
    }

    const answerTransactionId = value(answer, 'TransactionId')
    if (
      expectedTransactionId !== null &&
      answerTransactionId !== undefined &&
      String(answerTransactionId) !== expectedTransactionId
    ) {
      fail('transaction_id', expectedTransactionId, asText(answerTransactionId))
    }

    const answerPaymentToken = value(answer, 'PaymentToken')
    if (
      expectedPaymentToken !== null &&
      answerPaymentToken !== undefined &&
      String(answerPaymentToken) !== expectedPaymentToken
    ) {
      fail('transaction_id', expectedPaymentToken, asText(answerPaymentToken), true)
    }
  }
}
