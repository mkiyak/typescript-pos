import { NotImplementedError } from '../../../errors.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosOrder, PosResponse } from '../../../types.js'
import { AbstractResponseDataMapper } from './AbstractResponseDataMapper.js'
import { TX_APPROVED, TX_DECLINED } from './ResponseDataMapperInterface.js'

type Raw = Record<string, unknown>

function isRecord(value: unknown): value is Raw {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A nested record, or null when the key is missing or holds anything else (string, list, null). */
function record(data: unknown, key: string): Raw | null {
  if (!isRecord(data) || !Object.hasOwn(data, key)) return null
  const value = data[key]

  return isRecord(value) ? value : null
}

/** A scalar bank field as text; objects, lists, booleans and missing keys read as null. */
function text(data: unknown, key: string): string | null {
  if (!isRecord(data) || !Object.hasOwn(data, key)) return null
  const value = data[key]
  if (typeof value === 'string') return value
  if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'bigint') return String(value)

  return null
}

/** PHP truthiness of an error code string: empty and "0" mean "no error". */
function isErrorCode(code: string | null): boolean {
  return code !== null && code !== '' && code !== '0'
}

/** Several XML elements of the same name decode to a list; the first record is used. */
function firstRecord(value: unknown): Raw | null {
  if (Array.isArray(value)) {
    return value.find(isRecord) ?? null
  }

  return isRecord(value) ? value : null
}

/**
 * The 3D result of a POSNET payment is only approved when the bank approved the resolve answer and the
 * authentication status allows it; a provision approved after a failed 3D leg is reported as declined and
 * flagged `requires_manual_review` so the merchant can void it.
 */
