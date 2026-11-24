import { TX_APPROVED, TX_DECLINED } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
import {
  HashMismatchError,
  OrderMismatchError,
  type OrderMismatchField,
  PosError,
  UnsupportedFormFormatError,
} from '../errors.js'
import { PayForPosAccount } from '../model/account/PayForPosAccount.js'
import type { CreditCard } from '../model/card/CreditCard.js'
import {
  CURRENCY,
  FORM_FORMAT,
  type FormFormat,
  MODEL,
  PAYMENT_STATUS,
  type PaymentModel,
  TX_TYPE,
  type TxType,
} from '../PosInterface.js'
import type { GatewayResponseData, PosOrder, PosResponse, ThreeDFormData } from '../types.js'
import { numberFormat2 } from '../util/numberFormat2.js'
import { parseOrderAmount } from '../util/parseOrderAmount.js'
import { AbstractGateway, type SupportedTransactions } from './AbstractGateway.js'

/** The return code of an approved payment. */
const SUCCESS_CODE = '00'

/** The 3D status of a successful authentication. */
const THREE_D_SUCCESS = '1'

/**
 * Strict formats of the signed callback fields. The signed values are concatenated without separator, so a valid hash
 * alone does not fix where one field ends and the next begins; these formats do.
 */
const RESPONSE_RND = /^PF\d{1,32}$/
const SECURE_RETURN_CODE = /^[A-Z]\d{3}$/
const AUTH_CODE = /^[A-Za-z0-9]{6}$/
const THREE_D_STATUS = /^-?\d$/

/** The bank's 3D session id, sent back in the provision request. */
const REQUEST_GUID = /^\d{1,32}$/

/** Order states of a payment that no longer stands. */
const CLOSED_ORDER_STATUSES: readonly unknown[] = [PAYMENT_STATUS.CANCELED, PAYMENT_STATUS.FULLY_REFUNDED]

/** Status record fields that report a cancellation or a refund; on an open payment they are empty or zero. */
const VOID_OR_REFUND_FIELDS = ['VoidDate', 'VoidTime', 'RefundedAmount'] as const

/** Status record flags of a cancellation or a full refund; on an open payment they read `false`. */
const VOID_OR_REFUND_FLAGS = ['IsVoided', 'IsRefunded'] as const

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

/** An own callback value; `null` counts as absent like a missing key. */
function own(callback: GatewayResponseData, key: string): unknown {
  const value: unknown = Object.hasOwn(callback, key) ? callback[key] : undefined
  return value === null ? undefined : value
}

/** An own callback value when it is a string, otherwise undefined (callbacks are read only as strings). */
function ownText(callback: GatewayResponseData, key: string): string | undefined {
  const value = own(callback, key)
  return typeof value === 'string' ? value : undefined
}

/** A scalar value as text; anything else (missing, object, list) as an empty string. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'bigint') return String(value)

  return ''
}

/** An amount as the bank and the order compare it (two decimals), or null when it is not a usable amount. */
function comparableAmount(value: unknown): string | null {
  const amount = parseOrderAmount(value)
  if (Number.isNaN(amount)) return null
  try {
    return numberFormat2(amount)
  } catch (e) {
    if (e instanceof PosError) return null
    throw e
  }
}

/** A bank or order installment count as a number: a single payment (nothing, 0 or 1) is 0. */
function installmentCount(value: unknown): number {
  const count = Number(asText(value))

  return Number.isInteger(count) && count > 1 ? count : 0
}

/** A value of the bank's record that reports nothing: missing, empty or zero. */
function isEmptyOrZero(value: unknown): boolean {
  return (
    value === undefined || value === null || value === 0 || (typeof value === 'string' && /^0+(?:\.0+)?$/.test(value))
  )
}

/**
 * Whether the bank's status record shows a cancellation or a refund, also in a shape the response mapper cannot read
 * (a repeated or nested element, an element with attributes, an unexpected flag value): anything but a plain "nothing
 * happened" counts as closed.
 */
function recordIsClosed(record: PosResponse): boolean {
  if (record.cancel_time !== null && record.cancel_time !== undefined) return true
  if (record.refund_amount !== null && record.refund_amount !== undefined) return true

  const raw: unknown = record.all
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false
  const fields = raw as Record<string, unknown>
  for (const key of VOID_OR_REFUND_FLAGS) {
    if (!Object.hasOwn(fields, key)) continue
    const flag = fields[key]
    if (typeof flag !== 'string' || flag.toLowerCase() !== 'false') return true
  }
  for (const key of VOID_OR_REFUND_FIELDS) {
    if (Object.hasOwn(fields, key) && !isEmptyOrZero(fields[key])) return true
  }

  return false
}

