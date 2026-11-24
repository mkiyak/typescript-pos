import type {
  BinListResponse,
  InstallmentPricesResponse,
  InstallmentRatesResponse,
  PosQueryHistoryResponse,
  QueryResponseDataMapperInterface,
} from '../data-mapper/pos-query/response/QueryResponseDataMapperInterface.js'
import type { GatewayConfig } from '../gateway/AbstractGateway.js'
import type { AbstractPosAccount } from '../model/account/AbstractPosAccount.js'
import { MODEL } from '../PosInterface.js'
import type { PosOrder } from '../types.js'
import { AbstractPosQuery, type PosQueryDeps } from './AbstractPosQuery.js'
import { QUERY_TYPE, type QueryType } from './PosQueryInterface.js'

export type MappedPosQueryDeps<A extends AbstractPosAccount = AbstractPosAccount> = PosQueryDeps<A> & {
  responseDataMapper: QueryResponseDataMapperInterface
}

/** A query service whose answers are normalized by a response mapper (history, installments, BIN list). */
export abstract class AbstractMappedPosQuery<
  A extends AbstractPosAccount = AbstractPosAccount,
> extends AbstractPosQuery<A> {
  protected readonly responseDataMapper: QueryResponseDataMapperInterface

  constructor(config: GatewayConfig, account: A, deps: MappedPosQueryDeps<A>) {
    super(config, account, deps)
    this.responseDataMapper = deps.responseDataMapper
  }

  override async history(data: Record<string, unknown>): Promise<PosQueryHistoryResponse> {
    if (!this.queryClass().isSupportedQuery(QUERY_TYPE.HISTORY)) return this.unsupported(QUERY_TYPE.HISTORY)
    const raw = await this.send(QUERY_TYPE.HISTORY, data, (d) =>
      this.requestDataMapper.createHistoryRequestData(this.account, d),
    )
    return this.responseDataMapper.mapHistoryResponse(raw)
  }

  override async getInstallmentRates(params: Record<string, unknown>): Promise<InstallmentRatesResponse> {
    if (!this.queryClass().isSupportedQuery(QUERY_TYPE.INSTALLMENT_RATES)) {
      return this.unsupported(QUERY_TYPE.INSTALLMENT_RATES)
    }
    const raw = await this.send(QUERY_TYPE.INSTALLMENT_RATES, params, (d) =>
      this.requestDataMapper.createInstallmentRatesRequestData(this.account, d),
    )
    return this.responseDataMapper.mapInstallmentRatesResponse(raw)
  }

  override async getInstallmentPrices(params: Record<string, unknown>): Promise<InstallmentPricesResponse> {
    if (!this.queryClass().isSupportedQuery(QUERY_TYPE.INSTALLMENT_PRICES)) {
      return this.unsupported(QUERY_TYPE.INSTALLMENT_PRICES)
    }
    const raw = await this.send(QUERY_TYPE.INSTALLMENT_PRICES, params, (d) =>
      this.requestDataMapper.createInstallmentPricesRequestData(this.account, d),
    )
    return this.responseDataMapper.mapInstallmentPricesResponse(raw)
  }

  override async getBinList(params: Record<string, unknown>): Promise<BinListResponse> {
    if (!this.queryClass().isSupportedQuery(QUERY_TYPE.BIN_LIST)) return this.unsupported(QUERY_TYPE.BIN_LIST)
    const raw = await this.send(QUERY_TYPE.BIN_LIST, params, (d) =>
      this.requestDataMapper.createBinListRequestData(this.account, d),
    )
    return this.responseDataMapper.mapBinListResponse(raw)
  }

  private async send(
    queryType: QueryType,
    input: Record<string, unknown>,
    createRequestData: (input: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const data = await this.dispatchPosQueryRequestDataPrepared(queryType, createRequestData(input), input)
    return this.clientStrategy
      .getClient(queryType, MODEL.NON_SECURE)
      .request(queryType, MODEL.NON_SECURE, data, input as PosOrder, null)
  }
}
