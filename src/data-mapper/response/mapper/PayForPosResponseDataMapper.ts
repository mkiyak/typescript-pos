import { MODEL, PAYMENT_STATUS, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosOrder, PosResponse } from '../../../types.js'
import { AbstractResponseDataMapper } from './AbstractResponseDataMapper.js'
import { TX_APPROVED, TX_DECLINED } from './ResponseDataMapperInterface.js'

type Raw = Record<string, unknown>

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
 * Response mapper of the PayFor gateway. Approval is decided on the exact bank codes: a payment is approved only
 * when `ProcReturnCode` is exactly `00`, a 3D model payment additionally needs `3DStatus` exactly `1` before its
 * provision counts, and a provision that was approved after a failed 3D leg is reported as declined and flagged
 * `requires_manual_review` so the merchant can void it.
 */
export class PayForPosResponseDataMapper extends AbstractResponseDataMapper {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayForPos'
  }

  mapPaymentResponse(rawPaymentResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    const defaultResponse = this.getDefaultPaymentResponse(txType, MODEL.NON_SECURE)
    if (Object.keys(rawPaymentResponseData).length === 0) {
      return defaultResponse
    }

    const raw = this.emptyStringsToNull(rawPaymentResponseData)
    const procReturnCode = this.getProcReturnCode(rawPaymentResponseData)
    this.logger.debug('mapping payment response', [raw])

    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE
    const mapped = {
      order_id: text(raw, 'TransId'),
      transaction_id: text(raw, 'TransId'),
      transaction_time: approved ? this.valueFormatter.formatDateTime('now', txType) : null,
      auth_code: text(raw, 'AuthCode'),
      currency: order.currency ?? null,
      amount: order.amount ?? null,
      ref_ret_num: text(raw, 'HostRefNum'),
      proc_return_code: procReturnCode,
      status: approved ? TX_APPROVED : TX_DECLINED,
      error_code: approved ? null : procReturnCode,
      error_message: approved ? null : text(raw, 'ErrMsg'),
      all: raw,
    }
    this.logger.debug('mapped payment response', mapped)

    return this.mergeArraysPreferNonNullValues(defaultResponse, mapped)
  }

  map3DPaymentData(
    raw3DAuthResponseData: Raw,
    rawPaymentResponseData: Raw | null,
    txType: TxType,
    _order: PosOrder,
  ): PosResponse {
    const raw = this.emptyStringsToNull(raw3DAuthResponseData)
    this.logger.debug('mapping 3D payment data', {
      '3d_auth_response': raw,
      provision_response: rawPaymentResponseData,
    })
    const procReturnCode = this.getProcReturnCode(raw3DAuthResponseData)
    const threeDApproved = this.is3dAuthSuccess(this.extractMdStatus(raw3DAuthResponseData))

    const mapped3D = this.map3DCommonResponseData(raw3DAuthResponseData, raw, txType)
    const effectiveTxType = (mapped3D.transaction_type as TxType | null) ?? txType
    const paymentModel = (mapped3D.payment_model as string | null) ?? MODEL.THREE_D_SECURE

    const threeDResponse = {
      transaction_id: null,
      auth_code: text(raw, 'AuthCode'),
      ref_ret_num: text(raw, 'HostRefNum'),
      order_id: text(raw, 'OrderId'),
      proc_return_code: procReturnCode,
      status: TX_DECLINED,
      error_code: threeDApproved ? null : procReturnCode,
      error_message: threeDApproved ? null : text(raw, 'ErrMsg'),
    }

    const hasProvision = rawPaymentResponseData !== null && Object.keys(rawPaymentResponseData).length > 0
    if (!hasProvision) {
      const result = this.mergeArraysPreferNonNullValues(
        this.getDefaultPaymentResponse(effectiveTxType, paymentModel as never),
        threeDResponse,
      )

      return this.mergeArraysPreferNonNullValues(result, mapped3D)
    }

    const provision = this.map3DPaymentResponseCommon(rawPaymentResponseData, effectiveTxType, paymentModel)
    const result = this.mergeArraysPreferNonNullValues(
      this.mergeArraysPreferNonNullValues(threeDResponse, mapped3D),
      provision,
    ) as Raw

    if (!threeDApproved) {
      // The provision of a payment whose 3D leg failed is never accepted. When the bank nevertheless approved it
      // the money may have moved, so the result keeps the 3D failure and asks for a manual check.
      const provisionApproved = provision.status === TX_APPROVED
      result.status = TX_DECLINED
      result.proc_return_code = procReturnCode
      result.error_code = procReturnCode
      result.error_message = text(raw, 'ErrMsg')
      if (provisionApproved) {
        result.requires_manual_review = true
      }
    }

    return result as PosResponse
  }

  map3DPayResponseData(raw3DAuthResponseData: Raw, txType: TxType, _order: PosOrder): PosResponse {
    const raw = this.emptyStringsToNull(raw3DAuthResponseData)
    const procReturnCode = this.getProcReturnCode(raw3DAuthResponseData)
    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE
    const threeDResponse = {
      transaction_id: null,
      auth_code: text(raw, 'AuthCode'),
      ref_ret_num: text(raw, 'HostRefNum'),
      order_id: text(raw, 'OrderId'),
      proc_return_code: procReturnCode,
      status: approved ? TX_APPROVED : TX_DECLINED,
      error_code: approved ? null : procReturnCode,
      error_message: approved ? null : text(raw, 'ErrMsg'),
      all: raw,
    }

    const common = this.map3DCommonResponseData(raw3DAuthResponseData, raw, txType)
    const effectiveTxType = (common.transaction_type as TxType | null) ?? txType
    const paymentModel = (common.payment_model as string | null) ?? MODEL.THREE_D_PAY
    const result = this.mergeArraysPreferNonNullValues(
      this.getDefaultPaymentResponse(effectiveTxType, paymentModel as never),
      threeDResponse,
    )

    return this.mergeArraysPreferNonNullValues(result, common)
  }

  map3DHostResponseData(raw3DAuthResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    return this.map3DPayResponseData(raw3DAuthResponseData, txType, order)
  }

  mapRefundResponse(rawResponseData: Raw): PosResponse {
    return this.mapCancelResponse(rawResponseData)
  }

  mapCancelResponse(rawResponseData: Raw): PosResponse {
    const raw = this.emptyStringsToNull(rawResponseData)
    const procReturnCode = this.getProcReturnCode(rawResponseData)
    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE

    return {
      order_id: text(raw, 'TransId'),
      auth_code: approved ? text(raw, 'AuthCode') : null,
      ref_ret_num: text(raw, 'HostRefNum'),
      proc_return_code: procReturnCode,
      transaction_id: text(raw, 'TransId'),
      error_code: approved ? null : procReturnCode,
      error_message: approved ? null : text(raw, 'ErrMsg'),
      status: approved ? TX_APPROVED : TX_DECLINED,
      all: raw,
    } as PosResponse
  }

  mapStatusResponse(rawResponseData: Raw): PosResponse {
    const txType = TX_TYPE.STATUS
    const raw = this.emptyStringsToNull(rawResponseData)
    const procReturnCode = this.getProcReturnCode(rawResponseData)
    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE

    const response = this.getDefaultStatusResponse(raw)
    const installment = text(raw, 'InstallmentCount')
    const bankTxType = text(raw, 'TxnType')
    const currency = text(raw, 'Currency')

    response.proc_return_code = procReturnCode
    response.order_id = text(raw, 'OrderId')
    response.org_order_id = text(raw, 'OrgOrderId')
    response.installment_count = this.valueFormatter.formatInstallment(installment, txType)
    response.transaction_type = bankTxType === null ? null : this.valueMapper.mapTxType(bankTxType)
    response.currency = currency === null ? null : this.valueMapper.mapCurrency(currency, txType)
    response.status = approved ? TX_APPROVED : TX_DECLINED

    if (!approved) {
      response.error_message = text(raw, 'ErrMsg')

      return response
    }

    let orderStatus: string | null = null
    response.auth_code = text(raw, 'AuthCode')
    response.ref_ret_num = text(raw, 'HostRefNum')
    response.masked_number = text(raw, 'CardMask')

    const amount = text(raw, 'PurchAmount')
    response.first_amount = amount === null ? null : this.valueFormatter.formatAmount(amount, txType)
    const insertTime = text(raw, 'InsertDatetime')
    response.transaction_time = insertTime === null ? null : this.valueFormatter.formatDateTime(insertTime, txType)
    response.capture = false
    if (response.transaction_type === TX_TYPE.PAY_AUTH || response.transaction_type === TX_TYPE.PAY_POST_AUTH) {
      response.capture = true
      response.capture_amount = response.first_amount
      response.capture_time = response.transaction_time
      orderStatus = PAYMENT_STATUS.PAYMENT_COMPLETED
    }

    const voidDate = text(raw, 'VoidDate')
    if (voidDate !== null && Number(voidDate) > 0) {
      // ex: VoidDate 20240119, VoidTime 213405. The bank drops leading zeros of the time (13405 is 01:34:05).
      const voidTime = (text(raw, 'VoidTime') ?? '0').padStart(6, '0')
      response.cancel_time = this.valueFormatter.formatDateTime(`${voidDate}T${voidTime}`, txType)
    }

    const refunded = text(raw, 'RefundedAmount')
    if (refunded !== null && Number(refunded) > 0) {
      response.refund_amount = this.valueFormatter.formatAmount(refunded, TX_TYPE.STATUS)
    }

    if (text(raw, 'IsVoided') === 'true') {
      orderStatus = PAYMENT_STATUS.CANCELED
    }
    if (text(raw, 'IsRefunded') === 'true') {
      orderStatus = PAYMENT_STATUS.FULLY_REFUNDED
    }
    response.order_status = orderStatus

    return response
  }

  mapOrderHistoryResponse(rawResponseData: Raw): PosResponse {
    const raw = this.emptyStringsToNull(rawResponseData)
    // `raw` holds the values; `exactExtended` is the same structure as the bank sent it, used for decisions.
    const extended = Object.hasOwn(raw, 'PaymentRequestExtended') ? raw.PaymentRequestExtended : null
    const exactExtended = Object.hasOwn(rawResponseData, 'PaymentRequestExtended')
      ? rawResponseData.PaymentRequestExtended
      : null

    const transactions: Raw[] = []
    let procReturnCode: string | null = null
    let status: string | null = null
    let orderId: string | null = null
    let errorMessage: string | null = null

    if (isRecord(extended) && isRecord(extended.PaymentRequest) && isRecord(exactExtended)) {
      const paymentRequest = extended.PaymentRequest
      const exactRequest = exactExtended.PaymentRequest
      procReturnCode = this.getProcReturnCode(exactRequest as Raw)
      status = TX_DECLINED
      if (procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE) {
        status = TX_APPROVED
        transactions.push(this.mapSingleOrderHistoryTransaction(paymentRequest, exactRequest))
      }
      orderId = text(paymentRequest, 'OrderId')
      errorMessage = text(paymentRequest, 'ErrMsg')
    } else if (Array.isArray(extended) && Array.isArray(exactExtended)) {
      for (const [index, item] of extended.entries()) {
        const exactItem: unknown = exactExtended[index]
        if (!isRecord(item) || !isRecord(item.PaymentRequest) || !isRecord(exactItem)) continue
        orderId = text(item.PaymentRequest, 'OrderId') ?? orderId
        transactions.push(this.mapSingleOrderHistoryTransaction(item.PaymentRequest, exactItem.PaymentRequest))
      }
    }

    const failed = procReturnCode !== null && procReturnCode !== AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE

    return {
      order_id: orderId,
      proc_return_code: procReturnCode,
      error_code: failed ? procReturnCode : null,
      error_message: failed ? errorMessage : null,
      status,
      trans_count: transactions.length,
      transactions,
      all: raw,
    } as PosResponse
  }

  /** Only an authentication status of exactly 1 lets the payment continue; 2 to 4 and everything else are refused. */
  is3dAuthSuccess(mdStatus: string | null): boolean {
    return mdStatus === '1'
  }

  extractMdStatus(raw3DAuthResponseData: Raw): string | null {
    return isRecord(raw3DAuthResponseData) &&
      Object.hasOwn(raw3DAuthResponseData, '3DStatus') &&
      typeof raw3DAuthResponseData['3DStatus'] === 'string'
      ? raw3DAuthResponseData['3DStatus']
      : null
  }

  protected getProcReturnCode(response: Raw): string | null {
    return exactString(response, 'ProcReturnCode')
  }

  /** The provision answer of a 3D model payment. */
  private map3DPaymentResponseCommon(rawPaymentResponseData: Raw, txType: TxType, paymentModel: string): PosResponse {
    const defaultResponse = this.getDefaultPaymentResponse(txType, paymentModel as never)
    const raw = this.emptyStringsToNull(rawPaymentResponseData)
    const procReturnCode = this.getProcReturnCode(rawPaymentResponseData)
    this.logger.debug('mapping payment response', [raw])

    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE
    const mapped = {
      order_id: text(raw, 'TransId'),
      transaction_id: text(raw, 'TransId'),
      auth_code: text(raw, 'AuthCode'),
      ref_ret_num: text(raw, 'HostRefNum'),
      proc_return_code: procReturnCode,
      status: approved ? TX_APPROVED : TX_DECLINED,
      error_code: approved ? null : procReturnCode,
      error_message: approved ? null : text(raw, 'ErrMsg'),
      all: raw,
    }
    this.logger.debug('mapped 3d payment response', mapped)

    return this.mergeArraysPreferNonNullValues(defaultResponse, mapped)
  }

  /**
   * Fields every 3D model has in common. `exact` is the callback as the bank sent it (decisions), `raw` the same
   * data with empty strings turned into null (values).
   */
  private map3DCommonResponseData(exact: Raw, raw: Raw, txType: TxType): Raw {
    const procReturnCode = this.getProcReturnCode(exact)
    const mdStatus = this.extractMdStatus(exact)
    const threeDApproved = this.is3dAuthSuccess(mdStatus)

    const bankTxType = text(raw, 'TxnType')
    const secureType = text(raw, 'SecureType')
    const amount = text(raw, 'PurchAmount')
    const currency = text(raw, 'Currency')

    const result: Raw = {
      transaction_security: null,
      transaction_type: bankTxType === null ? null : this.valueMapper.mapTxType(bankTxType),
      payment_model: secureType === null ? null : this.valueMapper.mapSecureType(secureType, txType),
      masked_number: text(raw, 'CardMask'),
      amount: amount === null ? null : this.valueFormatter.formatAmount(amount, txType),
      currency: currency === null ? null : this.valueMapper.mapCurrency(currency, txType),
      tx_status: text(raw, 'TxnResult'),
      md_status: mdStatus === '' ? null : mdStatus,
      md_error_code: threeDApproved ? null : procReturnCode,
      md_error_message: threeDApproved ? null : text(raw, 'ErrMsg'),
      eci: text(raw, 'Eci'),
    }

    if (threeDApproved) {
      const installment = text(raw, 'InstallmentCount')
      const transactionDate = text(raw, 'TransactionDate')
      result.installment_count = this.valueFormatter.formatInstallment(installment, txType)
      result.transaction_time =
        transactionDate === null ? null : this.valueFormatter.formatDateTime(transactionDate, txType)
      result.batch_num = text(raw, 'BatchNo')
    }

    if (result.payment_model === MODEL.THREE_D_SECURE) {
      result['3d_all'] = raw
    }

    return result
  }

  private mapSingleOrderHistoryTransaction(rawTx: Raw, exactTx: unknown): Raw {
    const txType = TX_TYPE.ORDER_HISTORY
    const procReturnCode = this.getProcReturnCode(exactTx as Raw)
    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE

    const response = this.getDefaultOrderHistoryTxResponse()
    const bankTxType = text(rawTx, 'TxnType')
    const currency = text(rawTx, 'Currency')

    response.proc_return_code = procReturnCode
    response.status = approved ? TX_APPROVED : TX_DECLINED
    response.error_code = approved ? null : procReturnCode
    response.transaction_type = bankTxType === null ? null : this.valueMapper.mapTxType(bankTxType)
    response.currency = currency === null ? null : this.valueMapper.mapCurrency(currency, txType)

    if (!approved) {
      return response
    }

    let orderStatus: string | null = null
    response.auth_code = text(rawTx, 'AuthCode')
    response.ref_ret_num = text(rawTx, 'HostRefNum')
    response.masked_number = text(rawTx, 'CardMask')
    const amount = text(rawTx, 'PurchAmount')
    response.first_amount = amount === null ? null : this.valueFormatter.formatAmount(amount, txType)
    const insertTime = text(rawTx, 'InsertDatetime')
    response.transaction_time = insertTime === null ? null : this.valueFormatter.formatDateTime(insertTime, txType)

    if (response.transaction_type === TX_TYPE.PAY_AUTH || response.transaction_type === TX_TYPE.PAY_POST_AUTH) {
      response.capture = true
      response.capture_amount = response.first_amount
      response.capture_time = response.transaction_time
      orderStatus = PAYMENT_STATUS.PAYMENT_COMPLETED
    } else if (response.transaction_type === TX_TYPE.PAY_PRE_AUTH) {
      response.capture = false
      orderStatus = PAYMENT_STATUS.PRE_AUTH_COMPLETED
    }
    response.order_status = orderStatus

    return response
  }
}
