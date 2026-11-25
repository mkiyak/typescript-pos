import { ORDER_ID_LENGTH } from '../data-mapper/request/value-formatter/PosNetPosRequestValueFormatter.js'
import { TX_DECLINED } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
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
import { existingOrderIdOf } from '../util/orderId.js'
import { ownValue } from '../util/ownValue.js'
import { parseInstallment } from '../util/parseInstallment.js'
import { parseOrderAmount } from '../util/parseOrderAmount.js'
import { required } from '../util/required.js'
import { AbstractGateway, type GatewayConfig, type GatewayDeps, type SupportedTransactions } from './AbstractGateway.js'

/** `approved` of a bank answer that accepted the request. */
const APPROVED = '1'

/** The bank's encrypted packets: hex, inserted into the raw request body and into the merchant's page. */
const HEX_PACKET = /^[0-9A-Fa-f]{1,8192}$/

/** Formats of the signed resolve fields; the bank never sends anything else. */
const SIGNED_MD_STATUS = /^[1-4]$/
const SIGNED_AMOUNT = /^\d{1,15}$/
const SIGNED_CURRENCY = /^[A-Z]{2}$/

/** Callback keys and bank values are not ours; only this much of one is echoed in errors and logs. */
const MAX_ECHOED_LENGTH = 64
const MAX_BANK_TEXT_LENGTH = 512

const CALLBACK_PACKETS = ['MerchantPacket', 'BankPacket', 'Sign'] as const

type CallbackPackets = Record<(typeof CALLBACK_PACKETS)[number], string>

/** The resolve request, which only the POSNET request data mapper builds. */
type ResolveRequestDataMapper = {
  create3DResolveMerchantRequestData(
    account: PosNetPosAccount,
    order: PosOrder,
    responseData: Record<string, unknown>,
  ): Record<string, unknown>
}

/** The padded order number, which only the POSNET value formatter builds. */
type OrderIdFormatter = {
  formatOrderId(orderId: string, txType?: TxType | null, orderPaymentModel?: PaymentModel | null): string
}

/** What the bank must resolve for this order, formatted as the bank returns it. */
type ExpectedResolve = { orderId: string; xid: string; amount: string; currency: string; installment: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function ownText(data: Record<string, unknown>, key: string): string | null {
  const value = ownValue(data, key)
  return typeof value === 'string' ? value : null
}

function echo(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_ECHOED_LENGTH) : value === undefined ? '' : typeof value
}

/**
 * Yapı Kredi POSNET (XML service with the OOS 3D Secure flow).
 *
 * 3D Secure runs in three bank requests. The form step sends the card server to server (`oosRequestData`) and
 * builds the bank form from the encrypted packets of the answer, so the card is required even when the form is
 * requested without one. The bank then posts three opaque hex packets (`MerchantPacket`, `BankPacket`, `Sign`) to
 * `success_url`; the browser can replay or swap them, and nothing else in that post is read. `make3DPayment` asks the
 * bank to resolve the packets (`oosResolveMerchantData`) and provisions (`oosTranData`) only when all of this holds:
 * - the callback is a flat record and the three packets are hex strings, checked before any request;
 * - the bank approved the resolve (`approved` 1) and its `mdStatus` is 1 to 4, compared exactly as the response
 *   mapper reads it; any other resolve is mapped without a provision request and must map as declined;
 * - the MAC of the resolved data (mdStatus, order number, amount, currency, merchant and terminal key) verifies.
 *   This check cannot be disabled, and `require_3d_hash` has no effect here because the bank-signed resolve data is
 *   always verified before money moves. A not-successful resolve is not checked: nothing is provisioned and the
 *   bank's failure answers do not carry a usable MAC;
 * - the signed fields are well formed, and the order is bound to the data the bank resolved (never to anything the
 *   browser posted): the padded order number, the amount in kuruş, the currency code and, when the bank sends one,
 *   the installment count must equal the order's (`OrderMismatchError` before the provision request, so no money
 *   has moved and no response is attached).
 *
 * The transaction type is not part of the resolved data: the packets carry the type the form step requested. A
 * replay of the same packets for the same order is refused by the bank on the provision (order number already used).
 */
export class PosNetPos extends AbstractGateway<PosNetPosAccount> {
  static readonly NAME = 'PosNetPos'

  static override readonly GATEWAY_CLASS: string = 'PosNetPos'

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

  readonly #resolveRequestDataMapper: ResolveRequestDataMapper

  readonly #orderIdFormatter: OrderIdFormatter

  /**
   * @throws PosError when the request data mapper cannot build the resolve request or the value formatter cannot
   *   format order numbers
   */
  constructor(config: GatewayConfig, account: PosNetPosAccount, deps: GatewayDeps<PosNetPosAccount>) {
    super(config, account, deps)
    const mapper = deps.requestDataMapper as Partial<ResolveRequestDataMapper>
    if (typeof mapper.create3DResolveMerchantRequestData !== 'function') {
      throw new PosError('PosNetPos needs a request data mapper with create3DResolveMerchantRequestData')
    }
    const formatter = deps.requestValueFormatter as Partial<OrderIdFormatter>
    if (typeof formatter.formatOrderId !== 'function') {
      throw new PosError('PosNetPos needs a request value formatter with formatOrderId')
    }
    this.#resolveRequestDataMapper = deps.requestDataMapper as unknown as ResolveRequestDataMapper
    this.#orderIdFormatter = deps.requestValueFormatter as unknown as OrderIdFormatter
  }

