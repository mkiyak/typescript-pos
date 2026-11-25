import type { AbstractHttpClient } from '../client/AbstractHttpClient.js'
import { ToslaPosHttpClient } from '../client/ToslaPosHttpClient.js'
import { TX_APPROVED, TX_DECLINED } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { bankInteger, isRecord } from '../data-mapper/response/mapper/toslaResponseFields.js'
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
import type { ToslaPosAccount } from '../model/account/ToslaPosAccount.js'
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
import { ORDER_ID_PATTERN } from '../util/orderId.js'
import { parseInstallment } from '../util/parseInstallment.js'
import { parseOrderAmount } from '../util/parseOrderAmount.js'
import { phpTrim } from '../util/phpTrim.js'
import { toKurus } from '../util/toKurus.js'
import { AbstractGateway, type SupportedTransactions } from './AbstractGateway.js'

/** The bank response code of an approved payment. */
const SUCCESS_CODE = '00'

/** The 3D result of a full authentication, and the request status of a completed payment, as the bank writes them. */
const COMPLETED = '1'

/** A 3D result: one digit. */
const MD_STATUS = /^[0-9]$/

/** The bank's message on an approval: no digits, so no digit can move between it and its neighbours. */
const NO_DIGITS = /^[^0-9]{0,256}$/

/** The bank's 3D session id becomes a URL path segment and a form value. */
const SESSION_ID = /^[A-Za-z0-9]{1,128}$/

/** A transaction id as text: a positive whole number of at most 30 digits. */
const TRANSACTION_ID = /^[1-9]\d{0,29}$/

/** The transaction type the bank's record holds for a sale and for a pre-authorization. */
const RECORD_SALE = 1
const RECORD_PRE_AUTH = 2

/** The request status of a completed payment in the bank's record. */
const RECORD_COMPLETED = 1

/** Informational decline fields an unsigned declined callback may keep, as bounded plain text. */
const DECLINE_REASON_FIELDS = ['proc_return_code', 'error_code', 'error_message', 'md_error_message'] as const

/** The longest decline reason or bank message kept. */
const MAX_TEXT_LENGTH = 256

/** Callback key names and values are attacker controlled; only this much of one is echoed in errors and logs. */
const MAX_ECHOED_LENGTH = 64

/** Keys of a mapped result that an unsigned callback keeps as they are (the decision and the raw data). */
const KEPT_UNSIGNED_KEYS = new Set(['status', 'all'])

type HostedModel = typeof MODEL.THREE_D_PAY | typeof MODEL.THREE_D_HOST

type Mismatch = [field: OrderMismatchField, expected: string, actual: string]

/** The order values a callback and the bank's record are compared with, read before anything else. */
type OrderExpectations = {
  orderId: string
  /** The amount in kuruş. */
  kurus: number
  /** The bank's numeric code of the order currency. */
  currency: number
  /** The installment count, one counting as none (0). */
  installment: number
}

/** What a status answer yields: its raw record and the first mismatch (null when it confirms the payment). */
type Confirmation = { record: Record<string, unknown>; failure: Mismatch | null }

/**
 * An own value; `null` counts as absent like a missing key. Bank answers are decoded JSON, where a repeated key keeps
 * its last value.
 */
function own(data: Record<string, unknown>, key: string): unknown {
  const value: unknown = Object.hasOwn(data, key) ? data[key] : undefined
  return value === null ? undefined : value
}

/** An own value when it is a string, otherwise undefined. */
function ownText(data: Record<string, unknown>, key: string): string | undefined {
  const value = own(data, key)
  return typeof value === 'string' ? value : undefined
}

/** A scalar value as text; anything else (missing, record, list) as an empty string. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)

  return ''
}

/** Text shortened for logs and errors. */
function echo(value: unknown): string {
  return asText(value).slice(0, MAX_ECHOED_LENGTH)
}

/** One installment is a single payment, like none. */
function normalizedInstallment(count: number): number {
  return count <= 1 ? 0 : count
}

