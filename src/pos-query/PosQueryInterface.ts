/** Query kinds a bank API can answer outside of the payment lifecycle. They never share a name with a `TX_TYPE`. */
export const QUERY_TYPE = {
  CUSTOM_QUERY: 'custom_query',
  HISTORY: 'history',
  INSTALLMENT_RATES: 'installment_rates',
  INSTALLMENT_PRICES: 'installment_prices',
  BIN_LIST: 'bin_list',
} as const

export type QueryType = (typeof QUERY_TYPE)[keyof typeof QUERY_TYPE]