type HostedModel = typeof MODEL.THREE_D_PAY | typeof MODEL.THREE_D_HOST

/**
 * PayFor virtual POS (QNB Finansbank, Ziraat Katilim): XML API, 3D Secure (3D model with a server-side provision),
 * 3D Pay and 3D Host.
 *
 * The bank signs its 3D callback with `ResponseHash`, a SHA-1 or SHA-256 digest (told apart by its length) over the
 * merchant number, the 3D secret, `OrderId`, `AuthCode`, `ProcReturnCode`, `3DStatus`, `ResponseRnd` and the user
 * code. Everything else in the callback (amount, currency, transaction type, installment count, payment model,
 * institution and merchant codes, the request guid) is unsigned, and the 3D form hash does not cover the currency or
 * the payment model either, so a browser can change them. The checks below follow from that:
 * - A callback is a flat record of strings: an object, array or function anywhere at its top level is a `PosError`
 *   before any other check.
 * - The hash check cannot be switched off (`disable_3d_hash_check` is ignored). A callback that carries a
 *   `ResponseHash` is always verified, whatever it reports, otherwise `HashMismatchError`. A callback without one is
 *   rejected (`HashMismatchError`, nothing sent) when `require_3d_hash` is set, when it reports success for QNB
 *   Finansbank (which signs every callback), and for 3D Secure at other institutions (Ziraat Katilim), whose
 *   provision request would otherwise carry a request guid nobody signed. Otherwise an unsigned declined callback is
 *   mapped as declined, and an unsigned 3D Pay / 3D Host callback of another institution is unsigned data that can
 *   never approve a payment or raise a manual review by itself: only the bank's own status record of the order can
 *   (see below). The result of an unsigned callback, returned or attached to an error, carries none of its values:
 *   the order id is the order's, and the authorization code, time, host reference, masked card number, amount,
 *   currency and installment count come from the bank's status record when it was read (otherwise null); codes,
 *   messages, batch number, ECI and transaction id are null. Only `all` keeps the raw (untrusted) callback. The
 *   exception is a decline decided without the bank's record: its decline reasons (return and error codes, error
 *   message, 3D status and 3D error message) come from the callback itself as plain text of at most 256 characters
 *   and are informational only.
 * - The signed values have no separators, so after the hash verifies the fields that keep the boundaries fixed must be
 *   well formed, otherwise `HashMismatchError('3D callback fields are malformed')`: `ResponseRnd` is `PF` and digits;
 *   a successful 3D Secure authentication (`3DStatus` 1) carries no authorization code and a return code of one
 *   letter and three digits; an approved 3D Pay / 3D Host callback (`ProcReturnCode` 00) carries a six-character
 *   authorization code and a one-digit 3D status (optionally negative).
 * - 3D success is decided on the response mapper's reading of `3DStatus` together with the callback's own value
 *   (exactly `1`); a callback taken down the declined path must map as declined, and an approved 3D Pay / 3D Host
 *   mapping requires the callback's own `ProcReturnCode` 00, otherwise `PosError`.
 * - A callback must belong to the order (`OrderMismatchError`): `OrderId` equals `order.id`, and the merchant number,
 *   institution code, amount, currency, transaction type, installment count and payment model, when echoed, equal the
 *   account's and the order's. For 3D Secure this runs before the provision request (nothing attached); for 3D Pay
 *   and 3D Host it runs on the mapped result, which is attached because the bank may already have charged the card.
 *   These echoes are unsigned, so they stop honest mismatches and naive replays only.
 * - 3D Secure: the provision request takes the order id from the order and only the bank's request guid (digits)
 *   from the callback.
 * - A 3D Pay / 3D Host payment the bank approved although the 3D authentication did not succeed is returned as
 *   `declined` with `requires_manual_review: true`: for a signed callback without further requests, for an unsigned
 *   one only when one status request shows an approved payment of the order (otherwise plain `declined`). Likewise an
 *   unsigned callback that does not match the order carries the mapped result (and `paymentMayHaveCompleted`) only
 *   when the bank holds an approved payment of the order.
 * - Every approved result is confirmed with one status request before it is returned: the bank must report the order
 *   as approved, for this order id, transaction type, amount, currency and installment count (a single payment is 0
 *   or 1 alike), and not cancelled or refunded. A cancellation or refund date, time, amount or flag in any shape the
 *   mapper cannot read as "none" (a repeated or nested element, attributes, a flag other than `false`) counts as
 *   cancelled. The authorization code, transaction time, host reference and masked card number of the returned
 *   result are taken from that record (the last two are null when it has none, never the callback's values).
 *   Otherwise `OrderMismatchError` with the result attached (`paymentMayHaveCompleted`); for an unsigned callback
 *   whose record shows no approved payment of the order, without it. Errors of the status request (such as
 *   `PosHttpError`) propagate unchanged; the payment may have completed, so check it later with `status`. Declined
 *   results are never confirmed.
 *
 * `formFormat: 'html'` posts the 3D form, card data included, from the merchant server to the bank and returns the
 * bank's HTML page as it came. That page is untrusted bank markup: embed it deliberately (for example on a page of
 * its own or in a sandboxed frame), or prefer the default array form, which the browser posts itself.
 */
