import { TX_DECLINED } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
import {
  HashMismatchError,
  OrderMismatchError,
  type OrderMismatchField,
  PosError,
  UnsupportedFormFormatError,
  UnsupportedPaymentModelError,
} from '../errors.js'
import type { GarantiPosAccount } from '../model/account/GarantiPosAccount.js'
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
import { phpTrim } from '../util/phpTrim.js'
import { AbstractGateway, type SupportedTransactions } from './AbstractGateway.js'

/** Security level the bank echoes for each payment model it accepts callbacks for. */
const SECURITY_LEVEL_3D = '3D'
const SECURITY_LEVEL_3D_PAY = '3D_PAY'

/**
 * Callback fields read for the outcome, the order binding or the provision request. A forged form body can turn
 * any of them into an array or object whose text form still matches a signed value, so they must be plain strings.
 */
const CALLBACK_TEXT_FIELDS = [
  'mdstatus',
  'response',
  'procreturncode',
  'oid',
  'orderid',
  'customeripaddress',
  'txntype',
  'txnamount',
  'txncurrencycode',
  'txninstallmentcount',
  'terminalid',
  'terminalmerchantid',
  'secure3dsecuritylevel',
  'cavv',
  'eci',
  'xid',
  'md',
  'authcode',
  'transid',
  'hostrefnum',
  'txnstatus',
  'MaskedPan',
  'errmsg',
  'mderrormessage',
] as const

/** Strict formats of the signed fields that decide the outcome; anything else is treated as tampering. */
const PROC_RETURN_CODE = /^\d{2}$/
const MD_STATUS = /^\d$/
const RESPONSES: readonly string[] = ['', 'Approved', 'Declined', 'Error']
/** A bank authorization code: six letters or digits. Its fixed length pins the boundary to the signed `oid`. */
const AUTH_CODE = /^[0-9A-Za-z]{6}$/
/** The 3D authentication value: 20 bytes in base64 (28 characters ending in `=`). Pins `mdstatus` and `eci`. */
const CAVV = /^[A-Za-z0-9+/]{27}=$/
/** The electronic commerce indicator: two digits. */
const ECI = /^\d{2}$/

/** Callback key names are attacker controlled; only this much of one is echoed in errors and logs. */
const MAX_ECHOED_KEY_LENGTH = 64

/** An own callback value; `null` counts as absent like a missing key. */
function own(callback: GatewayResponseData, key: string): unknown {
  const value = Object.hasOwn(callback, key) ? callback[key] : undefined
  return value === null ? undefined : value
}

function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

/**
 * Garanti BBVA Virtual POS (GVP).
 *
 * The callback signature (`hash` over the fields named in `hashparams`) cannot be switched off:
 * - 3D Secure: a callback that is not 3D-successful (mdStatus other than 1 to 4, or `response` `Error`) is mapped
 *   as declined without the hash check and without any request, because no money moves. Every other callback must
 *   carry a valid hash, otherwise `HashMismatchError`.
 * - 3D Pay: a callback carrying a hash must verify. The bank sends some error callbacks unsigned; such a callback is
 *   accepted only when it maps as declined and its `procreturncode` is not `00` (an unsigned callback claiming a
 *   completed payment is a `HashMismatchError`), and never when `require_3d_hash` is enabled.
 *
 * The signature does not cover the order number, amount, currency or transaction type that the provision request
 * takes from the callback, so a callback must belong to the order it is completed for (`OrderMismatchError`):
 * - 3D Secure, before the provision request: `orderid` (required, the provision request uses it) and the signed
 *   `oid` (required) equal `order.id`; `txnamount` equals the order amount in kuruş; `txncurrencycode` the order currency
 *   code; `txntype` the transaction type; and when present `terminalid`, `terminalmerchantid` and
 *   `secure3dsecuritylevel` (`3D`) match the account and the payment model.
 * - 3D Pay, after mapping (the mapped response is attached to the error): `secure3dsecuritylevel` when present is
 *   `3D_PAY`, the mapped `order_id` equals `order.id`, and a signed callback carries `oid` equal to `order.id`; when the bank reports a completed payment, the amount,
 *   currency, transaction type, terminal and merchant are bound as above. Declined callbacks echo an amount of 0,
 *   so they are not bound on amount.
 *
 * A callback is a flat record of strings: a nested object or array anywhere at its top level is a `PosError`
 * before any other check, and every field read for these decisions must be a plain string. After the hash verifies,
 * `procreturncode` (two digits), `response` (`Approved`, `Declined` or `Error`) and `mdstatus` (one digit) must be
 * well formed (each may also be empty), `authcode` empty or six letters or digits (always six when `procreturncode`
 * is `00`), `cavv` empty or 28 base64 characters ending in `=`, and `eci` empty or two digits, otherwise
 * `HashMismatchError`. The signature has no separators, so these fixed formats are what keeps characters from
 * moving between adjacent signed fields; for the same reason a signed callback must carry `oid` (a missing one would
 * let its characters land in `mdstatus` and `cavv` while the unsigned `orderid` names any order). A signed callback
 * must also carry `clientid` equal to the account terminal id (an unsigned one only when present). A signed 3D
 * Secure callback must carry an empty `authcode`, `procreturncode` and `response` (nothing is provisioned yet), and
 * on a signed 3D Pay callback `procreturncode` is `00` exactly when `response` is `Approved`, otherwise
 * `HashMismatchError`. 3D success is decided on the trimmed mdStatus, the same value the response mapper reads, and
 * a callback taken down the not-3D-successful path must map as declined.
 */