export class PosNetPosResponseDataMapper extends AbstractResponseDataMapper {
  static override readonly PROCEDURE_SUCCESS_CODE: string = '1'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PosNetPos'
  }

  mapPaymentResponse(rawPaymentResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    this.logger.debug('mapping payment response', [rawPaymentResponseData])
    const defaultResponse = this.getDefaultPaymentResponse(txType, MODEL.NON_SECURE)
    if (Object.keys(rawPaymentResponseData).length === 0) {
      return defaultResponse
    }

    const raw = this.emptyStringsToNull(rawPaymentResponseData)
    const mapped = this.mapProvision(raw, txType, defaultResponse)
    mapped.order_id = order.id ?? null
    mapped.currency = order.currency ?? null
    mapped.amount = order.amount ?? null

    return mapped
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

    const raw = this.emptyStringsToNull(raw3DAuthResponseData)
    const procReturnCode = this.getProcReturnCode(raw)
    const defaultResponse = this.getDefaultPaymentResponse(txType, MODEL.THREE_D_SECURE)

    const resolved = record(raw, 'oosResolveMerchantDataResponse')
    if (resolved === null) {
      defaultResponse.proc_return_code = procReturnCode
      defaultResponse.error_code = text(raw, 'respCode')
      defaultResponse.error_message = text(raw, 'respText')
      defaultResponse['3d_all'] = raw

      return defaultResponse
    }

    const mdStatus = this.extractMdStatus(raw)
    let transactionSecurity: string | null = null
    if (mdStatus === null) {
      this.logger.error('mdStatus is empty. The bank API credentials may be missing or wrong.')
    } else {
      transactionSecurity = this.mapResponseTransactionSecurity(mdStatus)
    }

    const amount = text(resolved, 'amount')
    const currency = text(resolved, 'currency')
    const threeDApproved =
      procReturnCode === PosNetPosResponseDataMapper.PROCEDURE_SUCCESS_CODE && this.is3dAuthSuccess(mdStatus)

    const threeDResponse: Raw = {
      order_id: order.id ?? null,
      remote_order_id: text(resolved, 'xid'),
      transaction_security: transactionSecurity,
      amount: amount === null ? null : this.valueFormatter.formatAmount(amount, txType),
      currency: currency === null ? null : this.valueMapper.mapCurrency(currency, txType),
      proc_return_code: procReturnCode,
      status: threeDApproved ? TX_APPROVED : TX_DECLINED,
      md_status: mdStatus,
      md_error_message: text(resolved, 'mdErrorMessage'),
      '3d_all': raw,
    }

    const paymentResponse: Raw =
      rawPaymentResponseData === null
        ? defaultResponse
        : this.mapProvisionOf3D(rawPaymentResponseData, txType, MODEL.THREE_D_SECURE)

    const result = this.mergeArraysPreferNonNullValues(threeDResponse, paymentResponse)
    if (!threeDApproved) {
      if (result.status === TX_APPROVED) {
        result.requires_manual_review = true
      }
      result.status = TX_DECLINED
    }

    return result as PosResponse
  }

  map3DPayResponseData(_raw3DAuthResponseData: Raw, _txType: TxType, _order: PosOrder): PosResponse {
    throw new NotImplementedError('3D Pay is not supported by this gateway')
  }

  map3DHostResponseData(_raw3DAuthResponseData: Raw, _txType: TxType, _order: PosOrder): PosResponse {
    throw new NotImplementedError('3D Host is not supported by this gateway')
  }

  mapRefundResponse(rawResponseData: Raw): PosResponse {
    return this.mapCancelResponse(rawResponseData)
  }

  mapCancelResponse(rawResponseData: Raw): PosResponse {
    const raw = this.emptyStringsToNull(rawResponseData)
    const errorCode = text(raw, 'respCode')
    const procReturnCode = this.getProcReturnCode(raw)
    const approved =
      procReturnCode === PosNetPosResponseDataMapper.PROCEDURE_SUCCESS_CODE &&
      Object.keys(raw).length > 0 &&
      !isErrorCode(errorCode)

    const state = text(raw, 'state')
    const results: Raw = {
      auth_code: null,
      transaction_id: null,
      ref_ret_num: null,
      group_id: null,
      date: null,
      transaction_type: state === null ? null : this.valueMapper.mapTxType(state),
      proc_return_code: procReturnCode,
      status: approved ? TX_APPROVED : TX_DECLINED,
      error_code: errorCode,
      error_message: text(raw, 'respText'),
      all: raw,
    }

    const transaction = record(raw, 'transaction')
    if (transaction !== null) {
      results.auth_code = text(transaction, 'authCode')
      results.ref_ret_num = text(transaction, 'hostlogkey')
      results.date = text(transaction, 'tranDate')
    }

    return results as PosResponse
  }

  mapStatusResponse(rawResponseData: Raw): PosResponse {
    const txType = TX_TYPE.STATUS
    const raw = this.emptyStringsToNull(rawResponseData)
    const errorCode = text(raw, 'respCode')
    const procReturnCode = this.getProcReturnCode(raw)
    const transaction = firstRecord(record(raw, 'transactions')?.transaction)

    // A status answer without a transaction record tells nothing about the order, so it is never approved.
    const approved =
      procReturnCode === PosNetPosResponseDataMapper.PROCEDURE_SUCCESS_CODE &&
      transaction !== null &&
      !isErrorCode(errorCode)

    const defaultResponse = this.getDefaultStatusResponse(raw)
    let txResults: Raw = {}
    if (transaction !== null) {
      const currency = text(transaction, 'currencyCode')
      const amount = text(transaction, 'amount')
      const state = text(transaction, 'state')
      const tranDate = text(transaction, 'tranDate')
      txResults = {
        currency: currency === null ? null : this.valueMapper.mapCurrency(currency, txType),
        first_amount: amount === null ? null : this.valueFormatter.formatAmount(amount, txType),
        transaction_type: state === null ? null : this.valueMapper.mapTxType(state),
        order_id: text(transaction, 'orderID'),
        auth_code: text(transaction, 'authCode'),
        ref_ret_num: text(transaction, 'hostlogkey'),
        // Example: 2019-10-10 11:21:14.281
        transaction_time: tranDate === null ? null : this.valueFormatter.formatDateTime(tranDate, txType),
      }
    }

    defaultResponse.proc_return_code = procReturnCode
    defaultResponse.status = approved ? TX_APPROVED : TX_DECLINED
    defaultResponse.error_code = approved ? null : errorCode
    defaultResponse.error_message = approved ? null : text(raw, 'respText')

    return this.mergeArraysPreferNonNullValues(defaultResponse, txResults)
  }

  mapOrderHistoryResponse(_rawResponseData: Raw): PosResponse {
    throw new NotImplementedError('Order history is not supported by this gateway')
  }

  is3dAuthSuccess(mdStatus: string | null): boolean {
    return mdStatus === '1' || mdStatus === '2' || mdStatus === '3' || mdStatus === '4'
  }

  extractMdStatus(raw3DAuthResponseData: Raw): string | null {
    const resolved = record(raw3DAuthResponseData, 'oosResolveMerchantDataResponse')
    if (resolved === null || !Object.hasOwn(resolved, 'mdStatus')) return null

    return typeof resolved.mdStatus === 'string' ? resolved.mdStatus : null
  }

  protected getProcReturnCode(response: Raw): string | null {
    return text(response, 'approved')
  }

  private mapResponseTransactionSecurity(mdStatus: string): string {
    if (mdStatus === '1') return 'Full 3D Secure'
    if (mdStatus === '2' || mdStatus === '3' || mdStatus === '4') return 'Half 3D Secure'

    return 'MPI fallback'
  }

  /** The provision answer of the 3D flow; an empty answer maps to the declined default. */
  private mapProvisionOf3D(rawPaymentResponseData: Raw, txType: TxType, paymentModel: PaymentModel): PosResponse {
    this.logger.debug('mapping payment response', [rawPaymentResponseData])
    const defaultResponse = this.getDefaultPaymentResponse(txType, paymentModel)
    if (Object.keys(rawPaymentResponseData).length === 0) {
      return defaultResponse
    }

    return this.mapProvision(this.emptyStringsToNull(rawPaymentResponseData), txType, defaultResponse)
  }

  /** Fills the fields both provision flows share into `target`. */
  private mapProvision(raw: Raw, txType: TxType, target: PosResponse): PosResponse {
    const errorCode = text(raw, 'respCode')
    const procReturnCode = this.getProcReturnCode(raw)
    const approved = procReturnCode === PosNetPosResponseDataMapper.PROCEDURE_SUCCESS_CODE && !isErrorCode(errorCode)

    target.auth_code = text(raw, 'authCode')
    target.ref_ret_num = text(raw, 'hostlogkey')
    target.proc_return_code = procReturnCode
    target.status = approved ? TX_APPROVED : TX_DECLINED
    target.error_code = errorCode
    target.error_message = text(raw, 'respText')
    target.all = raw

    if (approved) {
      target.installment_count = this.valueFormatter.formatInstallment(text(record(raw, 'instInfo'), 'inst1'), txType)
      target.transaction_time = this.valueFormatter.formatDateTime('now', txType)
    }

    return target
  }
}
