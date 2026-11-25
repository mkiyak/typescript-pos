import { NotImplementedError, PosError } from '../../../errors.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosOrder, PosResponse } from '../../../types.js'
import { AbstractResponseDataMapper } from './AbstractResponseDataMapper.js'
import { TX_APPROVED, TX_DECLINED } from './ResponseDataMapperInterface.js'

type Raw = Record<string, unknown>

/** `data[key] ?? null` on a value that may be a scalar, a list or null (own keys only). */
function field(data: unknown, key: string): unknown {
  if (data !== null && typeof data === 'object' && !Array.isArray(data) && Object.hasOwn(data, key)) {
    return (data as Raw)[key] ?? null
  }

  return null
}

/** A bank field as text: a string as is, a finite number as decimal text; missing values, objects and arrays are null. */
function text(data: unknown, key: string): string | null {
  const value = field(data, key)
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return null
}

/** First non-null text among several candidate field names. */
function firstText(data: unknown, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = text(data, key)
    if (value !== null) return value
  }

  return null
}

/**
 * The query API may report a decimal-comma amount such as `1,01` (VakifBank Common Payment guide v2.1 §6.5).
 * Only that exact shape is rewritten; grouped values like `1.234,56` pass through unchanged.
 */
function normalizeAmount(value: unknown): unknown {
  if (typeof value === 'string' && /^\d+,\d{1,2}$/.test(value)) {
    return value.replace(',', '.')
  }

  return value
}

/**
 * Response mapper for VakifBank Common Payment. It maps the transaction query answer
 * (VakifBank Common Payment guide v2.1 §6.5), which carries either `Rc`/`Message`/`AuthCode`/`OrderID`
 * or `ResultCode`/`ResultDescription`/`AuthorizeId`/`OrderId`.
 */
