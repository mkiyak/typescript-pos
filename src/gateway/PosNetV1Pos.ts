import { TX_DECLINED } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { PosNetV1PosResponseValueMapper } from '../data-mapper/response/value-mapper/PosNetV1PosResponseValueMapper.js'
import {
  HashMismatchError,
  OrderMismatchError,
  type OrderMismatchField,
  PosError,
  UnsupportedFormFormatError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../errors.js'
import type { PosNetPosAccount } from '../model/account/PosNetPosAccount.js'
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
import { ownValue } from '../util/ownValue.js'
import { parseOrderAmount } from '../util/parseOrderAmount.js'
import { required } from '../util/required.js'
import { AbstractGateway, type GatewayConfig, type GatewayDeps, type SupportedTransactions } from './AbstractGateway.js'

/**
 * Formats of the signed callback fields on a successful authentication. The bank joins them without separators,
 * so a fixed-width ECI, a fixed-width CAVV ending in `=` and a one-character status pin the first 31 signed
 * characters: no boundary inside them can be moved while the MAC stays valid.
 */
const SIGNED_ECI = /^\d{2}$/
const SIGNED_CAVV = /^[A-Za-z0-9+/]{27}=$/
const SIGNED_MD = /^[0-9,]{1,128}$/
const SIGNED_SECURE_TRANSACTION_ID = /^\d{1,32}$/
const MAX_MD_ERROR_MESSAGE_LENGTH = 512

/** The only authentication status that allows a provision. */
const AUTHENTICATED = '1'

/** Callback keys and values are not ours; only this much of one is echoed in errors and logs. */
const MAX_ECHOED_LENGTH = 64

/** The padded order number, which only the POSNET value formatter builds. */
type OrderIdFormatter = {
  formatOrderId(orderId: string, txType?: TxType | null, orderPaymentModel?: PaymentModel | null): string
}

/** A callback value read as an own string; `null` and absent both read as absent. */
type CallbackValue = { present: false } | { present: true; value: unknown }

function callbackValue(callback: GatewayResponseData, key: string): CallbackValue {
  const value: unknown = ownValue(callback, key)

  return value === undefined || value === null ? { present: false } : { present: true, value }
}

function echo(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_ECHOED_LENGTH) : value === undefined ? '' : typeof value
}

/**
 * Albaraka POSNET (JSON API).
 *
 * The 3D form is posted to the bank by the browser (with the card, or with `createWithoutCard: true` so the card
 * is typed on the bank's page). The bank posts the outcome back as a flat form signed with `Mac`, a SHA-256 over
 * `ECI`, `CAVV`, `MdStatus`, `MdErrorMessage`, `MD` and `SecureTransactionId` joined without separators.
 * `make3DPayment` sends the provision request only when all of this holds:
 * - the callback is a flat record (a nested value could shadow a field for one reader while another reads the
 *   top-level value);
 * - the authentication status, read exactly as the response mapper reads it, is 1; any other callback is mapped
 *   without a provision request and must map as declined;
 * - the `Mac` verifies against the fixed field list (never the list the callback names). This cannot be disabled.
 *   A declined callback that carries a `Mac` must verify as well; one without `Mac` is accepted as a decline,
 *   unless `require_3d_hash` is set;
 * - the signed fields have the only formats the bank uses. Because the values are joined without separators, a
 *   genuine MAC of a declined callback would otherwise verify after re-splitting its values into a status of 1;
 * - the unsigned echoes match the order: the padded order number, the amount in kuruş and, when present, the
 *   currency, the merchant and the transaction type (`OrderMismatchError` before the provision request, so no
 *   money has moved and no response is attached). These echoes only stop honest mismatches and naive replays;
 *   the provision itself takes the order number, amount, currency and installments from the order and only the
 *   3D session values from the callback, and the bank checks those against its own 3D session.
 */
export class PosNetV1Pos extends AbstractGateway<PosNetPosAccount> {
  static readonly NAME = 'PosNetV1'

  static override readonly GATEWAY_CLASS: string = 'PosNetV1Pos'

