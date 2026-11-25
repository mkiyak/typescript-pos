import { TX_APPROVED, TX_DECLINED } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
import {
  HashMismatchError,
  OrderMismatchError,
  type OrderMismatchField,
  PosError,
  UnsupportedFormFormatError,
  UnsupportedTransactionTypeError,
} from '../errors.js'
import type { AkbankPosAccount } from '../model/account/AkbankPosAccount.js'
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

/** The response code of a successful 3D authentication, and of an approved payment. */
const SUCCESS_CODE = 'VPS-0000'

/** Strict formats of the signed callback fields; a valid hash over anything else means the fields were regrouped. */
const RESPONSE_CODE = /^VPS-\d{4}$/
const TXN_CODE = /^\d{4}$/
const HOST_RESPONSE_CODE = /^\d{2}$/
const TXN_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/
const SECURE_ECOM_IND = /^\d{2}$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const HEX = /^[0-9A-Fa-f]+$/
const AUTH_CODE = /^[0-9A-Za-z]{6}$/
const RRN = /^\d{12}$/

/** Fields a successful 3D Secure callback must sign: the provision request relies on each of them. */
const SECURE_SUCCESS_SIGNED_FIELDS = [
  'txnCode',
  'txnDateTime',
  'merchantSafeId',
  'terminalSafeId',
  'orderId',
  'secureId',
  'secureEcomInd',
  'secureData',
  'secureMd',
] as const

/** A 3D Secure callback reports only the authentication; the bank has not provisioned anything yet. */
const SECURE_PROVISION_OUTCOME_FIELDS = ['authCode', 'rrn', 'hostResponseCode'] as const

/** Fields an approved 3D Pay / 3D Host callback must sign. */
const HOSTED_APPROVED_SIGNED_FIELDS = [
  'txnCode',
  'txnDateTime',
  'merchantSafeId',
  'terminalSafeId',
  'orderId',
  'hostResponseCode',
  'authCode',
  'rrn',
] as const

/** Fields every declined callback must sign. */
const DECLINED_SIGNED_FIELDS = ['responseCode', 'orderId'] as const

/** Order history states of a completed payment (a pre-authorization stays open until it is closed). */
const CONFIRMED_ORDER_STATUSES: readonly unknown[] = [
  PAYMENT_STATUS.PAYMENT_COMPLETED,
  PAYMENT_STATUS.PRE_AUTH_COMPLETED,
]

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

type HostedModel = typeof MODEL.THREE_D_PAY | typeof MODEL.THREE_D_HOST

/**
 * Akbank Virtual POS (the bank's JSON API with signed requests).
 *
 * The bank signs every 3D callback: `hash` is the HMAC of the values of the fields named in `hashParams`,
 * concatenated without separator. The check cannot be switched off (`disable_3d_hash_check` is ignored, and
 * `require_3d_hash` changes nothing because an unsigned callback is never accepted where it matters):
 * - 3D Secure: a callback that is not 3D-successful (response code other than `VPS-0000`) is verified when it carries
 *   a hash and then mapped as declined without any request, because no money moves; without a hash it is mapped as
 *   declined as well. A 3D-successful callback must carry a valid hash, otherwise `HashMismatchError`.
 * - 3D Pay and 3D Host: the callback reports the payment itself, so it must always carry a valid hash, even when it
 *   reports a decline.
 *
 * A callback is a flat record of strings: an object, array or function anywhere at its top level is a `PosError`
 * before any other check. Because the signed values have no separators, a valid hash alone does not fix where one
 * field ends and the next begins, so after the hash verifies the decisive fields must be well formed, otherwise
 * `HashMismatchError`: `responseCode` is `VPS-` and four digits; `txnCode` four digits, `hostResponseCode` two digits
 * and `txnDateTime` a `yyyy-MM-ddTHH:mm:ss.SSS` time whenever they are signed. A successful 3D Secure callback must
 * sign its transaction code, time, merchant, terminal, order id and the four 3D values (`secureEcomInd` two digits,
 * `secureId` and `secureData` base64, `secureMd` hex), and carry no authorization code, reference number or host
 * response code (nothing is provisioned yet). An approved 3D Pay / 3D Host callback must sign its transaction code,
 * time, merchant, terminal, order id, host response code (`00`), authorization code (six letters or digits) and
 * reference number (twelve digits). A declined callback must sign its response code and order id. 3D success is
 * decided on the callback's own `responseCode`, the same value the response mapper reads, and a callback taken down
 * the declined path must map as declined.
 *
 * A callback must belong to the order it is completed for (`OrderMismatchError`):
 * - 3D Secure, before the provision request: the signed `orderId`, `merchantSafeId` and `terminalSafeId` equal
 *   `order.id` and the account's merchant and terminal safe ids. The callback carries no amount; the provision request
 *   takes the order id, amount, currency, installment and IP address from the order, so at worst it charges the
 *   merchant's own order for its own amount.
 * - 3D Pay and 3D Host, after mapping (the mapped response is attached to the error, because the bank may already
 *   have charged the card): an approved callback's merchant and terminal safe ids equal the account's, and the mapped
 *   order id equals `order.id`. The end of the signed order id is not fixed by any format (the cardholder name that
 *   follows it is typed by the cardholder), and the callback carries no amount. So an approved result is confirmed
 *   with the bank by one signed order history request before it is returned: the bank must report the order as
 *   approved, with an approved transaction of the requested type that is completed, for the order amount, currency and
 *   installment count (a single payment is 0 or 1 alike), and the authorization code, reference number, batch
 *   number and time of the returned result are taken from that bank record, not from the callback. Otherwise `OrderMismatchError` with `paymentMayHaveCompleted`. Errors of that request (such as
 *   `PosHttpError`) propagate unchanged; the payment may have completed, so check it later with `orderHistory`.
 *   Declined callbacks are not confirmed.
 */
