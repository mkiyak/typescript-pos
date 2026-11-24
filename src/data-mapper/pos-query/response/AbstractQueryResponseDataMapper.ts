import { UnsupportedTransactionTypeError } from '../../../errors.js'
import { createSafeLogger, type PosLogger } from '../../../logger.js'
import { QUERY_TYPE, type QueryType } from '../../../pos-query/PosQueryInterface.js'
import type { ResponseValueFormatterInterface } from '../../response/value-formatter/ResponseValueFormatterInterface.js'
import type { ResponseValueMapperInterface } from '../../response/value-mapper/ResponseValueMapperInterface.js'
import type {
  BinListResponse,
  InstallmentPricesResponse,
  InstallmentRatesResponse,
  PosQueryHistoryResponse,
  QueryResponseDataMapperInterface,
} from './QueryResponseDataMapperInterface.js'

export type {
  BinListResponse,
  InstallmentPricesResponse,
  InstallmentRatesResponse,
  PosQueryHistoryResponse,
  QueryStatus,
} from './QueryResponseDataMapperInterface.js'

import { phpTrim } from '../../../util/phpTrim.js'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function unsupported(queryType: QueryType): UnsupportedTransactionTypeError {
  return new UnsupportedTransactionTypeError(`Query type [${queryType}] is not supported.`)
}

export abstract class AbstractQueryResponseDataMapper implements QueryResponseDataMapperInterface {
  static readonly PROCEDURE_SUCCESS_CODE: string = '00'
  static readonly TX_STATUS_APPROVED = 'approved'
  static readonly TX_STATUS_DECLINED = 'declined'

  protected readonly logger: PosLogger

  constructor(
    protected readonly valueFormatter: ResponseValueFormatterInterface,
    protected readonly valueMapper: ResponseValueMapperInterface,
    logger: PosLogger,
  ) {
    this.logger = createSafeLogger(logger)
  }

  abstract mapHistoryResponse(raw: Record<string, unknown>): PosQueryHistoryResponse

  mapInstallmentRatesResponse(_raw: Record<string, unknown>): InstallmentRatesResponse {
    throw unsupported(QUERY_TYPE.INSTALLMENT_RATES)
  }

  mapInstallmentPricesResponse(_raw: Record<string, unknown>): InstallmentPricesResponse {
    throw unsupported(QUERY_TYPE.INSTALLMENT_PRICES)
  }

  mapBinListResponse(_raw: Record<string, unknown>): BinListResponse {
    throw unsupported(QUERY_TYPE.BIN_LIST)
  }

  protected getDefaultBinListResponse(): BinListResponse {
    return { status: 'declined', error_message: null, bin_list: [], all: {} }
  }

  protected getDefaultInstallmentPricesResponse(): InstallmentPricesResponse {
    return { status: 'declined', error_message: null, installment_prices: [], all: {} }
  }

  protected getDefaultInstallmentRatesResponse(): InstallmentRatesResponse {
    return { status: 'declined', error_message: null, installment_rates: [], all: {} }
  }

  protected getDefaultHistoryTxResponse(): Record<string, unknown> {
    return {
      auth_code: null,
      proc_return_code: null,
      transaction_id: null,
      order_id: null,
      transaction_time: null,
      capture_time: null,
      error_message: null,
      ref_ret_num: null,
      order_status: null,
      transaction_type: null,
      first_amount: null,
      capture_amount: null,
      status: 'declined',
      error_code: null,
      capture: null,
      currency: null,
      masked_number: null,
    }
  }

  /**
   * For keys present in both objects the non-null value wins; when both are non-null, `b` wins. Key order:
   * keys only in `a`, keys only in `b`, then the common keys in `a`'s order.
   */
  protected mergeArraysPreferNonNullValues(
    a: Record<string, unknown>,
    b: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(a)) {
      if (!Object.hasOwn(b, key)) result[key] = a[key]
    }
    for (const key of Object.keys(b)) {
      if (!Object.hasOwn(a, key)) result[key] = b[key]
    }
    for (const key of Object.keys(a)) {
      if (Object.hasOwn(b, key)) result[key] = b[key] ?? a[key]
    }
    return result
  }

  /**
   * Banks return empty strings for missing values: strings are trimmed and '' becomes null, numbers are
   * kept, arrays and plain objects are processed recursively, anything else becomes null.
   */
  protected emptyStringsToNull(data: unknown): unknown {
    if (typeof data === 'string') {
      const trimmed = phpTrim(data)
      return trimmed === '' ? null : trimmed
    }
    if (typeof data === 'number') return data
    if (Array.isArray(data)) return data.map((v) => this.emptyStringsToNull(v))
    if (isPlainObject(data)) {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(data)) result[key] = this.emptyStringsToNull(value)
      return result
    }
    return null
  }
}