  protected static override supportedTransactions: SupportedTransactions = {
    [TX_TYPE.PAY_AUTH]: [MODEL.THREE_D_SECURE, MODEL.NON_SECURE],
    [TX_TYPE.PAY_PRE_AUTH]: [MODEL.THREE_D_SECURE, MODEL.NON_SECURE],
    [TX_TYPE.PAY_POST_AUTH]: true,
    [TX_TYPE.STATUS]: true,
    [TX_TYPE.CANCEL]: true,
    [TX_TYPE.REFUND]: true,
    [TX_TYPE.REFUND_PARTIAL]: true,
    [TX_TYPE.ORDER_HISTORY]: false,
  }

  readonly #orderIdFormatter: OrderIdFormatter

  /** Reads the numeric currency code the bank echoes in the callback; a stateless table. */
  readonly #callbackValueMapper = new PosNetV1PosResponseValueMapper()

  /**
   * @throws PosError when the request value formatter cannot format order numbers
   */
  constructor(config: GatewayConfig, account: PosNetPosAccount, deps: GatewayDeps<PosNetPosAccount>) {
    super(config, account, deps)
    const formatter = deps.requestValueFormatter as Partial<OrderIdFormatter>
    if (typeof formatter.formatOrderId !== 'function') {
      throw new PosError('PosNetV1Pos needs a request value formatter with formatOrderId')
    }
    this.#orderIdFormatter = deps.requestValueFormatter as unknown as OrderIdFormatter
  }

  /**
   * @throws UnsupportedFormFormatError for `formFormat: 'html'`
   * @throws PosError when the card is missing (unless `createWithoutCard`) or the order lacks a required field
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

  /**
   * @throws PosError when the callback is not flat, or a declined callback was not mapped as declined
   * @throws HashMismatchError when the `Mac` does not verify, a callback that must be signed carries none, or the
   *   signed fields of a successful callback are malformed
   * @throws OrderMismatchError when the callback echoes another order number, amount, currency, merchant or
   *   transaction type (nothing is provisioned)
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

    this.assertFlatCallback(gatewayResponseData)

    if (!this.is3dAuthSuccess(gatewayResponseData)) {
      this.checkDeclinedCallbackSignature(gatewayResponseData)
      const declined = this.responseDataMapper.map3DPaymentData(gatewayResponseData, null, txType, order)
      if (declined.status !== TX_DECLINED) {
        // Never report a payment that skipped the MAC check, the order binding and the provision request.
        this.logger.error('3D callback without 3D success was not mapped as declined', {
          order_id: echo(declined.order_id),
          status: echo(declined.status),
        })
        throw new PosError('3D callback without 3D success was not mapped as declined')
      }
      this.logger.debug('finished 3D payment', { mapped_response: declined })

      return declined
    }

    if (!this.crypt.check3DHash(this.account, gatewayResponseData)) {
      throw new HashMismatchError('3D callback hash mismatch')
    }
    this.assertSignedFormats(gatewayResponseData)
    this.assertCallbackMatchesOrder(gatewayResponseData, order, txType)

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

  async make3DPayPayment(
    _gatewayResponseData: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
  ): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError('PosNetV1Pos does not support the 3D Pay model')
  }

  async make3DHostPayment(
    _gatewayResponseData: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
  ): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError('PosNetV1Pos does not support the 3D Host model')
  }

  override async orderHistory(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedTransactionTypeError('PosNetV1Pos does not support order history')
  }

  /**
   * A bank callback is a flat form of strings. A nested value could shadow a field for one reader while another
   * reads the top-level value.
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

  /**
   * A declined callback provisions nothing, but a `Mac` it carries must still verify, so a tampered decline is
   * never reported as the bank's answer. Without a `Mac` it is accepted only when unsigned callbacks are allowed.
   */
  private checkDeclinedCallbackSignature(callback: GatewayResponseData): void {
    const mac = callbackValue(callback, 'Mac')
    if (mac.present && mac.value !== '') {
      if (!this.crypt.check3DHash(this.account, callback)) {
        throw new HashMismatchError('3D callback hash mismatch')
      }

      return
    }
    if (this.config.require_3d_hash === true) {
      this.logger.error('3D callback has no Mac', { order_id: echo(ownValue(callback, 'OrderId')) })
      throw new HashMismatchError('3D callback has no Mac')
    }
  }

