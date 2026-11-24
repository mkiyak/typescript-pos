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
 *   rejected when `require_3d_hash` is set. Otherwise an unsigned declined callback is mapped as declined, an
 *   unsigned successful callback is rejected for QNB Finansbank (which signs every callback), and for other
 *   institutions (Ziraat Katilim) it is accepted as unsigned data that can never approve a payment by itself: the
 *   bank's own status record decides (see below).
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
 *   `declined` with `requires_manual_review: true`, without further requests.
 * - Every approved result is confirmed with one status request before it is returned: the bank must report the order
 *   as approved, for this order id, transaction type, amount, currency and installment count (a single payment is 0
 *   or 1 alike), and not cancelled or refunded. The authorization code and transaction time of the returned result
 *   are taken from that record. Otherwise `OrderMismatchError` with the result attached (`paymentMayHaveCompleted`).
 *   Errors of the status request (such as `PosHttpError`) propagate unchanged; the payment may have completed, so
 *   check it later with `status`. Declined results are never confirmed.
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

    return this.confirmPayment(response, order, txType)
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
    this.checkCallbackHash(callback, approvedByCallback, paymentModel)

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

    this.assertCallbackMatchesOrder(callback, order, txType, paymentModel, response)

    if (response.status !== TX_APPROVED) {
      return response
    }

    if (ownText(callback, '3DStatus') !== THREE_D_SUCCESS) {
      // The bank approved a payment whose 3D authentication failed: money may have moved, but it is not accepted.
      this.logger.error('payment approved without 3D success, manual review required', {
        order_id: this.echo(order.id),
        md_status: this.echo(ownText(callback, '3DStatus')),
      })

      return { ...response, status: TX_DECLINED, requires_manual_review: true }
    }

    return this.confirmPayment(response, order, txType)
  }

  /**
   * The amount, currency, transaction type and installment count of a callback are unsigned, and an unsigned
   * callback proves nothing, so the bank's own status record decides: it must report an approved payment of this
   * order, type, amount, currency and installment plan that was not cancelled or refunded.
   */
  private async confirmPayment(response: PosResponse, order: PosOrder, txType: TxType): Promise<PosResponse> {
    const orderId = asText(order.id)
    const record = await this.status({ id: orderId })

    if (record.status !== TX_APPROVED) {
      this.fail('order_status', TX_APPROVED, asText(record.status), orderId, response)
    }

    const recordOrderId = asText(record.order_id)
    if (orderId === '' || recordOrderId !== orderId) {
      this.fail('order_id', orderId, recordOrderId, orderId, response)
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

    if (CLOSED_ORDER_STATUSES.includes(record.order_status)) {
      this.fail('order_status', 'open', asText(record.order_status), orderId, response)
    }

    this.logger.info('payment confirmed by the bank status record', { order_id: this.echo(orderId) })

    // The callback's authorization code is signed only as part of an unseparated text; the bank record is plain.
    const confirmed: PosResponse = { ...response }
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
   * place), and decides what a callback without one may do.
   */
  private checkCallbackHash(callback: GatewayResponseData, successful: boolean, paymentModel: PaymentModel): void {
    const hash = own(callback, 'ResponseHash')
    if (hash !== undefined && hash !== '') {
      if (!this.crypt.check3DHash(this.account, callback)) {
        throw new HashMismatchError('3D callback hash mismatch')
      }
      if (successful) {
        this.assertSignedFields(callback, paymentModel)
      }

      return
    }

    // QNB Finansbank signs every callback; other institutions' successful callbacks are confirmed with the bank.
    const signsEveryCallback = this.account.getMbrId() === PayForPosAccount.MBR_ID_FINANSBANK
    if (this.config.require_3d_hash === true || (successful && signsEveryCallback)) {
      this.logger.error('3D callback has no ResponseHash', { order_id: this.echo(ownText(callback, 'OrderId')) })
      throw new HashMismatchError('3D callback has no ResponseHash')
    }
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
