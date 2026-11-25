import type { AbstractHttpClient } from '../client/AbstractHttpClient.js'
import type { HttpClientStrategy } from '../client/HttpClientStrategy.js'
import type { CryptInterface } from '../crypt/CryptInterface.js'
import type { RequestDataMapperInterface } from '../data-mapper/request/mapper/RequestDataMapperInterface.js'
import type { RequestValueFormatterInterface } from '../data-mapper/request/value-formatter/RequestValueFormatterInterface.js'
import type { RequestValueMapperInterface } from '../data-mapper/request/value-mapper/RequestValueMapperInterface.js'
import type { ResponseDataMapperInterface } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { PosError, PosHttpError, UnsupportedPaymentModelError, UnsupportedTransactionTypeError } from '../errors.js'
import { prepareRequestDataWithHooks } from '../hooks.js'
import { createSafeLogger, type PosLogger } from '../logger.js'
import type { AbstractPosAccount } from '../model/account/AbstractPosAccount.js'
import type { CreditCard } from '../model/card/CreditCard.js'
import {
  type Currency,
  type FormFormat,
  type Lang,
  MODEL,
  type PaymentModel,
  TX_TYPE,
  type TxType,
} from '../PosInterface.js'
import type {
  GatewayResponseData,
  PosHooks,
  PosOrder,
  PosResponse,
  RequestDataPreparedEvent,
  ThreeDFormData,
} from '../types.js'

