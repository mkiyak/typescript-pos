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
 * - 3D Secure, before the provision request: `orderid` (required, the provision request uses it) and `oid` (when
 *   present) equal `order.id`; `txnamount` equals the order amount in kuruş; `txncurrencycode` the order currency
 *   code; `txntype` the transaction type; and when present `terminalid`, `terminalmerchantid` and
 *   `secure3dsecuritylevel` (`3D`) match the account and the payment model.
 * - 3D Pay, after mapping (the mapped response is attached to the error): `secure3dsecuritylevel` when present is
 *   `3D_PAY` and the mapped `order_id` equals `order.id`; when the bank reports a completed payment, the amount,
 *   currency, transaction type, terminal and merchant are bound as above. Declined callbacks echo an amount of 0,
 *   so they are not bound on amount.
 *
 * Every callback field read for these decisions must be a plain string, otherwise `PosError`.
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

    if (!this.is3dAuthSuccess(gatewayResponseData) || isErrorResponse(gatewayResponseData)) {
      return this.responseDataMapper.map3DPaymentData(gatewayResponseData, null, txType, order)
    }

    if (!this.crypt.check3DHash(this.account, gatewayResponseData)) {
      throw new HashMismatchError('3D callback hash mismatch')
    }

    this.assertTextFields(gatewayResponseData)
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

    const response = this.responseDataMapper.map3DPayResponseData(gatewayResponseData, txType, order)

    if (!signed && (reportsCompletedPayment(response) || own(gatewayResponseData, 'procreturncode') === '00')) {
      this.logger.error('unsigned 3D callback reports a completed payment', { order_id: asText(response.order_id) })
      throw new HashMismatchError('Unsigned 3D callback reports a completed payment')
    }

    this.assert3DPayCallbackMatchesOrder(gatewayResponseData, response, order, txType)

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
    const oid = own(callback, 'oid')
    if (oid !== undefined && oid !== orderId) {
      this.fail('order_id', orderId, asText(oid), orderId)
    }

    this.assertPaymentEchoMatches(callback, order, txType, orderId)
    this.assertSecurityLevel(callback, SECURITY_LEVEL_3D, orderId)
  }

  /** Runs after mapping, so the error carries the response (the bank may already have charged the card). */
  private assert3DPayCallbackMatchesOrder(
    callback: GatewayResponseData,
    response: PosResponse,
    order: PosOrder,
    txType: TxType,
  ): void {
    const orderId = asText(order.id)
    this.assertSecurityLevel(callback, SECURITY_LEVEL_3D_PAY, orderId, response)

    const mappedOrderId = asText(response.order_id)
    if (orderId === '' || mappedOrderId !== orderId) {
      this.fail('order_id', orderId, mappedOrderId, orderId, response)
    }

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
  return typeof response === 'string' && response.trim() === 'Error'
}

function reportsCompletedPayment(response: PosResponse): boolean {
  return response.status === 'approved' || response.proc_return_code === '00'
}
