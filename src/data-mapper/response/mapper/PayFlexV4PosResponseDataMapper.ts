import { NotImplementedError } from '../../../errors.js'
import { PAYMENT_STATUS, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosOrder, PosResponse } from '../../../types.js'
import { AbstractResponseDataMapper } from './AbstractResponseDataMapper.js'
import { TX_APPROVED, TX_DECLINED } from './ResponseDataMapperInterface.js'

type Raw = Record<string, unknown>

/** ECI values of a fully authenticated 3D Secure transaction: 05 (Visa/Troy/Amex), 02 (Mastercard). */
const FULL_3D_ECI: ReadonlySet<string> = new Set(['02', '05'])

/** Türkiye time (UTC+03:00), the time zone of bank timestamps. */
const BANK_TIME_OFFSET_MS = 3 * 60 * 60 * 1000

/** PHP `$data[$key] ?? null` on a value that may also be null, a scalar or a list (own keys only). */
function field(data: unknown, key: string): unknown {
  if (data !== null && typeof data === 'object' && !Array.isArray(data) && Object.hasOwn(data, key)) {
    return (data as Raw)[key] ?? null
  }

  return null
}

/** A bank field as a string, or null when missing. */
function text(data: unknown, key: string): string | null {
  const value = field(data, key)
  if (value === null) return null
  return typeof value === 'string' ? value : String(value)
}

/** A nested bank record, or an empty one when it is missing or not a single record. */
function record(data: unknown, key: string): Raw {
  const value = field(data, key)
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {}
}

/**
 * Response mapper for VakifBank / Ziraat PayFlex V4.
 *
 * VakifBank 2026 Standard API: 3D authentication succeeds only for a fully authenticated
 * callback — `Status` `Y` AND `Eci` `02`/`05` AND a non-empty `Cavv` AND `MdStatus` absent or `1`. Half secure
 * (`Eci` `06`/`01`, attempts) is declined.
 */
export class PayFlexV4PosResponseDataMapper extends AbstractResponseDataMapper {
  static override readonly PROCEDURE_SUCCESS_CODE = '0000'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayFlexV4Pos'
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

    // decided on the callback exactly as received, like the gateway does before provisioning
    const authSuccess = this.is3dAuthSuccess(this.extractMdStatus(raw3DAuthResponseData), raw3DAuthResponseData)
    const raw = this.emptyStringsToNull(raw3DAuthResponseData)
    const mdStatus = this.extractMdStatus(raw)
    const threeDAuthStatus = authSuccess ? TX_APPROVED : TX_DECLINED
    const declined = threeDAuthStatus === TX_DECLINED

    const paymentResponseData =
      authSuccess && rawPaymentResponseData !== null
        ? this.mapPaymentResponse(rawPaymentResponseData, txType, order)
        : this.getDefaultPaymentResponse(txType, null)

    const purchCurrency = text(raw, 'PurchCurrency')
    const threeDResponse: Raw = {
      eci: field(raw, 'Eci'),
      cavv: field(raw, 'Cavv'),
      auth_code: null,
      order_id: field(raw, 'VerifyEnrollmentRequestId'),
      status: threeDAuthStatus,
      currency:
        paymentResponseData.currency ??
        (purchCurrency !== null ? this.valueMapper.mapCurrency(purchCurrency, txType) : null),
      installment_count:
        paymentResponseData.installment_count ??
        this.valueFormatter.formatInstallment(text(raw, 'InstallmentCount'), txType),
      error_code: declined ? field(raw, 'ErrorCode') : null,
      error_message: declined ? field(raw, 'ErrorMessage') : null,
      md_status: mdStatus,
      md_error_message: declined ? field(raw, 'ErrorMessage') : null,
      transaction_security: null,
      all: rawPaymentResponseData,
      '3d_all': raw,
    }