export type GatewayConfig = {
  name: string
  /** Gateway class name, e.g. 'AssecoPos'. */
  class: string
  gateway_endpoints: {
    payment_api: string
    gateway_3d?: string
    gateway_3d_host?: string
    query_api?: string
  }
  test_mode?: boolean
  lang?: Lang
  /**
   * PayFlex V4: reject a 3D callback that carries no `Hash` (`HashMismatchError`). Default false, because not every
   * VakifBank merchant receives a signed callback yet; enable it when yours does.
   *
   * Without a signed callback (`require_3d_hash: false` and no `Hash`), the order-binding guard compares
   * browser-supplied values and only stops naive replays; enable `require_3d_hash` once your bank sends `Hash`.
   *
   * Garanti 3D Pay: reject a callback that carries no `hash` (`HashMismatchError`). Default false, because the
   * bank sends some error callbacks unsigned; without it an unsigned callback is accepted only when it maps as
   * declined and its `procreturncode` is not `00`.
   *
   * AkbankPos: no effect. The bank signs every callback; a 3D Pay / 3D Host callback without a valid hash is always
   * rejected, and an unsigned 3D Secure callback is accepted only as a decline (nothing is provisioned).
   *
   * PosNetPos: no effect. The browser callback carries only the bank's encrypted packets, which nothing on the
   * merchant side can verify; the data the bank resolves from them is always MAC-verified before a provision.
   *
   * PosNetV1Pos: reject a declined 3D callback that carries no `Mac` (`HashMismatchError`). Default false: without
   * it an unsigned callback is accepted only as a decline (nothing is provisioned). A successful callback must
   * always carry a valid `Mac`, and a `Mac` on a declined callback must always verify.
   *
   * PayForPos: reject any 3D callback that carries no `ResponseHash` (`HashMismatchError`). Default false: without
   * it an unsigned declined callback is mapped as declined, an unsigned successful callback is rejected for QNB
   * Finansbank (which signs every callback) and, for other institutions such as Ziraat Katilim, never approves a
   * payment by itself (the bank's status record decides). Whatever this flag says, an unsigned 3D Secure callback
   * of an institution other than QNB Finansbank is always rejected, declines included. A present `ResponseHash` is
   * always verified.
   *
   * InterPos: reject any 3D callback that carries no `HASH` (`HashMismatchError`), declines included. Default false:
   * without it an unsigned callback is accepted only as a decline whose result carries the order's id and bounded
   * decline reasons (nothing is provisioned, confirmed or flagged for review); an unsigned callback that reports 3D
   * success or an approval is always rejected. A present `HASH` is always verified, for every payment model.
   *
   * KuveytPos: reject any 3D callback that carries no `HashData` (`HashMismatchError`), declines included. Default
   * false: without it an unsigned callback is accepted only as a decline whose result carries the order's id and
   * bounded decline reasons (nothing is provisioned or flagged for review); an unsigned callback with response code
   * `00` is always rejected. A present `HashData` is always verified.
   *
   * VakifKatilimPos: reject any 3D Secure or 3D Host callback that carries no `HashData` (`HashMismatchError`),
   * declines included. Default false: without it an unsigned callback is accepted only as a decline whose result
   * carries the order's id and bounded decline reasons (nothing is provisioned, confirmed or flagged for review); an
   * unsigned callback with response code `00` is always rejected. A present `HashData` is always verified. A signed
   * 3D Host approval still proves nothing by itself (the browser receives the hashed password with the form), so it
   * is always confirmed with the bank's status record.
   *
   * ToslaPos: reject any 3D Pay or 3D Host callback that carries no `Hash` (`HashMismatchError`), declines included.
   * Default false: without it an unsigned callback is accepted only as a decline whose result carries the order's id
   * and bounded decline reasons (nothing is confirmed or flagged for review); an unsigned callback whose response
   * code, 3D result or request status reads as an approval is always rejected. A present `Hash` is always verified,
   * and every signed approval is still confirmed with the bank's status record, since the signature covers no amount.
   *
   * ParamPos: reject any 3D callback that carries no `islemHash` (3D Secure card check) or `TURKPOS_RETVAL_Hash` (3D
   * Pay, foreign currency) (`HashMismatchError`), declines included. Default false: without it an unsigned callback is
   * accepted only as a decline whose result carries the order's id and bounded decline reasons (nothing is
   * provisioned, confirmed or flagged for review); an unsigned callback whose 3D result is `1`, or whose result code
   * or receipt number is above zero, is always rejected. A present hash is always verified. The payment result
   * callback carries the merchant GUID it is signed with, so a valid signature proves nothing by itself: every
   * approval is confirmed with the bank's status record (after the provision, for the card check).
   *
   * Param3DHostPos: reject a hosted page callback that carries no `TURKPOS_RETVAL_Hash` (`HashMismatchError`),
   * declines included. Default false: without it an unsigned callback is accepted only as a decline whose result
   * carries the order's id and bounded decline reasons (nothing is confirmed or flagged for review); an unsigned
   * callback whose result code or receipt number is above zero is always rejected. A present hash is always verified.
   * The callback carries the merchant GUID it is signed with, so a valid signature proves nothing by itself: every
   * approval is confirmed with the bank's status record (TurkPos `query_api`), which must hold the transaction id
   * derived from this order, amount and currency.
   *
   * PayTrPos: no effect on the 3D Host / 3D Pay notification that PayTR posts to the notification URL: it always
   * carries a `hash`, which is always verified. With `true`, a browser return without `hash` (the fail page's
   * `fail_message`) is rejected too (`HashMismatchError`); without it such a body maps only as a decline whose result
   * carries the order's id and the failure text. An unsigned body that reads as an approval (a status `success` or a
   * positive total amount) is always rejected.
   *
   * IyzicoPos: 3D Secure: with `true` a callback without `signature` is rejected (`HashMismatchError`), declines
   * included; without it an unsigned callback maps only as a decline carrying the order's id. An unsigned callback
   * whose status or mdStatus reads as success is always rejected, and a present `signature` is always verified. 3D
   * Host: no effect: the callback carries only a token, and the result is always read from iyzico's signed checkout
   * record.
   */
  require_3d_hash?: boolean
}

export type GatewayDeps<A extends AbstractPosAccount = AbstractPosAccount> = {
  requestValueMapper: RequestValueMapperInterface
  requestValueFormatter: RequestValueFormatterInterface
  requestDataMapper: RequestDataMapperInterface<A>
  responseDataMapper: ResponseDataMapperInterface
  crypt: CryptInterface<A>
  clientStrategy: HttpClientStrategy
  logger: PosLogger
  hooks: PosHooks
}

/** `true`/`false` for all payment models, or the list of supported models. */
export type SupportedTransactions = Partial<Record<TxType, readonly PaymentModel[] | boolean>>

/**
 * Base gateway. Every network method is async and returns its mapped response (no `isSuccess()` /
 * `getResponse()` state), so one instance can serve concurrent requests; `onRequestDataPrepared` hooks can inspect
 * or change outgoing data; the 3D hash check cannot be disabled.
 */
export abstract class AbstractGateway<A extends AbstractPosAccount = AbstractPosAccount> {
  /**
   * Stable gateway class identifier (e.g. 'AssecoPos', matching `GatewayConfig.class`), reported as `gatewayClass`
   * in hook events. Every concrete gateway must define it; `constructor.name` is not used
   * because minifiers rename classes.
   */
  static readonly GATEWAY_CLASS: string = ''

