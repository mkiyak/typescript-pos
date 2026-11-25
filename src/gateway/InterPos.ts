import { TX_APPROVED, TX_DECLINED } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
import {
  HashMismatchError,
  OrderMismatchError,
  type OrderMismatchField,
  PosError,
  UnsupportedFormFormatError,
  UnsupportedTransactionTypeError,
} from '../errors.js'
import type { InterPosAccount } from '../model/account/InterPosAccount.js'
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
import { AbstractGateway, type SupportedTransactions } from './AbstractGateway.js'

/** The return code of an approved payment. */
const SUCCESS_CODE = '00'

/**
 * The order id a signed callback may carry: plain ASCII letters, digits, `_` and `-`. A leading `_` or `-` is kept
 * here although new payments refuse it, so that orders created before the shared order id rule still complete.
 */
const CALLBACK_ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * Strict formats of the signed callback fields. The bank concatenates the signed values without separators, so a
 * valid hash alone does not fix where one field ends and the next begins; these formats do. With `Version` and
 * `Exponent` empty, a three-digit `Currency` and return URLs that start with `http`, the amount and the currency
 * cannot move; `mdStatus` is a single digit at the end, and `Response` holds no digits, so no digit can move between
 * the return code, the response text and `mdStatus`.
 */
const CURRENCY_CODE = /^\d{3}$/
const RETURN_URL = /^https?:/i
const RETURN_CODE = /^\d{2}$/
const RESPONSE_TEXT = /^[A-Za-z ]{1,32}$/
const MD_STATUS = /^\d$/

/** A bank amount: digits, optionally with dotted thousands, and an optional decimal comma with one or two digits. */
const BANK_AMOUNT = /^(?:\d{1,13}|\d{1,3}(?:\.\d{3}){1,4})(?:,\d{1,2})?$/

/** The unsigned 3D authentication values the provision request carries. */
const AUTHENTICATION_VALUE = /^[A-Za-z0-9+/=]{0,128}$/
const ECI = /^\d{0,2}$/
const MAX_MD_LENGTH = 1024

/** The authorization code of an approved transaction in the bank's status record. */
const AUTH_CODE = /^[\x21-\x7E]{1,32}$/

/** The transaction result of an approved transaction in the bank's status record. */
const TXN_RESULT_SUCCESS = 'Success'

/** The bank prints "never voided" as the year-one placeholder. */
const NO_VOID_DATE = '1.1.0001 00:00:00'

/** A refunded amount that reports nothing. */
const ZERO_AMOUNT = /^0+(?:[.,]0+)?$/

/** Informational decline fields an unsigned declined callback may keep, as bounded plain text. */
const DECLINE_REASON_FIELDS = [
  'proc_return_code',
  'error_code',
  'error_message',
  'md_status',
  'md_error_message',
] as const

/** The longest decline reason kept from an unsigned callback. */
const MAX_DECLINE_REASON_LENGTH = 256

/** Callback key names and values are attacker controlled; only this much of one is echoed in errors and logs. */
const MAX_ECHOED_LENGTH = 64

/** Keys of a mapped result that an unsigned callback keeps as they are (the decision and the raw data). */
const KEPT_UNSIGNED_KEYS = new Set(['status', 'all', '3d_all'])

type HostedModel = typeof MODEL.THREE_D_PAY | typeof MODEL.THREE_D_HOST

type Mismatch = [field: OrderMismatchField, expected: string, actual: string]

/** An own callback value; `null` counts as absent like a missing key. */
function own(data: Record<string, unknown>, key: string): unknown {
  const value: unknown = Object.hasOwn(data, key) ? data[key] : undefined
  return value === null ? undefined : value
}

/** An own value when it is a string, otherwise undefined (callbacks and bank records are read only as strings). */
function ownText(data: Record<string, unknown>, key: string): string | undefined {
  const value = own(data, key)
  return typeof value === 'string' ? value : undefined
}

/** A scalar value as text; anything else (missing, object, list) as an empty string. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'bigint') return String(value)

  return ''
}

/** Two-decimal text of a number, or null when it cannot be an amount. */
function twoDecimals(amount: number): string | null {
  if (Number.isNaN(amount)) return null
  try {
    return numberFormat2(amount)
  } catch (e) {
    if (e instanceof PosError) return null
    throw e
  }
}

