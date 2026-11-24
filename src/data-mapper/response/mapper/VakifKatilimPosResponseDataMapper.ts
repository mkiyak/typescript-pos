import { NotImplementedError } from '../../../errors.js'
import { MODEL, PAYMENT_STATUS, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosOrder, PosResponse } from '../../../types.js'
import { AbstractResponseDataMapper } from './AbstractResponseDataMapper.js'
import { child, exactString, isRecord, NO_DATE, type Raw, scalar, text } from './boaResponseFields.js'
import { TX_APPROVED, TX_DECLINED } from './ResponseDataMapperInterface.js'

/** An order record as the bank sent it and with its text trimmed (empty text read as absent). */
type OrderRecord = { exact: Raw; clean: Raw }

/** Own value of a record, whatever its kind; absent for anything that is not an own key. */
function own(data: Raw | null, key: string): unknown {
  return data !== null && Object.hasOwn(data, key) ? data[key] : undefined
}

/** A single value or a list of values as a list; a missing value is an empty list. */
function listOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  return value === undefined ? [] : [value]
}

/**
 * Response mapper of the Vakıf Katılım gateway. Every decision (approved or not) is taken on the exact
 * `ResponseCode` text of the untouched answer, so padded, numeric, repeated or nested values never approve
 * anything; the other values are read trimmed and only when they are plain text or numbers.
 *
 * Amount, currency, card and installment of a payment answer are display values copied from the message the bank
 * echoes; a caller binds a payment to its order with the order's own data, never with these. An approval of a 3D
 * Host callback only says what the browser posted: it is not proof of payment until the bank confirms the order.
 */
