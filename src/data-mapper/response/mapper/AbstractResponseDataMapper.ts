import { createSafeLogger, noopLogger, type PosLogger } from '../../../logger.js'
import type { PaymentModel, TxType } from '../../../PosInterface.js'
import type { PosOrder, PosResponse } from '../../../types.js'
import type { ResponseValueFormatterInterface } from '../value-formatter/ResponseValueFormatterInterface.js'
import type { ResponseValueMapperInterface } from '../value-mapper/ResponseValueMapperInterface.js'
import { type ResponseDataMapperInterface, TX_APPROVED, TX_DECLINED } from './ResponseDataMapperInterface.js'

/** Characters stripped by PHP trim(). */
const PHP_TRIM_CHARS = new Set([' ', '\t', '\n', '\r', '\0', '\x0B'])

function phpTrim(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && PHP_TRIM_CHARS.has(value.charAt(start))) start++
  while (end > start && PHP_TRIM_CHARS.has(value.charAt(end - 1))) end--
  return value.slice(start, end)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export abstract class AbstractResponseDataMapper implements ResponseDataMapperInterface {
  static readonly PROCEDURE_SUCCESS_CODE = '00'
  static readonly TX_APPROVED = TX_APPROVED
  static readonly TX_DECLINED = TX_DECLINED

  protected readonly logger: PosLogger

  constructor(
    protected readonly valueFormatter: ResponseValueFormatterInterface,
    protected readonly valueMapper: ResponseValueMapperInterface,
    logger: PosLogger = noopLogger,
  ) {
    this.logger = createSafeLogger(logger)
  }

  abstract mapPaymentResponse(
    rawPaymentResponseData: Record<string, unknown>,
    txType: TxType,
    order: PosOrder,
  ): PosResponse

  abstract map3DPaymentData(
    raw3DAuthResponseData: Record<string, unknown>,
    rawPaymentResponseData: Record<string, unknown> | null,
    txType: TxType,
    order: PosOrder,
  ): PosResponse

  abstract map3DPayResponseData(
    raw3DAuthResponseData: Record<string, unknown>,
    txType: TxType,
    order: PosOrder,
  ): PosResponse

  abstract map3DHostResponseData(
    raw3DAuthResponseData: Record<string, unknown>,
    txType: TxType,
    order: PosOrder,
  ): PosResponse

  abstract mapRefundResponse(rawResponseData: Record<string, unknown>): PosResponse

  abstract mapCancelResponse(rawResponseData: Record<string, unknown>): PosResponse

  abstract mapStatusResponse(rawResponseData: Record<string, unknown>): PosResponse

  abstract mapOrderHistoryResponse(rawResponseData: Record<string, unknown>): PosResponse

  abstract extractMdStatus(raw3DAuthResponseData: Record<string, unknown>): string | null

  abstract is3dAuthSuccess(mdStatus: string | null): boolean

  /** Bank procedure return code of a response (e.g. ProcReturnCode, ResultCode). */
  protected abstract getProcReturnCode(response: Record<string, unknown>): string | null

  /**
   * For keys present in both objects the non-null value wins; if both are non-null, `arr2` wins.
   * Key order follows PHP: keys only in arr1, keys only in arr2, then common keys (arr1 order).
   */
  protected mergeArraysPreferNonNullValues<T extends Record<string, unknown>>(
    arr1: T,
    arr2: Record<string, unknown>,
  ): T {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(arr1)) {
      if (!Object.hasOwn(arr2, key)) result[key] = arr1[key]
    }
    for (const key of Object.keys(arr2)) {
      if (!Object.hasOwn(arr1, key)) result[key] = arr2[key]
    }
    for (const key of Object.keys(arr1)) {
      if (Object.hasOwn(arr2, key)) result[key] = arr2[key] ?? arr1[key]
    }
    return result as T
  }

  /** Default payment response; `status` is declined until a mapper proves otherwise. */
  protected getDefaultPaymentResponse(txType: TxType, paymentModel: PaymentModel | null): PosResponse {
    return {
      order_id: null,
      transaction_id: null,
      transaction_time: null,
      transaction_type: txType,
      installment_count: null,
      currency: null,
      amount: null,
      payment_model: paymentModel,
      auth_code: null,
      ref_ret_num: null,
      batch_num: null,
      proc_return_code: null,
      status: TX_DECLINED,
      error_code: null,
      error_message: null,
      all: null,
    }
  }

  protected getDefaultStatusResponse(rawData: Record<string, unknown>): PosResponse {
    return {
      order_id: null,
      auth_code: null,
      proc_return_code: null,
      transaction_id: null,
      transaction_time: null,
      capture_time: null,
      error_message: null,
      ref_ret_num: null,
      order_status: null,
      transaction_type: null,
      first_amount: null,
      capture_amount: null,
      status: TX_DECLINED,
      error_code: null,
      capture: null,
      currency: null,
      masked_number: null,
      refund_amount: null,
      installment_count: null,
      refund_time: null,
      cancel_time: null,
      all: rawData,
    }
  }

  protected getDefaultOrderHistoryTxResponse(): Record<string, unknown> {
    return {
      auth_code: null,
      proc_return_code: null,
      transaction_id: null,
      transaction_time: null,
      capture_time: null,
      error_message: null,
      ref_ret_num: null,
      order_status: null,
      transaction_type: null,
      first_amount: null,
      capture_amount: null,
      status: TX_DECLINED,
      error_code: null,
      capture: null,
      currency: null,
      masked_number: null,
    }
  }

  /**
   * Banks return empty strings for missing values: strings are trimmed (PHP trim) and '' becomes null,
   * numbers are kept, arrays/plain objects are processed recursively, anything else becomes null.
   */
  protected emptyStringsToNull(data: Record<string, unknown>): Record<string, unknown>
  protected emptyStringsToNull(data: unknown): unknown
  protected emptyStringsToNull(data: unknown): unknown {
    if (typeof data === 'string') {
      const trimmed = phpTrim(data)
      return trimmed === '' ? null : trimmed
    }
    if (typeof data === 'number' || typeof data === 'bigint') {
      return data
    }
    if (Array.isArray(data)) {
      return data.map((v) => this.emptyStringsToNull(v))
    }
    if (isPlainObject(data)) {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(data)) {
        result[key] = this.emptyStringsToNull(value)
      }
      return result
    }
    return null
  }
}