/**
 * Tosla (AkÖde) virtual POS: JSON requests to one API, 3D Pay (the server opens a 3D session and the browser posts
 * the card with the session id to the bank), 3D Host (the browser opens the bank's page for the session), non-secure
 * sales, pre-authorizations through 3D Pay / 3D Host with their post-authorization, status, cancel, full and partial
 * refund and order history.
 *
 * Every request carries a hash over the account, a random value and a time span only: the request body (order id,
 * amount, card) is not signed, so a request hash is a bearer credential and is never logged.
 *
 * The bank signs its 3D callback with `Hash`: base64 SHA-512 over the API password, the account's client id and API
 * user, then the callback's `OrderId`, `MdStatus`, `BankResponseCode`, `BankResponseMessage` and `RequestStatus`,
 * without separators. The callback carries no amount, currency or installment, and its own client id, session id and
 * transaction id are unsigned: a signature proves only that the bank reports this outcome for this order id. The
 * checks below follow from that:
 * - A callback is a flat form of strings: any other value at its top level is a `PosError` before anything else.
 *   Then the order is validated (id, amount, currency, installment), so a bad order fails while nothing was read.
 * - The signature check cannot be switched off (`disable_3d_hash_check` is ignored). A callback that carries a `Hash`
 *   is always verified first, over the one field list the bank announces (any other announced list fails); a
 *   mismatch is a `HashMismatchError`. A callback without `Hash` is rejected (`HashMismatchError`) when
 *   `require_3d_hash` is set and whenever any of its results reads as an approval (response code `00`, 3D result `1`
 *   or request status `1`, padded or not). Otherwise it can only be a decline, and its result carries no callback
 *   value except bounded decline reasons: the order id is the order's, the payment model and transaction type are the
 *   call's, the response and error codes and messages are plain text of at most 256 characters, and every other field
 *   is null. Only `all` keeps the raw (untrusted) callback. It never confirms or raises a manual review.
 * - A signed callback whose response code is not `00` and whose request status is not `1` (padding ignored) is a
 *   decline, also when its 3D authentication succeeded, mapped as it came (decline texts are free form), and must map
 *   as declined, otherwise `PosError`. A signed decline is not bound to the order: its
 *   order id is the bank's echo and must not be used to find an order.
 * - Any other signed callback is a bank approval. The signed values have no separators, so before anything else
 *   their exact text is pinned: response code `00`, request status `1`, a one-digit 3D result, a message without
 *   digits (or none) and an order id of letters, digits, `_` and `-` that starts with a letter or digit; anything
 *   else is `HashMismatchError('3D callback fields are malformed')`. With those pins the signed text ends with the 3D
 *   digit, `00`, a message without digits and `1`, so the order id is the unique text before them: a genuine
 *   approval of order `A1001` cannot be read as an approval of order `A` with message `1100`.
 * - A bank approval must belong to the order before any request (`OrderMismatchError`, nothing attached): the signed
 *   order id must be the order's and the unsigned client id, when sent, the account's.
 * - A bank approval with full 3D authentication (3D result `1`) that maps as approved is confirmed with exactly one
 *   status request for the order id before it is returned. The bank's record must answer result code `0` with
 *   response code `00`, name this order id, be a sale (a pre-authorization for `pre`) in request status `1`, hold the
 *   order's amount in kuruş, its currency and installment count (one counting as none), nothing refunded or
 *   post-authorized and, when it names one, the account's client id. Any other answer is an `OrderMismatchError`
 *   with the result attached and flagged for manual review: a genuine payment whose record lags still needs
 *   attention. Errors of the status request (such as `PosHttpError`) propagate; the payment may have completed, so
 *   check it later with `status`. A confirmed result takes its authorization code, host reference, transaction id
 *   and installment count from the record, never from the callback; its amount and currency are the order's.
 * - A bank approval whose 3D authentication did not fully succeed is `declined`: with `requires_manual_review: true`
 *   and the record's references when one status request shows the bank holds that payment of the order, otherwise
 *   plainly declined (a callback alone does not raise alerts).
 * - After a sale or a post-authorization, an answer without an integer result code (empty, 204, text only), or with
 *   result code `0` but no bank response code text (or one that is `00` only after trimming), is a `PosHttpError`
 *   naming the request URL: it does not tell whether money moved, so it is never a decline a merchant could retry.
 *   An approved answer with another result code or for another order id is an `OrderMismatchError` with the result
 *   attached. Cancel, refund, status and history answers are mapped as they come.
 */
export class ToslaPos extends AbstractGateway<ToslaPosAccount> {
  static readonly NAME = 'ToslaPos'

  static override readonly GATEWAY_CLASS: string = 'ToslaPos'

  protected static override readonly testModeAffectsRequests: boolean = false

