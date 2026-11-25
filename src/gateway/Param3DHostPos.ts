import type { AbstractHttpClient } from '../client/AbstractHttpClient.js'
import { ParamPosHttpClient } from '../client/ParamPosHttpClient.js'
import { orderValue, readOrderId } from '../data-mapper/request/mapper/paramRequestFields.js'
import { isRecord, ownString } from '../data-mapper/response/mapper/paramResponseFields.js'
import { TX_APPROVED, TX_DECLINED } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
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
import type { ParamPosAccount } from '../model/account/ParamPosAccount.js'
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
import { parseInstallment } from '../util/parseInstallment.js'
import { parseOrderAmount } from '../util/parseOrderAmount.js'
import { toKurus } from '../util/toKurus.js'
import { AbstractGateway, type GatewayConfig, type GatewayDeps, type SupportedTransactions } from './AbstractGateway.js'
import {
  approvalFieldsMalformed,
  callbackCode,
  callbackHash,
  callbackShape,
  confirmedResult,
  echo,
  flatCallback,
  paramRecordConfirms,
  reportsApproval,
  trustedDecline,
} from './paramCallback.js'

/** The request the confirmation of a hosted payment is built with. */
type ConfirmationRequestDataMapper = {
  createConfirmationRequestData(account: ParamPosAccount, siparisId: string): Record<string, unknown>
}

/** The id the hosted payment was registered with, derived from the order. */
type TransactionIdCrypt = {
  create3DHostTransactionId(account: ParamPosAccount, orderId: string, kurus: number, currencyCode: string): string
}

/** The order values every check compares with, read before the callback is. */
type OrderExpectations = {
  orderId: string
  /** The amount as the caller gave it (validated). */
  amount: number
  /** The amount in kuruş. */
  kurus: number
  /** The installment count, one counting as none (0). */
  installment: number
  currency: string
  /** The bank's code of the currency (`1000` for Turkish lira). */
  currencyCode: string
}

const UNKNOWN_STATUS_OUTCOME = 'Bank status answer could not be read; the payment outcome is unknown'
const OTHER_MODEL = 'Use ParamPos for this payment model'
const OTHER_TRANSACTION = 'Use ParamPos for this transaction'

/**
 * Param (TURK Elektronik Para) hosted collection page: the merchant registers the payment (no card data, a SOAP
 * header carries the account) and sends the payer's browser to the bank's page with the encrypted value the bank
 * returns; the bank charges the card there and posts the payment result to the merchant. Only sales; every other
 * model and transaction is `ParamPos`.
 *
 * The registration carries no order id. The merchant's transaction id it carries (`Islem_ID`) is derived from the
 * order id, the amount in kuruş and the currency with a key stretched from the API password, so it is the only link
 * between the bank's record of the payment and the order that this server chose; it is recomputed when the payer
 * returns, without stored state.
 *
 * The payment result callback is signed with base64 SHA-1 over the client code, the merchant GUID, the receipt
 * number, the collected amount, the bank's order id and the transaction id, and echoes the merchant GUID it is
 * signed with: anyone who has seen one callback of this merchant can sign any other. A valid signature therefore
 * proves nothing on its own:
 * - A callback is a flat form of strings (any other value at its top level is a `PosError`) and must be a payment
 *   result; a card-check callback is a `PosError`. Then the order is validated (id, amount, installment, currency),
 *   so a bad order fails while nothing was read or sent.
 * - The signature check cannot be switched off (`disable_3d_hash_check` is ignored). A present signature is always
 *   verified first, also on a decline; a mismatch is a `HashMismatchError`. A callback without a signature is rejected
 *   (`HashMismatchError`) when `require_3d_hash` is set and whenever it reads as an approval (a result code or receipt
 *   number above zero, padding ignored).
 * - Every decline, signed or not, returns a result built from trusted data only: the order's id, the call's
 *   transaction type and payment model, the bank's result code and text (bounded); every other value is null and
 *   `all` keeps the raw callback without the echoed GUID. A decline is never flagged for manual review, and a decline
 *   whose mapping reads approved is a `PosError`.
 * - An approval has its signed fields pinned to their exact formats (the values run together without separators),
 *   otherwise `HashMismatchError('3D callback fields are malformed')`. The bank assigns the order id of a hosted
 *   payment, so the callback's order id is not compared with the order; it only names the record to look up.
 * - Every approval is confirmed with exactly one status request to the TurkPos service (the `query_api` endpoint)
 *   for the bank's order id, before it is returned. The bank's record must name that order id, hold the transaction
 *   id derived from this order, amount and currency (the binding to this order), show a successful sale with the
 *   reported receipt, the order amount in exact kuruş, nothing refunded and the order's installment count (one
 *   counting as none); it carries no currency. A record that does not confirm (a failure code, a list of records, or
 *   a record that differs) is an `OrderMismatchError`; a status answer that cannot be read (empty, no result, no
 *   integer result code, a success code without a record) is a `PosHttpError` naming the URL, since the payment may
 *   have completed. The result is attached and flagged for manual review only when the record shows a successful
 *   payment with a receipt: a callback anyone could forge raises no alert by itself. Errors of the status request
 *   propagate (the payment may have completed: look it up with `ParamPos.status` before retrying).
 * - If the TurkPos service does not list hosted payments, or lists them under another order id or transaction id,
 *   no approval can be confirmed: every hosted approval then fails closed with an `OrderMismatchError` (and no
 *   payment is ever reported approved without the bank's record).
 * - A confirmed result takes its order id, amount and currency from the order and its authorization code, host
 *   reference, transaction id, card mask, installment count and time from the bank's record, never from the callback.
 *   The echoed GUID never appears in returned data or attached results.
 * - The callback reports no separate 3D result, so a payment approved although 3D Secure failed cannot be seen here.
 */