  /**
   * The signed fields must have the only formats the bank uses. With a valid MAC this rules out values that were
   * re-split from another signed callback.
   */
  private assertSignedFormats(callback: GatewayResponseData): void {
    const text = (key: string): string | null => {
      const value: unknown = ownValue(callback, key)
      return typeof value === 'string' ? value : null
    }
    const eci = text('ECI')
    const cavv = text('CAVV')
    const md = text('MD')
    const secureTransactionId = text('SecureTransactionId')
    const mdErrorMessage = callbackValue(callback, 'MdErrorMessage')
    if (
      eci === null ||
      !SIGNED_ECI.test(eci) ||
      cavv === null ||
      !SIGNED_CAVV.test(cavv) ||
      text('MdStatus') !== AUTHENTICATED ||
      md === null ||
      !SIGNED_MD.test(md) ||
      secureTransactionId === null ||
      !SIGNED_SECURE_TRANSACTION_ID.test(secureTransactionId) ||
      (mdErrorMessage.present &&
        (typeof mdErrorMessage.value !== 'string' || mdErrorMessage.value.length > MAX_MD_ERROR_MESSAGE_LENGTH))
    ) {
      this.logger.error('3D callback fields are malformed', { order_id: echo(ownValue(callback, 'OrderId')) })
      throw new HashMismatchError('3D callback fields are malformed')
    }
  }

  /**
   * Binds the unsigned echoes of the callback to the order; runs before the provision request. The order number
   * and the amount must be echoed; the currency, merchant and transaction type are compared when the bank sends
   * them.
   */
  private assertCallbackMatchesOrder(callback: GatewayResponseData, order: PosOrder, txType: TxType): void {
    const orderId = String(required(order, 'id'))
    const amount = parseOrderAmount(required(order, 'amount'))
    if (!(amount > 0)) {
      throw new PosError('The order amount must be a positive number.')
    }
    const expectedOrderId = this.#orderIdFormatter.formatOrderId(orderId)
    const expectedAmount = String(this.requestValueFormatter.formatAmount(amount))

    const callbackOrderId = callbackValue(callback, 'OrderId')
    const actualOrderId = callbackOrderId.present ? callbackOrderId.value : undefined
    if (actualOrderId !== expectedOrderId) {
      this.fail('order_id', expectedOrderId, echo(actualOrderId), orderId)
    }

    const callbackAmount = callbackValue(callback, 'Amount')
    const actualAmount = callbackAmount.present ? callbackAmount.value : undefined
    if (actualAmount !== expectedAmount) {
      this.fail('amount', expectedAmount, echo(actualAmount), orderId)
    }

    const currency = callbackValue(callback, 'CurrencyCode')
    if (currency.present && currency.value !== '') {
      const expectedCurrency = order.currency ?? CURRENCY.TRY
      const actualCurrency =
        typeof currency.value === 'string' ? this.#callbackValueMapper.mapCurrency(currency.value, txType) : null
      if (actualCurrency !== expectedCurrency) {
        this.fail('currency', String(expectedCurrency), echo(currency.value), orderId)
      }
    }

    const merchantId = callbackValue(callback, 'MerchantId')
    if (merchantId.present && merchantId.value !== '' && merchantId.value !== this.account.getMerchantId()) {
      this.fail('merchant_id', this.account.getMerchantId(), echo(merchantId.value), orderId)
    }

    const tranType = callbackValue(callback, 'TranType')
    if (tranType.present && tranType.value !== '') {
      const expectedTranType = this.requestValueMapper.mapTxType(txType)
      if (tranType.value !== expectedTranType) {
        this.fail('transaction_type', expectedTranType, echo(tranType.value), orderId)
      }
    }
  }

  private fail(field: OrderMismatchField, expected: string, actual: string, orderId: string): never {
    this.logger.error(`3D callback ${field} does not match the order`, {
      field,
      expected,
      actual,
      order_id: orderId.slice(0, MAX_ECHOED_LENGTH),
    })
    throw new OrderMismatchError(field, expected, actual)
  }
}
