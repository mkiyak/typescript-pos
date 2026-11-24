import type { HttpClientStrategy } from '../client/HttpClientStrategy.js'
import type { QueryRequestDataMapperInterface } from '../data-mapper/pos-query/request/QueryRequestDataMapperInterface.js'
import type {
  BinListResponse,
  InstallmentPricesResponse,
  InstallmentRatesResponse,
  PosQueryHistoryResponse,
} from '../data-mapper/pos-query/response/QueryResponseDataMapperInterface.js'
import { PosError, UnsupportedTransactionTypeError } from '../errors.js'
import type { GatewayConfig } from '../gateway/AbstractGateway.js'
import { prepareRequestDataWithHooks } from '../hooks.js'
import { createSafeLogger, type PosLogger } from '../logger.js'
import type { AbstractPosAccount } from '../model/account/AbstractPosAccount.js'
import { MODEL } from '../PosInterface.js'
import type { PosHooks, PosOrder, PosQueryRequestDataPreparedEvent } from '../types.js'
import { type PosQueryInterface, QUERY_TYPE, type QueryType } from './PosQueryInterface.js'

export type PosQueryDeps<A extends AbstractPosAccount = AbstractPosAccount> = {
  requestDataMapper: QueryRequestDataMapperInterface<A>
  clientStrategy: HttpClientStrategy
  logger: PosLogger
  hooks: PosHooks
  /** Extra https: origins `customQuery(…, apiUrl)` may target besides the configured endpoints. */
  allowedApiOrigins?: readonly string[]
}

/**
 * Base class of the non-payment query services. Stateless: every method returns its own result, so one instance
 * can serve concurrent calls. A query that a bank does not offer rejects with `UnsupportedTransactionTypeError`.
 */