export class Param3DHostPos extends AbstractGateway<ParamPosAccount> {
  static readonly NAME = 'Param3DHostPos'

  static override readonly GATEWAY_CLASS: string = 'Param3DHostPos'

  protected static override readonly testModeAffectsRequests: boolean = false

  protected static override supportedTransactions: SupportedTransactions = {
    [TX_TYPE.PAY_AUTH]: [MODEL.THREE_D_HOST],
    [TX_TYPE.ORDER_HISTORY]: false,
    [TX_TYPE.PAY_POST_AUTH]: false,
    [TX_TYPE.CANCEL]: false,
    [TX_TYPE.REFUND]: false,
    [TX_TYPE.REFUND_PARTIAL]: false,
    [TX_TYPE.STATUS]: false,
  }

  readonly #confirmationRequestDataMapper: ConfirmationRequestDataMapper
  readonly #transactionIdCrypt: TransactionIdCrypt

  /**
   * @throws PosError when the request data mapper cannot build the confirmation request or the crypt cannot derive
   *   the transaction id
   */
  constructor(config: GatewayConfig, account: ParamPosAccount, deps: GatewayDeps<ParamPosAccount>) {
    super(config, account, deps)
    const mapper = deps.requestDataMapper as Partial<ConfirmationRequestDataMapper>
    if (typeof mapper.createConfirmationRequestData !== 'function') {
      throw new PosError('Param3DHostPos needs a request data mapper with createConfirmationRequestData')
    }
    const crypt = deps.crypt as Partial<TransactionIdCrypt>
    if (typeof crypt.create3DHostTransactionId !== 'function') {
      throw new PosError('Param3DHostPos needs a crypt with create3DHostTransactionId')
    }
    this.#confirmationRequestDataMapper = deps.requestDataMapper as unknown as ConfirmationRequestDataMapper
    this.#transactionIdCrypt = deps.crypt as unknown as TransactionIdCrypt
  }