export class VakifKatilimPosResponseDataMapper extends AbstractResponseDataMapper {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'VakifKatilimPos'
  }

  mapPaymentResponse(rawPaymentResponseData: Raw, txType: TxType, _order: PosOrder): PosResponse {
    const result = this.getDefaultPaymentResponse(txType, MODEL.NON_SECURE)
    if (!isRecord(rawPaymentResponseData) || Object.keys(rawPaymentResponseData).length === 0) {
      return result
    }

    this.logger.debug('mapping payment response', [rawPaymentResponseData])
    const raw = this.cleaned(rawPaymentResponseData)
    const procReturnCode = this.getProcReturnCode(rawPaymentResponseData)
    const message = child(raw, 'VPosMessage')
    // An approval without the message that carries the booked values is not trusted as an approval.
    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE && message !== null

    result.proc_return_code = procReturnCode
    result.status = approved ? TX_APPROVED : TX_DECLINED
    result.order_id = text(raw, 'MerchantOrderId')
    result.remote_order_id = text(raw, 'OrderId')
    result.all = raw

    if (!approved || message === null) {
      result.error_code = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE ? null : procReturnCode
      result.error_message = text(raw, 'ResponseMessage')
      this.logger.debug('mapped payment response', result)

      return result
    }

    result.auth_code = text(raw, 'ProvisionNumber')
    result.ref_ret_num = text(raw, 'RRN')
    result.batch_num = text(message, 'BatchID')
    result.transaction_id = text(raw, 'Stan')
    result.masked_number = text(message, 'CardNumber')
    result.amount = this.amount(message, 'Amount', txType)
    result.currency = this.currency(message, 'CurrencyCode', txType)
    result.installment_count = this.installment(message, 'InstallmentCount', txType)
    result.transaction_time = this.transactionTime(raw, txType)
    this.logger.debug('mapped payment response', result)

    return result
  }

  map3DPaymentData(
    raw3DAuthResponseData: Raw,
    rawPaymentResponseData: Raw | null,
    txType: TxType,
    order: PosOrder,
  ): PosResponse {
    const exact = isRecord(raw3DAuthResponseData) ? raw3DAuthResponseData : {}
    this.logger.debug('mapping 3D payment data', {
      '3d_auth_response': exact,
      provision_response: rawPaymentResponseData,
    })
    const threeDResponse = this.map3DCommonResponseData(exact)

    if (!isRecord(rawPaymentResponseData) || Object.keys(rawPaymentResponseData).length === 0) {
      // deviation: the card authentication alone is not a payment; nothing was booked, so it is never an approval
      return {
        ...this.mergeArraysPreferNonNullValues(
          this.getDefaultPaymentResponse(txType, threeDResponse.payment_model as PaymentModel),
          threeDResponse,
        ),
        status: TX_DECLINED,
      } as PosResponse
    }

    const paymentResponse = this.mapProvisionResponse(rawPaymentResponseData, txType, order)
    paymentResponse.payment_model = threeDResponse.payment_model as PaymentModel

    const merged = this.mergeArraysPreferNonNullValues(threeDResponse, paymentResponse) as PosResponse
    if (threeDResponse.status !== TX_APPROVED) {
      // A failed card authentication is never turned into an approval by a provision answer.
      merged.status = TX_DECLINED
      merged.proc_return_code = threeDResponse.proc_return_code as string | null
    }

    return merged
  }

  map3DPayResponseData(_raw3DAuthResponseData: Raw, _txType: TxType, _order: PosOrder): PosResponse {
    throw new NotImplementedError('3D Pay is not supported by this gateway')
  }

  map3DHostResponseData(raw3DAuthResponseData: Raw, txType: TxType, _order: PosOrder): PosResponse {
    const exact = isRecord(raw3DAuthResponseData) ? raw3DAuthResponseData : {}
    this.logger.debug('mapping 3D host data', { '3d_auth_response': exact })
    const raw = this.cleaned(exact)
    const response = this.getDefaultPaymentResponse(txType, MODEL.THREE_D_HOST)
    const procReturnCode = this.getProcReturnCode(exact)
    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE

    response.md_status = null
    response.md_error_message = null
    response.transaction_security = null
    response.proc_return_code = procReturnCode
    response.status = approved ? TX_APPROVED : TX_DECLINED
    response.all = raw

    if (!approved) {
      response.error_code = procReturnCode
      response.error_message = text(raw, 'ResponseMessage')
      this.logger.debug('mapped 3D host data', response)

      return response
    }

    response.order_id = text(raw, 'MerchantOrderId')
    response.remote_order_id = text(raw, 'OrderId')
    response.ref_ret_num = text(raw, 'RRN')
    response.transaction_id = text(raw, 'Stan')
    response.auth_code = text(raw, 'ProvisionNumber')
    response.transaction_time = this.valueFormatter.formatDateTime('now', txType)
    this.logger.debug('mapped 3D host data', response)

    return response
  }

  mapStatusResponse(rawResponseData: Raw): PosResponse {
    const exact = isRecord(rawResponseData) ? rawResponseData : {}
    const raw = this.cleaned(exact)
    const response = this.getDefaultStatusResponse(raw)
    const procReturnCode = this.getProcReturnCode(exact)

    if (procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE) {
      // An answer that lists several records is read by its first record.
      const [record] = this.orderRecords(exact, raw)
      if (record === undefined) return response

      return {
        ...response,
        ...this.mapOrderRecord(record, TX_TYPE.STATUS),
        order_id: text(record.clean, 'MerchantOrderId'),
        remote_order_id: text(record.clean, 'OrderId'),
      } as PosResponse
    }

    response.proc_return_code = procReturnCode
    response.error_code = procReturnCode
    response.error_message = text(raw, 'ResponseMessage')
    response.order_id = text(raw, 'MerchantOrderId')

    return response
  }

  mapRefundResponse(rawResponseData: Raw): PosResponse {
    return this.mapCancelResponse(rawResponseData)
  }

  mapCancelResponse(rawResponseData: Raw): PosResponse {
    const exact = isRecord(rawResponseData) ? rawResponseData : {}
    const raw = this.cleaned(exact)
    const result: Raw = {
      order_id: null,
      auth_code: null,
      proc_return_code: null,
      transaction_id: null,
      currency: null,
      error_message: null,
      ref_ret_num: null,
      status: TX_DECLINED,
      error_code: null,
      all: raw,
    }

    const procReturnCode = this.getProcReturnCode(exact)
    if (procReturnCode === null) {
      return result as PosResponse
    }

    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE
    result.proc_return_code = procReturnCode
    result.order_id = text(child(raw, 'VPosMessage'), 'MerchantOrderId') ?? text(raw, 'MerchantOrderId')
    result.remote_order_id = text(raw, 'OrderId')
    result.status = approved ? TX_APPROVED : TX_DECLINED

    if (approved) {
      result.transaction_id = text(raw, 'Stan')
      result.ref_ret_num = text(raw, 'RRN')
    } else {
      result.error_code = procReturnCode
      result.error_message = text(raw, 'ResponseMessage')
    }

    return result as PosResponse
  }

  mapOrderHistoryResponse(rawResponseData: Raw): PosResponse {
    const exact = isRecord(rawResponseData) ? rawResponseData : {}
    const raw = this.cleaned(exact)
    const procReturnCode = this.getProcReturnCode(exact)

    const transactions: Raw[] = []
    let orderId: string | null = null
    let remoteOrderId: string | null = null
    for (const record of this.orderRecords(exact, raw)) {
      transactions.push(this.mapOrderRecord(record, TX_TYPE.ORDER_HISTORY))
      orderId = text(record.clean, 'MerchantOrderId')
      remoteOrderId = text(record.clean, 'OrderId')
    }

    const result: Raw = {
      proc_return_code: procReturnCode,
      order_id: orderId,
      remote_order_id: remoteOrderId,
      error_code: null,
      error_message: null,
      status: procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED,
      trans_count: transactions.length,
      transactions,
      all: raw,
    }

    if (procReturnCode !== null && procReturnCode !== AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE) {
      result.error_code = procReturnCode
      result.error_message = text(raw, 'ResponseMessage')
    }

    return result as PosResponse
  }

  /** The callback `ResponseCode` is itself the 3D result: `00` means the card was authenticated. */
  is3dAuthSuccess(mdStatus: string | null): boolean {
    return mdStatus === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE
  }

  /** The exact `ResponseCode` text of the callback; anything that is not an own text field reads as null. */
  extractMdStatus(raw3DAuthResponseData: Raw): string | null {
    return this.getProcReturnCode(raw3DAuthResponseData)
  }

  protected getProcReturnCode(response: Raw): string | null {
    return exactString(response, 'ResponseCode')
  }

  /** The answer with its text trimmed and empty text read as absent; anything that is not a plain record is empty. */
  private cleaned(data: Raw): Raw {
    const cleaned = isRecord(data) ? this.emptyStringsToNull(data) : null

    return isRecord(cleaned) ? cleaned : {}
  }

  /** Mapping shared by the 3D models: the decision comes from the untouched callback, values from the cleaned one. */
  private map3DCommonResponseData(exact: Raw): Raw {
    const raw = this.cleaned(exact)
    const procReturnCode = this.getProcReturnCode(exact)
    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE

    return {
      order_id: text(raw, 'MerchantOrderId'),
      transaction_security: null,
      transaction_type: null,
      proc_return_code: procReturnCode,
      md_status: null,
      payment_model: MODEL.THREE_D_SECURE,
      status: approved ? TX_APPROVED : TX_DECLINED,
      amount: null,
      currency: null,
      tx_status: null,
      error_code: approved ? null : procReturnCode,
      md_error_message: approved ? null : text(raw, 'ResponseMessage'),
      '3d_all': raw,
    }
  }

  /** The answer to the provision request that follows a card authentication. */
  private mapProvisionResponse(rawPaymentResponseData: Raw, txType: TxType, order: PosOrder): Raw {
    const result: Raw = this.getDefaultPaymentResponse(txType, MODEL.NON_SECURE)
    this.logger.debug('mapping payment response', [rawPaymentResponseData])

    const raw = this.cleaned(rawPaymentResponseData)
    const procReturnCode = this.getProcReturnCode(rawPaymentResponseData)
    const message = child(raw, 'VPosMessage')
    // An approval without the message that carries the booked values is not trusted as an approval.
    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE && message !== null

    result.proc_return_code = procReturnCode
    result.status = approved ? TX_APPROVED : TX_DECLINED
    result.all = raw

    if (!approved || message === null) {
      result.error_code = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE ? null : procReturnCode
      result.error_message = text(raw, 'ResponseMessage')
      this.logger.debug('mapped payment response', result)

      return result
    }

    result.order_id = text(raw, 'MerchantOrderId')
    result.remote_order_id = text(raw, 'OrderId')
    result.ref_ret_num = text(raw, 'RRN')
    result.transaction_id = text(raw, 'Stan')
    result.batch_num = text(message, 'BatchId')
    result.auth_code = text(raw, 'ProvisionNumber')
    result.masked_number = text(message, 'CardNumber')
    // The bank echoes the currency of the request; the order's own currency stands in when it does not.
    result.currency =
      scalar(message, 'CurrencyCode') === null
        ? (order.currency ?? null)
        : this.currency(message, 'CurrencyCode', txType)
    result.amount = this.amount(message, 'Amount', txType)
    result.installment_count = this.installment(message, 'InstallmentCount', txType)
    result.transaction_time = this.transactionTime(raw, txType)
    this.logger.debug('mapped payment response', result)

    return result
  }

  /** The order records of an answer (one record or a list), each as the bank sent it and with its text trimmed. */
  private orderRecords(exact: Raw, cleaned: Raw): OrderRecord[] {
    const exactList = listOf(own(child(exact, 'VPosOrderData'), 'OrderContract'))
    const cleanList = listOf(own(child(cleaned, 'VPosOrderData'), 'OrderContract'))
    const records: OrderRecord[] = []
    for (const [index, record] of exactList.entries()) {
      const clean = cleanList[index]
      if (isRecord(record) && isRecord(clean)) records.push({ exact: record, clean })
    }

    return records
  }

  private mapOrderRecord({ exact, clean }: OrderRecord, txType: TxType): Raw {
    const procReturnCode = this.getProcReturnCode(exact)
    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE
    const result = this.getDefaultOrderHistoryTxResponse()

    result.proc_return_code = procReturnCode
    result.status = approved ? TX_APPROVED : TX_DECLINED
    result.error_code = approved ? null : procReturnCode
    result.error_message = approved ? null : text(clean, 'ResponseExplain')
    result.currency = this.currency(clean, 'FEC', txType)
    const security = scalar(clean, 'TransactionSecurity')
    result.payment_model = security === null ? null : this.valueMapper.mapSecureType(security, txType)
    result.ref_ret_num = text(clean, 'RRN')
    result.transaction_id = text(clean, 'Stan')
    result.transaction_time = this.time(clean, 'OrderDate', txType)

    if (!approved) return result

    result.auth_code = text(clean, 'ProvNumber')
    result.installment_count = this.installment(clean, 'InstallmentCount', txType)
    result.masked_number = text(clean, 'CardNumber')
    result.first_amount = this.amount(clean, 'FirstAmount', txType)
    const lastStatus = scalar(clean, 'LastOrderStatus') ?? scalar(clean, 'LastOrderStatusDescription')
    result.order_status = lastStatus === null ? null : this.valueMapper.mapOrderStatus(lastStatus)
    const initialStatusCode = scalar(clean, 'OrderStatus')
    const initialStatus = initialStatusCode === null ? null : this.valueMapper.mapOrderStatus(initialStatusCode)

    if (initialStatus === PAYMENT_STATUS.PAYMENT_COMPLETED) {
      const captured = scalar(clean, 'TranAmount')
      result.capture_amount = captured === null ? 0 : this.valueFormatter.formatAmount(captured, txType)
      // A zero amount is nothing that was captured.
      result.capture =
        typeof result.first_amount === 'number' &&
        result.first_amount > 0 &&
        result.first_amount === result.capture_amount
      if (result.capture) result.capture_time = result.transaction_time
    } else if (initialStatus === PAYMENT_STATUS.CANCELED) {
      result.cancel_time = result.transaction_time
    }

    return result
  }

  private amount(data: Raw | null, key: string, txType: string): number | null {
    const value = scalar(data, key)

    return value === null ? null : this.valueFormatter.formatAmount(value, txType)
  }

  private currency(data: Raw | null, key: string, txType: TxType) {
    const value = scalar(data, key)

    return value === null ? null : this.valueMapper.mapCurrency(value, txType)
  }

  private installment(data: Raw | null, key: string, txType: string): number | null {
    const value = text(data, key)

    return value === null ? null : this.valueFormatter.formatInstallment(value, txType)
  }

  /** The time of a payment answer; the year-one placeholder or no time at all means the answer is from now. */
  private transactionTime(data: Raw, txType: string): Date | null {
    const value = text(data, 'TransactionTime')
    if (value === null || NO_DATE.test(value)) return this.valueFormatter.formatDateTime('now', txType)

    return this.parsedTime(value, 'TransactionTime', txType)
  }

  /** A bank timestamp that cannot be read never hides a bank answer: the field stays null and a warning is logged. */
  private time(data: Raw | null, key: string, txType: string): Date | null {
    const value = text(data, key)
    if (value === null || NO_DATE.test(value)) return null

    return this.parsedTime(value, key, txType)
  }

  private parsedTime(value: string, field: string, txType: string): Date | null {
    try {
      return this.valueFormatter.formatDateTime(value, txType)
    } catch {
      this.logger.warn('bank timestamp could not be parsed', { field })

      return null
    }
  }
}
