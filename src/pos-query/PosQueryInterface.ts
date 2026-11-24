import type {
  BinListResponse,
  InstallmentPricesResponse,
  InstallmentRatesResponse,
  PosQueryHistoryResponse,
} from '../data-mapper/pos-query/response/QueryResponseDataMapperInterface.js'
import type { AbstractPosAccount } from '../model/account/AbstractPosAccount.js'

/** Query kinds a bank API can answer outside of the payment lifecycle. They never share a name with a `TX_TYPE`. */
export const QUERY_TYPE = {
  CUSTOM_QUERY: 'custom_query',
  HISTORY: 'history',
  INSTALLMENT_RATES: 'installment_rates',
  INSTALLMENT_PRICES: 'installment_prices',
  BIN_LIST: 'bin_list',
} as const

export type QueryType = (typeof QUERY_TYPE)[keyof typeof QUERY_TYPE]

/** Non-payment queries of a bank API. Every method returns its own result; nothing is kept on the instance. */
export interface PosQueryInterface<A extends AbstractPosAccount = AbstractPosAccount> {
  /**
   * Sends a caller-built request body (the account credentials are added) and returns the decoded, unnormalized
   * bank answer. `apiUrl` must be an https: URL on a configured or explicitly allowed origin.
   */
  customQuery(requestData: Record<string, unknown>, apiUrl?: string | null): Promise<Record<string, unknown>>
  history(data: Record<string, unknown>): Promise<PosQueryHistoryResponse>
  getInstallmentRates(params: Record<string, unknown>): Promise<InstallmentRatesResponse>
  getInstallmentPrices(params: Record<string, unknown>): Promise<InstallmentPricesResponse>
  getBinList(params: Record<string, unknown>): Promise<BinListResponse>
  getAccount(): A
  isTestMode(): boolean
}