  /** Subclasses declare their supported transactions table. */
  protected static supportedTransactions: SupportedTransactions = {}

  protected static readonly threeDPaymentModels: readonly PaymentModel[] = [
    MODEL.THREE_D_SECURE,
    MODEL.THREE_D_PAY,
    MODEL.THREE_D_HOST,
    MODEL.THREE_D_PAY_HOSTING,
  ]

  protected static readonly paymentModelsWithCard: readonly PaymentModel[] = [
    MODEL.NON_SECURE,
    MODEL.THREE_D_SECURE,
    MODEL.THREE_D_PAY,
  ]

  /**
   * Whether `test_mode` changes the request payload for this gateway. When false, test vs production is
   * controlled solely by the endpoint URLs in the config.
   */
  protected static readonly testModeAffectsRequests: boolean = false

  protected readonly requestValueMapper: RequestValueMapperInterface
  protected readonly requestValueFormatter: RequestValueFormatterInterface
  protected readonly requestDataMapper: RequestDataMapperInterface<A>
  protected readonly responseDataMapper: ResponseDataMapperInterface
  protected readonly crypt: CryptInterface<A>
  protected readonly clientStrategy: HttpClientStrategy
  protected readonly logger: PosLogger
  protected readonly hooks: PosHooks

  readonly #testMode: boolean

  constructor(
    protected readonly config: GatewayConfig,
    protected readonly account: A,
    deps: GatewayDeps<A>,
  ) {
    if (this.gatewayClass().GATEWAY_CLASS === '') {
      throw new PosError(`${this.constructor.name} must define a non-empty static GATEWAY_CLASS.`)
    }

    this.requestValueMapper = deps.requestValueMapper
    this.requestValueFormatter = deps.requestValueFormatter
    this.requestDataMapper = deps.requestDataMapper
    this.responseDataMapper = deps.responseDataMapper
    this.crypt = deps.crypt
    this.clientStrategy = deps.clientStrategy
    this.logger = createSafeLogger(deps.logger)
    this.hooks = deps.hooks

    this.#testMode = config.test_mode ?? false
    if (config.test_mode !== undefined) {
      this.applyTestMode(config.test_mode)
    }
  }

  // ---- abstract (gateway specific) ----

  /**
   * Builds the 3D form data (or an HTML form string for gateways that support `formFormat: 'html'`).
   *
   * @param createWithoutCard build the form without card data (card details are entered on the bank page)
   */
  abstract get3DFormData(
    order: PosOrder,
    paymentModel: PaymentModel,
    txType: TxType,
    card?: CreditCard | null,
    createWithoutCard?: boolean,
    formFormat?: FormFormat | null,
  ): Promise<ThreeDFormData | string>

