import type { CryptInterface } from '../../../crypt/CryptInterface.js'
import { UnsupportedTransactionTypeError } from '../../../errors.js'
import type { AbstractPosAccount } from '../../../model/account/AbstractPosAccount.js'
import { LANG, type Lang } from '../../../PosInterface.js'
import { QUERY_TYPE, type QueryType } from '../../../pos-query/PosQueryInterface.js'
import type { RequestValueFormatterInterface } from '../../request/value-formatter/RequestValueFormatterInterface.js'
import type { RequestValueMapperInterface } from '../../request/value-mapper/RequestValueMapperInterface.js'
import type { QueryRequestDataMapperInterface } from './QueryRequestDataMapperInterface.js'

function unsupported(queryType: QueryType): UnsupportedTransactionTypeError {
  return new UnsupportedTransactionTypeError(`Query type [${queryType}] is not supported.`)
}

/** Plain assignment would turn a parsed `__proto__` key into a prototype change; this always creates an own property. */
function define(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

/**
 * Base query request mapper. It takes no hooks: the query class dispatches them, so the mapper only
 * builds data. Concrete classes also declare `static supports(gatewayClass: string): boolean`.
 */
export abstract class AbstractQueryRequestDataMapper<A extends AbstractPosAccount = AbstractPosAccount>
  implements QueryRequestDataMapperInterface<A>
{
  protected testMode = false

  constructor(
    protected readonly valueMapper: RequestValueMapperInterface,
    protected readonly valueFormatter: RequestValueFormatterInterface,
    protected readonly crypt: CryptInterface<A>,
    protected readonly defaultLang: Lang = LANG.TR,
  ) {}

  /** Default: the data goes out as given; banks that need credentials or a signature override this. */
  createCustomQueryRequestData(_account: A, requestData: Record<string, unknown>): Record<string, unknown> {
    return requestData
  }

  createHistoryRequestData(_account: A, _data: Record<string, unknown>): Record<string, unknown> {
    throw unsupported(QUERY_TYPE.HISTORY)
  }

  createInstallmentRatesRequestData(_account: A, _params: Record<string, unknown>): Record<string, unknown> {
    throw unsupported(QUERY_TYPE.INSTALLMENT_RATES)
  }

  createInstallmentPricesRequestData(_account: A, _params: Record<string, unknown>): Record<string, unknown> {
    throw unsupported(QUERY_TYPE.INSTALLMENT_PRICES)
  }

  createBinListRequestData(_account: A, _params: Record<string, unknown>): Record<string, unknown> {
    throw unsupported(QUERY_TYPE.BIN_LIST)
  }

  isTestMode(): boolean {
    return this.testMode
  }

  setTestMode(testMode: boolean): void {
    this.testMode = testMode
  }

  /** The bank-specific language value; falls back to the default language. */
  protected getLang(params: Record<string, unknown>): string {
    return this.valueMapper.mapLang((params.lang as Lang | undefined) ?? this.defaultLang)
  }

  /**
   * Appends the account's credentials to the caller's data. Caller keys keep their order and values: a key
   * counts as provided when it is an own property that is not `undefined` (`null` counts as provided), so an
   * `undefined` credential is filled from the account instead of going out as an empty element.
   */
  protected mergeAccountData(
    requestData: Record<string, unknown>,
    accountData: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(requestData)) {
      const value = requestData[key]
      if (value !== undefined) define(result, key, value)
      else if (Object.hasOwn(accountData, key)) define(result, key, accountData[key])
    }
    for (const key of Object.keys(accountData)) {
      if (!Object.hasOwn(result, key)) define(result, key, accountData[key])
    }
    return result
  }
}