export class GarantiPos extends AbstractGateway<GarantiPosAccount> {
  static readonly NAME = 'GarantiPay'

  static override readonly GATEWAY_CLASS: string = 'GarantiPos'

  protected static override readonly testModeAffectsRequests: boolean = true

  protected static override supportedTransactions: SupportedTransactions = {
    [TX_TYPE.PAY_AUTH]: [MODEL.THREE_D_SECURE, MODEL.THREE_D_PAY, MODEL.NON_SECURE],
    [TX_TYPE.PAY_PRE_AUTH]: [MODEL.THREE_D_SECURE, MODEL.THREE_D_PAY, MODEL.NON_SECURE],
    [TX_TYPE.PAY_POST_AUTH]: true,
    [TX_TYPE.STATUS]: true,
    [TX_TYPE.CANCEL]: true,
    [TX_TYPE.REFUND]: true,
    [TX_TYPE.REFUND_PARTIAL]: true,
    [TX_TYPE.ORDER_HISTORY]: true,
  }

  /**
   * @throws HashMismatchError when the callback is 3D-successful but its hash is missing or does not verify
   * @throws PosError when a callback field is not a string
   * @throws OrderMismatchError when the callback does not belong to the order (nothing is sent to the bank)
   */
  async make3DPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    _card: CreditCard | null = null,
  ): Promise<PosResponse> {
    const paymentModel = MODEL.THREE_D_SECURE

    this.assertFlatCallback(gatewayResponseData)

    if (!this.is3dAuthSuccess(gatewayResponseData) || isErrorResponse(gatewayResponseData)) {
      const declined = this.responseDataMapper.map3DPaymentData(gatewayResponseData, null, txType, order)
      if (declined.status !== TX_DECLINED) {
        // Never report a payment that skipped the hash check, the order binding and the provision request.
        this.logger.error('3D callback without 3D success was not mapped as declined', {
          order_id: asText(declined.order_id),
          status: asText(declined.status),
        })
        throw new PosError('3D callback without 3D success was not mapped as declined')
      }

      return declined
    }

    if (!this.crypt.check3DHash(this.account, gatewayResponseData)) {
      throw new HashMismatchError('3D callback hash mismatch')
    }

    this.assertTextFields(gatewayResponseData)
    this.assertSignedOrderId(gatewayResponseData, asText(order.id))
    this.assertSignedOutcomeFormat(gatewayResponseData)
    this.assertNoOutcomeBeforeProvision(gatewayResponseData)
    this.assert3DSecureCallbackMatchesOrder(gatewayResponseData, order, txType)

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.create3DPaymentRequestData(this.account, order, txType, gatewayResponseData),
      txType,
      order,
      paymentModel,
    )
    const provisionResponse = await this.sendRequest(txType, paymentModel, requestData, order)

    const response = this.responseDataMapper.map3DPaymentData(gatewayResponseData, provisionResponse, txType, order)
    this.logger.debug('finished 3D payment', { mapped_response: response })

    return response
  }

  /**
   * @throws HashMismatchError when a present hash does not verify, when an unsigned callback reports a completed
   *   payment, or when `require_3d_hash` is enabled and the callback is unsigned
   * @throws PosError when a callback field is not a string
   * @throws OrderMismatchError when the callback does not belong to the order (the mapped response is attached)
   */
  async make3DPayPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
  ): Promise<PosResponse> {
    this.assertFlatCallback(gatewayResponseData)

    const hash = own(gatewayResponseData, 'hash')
    const signed = hash !== undefined && hash !== ''

    if (signed) {
      if (!this.crypt.check3DHash(this.account, gatewayResponseData)) {
        throw new HashMismatchError('3D callback hash mismatch')
      }
    } else if (this.config.require_3d_hash === true) {
      throw new HashMismatchError('3D callback has no hash')
    }

    this.assertTextFields(gatewayResponseData)
    if (signed) {
      this.assertSignedOutcomeFormat(gatewayResponseData)
      this.assertApprovalConsistent(gatewayResponseData)
    }

    const response = this.responseDataMapper.map3DPayResponseData(gatewayResponseData, txType, order)

    if (!signed && (reportsCompletedPayment(response) || own(gatewayResponseData, 'procreturncode') === '00')) {
      this.logger.error('unsigned 3D callback reports a completed payment', { order_id: asText(response.order_id) })
      throw new HashMismatchError('Unsigned 3D callback reports a completed payment')
    }

    this.assert3DPayCallbackMatchesOrder(gatewayResponseData, response, order, txType, signed)

    return response
  }

  async make3DHostPayment(
    _gatewayResponseData: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
  ): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError('Garanti does not support the 3D Host model')
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
      card,
    ) as Promise<ThreeDFormData>
  }

  /** mdStatus as the response mapper reads it: trimmed like PHP, empty meaning absent. */
  protected override is3dAuthSuccess(responseData: Record<string, unknown>): boolean {
    const raw = this.responseDataMapper.extractMdStatus(responseData)
    const mdStatus = typeof raw === 'string' ? phpTrim(raw) || null : null

    if (this.responseDataMapper.is3dAuthSuccess(mdStatus)) {
      this.logger.info('3d auth success', { md_status: mdStatus })

      return true
    }

    this.logger.error('3d auth fail', { md_status: mdStatus })

    return false
  }

  /**
   * A bank callback is a flat form of strings. A nested value could shadow a field for one reader (for example a
   * depth-first search) while another reads the top-level value. The signature itself is left to the hash check,
   * which rejects anything but a string.
   */
  private assertFlatCallback(callback: GatewayResponseData): void {
    // own property names include non-enumerable ones, which a spread or `Object.entries` would skip
    for (const key of Object.getOwnPropertyNames(callback)) {
      const value: unknown = callback[key]
      if (key !== 'hash' && ((typeof value === 'object' && value !== null) || typeof value === 'function')) {
        const field = key.slice(0, MAX_ECHOED_KEY_LENGTH)
        this.logger.error('3D callback field is not a string', { field, type: typeof value })
        throw new PosError(`3D callback field "${field}" must be a string`)
      }
    }
  }

  /**
   * Signed fields must be well formed: the hash covers only their concatenation, so a valid hash over malformed
   * values means characters were moved across field boundaries. The authorization code (empty, or six characters,
   * and always six when the bank authorized) fixes where the signed order id ends.
   */
  private assertSignedOutcomeFormat(callback: GatewayResponseData): void {
    const procReturnCode = asText(own(callback, 'procreturncode'))
    const response = asText(own(callback, 'response'))
    const mdStatus = asText(own(callback, 'mdstatus'))
    const authCode = phpTrim(asText(own(callback, 'authcode')))
    const cavv = phpTrim(asText(own(callback, 'cavv')))
    const eci = phpTrim(asText(own(callback, 'eci')))
    if (
      (procReturnCode !== '' && !PROC_RETURN_CODE.test(procReturnCode)) ||
      !RESPONSES.includes(response) ||
      (mdStatus !== '' && !MD_STATUS.test(mdStatus)) ||
      (authCode !== '' && !AUTH_CODE.test(authCode)) ||
      (procReturnCode === '00' && !AUTH_CODE.test(authCode)) ||
      (cavv !== '' && !CAVV.test(cavv)) ||
      (eci !== '' && !ECI.test(eci))
    ) {
      this.logger.error('3D callback outcome fields are malformed', {
        order_id: asText(own(callback, 'oid')),
        proc_return_code: procReturnCode,
        response,
        md_status: mdStatus,
        auth_code_length: authCode.length,
        cavv_length: cavv.length,
        eci_length: eci.length,
      })
      throw new HashMismatchError('3D callback outcome fields are malformed')
    }
  }

  /**
   * The signed `oid` must be present and name the order. Were it allowed to be missing, its characters could be moved
   * into the following signed fields with the hash still valid, and the unsigned `orderid` could then name any order.
   */
  private assertSignedOrderId(callback: GatewayResponseData, orderId: string, response?: PosResponse): void {
    const oid = own(callback, 'oid')
    if (orderId === '' || oid !== orderId) {
      this.fail('order_id', orderId, asText(oid), orderId, response)
    }
  }

  /**
   * A 3D Pay callback reports the provision outcome: the bank approves with return code `00` and response
   * `Approved`, and never one without the other. A mismatch means signed characters were moved between fields (for
   * example the tail of the order id read as an authorization code plus `00`).
   */
  private assertApprovalConsistent(callback: GatewayResponseData): void {
    const approvedCode = phpTrim(asText(own(callback, 'procreturncode'))) === '00'
    const approvedResponse = phpTrim(asText(own(callback, 'response'))) === 'Approved'
    if (approvedCode !== approvedResponse) {
      this.logger.error('3D callback outcome fields are malformed', {
        order_id: asText(own(callback, 'oid')),
        proc_return_code: asText(own(callback, 'procreturncode')),
        response: asText(own(callback, 'response')),
      })
      throw new HashMismatchError('3D callback outcome fields are malformed')
    }
  }

  /**
   * A 3D Secure callback reports only the authentication; the bank has not provisioned anything yet, so its
   * authorization code, return code and response are empty. Requiring that pins where the signed order id ends:
   * otherwise its last characters could be moved into those fields with the hash still valid.
   */
  private assertNoOutcomeBeforeProvision(callback: GatewayResponseData): void {
    for (const key of ['authcode', 'procreturncode', 'response'] as const) {
      if (phpTrim(asText(own(callback, key))) !== '') {
        this.logger.error('3D Secure callback carries a provision outcome', {
          order_id: asText(own(callback, 'oid')),
          field: key,
        })
        throw new HashMismatchError('3D Secure callback carries a provision outcome')
      }
    }
  }

  private assertTextFields(callback: GatewayResponseData): void {
    for (const key of CALLBACK_TEXT_FIELDS) {
      const value = own(callback, key)
      if (value !== undefined && typeof value !== 'string') {
        this.logger.error('3D callback field is not a string', { field: key, type: typeof value })
        throw new PosError(`3D callback field "${key}" must be a string`)
      }
    }
  }

  /** Runs before the provision request, which takes these values from the callback. */
  private assert3DSecureCallbackMatchesOrder(callback: GatewayResponseData, order: PosOrder, txType: TxType): void {
    const orderId = asText(order.id)
    const orderIdEcho = own(callback, 'orderid')
    if (orderId === '' || orderIdEcho !== orderId) {
      this.fail('order_id', orderId, asText(orderIdEcho), orderId)
    }

    this.assertClientId(callback, orderId, true)
    this.assertPaymentEchoMatches(callback, order, txType, orderId)
    this.assertSecurityLevel(callback, SECURITY_LEVEL_3D, orderId)
  }

  /** Runs after mapping, so the error carries the response (the bank may already have charged the card). */
  private assert3DPayCallbackMatchesOrder(
    callback: GatewayResponseData,
    response: PosResponse,
    order: PosOrder,
    txType: TxType,
    signed: boolean,
  ): void {
    const orderId = asText(order.id)
    this.assertSecurityLevel(callback, SECURITY_LEVEL_3D_PAY, orderId, response)

    const mappedOrderId = asText(response.order_id)
    if (orderId === '' || mappedOrderId !== orderId) {
      this.fail('order_id', orderId, mappedOrderId, orderId, response)
    }
    if (signed) {
      this.assertSignedOrderId(callback, orderId, response)
    }
    this.assertClientId(callback, orderId, signed, response)

    if (reportsCompletedPayment(response)) {
      this.assertPaymentEchoMatches(callback, order, txType, orderId, response)
    }
  }

  /** Amount, currency, transaction type, and the terminal and merchant when the callback echoes them. */
  private assertPaymentEchoMatches(
    callback: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    orderId: string,
    response?: PosResponse,
  ): void {
    const expectedAmount = this.expectedAmount(order)
    const amount = own(callback, 'txnamount')
    if (expectedAmount === null || amount !== expectedAmount) {
      this.fail('amount', expectedAmount ?? asText(order.amount), asText(amount), orderId, response)
    }

    const expectedCurrency = String(this.requestValueMapper.mapCurrency(order.currency ?? CURRENCY.TRY))
    const currency = own(callback, 'txncurrencycode')
    if (currency !== expectedCurrency) {
      this.fail('currency', expectedCurrency, asText(currency), orderId, response)
    }

    const expectedTxType = this.requestValueMapper.mapTxType(txType)
    const callbackTxType = own(callback, 'txntype')
    if (callbackTxType !== expectedTxType) {
      this.fail('transaction_type', expectedTxType, asText(callbackTxType), orderId, response)
    }

    const terminalId = own(callback, 'terminalid')
    if (terminalId !== undefined && terminalId !== this.account.getTerminalId()) {
      this.fail('terminal_id', this.account.getTerminalId(), asText(terminalId), orderId, response)
    }

    const merchantId = own(callback, 'terminalmerchantid')
    if (merchantId !== undefined && merchantId !== this.account.getMerchantId()) {
      this.fail('merchant_id', this.account.getMerchantId(), asText(merchantId), orderId, response)
    }
  }

  /**
   * The signed `clientid` is the terminal the callback was produced for. A signed callback must carry it: without it
   * the terminal id characters could be moved into the signed `oid`.
   */
  private assertClientId(
    callback: GatewayResponseData,
    orderId: string,
    required: boolean,
    response?: PosResponse,
  ): void {
    const clientId = own(callback, 'clientid')
    if ((required || clientId !== undefined) && clientId !== this.account.getTerminalId()) {
      this.fail('terminal_id', this.account.getTerminalId(), asText(clientId), orderId, response)
    }
  }

  private assertSecurityLevel(
    callback: GatewayResponseData,
    expected: string,
    orderId: string,
    response?: PosResponse,
  ): void {
    const securityLevel = own(callback, 'secure3dsecuritylevel')
    if (securityLevel !== undefined && securityLevel !== expected) {
      this.fail('payment_model', expected, asText(securityLevel), orderId, response)
    }
  }

  /** The order amount in kuruş as the bank echoes it; null when the order has no usable amount. */
  private expectedAmount(order: PosOrder): string | null {
    const amount: unknown = order.amount
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      return null
    }
    try {
      return String(this.requestValueFormatter.formatAmount(amount))
    } catch (e) {
      if (e instanceof PosError) {
        return null
      }
      throw e
    }
  }

  private fail(
    field: OrderMismatchField,
    expected: string,
    actual: string,
    orderId: string,
    response?: PosResponse,
  ): never {
    this.logger.error(`3D callback ${field} does not match the order`, { order_id: orderId, expected, actual })
    throw new OrderMismatchError(field, expected, actual, response)
  }
}

/** The mapper treats a `response` of `Error` as a failed 3D authentication whatever the mdStatus says. */
function isErrorResponse(callback: GatewayResponseData): boolean {
  const response = own(callback, 'response')
  return typeof response === 'string' && phpTrim(response) === 'Error'
}

function reportsCompletedPayment(response: PosResponse): boolean {
  return response.status === 'approved' || response.proc_return_code === '00'
}
