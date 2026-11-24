import { NotImplementedError } from '../../../errors.js'
import { MODEL, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosOrder, PosResponse } from '../../../types.js'
import { AbstractResponseDataMapper } from './AbstractResponseDataMapper.js'
import { TX_APPROVED, TX_DECLINED } from './ResponseDataMapperInterface.js'

type Raw = Record<string, unknown>

/** Status answers carry this code instead of the payment success code. */
const STATUS_SUCCESS_CODE = '0000'

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

/**
 * The 3D result of a POSNET JSON payment is only approved when the authentication status is exactly 1 and the
 * bank approved the provision; a provision approved after a failed 3D leg is reported as declined and flagged
 * `requires_manual_review` so the merchant can void it.
 */
export class PosNetV1PosResponseDataMapper extends AbstractResponseDataMapper {
  static override readonly PROCEDURE_SUCCESS_CODE: string = '00'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PosNetV1Pos'
  }

  mapPaymentResponse(rawPaymentResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    this.logger.debug('mapping payment response', [rawPaymentResponseData])
    const defaultResponse = this.getDefaultPaymentResponse(txType, MODEL.NON_SECURE)
    if (Object.keys(rawPaymentResponseData).length === 0) {
      return defaultResponse
    }

    const mapped = this.mapProvision(this.emptyStringsToNull(rawPaymentResponseData), txType, defaultResponse)
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

    const mdStatus = this.extractMdStatus(raw)
    const threeDApproved = this.is3dAuthSuccess(mdStatus)
    const transactionSecurity = mdStatus === null ? null : this.mapResponseTransactionSecurity(mdStatus)

    // The callback may refine a payment into a pre-authorisation, but it never selects another kind of
    // transaction: the type decides how amounts are parsed.
    const tranType = text(raw, 'TranType')
    const callbackTxType = tranType === null ? null : this.valueMapper.mapTxType(tranType)
    const effectiveTxType: TxType =
      callbackTxType === TX_TYPE.PAY_AUTH || callbackTxType === TX_TYPE.PAY_PRE_AUTH ? callbackTxType : txType

    const amount = text(raw, 'Amount')
    const currency = text(raw, 'CurrencyCode')
    const threeDResponse: Raw = {
      order_id: order.id ?? null,
      remote_order_id: text(raw, 'OrderId'),
      transaction_security: transactionSecurity,
      masked_number: text(raw, 'CCPrefix'),
      proc_return_code: null,
      currency: currency === null ? null : this.valueMapper.mapCurrency(currency, effectiveTxType),
      status: TX_DECLINED,
      md_status: mdStatus,
      md_error_message: threeDApproved ? null : text(raw, 'MdErrorMessage'),
      amount: amount === null ? null : this.valueFormatter.formatAmount(amount, effectiveTxType),
      '3d_all': raw,
    }

    this.logger.debug('mapping payment response', [rawPaymentResponseData])
    const defaultResponse = this.getDefaultPaymentResponse(effectiveTxType, MODEL.THREE_D_SECURE)
    const paymentResponse: PosResponse =
      rawPaymentResponseData === null || Object.keys(rawPaymentResponseData).length === 0
        ? defaultResponse
        : this.mapProvision(this.emptyStringsToNull(rawPaymentResponseData), effectiveTxType, defaultResponse)

    const result = this.mergeArraysPreferNonNullValues(threeDResponse, paymentResponse) as Raw
    const provisionApproved = paymentResponse.status === TX_APPROVED
    result.status = threeDApproved && provisionApproved ? TX_APPROVED : TX_DECLINED
    if (provisionApproved && !threeDApproved) {
      result.requires_manual_review = true
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
    const procReturnCode = this.getProcReturnCode(raw)
    const approved = procReturnCode === PosNetV1PosResponseDataMapper.PROCEDURE_SUCCESS_CODE

    return {
      auth_code: null,
      transaction_id: null,
      ref_ret_num: null,
      group_id: null,
      transaction_type: null,
      proc_return_code: procReturnCode,
      status: approved ? TX_APPROVED : TX_DECLINED,
      error_code: approved ? null : procReturnCode,
      error_message: approved ? null : this.getResponseDescription(raw),
      all: raw,
    } as unknown as PosResponse
  }

  mapStatusResponse(rawResponseData: Raw): PosResponse {
    const txType = TX_TYPE.STATUS
    const raw = this.emptyStringsToNull(rawResponseData)
    const procReturnCode = this.getProcReturnCode(raw)
    const transactions = Object.hasOwn(raw, 'TransactionData') ? raw.TransactionData : null

    // An approved status answer carries the list of the order's transactions; without a list it tells nothing.
    const approved = procReturnCode === STATUS_SUCCESS_CODE && Array.isArray(transactions)

    const defaultResponse = this.getDefaultStatusResponse(raw)
    defaultResponse.proc_return_code = procReturnCode
    defaultResponse.status = approved ? TX_APPROVED : TX_DECLINED
    defaultResponse.error_code = approved ? null : procReturnCode
    defaultResponse.error_message = approved ? null : this.getResponseDescription(raw)

    if (!approved) {
      return defaultResponse
    }

    // Cancelled and finalised transactions answer "1", every other transaction answers "0".
    const rawTx = (transactions as unknown[]).find((item) => isRecord(item) && text(item, 'TransactionStatus') === '1')
    if (!isRecord(rawTx)) {
      return defaultResponse
    }

    const amount = text(rawTx, 'Amount')
    const transactionDate = text(rawTx, 'TransactionDate')
    const currency = text(rawTx, 'CurrencyCode')
    const bankTxType = text(rawTx, 'TransactionType')

    defaultResponse.first_amount = amount === null ? null : this.valueFormatter.formatAmount(amount, txType)
    defaultResponse.transaction_time =
      transactionDate === null ? null : this.valueFormatter.formatDateTime(transactionDate, txType)
    defaultResponse.currency = currency === null ? null : this.valueMapper.mapCurrency(currency, txType)
    defaultResponse.masked_number = text(rawTx, 'CardNo')
    defaultResponse.order_id = text(rawTx, 'OrderId')
    const mappedTxType = bankTxType === null ? null : this.valueMapper.mapTxType(bankTxType)
    defaultResponse.transaction_type = mappedTxType
    if (mappedTxType !== null) {
      defaultResponse.order_status = this.valueMapper.mapOrderStatus(mappedTxType)
    }

    if (mappedTxType === TX_TYPE.REFUND) {
      defaultResponse.refund_time = defaultResponse.transaction_time
    } else if (mappedTxType === TX_TYPE.CANCEL) {
      defaultResponse.cancel_time = defaultResponse.transaction_time
    }

    return defaultResponse
  }

  mapOrderHistoryResponse(_rawResponseData: Raw): PosResponse {
    throw new NotImplementedError('Order history is not supported by this gateway')
  }

  /**
   * Only status 1 (authentication succeeded) allows the payment to continue. 2 to 4 (the card or its bank is not
   * enrolled, authentication was only attempted) and every other value are not accepted.
   */
  is3dAuthSuccess(mdStatus: string | null): boolean {
    return mdStatus === '1'
  }

  extractMdStatus(raw3DAuthResponseData: Raw): string | null {
    if (!Object.hasOwn(raw3DAuthResponseData, 'MdStatus')) return null

    return typeof raw3DAuthResponseData.MdStatus === 'string' ? raw3DAuthResponseData.MdStatus : null
  }

  protected getProcReturnCode(response: Raw): string | null {
    return text(record(response, 'ServiceResponseData'), 'ResponseCode')
  }

  private getResponseDescription(response: Raw): string | null {
    return text(record(response, 'ServiceResponseData'), 'ResponseDescription')
  }

  private mapResponseTransactionSecurity(mdStatus: string): string {
    if (mdStatus === '1') return 'Full 3D Secure'
    if (mdStatus === '2' || mdStatus === '3' || mdStatus === '4') return 'Half 3D Secure'

    return 'MPI fallback'
  }

  /** Fills the fields of a provision answer into `target`. */
  private mapProvision(raw: Raw, txType: TxType, target: PosResponse): PosResponse {
    const procReturnCode = this.getProcReturnCode(raw)
    const approved = procReturnCode === PosNetV1PosResponseDataMapper.PROCEDURE_SUCCESS_CODE

    target.auth_code = text(raw, 'AuthCode')
    target.ref_ret_num = text(raw, 'ReferenceCode')
    target.proc_return_code = procReturnCode
    target.status = approved ? TX_APPROVED : TX_DECLINED
    target.error_code = approved ? null : procReturnCode
    target.error_message = approved ? null : this.getResponseDescription(raw)
    target.all = raw

    if (approved) {
      target.installment_count = this.valueFormatter.formatInstallment(
        text(record(raw, 'InstallmentData'), 'InstallmentCount'),
        txType,
      )
      target.transaction_time = this.valueFormatter.formatDateTime('now', txType)
    }

    return target
  }
}