  protected static override supportedTransactions: SupportedTransactions = {
    [TX_TYPE.PAY_AUTH]: [MODEL.THREE_D_PAY, MODEL.THREE_D_HOST, MODEL.NON_SECURE],
    [TX_TYPE.PAY_PRE_AUTH]: [MODEL.THREE_D_PAY, MODEL.THREE_D_HOST],
    [TX_TYPE.PAY_POST_AUTH]: true,
    [TX_TYPE.STATUS]: true,
    [TX_TYPE.CANCEL]: true,
    [TX_TYPE.REFUND]: true,
    [TX_TYPE.REFUND_PARTIAL]: true,
    [TX_TYPE.ORDER_HISTORY]: true,
  }

  /** @throws UnsupportedPaymentModelError this bank has no 3D Secure model with a separate provision */
  async make3DPayment(
    _gatewayResponseData: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
    _card: CreditCard | null = null,
  ): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError('ToslaPos does not support the 3D Secure model')
  }

  /**
   * @throws PosError when the callback is not a flat form of strings or the order is malformed
   * @throws HashMismatchError when a present hash does not verify, a required hash is missing, or the signed fields
   *   of an approval are malformed
   * @throws OrderMismatchError when an approval does not belong to the order or account (nothing is sent), or when
   *   the bank's status record does not confirm an approved payment (result attached, flagged for manual review)
   * @throws PosHttpError when the status request fails
   */
  async make3DPayPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
  ): Promise<PosResponse> {
    return this.completeHostedPayment(gatewayResponseData, order, txType, MODEL.THREE_D_PAY)
  }

  /** Same checks as `make3DPayPayment`. */
  async make3DHostPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
  ): Promise<PosResponse> {
    return this.completeHostedPayment(gatewayResponseData, order, txType, MODEL.THREE_D_HOST)
  }

  /**
   * Opens a 3D session with the bank (one signed request), then returns what the browser is sent to: the 3D Host
   * page of the session (GET), or the 3D Pay form with the session id and, unless `createWithoutCard` is set, the
   * card. A form without the card lets the payer type it on the page that posts the form; nothing later needs the
   * card, so it must not be stored.
   *
   * @throws UnsupportedFormFormatError for `formFormat: 'html'`
   * @throws PosError when the bank does not open the session or answers with a malformed session id
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

    const requestData = await this.dispatchRequestDataPrepared(
      await this.requestDataMapper.create3DFormInitializeRequestData(this.account, order, paymentModel, txType),
      txType,
      order,
      paymentModel,
    )
    const answer = await this.sendRequest(txType, paymentModel, requestData, order)

    if (own(answer, 'Code') !== 0) {
      const message = ownText(answer, 'Message')?.slice(0, MAX_TEXT_LENGTH) || 'unknown error'
      this.logger.error('3D session could not be created', { code: echo(own(answer, 'Code')) })
      throw new PosError(`3D session could not be created: ${message}`)
    }
    if (!SESSION_ID.test(ownText(answer, 'ThreeDSessionId') ?? '')) {
      this.logger.error('3D session id is missing or malformed', { payment_model: paymentModel })
      throw new PosError('3D session id is missing or malformed')
    }

    this.logger.debug('preparing 3D form data', { payment_model: paymentModel, tx_type: txType })

    return this.requestDataMapper.create3DFormData(
      this.account,
      answer,
      paymentModel,
      txType,
      this.get3DGatewayURL(paymentModel),
      this.cardForForm(card, createWithoutCard),
    ) as Promise<ThreeDFormData>
  }

  /**
   * The non-secure sale: an answer without an integer result code is an unknown outcome, not a decline.
   *
   * @throws PosHttpError when the answer carries no result code
   * @throws OrderMismatchError when an approved answer has another result code or order id (result attached)
   */
  override async makeRegularPayment(order: PosOrder, card: CreditCard, txType: TxType): Promise<PosResponse> {
    const paymentModel = MODEL.NON_SECURE
    this.logger.debug('making payment', { model: paymentModel, tx_type: txType })
    if (!this.gatewayClass().isSupportedTransaction(txType, paymentModel)) {
      throw new UnsupportedTransactionTypeError(`Invalid transaction type "${txType}" provided`)
    }
    const orderId = this.orderIdOf(order)

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createNonSecurePaymentRequestData(this.account, order, txType, card),
      txType,
      order,
      paymentModel,
    )

    return this.sendMoneyRequest(txType, requestData, order, orderId)
  }

  /** The post-authorization: same rules as the sale. */
  override async makeRegularPostPayment(order: PosOrder): Promise<PosResponse> {
    const txType = TX_TYPE.PAY_POST_AUTH
    const paymentModel = MODEL.NON_SECURE
    this.logger.debug('making payment', { model: paymentModel, tx_type: txType })
    const orderId = this.orderIdOf(order)

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createNonSecurePostAuthPaymentRequestData(this.account, order),
      txType,
      order,
      paymentModel,
    )

    return this.sendMoneyRequest(txType, requestData, order, orderId)
  }

  private async completeHostedPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    paymentModel: HostedModel,
  ): Promise<PosResponse> {
    const callback = this.flatCallback(gatewayResponseData)
    // Every order value the callback and the bank's record are compared with fails here, before anything is read.
    const expected = this.orderExpectations(order)

    const signed = this.verifyPresentHash(callback)

    if (!signed) {
      if (this.reportsApproval(callback, true) || this.config.require_3d_hash === true) {
        this.rejectUnsigned(callback)
      }
      const declined = this.mapCallback(callback, txType, order, paymentModel)
      if (declined.status !== TX_DECLINED) {
        this.rejectUnsigned(callback)
      }

      return this.unsignedResult(declined, expected.orderId, txType, paymentModel)
    }

    if (!this.reportsApproval(callback, false)) {
      const declined = this.mapCallback(callback, txType, order, paymentModel)
      if (declined.status !== TX_DECLINED) {
        // The approval would skip the field pins, the order binding and the bank's confirmation.
        this.logger.error('3D callback without approval was mapped as approved', {
          order_id: echo(declined.order_id),
        })
        throw new PosError('3D callback without approval was mapped as approved')
      }

      return declined
    }

    this.assertApprovalFields(callback)
    this.assertCallbackBelongsToOrder(callback, expected.orderId)

    const response = this.mapCallback(callback, txType, order, paymentModel)

    if (ownText(callback, 'MdStatus') === COMPLETED) {
      if (response.status !== TX_APPROVED) {
        return response
      }

      return this.confirmPayment(response, expected, txType)
    }

    return this.declineUnauthenticatedApproval(response, expected, txType)
  }

  private mapCallback(
    callback: Record<string, unknown>,
    txType: TxType,
    order: PosOrder,
    paymentModel: HostedModel,
  ): PosResponse {
    return paymentModel === MODEL.THREE_D_HOST
      ? this.responseDataMapper.map3DHostResponseData(callback, txType, order)
      : this.responseDataMapper.map3DPayResponseData(callback, txType, order)
  }

  /**
   * Every approved 3D Pay / 3D Host result is confirmed by the bank's own status record before it is returned; the
   * references come from that record.
   */
  private async confirmPayment(
    response: PosResponse,
    expected: OrderExpectations,
    txType: TxType,
  ): Promise<PosResponse> {
    const { record, failure } = await this.bankRecordConfirms(expected, txType)
    if (failure !== null) {
      this.fail(...failure, expected.orderId, { ...response, requires_manual_review: true })
    }

    this.logger.info('payment confirmed by the bank status record', { order_id: echo(expected.orderId) })

    return {
      ...response,
      ...this.recordReferences(record),
      installment_count: bankInteger(own(record, 'InstallmentCount')),
    }
  }

  /**
   * The bank approved a payment whose 3D authentication did not fully succeed: it is not accepted. Whether money moved
   * is only known from the bank's record, so the manual review flag needs that record.
   */
  private async declineUnauthenticatedApproval(
    response: PosResponse,
    expected: OrderExpectations,
    txType: TxType,
  ): Promise<PosResponse> {
    if (response.status !== TX_DECLINED) {
      this.logger.error('3D callback without full authentication was not mapped as declined', {
        order_id: echo(expected.orderId),
      })
      throw new PosError('3D callback without full authentication was not mapped as declined')
    }

    const { record, failure } = await this.bankRecordConfirms(expected, txType)
    if (failure !== null) {
      this.logger.warn('payment approved without full 3D authentication, the bank record does not confirm it', {
        order_id: echo(expected.orderId),
        field: failure[0],
      })

      return response
    }

    this.logger.error('payment approved without full 3D authentication, manual review required', {
      order_id: echo(expected.orderId),
    })

    return { ...response, ...this.recordReferences(record), requires_manual_review: true }
  }

  /** The authorization code, host reference and transaction id of a confirming bank record. */
  private recordReferences(record: Record<string, unknown>): {
    auth_code: string | null
    ref_ret_num: string | null
    transaction_id: string | null
  } {
    const transactionId = own(record, 'TransactionId')

    return {
      auth_code: ownText(record, 'AuthCode') || null,
      ref_ret_num: ownText(record, 'HostReferenceNumber') || null,
      // A reference only, never compared: a positive integer, or its text (the bank's ids exceed 15 digits).
      transaction_id:
        (typeof transactionId === 'number' && Number.isSafeInteger(transactionId) && transactionId > 0) ||
        (typeof transactionId === 'string' && TRANSACTION_ID.test(transactionId))
          ? String(transactionId)
          : null,
    }
  }

  /**
   * One status request for the order id, and the first way in which the bank's record does not show a completed,
   * open payment of this order id, transaction type, amount, currency and installment count (null when it does).
   * Every check reads the bank's own values (integers as the bank sent them), never mapped display values.
   */
  private async bankRecordConfirms(expected: OrderExpectations, txType: TxType): Promise<Confirmation> {
    const statusOrder: PosOrder = { id: expected.orderId }
    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createStatusRequestData(this.account, statusOrder),
      TX_TYPE.STATUS,
      statusOrder,
      MODEL.NON_SECURE,
    )
    const answer = await this.sendRequest(TX_TYPE.STATUS, MODEL.NON_SECURE, requestData, statusOrder)
    const mapped = this.responseDataMapper.mapStatusResponse(answer)

    const record = isRecord(answer) ? answer : {}
    const closed = (failure: Mismatch): Confirmation => ({ record, failure })

    if (!isRecord(answer) || own(record, 'Code') !== 0 || mapped.status !== TX_APPROVED) {
      return closed(['order_status', TX_APPROVED, asText(mapped.status)])
    }

    const recordOrderId = ownText(record, 'OrderId') ?? ''
    if (recordOrderId !== expected.orderId) {
      return closed(['order_id', expected.orderId, recordOrderId])
    }

    const responseCode = ownText(record, 'BankResponseCode') ?? ''
    if (responseCode !== SUCCESS_CODE) {
      return closed(['order_status', SUCCESS_CODE, responseCode])
    }

    const wantedType = txType === TX_TYPE.PAY_PRE_AUTH ? RECORD_PRE_AUTH : RECORD_SALE
    const recordType = bankInteger(own(record, 'TransactionType'))
    if (recordType !== wantedType) {
      return closed(['transaction_type', String(wantedType), asText(own(record, 'TransactionType'))])
    }

    if (bankInteger(own(record, 'RequestStatus')) !== RECORD_COMPLETED) {
      return closed(['order_status', String(RECORD_COMPLETED), asText(own(record, 'RequestStatus'))])
    }

    if (bankInteger(own(record, 'Amount')) !== expected.kurus) {
      return closed(['amount', String(expected.kurus), asText(own(record, 'Amount'))])
    }

    if (bankInteger(own(record, 'Currency')) !== expected.currency) {
      return closed(['currency', String(expected.currency), asText(own(record, 'Currency'))])
    }

    const installment = bankInteger(own(record, 'InstallmentCount'))
    if (installment === null || normalizedInstallment(installment) !== expected.installment) {
      return closed(['installment', String(expected.installment), asText(own(record, 'InstallmentCount'))])
    }

    for (const key of ['RefundedAmount', 'PostAuthedAmount'] as const) {
      if (bankInteger(own(record, key)) !== 0) {
        return closed(['order_status', 'open', `${key} ${asText(own(record, key))}`])
      }
    }

    const clientId = own(record, 'ClientId')
    if (clientId !== undefined && asText(clientId) !== this.account.getMerchantId()) {
      return closed(['merchant_id', this.account.getMerchantId(), asText(clientId)])
    }

    return { record, failure: null }
  }

  /**
   * Sends a sale or post-authorization. The answer must carry an integer result code, otherwise nobody knows whether
   * money moved; an approval must carry result code `0` and this order id.
   */
  private async sendMoneyRequest(
    txType: TxType,
    requestData: Record<string, unknown>,
    order: PosOrder,
    orderId: string,
  ): Promise<PosResponse> {
    const paymentModel = MODEL.NON_SECURE
    const client = this.getClient(txType, paymentModel)
    const answer = await client.request(txType, paymentModel, requestData, order, null)
    const response = this.responseDataMapper.mapPaymentResponse(answer, txType, order)

    const code = own(answer, 'Code')
    if (typeof code !== 'number' || !Number.isSafeInteger(code)) {
      this.logger.error('bank answer carries no result code', { order_id: echo(orderId), tx_type: txType })
      throw new PosHttpError('Bank answer carries no result code; the payment outcome is unknown', {
        url: this.moneyRequestUrl(client, txType),
      })
    }
    // A result code 0 says the request was processed; only the bank response code says whether money moved.
    const responseCode = own(answer, 'BankResponseCode')
    if (code === 0 && (typeof responseCode !== 'string' || responseCode === '')) {
      this.logger.error('bank answer carries no bank response code', { order_id: echo(orderId), tx_type: txType })
      throw new PosHttpError('Bank answer carries no bank response code; the payment outcome is unknown', {
        url: this.moneyRequestUrl(client, txType),
      })
    }

    // A code that is `00` only once blanks are trimmed may be a mangled approval: it is neither approved nor declined.
    if (code === 0 && typeof responseCode === 'string' && responseCode !== '00' && responseCode.trim() === '00') {
      this.logger.error('bank answer carries a padded bank response code', { order_id: echo(orderId), tx_type: txType })
      throw new PosHttpError('Bank response code is not exact; the payment outcome is unknown', {
        url: this.moneyRequestUrl(client, txType),
      })
    }

    if (response.status === TX_APPROVED) {
      if (code !== 0) {
        this.fail('order_status', '0', String(code), orderId, response)
      }
      const answerOrderId = ownText(answer, 'OrderId') ?? ''
      if (answerOrderId !== orderId) {
        this.fail('order_id', orderId, answerOrderId, orderId, response)
      }
    }

    return response
  }

  /** The URL a sale or post-authorization was posted to. */
  private moneyRequestUrl(client: AbstractHttpClient, txType: TxType): string {
    return client instanceof ToslaPosHttpClient
      ? client.getApiUrl(txType, MODEL.NON_SECURE)
      : this.config.gateway_endpoints.payment_api
  }

  /**
   * A bank callback is a flat form of strings. Another value (a number, a record, a list, null) could be read
   * differently by the signature check and the response mapper, so it is refused before anything else.
   */
  private flatCallback(gatewayResponseData: GatewayResponseData): Record<string, unknown> {
    const data: unknown = gatewayResponseData
    if (!isRecord(data)) {
      throw new PosError('3D callback data must be a record')
    }
    // own property names include non-enumerable ones, which a spread or `Object.entries` would skip
    for (const key of Object.getOwnPropertyNames(data)) {
      const value: unknown = data[key]
      if (value !== undefined && typeof value !== 'string') {
        const field = key.slice(0, MAX_ECHOED_LENGTH)
        this.logger.error('3D callback field is not a string', { field, type: value === null ? 'null' : typeof value })
        throw new PosError(`3D callback field "${field}" must be a string`)
      }
    }

    return data
  }

  /** Verifies a present `Hash`; returns whether the callback was signed. */
  private verifyPresentHash(callback: Record<string, unknown>): boolean {
    const hash = own(callback, 'Hash')
    if (hash === undefined || hash === '') {
      return false
    }
    if (!this.crypt.check3DHash(this.account, callback as GatewayResponseData)) {
      throw new HashMismatchError('3D callback hash mismatch')
    }

    return true
  }

  /**
   * Whether the callback reads as a bank approval, padding ignored (the pins then read the exact text): response code
   * `00` or request status `1`. A successful 3D result alone is no bank approval on a signed callback (the bank
   * signs 3D-authenticated declines too); an unsigned callback with one is still refused.
   */
  private reportsApproval(callback: Record<string, unknown>, countAuthentication: boolean): boolean {
    const trimmed = (key: string): string | undefined => {
      const value = ownText(callback, key)
      return value === undefined ? undefined : phpTrim(value)
    }

    return (
      trimmed('BankResponseCode') === SUCCESS_CODE ||
      trimmed('RequestStatus') === COMPLETED ||
      (countAuthentication && trimmed('MdStatus') === COMPLETED)
    )
  }

  private rejectUnsigned(callback: Record<string, unknown>): never {
    this.logger.error('3D callback has no Hash', { order_id: echo(ownText(callback, 'OrderId')) })
    throw new HashMismatchError('3D callback has no Hash')
  }

  /**
   * Runs after the hash verified, on a callback that reads as an approval: the signed values run together without
   * separators, so each one must be exactly in its format. Declines are not checked: a decline grants nothing, and
   * the bank's decline texts are free form.
   */
  private assertApprovalFields(callback: Record<string, unknown>): void {
    const malformed: string[] = []
    if (ownText(callback, 'BankResponseCode') !== SUCCESS_CODE) malformed.push('BankResponseCode')
    if (ownText(callback, 'RequestStatus') !== COMPLETED) malformed.push('RequestStatus')
    if (!MD_STATUS.test(ownText(callback, 'MdStatus') ?? '')) malformed.push('MdStatus')
    const message = ownText(callback, 'BankResponseMessage')
    if (message !== undefined && !NO_DIGITS.test(message)) malformed.push('BankResponseMessage')
    if (!ORDER_ID_PATTERN.test(ownText(callback, 'OrderId') ?? '')) malformed.push('OrderId')

    if (malformed.length > 0) {
      this.logger.error('3D callback fields are malformed', {
        order_id: echo(ownText(callback, 'OrderId')),
        fields: malformed,
      })
      throw new HashMismatchError('3D callback fields are malformed')
    }
  }

  /**
   * A bank approval must name this order (signed) and, when it sends one, this account's client id (unsigned). Runs
   * before any request and attaches nothing: the callback may belong to another order, whose own handler deals with
   * it.
   */
  private assertCallbackBelongsToOrder(callback: Record<string, unknown>, orderId: string): void {
    const callbackOrderId = ownText(callback, 'OrderId') ?? ''
    if (callbackOrderId !== orderId) {
      this.fail('order_id', orderId, callbackOrderId, orderId)
    }

    const clientId = ownText(callback, 'ClientId')
    if (clientId !== undefined && clientId !== this.account.getMerchantId()) {
      this.fail('merchant_id', this.account.getMerchantId(), clientId, orderId)
    }
  }

  /**
   * The result of an unsigned declined callback, built from trusted data only: every value the callback could have
   * chosen is dropped (null) and replaced by the order's id and the call's transaction type and payment model. Its
   * decline reasons grant nothing and a merchant needs them for a genuine decline, so they stay as informational
   * plain text of bounded length (anything but a string becomes null). The raw data (`all`) is kept as is.
   */
  private unsignedResult(
    response: PosResponse,
    orderId: string,
    txType: TxType,
    paymentModel: PaymentModel,
  ): PosResponse {
    const result: PosResponse = { ...response }
    delete result.requires_manual_review
    for (const key of Object.keys(result)) {
      if (!KEPT_UNSIGNED_KEYS.has(key)) result[key] = null
    }
    for (const key of DECLINE_REASON_FIELDS) {
      if (!Object.hasOwn(response, key)) continue
      const reason: unknown = response[key]
      result[key] = typeof reason === 'string' ? reason.slice(0, MAX_TEXT_LENGTH) : null
    }

    return {
      ...result,
      status: TX_DECLINED,
      order_id: orderId,
      transaction_type: txType,
      payment_model: paymentModel,
    }
  }

  /**
   * The order values every check compares with, read once before the callback is: the order id, the amount in
   * kuruş, the currency's bank code and the installment count. A value the bank cannot have been sent is a
   * `PosError`.
   */
  private orderExpectations(order: PosOrder): OrderExpectations {
    const orderId = this.orderIdOf(order)
    const kurus = toKurus(parseOrderAmount(order.amount))
    const currency: unknown = order.currency ?? CURRENCY.TRY
    if (typeof currency !== 'string') {
      throw new PosError('The order currency must be text.')
    }
    const currencyCode = Number(this.requestValueMapper.mapCurrency(currency as Currency))
    const installment = normalizedInstallment(parseInstallment(order.installment))

    return { orderId, kurus, currency: currencyCode, installment }
  }

  /** The order id every request and binding uses: a letter or digit, then letters, digits, `_` and `-` (at most 64). */
  private orderIdOf(order: PosOrder): string {
    const id: unknown = Object.hasOwn(order, 'id') ? order.id : undefined
    const text = typeof id === 'string' || (typeof id === 'number' && Number.isSafeInteger(id)) ? String(id) : ''
    if (!ORDER_ID_PATTERN.test(text)) {
      throw new PosError(
        'The order id may only hold letters, digits, underscores and hyphens, and must start with a letter or digit (at most 64).',
      )
    }

    return text
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