    return this.mergeArraysPreferNonNullValues(threeDResponse, paymentResponseData) as PosResponse
  }

  map3DPayResponseData(_raw3DAuthResponseData: Raw, _txType: TxType, _order: PosOrder): PosResponse {
    throw new NotImplementedError('PayFlex V4 does not support the 3D Pay model')
  }

  map3DHostResponseData(_raw3DAuthResponseData: Raw, _txType: TxType, _order: PosOrder): PosResponse {
    throw new NotImplementedError('PayFlex V4 does not support the 3D Host model')
  }

  mapRefundResponse(rawResponseData: Raw): PosResponse {
    return this.mapCancelResponse(rawResponseData)
  }

  mapCancelResponse(rawResponseData: Raw): PosResponse {
    const raw = this.emptyStringsToNull(rawResponseData)
    const resultCode = this.getProcReturnCode(raw)
    const status = resultCode === PayFlexV4PosResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED
    const declined = status === TX_DECLINED

    return {
      order_id: field(raw, 'TransactionId'),
      auth_code: declined ? null : field(raw, 'AuthCode'),
      ref_ret_num: field(raw, 'Rrn'),
      proc_return_code: resultCode,
      transaction_id: field(raw, 'TransactionId'),
      error_code: declined ? resultCode : null,
      error_message: declined ? field(raw, 'ResultDetail') : null,
      status,
      all: raw,
    } as PosResponse
  }

  mapStatusResponse(rawResponseData: Raw): PosResponse {
    const txType = TX_TYPE.STATUS
    const raw = this.emptyStringsToNull(rawResponseData)
    const responseInfo = record(raw, 'ResponseInfo')
    const procReturnCode = text(responseInfo, 'ResponseCode')

    const defaultResponse = this.getDefaultStatusResponse(raw)
    defaultResponse.proc_return_code = procReturnCode
    const status = procReturnCode === PayFlexV4PosResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED
    defaultResponse.status = status
    if (status === TX_DECLINED) {
      defaultResponse.error_code = procReturnCode
      defaultResponse.error_message = text(responseInfo, 'ResponseMessage')

      return defaultResponse
    }

    const txResultInfo = record(record(raw, 'TransactionSearchResultInfo'), 'TransactionSearchResultInfo')
    const orderProcCode = this.getProcReturnCode(txResultInfo)

    let orderStatus: string = PAYMENT_STATUS.PAYMENT_COMPLETED
    if (field(txResultInfo, 'IsCanceled') === 'true') {
      orderStatus = PAYMENT_STATUS.CANCELED
    } else if (field(txResultInfo, 'IsReversed') === 'true') {
      orderStatus = 'REVERSED'
    } else if (field(txResultInfo, 'IsRefunded') === 'true') {
      orderStatus = PAYMENT_STATUS.FULLY_REFUNDED
    }

    const orderApproved = orderProcCode === PayFlexV4PosResponseDataMapper.PROCEDURE_SUCCESS_CODE
    const bankTxType = text(txResultInfo, 'TransactionType')
    const amountCode = text(txResultInfo, 'AmountCode')
    const amount = text(txResultInfo, 'CurrencyAmount') ?? text(txResultInfo, 'Amount')

    defaultResponse.order_id = text(txResultInfo, 'OrderId')
    defaultResponse.auth_code = field(txResultInfo, 'AuthCode')
    defaultResponse.transaction_id = field(txResultInfo, 'TransactionId')
    defaultResponse.ref_ret_num = field(txResultInfo, 'Rrn')
    defaultResponse.order_status = orderStatus
    defaultResponse.transaction_type = bankTxType !== null ? this.valueMapper.mapTxType(bankTxType) : null
    defaultResponse.currency = amountCode !== null ? this.valueMapper.mapCurrency(amountCode, txType) : null
    defaultResponse.first_amount = amount !== null ? this.valueFormatter.formatAmount(amount, txType) : null
    defaultResponse.capture_amount = null
    defaultResponse.status = orderApproved ? TX_APPROVED : TX_DECLINED
    defaultResponse.error_code = orderApproved ? null : text(txResultInfo, 'HostResultCode')
    defaultResponse.error_message = orderApproved ? null : text(txResultInfo, 'ResponseMessage')

    return defaultResponse
  }

  mapPaymentResponse(rawPaymentResponseData: Raw, txType: TxType, _order: PosOrder): PosResponse {
    this.logger.debug('mapping payment response', [rawPaymentResponseData])
    const raw = this.emptyStringsToNull(rawPaymentResponseData)
    const commonResponse = this.getCommonPaymentResponse(raw, txType)

    const currencyCode = text(raw, 'CurrencyCode')
    const tlAmount = field(raw, 'TLAmount')
    const bankTxType = text(raw, 'TransactionType')
    commonResponse.order_id = text(raw, 'OrderId')
    commonResponse.currency = currencyCode !== null ? this.valueMapper.mapCurrency(currencyCode, txType) : null
    commonResponse.amount =
      tlAmount !== null ? this.valueFormatter.formatAmount(tlAmount as string | number, txType) : null
    commonResponse.transaction_type = bankTxType !== null ? this.valueMapper.mapTxType(bankTxType) : null

    if (commonResponse.status === TX_APPROVED) {
      let txTime = text(raw, 'HostDate')
      if (txTime !== null && txTime.length === 10) {
        // Ziraat sends the host date without the year
        txTime = `${new Date(Date.now() + BANK_TIME_OFFSET_MS).getUTCFullYear()}${txTime}`
      }

      commonResponse.transaction_id = field(raw, 'TransactionId')
      commonResponse.transaction_time = txTime !== null ? this.valueFormatter.formatDateTime(txTime, txType) : null
      commonResponse.auth_code = field(raw, 'AuthCode')
      commonResponse.ref_ret_num = field(raw, 'TransactionId')
      commonResponse.batch_num = field(raw, 'BatchNo')
    }

    this.logger.debug('mapped payment response', commonResponse)

    return commonResponse
  }

  mapOrderHistoryResponse(_rawResponseData: Raw): PosResponse {
    throw new NotImplementedError('Order history is not supported by PayFlex V4')
  }

  /**
   * Strict 3D rule: `Status` `Y` AND `Eci` exactly `02`/`05` AND a non-blank `Cavv` AND `MdStatus`
   * absent (missing or empty) or `1`. Values are checked exactly as received (no trimming or padding), so a
   * malformed `Eci` such as `5` is rejected before it can reach the hash check or the provision request.
   * Without the callback data the rule cannot be satisfied.
   */
  is3dAuthSuccess(mdStatus: string | null, raw3DAuthResponseData: Raw | null = null): boolean {
    if (mdStatus !== 'Y' || raw3DAuthResponseData === null || typeof raw3DAuthResponseData !== 'object') {
      return false
    }

    const own = (key: string): unknown =>
      Object.hasOwn(raw3DAuthResponseData, key) ? raw3DAuthResponseData[key] : undefined

    const status = own('Status')
    const eci = own('Eci')
    const cavv = own('Cavv')
    const md = own('MdStatus')

    return (
      status === 'Y' &&
      typeof eci === 'string' &&
      FULL_3D_ECI.has(eci) &&
      typeof cavv === 'string' &&
      cavv.trim() !== '' &&
      (md === undefined || md === null || md === '' || md === '1')
    )
  }

  /** The enrollment / authentication `Status` (Y, A, N, U, E). */
  extractMdStatus(raw3DAuthResponseData: Raw): string | null {
    return text(raw3DAuthResponseData, 'Status')
  }

  /** `ResultCode` as text; a repeated or nested element (a list or record) reads as no code. */
  protected getProcReturnCode(response: Raw): string | null {
    const code = field(response, 'ResultCode')
    if (typeof code === 'string') return code
    if ((typeof code === 'number' && Number.isFinite(code)) || typeof code === 'bigint') return String(code)

    return null
  }

  private getCommonPaymentResponse(responseData: Raw, txType: TxType): PosResponse {
    const resultCode = this.getProcReturnCode(responseData)
    const status = resultCode === PayFlexV4PosResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED
    const secureType = text(responseData, 'ThreeDSecureType')
    const paymentModel = secureType !== null ? this.valueMapper.mapSecureType(secureType, txType) : null
    const response = this.getDefaultPaymentResponse(txType, paymentModel)

    response.proc_return_code = resultCode
    response.status = status
    response.error_code = status === TX_DECLINED ? resultCode : null
    response.error_message = status === TX_DECLINED ? text(responseData, 'ResultDetail') : null
    response.all = responseData

    return response
  }
}
