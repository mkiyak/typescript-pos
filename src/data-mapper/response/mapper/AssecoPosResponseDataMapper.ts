import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosOrder, PosResponse } from '../../../types.js'
import { AbstractResponseDataMapper } from './AbstractResponseDataMapper.js'
import { TX_APPROVED, TX_DECLINED } from './ResponseDataMapperInterface.js'

type Raw = Record<string, unknown>

/** PHP `$data[$key] ?? null` on an array that may also be null, a scalar or a list. */
function field(data: unknown, key: string | number): unknown {
  if (data !== null && typeof data === 'object' && Object.hasOwn(data, key)) {
    return (data as Raw)[key as string] ?? null
  }

  return null
}

/** A bank field as a string, or null when missing (values are strings after XML decoding). */
function text(data: unknown, key: string | number): string | null {
  const value = field(data, key)
  if (value === null) return null
  return typeof value === 'string' ? value : String(value)
}

/** A string or finite number as text; anything else (lists, records, booleans, missing) reads as null. */
function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'bigint') return String(value)

  return null
}

/** PHP `(int)` cast of a numeric string. */
function phpInt(value: string | null): number {
  if (value === null) return 0
  const n = Number.parseInt(value.trim(), 10)
  return Number.isNaN(n) ? 0 : n
}

/** PHP 8 `$value > 0` for a bank string: numeric strings compare as numbers, others as strings. */
function greaterThanZero(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) {
    return Number(trimmed) > 0
  }

  return value > '0'
}

/**
 * 3D Pay and 3D Host responses carry `requires_manual_review`. It is `true` when the bank
 * authorized the payment (`ProcReturnCode` `00`) although 3D authentication failed (mdStatus is not `1`); such a
 * response is `declined` and the merchant must check (and void) the transaction manually.
 */
