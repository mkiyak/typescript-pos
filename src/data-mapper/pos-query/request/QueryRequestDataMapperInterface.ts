import type { AbstractPosAccount } from '../../../model/account/AbstractPosAccount.js'

/** Builds the request bodies of the non-payment queries a bank API offers. */
export interface QueryRequestDataMapperInterface<A extends AbstractPosAccount = AbstractPosAccount> {
  /** Adds the account credentials (and any signature) to a caller-built request. */
  createCustomQueryRequestData(account: A, requestData: Record<string, unknown>): Record<string, unknown>

  createHistoryRequestData(account: A, data: Record<string, unknown>): Record<string, unknown>

  createInstallmentRatesRequestData(account: A, params: Record<string, unknown>): Record<string, unknown>

  createInstallmentPricesRequestData(account: A, params: Record<string, unknown>): Record<string, unknown>

  createBinListRequestData(account: A, params: Record<string, unknown>): Record<string, unknown>

  isTestMode(): boolean

  setTestMode(testMode: boolean): void
}
