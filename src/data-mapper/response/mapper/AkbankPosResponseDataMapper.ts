import { NotImplementedError } from '../../../errors.js'
import { MODEL, PAYMENT_STATUS, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosOrder, PosResponse } from '../../../types.js'
import { AbstractResponseDataMapper } from './AbstractResponseDataMapper.js'
import { TX_APPROVED, TX_DECLINED } from './ResponseDataMapperInterface.js'

type Raw = Record<string, unknown>

/** PHP `$data[$key] ?? null` on a value that may also be null, a scalar or a list. */
function field(data: unknown, key: string | number): unknown {
  if (data !== null && typeof data === 'object' && Object.hasOwn(data, key)) {
    return (data as Raw)[key as string] ?? null
  }

  return null
}

/** Walks nested keys; any missing or non-object step yields null instead of a TypeError. */
function path(data: unknown, ...keys: string[]): unknown {
  let current: unknown = data
  for (const key of keys) {
    current = field(current, key)
  }

  return current
}

/** A bank field as a string, or null when missing; JSON numbers become their decimal text. */
function text(data: unknown, key: string | number): string | null {
  const value = field(data, key)
  if (value === null) return null
  return typeof value === 'string' ? value : String(value)
}

/** The same conversion for an already extracted value. */
function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : String(value)
}

/** PHP 8 `$value > 0` for a bank value: numeric strings compare as numbers, others as strings. */
function greaterThanZero(value: unknown): boolean {
  const str = asText(value)
  if (str === null) return false
  const trimmed = str.trim()
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) {
    return Number(trimmed) > 0
  }

  return str > '0'
}

/** PHP `(int)` cast of a numeric bank value. */
function phpInt(value: unknown): number {
  const str = asText(value)
  if (str === null) return 0
  const n = Number.parseInt(str.trim(), 10)
  return Number.isNaN(n) ? 0 : n
}

/** Missing or non-list values read as an empty list; non-object entries are dropped. */
function asRecordList(value: unknown): Raw[] {
  if (!Array.isArray(value)) return []

  return value.filter((entry): entry is Raw => entry !== null && typeof entry === 'object' && !Array.isArray(entry))
}

/** The value mapper of this gateway also maps order statuses with pre-auth and recurring context. */
interface DetailedOrderStatusMapper {
  mapOrderStatusDetailed(orderStatus: string, preAuthStatus: string | null, isRecurringOrder: boolean): string
}

function hasDetailedOrderStatus(mapper: unknown): mapper is DetailedOrderStatusMapper {
  return typeof (mapper as Partial<DetailedOrderStatusMapper> | null)?.mapOrderStatusDetailed === 'function'
}

/**
 * 3D Pay and 3D Host responses carry `requires_manual_review`: `true` when the bank's host approved the
 * payment (`hostResponseCode` `00`) although the API answer as a whole is declined. The answer has a single
 * response code, so this is the only way to see "approved by the host, declined by the 3D flow"; such a response
 * is `declined` and the merchant must check (and void) the transaction manually.
 */