  /** Completes a 3D Secure payment from the bank callback (hash check, then provision request). */
  abstract make3DPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
    card?: CreditCard | null,
  ): Promise<PosResponse>

  /** Maps a 3D Pay / 3D Pay Hosting callback (hash check, no provision request). */
  abstract make3DPayPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
  ): Promise<PosResponse>

  /** Maps a 3D Host callback (hash check, no provision request). */
  abstract make3DHostPayment(
    gatewayResponseData: GatewayResponseData,
    order: PosOrder,
    txType: TxType,
  ): Promise<PosResponse>

  // ---- payment entry points ----

  async payment(
    paymentModel: PaymentModel,
    order: PosOrder,
    txType: TxType,
    card: CreditCard | null = null,
    gatewayResponseData: GatewayResponseData | null = null,
  ): Promise<PosResponse> {
    this.logger.debug('payment called', { card_provided: card !== null, tx_type: txType, model: paymentModel })

    if (!this.gatewayClass().isSupportedTransaction(txType, paymentModel)) {
      throw new UnsupportedTransactionTypeError(
        `${this.gatewayClassName()} does not support transaction type [${txType}] with payment model [${paymentModel}].`,
      )
    }

    if (txType === TX_TYPE.PAY_POST_AUTH) {
      return this.makeRegularPostPayment(order)
    }

    if (paymentModel === MODEL.NON_SECURE) {
      if (card === null) {
        throw new PosError('Credit card data is required for this transaction.')
      }

      return this.makeRegularPayment(order, card, txType)
    }

    if (gatewayResponseData === null || Object.keys(gatewayResponseData).length === 0) {
      throw new PosError('3D auth response data from the bank is required for 3D payment models.')
    }

    if (paymentModel === MODEL.THREE_D_SECURE) {
      return this.make3DPayment(gatewayResponseData, order, txType, card)
    }

    if (paymentModel === MODEL.THREE_D_PAY || paymentModel === MODEL.THREE_D_PAY_HOSTING) {
      return this.make3DPayPayment(gatewayResponseData, order, txType)
    }

    if (paymentModel === MODEL.THREE_D_HOST) {
      return this.make3DHostPayment(gatewayResponseData, order, txType)
    }

    this.logger.error('unsupported payment model', { model: paymentModel })
    throw new UnsupportedPaymentModelError(`Unsupported payment model: ${paymentModel}`)
  }

  /**
   * Non-secure sale or pre-authorization.
   *
   * @throws PosHttpError when the bank's answer carries no result: the payment may have gone through, check `status`
   *   before any retry
   */
  async makeRegularPayment(order: PosOrder, card: CreditCard, txType: TxType): Promise<PosResponse> {
    const paymentModel = MODEL.NON_SECURE
    this.logger.debug('making payment', { model: paymentModel, tx_type: txType })
    if (txType !== TX_TYPE.PAY_AUTH && txType !== TX_TYPE.PAY_PRE_AUTH) {
      throw new UnsupportedTransactionTypeError(`Invalid transaction type "${txType}" provided`)
    }

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createNonSecurePaymentRequestData(this.account, order, txType, card),
      txType,
      order,
      paymentModel,
    )
    const bankResponse = await this.sendRequest(txType, paymentModel, requestData, order)
    this.assertAnswerHasResult(txType, bankResponse)

    return this.responseDataMapper.mapPaymentResponse(bankResponse, txType, order)
  }

  /**
   * Post-authorization (capture) of a pre-authorized order.
   *
   * @throws PosHttpError when the bank's answer carries no result: the capture may have gone through, check `status`
   *   before any retry
   */
  async makeRegularPostPayment(order: PosOrder): Promise<PosResponse> {
    const txType = TX_TYPE.PAY_POST_AUTH
    const paymentModel = MODEL.NON_SECURE
    this.logger.debug('making payment', { model: paymentModel, tx_type: txType })

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createNonSecurePostAuthPaymentRequestData(this.account, order),
      txType,
      order,
      paymentModel,
    )
    const bankResponse = await this.sendRequest(txType, paymentModel, requestData, order)
    this.assertAnswerHasResult(txType, bankResponse)

    return this.responseDataMapper.mapPaymentResponse(bankResponse, txType, order)
  }

  // ---- non-payment transactions ----

  /**
   * Full refund, or partial refund when `order.order_amount` is set and `order.amount` is lower.
   *
   * @throws PosHttpError when the bank's answer carries no result: the refund may have gone through, check `status`
   *   before any retry
   */
  async refund(order: PosOrder): Promise<PosResponse> {
    const paymentModel = MODEL.NON_SECURE
    let txType: TxType = TX_TYPE.REFUND
    const orderAmount = order.order_amount
    if (orderAmount !== undefined && orderAmount !== null && Number(order.amount) < Number(orderAmount)) {
      txType = TX_TYPE.REFUND_PARTIAL
    }

    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createRefundRequestData(this.account, order, txType),
      txType,
      order,
      paymentModel,
    )
    const bankResponse = await this.sendRequest(txType, paymentModel, requestData, order)
    this.assertAnswerHasResult(txType, bankResponse)

    return this.responseDataMapper.mapRefundResponse(bankResponse)
  }

  async cancel(order: PosOrder): Promise<PosResponse> {
    const txType = TX_TYPE.CANCEL
    const paymentModel = MODEL.NON_SECURE
    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createCancelRequestData(this.account, order),
      txType,
      order,
      paymentModel,
    )
    const bankResponse = await this.sendRequest(txType, paymentModel, requestData, order)

    return this.responseDataMapper.mapCancelResponse(bankResponse)
  }

  async status(order: PosOrder): Promise<PosResponse> {
    const txType = TX_TYPE.STATUS
    const paymentModel = MODEL.NON_SECURE
    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createStatusRequestData(this.account, order),
      txType,
      order,
      paymentModel,
    )
    const bankResponse = await this.sendRequest(txType, paymentModel, requestData, order)

    return this.responseDataMapper.mapStatusResponse(bankResponse)
  }

  async orderHistory(order: PosOrder): Promise<PosResponse> {
    const txType = TX_TYPE.ORDER_HISTORY
    const paymentModel = MODEL.NON_SECURE
    const requestData = await this.dispatchRequestDataPrepared(
      this.requestDataMapper.createOrderHistoryRequestData(this.account, order),
      txType,
      order,
      paymentModel,
    )
    const bankResponse = await this.sendRequest(txType, paymentModel, requestData, order)

    return this.responseDataMapper.mapOrderHistoryResponse(bankResponse)
  }

  // ---- sync accessors ----

  isTestMode(): boolean {
    return this.#testMode
  }

  getAccount(): A {
    return this.account
  }

  getCrypt(): CryptInterface<A> {
    return this.crypt
  }

  getCardTypeMapping(): Record<string, string> {
    return this.requestValueMapper.getCardTypeMappings()
  }

  getCurrencies(): Currency[] {
    return Object.keys(this.requestValueMapper.getCurrencyMappings()) as Currency[]
  }

  getLanguages(): string[] {
    return Object.keys(this.requestValueMapper.getLangMappings())
  }

  /** `gateway_3d_host` for the 3D Host model when configured, otherwise `gateway_3d`. */
  get3DGatewayURL(paymentModel: PaymentModel = MODEL.THREE_D_SECURE): string {
    const endpoints = this.config.gateway_endpoints
    if (paymentModel === MODEL.THREE_D_HOST && endpoints.gateway_3d_host) {
      return endpoints.gateway_3d_host
    }
    if (!endpoints.gateway_3d) {
      throw new PosError(`gateway_3d endpoint is not configured for ${this.config.name}.`)
    }

    return endpoints.gateway_3d
  }

  static isSupportedTransaction(txType: TxType, paymentModel: PaymentModel): boolean {
    // biome-ignore lint/complexity/noThisInStatic: late static binding, reads the subclass table
    const table = this.supportedTransactions
    if (!Object.hasOwn(table, txType)) {
      return false
    }
    const supported = table[txType]
    if (typeof supported === 'boolean') {
      return supported
    }

    return supported?.includes(paymentModel) ?? false
  }

  // ---- helpers for subclasses ----

  /** The concrete gateway class (for static lookups with late binding). */
  protected gatewayClass(): typeof AbstractGateway {
    return this.constructor as typeof AbstractGateway
  }

  /** The concrete gateway's GATEWAY_CLASS identifier. */
  protected gatewayClassName(): string {
    return this.gatewayClass().GATEWAY_CLASS
  }

  /**
   * Runs `onRequestDataPrepared` hooks and returns the data to send.
   * Without hooks the data is returned as is. Otherwise hooks get a structured clone (plus a frozen shallow copy of
   * the order) and may mutate `event.requestData` in place or replace it; changes are logged at debug.
   *
   * @throws PosError when hooks are registered and the request data cannot be structured-cloned
   */
  protected async dispatchRequestDataPrepared(
    requestData: Record<string, unknown>,
    txType: TxType,
    order: PosOrder,
    paymentModel: PaymentModel,
  ): Promise<Record<string, unknown>> {
    const { data, changed } = await prepareRequestDataWithHooks<RequestDataPreparedEvent>(
      this.hooks.onRequestDataPrepared,
      requestData,
      (clonedRequestData) => ({
        requestData: clonedRequestData,
        bankName: this.account.getBankName(),
        txType,
        gatewayClass: this.gatewayClassName(),
        order: Object.freeze({ ...order }),
        paymentModel,
      }),
      'onRequestDataPrepared',
    )

    if (changed) {
      this.logger.debug('Request data is changed via listeners', {
        tx_type: txType,
        bank_name: this.account.getBankName(),
        initial_data: requestData,
        updated_data: data,
      })
    }

    return data
  }

  protected getClient(txType: TxType, paymentModel: PaymentModel): AbstractHttpClient {
    return this.clientStrategy.getClient(txType, paymentModel)
  }

  /** Sends the request with the HTTP client registered for the tx type and returns the decoded bank response. */
  protected sendRequest(
    txType: TxType,
    paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    order: PosOrder,
    url: string | null = null,
  ): Promise<Record<string, unknown>> {
    return this.getClient(txType, paymentModel).request(txType, paymentModel, requestData, order, url)
  }

  /**
   * The answer to a request that can move money (payment, pre-/post-authorization, 3D provision, refund) must carry a
   * result code. An empty answer (HTTP 204, an empty body or root) or one without a result code says nothing about the
   * money: it may have moved, so mapping it as a decline would invite a retry and a double charge. A code with
   * surrounding whitespace is not the bank's exact code and counts as none. Cancels, status and history requests are
   * not checked: repeating them cannot move money twice.
   *
   * @throws PosHttpError when the answer carries no result (the outcome is unknown; check `status` before any retry)
   */
  protected assertAnswerHasResult(txType: TxType, answer: Record<string, unknown>): void {
    const code: unknown = Object.keys(answer).length === 0 ? null : this.responseDataMapper.readProcReturnCode(answer)
    if (typeof code === 'string' && code !== '' && code === code.trim()) {
      return
    }

    this.logger.error('bank answer carries no result; the outcome is unknown', {
      tx_type: txType,
      gateway: this.gatewayClassName(),
    })
    throw new PosHttpError('Bank answer carries no result; the outcome is unknown', {
      url: this.config.gateway_endpoints.payment_api,
    })
  }

  protected is3dAuthSuccess(responseData: Record<string, unknown>): boolean {
    const mdStatus = this.responseDataMapper.extractMdStatus(responseData)

    if (this.responseDataMapper.is3dAuthSuccess(mdStatus)) {
      this.logger.info('3d auth success', { md_status: mdStatus })

      return true
    }

    this.logger.error('3d auth fail', { md_status: mdStatus })

    return false
  }

  /**
   * Validates `get3DFormData` arguments.
   *
   * @throws UnsupportedTransactionTypeError when the tx type is not a 3D payment or the model is not supported for it
   * @throws PosError when card data is passed for 3D Host or missing for 3D Secure / 3D Pay
   */
  protected check3DFormInputs(
    paymentModel: PaymentModel,
    txType: TxType,
    card: CreditCard | null = null,
    createWithoutCard = false,
  ): void {
    const paymentModels = this.getSupported3DPaymentModelsForPaymentTransaction(txType)
    if (!this.gatewayClass().isSupportedTransaction(txType, paymentModel)) {
      throw new UnsupportedTransactionTypeError(
        `${this.gatewayClassName()} supports [${paymentModels.join(', ')}] payment model(s) for transaction type [${txType}]. Provided payment model: [${paymentModel}].`,
      )
    }

    if (paymentModel === MODEL.THREE_D_HOST && card !== null) {
      throw new PosError(
        `Do not use [${paymentModel}] payment model with card data. Use [${this.getSupported3DPaymentModelsForPaymentTransaction(txType, true).join(', ')}] payment model(s) instead.`,
      )
    }

    if (createWithoutCard) {
      return
    }

    if ((paymentModel === MODEL.THREE_D_SECURE || paymentModel === MODEL.THREE_D_PAY) && card === null) {
      throw new PosError('Card data is required for this payment model')
    }
  }

  // ---- private ----

  private applyTestMode(testMode: boolean): void {
    this.requestDataMapper.setTestMode(testMode)
    this.logger.debug('switching mode', { is_test_mode: testMode })
    if (!(this.constructor as typeof AbstractGateway).testModeAffectsRequests) {
      this.logger.warn(
        'The test_mode gateway setting does not affect request data for this gateway; test and production ' +
          'environments are selected by the endpoint URLs in the config',
        { gateway: this.gatewayClassName() },
      )
    }
  }

  private getSupported3DTxTypes(): TxType[] {
    const cls = this.gatewayClass()
    const result: TxType[] = []
    for (const txType of [TX_TYPE.PAY_AUTH, TX_TYPE.PAY_PRE_AUTH] as const) {
      if (AbstractGateway.threeDPaymentModels.some((model) => cls.isSupportedTransaction(txType, model))) {
        result.push(txType)
      }
    }

    return result
  }

  private getSupported3DPaymentModelsForPaymentTransaction(
    txType: TxType,
    withCard: boolean | null = null,
  ): PaymentModel[] {
    const supported3DTxTypes = this.getSupported3DTxTypes()
    if (!supported3DTxTypes.includes(txType)) {
      throw new UnsupportedTransactionTypeError(
        `Invalid transaction type! Supported transaction types: [${supported3DTxTypes.join(', ')}].`,
      )
    }

    const table = this.gatewayClass().supportedTransactions[txType]
    const supportedPaymentModels: readonly PaymentModel[] =
      table === true ? AbstractGateway.threeDPaymentModels : Array.isArray(table) ? table : []

    if (withCard === null) {
      return [...supportedPaymentModels]
    }

    const withCardModels = AbstractGateway.paymentModelsWithCard
    return supportedPaymentModels.filter((model) => withCardModels.includes(model) === withCard)
  }
}
