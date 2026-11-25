import { NotImplementedError } from '../../../errors.js'
import { MODEL, PAYMENT_STATUS, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosOrder, PosResponse } from '../../../types.js'
import { AbstractResponseDataMapper } from './AbstractResponseDataMapper.js'
import { child, exactString, firstRecord, isRecord, NO_DATE, type Raw, scalar, text } from './boaResponseFields.js'
import { TX_APPROVED, TX_DECLINED } from './ResponseDataMapperInterface.js'

const POSITIVE_INTEGER = /^\d+$/

/** The result record of a partial or full refund answer. */
function refundResult(source: Raw): Raw | null {
  return (
    child(child(source, 'PartialDrawbackResponse'), 'PartialDrawbackResult') ??
    child(child(source, 'DrawBackResponse'), 'DrawBackResult')
  )
}

/**
 * Response mapper of the Kuveyt Turk gateway. Every decision (approved or not) is taken on the exact `ResponseCode`
 * text of the untouched answer, so padded, numeric or nested values never approve anything. The mapped amount,
 * currency, card and model of a 3D callback come from the browser-posted, unsigned `VPosMessage`: they are display
 * values and must never be used to bind a payment to an order.
 */
export class KuveytPosResponseDataMapper extends AbstractResponseDataMapper {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'KuveytPos'
  }

  mapPaymentResponse(rawPaymentResponseData: Raw, txType: TxType, _order: PosOrder): PosResponse {
    const result = this.getDefaultPaymentResponse(txType, MODEL.NON_SECURE)
    if (!isRecord(rawPaymentResponseData) || Object.keys(rawPaymentResponseData).length === 0) {
      return result
    }

    this.logger.debug('mapping payment response', [rawPaymentResponseData])
    const raw = this.emptyStringsToNull(rawPaymentResponseData)
    const procReturnCode = this.getProcReturnCode(rawPaymentResponseData)
    const vPosMessage = child(raw, 'VPosMessage')
    // An approval without the message that carries the booked values is not trusted as an approval.
    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE && vPosMessage !== null

    result.proc_return_code = procReturnCode
    result.status = approved ? TX_APPROVED : TX_DECLINED
    result.all = raw

    if (!approved || vPosMessage === null) {
      result.error_code = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE ? null : procReturnCode
      result.error_message = text(raw, 'ResponseMessage')
      this.logger.debug('mapped payment response', result)

      return result
    }

    result.auth_code = text(raw, 'ProvisionNumber')
    result.order_id = text(raw, 'MerchantOrderId')
    result.remote_order_id = text(raw, 'OrderId')
    result.ref_ret_num = text(raw, 'RRN')
    result.batch_num = text(vPosMessage, 'BatchID')
    result.transaction_id = text(raw, 'Stan')
    result.amount = this.amount(vPosMessage, 'Amount', txType)
    result.currency = this.currency(vPosMessage, 'CurrencyCode', txType)
    result.installment_count = this.installment(vPosMessage, 'InstallmentCount', txType)
    result.masked_number = text(vPosMessage, 'CardNumber')
    result.transaction_time = this.valueFormatter.formatDateTime('now', txType)
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
    const threeDResponse = this.map3DCommonResponseData(exact, txType)
    const paymentTxType = (threeDResponse.transaction_type as TxType | null) ?? txType

    if (!isRecord(rawPaymentResponseData) || Object.keys(rawPaymentResponseData).length === 0) {
      // The card authentication alone is not a payment: nothing was booked.
      return {
        ...this.mergeArraysPreferNonNullValues(
          this.getDefaultPaymentResponse(paymentTxType, threeDResponse.payment_model as PaymentModel | null),
          threeDResponse,
        ),
        status: TX_DECLINED,
      } as PosResponse
    }

    const paymentResponse = this.mapPaymentResponse(rawPaymentResponseData, paymentTxType, order)
    paymentResponse.payment_model = threeDResponse.payment_model as PaymentModel | null

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

  map3DHostResponseData(_raw3DAuthResponseData: Raw, _txType: TxType, _order: PosOrder): PosResponse {
    throw new NotImplementedError('3D Host is not supported by this gateway')
  }

  mapStatusResponse(rawResponseData: Raw): PosResponse {
    const txType = TX_TYPE.STATUS
    const exact = isRecord(rawResponseData) ? rawResponseData : {}
    const raw = this.emptyStringsToNull(exact)
    const response = this.getDefaultStatusResponse(raw)

    const resultNode = child(child(raw, 'GetMerchantOrderDetailResponse'), 'GetMerchantOrderDetailResult')
    const exactResultNode = child(child(exact, 'GetMerchantOrderDetailResponse'), 'GetMerchantOrderDetailResult')
    const orderContract = child(child(resultNode, 'Value'), 'OrderContract')
    const exactContract = child(child(exactResultNode, 'Value'), 'OrderContract')

    if (orderContract === null || exactContract === null) {
      const failure = firstRecord(child(resultNode, 'Results')?.Result)
      if (failure !== null) {
        response.error_code = text(failure, 'ErrorCode')
        response.error_message = text(failure, 'ErrorMessage')
      }

      return response
    }

    const procReturnCode = this.getProcReturnCode(exactContract)
    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE
    response.status = approved ? TX_APPROVED : TX_DECLINED
    response.proc_return_code = procReturnCode
    if (!approved) return response

    const orderStatusCode = scalar(orderContract, 'LastOrderStatus')
    const orderStatus = orderStatusCode === null ? null : this.valueMapper.mapOrderStatus(orderStatusCode)
    response.order_status = orderStatus
    response.order_id = text(orderContract, 'MerchantOrderId')
    response.remote_order_id = text(orderContract, 'OrderId')
    response.auth_code = text(orderContract, 'ProvNumber')
    response.ref_ret_num = text(orderContract, 'RRN')
    response.transaction_id = text(orderContract, 'Stan')
    response.currency = this.currency(orderContract, 'FEC', txType)
    response.first_amount = this.amount(orderContract, 'FirstAmount', txType)
    response.masked_number = text(orderContract, 'CardNumber')
    response.transaction_time = this.time(orderContract, 'OrderDate', txType)
    response.installment_count = this.installment(orderContract, 'InstallmentCount', txType)

    if (orderStatus === PAYMENT_STATUS.PAYMENT_COMPLETED) {
      response.capture_amount = response.first_amount
      response.capture = typeof response.first_amount === 'number' && response.first_amount > 0
      if (response.capture) {
        response.capture_time = this.time(orderContract, 'UpdateSystemDate', txType)
      }
    } else if (orderStatus === PAYMENT_STATUS.CANCELED) {
      response.cancel_time = this.time(orderContract, 'UpdateSystemDate', txType)
    } else if (orderStatus === PAYMENT_STATUS.FULLY_REFUNDED) {
      response.refund_time = this.time(orderContract, 'UpdateSystemDate', txType)
    }

    return response
  }

  mapRefundResponse(rawResponseData: Raw): PosResponse {
    const exact = isRecord(rawResponseData) ? rawResponseData : {}
    const raw = this.emptyStringsToNull(exact)

    return this.mapReversalResult(raw, refundResult(raw), refundResult(exact), TX_TYPE.REFUND, false)
  }

  mapCancelResponse(rawResponseData: Raw): PosResponse {
    const exact = isRecord(rawResponseData) ? rawResponseData : {}
    const raw = this.emptyStringsToNull(exact)
    const node = (source: Raw): Raw | null => child(child(source, 'SaleReversalResponse'), 'SaleReversalResult')

    return this.mapReversalResult(raw, node(raw), node(exact), TX_TYPE.CANCEL, true)
  }

  mapOrderHistoryResponse(_rawResponseData: Raw): PosResponse {
    throw new NotImplementedError('Order history is not supported by this gateway')
  }

  /** The callback `ResponseCode` is itself the 3D result: `00` means the card was authenticated. */
  is3dAuthSuccess(mdStatus: string | null): boolean {
    return mdStatus === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE
  }

  /** The exact `ResponseCode` text of the callback; anything that is not an own text field reads as null. */
  extractMdStatus(raw3DAuthResponseData: Raw): string | null {
    return this.getProcReturnCode(raw3DAuthResponseData)
  }

  /**
   * The exact `ResponseCode` text of an answer: at the top of a payment answer, under the `Value` of the drawback
   * result in a refund answer (where the refund mapping decides on it). Anything else reads as null.
   */
  override readProcReturnCode(raw: Raw): string | null {
    const exact = isRecord(raw) ? raw : {}
    const value = child(refundResult(exact), 'Value')

    return this.getProcReturnCode(exact) ?? (value === null ? null : this.getProcReturnCode(value))
  }

  protected getProcReturnCode(response: Raw): string | null {
    return exactString(response, 'ResponseCode')
  }

  protected mapResponseTransactionSecurity(_mdStatus: string): string {
    return 'MPI fallback'
  }

  /** Shared by refund and cancel answers, which have the same layout under different roots. */
  private mapReversalResult(
    raw: Raw,
    node: Raw | null,
    exactNode: Raw | null,
    txType: TxType,
    mapCurrencyAlways: boolean,
  ): PosResponse {
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

    const value = child(node, 'Value')
    const exactValue = child(exactNode, 'Value')
    const procReturnCode = exactValue === null ? null : this.getProcReturnCode(exactValue)
    if (value === null || procReturnCode === null) {
      return result as PosResponse
    }

    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE
    const failure = firstRecord(child(node, 'Results')?.Result)
    if (!approved && failure !== null) {
      result.proc_return_code = procReturnCode
      result.error_code = text(failure, 'ErrorCode') ?? procReturnCode
      result.error_message = text(failure, 'ErrorMessage')

      return result as PosResponse
    }

    result.ref_ret_num = text(value, 'RRN')
    result.transaction_id = text(value, 'Stan')
    result.proc_return_code = procReturnCode
    result.order_id = text(value, 'MerchantOrderId')
    result.remote_order_id = text(value, 'OrderId')
    result.status = approved ? TX_APPROVED : TX_DECLINED
    if (approved || mapCurrencyAlways) {
      result.currency = this.currency(value, 'CurrencyCode', txType)
    }
    if (approved) {
      result.auth_code = text(value, 'ProvisionNumber')
    } else {
      result.error_code = procReturnCode
      result.error_message = text(value, 'ResponseMessage')
    }

    return result as PosResponse
  }

  /** Mapping shared by all 3D models. The decision comes from the untouched callback, values from the cleaned one. */
  private map3DCommonResponseData(exact: Raw, txType: TxType): Raw {
    const raw = this.emptyStringsToNull(exact)
    const procReturnCode = this.getProcReturnCode(exact)
    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE
    const vPosMessage = child(raw, 'VPosMessage')

    // The top-level id is covered by the callback signature; the message copy is browser-posted.
    const orderId = text(raw, 'MerchantOrderId') ?? text(vPosMessage, 'MerchantOrderId')
    const bankTxType = scalar(vPosMessage, 'TransactionType')

    const result: Raw = {
      order_id: orderId,
      transaction_security: this.mapResponseTransactionSecurity(''),
      transaction_type: bankTxType === null ? null : this.valueMapper.mapTxType(bankTxType),
      proc_return_code: procReturnCode,
      md_status: null,
      payment_model: null,
      status: approved ? TX_APPROVED : TX_DECLINED,
      amount: null,
      currency: null,
      masked_number: null,
      tx_status: null,
      error_code: approved ? null : procReturnCode,
      md_error_message: approved ? null : text(raw, 'ResponseMessage'),
      '3d_all': raw,
    }

    if (approved) {
      const secureType = scalar(vPosMessage, 'TransactionSecurity')
      result.payment_model = secureType === null ? null : this.valueMapper.mapSecureType(secureType, txType)
      result.amount = this.amount(vPosMessage, 'Amount', txType)
      result.currency = this.currency(vPosMessage, 'CurrencyCode', txType)
      result.masked_number = text(vPosMessage, 'CardNumber')
      const batch = text(vPosMessage, 'BatchID')
      result.batch_num = batch !== null && POSITIVE_INTEGER.test(batch) && Number(batch) > 0 ? batch : null
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

  /** A bank timestamp that cannot be read never hides a bank answer: the field stays null and a warning is logged. */
  private time(data: Raw | null, key: string, txType: string): Date | null {
    const value = text(data, key)
    if (value === null || NO_DATE.test(value)) return null
    try {
      return this.valueFormatter.formatDateTime(value, txType)
    } catch {
      this.logger.warn('bank timestamp could not be parsed', { field: key })

      return null
    }
  }
}