export class AkbankPos extends AbstractGateway<AkbankPosAccount> {
  static readonly NAME = 'AkbankPos'

  static override readonly GATEWAY_CLASS: string = 'AkbankPos'

  protected static override readonly testModeAffectsRequests: boolean = false

  protected static override supportedTransactions: SupportedTransactions = {
    [TX_TYPE.PAY_AUTH]: [MODEL.THREE_D_SECURE, MODEL.THREE_D_PAY, MODEL.THREE_D_HOST, MODEL.NON_SECURE],
    [TX_TYPE.PAY_PRE_AUTH]: [MODEL.THREE_D_SECURE, MODEL.THREE_D_PAY, MODEL.THREE_D_HOST, MODEL.NON_SECURE],
    [TX_TYPE.PAY_POST_AUTH]: true,
    [TX_TYPE.STATUS]: false,
    [TX_TYPE.CANCEL]: true,
    [TX_TYPE.REFUND]: true,
    [TX_TYPE.REFUND_PARTIAL]: true,
    [TX_TYPE.ORDER_HISTORY]: true,
  }

  /**
   * @throws PosError when a callback value is not a plain string
   * @throws HashMismatchError when a present hash does not verify, a 3D-successful callback is unsigned, or the
   *   signed fields are malformed
   * @throws OrderMismatchError when the callback does not belong to the order or account (nothing is sent)
   * @throws PosHttpError when the provision answer carries no result: the payment may have gone through, check the
   *   order history before any retry
   */
  async make3DPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    _card: CreditCard | null = null,
  ): Promise<PosResponse> {
    const paymentModel = MODEL.THREE_D_SECURE

    this.assertFlatCallback(gatewayResponseData)

    if (ownText(gatewayResponseData, 'responseCode') !== SUCCESS_CODE) {
      this.logger.error('3d auth fail', { md_status: this.echo(ownText(gatewayResponseData, 'responseCode')) })
      const hash = own(gatewayResponseData, 'hash')
      if (hash !== undefined && hash !== '') {
        this.assertHash(gatewayResponseData)
        this.assertSignedFields(gatewayResponseData, paymentModel)
      }

      const declined = this.responseDataMapper.map3DPaymentData(gatewayResponseData, null, txType, order)
      if (declined.status !== TX_DECLINED) {
        // Never report a payment that skipped the hash check, the order binding and the provision request.
        this.logger.error('3D callback without 3D success was not mapped as declined', {
          order_id: this.echo(declined.order_id),
          status: this.echo(declined.status),
        })
        throw new PosError('3D callback without 3D success was not mapped as declined')
      }

      return declined
    }

    this.logger.info('3d auth success', { md_status: SUCCESS_CODE })
    this.assertHash(gatewayResponseData)
    this.assertSignedFields(gatewayResponseData, paymentModel)
    this.assert3DSecureCallbackMatchesOrder(gatewayResponseData, order)

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.create3DPaymentRequestData(this.account, order, txType, gatewayResponseData),
      txType,
      order,
      paymentModel,
    )
    const provisionResponse = await this.sendRequest(txType, paymentModel, requestData, order)
    this.assertAnswerHasResult(txType, provisionResponse)

    const response = this.responseDataMapper.map3DPaymentData(gatewayResponseData, provisionResponse, txType, order)
    this.logger.debug('finished 3D payment', { mapped_response: response })

    return response
  }

  /**
   * @throws PosError when a callback value is not a plain string
   * @throws HashMismatchError when the callback is unsigned, its hash does not verify, or its signed fields are
   *   malformed
   * @throws OrderMismatchError when the callback does not belong to the order or account, or when the bank's order
   *   history does not confirm an approved payment (the mapped response is attached)
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
   * @throws UnsupportedFormFormatError for `formFormat: 'html'`
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

    this.logger.debug('preparing 3D form data')

    return this.requestDataMapper.create3DFormData(
      this.account,
      order,
      paymentModel,
      txType,
      this.get3DGatewayURL(paymentModel),
      this.cardForForm(card, createWithoutCard),
    ) as Promise<ThreeDFormData>
  }

  /** The bank offers no status request; use `orderHistory` instead. */
  override async status(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedTransactionTypeError('AkbankPos does not support status requests; use orderHistory.')
  }

  private async completeHostedPayment(
    callback: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    paymentModel: HostedModel,
  ): Promise<PosResponse> {
    this.assertFlatCallback(callback)
    this.assertHash(callback)
    this.assertSignedFields(callback, paymentModel)

    const approvedByCallback = ownText(callback, 'responseCode') === SUCCESS_CODE
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

    const orderId = asText(order.id)
    if (approvedByCallback) {
      this.assertAccountMatches(callback, orderId, response)
    }

    const mappedOrderId = asText(response.order_id)
    if (orderId === '' || mappedOrderId !== orderId) {
      this.fail('order_id', orderId, mappedOrderId, orderId, response)
    }

    if (response.status === TX_APPROVED) {
      const confirmed = await this.confirmPayment(response, order, txType)
      this.takeBankReferences(response, confirmed)
    }

    return response
  }

  /**
   * The callback cannot pin the end of its order id and carries no amount, so the bank's own record of the order
   * decides: it must hold an approved, completed transaction of this type for the order amount, currency and
   * installment plan. Returns that transaction.
   */
  private async confirmPayment(
    response: PosResponse,
    order: PosOrder,
    txType: TxType,
  ): Promise<Record<string, unknown>> {
    const orderId = asText(order.id)
    const history = await this.orderHistory({ id: orderId })

    const historyOrderId = asText(history.order_id)
    if (history.status !== TX_APPROVED || historyOrderId !== orderId) {
      this.fail('order_id', orderId, historyOrderId, orderId, response)
    }

    const transactions = Array.isArray(history.transactions) ? history.transactions.filter(isRecord) : []
    const ofType = transactions.filter((tx) => tx.status === TX_APPROVED && tx.transaction_type === txType)
    if (ofType.length === 0) {
      const approvedTypes = transactions
        .filter((tx) => tx.status === TX_APPROVED)
        .map((tx) => asText(tx.transaction_type))
        .join(',')
      this.fail('transaction_type', txType, approvedTypes, orderId, response)
    }

    const completed = ofType.filter((tx) => CONFIRMED_ORDER_STATUSES.includes(tx.order_status))
    if (completed.length === 0) {
      const actual = asText((ofType[0] as Record<string, unknown>).order_status)
      this.fail('order_status', CONFIRMED_ORDER_STATUSES.join(' or '), actual, orderId, response)
    }

    const expectedAmount = comparableAmount(order.amount)
    const sameAmount = completed.filter(
      (tx) => expectedAmount !== null && comparableAmount(tx.first_amount) === expectedAmount,
    )
    if (sameAmount.length === 0) {
      const actual = comparableAmount((completed[0] as Record<string, unknown>).first_amount) ?? ''
      this.fail('amount', expectedAmount ?? asText(order.amount), actual, orderId, response)
    }

    const expectedCurrency = order.currency ?? CURRENCY.TRY
    const sameCurrency = sameAmount.filter((tx) => tx.currency === expectedCurrency)
    if (sameCurrency.length === 0) {
      const actual = asText((sameAmount[0] as Record<string, unknown>).currency)
      this.fail('currency', expectedCurrency, actual, orderId, response)
    }

    // A single payment is reported as 0 or 1 (or nothing) alike; any other count is a different plan.
    const orderedInstallments = installmentCount(order.installment)
    const sameInstallments = sameCurrency.filter((tx) => installmentCount(tx.installment_count) === orderedInstallments)
    const confirmed = sameInstallments[0]
    if (confirmed === undefined) {
      const actual = installmentCount((sameCurrency[0] as Record<string, unknown>).installment_count)
      this.fail('installment', String(orderedInstallments), String(actual), orderId, response)
    }

    this.logger.info('payment confirmed by the bank order history', { order_id: orderId })

    return confirmed
  }

  /**
   * The signed callback values have no separators, so the cardholder name can take characters from the codes that
   * follow it. The references handed to the merchant therefore come from the bank's own record of the payment.
   */
  private takeBankReferences(response: PosResponse, transaction: Record<string, unknown>): void {
    response.auth_code = (transaction.auth_code ?? null) as PosResponse['auth_code']
    response.ref_ret_num = (transaction.ref_ret_num ?? null) as PosResponse['ref_ret_num']
    response.batch_num = (transaction.batch_num ?? null) as PosResponse['batch_num']
    response.installment_count = installmentCount(transaction.installment_count)
    if (transaction.transaction_time instanceof Date) {
      response.transaction_time = transaction.transaction_time
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

  private assertHash(callback: GatewayResponseData): void {
    if (!this.crypt.check3DHash(this.account, callback)) {
      throw new HashMismatchError('3D callback hash mismatch')
    }
  }

  /**
   * Runs after the hash verified. The signed values are concatenated without separator, so the formats below are
   * what keeps characters from moving between adjacent signed fields: the transaction code (four digits) and the
   * response code (`VPS-` and four digits) sit at the start, which fixes the decisive code.
   */
  private assertSignedFields(callback: GatewayResponseData, paymentModel: PaymentModel): void {
    const hashParams = ownText(callback, 'hashParams')
    const signed = new Set(hashParams === undefined ? [] : hashParams.split('+'))
    const value = (key: string): string => ownText(callback, key) ?? ''
    const malformed: string[] = []
    const check = (key: string, ok: boolean): void => {
      if (!ok) malformed.push(key)
    }
    const requireSigned = (keys: readonly string[]): void => {
      for (const key of keys) check(key, signed.has(key))
    }

    const responseCode = value('responseCode')
    check('responseCode', RESPONSE_CODE.test(responseCode))
    if (signed.has('txnCode')) check('txnCode', TXN_CODE.test(value('txnCode')))
    if (signed.has('hostResponseCode')) check('hostResponseCode', HOST_RESPONSE_CODE.test(value('hostResponseCode')))
    if (signed.has('txnDateTime')) check('txnDateTime', TXN_DATE_TIME.test(value('txnDateTime')))

    if (responseCode !== SUCCESS_CODE) {
      requireSigned(DECLINED_SIGNED_FIELDS)
    } else if (paymentModel === MODEL.THREE_D_SECURE) {
      requireSigned(SECURE_SUCCESS_SIGNED_FIELDS)
      check('secureEcomInd', SECURE_ECOM_IND.test(value('secureEcomInd')))
      check('secureId', BASE64.test(value('secureId')))
      check('secureData', BASE64.test(value('secureData')))
      check('secureMd', HEX.test(value('secureMd')))
      for (const key of SECURE_PROVISION_OUTCOME_FIELDS) {
        const outcome = own(callback, key)
        check(key, outcome === undefined || outcome === '')
      }
    } else {
      requireSigned(HOSTED_APPROVED_SIGNED_FIELDS)
      check('hostResponseCode', value('hostResponseCode') === '00')
      check('authCode', AUTH_CODE.test(value('authCode')))
      check('rrn', RRN.test(value('rrn')))
    }

    if (malformed.length > 0) {
      this.logger.error('3D callback fields are malformed', {
        order_id: this.echo(ownText(callback, 'orderId')),
        fields: [...new Set(malformed)],
      })
      throw new HashMismatchError('3D callback fields are malformed')
    }
  }

  /** Runs before the provision request, so no response is attached. */
  private assert3DSecureCallbackMatchesOrder(callback: GatewayResponseData, order: PosOrder): void {
    const orderId = asText(order.id)
    const callbackOrderId = ownText(callback, 'orderId') ?? ''
    if (orderId === '' || callbackOrderId !== orderId) {
      this.fail('order_id', orderId, callbackOrderId, orderId)
    }
    this.assertAccountMatches(callback, orderId)
  }

  private assertAccountMatches(callback: GatewayResponseData, orderId: string, response?: PosResponse): void {
    const merchantId = ownText(callback, 'merchantSafeId') ?? ''
    if (merchantId !== this.account.getMerchantId()) {
      this.fail('merchant_id', this.account.getMerchantId(), merchantId, orderId, response)
    }

    const terminalId = ownText(callback, 'terminalSafeId') ?? ''
    if (terminalId !== this.account.getTerminalId()) {
      this.fail('terminal_id', this.account.getTerminalId() ?? '', terminalId, orderId, response)
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
    throw new OrderMismatchError(field, expected, actual, response)
  }
}