export class AkbankPosResponseDataMapper extends AbstractResponseDataMapper {
  static override readonly PROCEDURE_SUCCESS_CODE: string = 'VPS-0000'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'AkbankPos'
  }

  mapPaymentResponse(rawPaymentResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    this.logger.debug('mapping payment response', [rawPaymentResponseData])

    const defaultResponse = this.getDefaultPaymentResponse(txType, MODEL.NON_SECURE)
    if (Object.keys(rawPaymentResponseData).length === 0) {
      return defaultResponse
    }

    const raw = rawPaymentResponseData
    const procReturnCode = this.getProcReturnCode(raw)
    const status = procReturnCode === AkbankPosResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED
    const approved = status === TX_APPROVED

    const txnCode = text(raw, 'txnCode')
    const txnDateTime = text(raw, 'txnDateTime')
    const orderTrackId = path(raw, 'order', 'orderTrackId')
    const transaction = path(raw, 'transaction')

    const mappedResponse: Raw = {
      recurring_id: orderTrackId,
      transaction_type: txnCode === null ? null : this.valueMapper.mapTxType(txnCode),
      currency: order.currency ?? null,
      amount: order.amount ?? null,
      installment_count: orderTrackId !== null ? null : (order.installment ?? null),
      transaction_id: null,
      transaction_time:
        approved && txnDateTime !== null ? this.valueFormatter.formatDateTime(txnDateTime, txType) : null,
      proc_return_code: procReturnCode,
      status,
      error_code: approved ? null : procReturnCode,
      error_message: approved ? null : (field(raw, 'hostMessage') ?? field(raw, 'responseMessage')),
      all: raw,
    }

    if (approved) {
      mappedResponse.order_id = path(raw, 'order', 'orderId')
      mappedResponse.batch_num = path(transaction, 'batchNumber')
      mappedResponse.auth_code = path(transaction, 'authCode')
      mappedResponse.ref_ret_num = path(transaction, 'rrn')
    } else {
      mappedResponse.order_id = path(raw, 'order', 'orderId')
      if (transaction !== null) {
        const authCode = path(transaction, 'authCode')
        const batchNumber = path(transaction, 'batchNumber')
        const rrn = path(transaction, 'rrn')
        mappedResponse.auth_code = greaterThanZero(authCode) ? authCode : null
        mappedResponse.batch_num = greaterThanZero(batchNumber) ? batchNumber : null
        mappedResponse.ref_ret_num = greaterThanZero(rrn) ? rrn : null
      }
    }

    this.logger.debug('mapped payment response', mappedResponse)

    return this.mergeArraysPreferNonNullValues(defaultResponse, mappedResponse)
  }

  map3DPaymentData(
    raw3DAuthResponseData: Raw,
    rawPaymentResponseData: Raw | null,
    txType: TxType,
    order: PosOrder,
  ): PosResponse {
    this.logger.debug('mapping 3D payment data', {
      '3d_auth_response': raw3DAuthResponseData,
      provision_response: rawPaymentResponseData,
    })

    const paymentModel = MODEL.THREE_D_SECURE
    const raw = this.emptyStringsToNull(raw3DAuthResponseData)
    let paymentResponseData: Raw = this.getDefaultPaymentResponse(txType, paymentModel)
    if (rawPaymentResponseData !== null) {
      paymentResponseData = this.mapPaymentResponse(rawPaymentResponseData, txType, order)
    }

    const threeDResponse = this.map3DResponseData(raw, paymentModel)
    threeDResponse['3d_all'] = raw

    const result = this.mergeArraysPreferNonNullValues(threeDResponse, paymentResponseData)
    result.payment_model = paymentModel

    return result as PosResponse
  }

  map3DPayResponseData(raw3DAuthResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    const raw = this.emptyStringsToNull(raw3DAuthResponseData)
    const procReturnCode = this.getProcReturnCode(raw)
    const mdStatus = this.extractMdStatus(raw)
    const status =
      procReturnCode === AkbankPosResponseDataMapper.PROCEDURE_SUCCESS_CODE && this.is3dAuthSuccess(mdStatus)
        ? TX_APPROVED
        : TX_DECLINED

    const paymentModel = MODEL.THREE_D_PAY
    const defaultResponse: Raw = this.getDefaultPaymentResponse(txType, paymentModel)
    const threeDResponse = this.map3DResponseData(raw, paymentModel)

    defaultResponse.all = raw
    defaultResponse.status = status
    defaultResponse.amount = order.amount ?? null
    defaultResponse.currency = order.currency ?? null
    defaultResponse.installment_count = order.installment ?? null

    if (status === TX_APPROVED) {
      const txnDateTime = text(raw, 'txnDateTime')
      defaultResponse.transaction_time =
        txnDateTime === null ? null : this.valueFormatter.formatDateTime(txnDateTime, txType)
      defaultResponse.auth_code = field(raw, 'authCode')
      defaultResponse.batch_num = phpInt(field(raw, 'batchNumber'))
      defaultResponse.ref_ret_num = field(raw, 'rrn')
    }

    // The host approved the payment but the answer as a whole is declined: nothing may be shipped,
    // yet the money may have moved.
    const requiresManualReview = status === TX_DECLINED && field(raw, 'hostResponseCode') === '00'
    if (requiresManualReview) {
      this.logger.warn('bank host approved the payment although the response is declined; manual review required', {
        order_id: field(raw, 'orderId'),
        proc_return_code: procReturnCode,
      })
    }
    defaultResponse.requires_manual_review = requiresManualReview

    return this.mergeArraysPreferNonNullValues(defaultResponse, threeDResponse) as PosResponse
  }

  map3DHostResponseData(raw3DAuthResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    const result = this.map3DPayResponseData(raw3DAuthResponseData, txType, order)
    result.payment_model = MODEL.THREE_D_HOST

    return result
  }

  mapRefundResponse(rawResponseData: Raw): PosResponse {
    const procReturnCode = this.getProcReturnCode(rawResponseData)
    const status = procReturnCode === AkbankPosResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED

    const result: Raw = {
      auth_code: null,
      recurring_id: path(rawResponseData, 'order', 'orderTrackId'),
      ref_ret_num: null,
      transaction_id: null,
      proc_return_code: procReturnCode,
      error_code: null,
      error_message: null,
      status,
      all: rawResponseData,
    }
    result.order_id = path(rawResponseData, 'order', 'orderId')
    if (status === TX_APPROVED) {
      result.auth_code = path(rawResponseData, 'transaction', 'authCode')
      result.ref_ret_num = path(rawResponseData, 'transaction', 'rrn')
    } else {
      result.error_code = procReturnCode
      result.error_message = field(rawResponseData, 'responseMessage')
    }

    return result as PosResponse
  }

  mapCancelResponse(rawResponseData: Raw): PosResponse {
    const procReturnCode = this.getProcReturnCode(rawResponseData)
    const status = procReturnCode === AkbankPosResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED

    const result: Raw = {
      recurring_id: path(rawResponseData, 'order', 'orderTrackId'),
      auth_code: null,
      ref_ret_num: null,
      proc_return_code: procReturnCode,
      transaction_id: null,
      error_code: null,
      error_message: null,
      status,
      all: rawResponseData,
    }
    // A recurring payment that is not yet fulfilled has no order id.
    result.order_id = path(rawResponseData, 'order', 'orderId')
    if (status !== TX_APPROVED) {
      result.error_code = procReturnCode
      result.error_message = field(rawResponseData, 'responseMessage')
    }

    return result as PosResponse
  }

  mapStatusResponse(_rawResponseData: Raw): PosResponse {
    throw new NotImplementedError('Status responses are not supported by this gateway.')
  }

  mapOrderHistoryResponse(rawResponseData: Raw): PosResponse {
    const procReturnCode = this.getProcReturnCode(rawResponseData)
    const status = procReturnCode === AkbankPosResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED

    const transactions: Raw[] = []
    let orderId: unknown = null
    let isRecurringOrder = false
    if (status === TX_APPROVED) {
      for (const rawTx of asRecordList(field(rawResponseData, 'txnDetailList'))) {
        if (field(rawTx, 'requestType') === 'R') {
          isRecurringOrder = true
          transactions.push(this.mapSingleRecurringOrderHistoryTransaction(rawTx))
        } else {
          transactions.push(this.mapSingleOrderHistoryTransaction(rawTx))
        }

        orderId ??= field(rawTx, 'orgOrderId') ?? field(rawTx, 'orderId')
      }
    }

    if (!isRecurringOrder) {
      // Stable sort, oldest first; transactions without a time come first.
      transactions.sort((tx1, tx2) => {
        const time1 = tx1.transaction_time instanceof Date ? tx1.transaction_time.getTime() : null
        const time2 = tx2.transaction_time instanceof Date ? tx2.transaction_time.getTime() : null
        if (time1 !== null && time2 === null) return 1
        if (time1 === null && time2 !== null) return -1
        if (time1 === time2 || time1 === null || time2 === null) return 0

        return time1 < time2 ? -1 : 1
      })
    }

    return {
      order_id: orderId ?? null,
      proc_return_code: procReturnCode,
      error_message: status === TX_APPROVED ? null : field(rawResponseData, 'responseMessage'),
      error_code: status === TX_APPROVED ? null : procReturnCode,
      trans_count: transactions.length,
      transactions,
      status,
      all: rawResponseData,
    } as PosResponse
  }

  is3dAuthSuccess(mdStatus: string | null): boolean {
    return mdStatus === AkbankPosResponseDataMapper.PROCEDURE_SUCCESS_CODE
  }

  extractMdStatus(raw3DAuthResponseData: Raw): string | null {
    return this.getProcReturnCode(raw3DAuthResponseData)
  }

  protected getProcReturnCode(response: Raw): string | null {
    return text(response, 'responseCode')
  }

  private mapOrderStatus(orderStatus: string | null, preAuthStatus: string | null, isRecurring: boolean): unknown {
    if (orderStatus === null) return null
    if (hasDetailedOrderStatus(this.valueMapper)) {
      return this.valueMapper.mapOrderStatusDetailed(orderStatus, preAuthStatus, isRecurring)
    }

    return this.valueMapper.mapOrderStatus(orderStatus)
  }

  private formatAmountOrNull(value: unknown): number | null {
    const amount = asText(value)

    return amount === null ? null : this.valueFormatter.formatAmount(amount, TX_TYPE.ORDER_HISTORY)
  }

  private formatDateOrNull(value: unknown): Date | null {
    const dateTime = asText(value)

    return dateTime === null ? null : this.valueFormatter.formatDateTime(dateTime, TX_TYPE.ORDER_HISTORY)
  }

  private mapSingleOrderHistoryTransaction(rawTx: Raw): Raw {
    const txType = TX_TYPE.ORDER_HISTORY
    const transaction = this.getDefaultOrderHistoryTxResponse()
    transaction.proc_return_code = this.getProcReturnCode(rawTx)
    if (transaction.proc_return_code === AkbankPosResponseDataMapper.PROCEDURE_SUCCESS_CODE) {
      transaction.status = TX_APPROVED
    }

    const currencyCode = text(rawTx, 'currencyCode')
    const txnCode = text(rawTx, 'txnCode')
    transaction.currency = currencyCode === null ? null : this.valueMapper.mapCurrency(currencyCode, txType)
    transaction.installment_count = this.valueFormatter.formatInstallment(text(rawTx, 'installCount'), txType)
    transaction.transaction_type = txnCode === null ? null : this.valueMapper.mapTxType(txnCode)
    transaction.first_amount = this.formatAmountOrNull(field(rawTx, 'amount'))
    transaction.transaction_time = this.formatDateOrNull(field(rawTx, 'txnDateTime'))

    if (transaction.status === TX_APPROVED) {
      transaction.masked_number = field(rawTx, 'maskedCardNumber')
      transaction.ref_ret_num = field(rawTx, 'rrn')
      // batchNumber is not provided when the payment is canceled
      transaction.batch_num = field(rawTx, 'batchNumber')
      transaction.order_status = this.mapOrderStatus(text(rawTx, 'txnStatus'), text(rawTx, 'preAuthStatus'), false)
      transaction.auth_code = field(rawTx, 'authCode')
      if (transaction.order_status === PAYMENT_STATUS.PAYMENT_COMPLETED) {
        if (
          transaction.transaction_type === TX_TYPE.PAY_AUTH ||
          transaction.transaction_type === TX_TYPE.PAY_POST_AUTH
        ) {
          transaction.capture_amount = this.formatAmountOrNull(field(rawTx, 'amount'))
          transaction.capture = transaction.first_amount === transaction.capture_amount
          if (transaction.capture) {
            transaction.capture_time = this.formatDateOrNull(field(rawTx, 'txnDateTime'))
          }
        } else if (transaction.transaction_type === TX_TYPE.PAY_PRE_AUTH) {
          transaction.capture_amount = this.formatAmountOrNull(field(rawTx, 'preAuthCloseAmount'))
          transaction.capture = transaction.first_amount === transaction.capture_amount
          if (transaction.capture) {
            transaction.capture_time = this.formatDateOrNull(field(rawTx, 'preAuthCloseDate'))
          }
        }
      }
    } else {
      transaction.error_code = transaction.proc_return_code
    }

    return transaction
  }

  private mapSingleRecurringOrderHistoryTransaction(rawTx: Raw): Raw {
    const txType = TX_TYPE.ORDER_HISTORY
    const transaction = this.getDefaultOrderHistoryTxResponse()
    transaction.proc_return_code = this.getProcReturnCode(rawTx)
    transaction.order_status = this.mapOrderStatus(text(rawTx, 'requestStatus'), null, true)
    if (transaction.proc_return_code === null) {
      // no response code: this is a payment that is still pending
      transaction.status = null
    } else if (transaction.proc_return_code === AkbankPosResponseDataMapper.PROCEDURE_SUCCESS_CODE) {
      transaction.status = TX_APPROVED
    }

    const currencyCode = text(rawTx, 'currencyCode')
    const txnCode = text(rawTx, 'txnCode')
    transaction.recurring_order = field(rawTx, 'recurringOrder')
    transaction.masked_number = field(rawTx, 'maskedCardNumber')
    transaction.currency = currencyCode === null ? null : this.valueMapper.mapCurrency(currencyCode, txType)
    transaction.installment_count = this.valueFormatter.formatInstallment(text(rawTx, 'installCount'), txType)
    transaction.transaction_type = txnCode === null ? null : this.valueMapper.mapTxType(txnCode)
    transaction.first_amount = this.formatAmountOrNull(field(rawTx, 'amount'))

    if (transaction.status === TX_APPROVED) {
      transaction.auth_code = field(rawTx, 'authCode')
      if (transaction.order_status !== PAYMENT_STATUS.PAYMENT_PENDING) {
        transaction.transaction_time = this.formatDateOrNull(field(rawTx, 'txnDateTime'))
      }

      if (transaction.order_status === PAYMENT_STATUS.PAYMENT_COMPLETED) {
        transaction.batch_num = field(rawTx, 'batchNumber')
        transaction.ref_ret_num = field(rawTx, 'rrn')
        transaction.capture_amount = this.formatAmountOrNull(field(rawTx, 'amount'))
        transaction.capture = transaction.first_amount === transaction.capture_amount
        transaction.capture_time = this.formatDateOrNull(field(rawTx, 'txnDateTime'))
      }
    } else {
      transaction.error_code = transaction.proc_return_code
    }

    return transaction
  }

  private map3DResponseData(raw: Raw, paymentModel: PaymentModel): Raw {
    const procReturnCode = this.getProcReturnCode(raw)
    const authSuccess = this.is3dAuthSuccess(procReturnCode)

    const threeDResponse: Raw = {
      proc_return_code: procReturnCode,
      payment_model: paymentModel,
      transaction_security: null,
      md_status: null,
      order_id: field(raw, 'orderId'),
      masked_number: null,
      eci: null,
      md_error_message: authSuccess ? null : field(raw, 'responseMessage'),
    }

    if (authSuccess && paymentModel === MODEL.THREE_D_SECURE) {
      threeDResponse.eci = field(raw, 'secureEcomInd')
    }

    return threeDResponse
  }
}
