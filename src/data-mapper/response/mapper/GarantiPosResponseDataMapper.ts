import { NotImplementedError } from '../../../errors.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
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

/** A bank field as a string, or null when missing. */
function text(data: unknown, key: string | number): string | null {
  const value = field(data, key)
  if (value === null) return null
  return typeof value === 'string' ? value : String(value)
}

/** PHP 8 `$value > 0` for a bank string: numeric strings compare as numbers, others as strings. */
function greaterThanZero(value: string | null): boolean {
  if (value === null) return false
  const trimmed = value.trim()
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) {
    return Number(trimmed) > 0
  }

  return value > '0'
}

/** Missing or non-object values read as an empty record. */
function asRecord(value: unknown): Raw {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {}
}

/**
 * 3D Pay responses carry `requires_manual_review`: `true` when the bank authorized the payment
 * (`procreturncode` `00`) although 3D authentication failed. Such a response is `declined`
 * and the merchant must check (and void) the transaction manually.
 */
export class GarantiPosResponseDataMapper extends AbstractResponseDataMapper {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'GarantiPos'
  }

  mapPaymentResponse(rawPaymentResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    this.logger.debug('mapping payment response', [rawPaymentResponseData])
    const mappedResponse = this.mapPaymentResponseCommon(txType, MODEL.NON_SECURE, rawPaymentResponseData)
    mappedResponse.currency = order.currency ?? null
    mappedResponse.amount = order.amount ?? null

    return mappedResponse as PosResponse
  }

  map3DPaymentData(
    raw3DAuthResponseData: Raw,
    rawPaymentResponseData: Raw | null,
    txType: TxType,
    _order: PosOrder,
  ): PosResponse {
    this.logger.debug('mapping 3D payment data', {
      '3d_auth_response': raw3DAuthResponseData,
      provision_response: rawPaymentResponseData,
    })
    const raw = this.emptyStringsToNull(raw3DAuthResponseData)

    const paymentModel = MODEL.THREE_D_SECURE
    const mapped3DAuthData = this.map3DCommonResponseData(raw, txType)
    mapped3DAuthData['3d_all'] = raw

    const defaultPaymentResponse = this.getDefaultPaymentResponse(txType, paymentModel)
    let mappedPaymentResponse: Raw = {}
    if (mapped3DAuthData.status === TX_APPROVED && rawPaymentResponseData !== null) {
      mappedPaymentResponse = this.mapPaymentResponseCommon(txType, paymentModel, rawPaymentResponseData)
    }

    if (Object.keys(mappedPaymentResponse).length === 0) {
      return this.mergeArraysPreferNonNullValues(defaultPaymentResponse, mapped3DAuthData) as PosResponse
    }

    return this.mergeArraysPreferNonNullValues(mapped3DAuthData, mappedPaymentResponse) as PosResponse
  }

  map3DPayResponseData(raw3DAuthResponseData: Raw, txType: TxType, _order: PosOrder): PosResponse {
    const raw = this.emptyStringsToNull(raw3DAuthResponseData)

    const paymentModel = MODEL.THREE_D_PAY
    const threeDAuthResult = this.map3DCommonResponseData(raw, txType)
    const threeDAuthStatus = threeDAuthResult.status
    const procReturnCode = text(raw, 'procreturncode')
    const authorized = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE
    const paymentStatus = threeDAuthStatus === TX_APPROVED && authorized ? TX_APPROVED : TX_DECLINED

    const defaultPaymentResponse: Raw = this.getDefaultPaymentResponse(txType, paymentModel)
    defaultPaymentResponse.status = paymentStatus
    defaultPaymentResponse.all = raw

    if (paymentStatus !== TX_APPROVED) {
      defaultPaymentResponse.error_message = field(raw, 'errmsg')
      defaultPaymentResponse.error_code = procReturnCode
    } else {
      defaultPaymentResponse.transaction_time = this.valueFormatter.formatDateTime('now', txType)
    }

    // The bank approved the transaction although 3D authentication failed: nothing may be shipped,
    // but the money may have moved.
    const requiresManualReview = authorized && threeDAuthStatus !== TX_APPROVED
    if (requiresManualReview) {
      this.logger.warn('bank authorized the payment although 3D authentication failed; manual review required', {
        order_id: field(raw, 'oid'),
        md_status: this.extractMdStatus(raw),
        proc_return_code: procReturnCode,
      })
    }
    defaultPaymentResponse.requires_manual_review = requiresManualReview

    return this.mergeArraysPreferNonNullValues(threeDAuthResult, defaultPaymentResponse) as PosResponse
  }

  map3DHostResponseData(_raw3DAuthResponseData: Raw, _txType: TxType, _order: PosOrder): PosResponse {
    throw new NotImplementedError('3D Host payment responses are not supported by this gateway.')
  }

  mapRefundResponse(rawResponseData: Raw): PosResponse {
    return this.mapCancelResponse(rawResponseData)
  }

  mapCancelResponse(rawResponseData: Raw): PosResponse {
    const raw = this.emptyStringsToNull(rawResponseData)
    const procReturnCode = this.getProcReturnCode(raw)
    const status = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED
    const transaction = field(raw, 'Transaction')

    return {
      order_id: path(raw, 'Order', 'OrderID'),
      group_id: path(raw, 'Order', 'GroupID'),
      transaction_id: null,
      auth_code: field(transaction, 'AuthCode'),
      ref_ret_num: field(transaction, 'RetrefNum'),
      proc_return_code: procReturnCode,
      error_code: path(transaction, 'Response', 'Code'),
      error_message: path(transaction, 'Response', 'ErrorMsg'),
      status,
      all: raw,
    } as PosResponse
  }

  mapStatusResponse(rawResponseData: Raw): PosResponse {
    const raw = this.emptyStringsToNull(rawResponseData)
    const procReturnCode = this.getProcReturnCode(raw)
    const txType = TX_TYPE.STATUS
    const status = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED

    const transaction = field(raw, 'Transaction')
    const orderInqResult = path(raw, 'Order', 'OrderInqResult')
    const defaultResponse = this.getDefaultStatusResponse(raw)

    const orderStatus = text(orderInqResult, 'Status')
    const result: Raw = {
      order_id: path(raw, 'Order', 'OrderID'),
      auth_code: field(orderInqResult, 'AuthCode'),
      ref_ret_num: field(orderInqResult, 'RetrefNum'),
      installment_count: this.valueFormatter.formatInstallment(text(orderInqResult, 'InstallmentCnt'), txType),
      proc_return_code: procReturnCode,
      order_status: orderStatus !== null ? this.valueMapper.mapOrderStatus(orderStatus, txType) : null,
      status,
      error_code: status === TX_APPROVED ? null : path(transaction, 'Response', 'Code'),
      error_message: status === TX_APPROVED ? null : path(transaction, 'Response', 'ErrorMsg'),
    }

    if (status === TX_APPROVED) {
      const transTime = text(orderInqResult, 'ProvDate') ?? text(orderInqResult, 'PreAuthDate')
      const authDate = text(orderInqResult, 'AuthDate')
      const amount = text(orderInqResult, 'AuthAmount')
      const preAuthAmount = text(orderInqResult, 'PreAuthAmount')
      result.transaction_time = transTime === null ? null : this.valueFormatter.formatDateTime(transTime, txType)
      result.capture_time = authDate !== null ? this.valueFormatter.formatDateTime(authDate, txType) : null
      result.masked_number = field(orderInqResult, 'CardNumberMasked')
      result.capture_amount = amount !== null ? this.valueFormatter.formatAmount(amount, txType) : null
      const firstAmount = greaterThanZero(amount) ? amount : preAuthAmount
      result.first_amount = firstAmount !== null ? this.valueFormatter.formatAmount(firstAmount, txType) : null
      result.capture =
        ((result.first_amount as number | null) ?? 0) > 0 ? result.capture_amount === result.first_amount : null
    }

    return { ...defaultResponse, ...result } as PosResponse
  }

  mapOrderHistoryResponse(rawResponseData: Raw): PosResponse {
    const raw = this.emptyStringsToNull(rawResponseData)
    const procReturnCode = this.getProcReturnCode(raw)
    const status = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED

    const mappedTransactions: Raw[] = []
    if (status === TX_APPROVED) {
      // One transaction decodes to an object, several to a list.
      const rawTransactions = path(raw, 'Order', 'OrderHistInqResult', 'OrderTxnList', 'OrderTxn')
      const list = Array.isArray(rawTransactions) ? rawTransactions : [rawTransactions]
      for (const transaction of list) {
        if (transaction !== null && typeof transaction === 'object') {
          mappedTransactions.push(this.mapSingleOrderHistoryTransaction(asRecord(transaction)))
        }
      }
    }

    return {
      order_id: path(raw, 'Order', 'OrderID'),
      proc_return_code: procReturnCode,
      error_code: status === TX_DECLINED ? procReturnCode : null,
      error_message: status === TX_DECLINED ? path(raw, 'Transaction', 'Response', 'ErrorMsg') : null,
      status,
      trans_count: mappedTransactions.length,
      transactions: mappedTransactions,
      all: raw,
    } as PosResponse
  }

  /** mdStatus 1: full 3D Secure, 2 to 4: half 3D Secure. */
  is3dAuthSuccess(mdStatus: string | null): boolean {
    return mdStatus !== null && ['1', '2', '3', '4'].includes(mdStatus)
  }

  extractMdStatus(raw3DAuthResponseData: Raw): string | null {
    return text(raw3DAuthResponseData, 'mdstatus')
  }

  /** Common part of the 3D Secure and 3D Pay callback mapping; `raw` has been through `emptyStringsToNull`. */
  protected map3DCommonResponseData(raw: Raw, txType: TxType): Raw {
    const procReturnCode = text(raw, 'procreturncode')
    const mdStatus = this.extractMdStatus(raw)
    const responseText = text(raw, 'response')
    const approved = this.is3dAuthSuccess(mdStatus) && responseText !== 'Error'
    const status = approved ? TX_APPROVED : TX_DECLINED

    const txnType = text(raw, 'txntype')
    const amount = text(raw, 'txnamount')
    const currency = text(raw, 'txncurrencycode')
    const securityLevel = text(raw, 'secure3dsecuritylevel')

    const result: Raw = {
      order_id: field(raw, 'oid'),
      transaction_id: null,
      auth_code: null,
      ref_ret_num: null,
      transaction_security: mdStatus === null ? null : this.mapResponseTransactionSecurity(mdStatus),
      transaction_type: txnType === null ? null : this.valueMapper.mapTxType(txnType),
      proc_return_code: procReturnCode,
      md_status: mdStatus,
      status,
      masked_number: null,
      amount: amount === null ? null : this.valueFormatter.formatAmount(amount, txType),
      currency: currency === null ? null : this.valueMapper.mapCurrency(currency, txType),
      installment_count: this.valueFormatter.formatInstallment(text(raw, 'txninstallmentcount'), txType),
      tx_status: null,
      eci: null,
      cavv: null,
      error_code: responseText === 'Error' ? procReturnCode : null,
      error_message: approved ? null : field(raw, 'errmsg'),
      md_error_message: approved ? null : field(raw, 'mderrormessage'),
      payment_model: securityLevel === null ? null : this.valueMapper.mapSecureType(securityLevel, txType),
    }

    if (approved) {
      result.auth_code = field(raw, 'authcode')
      result.transaction_id = field(raw, 'transid')
      result.ref_ret_num = field(raw, 'hostrefnum')
      result.masked_number = field(raw, 'MaskedPan')
      result.tx_status = field(raw, 'txnstatus')
      result.eci = field(raw, 'eci')
      result.cavv = field(raw, 'cavv')
    }

    return result
  }

  protected mapResponseTransactionSecurity(mdStatus: string): string {
    if (!this.is3dAuthSuccess(mdStatus)) {
      return 'MPI fallback'
    }
    if (mdStatus === '1') {
      return 'Full 3D Secure'
    }

    return 'Half 3D Secure'
  }

  /** `Transaction.Response.Code` as text; a repeated or nested element (a list or record) reads as no code. */
  protected getProcReturnCode(response: Raw): string | null {
    const code = field(path(response, 'Transaction', 'Response'), 'Code')
    if (typeof code === 'string') return code
    if ((typeof code === 'number' && Number.isFinite(code)) || typeof code === 'bigint') return String(code)

    return null
  }

  private mapSingleOrderHistoryTransaction(rawTx: Raw): Raw {
    const txType = TX_TYPE.ORDER_HISTORY
    const procReturnCode = text(rawTx, 'Status')
    const status = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED

    const transaction = this.getDefaultOrderHistoryTxResponse()
    const type = text(rawTx, 'Type')
    transaction.auth_code = field(rawTx, 'AuthCode')
    transaction.ref_ret_num = field(rawTx, 'RetrefNum')
    transaction.proc_return_code = procReturnCode
    transaction.status = status
    transaction.error_code = status === TX_APPROVED ? null : procReturnCode
    transaction.transaction_type = type === null ? null : this.valueMapper.mapTxType(type)

    if (status === TX_APPROVED) {
      const transTime = text(rawTx, 'ProvDate') ?? text(rawTx, 'PreAuthDate') ?? text(rawTx, 'AuthDate')
      if (transTime !== null) {
        transaction.transaction_time = this.valueFormatter.formatDateTime(transTime, txType)
      }

      const authDate = text(rawTx, 'AuthDate')
      const amount = text(rawTx, 'AuthAmount')
      const firstAmount = greaterThanZero(amount) ? amount : text(rawTx, 'PreAuthAmount')
      const currencyCode = text(rawTx, 'CurrencyCode')
      transaction.capture_time = authDate !== null ? this.valueFormatter.formatDateTime(authDate, txType) : null
      transaction.capture_amount = amount !== null ? this.valueFormatter.formatAmount(amount, txType) : null
      transaction.first_amount = firstAmount !== null ? this.valueFormatter.formatAmount(firstAmount, txType) : null
      transaction.capture =
        ((transaction.first_amount as number | null) ?? 0) > 0
          ? transaction.capture_amount === transaction.first_amount
          : null
      transaction.currency =
        currencyCode !== '0' && currencyCode !== null ? this.valueMapper.mapCurrency(currencyCode, txType) : null
    }

    return transaction
  }

  private mapPaymentResponseCommon(txType: TxType, paymentModel: PaymentModel, rawPaymentResponseData: Raw): Raw {
    const raw = this.emptyStringsToNull(rawPaymentResponseData)
    const procReturnCode = this.getProcReturnCode(raw)
    const status = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED
    const approved = status === TX_APPROVED

    const defaultResponse = this.getDefaultPaymentResponse(txType, paymentModel)
    const transaction = field(raw, 'Transaction')
    const provDate = text(transaction, 'ProvDate') ?? 'now'

    const mappedResponse: Raw = {
      order_id: path(raw, 'Order', 'OrderID'),
      group_id: path(raw, 'Order', 'GroupID'),
      auth_code: approved ? field(transaction, 'AuthCode') : null,
      ref_ret_num: approved ? field(transaction, 'RetrefNum') : null,
      batch_num: approved ? field(transaction, 'BatchNum') : null,
      transaction_time: approved ? this.valueFormatter.formatDateTime(provDate, txType) : null,
      proc_return_code: procReturnCode,
      status,
      error_code: approved ? null : path(transaction, 'Response', 'ReasonCode'),
      error_message: approved ? null : path(transaction, 'Response', 'ErrorMsg'),
      all: raw,
    }

    this.logger.debug('mapped payment response', mappedResponse)

    return this.mergeArraysPreferNonNullValues(defaultResponse, mappedResponse)
  }
}
