import { NotImplementedError } from '../../../errors.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosOrder, PosResponse } from '../../../types.js'
import { AbstractResponseDataMapper } from './AbstractResponseDataMapper.js'
import { TX_APPROVED, TX_DECLINED } from './ResponseDataMapperInterface.js'

type Raw = Record<string, unknown>

/** The bank prints "no void date" as the year-one placeholder. */
const NO_VOID_DATE = '1.1.0001 00:00:00'
const ZERO_AMOUNT = /^0+(?:[.,]0+)?$/

function isRecord(value: unknown): value is Raw {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A scalar bank field as text; objects, lists, booleans and missing keys read as null. */
function text(data: unknown, key: string): string | null {
  if (!isRecord(data) || !Object.hasOwn(data, key)) return null
  const value = data[key]
  if (typeof value === 'string') return value
  if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'bigint') return String(value)

  return null
}

/** Own string field exactly as the bank sent it (no trimming): decisions are taken on this value only. */
function exactString(data: unknown, key: string): string | null {
  if (!isRecord(data) || !Object.hasOwn(data, key)) return null
  const value = data[key]

  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Response mapper of the InterPos gateway. A payment is approved only when `ProcReturnCode` is exactly `00`; the
 * 3D authentication status is the exact text of `3DStatus` (1 to 4 count as authenticated). Both are read from the
 * untouched answer, so padded or non-text values never approve anything.
 */
export class InterPosResponseDataMapper extends AbstractResponseDataMapper {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'InterPos'
  }

  mapPaymentResponse(rawPaymentResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    const defaultResponse = this.getDefaultPaymentResponse(txType, MODEL.NON_SECURE)
    if (!isRecord(rawPaymentResponseData) || Object.keys(rawPaymentResponseData).length === 0) {
      return defaultResponse
    }

    this.logger.debug('mapping payment response', [rawPaymentResponseData])
    const raw = this.emptyStringsToNull(rawPaymentResponseData)
    const procReturnCode = this.getProcReturnCode(rawPaymentResponseData)
    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE

    const result: Raw = {
      ...defaultResponse,
      proc_return_code: procReturnCode,
      status: approved ? TX_APPROVED : TX_DECLINED,
      order_id: text(raw, 'OrderId'),
      transaction_id: text(raw, 'TransId'),
      auth_code: text(raw, 'AuthCode'),
      error_code: text(raw, 'ErrorCode'),
      error_message: text(raw, 'ErrorMessage'),
      currency: order?.currency ?? null,
      amount: order?.amount ?? null,
      all: raw,
    }
    if (approved) {
      result.transaction_time = this.parseTime(text(raw, 'TRXDATE') ?? 'now', txType, 'TRXDATE')
    }
    this.logger.debug('mapped payment response', result)

    return result as PosResponse
  }

  map3DPaymentData(
    raw3DAuthResponseData: Raw,
    rawPaymentResponseData: Raw | null,
    txType: TxType,
    _order: PosOrder,
  ): PosResponse {
    return this.map3DCommonResponseData(raw3DAuthResponseData, rawPaymentResponseData, txType, MODEL.THREE_D_SECURE)
  }

  map3DPayResponseData(raw3DAuthResponseData: Raw, txType: TxType, _order: PosOrder): PosResponse {
    return this.map3DCommonResponseData(raw3DAuthResponseData, raw3DAuthResponseData, txType, MODEL.THREE_D_PAY)
  }

  map3DHostResponseData(raw3DAuthResponseData: Raw, txType: TxType, _order: PosOrder): PosResponse {
    return this.map3DCommonResponseData(raw3DAuthResponseData, raw3DAuthResponseData, txType, MODEL.THREE_D_HOST)
  }

  mapRefundResponse(rawResponseData: Raw): PosResponse {
    return this.mapCancelResponse(rawResponseData)
  }

  mapCancelResponse(rawResponseData: Raw): PosResponse {
    const raw = this.emptyStringsToNull(isRecord(rawResponseData) ? rawResponseData : {})
    const procReturnCode = this.getProcReturnCode(rawResponseData)
    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE

    return {
      order_id: text(raw, 'OrderId'),
      group_id: null,
      auth_code: text(raw, 'AuthCode'),
      ref_ret_num: null,
      proc_return_code: procReturnCode,
      transaction_id: text(raw, 'TransId'),
      error_code: text(raw, 'ErrorCode'),
      error_message: text(raw, 'ErrorMessage'),
      status: approved ? TX_APPROVED : TX_DECLINED,
      all: raw,
    } as PosResponse
  }

  mapStatusResponse(rawResponseData: Raw): PosResponse {
    const txType = TX_TYPE.STATUS
    const exact = isRecord(rawResponseData) ? rawResponseData : {}
    const raw = this.emptyStringsToNull(exact)
    const procReturnCode = this.getProcReturnCode(exact)
    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE

    const response = this.getDefaultStatusResponse(raw)
    response.proc_return_code = procReturnCode
    response.status = approved ? TX_APPROVED : TX_DECLINED
    response.order_id = text(raw, 'OrderId')
    response.transaction_id = text(raw, 'TransId')
    response.error_code = approved ? null : procReturnCode
    response.error_message = approved ? null : text(raw, 'ErrorMessage')
    response.auth_code = text(raw, 'AuthCode')

    const purchaseAmount = text(raw, 'PurchAmount')
    if (purchaseAmount !== null && !ZERO_AMOUNT.test(purchaseAmount)) {
      response.first_amount = this.valueFormatter.formatAmount(purchaseAmount, txType)
    }
    const transactionDate = text(raw, 'TRXDATE')
    if (transactionDate !== null) {
      response.transaction_time = this.parseTime(transactionDate, txType, 'TRXDATE')
    }
    const refunded = text(raw, 'RefundedAmount')
    if (refunded !== null && !ZERO_AMOUNT.test(refunded)) {
      response.refund_amount = this.valueFormatter.formatAmount(refunded, txType)
    }
    const voidDate = text(raw, 'VoidDate')
    if (voidDate !== null && voidDate !== NO_VOID_DATE) {
      response.cancel_time = this.parseTime(voidDate, txType, 'VoidDate')
    }

    return response
  }

  mapOrderHistoryResponse(_rawResponseData: Raw): PosResponse {
    throw new NotImplementedError('Order history is not supported by this gateway')
  }

  /** Authentication counts only for the exact texts 1 to 4. */
  is3dAuthSuccess(mdStatus: string | null): boolean {
    return mdStatus === '1' || mdStatus === '2' || mdStatus === '3' || mdStatus === '4'
  }

  /** The unsigned `3DStatus` field, exactly as sent; anything that is not an own text field reads as null. */
  extractMdStatus(raw3DAuthResponseData: Raw): string | null {
    if (!isRecord(raw3DAuthResponseData) || !Object.hasOwn(raw3DAuthResponseData, '3DStatus')) return null
    const value = raw3DAuthResponseData['3DStatus']

    return typeof value === 'string' ? value : null
  }

  protected mapResponseTransactionSecurity(mdStatus: string): string {
    if (mdStatus === '1') return 'Full 3D Secure'
    if (mdStatus === '2' || mdStatus === '3' || mdStatus === '4') return 'Half 3D Secure'

    return 'MPI fallback'
  }

  protected getProcReturnCode(response: Raw): string | null {
    return exactString(response, 'ProcReturnCode')
  }

  /** A bank timestamp that cannot be read never hides a bank answer: the field stays null and a warning is logged. */
  private parseTime(value: string, txType: string, field: string): Date | null {
    try {
      return this.valueFormatter.formatDateTime(value, txType)
    } catch {
      this.logger.warn('bank timestamp could not be parsed', { field })

      return null
    }
  }

  /** The provision answer of a 3D model payment. */
  private map3DPaymentResponse(
    rawPaymentResponseData: Raw | null,
    txType: TxType,
    paymentModel: PaymentModel,
  ): PosResponse {
    const defaultResponse = this.getDefaultPaymentResponse(txType, paymentModel)
    if (!isRecord(rawPaymentResponseData) || Object.keys(rawPaymentResponseData).length === 0) {
      return defaultResponse
    }

    this.logger.debug('mapping 3d payment response', [rawPaymentResponseData])
    const raw = this.emptyStringsToNull(rawPaymentResponseData)
    const procReturnCode = this.getProcReturnCode(rawPaymentResponseData)
    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE

    const result: Raw = {
      ...defaultResponse,
      proc_return_code: procReturnCode,
      status: approved ? TX_APPROVED : TX_DECLINED,
      order_id: text(raw, 'OrderId'),
      transaction_id: text(raw, 'TransId'),
      auth_code: text(raw, 'AuthCode'),
      error_code: text(raw, 'ErrorCode'),
      error_message: text(raw, 'ErrorMessage'),
      all: raw,
    }
    const transactionDate = text(raw, 'TRXDATE')
    if (approved && transactionDate !== null) {
      result.transaction_time = this.parseTime(transactionDate, txType, 'TRXDATE')
    }
    this.logger.debug('mapped payment response', result)

    return result as PosResponse
  }

  /** Mapping shared by all 3D models. `exact` decisions come from the untouched callback. */
  private map3DCommonResponseData(
    raw3DAuthResponseData: Raw,
    rawPaymentResponseData: Raw | null,
    txType: TxType,
    paymentModel: PaymentModel,
  ): PosResponse {
    const exact = isRecord(raw3DAuthResponseData) ? raw3DAuthResponseData : {}
    const raw = this.emptyStringsToNull(exact)
    this.logger.debug('mapping 3D payment data', {
      '3d_auth_response': raw,
      provision_response: rawPaymentResponseData,
    })

    const mdStatus = this.extractMdStatus(exact)
    const procReturnCode = this.getProcReturnCode(exact)
    const payment = this.map3DPaymentResponse(rawPaymentResponseData, txType, paymentModel)

    const amount = text(raw, 'PurchAmount')
    const currency = text(raw, 'Currency')
    const transactionDate = text(raw, 'TRXDATE')

    const threeDResponse: Raw = {
      order_id: payment.order_id ?? text(raw, 'OrderId'),
      proc_return_code: payment.proc_return_code ?? procReturnCode,
      transaction_security: mdStatus === null || mdStatus === '' ? null : this.mapResponseTransactionSecurity(mdStatus),
      payment_model: paymentModel,
      md_status: mdStatus === '' ? null : mdStatus,
      masked_number: text(raw, 'Pan'),
      month: null,
      year: null,
      amount: amount === null ? null : this.valueFormatter.formatAmount(amount, txType),
      currency: currency === null ? null : this.valueMapper.mapCurrency(currency, txType),
      transaction_time:
        payment.transaction_time == null && transactionDate !== null
          ? this.parseTime(transactionDate, txType, 'TRXDATE')
          : null,
      eci: text(raw, 'Eci'),
      // TxnStat is the 3D verification result: Y success, N failure, A half secure, U technical error, E error.
      tx_status: text(raw, 'TxnStat'),
      cavv: null,
      md_error_message: text(raw, 'ErrorMessage'),
      error_code: payment.error_code ?? text(raw, 'ErrorCode'),
      error_message: payment.error_message ?? text(raw, 'ErrorMessage'),
    }
    if (paymentModel === MODEL.THREE_D_SECURE) {
      threeDResponse['3d_all'] = raw
    }

    return this.mergeArraysPreferNonNullValues(payment, threeDResponse) as PosResponse
  }
}