  /**
   * Registers the payment with the bank and returns the GET form that sends the payer's browser to the hosted page
   * (`gateway_3d_host`) with the bank's encrypted value. No card data is involved.
   *
   * @throws UnsupportedFormFormatError for `formFormat: 'html'`
   * @throws MissingAccountInfoError when the account has no terminal id
   * @throws PosError when the order is malformed, or the bank refuses the registration (its text masked and
   *   shortened) or answers without a result
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

    if (formFormat === FORM_FORMAT.HTML) {
      throw new UnsupportedFormFormatError('Unsupported 3D form format!')
    }

    const requestTxType = TX_TYPE.INTERNAL_3D_FORM_BUILD
    const requestData = await this.dispatchRequestDataPrepared(
      await this.requestDataMapper.create3DFormInitializeRequestData(this.account, order, paymentModel, txType),
      requestTxType,
      order,
      paymentModel,
    )
    const answer = await this.sendRequest(requestTxType, paymentModel, requestData, order)

    return this.requestDataMapper.create3DFormData(
      this.account,
      order,
      paymentModel,
      txType,
      this.get3DGatewayURL(paymentModel),
      null,
      answer,
    )
  }

  /** @throws UnsupportedPaymentModelError 3D Secure is `ParamPos` */
  async make3DPayment(
    _gatewayResponseData: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
    _card: CreditCard | null = null,
  ): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError(OTHER_MODEL)
  }

  /** @throws UnsupportedPaymentModelError 3D Pay is `ParamPos` */
  async make3DPayPayment(
    _gatewayResponseData: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
  ): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError(OTHER_MODEL)
  }

  /**
   * Completes a hosted payment from the bank's payment result callback (see the class description).
   *
   * @throws PosError when the callback is not a flat form of strings or not a payment result, or the order is malformed
   * @throws UnsupportedTransactionTypeError for anything but a sale
   * @throws HashMismatchError when a present hash does not verify, a required hash is missing, or the signed fields of
   *   an approval are malformed
   * @throws OrderMismatchError when the bank's status record does not confirm the approval for this order (result
   *   attached and flagged only when the record shows a payment)
   * @throws PosHttpError when the status answer cannot be read or the status request fails (outcome unknown)
   */
  async make3DHostPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
  ): Promise<PosResponse> {
    const paymentModel = MODEL.THREE_D_HOST
    const callback = flatCallback(gatewayResponseData, this.logger)
    if (callbackShape(callback) !== 'turkpos') {
      this.logger.error('3D callback does not fit the payment model', { payment_model: paymentModel, shape: 'md' })
      throw new PosError('Unexpected 3D callback for this payment model')
    }
    if (txType !== TX_TYPE.PAY_AUTH) {
      throw new UnsupportedTransactionTypeError(`Unsupported transaction type: ${String(txType)}`)
    }
    // Every order value the callback and the bank's record are compared with fails here, before anything is read.
    const expected = this.orderExpectations(order)

    if (callbackHash(callback, 'turkpos') !== undefined) {
      if (!this.crypt.check3DHash(this.account, callback as GatewayResponseData)) {
        throw new HashMismatchError('3D callback hash mismatch')
      }
    } else if (reportsApproval(callback, 'turkpos') || this.config.require_3d_hash === true) {
      this.logger.error('3D callback has no hash', { order_id: echo(expected.orderId) })
      throw new HashMismatchError('3D callback has no hash')
    }

    const mapped = this.responseDataMapper.map3DHostResponseData(callback, txType, order)
    if (!reportsApproval(callback, 'turkpos')) {
      if (mapped.status !== TX_DECLINED) {
        // The approval would skip the field pins and the bank's confirmation.
        this.logger.error('3D callback without approval was mapped as approved', { order_id: echo(expected.orderId) })
        throw new PosError('3D callback without approval was mapped as approved')
      }

      return trustedDecline(mapped, callback, 'turkpos', expected.orderId, txType, paymentModel)
    }

    const malformed = approvalFieldsMalformed(callback, 'turkpos')
    if (malformed.length > 0) {
      this.logger.error('3D callback fields are malformed', { order_id: echo(expected.orderId), fields: malformed })
      throw new HashMismatchError('3D callback fields are malformed')
    }
    if (mapped.status !== TX_APPROVED) {
      this.logger.error('3D callback approval was not mapped as approved', { order_id: echo(expected.orderId) })
      throw new PosError('3D callback approval was not mapped as approved')
    }

    return this.confirmWithStatus(callback, expected, txType, mapped)
  }

  /** @throws UnsupportedPaymentModelError non-secure payments are `ParamPos` */
  override async makeRegularPayment(_order: PosOrder, _card: CreditCard, _txType: TxType): Promise<PosResponse> {
    throw new UnsupportedPaymentModelError(OTHER_MODEL)
  }

  /** @throws UnsupportedTransactionTypeError post-authorization is `ParamPos` */
  override async makeRegularPostPayment(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedTransactionTypeError(OTHER_TRANSACTION)
  }

  /** @throws UnsupportedTransactionTypeError status is `ParamPos` (same account, the `param-pos` bank entry) */
  override async status(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedTransactionTypeError(OTHER_TRANSACTION)
  }

  /** @throws UnsupportedTransactionTypeError cancel is `ParamPos` */
  override async cancel(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedTransactionTypeError(OTHER_TRANSACTION)
  }

  /** @throws UnsupportedTransactionTypeError refund is `ParamPos` */
  override async refund(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedTransactionTypeError(OTHER_TRANSACTION)
  }

  /** @throws UnsupportedTransactionTypeError Param has no order history request */
  override async orderHistory(_order: PosOrder): Promise<PosResponse> {
    throw new UnsupportedTransactionTypeError(OTHER_TRANSACTION)
  }

  /**
   * Exactly one status request for the bank's order id; the approval stands only when the bank's record confirms it
   * for this order (see the class description). The references of the result come from the record.
   */
  private async confirmWithStatus(
    callback: Record<string, unknown>,
    expected: OrderExpectations,
    txType: TxType,
    mapped: PosResponse,
  ): Promise<PosResponse> {
    const paymentModel = MODEL.THREE_D_HOST
    const siparisId = ownString(callback, 'TURKPOS_RETVAL_Siparis_ID') ?? ''
    const islemId = this.#transactionIdCrypt.create3DHostTransactionId(
      this.account,
      expected.orderId,
      expected.kurus,
      expected.currencyCode,
    )
    const statusOrder: PosOrder = { id: siparisId }
    const requestData = await this.dispatchRequestDataPrepared(
      this.#confirmationRequestDataMapper.createConfirmationRequestData(this.account, siparisId),
      TX_TYPE.STATUS,
      statusOrder,
      paymentModel,
    )
    const client = this.getClient(TX_TYPE.STATUS, paymentModel)
    const answer = await client.request(TX_TYPE.STATUS, paymentModel, requestData, statusOrder, null)
    const check = paramRecordConfirms(answer, {
      siparisId,
      dekont: ownString(callback, 'TURKPOS_RETVAL_Dekont_ID') ?? '',
      kurus: expected.kurus,
      installment: expected.installment,
      transactionType: 'SALE',
      islemId,
    })
    const values = {
      order: { orderId: expected.orderId, amount: expected.amount, currency: expected.currency },
      paymentModel,
      txType,
      code: callbackCode(callback, 'turkpos'),
      mdStatus: null,
      record: check.record,
      transactionTime: null,
      all: callback,
      threeDAll: null,
    }

    if (check.unreadable) {
      // The answer says nothing about the payment, which may have completed: look it up before retrying.
      this.logger.error('bank status answer could not be read', { order_id: echo(expected.orderId) })
      throw new PosHttpError(UNKNOWN_STATUS_OUTCOME, { url: this.requestUrl(client, paymentModel) })
    }
    if (check.failure !== null) {
      const [field, wanted, actual] = check.failure
      if (check.evidence) {
        this.fail(field, wanted, actual, expected.orderId, {
          ...confirmedResult(mapped, values),
          requires_manual_review: true,
        })
      }
      // A payment result anyone could forge must not raise payment alerts.
      this.fail(field, wanted, actual, expected.orderId)
    }

    const status = this.responseDataMapper.mapStatusResponse(answer)
    const time = isRecord(status) && status.transaction_time instanceof Date ? status.transaction_time : null
    this.logger.info('payment confirmed by the bank status record', { order_id: echo(expected.orderId) })

    return confirmedResult(mapped, { ...values, transactionTime: time })
  }

  /** The URL a confirmation was posted to. */
  private requestUrl(client: AbstractHttpClient, paymentModel: PaymentModel): string {
    return client instanceof ParamPosHttpClient
      ? client.getApiUrl(TX_TYPE.STATUS, paymentModel)
      : (this.config.gateway_endpoints.query_api ?? this.config.gateway_endpoints.payment_api)
  }

  /**
   * The order values every check compares with, read once before the callback is: the order id, the amount (and in
   * kuruş), the installment count and the currency with its bank code. A value the bank cannot have been sent is a
   * `PosError`.
   */
  private orderExpectations(order: PosOrder): OrderExpectations {
    const orderId = readOrderId(order)
    const amount = parseOrderAmount(orderValue(order, 'amount'))
    const kurus = toKurus(amount)
    const count = parseInstallment(orderValue(order, 'installment'))
    const currency: unknown = orderValue(order, 'currency') ?? CURRENCY.TRY
    if (typeof currency !== 'string') {
      throw new PosError('The order currency must be text.')
    }
    const currencyCode = String(this.requestValueMapper.mapCurrency(currency as Currency))

    return { orderId, amount, kurus, installment: count <= 1 ? 0 : count, currency, currencyCode }
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