export class AssecoPosResponseDataMapper extends AbstractResponseDataMapper {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'AssecoPos'
  }

  mapPaymentResponse(rawPaymentResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    this.logger.debug('mapping payment response', [rawPaymentResponseData])

    const defaultResponse = this.getDefaultPaymentResponse(txType, MODEL.NON_SECURE)
    if (Object.keys(rawPaymentResponseData).length === 0) {
      return defaultResponse
    }

    const raw = this.emptyStringsToNull(rawPaymentResponseData)
    const procReturnCode = this.getProcReturnCode(raw)
    const status = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED
    const approved = status === TX_APPROVED

    const extra = field(raw, 'Extra')
    const trxDate = text(extra, 'TRXDATE')

    const mappedResponse: Raw = {
      order_id: field(raw, 'OrderId'),
      currency: order.currency ?? null,
      amount: order.amount ?? null,
      group_id: field(raw, 'GroupId'),
      transaction_id: field(raw, 'TransId'),
      transaction_time: approved && trxDate !== null ? this.valueFormatter.formatDateTime(trxDate, txType) : null,
      auth_code: field(raw, 'AuthCode'),
      ref_ret_num: field(raw, 'HostRefNum'),
      proc_return_code: procReturnCode,
      status,
      error_code: approved ? null : field(extra, 'ERRORCODE'),
      error_message: approved ? null : field(raw, 'ErrMsg'),
      recurring_id: field(extra, 'RECURRINGID'), // set when a recurring payment is made
      all: raw,
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

    const raw = this.emptyStringsToNull(raw3DAuthResponseData)
    const paymentModel = this.mapSecureType(raw, txType)
    let paymentResponseData = this.getDefaultPaymentResponse(txType, paymentModel)
    const mdStatus = this.extractMdStatus(raw)
    if (rawPaymentResponseData !== null) {
      paymentResponseData = this.mapPaymentResponse(rawPaymentResponseData, txType, order)
    }

    const amount = field(raw, 'amount')
    const threeDResponse: Raw = {
      transaction_security: mdStatus === null ? null : this.mapResponseTransactionSecurity(mdStatus),
      md_status: mdStatus,
      order_id: field(raw, 'oid'),
      masked_number: field(raw, 'maskedCreditCard'),
      month: field(raw, 'Ecom_Payment_Card_ExpDate_Month'),
      year: field(raw, 'Ecom_Payment_Card_ExpDate_Year'),
      amount: amount !== null ? this.valueFormatter.formatAmount(amount as string, txType) : null,
      currency: this.mapCurrency(raw, txType),
      installment_count: this.valueFormatter.formatInstallment(text(raw, 'taksit'), txType),
      eci: null,
      tx_status: null,
      cavv: null,
      md_error_message: null,
      '3d_all': raw,
    }

    if (mdStatus !== null) {
      if (!this.is3dAuthSuccess(mdStatus)) {
        threeDResponse.md_error_message = field(raw, 'mdErrorMsg')
      }
    } else {
      threeDResponse.error_code = field(raw, 'ErrorCode')
      threeDResponse.error_message = field(raw, 'ErrMsg')
    }

    if (this.is3dAuthSuccess(mdStatus)) {
      threeDResponse.eci = field(raw, 'eci')
      threeDResponse.cavv = field(raw, 'cavv')
    }

    const result = this.mergeArraysPreferNonNullValues(threeDResponse, paymentResponseData)
    result.payment_model = paymentModel

    return result as PosResponse
  }

  map3DPayResponseData(raw3DAuthResponseData: Raw, txType: TxType, _order: PosOrder): PosResponse {
    const raw = this.emptyStringsToNull(raw3DAuthResponseData)
    const procReturnCode = this.getProcReturnCode(raw)
    const mdStatus = this.extractMdStatus(raw)
    const authSuccess = this.is3dAuthSuccess(mdStatus)
    const provisioned = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE
    const status = provisioned && authSuccess ? TX_APPROVED : TX_DECLINED

    const paymentModel = this.mapSecureType(raw, txType)
    const defaultResponse = this.getDefaultPaymentResponse(txType, paymentModel)

    const response: Raw = {
      order_id: field(raw, 'oid'),
      transaction_security: mdStatus === null ? null : this.mapResponseTransactionSecurity(mdStatus),
      md_status: mdStatus,
      status,
      proc_return_code: procReturnCode,
      masked_number: field(raw, 'maskedCreditCard'),
      month: field(raw, 'Ecom_Payment_Card_ExpDate_Month'),
      year: field(raw, 'Ecom_Payment_Card_ExpDate_Year'),
      amount: this.valueFormatter.formatAmount((field(raw, 'amount') ?? 0) as string, txType),
      currency: this.mapCurrency(raw, txType),
      installment_count: this.valueFormatter.formatInstallment(text(raw, 'taksit'), txType),
      tx_status: null,
      eci: null,
      cavv: null,
      md_error_message: field(raw, 'mdErrorMsg'),
      all: raw,
    }

    if (status === TX_APPROVED) {
      const trxDate = text(raw, 'EXTRA_TRXDATE')
      response.auth_code = field(raw, 'AuthCode')
      response.eci = field(raw, 'eci')
      response.cavv = field(raw, 'cavv')
      response.transaction_id = field(raw, 'TransId')
      response.transaction_time = trxDate !== null ? this.valueFormatter.formatDateTime(trxDate, txType) : null
      response.ref_ret_num = field(raw, 'HostRefNum')
      response.error_message = field(raw, 'ErrMsg')
      response.error_code = field(raw, 'ErrMsg') !== null ? procReturnCode : null
    }

    response.requires_manual_review = this.requiresManualReview(raw, procReturnCode, authSuccess)

    return this.mergeArraysPreferNonNullValues(defaultResponse, response)
  }

  map3DHostResponseData(raw3DAuthResponseData: Raw, txType: TxType, _order: PosOrder): PosResponse {
    const raw = this.emptyStringsToNull(raw3DAuthResponseData)
    const mdStatus = this.extractMdStatus(raw)
    const authSuccess = this.is3dAuthSuccess(mdStatus)
    const status = authSuccess ? TX_APPROVED : TX_DECLINED

    const paymentModel = this.mapSecureType(raw, txType)
    const defaultResponse = this.getDefaultPaymentResponse(txType, paymentModel)

    const response: Raw = {
      order_id: field(raw, 'oid'),
      transaction_security: mdStatus === null ? null : this.mapResponseTransactionSecurity(mdStatus),
      md_status: mdStatus,
      status,
      amount: this.valueFormatter.formatAmount((field(raw, 'amount') ?? 0) as string, txType),
      currency: this.mapCurrency(raw, txType),
      installment_count: this.valueFormatter.formatInstallment(text(raw, 'taksit'), txType),
      tx_status: null,
      masked_number: null,
      month: null,
      year: null,
      eci: null,
      cavv: null,
      md_error_message: status !== TX_APPROVED ? field(raw, 'mdErrorMsg') : null,
      all: raw,
    }

    if (field(raw, 'maskedCreditCard') !== null) {
      response.masked_number = field(raw, 'maskedCreditCard')
      response.month = field(raw, 'Ecom_Payment_Card_ExpDate_Month')
      response.year = field(raw, 'Ecom_Payment_Card_ExpDate_Year')
      if (status === TX_APPROVED) {
        response.eci = field(raw, 'eci')
        response.cavv = field(raw, 'cavv')
        response.transaction_time = this.valueFormatter.formatDateTime('now', txType)
      }
    }

    response.requires_manual_review = this.requiresManualReview(raw, this.getProcReturnCode(raw), authSuccess)

    return this.mergeArraysPreferNonNullValues(defaultResponse, response)
  }

  mapRefundResponse(rawResponseData: Raw): PosResponse {
    const raw = this.emptyStringsToNull(rawResponseData)
    const procReturnCode = this.getProcReturnCode(raw)
    const status = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED
    const extra = field(raw, 'Extra')

    const result: Raw = {
      order_id: field(raw, 'OrderId'),
      group_id: null,
      auth_code: null,
      ref_ret_num: field(raw, 'HostRefNum'),
      proc_return_code: procReturnCode,
      transaction_id: field(raw, 'TransId'),
      num_code: null,
      error_code: null,
      error_message: field(raw, 'ErrMsg'),
      status,
      all: raw,
    }

    if (status === TX_APPROVED) {
      result.group_id = field(raw, 'GroupId')
      result.auth_code = field(raw, 'AuthCode')
      result.num_code = field(extra, 'NUMCODE')
    } else {
      result.error_code = field(extra, 'ERRORCODE') ?? field(raw, 'ERRORCODE')
    }

    return result as PosResponse
  }

  mapCancelResponse(rawResponseData: Raw): PosResponse {
    const raw = this.emptyStringsToNull(rawResponseData)
    const procReturnCode = this.getProcReturnCode(raw)
    let status: PosResponse['status'] =
      procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED

    if (field(raw, 'RECURRINGOPERATION') !== null) {
      if (field(raw, 'RESULT') === 'Successfull') {
        status = TX_APPROVED
      }

      return this.withBaseKeys({
        order_id: field(raw, 'RECORDID'),
        status,
        all: raw,
        proc_return_code: procReturnCode,
      }) as PosResponse
    }

    const extra = field(raw, 'Extra')
    const result: Raw = {
      order_id: field(raw, 'OrderId'),
      group_id: null,
      auth_code: null,
      ref_ret_num: field(raw, 'HostRefNum'),
      proc_return_code: procReturnCode,
      transaction_id: field(raw, 'TransId'),
      error_code: null,
      num_code: null,
      error_message: field(raw, 'ErrMsg'),
      status,
      all: raw,
    }

    if (status === TX_APPROVED) {
      result.group_id = field(raw, 'GroupId')
      result.auth_code = field(raw, 'AuthCode')
      result.num_code = field(extra, 'NUMCODE')
    } else {
      result.error_code = field(extra, 'ERRORCODE') ?? field(raw, 'ERRORCODE')
    }

    return result as PosResponse
  }

  mapStatusResponse(rawResponseData: Raw): PosResponse {
    const txType = TX_TYPE.STATUS
    const raw = this.emptyStringsToNull(rawResponseData)
    const procReturnCode = this.getProcReturnCode(raw)
    const status = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED

    const extra = field(raw, 'Extra')
    if (field(extra, 'RECURRINGID') !== null) {
      return this.mapRecurringStatusResponse(raw)
    }

    const result: Raw = this.getDefaultStatusResponse(raw)
    result.order_id = field(raw, 'OrderId')
    result.proc_return_code = procReturnCode
    result.transaction_id = field(raw, 'TransId')
    result.error_message = status === TX_APPROVED ? null : field(raw, 'ErrMsg')
    result.status = status

    if (status === TX_APPROVED) {
      const captureAmount = text(extra, 'CAPTURE_AMT')
      const chargeType = text(extra, 'CHARGE_TYPE_CD')
      const transStat = text(extra, 'TRANS_STAT')
      result.auth_code = field(extra, 'AUTH_CODE')
      result.ref_ret_num = field(extra, 'HOST_REF_NUM')
      result.first_amount = this.valueFormatter.formatAmount(text(extra, 'ORIG_TRANS_AMT') ?? 0, txType)
      result.capture_amount = captureAmount !== null ? this.valueFormatter.formatAmount(captureAmount, txType) : null
      result.masked_number = field(extra, 'PAN')
      result.num_code = field(extra, 'NUMCODE')
      result.capture = result.first_amount === result.capture_amount
      result.transaction_type = chargeType === null ? null : this.valueMapper.mapTxType(chargeType)
      result.order_status = transStat === null ? null : this.valueMapper.mapOrderStatus(transStat)
      result.transaction_time = this.formatOptionalDateTime(text(extra, 'AUTH_DTTM'), txType)
      result.capture_time = this.formatOptionalDateTime(text(extra, 'CAPTURE_DTTM'), txType)
      result.cancel_time = this.formatOptionalDateTime(text(extra, 'VOID_DTTM'), txType)
    }

    return result as PosResponse
  }

  /** Status of a recurring order (`Extra.RECURRINGID` set) with one entry per installment order. */
  mapRecurringStatusResponse(rawResponseData: Raw): PosResponse {
    const extra = field(rawResponseData, 'Extra')
    const recurringCount = text(extra, 'RECURRINGCOUNT')
    // when no order is found for the given recurring order id then RECURRINGCOUNT = 0
    const status = recurringCount !== null && greaterThanZero(recurringCount) ? TX_APPROVED : TX_DECLINED

    const recurringOrderResponse: Raw = {
      recurringId: field(extra, 'RECURRINGID'),
      recurringInstallmentCount: recurringCount,
      status,
      num_code: field(extra, 'NUMCODE'),
      error_message: status !== TX_APPROVED ? field(rawResponseData, 'ErrMsg') : null,
      all: rawResponseData,
      proc_return_code: this.getProcReturnCode(rawResponseData),
    }

    const recurringOrders: Raw[] = []
    for (let i = 1; field(extra, `ORD_ID_${i}`) !== null; i++) {
      recurringOrders.push(this.mapSingleRecurringOrderStatus(extra, i))
    }
    if (recurringOrders.length > 0) {
      recurringOrderResponse.recurringOrders = recurringOrders
    }

    return this.withBaseKeys(recurringOrderResponse) as PosResponse
  }

  mapOrderHistoryResponse(rawResponseData: Raw): PosResponse {
    const raw = this.emptyStringsToNull(rawResponseData)
    const procReturnCode = this.getProcReturnCode(raw)
    const status = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE ? TX_APPROVED : TX_DECLINED
    const extra = field(raw, 'Extra')

    const transactions: Raw[] = []
    for (let i = 1; field(extra, `TRX${i}`) !== null; i++) {
      const rawTx = (text(extra, `TRX${i}`) as string).split('\t')
      transactions.push(this.mapSingleOrderHistoryTransaction(rawTx))
    }

    const result: Raw = {
      order_id: field(raw, 'OrderId'),
      proc_return_code: procReturnCode,
      error_message: field(raw, 'ErrMsg'),
      num_code: field(extra, 'NUMCODE'),
      trans_count: phpInt(text(extra, 'TRXCOUNT')),
      transactions: transactions.reverse(),
      status,
      all: raw,
    }

    return this.withBaseKeys(result) as PosResponse
  }

  is3dAuthSuccess(mdStatus: string | null): boolean {
    return mdStatus === '1'
  }

  extractMdStatus(raw3DAuthResponseData: Raw): string | null {
    return text(raw3DAuthResponseData, 'mdStatus')
  }

  protected mapResponseTransactionSecurity(mdStatus: string): string {
    if (mdStatus === '1') {
      return 'Full 3D Secure'
    }
    if (mdStatus === '2' || mdStatus === '3' || mdStatus === '4') {
      return 'Half 3D Secure'
    }

    return 'MPI fallback'
  }

  /**
   * The result of a raw answer: its `ProcReturnCode` when present. The bank answers some declines and errors without
   * one (`Response` `Declined` or `Error`, the reason in `Extra.ERRORCODE`); such an answer still says that nothing was
   * done, so its error code, or else the `Response` text, is its result. Any other answer without `ProcReturnCode`
   * (an `Approved` one included) carries no result.
   */
  override readProcReturnCode(raw: Raw): string | null {
    const code = this.getProcReturnCode(raw)
    if (code !== null) return code

    const response = field(raw, 'Response')
    if (response !== 'Declined' && response !== 'Error') return null
    const extra = field(raw, 'Extra')
    const errorCode = extra !== null && !Array.isArray(extra) ? scalarText(field(extra, 'ERRORCODE')) : null

    return errorCode !== null && errorCode.trim() !== '' ? errorCode : response
  }

  /** `ProcReturnCode` as text; a repeated or nested element (a list or record) reads as no code. */
  protected getProcReturnCode(response: Raw): string | null {
    return scalarText(field(response, 'ProcReturnCode'))
  }

  /**
   * The bank authorized the payment although 3D authentication failed. The response stays `declined`;
   * the flag tells the merchant to check (and void) the transaction.
   */
  private requiresManualReview(raw: Raw, procReturnCode: string | null, authSuccess: boolean): boolean {
    const review = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE && !authSuccess
    if (review) {
      this.logger.warn('bank authorized the payment although 3D authentication failed; manual review required', {
        order_id: field(raw, 'oid'),
        md_status: field(raw, 'mdStatus'),
        proc_return_code: procReturnCode,
      })
    }

    return review
  }

  private mapSecureType(raw: Raw, txType: TxType): PaymentModel | null {
    return this.valueMapper.mapSecureType(text(raw, 'storetype') ?? '', txType)
  }

  private mapCurrency(raw: Raw, txType: TxType): PosResponse['currency'] {
    return this.valueMapper.mapCurrency(text(raw, 'currency') ?? '', txType)
  }

  private formatOptionalDateTime(value: string | null, txType: TxType): Date | null {
    return value === null ? null : this.valueFormatter.formatDateTime(value, txType)
  }

  private mapSingleOrderHistoryTransaction(rawTxData: string[]): Raw {
    const txType = TX_TYPE.ORDER_HISTORY
    const rawTx = this.emptyStringsToNull(rawTxData) as Array<string | null>
    const at = (index: number): string | null => rawTx[index] ?? null

    const transaction = this.getDefaultOrderHistoryTxResponse()
    transaction.auth_code = at(8)
    transaction.proc_return_code = at(9)
    if (transaction.proc_return_code === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE) {
      transaction.status = TX_APPROVED
    }

    transaction.transaction_id = at(10)

    const chargeType = at(0)
    const orderStatus = at(1)
    const firstAmount = at(2)
    const captureAmount = at(3)
    transaction.transaction_type = chargeType === null ? null : this.valueMapper.mapTxType(chargeType)
    transaction.order_status = orderStatus === null ? null : this.valueMapper.mapOrderStatus(orderStatus)
    transaction.transaction_time = this.formatOptionalDateTime(at(4), txType)
    transaction.first_amount = firstAmount === null ? null : this.valueFormatter.formatAmount(firstAmount, txType)
    transaction.capture_amount = captureAmount === null ? null : this.valueFormatter.formatAmount(captureAmount, txType)
    transaction.capture = transaction.status === TX_APPROVED && transaction.first_amount === transaction.capture_amount
    transaction.ref_ret_num = at(7)

    return transaction
  }

  private mapSingleRecurringOrderStatus(extra: unknown, i: number): Raw {
    const txType = TX_TYPE.STATUS
    const procReturnCode = text(extra, `PROC_RET_CD_${i}`)
    let status: string | null = TX_DECLINED
    if (procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE) {
      status = TX_APPROVED
    } else if (procReturnCode === null) {
      status = null
    }

    const transStat = text(extra, `TRANS_STAT_${i}`)
    const chargeType = text(extra, `CHARGE_TYPE_CD_${i}`)
    const firstAmount = text(extra, `ORIG_TRANS_AMT_${i}`)
    const captureAmount = text(extra, `CAPTURE_AMT_${i}`)

    const recurringOrder: Raw = {
      order_id: field(extra, `ORD_ID_${i}`),
      masked_number: field(extra, `PAN_${i}`),
      order_status: transStat === null ? null : this.valueMapper.mapOrderStatus(transStat),

      // the following fields are null until the transaction is done for the respective installment:
      auth_code: field(extra, `AUTH_CODE_${i}`),
      proc_return_code: procReturnCode,
      transaction_type: chargeType === null ? null : this.valueMapper.mapTxType(chargeType),
      status,
      transaction_time: this.formatOptionalDateTime(text(extra, `AUTH_DTTM_${i}`), txType),
      capture_time: this.formatOptionalDateTime(text(extra, `CAPTURE_DTTM_${i}`), txType),
      transaction_id: field(extra, `TRANS_ID_${i}`),
      ref_ret_num: field(extra, `HOST_REF_NUM_${i}`),
      first_amount: firstAmount === null ? null : this.valueFormatter.formatAmount(firstAmount, txType),
      capture_amount: captureAmount === null ? null : this.valueFormatter.formatAmount(captureAmount, txType),
    }
    recurringOrder.capture = recurringOrder.first_amount === recurringOrder.capture_amount

    return this.mergeArraysPreferNonNullValues(this.getDefaultOrderHistoryTxResponse(), recurringOrder)
  }
}