/** The order amount as the bank's amounts are compared with it (two decimals), or null when it is not usable. */
function orderAmount(order: PosOrder): string | null {
  const amount = parseOrderAmount(order.amount)
  return amount > 0 ? twoDecimals(amount) : null
}

/**
 * An amount the bank wrote (`1,01`, `1.056,20`, `320`) at two decimals, or null for anything else. A dot is only a
 * thousands separator here, so `1.01` is not read as one lira: it fails, and the comparison fails closed.
 */
function bankAmount(value: unknown): string | null {
  if (typeof value !== 'string' || !BANK_AMOUNT.test(value)) return null

  return twoDecimals(Number(value.replaceAll('.', '').replace(',', '.')))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * InterPos virtual POS (Denizbank InterVPOS): form requests with `Key=Value;;` answers, 3D Secure (3D model with a
 * server-side provision), 3D Pay and 3D Host.
 *
 * The bank signs its 3D callback with `HASH`, a SHA-1 digest over `Version`, `PurchAmount`, `Exponent`, `Currency`,
 * `OkUrl`, `FailUrl`, `MD`, `OrderId`, `ProcReturnCode`, `Response` and `mdStatus` followed by the merchant password,
 * without separators. Everything else in the callback (the 3D status, ECI, CAVV and payer transaction id, the shop
 * code, card and host fields, error texts) is unsigned, and nothing signs the posted payment model, so a browser can
 * turn a 3D Pay form into a 3D Secure one and back. The checks below follow from that:
 * - A callback is a flat record of strings: an object, array or function anywhere at its top level is a `PosError`
 *   before any other check.
 * - The hash check cannot be switched off (`disable_3d_hash_check` is ignored). A callback that carries a `HASH` is
 *   always verified first, for every payment model and outcome, over the one field list the bank sends; any other
 *   announced list fails. A mismatch is a `HashMismatchError`. A callback without `HASH` is rejected
 *   (`HashMismatchError`) when `require_3d_hash` is set and whenever it reports success (a 3D-successful 3D Secure
 *   callback, a 3D Pay / 3D Host callback with return code `00` or one the response mapper approves). Otherwise it can
 *   only be a decline, and its result carries no callback value except bounded decline reasons: the order id is the
 *   order's, the payment model and transaction type are the call's, the return and error codes, error message, 3D
 *   status and 3D error message are plain text of at most 256 characters, and every other field (amount, currency,
 *   card mask, ECI, authorization code, time, transaction security) is null. Only `all` / `3d_all` keep the raw
 *   (untrusted) callback. It never raises a manual review.
 * - Signed values have no separators, so after the hash verifies their formats are pinned: `Version` and `Exponent`
 *   are empty, `Currency` three digits, `PurchAmount` a bank amount (`1,01`, `1.056,20`), the return URLs start with
 *   `http`, the return code is empty or two digits, `Response` letters and spaces only, `mdStatus` one digit and the
 *   order id letters, digits, `_` or `-`. These formats are checked on every callback that reports 3D success or
 *   an approval (return code `00`); a signed decline grants nothing and is mapped as it came, since the bank's decline
 *   texts and codes are free form. A violation is `HashMismatchError('3D callback fields are
 *   malformed')`. One shift remains possible: a genuine callback of order `1200` without a return code reads as an
 *   approval of order `12`. Only the bank can tell, which is why every approval is confirmed (see below).
 * - 3D success is the response mapper's reading of the unsigned `3DStatus` (1 to 4) together with the signed
 *   `mdStatus` being exactly the same text, so the decision rests on the signed value. A callback taken down the
 *   declined path must map as declined, and a 3D Pay / 3D Host callback without return code `00` must not map as
 *   approved, otherwise `PosError`.
 * - A callback must belong to the order (`OrderMismatchError`): the signed `OrderId`, amount and currency equal the
 *   order's, and the unsigned shop code, when present, the account's. For 3D Secure this runs before the provision
 *   request (nothing attached); for 3D Pay / 3D Host it runs on the mapped result, which is attached because the bank
 *   may already have charged the card.
 * - 3D Secure: a 3D-successful callback with return code `00` is a 3D Pay result posted to a 3D Secure order: after
 *   the order binding it is `OrderMismatchError` on `payment_model`, and nothing is provisioned. The 3D Pay result
 *   (and with it `paymentMayHaveCompleted`) is attached only when one status request shows the bank holds that
 *   payment of the order. Any other non-empty return code on a 3D success is malformed. The unsigned ECI, CAVV and payer transaction id must
 *   be short base64 or digit strings and the signed `MD` a non-empty string of at most 1024 characters, otherwise
 *   `PosError` before any request; only the bank can reject altered values. The provision answer must be approved
 *   with return code `00`, for this order id and, when it carries an amount, for the order's amount; otherwise
 *   `OrderMismatchError` with the result attached.
 * - 3D Pay / 3D Host: every approved result is confirmed with one status request before it is returned. The bank's
 *   record must be approved with return code `00` (and a transaction result, when present, of `Success`), for this
 *   order id, with an authorization code, for the order's
 *   amount, and neither voided nor refunded; otherwise `OrderMismatchError` with the result attached and flagged for
 *   manual review. The authorization code and transaction id of the returned result are taken from that record.
 *   Errors of the status request (such as `PosHttpError`) propagate unchanged; the payment may have completed, so
 *   check it later with `status`. Declined results are never confirmed.
 * - A payment the bank approved (return code `00`) although the 3D authentication did not succeed, on any of the
 *   three models, is `declined` after the field formats and the order binding: with `requires_manual_review: true`
 *   when one status request shows the bank holds that payment of the order, otherwise plainly declined (a callback
 *   alone does not raise alerts). Its return code is null, and its authorization code and transaction id come from
 *   the bank's record (null without it).
 */
export class InterPos extends AbstractGateway<InterPosAccount> {
  static readonly NAME = 'InterPos'

  static override readonly GATEWAY_CLASS: string = 'InterPos'

  protected static override readonly testModeAffectsRequests: boolean = false

  protected static override supportedTransactions: SupportedTransactions = {
    [TX_TYPE.PAY_AUTH]: [MODEL.THREE_D_SECURE, MODEL.THREE_D_PAY, MODEL.THREE_D_HOST, MODEL.NON_SECURE],
    [TX_TYPE.PAY_PRE_AUTH]: [MODEL.THREE_D_SECURE, MODEL.THREE_D_PAY, MODEL.THREE_D_HOST, MODEL.NON_SECURE],
    [TX_TYPE.PAY_POST_AUTH]: true,
    [TX_TYPE.STATUS]: true,
    [TX_TYPE.CANCEL]: true,
    [TX_TYPE.REFUND]: true,
    [TX_TYPE.REFUND_PARTIAL]: true,
    [TX_TYPE.ORDER_HISTORY]: false,
  }

  /**
   * @throws PosError when a callback value is not a plain string or an authentication value is malformed
   * @throws HashMismatchError when a present hash does not verify, a required hash is missing, or the signed fields
   *   are malformed
   * @throws OrderMismatchError when the callback does not belong to the order or account (nothing is sent), when it
   *   is an approved 3D Pay result (`payment_model`, result attached only when the bank's record shows the payment),
   *   or when the approved provision answer does not belong to the order (result attached)
   * @throws PosHttpError when the provision answer carries no result: the payment may have gone through, check
   *   `status` before any retry
   */
  async make3DPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    _card: CreditCard | null = null,
  ): Promise<PosResponse> {
    const paymentModel = MODEL.THREE_D_SECURE
    const callback = gatewayResponseData as Record<string, unknown>

    this.assertFlatCallback(callback)
    const signed = this.verifyPresentHash(callback)
    const authenticated = this.isAuthenticated(callback)

    if (!authenticated) {
      if (!signed) {
        this.refuseIfHashRequired(callback)
      }
      const declined = this.responseDataMapper.map3DPaymentData(callback, null, txType, order)
      if (declined.status !== TX_DECLINED) {
        // Never report a payment that skipped the order binding and the provision.
        this.logger.error('3D callback without 3D success was not mapped as declined', {
          order_id: this.echo(declined.order_id),
          status: this.echo(declined.status),
        })
        throw new PosError('3D callback without 3D success was not mapped as declined')
      }

      if (!signed) {
        return this.unsignedResult(declined, order, txType, paymentModel)
      }
      if (ownText(callback, 'ProcReturnCode') === SUCCESS_CODE) {
        // The bank charged the card (a 3D Pay form posted as 3D Secure) although the 3D authentication failed.
        this.assertSignedFields(callback)
        const orderId = existingOrderIdOf(order)
        this.assertCallbackMatchesOrder(callback, order, orderId)

        return this.declineUnauthenticatedApproval(declined, order, orderId)
      }

      return declined
    }

    if (!signed) {
      this.rejectUnsigned(callback)
    }
    this.assertSignedFields(callback)

    const returnCode = ownText(callback, 'ProcReturnCode') ?? ''
    if (returnCode !== '' && returnCode !== SUCCESS_CODE) {
      this.malformed(callback, ['ProcReturnCode'])
    }

    const orderId = existingOrderIdOf(order)
    this.assertCallbackMatchesOrder(callback, order, orderId)

    if (returnCode === SUCCESS_CODE) {
      await this.rejectSwappedPaymentModel(callback, order, orderId, txType)
    }

    this.assertAuthenticationValues(callback)

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.create3DPaymentRequestData(this.account, order, txType, callback),
      txType,
      order,
      paymentModel,
    )
    const provision = await this.sendRequest(txType, paymentModel, requestData, order)
    this.assertAnswerHasResult(txType, provision)

    const response = this.responseDataMapper.map3DPaymentData(callback, provision, txType, order)
    this.logger.debug('finished 3D payment', { mapped_response: response })

    if (response.status !== TX_APPROVED) {
      return response
    }

    this.assertProvisionMatchesOrder(provision, order, orderId, response)

    return response
  }

  /**
   * @throws PosError when a callback value is not a plain string
   * @throws HashMismatchError when a present hash does not verify, a required hash is missing, or the signed fields
   *   are malformed
   * @throws OrderMismatchError when the callback does not belong to the order or account, or when the bank's status
   *   record does not confirm an approved payment (the mapped response is attached)
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
   * The form data for the browser to post.
   *
   * @throws UnsupportedFormFormatError for `formFormat: 'html'` (the bank page is always posted by the browser)
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

    this.logger.debug('preparing 3D form data', { payment_model: paymentModel, tx_type: txType })

    return this.requestDataMapper.create3DFormData(
      this.account,
      order,
      paymentModel,
      txType,
      this.get3DGatewayURL(paymentModel),
      this.cardForForm(card, createWithoutCard, paymentModel),
    ) as Promise<ThreeDFormData>
  }

  override async orderHistory(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedTransactionTypeError('InterPos does not support order history')
  }

  private async completeHostedPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    paymentModel: HostedModel,
  ): Promise<PosResponse> {
    const callback = gatewayResponseData as Record<string, unknown>

    this.assertFlatCallback(callback)
    const signed = this.verifyPresentHash(callback)
    const approvedByCallback = ownText(callback, 'ProcReturnCode') === SUCCESS_CODE
    if (signed && approvedByCallback) {
      this.assertSignedFields(callback)
    } else if (!signed) {
      this.refuseIfHashRequired(callback)
    }

    const response =
      paymentModel === MODEL.THREE_D_HOST
        ? this.responseDataMapper.map3DHostResponseData(callback, txType, order)
        : this.responseDataMapper.map3DPayResponseData(callback, txType, order)

    if (!signed) {
      if (approvedByCallback || response.status !== TX_DECLINED) {
        this.rejectUnsigned(callback)
      }

      return this.unsignedResult(response, order, txType, paymentModel)
    }

    if (!approvedByCallback) {
      if (response.status !== TX_DECLINED) {
        // The approval would skip the order binding and the bank's confirmation.
        this.logger.error('3D callback without approval was mapped as approved', {
          order_id: this.echo(response.order_id),
        })
        throw new PosError('3D callback without approval was mapped as approved')
      }

      return response
    }

    const orderId = existingOrderIdOf(order)
    this.assertCallbackMatchesOrder(callback, order, orderId, response)

    if (response.status !== TX_APPROVED) {
      return response
    }

    if (!this.isAuthenticated(callback)) {
      return this.declineUnauthenticatedApproval(response, order, orderId)
    }

    return this.confirmPayment(response, order, orderId)
  }

  /**
   * A 3D-successful callback with return code `00` is a 3D Pay result (the bank charged the card already) posted to
   * a 3D Secure order: the posted payment model is unsigned, so this is how a swapped form comes back. Nothing is
   * provisioned. The callback is already bound to this order; whether money moved is only known from the bank's
   * record, so the result (and with it `paymentMayHaveCompleted`) is attached only when one status request shows the
   * payment of this order.
   */
  private async rejectSwappedPaymentModel(
    callback: Record<string, unknown>,
    order: PosOrder,
    orderId: string,
    txType: TxType,
  ): Promise<never> {
    const { failure } = await this.bankRecordConfirms(order, orderId)
    const evidence =
      failure === null ? this.responseDataMapper.map3DPayResponseData(callback, txType, order) : undefined

    this.fail('payment_model', MODEL.THREE_D_SECURE, MODEL.THREE_D_PAY, orderId, evidence)
  }

  /**
   * The bank approved a payment whose 3D authentication failed: it is not accepted. Whether money moved is only
   * known from the bank's record, so the manual review flag needs that record (a re-read callback must not raise
   * alerts by itself). The result reports no approval code, and its authorization code and transaction id come from
   * that record (null when it does not confirm the payment), never from the callback.
   */
  private async declineUnauthenticatedApproval(
    response: PosResponse,
    order: PosOrder,
    orderId: string,
  ): Promise<PosResponse> {
    const declined: PosResponse = {
      ...response,
      status: TX_DECLINED,
      proc_return_code: null,
      auth_code: null,
      transaction_id: null,
    }
    const { record, failure } = await this.bankRecordConfirms(order, orderId)
    if (failure !== null) {
      this.logger.warn('payment approved without 3D success, the bank record does not confirm it', {
        order_id: this.echo(orderId),
        field: failure[0],
      })

      return declined
    }

    this.logger.error('payment approved without 3D success, manual review required', {
      order_id: this.echo(orderId),
    })

    return { ...declined, ...this.recordReferences(record), requires_manual_review: true }
  }

  /**
   * Every approved 3D Pay / 3D Host result is confirmed by the bank's own status record before it is returned; the
   * authorization code and transaction id come from that record.
   */
  private async confirmPayment(response: PosResponse, order: PosOrder, orderId: string): Promise<PosResponse> {
    const { record, failure } = await this.bankRecordConfirms(order, orderId)
    if (failure !== null) {
      const [field, expected, actual] = failure
      this.fail(field, expected, actual, orderId, { ...response, requires_manual_review: true })
    }

    this.logger.info('payment confirmed by the bank status record', { order_id: this.echo(orderId) })

    return { ...response, ...this.recordReferences(record) }
  }

  /** The authorization code and transaction id of a confirming bank record. */
  private recordReferences(record: PosResponse): { auth_code: string | null; transaction_id: string | null } {
    const fields = isRecord(record.all) ? record.all : {}

    return {
      auth_code: ownText(fields, 'AuthCode') ?? null,
      transaction_id: ownText(fields, 'TransId') || null,
    }
  }

  /**
   * One status request for the order, and the first way in which the bank's record does not show an approved, open
   * payment of this order id and amount (null when it does). The raw record (`all`) must be a plain record; anything
   * else fails closed.
   */
  private async bankRecordConfirms(
    order: PosOrder,
    orderId: string,
  ): Promise<{ record: PosResponse; failure: Mismatch | null }> {
    const record = await this.status({ id: orderId })
    const raw: unknown = record.all
    const fields = isRecord(raw) ? raw : {}

    if (record.status !== TX_APPROVED || !isRecord(raw) || ownText(fields, 'ProcReturnCode') !== SUCCESS_CODE) {
      return { record, failure: ['order_status', TX_APPROVED, asText(record.status)] }
    }

    // A transaction result other than the success word, also an empty one, is no approval.
    if (Object.hasOwn(fields, 'TxnResult') && fields.TxnResult !== TXN_RESULT_SUCCESS) {
      return { record, failure: ['order_status', TX_APPROVED, asText(fields.TxnResult) || 'no transaction result'] }
    }

    const recordOrderId = ownText(fields, 'OrderId') ?? ''
    if (recordOrderId !== orderId) {
      return { record, failure: ['order_id', orderId, recordOrderId] }
    }

    if (!AUTH_CODE.test(ownText(fields, 'AuthCode') ?? '')) {
      return { record, failure: ['order_status', TX_APPROVED, 'no authorization code'] }
    }

    const expectedAmount = orderAmount(order)
    const recordAmount = bankAmount(own(fields, 'PurchAmount'))
    if (expectedAmount === null || recordAmount !== expectedAmount) {
      return { record, failure: ['amount', expectedAmount ?? asText(order.amount), recordAmount ?? ''] }
    }

    const voidDate = own(fields, 'VoidDate')
    const refunded = own(fields, 'RefundedAmount')
    const open =
      (voidDate === undefined || voidDate === '' || voidDate === NO_VOID_DATE) &&
      (refunded === undefined || refunded === '' || (typeof refunded === 'string' && ZERO_AMOUNT.test(refunded)))
    if (!open) {
      return { record, failure: ['order_status', 'open', 'closed'] }
    }

    return { record, failure: null }
  }

  /**
   * The provision answer is the bank's own record of this order: an approval must carry return code `00`, this
   * order id and, when it states an amount, the order's amount.
   */
  private assertProvisionMatchesOrder(
    provision: Record<string, unknown>,
    order: PosOrder,
    orderId: string,
    response: PosResponse,
  ): void {
    const returnCode = ownText(provision, 'ProcReturnCode') ?? ''
    if (returnCode !== SUCCESS_CODE) {
      this.fail('order_status', SUCCESS_CODE, returnCode, orderId, response)
    }

    const provisionOrderId = ownText(provision, 'OrderId') ?? ''
    if (provisionOrderId !== orderId) {
      this.fail('order_id', orderId, provisionOrderId, orderId, response)
    }

    const amount = own(provision, 'Amount')
    if (amount !== undefined && amount !== '') {
      const expected = orderAmount(order)
      const actual = bankAmount(amount)
      if (expected === null || actual !== expected) {
        this.fail('amount', expected ?? asText(order.amount), actual ?? '', orderId, response)
      }
    }
  }

  /**
   * The callback's signed order id, amount and currency must be the order's and the unsigned shop code, when sent,
   * the account's. A 3D Secure callback is checked before the provision request (no response attached); a 3D Pay /
   * 3D Host callback after mapping, with the response attached.
   */
  private assertCallbackMatchesOrder(
    callback: Record<string, unknown>,
    order: PosOrder,
    orderId: string,
    response?: PosResponse,
  ): void {
    const callbackOrderId = ownText(callback, 'OrderId') ?? ''
    if (callbackOrderId !== orderId) {
      this.fail('order_id', orderId, callbackOrderId, orderId, response)
    }

    const expectedAmount = orderAmount(order)
    const callbackAmount = bankAmount(own(callback, 'PurchAmount'))
    if (expectedAmount === null || callbackAmount !== expectedAmount) {
      this.fail(
        'amount',
        expectedAmount ?? asText(order.amount),
        callbackAmount ?? asText(own(callback, 'PurchAmount')),
        orderId,
        response,
      )
    }

    const expectedCurrency = String(this.requestValueMapper.mapCurrency(order.currency ?? CURRENCY.TRY))
    const callbackCurrency = ownText(callback, 'Currency') ?? ''
    if (callbackCurrency !== expectedCurrency) {
      this.fail('currency', expectedCurrency, callbackCurrency, orderId, response)
    }

    const shopCode = ownText(callback, 'ShopCode') ?? ''
    if (shopCode !== '' && shopCode !== this.account.getMerchantId()) {
      this.fail('merchant_id', this.account.getMerchantId(), shopCode, orderId, response)
    }
  }

  /**
   * The unsigned authentication values travel into the provision request; they must be short base64 / digit strings
   * so that nothing else rides along, and the signed `MD` must be present.
   */
  private assertAuthenticationValues(callback: Record<string, unknown>): void {
    const malformed: string[] = []
    const md = ownText(callback, 'MD')
    if (md === undefined || md === '' || md.length > MAX_MD_LENGTH) malformed.push('MD')
    for (const key of ['PayerTxnId', 'PayerAuthenticationCode']) {
      const value = ownText(callback, key)
      if (value === undefined || !AUTHENTICATION_VALUE.test(value)) malformed.push(key)
    }
    const eci = ownText(callback, 'Eci')
    if (eci === undefined || !ECI.test(eci)) malformed.push('Eci')

    if (malformed.length > 0) {
      this.logger.error('3D callback authentication values are malformed', {
        order_id: this.echo(ownText(callback, 'OrderId')),
        fields: malformed,
      })
      throw new PosError('3D callback authentication values are malformed')
    }
  }

  /**
   * Runs after the hash verified, on a callback that reports success or an approval: every signed field that keeps a
   * boundary must be present in its format (`Version`, `Exponent`, the return code and `Response` may be empty).
   * Declines are not checked: a decline grants nothing, and the bank's decline texts and codes are free form.
   */
  private assertSignedFields(callback: Record<string, unknown>): void {
    const malformed: string[] = []
    const check = (key: string, format: RegExp | null, mandatory: boolean): void => {
      const value = own(callback, key)
      if (value === undefined || value === '') {
        if (mandatory) malformed.push(key)
        return
      }
      if (format === null || typeof value !== 'string' || !format.test(value)) malformed.push(key)
    }

    // Version and Exponent are always empty: a value there could take characters of the amount or the currency.
    check('Version', null, false)
    check('Exponent', null, false)
    check('PurchAmount', BANK_AMOUNT, true)
    check('Currency', CURRENCY_CODE, true)
    check('OkUrl', RETURN_URL, true)
    check('FailUrl', RETURN_URL, true)
    // Order ids are plain ASCII so that the signed bytes are unambiguous.
    check('OrderId', CALLBACK_ORDER_ID, true)
    check('ProcReturnCode', RETURN_CODE, false)
    check('Response', RESPONSE_TEXT, false)
    check('mdStatus', MD_STATUS, true)

    if (malformed.length > 0) {
      this.malformed(callback, malformed)
    }
  }

  private malformed(callback: Record<string, unknown>, fields: string[]): never {
    this.logger.error('3D callback fields are malformed', {
      order_id: this.echo(ownText(callback, 'OrderId')),
      fields,
    })
    throw new HashMismatchError('3D callback fields are malformed')
  }

  /** Verifies a present `HASH`; returns whether the callback was signed. */
  private verifyPresentHash(callback: Record<string, unknown>): boolean {
    const hash = own(callback, 'HASH')
    if (hash === undefined || hash === '') {
      return false
    }
    if (!this.crypt.check3DHash(this.account, callback as GatewayResponseData)) {
      throw new HashMismatchError('3D callback hash mismatch')
    }

    return true
  }

  private refuseIfHashRequired(callback: Record<string, unknown>): void {
    if (this.config.require_3d_hash === true) {
      this.rejectUnsigned(callback)
    }
  }

  private rejectUnsigned(callback: Record<string, unknown>): never {
    this.logger.error('3D callback has no HASH', { order_id: this.echo(ownText(callback, 'OrderId')) })
    throw new HashMismatchError('3D callback has no HASH')
  }

  /**
   * Whether the 3D authentication succeeded: the response mapper's reading of `3DStatus` must count as a success,
   * and the signed `mdStatus` must be exactly the same text, so the decision rests on a signed value.
   */
  private isAuthenticated(callback: Record<string, unknown>): boolean {
    const mdStatus = this.responseDataMapper.extractMdStatus(callback)
    const signedStatus = ownText(callback, 'mdStatus')
    const authenticated =
      this.responseDataMapper.is3dAuthSuccess(mdStatus) &&
      signedStatus !== undefined &&
      signedStatus === ownText(callback, '3DStatus')
    if (authenticated) {
      this.logger.info('3d auth success', { md_status: this.echo(signedStatus) })
    } else {
      this.logger.error('3d auth fail', { md_status: this.echo(signedStatus) })
    }

    return authenticated
  }

  /**
   * The result of an unsigned declined callback, built from trusted data only: every value the callback could have
   * chosen is dropped (null) and replaced by the order's id and the call's transaction type and payment model. Its
   * decline reasons grant nothing and a merchant needs them for a genuine decline, so they stay as informational
   * plain text of bounded length (anything but a string becomes null). The raw data (`all`, `3d_all`) is kept as is.
   */
  private unsignedResult(
    response: PosResponse,
    order: PosOrder,
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
      result[key] = typeof reason === 'string' ? reason.slice(0, MAX_DECLINE_REASON_LENGTH) : null
    }

    return {
      ...result,
      status: TX_DECLINED,
      order_id: asText(order.id),
      transaction_type: txType,
      payment_model: paymentModel,
    }
  }

  /**
   * A bank callback is a flat form of strings. A nested value could be read differently by the signature check, the
   * response mapper and the request mapper, so it is refused before anything else.
   */
  private assertFlatCallback(callback: Record<string, unknown>): void {
    // own property names include non-enumerable ones, which a spread or `Object.entries` would skip
    for (const key of Object.getOwnPropertyNames(callback)) {
      const value: unknown = callback[key]
      if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
        const field = key.slice(0, MAX_ECHOED_LENGTH)
        this.logger.error('3D callback field is not a string', { field, type: typeof value })
        throw new PosError(`3D callback field "${field}" must be a string`)
      }
    }
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