export class PayForPos extends AbstractGateway<PayForPosAccount> {
  static readonly NAME = 'PayForPOS'

  static override readonly GATEWAY_CLASS: string = 'PayForPos'

  protected static override readonly testModeAffectsRequests: boolean = false

  protected static override supportedTransactions: SupportedTransactions = {
    [TX_TYPE.PAY_AUTH]: [MODEL.THREE_D_SECURE, MODEL.THREE_D_PAY, MODEL.THREE_D_HOST, MODEL.NON_SECURE],
    [TX_TYPE.PAY_PRE_AUTH]: [MODEL.THREE_D_SECURE, MODEL.THREE_D_PAY, MODEL.THREE_D_HOST, MODEL.NON_SECURE],
    [TX_TYPE.PAY_POST_AUTH]: true,
    [TX_TYPE.STATUS]: true,
    [TX_TYPE.CANCEL]: true,
    [TX_TYPE.REFUND]: true,
    [TX_TYPE.REFUND_PARTIAL]: true,
    [TX_TYPE.ORDER_HISTORY]: true,
  }

  /**
   * @throws PosError when a callback value is not a plain string or the request guid is malformed
   * @throws HashMismatchError when a present hash does not verify, a required hash is missing, or the signed fields
   *   are malformed
   * @throws OrderMismatchError when the callback does not belong to the order or account (nothing is sent), or when
   *   the bank's status record does not confirm an approved provision (the result is attached)
   */
  async make3DPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    _card: CreditCard | null = null,
  ): Promise<PosResponse> {
    const paymentModel = MODEL.THREE_D_SECURE

    this.assertFlatCallback(gatewayResponseData)

    const mdStatus = this.responseDataMapper.extractMdStatus(gatewayResponseData)
    const authenticated =
      this.responseDataMapper.is3dAuthSuccess(mdStatus) && ownText(gatewayResponseData, '3DStatus') === THREE_D_SUCCESS
    if (authenticated) {
      this.logger.info('3d auth success', { md_status: THREE_D_SUCCESS })
    } else {
      this.logger.error('3d auth fail', { md_status: this.echo(ownText(gatewayResponseData, '3DStatus')) })
    }

    this.checkCallbackHash(gatewayResponseData, authenticated, paymentModel)

    if (!authenticated) {
      const declined = this.responseDataMapper.map3DPaymentData(gatewayResponseData, null, txType, order)
      if (declined.status !== TX_DECLINED) {
        // Never report a payment that skipped the order binding, the provision and the bank's confirmation.
        this.logger.error('3D callback without 3D success was not mapped as declined', {
          order_id: this.echo(declined.order_id),
          status: this.echo(declined.status),
        })
        throw new PosError('3D callback without 3D success was not mapped as declined')
      }

      return declined
    }

    this.assertCallbackMatchesOrder(gatewayResponseData, order, txType, paymentModel)

    const requestGuid = ownText(gatewayResponseData, 'RequestGuid')
    if (requestGuid === undefined || !REQUEST_GUID.test(requestGuid)) {
      this.logger.error('3D callback RequestGuid is missing or malformed', {
        order_id: this.echo(ownText(gatewayResponseData, 'OrderId')),
      })
      throw new PosError('3D callback RequestGuid is missing or malformed')
    }

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.create3DPaymentRequestData(this.account, order, txType, gatewayResponseData),
      txType,
      order,
      paymentModel,
    )
    const provisionResponse = await this.sendRequest(txType, paymentModel, requestData, order)

    const response = this.responseDataMapper.map3DPaymentData(gatewayResponseData, provisionResponse, txType, order)
    this.logger.debug('finished 3D payment', { mapped_response: response })

    if (response.status !== TX_APPROVED) {
      return response
    }

    // Only a signed callback reaches the provision.
    return this.confirmPayment(response, order, txType, paymentModel, true)
  }

  /**
   * @throws PosError when a callback value is not a plain string
   * @throws HashMismatchError when a present hash does not verify, a required hash is missing, or the signed fields
   *   are malformed
   * @throws OrderMismatchError when the callback does not belong to the order or account, or when the bank's status
   *   record does not confirm an approved payment (the mapped response is attached, for an unsigned callback only
   *   when the bank holds an approved payment of the order)
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
   * The form data for the browser to post, or with `formFormat: 'html'` the bank's 3D page (untrusted markup, see the
   * class description).
   *
   * @throws UnsupportedFormFormatError for 3D Host with `formFormat: 'html'`
   * @throws PosError when the bank answers the html form request with an empty page
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

    if (formFormat === FORM_FORMAT.HTML && paymentModel === MODEL.THREE_D_HOST) {
      throw new UnsupportedFormFormatError('Unsupported 3D form format!')
    }

    this.logger.debug('preparing 3D form data', { payment_model: paymentModel, tx_type: txType })

    if (formFormat === FORM_FORMAT.HTML) {
      return this.initialize3DForm(order, paymentModel, txType, card)
    }

    return this.requestDataMapper.create3DFormData(
      this.account,
      order,
      paymentModel,
      txType,
      this.get3DGatewayURL(paymentModel),
      card,
    ) as Promise<ThreeDFormData>
  }

  /** Posts the signed 3D form from the server and returns the bank's page. */
  private async initialize3DForm(
    order: PosOrder,
    paymentModel: PaymentModel,
    orderTxType: TxType,
    card: CreditCard | null,
  ): Promise<string> {
    const requestTxType = TX_TYPE.INTERNAL_3D_FORM_BUILD
    const requestData = await this.dispatchRequestDataPrepared(
      await this.requestDataMapper.create3DFormInitializeRequestData(
        this.account,
        order,
        paymentModel,
        orderTxType,
        card,
      ),
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

  private async completeHostedPayment(
    callback: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    paymentModel: HostedModel,
  ): Promise<PosResponse> {
    this.assertFlatCallback(callback)

    const approvedByCallback = ownText(callback, 'ProcReturnCode') === SUCCESS_CODE
    const signed = this.checkCallbackHash(callback, approvedByCallback, paymentModel)

    const response =
      paymentModel === MODEL.THREE_D_HOST
        ? this.responseDataMapper.map3DHostResponseData(callback, txType, order)
        : this.responseDataMapper.map3DPayResponseData(callback, txType, order)

    if (response.status === TX_APPROVED && !approvedByCallback) {
      // The approval would skip the checks of an approved callback.
      this.logger.error('3D callback without approval was mapped as approved', {
        order_id: this.echo(response.order_id),
      })
      throw new PosError('3D callback without approval was mapped as approved')
    }

    if (signed) {
      this.assertCallbackMatchesOrder(callback, order, txType, paymentModel, response)
    } else {
      await this.assertUnsignedCallbackMatchesOrder(callback, order, txType, paymentModel, response)
    }

    if (response.status !== TX_APPROVED) {
      return signed ? response : this.unsignedResult(response, order, txType, paymentModel, null, true)
    }

    if (ownText(callback, '3DStatus') !== THREE_D_SUCCESS) {
      // The bank approved a payment whose 3D authentication failed: it is not accepted. A signed callback shows that
      // money may have moved; an unsigned one shows nothing, so only the bank's own record of the order can.
      let declined: PosResponse = { ...response, status: TX_DECLINED }
      if (!signed) {
        const record = await this.bankRecord(order)
        declined = this.unsignedResult(declined, order, txType, paymentModel, record)
        if (!this.holdsPayment(record, order)) {
          this.logger.error('unsigned callback approved without 3D success, the bank holds no payment', {
            order_id: this.echo(order.id),
          })

          return this.unsignedResult(declined, order, txType, paymentModel, null)
        }
      }
      this.logger.error('payment approved without 3D success, manual review required', {
        order_id: this.echo(order.id),
        md_status: this.echo(ownText(callback, '3DStatus')),
      })

      return { ...declined, requires_manual_review: true }
    }

    return this.confirmPayment(response, order, txType, paymentModel, signed)
  }

  /**
   * The result of an unsigned callback, built from trusted data only: every value the callback could have chosen is
   * dropped (null) and replaced by the order's id, the requested transaction type and payment model and, when the
   * bank's status record of the order was read, the record's authorization code, time, host reference, masked card
   * number, amount, currency and installment count. Only the decided `status`, `requires_manual_review` and the raw
   * data (`all`, untrusted) are kept. A declined result that no bank record was read for may keep the callback's
   * decline reasons (`keepDeclineReasons`): they grant nothing, and a merchant needs them for a genuine decline, so
   * they stay as informational plain text of bounded length (anything but a string becomes null).
   */
  private unsignedResult(
    response: PosResponse,
    order: PosOrder,
    txType: TxType,
    paymentModel: PaymentModel,
    record: PosResponse | null,
    keepDeclineReasons = false,
  ): PosResponse {
    const result: PosResponse = { ...response }
    for (const key of Object.keys(result)) {
      if (key !== 'status' && key !== 'requires_manual_review' && key !== 'all') result[key] = null
    }
    if (keepDeclineReasons && record === null && response.status === TX_DECLINED) {
      for (const key of DECLINE_REASON_FIELDS) {
        if (!Object.hasOwn(response, key)) continue
        const reason: unknown = response[key]
        result[key] = typeof reason === 'string' ? reason.slice(0, MAX_DECLINE_REASON_LENGTH) : null
      }
    }
    const fromRecord = (key: string): unknown => (record === null ? null : (record[key] ?? null))

    return {
      ...result,
      order_id: asText(order.id),
      transaction_type: txType,
      payment_model: paymentModel,
      auth_code: fromRecord('auth_code'),
      transaction_time: fromRecord('transaction_time'),
      ref_ret_num: fromRecord('ref_ret_num'),
      masked_number: fromRecord('masked_number'),
      amount: fromRecord('first_amount'),
      currency: fromRecord('currency'),
      installment_count: fromRecord('installment_count'),
    }
  }

  /**
   * The order binding of an unsigned callback. An unsigned callback is not evidence that the card was charged, so a
   * mismatch carries the mapped result (and with it `paymentMayHaveCompleted` / `requires_manual_review`) only when
   * the bank itself holds an approved payment for the order.
   */
  private async assertUnsignedCallbackMatchesOrder(
    callback: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    paymentModel: HostedModel,
    response: PosResponse,
  ): Promise<void> {
    try {
      this.assertCallbackMatchesOrder(callback, order, txType, paymentModel)
    } catch (e) {
      if (!(e instanceof OrderMismatchError)) throw e
      // The mapped status decides whether the attached result would report that money may have moved.
      const wouldFlag = new OrderMismatchError(e.field, e.expected, e.actual, response).paymentMayHaveCompleted
      if (!wouldFlag) {
        throw new OrderMismatchError(
          e.field,
          e.expected,
          e.actual,
          this.unsignedResult(response, order, txType, paymentModel, null, true),
        )
      }
      const record = await this.bankRecord(order)
      if (this.holdsPayment(record, order)) {
        throw new OrderMismatchError(
          e.field,
          e.expected,
          e.actual,
          this.unsignedResult(response, order, txType, paymentModel, record),
        )
      }
      throw e
    }
  }

  /** The bank's status record of the order (one status request). */
  private async bankRecord(order: PosOrder): Promise<PosResponse> {
    return this.status({ id: asText(order.id) })
  }

  /** Whether a status record shows an approved payment of this order id. */
  private holdsPayment(record: PosResponse, order: PosOrder): boolean {
    const orderId = asText(order.id)

    return orderId !== '' && record.status === TX_APPROVED && asText(record.order_id) === orderId
  }

  /**
   * The amount, currency, transaction type and installment count of a callback are unsigned, and an unsigned
   * callback proves nothing, so the bank's own status record decides: it must report an approved payment of this
   * order, type, amount, currency and installment plan that was not cancelled or refunded. When the callback was
   * unsigned and the bank holds no approved payment of the order, nothing shows that money moved: the mismatch is
   * raised without the result attached.
   */
  private async confirmPayment(
    mapped: PosResponse,
    order: PosOrder,
    txType: TxType,
    paymentModel: PaymentModel,
    signed: boolean,
  ): Promise<PosResponse> {
    const orderId = asText(order.id)
    const record = await this.bankRecord(order)
    const response = signed ? mapped : this.unsignedResult(mapped, order, txType, paymentModel, record)
    const evidence = signed ? response : undefined

    if (record.status !== TX_APPROVED) {
      this.fail('order_status', TX_APPROVED, asText(record.status), orderId, evidence)
    }

    const recordOrderId = asText(record.order_id)
    if (orderId === '' || recordOrderId !== orderId) {
      this.fail('order_id', orderId, recordOrderId, orderId, evidence)
    }

    const recordTxType = asText(record.transaction_type)
    if (recordTxType !== txType) {
      this.fail('transaction_type', txType, recordTxType, orderId, response)
    }

    const expectedAmount = comparableAmount(order.amount)
    const recordAmount = comparableAmount(record.first_amount)
    if (expectedAmount === null || recordAmount !== expectedAmount) {
      this.fail('amount', expectedAmount ?? asText(order.amount), recordAmount ?? '', orderId, response)
    }

    const expectedCurrency = order.currency ?? CURRENCY.TRY
    const recordCurrency = asText(record.currency)
    if (recordCurrency !== expectedCurrency) {
      this.fail('currency', expectedCurrency, recordCurrency, orderId, response)
    }

    const orderedInstallments = installmentCount(order.installment)
    const recordInstallments = installmentCount(record.installment_count)
    if (recordInstallments !== orderedInstallments) {
      this.fail('installment', String(orderedInstallments), String(recordInstallments), orderId, response)
    }

    if (CLOSED_ORDER_STATUSES.includes(record.order_status) || recordIsClosed(record)) {
      this.fail('order_status', 'open', asText(record.order_status) || 'closed', orderId, response)
    }

    this.logger.info('payment confirmed by the bank status record', { order_id: this.echo(orderId) })

    // The callback's authorization code is signed only as part of an unseparated text; the bank record is plain.
    // The host reference and the card mask are not signed at all, so they come from the record or not at all.
    const confirmed: PosResponse = {
      ...response,
      ref_ret_num: record.ref_ret_num ?? null,
      masked_number: record.masked_number ?? null,
    }
    if (record.auth_code !== null && record.auth_code !== undefined) {
      confirmed.auth_code = record.auth_code
    }
    if (record.transaction_time !== null && record.transaction_time !== undefined) {
      confirmed.transaction_time = record.transaction_time
    }

    return confirmed
  }

  /**
   * Verifies a present `ResponseHash` (and, on a success path, the field formats that keep the signed values in
   * place), and decides what a callback without one may do. Returns whether the callback was signed.
   */
  private checkCallbackHash(callback: GatewayResponseData, successful: boolean, paymentModel: PaymentModel): boolean {
    const hash = own(callback, 'ResponseHash')
    if (hash !== undefined && hash !== '') {
      if (!this.crypt.check3DHash(this.account, callback)) {
        throw new HashMismatchError('3D callback hash mismatch')
      }
      if (successful) {
        this.assertSignedFields(callback, paymentModel)
      }

      return true
    }

    // QNB Finansbank signs every callback, so an unsigned successful one is forged. Other institutions' unsigned
    // 3D Pay / 3D Host callbacks are left to the bank's status record; an unsigned 3D Secure callback is never
    // accepted, because its provision request would carry a request guid that nobody signed.
    const signsEveryCallback = this.account.getMbrId() === PayForPosAccount.MBR_ID_FINANSBANK
    const refused =
      this.config.require_3d_hash === true ||
      (successful && signsEveryCallback) ||
      (paymentModel === MODEL.THREE_D_SECURE && !signsEveryCallback)
    if (refused) {
      this.logger.error('3D callback has no ResponseHash', { order_id: this.echo(ownText(callback, 'OrderId')) })
      throw new HashMismatchError('3D callback has no ResponseHash')
    }

    return false
  }

  /**
   * Runs after the hash verified, on success paths. `ResponseRnd` starts with letters and ends the signed text, and
   * the 3D status sits just before it, so neither can move; on a 3D Secure success an empty authorization code and a
   * return code of one letter and three digits cannot take characters of the order id, and on an approved 3D Pay /
   * 3D Host callback a six-character authorization code and the return code `00` fix the end of the order id.
   */
  private assertSignedFields(callback: GatewayResponseData, paymentModel: PaymentModel): void {
    const value = (key: string): string => ownText(callback, key) ?? ''
    const malformed: string[] = []
    const check = (key: string, ok: boolean): void => {
      if (!ok) malformed.push(key)
    }

    check('ResponseRnd', RESPONSE_RND.test(value('ResponseRnd')))
    if (paymentModel === MODEL.THREE_D_SECURE) {
      check('AuthCode', value('AuthCode') === '')
      check('ProcReturnCode', SECURE_RETURN_CODE.test(value('ProcReturnCode')))
    } else {
      check('AuthCode', AUTH_CODE.test(value('AuthCode')))
      check('3DStatus', THREE_D_STATUS.test(value('3DStatus')))
    }

    if (malformed.length > 0) {
      this.logger.error('3D callback fields are malformed', {
        order_id: this.echo(ownText(callback, 'OrderId')),
        fields: malformed,
      })
      throw new HashMismatchError('3D callback fields are malformed')
    }
  }

  /**
   * The callback's order id must be the order's, and every value the callback echoes must match the account and the
   * order. A 3D Secure callback is checked before the provision request (no response attached); a 3D Pay / 3D Host
   * callback after mapping, with the response attached.
   */
  private assertCallbackMatchesOrder(
    callback: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    paymentModel: PaymentModel,
    response?: PosResponse,
  ): void {
    const orderId = asText(order.id)
    const callbackOrderId = ownText(callback, 'OrderId') ?? ''
    if (orderId === '' || callbackOrderId !== orderId) {
      this.fail('order_id', orderId, callbackOrderId, orderId, response)
    }

    const echoed = (key: string): string | null => {
      const value = ownText(callback, key)
      return value === undefined || value === '' ? null : value
    }
    const expectEcho = (key: string, field: OrderMismatchField, expected: string, matches: boolean): void => {
      if (!matches) {
        this.fail(field, expected, echoed(key) ?? '', orderId, response)
      }
    }

    const merchantId = echoed('MerchantID')
    if (merchantId !== null) {
      expectEcho('MerchantID', 'merchant_id', this.account.getMerchantId(), merchantId === this.account.getMerchantId())
    }

    const mbrId = echoed('MbrId')
    if (mbrId !== null) {
      expectEcho('MbrId', 'merchant_id', this.account.getMbrId(), mbrId === this.account.getMbrId())
    }

    const amount = echoed('PurchAmount')
    if (amount !== null) {
      const expected = comparableAmount(order.amount)
      expectEcho(
        'PurchAmount',
        'amount',
        expected ?? asText(order.amount),
        expected !== null && comparableAmount(amount) === expected,
      )
    }

    const currency = echoed('Currency')
    if (currency !== null) {
      const expected = String(this.requestValueMapper.mapCurrency(order.currency ?? CURRENCY.TRY))
      expectEcho('Currency', 'currency', expected, currency === expected)
    }

    const bankTxType = echoed('TxnType')
    if (bankTxType !== null) {
      const expected = this.requestValueMapper.mapTxType(txType)
      expectEcho('TxnType', 'transaction_type', expected, bankTxType === expected)
    }

    const installments = echoed('InstallmentCount')
    if (installments !== null) {
      const expected = installmentCount(order.installment)
      expectEcho('InstallmentCount', 'installment', String(expected), installmentCount(installments) === expected)
    }

    const secureType = echoed('SecureType')
    if (secureType !== null) {
      const expected = this.requestValueMapper.mapSecureType(paymentModel)
      expectEcho('SecureType', 'payment_model', expected, secureType === expected)
    }
  }

  /**
   * A bank callback is a flat form of strings. A nested value could be read differently by the signature check, the
   * response mapper and the request mapper, so it is refused before anything else.
   */
  private assertFlatCallback(callback: GatewayResponseData): void {
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