  /**
   * Sends the card and the order to the bank and returns the form with the bank's encrypted packets.
   * `createWithoutCard` has no effect: the card goes from your server to the bank, never to the browser.
   *
   * @throws UnsupportedFormFormatError for `formFormat: 'html'`
   * @throws PosError when the card or `success_url` is missing, the bank refuses the initialization, or its answer
   *   carries no well-formed packets
   */
  async get3DFormData(
    order: PosOrder,
    paymentModel: PaymentModel,
    txType: TxType,
    card: CreditCard | null = null,
    _createWithoutCard = false,
    formFormat: FormFormat | null = null,
  ): Promise<ThreeDFormData> {
    // The card goes to the bank server to server in the initialization request, so it is always required.
    this.check3DFormInputs(paymentModel, txType, card)

    if (formFormat === FORM_FORMAT.HTML) {
      throw new UnsupportedFormFormatError('Unsupported 3D form format!')
    }
    if (card === null) {
      throw new PosError('Card data is required for this payment model')
    }
    // The bank posts every outcome to success_url; check it before asking the bank for anything.
    required(order, 'success_url')

    const requestData = await this.dispatchRequestDataPrepared(
      await this.requestDataMapper.create3DFormInitializeRequestData(this.account, order, paymentModel, txType, card),
      txType,
      order,
      paymentModel,
    )
    const response = await this.sendRequest(txType, paymentModel, requestData, order)

    if (ownValue(response, 'approved') !== APPROVED) {
      this.logger.error('3D initialization failed', { resp_code: ownText(response, 'respCode') })
      const respText = ownText(response, 'respText')
      throw new PosError(
        respText !== null && respText !== ''
          ? respText.slice(0, MAX_BANK_TEXT_LENGTH)
          : 'PosNet 3D initialization failed',
      )
    }

    const packets = this.formPackets(response)
    this.logger.debug('preparing 3D form data')

    return this.requestDataMapper.create3DFormData(
      this.account,
      order,
      paymentModel,
      txType,
      this.get3DGatewayURL(paymentModel),
      null,
      packets,
    ) as Promise<ThreeDFormData>
  }

  /**
   * @throws PosError when the callback is not flat, its packets are missing or malformed, or the order lacks its
   *   id or amount (nothing is sent to the bank)
   * @throws HashMismatchError when the MAC of a successful resolve does not verify or its signed fields are malformed
   * @throws OrderMismatchError when the bank resolved another order, amount, currency or installment count (nothing
   *   is provisioned)
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
    const packets = this.callbackPackets(gatewayResponseData)
    const expected = this.expectedResolve(order)

    this.logger.debug('getting merchant request data')
    const resolveRequest = await this.dispatchRequestDataPrepared(
      this.#resolveRequestDataMapper.create3DResolveMerchantRequestData(this.account, order, packets),
      txType,
      order,
      paymentModel,
    )
    const resolveResponse = await this.sendRequest(txType, paymentModel, resolveRequest, order)

    if (!this.isResolveSuccessful(resolveResponse)) {
      const declined = this.responseDataMapper.map3DPaymentData(resolveResponse, null, txType, order)
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

    const resolved = ownValue(resolveResponse, 'oosResolveMerchantDataResponse')
    if (!isRecord(resolved) || !this.crypt.check3DHash(this.account, resolved as GatewayResponseData)) {
      throw new HashMismatchError('3D resolve response MAC mismatch')
    }
    this.assertSignedFormats(resolved, expected.orderId)
    this.assertResolvedMatchesOrder(resolved, expected)

    const tranRequest = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.create3DPaymentRequestData(this.account, order, txType, packets),
      txType,
      order,
      paymentModel,
    )
    const tranResponse = await this.sendRequest(txType, paymentModel, tranRequest, order)
    this.assertAnswerHasResult(txType, tranResponse)

    const response = this.responseDataMapper.map3DPaymentData(resolveResponse, tranResponse, txType, order)
    this.logger.debug('finished 3D payment', { mapped_response: response })

    return response
  }

  async make3DPayPayment(
    _gatewayResponseData: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
  ): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError('PosNetPos does not support the 3D Pay model')
  }

  async make3DHostPayment(
    _gatewayResponseData: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
  ): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError('PosNetPos does not support the 3D Host model')
  }

  override async orderHistory(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedTransactionTypeError('PosNetPos does not support order history')
  }

  /**
   * The bank approved the resolve and the authentication status allows a provision. The status is the value the
   * response mapper reads, so the decision and the mapped response cannot disagree.
   */
  private isResolveSuccessful(resolveResponse: Record<string, unknown>): boolean {
    const authenticated = this.is3dAuthSuccess(resolveResponse)
    if (ownValue(resolveResponse, 'approved') !== APPROVED) {
      this.logger.error('3D resolve not approved by the bank', {
        resp_code: echo(ownValue(resolveResponse, 'respCode')),
      })

      return false
    }

    return authenticated
  }