export abstract class AbstractPosQuery<A extends AbstractPosAccount = AbstractPosAccount>
  implements PosQueryInterface<A>
{
  /** The gateway this query serves, e.g. 'AssecoPos' (the gateway's own GATEWAY_CLASS). */
  static readonly GATEWAY_CLASS: string = ''

  /** Subclasses declare which queries they answer. */
  protected static supportedQueries: Partial<Record<QueryType, boolean>> = {}

  protected readonly requestDataMapper: QueryRequestDataMapperInterface<A>
  protected readonly clientStrategy: HttpClientStrategy
  protected readonly logger: PosLogger
  protected readonly hooks: PosHooks

  readonly #testMode: boolean
  readonly #allowedOrigins: ReadonlySet<string>

  constructor(
    protected readonly config: GatewayConfig,
    protected readonly account: A,
    deps: PosQueryDeps<A>,
  ) {
    if (this.queryClass().GATEWAY_CLASS === '') {
      throw new PosError(`${this.constructor.name} must define a non-empty static GATEWAY_CLASS.`)
    }

    this.requestDataMapper = deps.requestDataMapper
    this.clientStrategy = deps.clientStrategy
    this.logger = createSafeLogger(deps.logger)
    this.hooks = deps.hooks

    const origins = new Set<string>()
    for (const endpoint of Object.values(config.gateway_endpoints)) {
      if (typeof endpoint !== 'string' || endpoint === '') continue
      const url = parseUrl(endpoint)
      if (url !== null && url.protocol === 'https:') origins.add(url.origin)
    }
    for (const entry of deps.allowedApiOrigins ?? []) {
      const url = parseUrl(entry)
      if (url === null || url.protocol !== 'https:') {
        throw new PosError('allowedApiOrigins entries must be https: URLs.')
      }
      origins.add(url.origin)
    }
    this.#allowedOrigins = origins

    this.#testMode = config.test_mode ?? false
    if (config.test_mode !== undefined) {
      this.requestDataMapper.setTestMode(config.test_mode)
      this.logger.debug('switching mode', { is_test_mode: config.test_mode })
    }
  }

  static supports(gatewayClass: string): boolean {
    return this.GATEWAY_CLASS !== '' && gatewayClass === this.GATEWAY_CLASS
  }

  static isSupportedQuery(queryType: string): boolean {
    return Object.hasOwn(this.supportedQueries, queryType) && this.supportedQueries[queryType as QueryType] === true
  }

  async customQuery(requestData: Record<string, unknown>, apiUrl?: string | null): Promise<Record<string, unknown>> {
    // The mapper puts the merchant credentials into the body, so the target is checked before anything is built.
    if (apiUrl !== undefined && apiUrl !== null) {
      this.assertAllowedApiUrl(apiUrl)
    }

    const mapped = this.requestDataMapper.createCustomQueryRequestData(this.account, requestData)
    const data = await this.dispatchPosQueryRequestDataPrepared(QUERY_TYPE.CUSTOM_QUERY, mapped, requestData)

    return this.clientStrategy
      .getClient(QUERY_TYPE.CUSTOM_QUERY, MODEL.NON_SECURE)
      .request(QUERY_TYPE.CUSTOM_QUERY, MODEL.NON_SECURE, data, requestData as PosOrder, apiUrl ?? null)
  }

  history(_data: Record<string, unknown>): Promise<PosQueryHistoryResponse> {
    return this.unsupported(QUERY_TYPE.HISTORY)
  }

  getInstallmentRates(_params: Record<string, unknown>): Promise<InstallmentRatesResponse> {
    return this.unsupported(QUERY_TYPE.INSTALLMENT_RATES)
  }

  getInstallmentPrices(_params: Record<string, unknown>): Promise<InstallmentPricesResponse> {
    return this.unsupported(QUERY_TYPE.INSTALLMENT_PRICES)
  }

  getBinList(_params: Record<string, unknown>): Promise<BinListResponse> {
    return this.unsupported(QUERY_TYPE.BIN_LIST)
  }

  getAccount(): A {
    return this.account
  }

  isTestMode(): boolean {
    return this.#testMode
  }

  protected queryClass(): typeof AbstractPosQuery {
    return this.constructor as typeof AbstractPosQuery
  }

  /** A rejected promise, never a synchronous throw, so callers handle every unsupported query the same way. */
  protected unsupported<T>(queryType: QueryType): Promise<T> {
    return Promise.reject(
      new UnsupportedTransactionTypeError(
        `Query type [${queryType}] is not supported by ${this.queryClass().GATEWAY_CLASS}.`,
      ),
    )
  }

  protected async dispatchPosQueryRequestDataPrepared(
    queryType: QueryType,
    requestData: Record<string, unknown>,
    originalData: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { data, changed } = await prepareRequestDataWithHooks<PosQueryRequestDataPreparedEvent>(
      this.hooks.onPosQueryRequestDataPrepared,
      requestData,
      (clonedRequestData) => ({
        requestData: clonedRequestData,
        bankName: this.account.getBankName(),
        queryType,
        gatewayClass: this.queryClass().GATEWAY_CLASS,
        originalData: Object.freeze({ ...originalData }),
      }),
      'onPosQueryRequestDataPrepared',
    )

    if (changed) {
      this.logger.debug('Request data is changed via listeners', {
        query_type: queryType,
        bank_name: this.account.getBankName(),
        initial_data: requestData,
        updated_data: data,
      })
    }

    return data
  }

  /**
   * Only an https: URL on a configured or explicitly allowed origin may receive the request, because the body
   * carries the merchant credentials. The rejected URL is not echoed: it may itself contain secrets.
   */
  protected assertAllowedApiUrl(apiUrl: string): void {
    const url = parseUrl(apiUrl)
    const allowed =
      url !== null &&
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      this.#allowedOrigins.has(url.origin)
    if (!allowed) {
      throw new PosError(
        `Custom query URL must be an https: URL on one of these origins: ${[...this.#allowedOrigins].sort().join(', ')}.`,
      )
    }
  }
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}