export class PayFlexCPV4PosResponseDataMapper extends AbstractResponseDataMapper {
  static override readonly PROCEDURE_SUCCESS_CODE = '0000'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayFlexCPV4Pos'
  }

  map3DPaymentData(
    _raw3DAuthResponseData: Raw,
    _rawPaymentResponseData: Raw | null,
    _txType: TxType,
    _order: PosOrder,
  ): PosResponse {
    throw new NotImplementedError('Common Payment has no separate 3D payment step')
  }

  map3DPayResponseData(raw3DAuthResponseData: Raw, txType: TxType, _order: PosOrder): PosResponse {
    const raw = this.emptyStringsToNull(raw3DAuthResponseData)

    const response = this.getCommonPaymentResponse(raw, txType, MODEL.THREE_D_PAY)
    response.md_status = null
    response.md_error_message = null
    response.transaction_security = null
    response.transaction_id = text(raw, 'TransactionId')
    response.masked_number = text(raw, 'MaskedPan')

    if (response.status === TX_APPROVED) {
      const amount = normalizeAmount(field(raw, 'Amount'))
      const bankTxType = text(raw, 'TransactionType')
      const amountCode = text(raw, 'AmountCode')
      const hostDate = text(raw, 'HostDate')

      response.auth_code = firstText(raw, 'AuthCode', 'AuthorizeId')
      response.ref_ret_num = text(raw, 'TransactionId')
      response.order_id = firstText(raw, 'OrderID', 'OrderId')
      response.currency = amountCode !== null ? this.valueMapper.mapCurrency(amountCode, txType) : null
      response.amount = this.formatAmount(amount, txType)
      response.transaction_type = bankTxType !== null ? this.valueMapper.mapTxType(bankTxType) : null
      response.installment_count = this.valueFormatter.formatInstallment(text(raw, 'InstallmentCount'), txType)
      response.transaction_time = this.formatHostDate(hostDate, txType)
    }

    return response
  }

  map3DHostResponseData(raw3DAuthResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    const response = this.map3DPayResponseData(raw3DAuthResponseData, txType, order)
    response.payment_model = MODEL.THREE_D_HOST

    return response
  }

  mapRefundResponse(_rawResponseData: Raw): PosResponse {
    throw new NotImplementedError('Refund is not supported by Common Payment')
  }

  mapCancelResponse(_rawResponseData: Raw): PosResponse {
    throw new NotImplementedError('Cancel is not supported by Common Payment')
  }

  /** Maps the transaction query answer (VakifBank Common Payment guide v2.1 §6.5). */
  mapStatusResponse(rawResponseData: Raw): PosResponse {
    const txType = TX_TYPE.STATUS
    const raw = this.emptyStringsToNull(rawResponseData)
    const response = this.getDefaultStatusResponse(raw)
    const { status, procCode, errorMessage } = this.resolveOutcome(raw)

    response.status = status
    response.proc_return_code = procCode
    response.error_code = status === TX_DECLINED ? procCode : null
    response.error_message = errorMessage

    if (status === TX_APPROVED) {
      const amount = normalizeAmount(field(raw, 'Amount'))
      const bankTxType = text(raw, 'TransactionType')
      const amountCode = text(raw, 'AmountCode')
      const hostDate = text(raw, 'HostDate')

      response.order_id = firstText(raw, 'OrderID', 'OrderId')
      response.auth_code = firstText(raw, 'AuthCode', 'AuthorizeId')
      response.transaction_id = text(raw, 'TransactionId')
      response.ref_ret_num = text(raw, 'Rrn')
      response.transaction_time = this.formatHostDate(hostDate, txType)
      response.transaction_type = bankTxType !== null ? this.valueMapper.mapTxType(bankTxType) : null
      response.first_amount = this.formatAmount(amount, txType)
      response.currency = amountCode !== null ? this.valueMapper.mapCurrency(amountCode, txType) : null
      response.masked_number = text(raw, 'MaskedPan')
      response.installment_count = this.valueFormatter.formatInstallment(text(raw, 'InstallmentCount'), txType)
      // the query API does not report later cancels or refunds, so order_status stays null
    }

    return response
  }

  mapPaymentResponse(_rawPaymentResponseData: Raw, _txType: TxType, _order: PosOrder): PosResponse {
    throw new NotImplementedError('Common Payment has no direct payment API')
  }

  mapOrderHistoryResponse(_rawResponseData: Raw): PosResponse {
    throw new NotImplementedError('Order history is not supported by Common Payment')
  }

  is3dAuthSuccess(_mdStatus: string | null): boolean {
    return true
  }

  extractMdStatus(_raw3DAuthResponseData: Raw): string | null {
    return null
  }

  protected getProcReturnCode(response: Raw): string | null {
    return firstText(response, 'Rc', 'ResultCode')
  }

  /**
   * Only a string or number amount is formatted; anything else maps to null. The gateway binds the raw answer
   * amount, so a malformed value fails the binding instead of throwing here.
   */
  private formatAmount(amount: unknown, txType: TxType): number | null {
    return typeof amount === 'string' || typeof amount === 'number'
      ? this.valueFormatter.formatAmount(amount, txType)
      : null
  }

  /** `HostDate` is informational: an unknown format gives null and a warning instead of failing the mapping. */
  private formatHostDate(hostDate: string | null, txType: TxType): Date | null {
    if (hostDate === null) return null
    try {
      return this.valueFormatter.formatDateTime(hostDate, txType)
    } catch (e) {
      if (!(e instanceof PosError)) throw e
      this.logger.warn('unrecognized HostDate format in the transaction query answer', { HostDate: hostDate })

      return null
    }
  }

  /** Status, procedure code and message shared by the callback and query mappings. */
  private resolveOutcome(raw: Raw): {
    status: 'approved' | 'declined'
    procCode: string | null
    errorMessage: string | null
  } {
    const errorCode = text(raw, 'ErrorCode')
    if (errorCode !== null) {
      return {
        status: TX_DECLINED,
        procCode: errorCode,
        errorMessage: firstText(raw, 'Message', 'ResultDescription', 'ResponseMessage'),
      }
    }

    const procCode = this.getProcReturnCode(raw)
    if (procCode === PayFlexCPV4PosResponseDataMapper.PROCEDURE_SUCCESS_CODE) {
      return { status: TX_APPROVED, procCode, errorMessage: null }
    }

    return { status: TX_DECLINED, procCode, errorMessage: firstText(raw, 'Message', 'ResultDescription') }
  }

  private getCommonPaymentResponse(raw: Raw, txType: TxType, paymentModel: PaymentModel): PosResponse {
    const { status, procCode, errorMessage } = this.resolveOutcome(raw)
    const response = this.getDefaultPaymentResponse(txType, paymentModel)

    response.proc_return_code = procCode
    response.status = status
    response.error_code = status === TX_DECLINED ? procCode : null
    response.error_message = errorMessage
    response.all = raw

    return response
  }
}