  /**
   * A bank callback is a flat form of strings. A nested value could shadow a packet for one reader while another
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

  /** The three packets as own hex strings; they are inserted into the raw request body. */
  private callbackPackets(callback: GatewayResponseData): CallbackPackets {
    const packets: Partial<CallbackPackets> = {}
    for (const key of CALLBACK_PACKETS) {
      const value: unknown = ownValue(callback, key)
      if (typeof value !== 'string' || !HEX_PACKET.test(value)) {
        this.logger.error('3D callback packets are missing or malformed', { field: key, type: typeof value })
        throw new PosError('3D callback packets are missing or malformed')
      }
      packets[key] = value
    }

    return packets as CallbackPackets
  }

  /** The packets of the initialization answer; they end up in the merchant's page, so only hex is accepted. */
  private formPackets(response: Record<string, unknown>): { data1: string; data2: string; sign: string } {
    const data = ownValue(response, 'oosRequestDataResponse')
    if (isRecord(data)) {
      const data1 = ownValue(data, 'data1')
      const data2 = ownValue(data, 'data2')
      const sign = ownValue(data, 'sign')
      if (
        typeof data1 === 'string' &&
        typeof data2 === 'string' &&
        typeof sign === 'string' &&
        HEX_PACKET.test(data1) &&
        HEX_PACKET.test(data2) &&
        HEX_PACKET.test(sign)
      ) {
        return { data1, data2, sign }
      }
    }
    this.logger.error('3D initialization answer is missing or malformed')
    throw new PosError('Unexpected response: oosRequestDataResponse is missing or malformed')
  }

  /**
   * The values the bank must resolve for this order, computed (and the order validated) before any request: the
   * padded order number, the amount in kuruş, the currency code and the installment count.
   */
  private expectedResolve(order: PosOrder): ExpectedResolve {
    const orderId = existingOrderIdOf(order, ORDER_ID_LENGTH)
    const amount = parseOrderAmount(required(order, 'amount'))
    if (!(amount > 0)) {
      throw new PosError('The order amount must be a positive number.')
    }

    return {
      orderId,
      xid: this.#orderIdFormatter.formatOrderId(orderId),
      amount: String(this.requestValueFormatter.formatAmount(amount)),
      currency: String(this.requestValueMapper.mapCurrency(order.currency ?? CURRENCY.TRY)),
      installment: String(this.requestValueFormatter.formatInstallment(parseInstallment(order.installment))),
    }
  }

  /**
   * The signed fields must have the only formats the bank uses. With a valid MAC this rules out values that were
   * never produced by the bank's resolve of a real 3D session.
   */
  private assertSignedFormats(resolved: Record<string, unknown>, orderId: string): void {
    const mdStatus = ownText(resolved, 'mdStatus')
    const amount = ownText(resolved, 'amount')
    const currency = ownText(resolved, 'currency')
    if (
      mdStatus === null ||
      !SIGNED_MD_STATUS.test(mdStatus) ||
      amount === null ||
      !SIGNED_AMOUNT.test(amount) ||
      currency === null ||
      !SIGNED_CURRENCY.test(currency)
    ) {
      this.logger.error('3D resolve response fields are malformed', { order_id: orderId.slice(0, MAX_ECHOED_LENGTH) })
      throw new HashMismatchError('3D resolve response fields are malformed')
    }
  }

  /** Binds the order to what the bank resolved from the packets; runs before the provision request. */
  private assertResolvedMatchesOrder(resolved: Record<string, unknown>, expected: ExpectedResolve): void {
    const xid = ownValue(resolved, 'xid')
    if (xid !== expected.xid) {
      this.fail('order_id', expected.xid, echo(xid), expected.orderId)
    }

    const amount = ownValue(resolved, 'amount')
    if (amount !== expected.amount) {
      this.fail('amount', expected.amount, echo(amount), expected.orderId)
    }

    const currency = ownValue(resolved, 'currency')
    if (currency !== expected.currency) {
      this.fail('currency', expected.currency, echo(currency), expected.orderId)
    }

    // The installment count is not signed; the bank leaves it empty on some answers.
    const installment = ownValue(resolved, 'installment')
    if (installment !== undefined && installment !== '' && installment !== expected.installment) {
      this.fail('installment', expected.installment, echo(installment), expected.orderId)
    }
  }

  private fail(field: OrderMismatchField, expected: string, actual: string, orderId: string): never {
    this.logger.error(`3D resolve ${field} does not match the order`, {
      field,
      expected,
      actual,
      order_id: orderId.slice(0, MAX_ECHOED_LENGTH),
    })
    throw new OrderMismatchError(field, expected, actual)
  }
}
