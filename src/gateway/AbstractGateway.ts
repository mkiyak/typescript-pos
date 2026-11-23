import { isDeepStrictEqual } from 'node:util'
import type { AbstractHttpClient } from '../client/AbstractHttpClient.js'
import type { HttpClientStrategy } from '../client/HttpClientStrategy.js'
import type { CryptInterface } from '../crypt/CryptInterface.js'
import type { RequestDataMapperInterface } from '../data-mapper/request/mapper/RequestDataMapperInterface.js'
import type { RequestValueFormatterInterface } from '../data-mapper/request/value-formatter/RequestValueFormatterInterface.js'
import type { RequestValueMapperInterface } from '../data-mapper/request/value-mapper/RequestValueMapperInterface.js'
import type { ResponseDataMapperInterface } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { PosError, UnsupportedPaymentModelError, UnsupportedTransactionTypeError } from '../errors.js'
import { runHooks } from '../hooks.js'
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

    return this.responseDataMapper.mapPaymentResponse(bankResponse, txType, order)
  }

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

    return this.responseDataMapper.mapPaymentResponse(bankResponse, txType, order)
  }

  // ---- non-payment transactions ----

  /** Full refund, or partial refund when `order.order_amount` is set and `order.amount` is lower. */
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
    const hooks = this.hooks.onRequestDataPrepared
    if (hooks === undefined || hooks.length === 0) {
      return requestData
    }

    let baseline: Record<string, unknown>
    let eventData: Record<string, unknown>
    try {
      baseline = structuredClone(requestData)
      eventData = structuredClone(requestData)
    } catch (e) {
      throw new PosError(
        `Request data cannot be cloned for onRequestDataPrepared hooks: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      )
    }

    const event: RequestDataPreparedEvent = {
      requestData: eventData,
      bankName: this.account.getBankName(),
      txType,
      gatewayClass: this.gatewayClassName(),
      order: Object.freeze({ ...order }),
      paymentModel,
    }
    await runHooks(hooks, event)

    // Compare against a clone (not the original) so that cloning itself, which drops class prototypes,
    // is not reported as a change.
    if (isDeepStrictEqual(baseline, event.requestData)) {
      return requestData
    }

    this.logger.debug('Request data is changed via listeners', {
      tx_type: event.txType,
      bank_name: event.bankName,
      initial_data: requestData,
      updated_data: event.requestData,
    })

    return event.requestData
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
