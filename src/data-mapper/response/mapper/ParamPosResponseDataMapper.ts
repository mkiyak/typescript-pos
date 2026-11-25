import { NotImplementedError } from '../../../errors.js'
import { CURRENCY, MODEL, PAYMENT_STATUS, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosOrder, PosResponse } from '../../../types.js'
import { AbstractResponseDataMapper } from './AbstractResponseDataMapper.js'
import {
  COMMA_AMOUNT,
  child,
  DOT_AMOUNT,
  isRecord,
  ownCode,
  ownDisplay,
  ownPositiveId,
  ownScalar,
  ownString,
  parseCode,
  type Raw,
} from './paramResponseFields.js'
import { TX_APPROVED, TX_DECLINED } from './ResponseDataMapperInterface.js'

/** What replaces the account GUID a callback echoes. */
const REDACTED = '***'

/** The installment count as the callbacks print it. */
const INSTALLMENT = /^\d{1,3}$/

/**
 * Response mapper of the Param gateways (ParamPos and Param3DHostPos).
 *
 * Every decision reads the own, untrimmed value of a field: a result code counts only when it is the integer text
 * (or number) of at most nine digits, so `' 1'`, `'1.0'`, `['1']` and an inherited `Sonuc` are never a success. A
 * result is `approved` only when the result code is positive and, where the bank sends one, the receipt or
 * transaction number is a positive integer: a success code without it is the caller's unknown outcome, never an
 * approval here. Result codes are returned as canonical integer text. Values that are not text or numbers read as
 * null and never become "[object Object]". An answer that cannot be read maps to a declined response, never to an
 * error.
 *
 * Mapped amounts, currencies, installments and order ids of callbacks are display values: a 3D callback is the
 * browser's word until the bank confirms the order, and the amounts here are floats. A caller binds a payment to its
 * order with its own order data and the bank's text fields (exact kuruş), never with `amount`, `first_amount`,
 * `capture_amount`, `currency`, `installment_count`, or the `order_id` of a callback. A status record answers whether
 * the query succeeded (`status`); the state of the payment is `order_status` and the bank's own fields.
 *
 * A payment is never mapped as approved while the 3D result is a failure: the provision answer is only mapped after
 * the 3D result was positive, so there is no approved-but-3D-failed result in this gateway.
 *
 * The account GUID a callback echoes is replaced in `all` and `3d_all` and never returned.
 */
export class ParamPosResponseDataMapper extends AbstractResponseDataMapper {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'ParamPos' || gatewayClass === 'Param3DHostPos'
  }

  /** A result code as the bank writes it; null when it is not an integer of at most nine digits. */
  static parseCode(value: unknown): number | null {
    return parseCode(value)
  }

  mapPaymentResponse(rawPaymentResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    const raw = isRecord(rawPaymentResponseData) ? rawPaymentResponseData : {}
    const defaultResponse = this.getDefaultPaymentResponse(txType, MODEL.NON_SECURE)
    const currency = this.orderCurrency(order) ?? CURRENCY.TRY

    let payResult: Raw | null
    if (txType === TX_TYPE.PAY_PRE_AUTH) {
      payResult = child(child(raw, 'TP_Islem_Odeme_OnProv_WMDResponse'), 'TP_Islem_Odeme_OnProv_WMDResult')
    } else if (txType === TX_TYPE.PAY_POST_AUTH) {
      payResult = child(child(raw, 'TP_Islem_Odeme_OnProv_KapaResponse'), 'TP_Islem_Odeme_OnProv_KapaResult')
    } else if (currency !== CURRENCY.TRY) {
      payResult = child(child(raw, 'TP_Islem_Odeme_WDResponse'), 'TP_Islem_Odeme_WDResult')
    } else {
      payResult = child(child(raw, 'TP_WMD_UCDResponse'), 'TP_WMD_UCDResult')
    }

    const code = this.codeOf(payResult)
    // A sale is approved with its transaction number; closing a pre-authorization answers without one.
    const approved =
      code !== null && code > 0 && (txType === TX_TYPE.PAY_POST_AUTH || ownPositiveId(payResult, 'Islem_ID'))
    const procReturnCode = this.getProcReturnCode(payResult ?? {})

    const mappedResponse: Raw = {
      proc_return_code: procReturnCode,
      status: approved ? TX_APPROVED : TX_DECLINED,
      error_code: approved ? null : procReturnCode,
      error_message: approved ? null : (ownDisplay(payResult, 'Sonuc_Str') ?? ownDisplay(payResult, 'Bank_HostMsg')),
      all: raw,
    }
    if (approved) {
      if (currency === CURRENCY.TRY) {
        if (txType !== TX_TYPE.PAY_PRE_AUTH) {
          mappedResponse.ref_ret_num = ownDisplay(payResult, 'Bank_HostRefNum')
        }
        mappedResponse.order_id = ownDisplay(payResult, 'Siparis_ID')
        mappedResponse.transaction_id = ownDisplay(payResult, 'Bank_Trans_ID')
        mappedResponse.auth_code = ownDisplay(payResult, 'Bank_AuthCode')
      } else {
        mappedResponse.order_id = ownDisplay(order, 'id')
      }
      mappedResponse.amount = this.orderAmount(order)
      mappedResponse.currency = currency
      mappedResponse.transaction_time = this.valueFormatter.formatDateTime('now', txType)
    }
    this.logResult('mapped payment response', mappedResponse)

    return this.mergeArraysPreferNonNullValues(defaultResponse, mappedResponse) as PosResponse
  }

  map3DPaymentData(
    raw3DAuthResponseData: Raw,
    rawPaymentResponseData: Raw | null,
    txType: TxType,
    order: PosOrder,
  ): PosResponse {
    const raw3D = isRecord(raw3DAuthResponseData) ? raw3DAuthResponseData : {}
    let paymentResponseData = this.getDefaultPaymentResponse(txType, MODEL.THREE_D_SECURE)
    if (rawPaymentResponseData !== null && isRecord(rawPaymentResponseData)) {
      paymentResponseData = this.mapProvisionResponse(rawPaymentResponseData, txType, order)
    }

    const mdStatus = this.extractMdStatus(raw3D)
    const transactionAmount = ownString(raw3D, 'transactionAmount')
    const threeDResponse: Raw = {
      transaction_security: null,
      md_status: mdStatus,
      order_id: ownDisplay(raw3D, 'orderId'),
      amount:
        transactionAmount !== null && COMMA_AMOUNT.test(transactionAmount)
          ? this.valueFormatter.formatAmount(transactionAmount, txType)
          : null,
      currency: this.orderCurrency(order),
      installment_count: null,
      md_error_message: null,
      '3d_all': this.withoutEchoedGuid(raw3D),
    }

    const result = this.mergeArraysPreferNonNullValues(threeDResponse, paymentResponseData) as PosResponse
    result.payment_model = MODEL.THREE_D_SECURE
    this.logResult('mapped 3D payment data', { ...result, all: undefined, '3d_all': undefined })

    return result
  }

  map3DPayResponseData(raw3DAuthResponseData: Raw, txType: TxType, _order: PosOrder): PosResponse {
    const raw = isRecord(raw3DAuthResponseData) ? raw3DAuthResponseData : {}
    const defaultResponse = this.getDefaultPaymentResponse(txType, MODEL.THREE_D_PAY)

    const code = this.codeOf(raw)
    const approved = code !== null && code > 0 && ownPositiveId(raw, 'TURKPOS_RETVAL_Dekont_ID')
    const procReturnCode = this.getProcReturnCode(raw)

    const mappedResponse: Raw = {
      md_status: null,
      md_error_message: null,
      transaction_security: null,
      proc_return_code: procReturnCode,
      status: approved ? TX_APPROVED : TX_DECLINED,
      error_code: approved ? null : procReturnCode,
      error_message: approved ? null : ownDisplay(raw, 'TURKPOS_RETVAL_Sonuc_Str'),
      all: this.withoutEchoedGuid(raw),
    }
    if (approved) {
      const amount = ownString(raw, 'TURKPOS_RETVAL_Tahsilat_Tutari')
      const currency = ownString(raw, 'TURKPOS_RETVAL_PB')
      const installment = ownString(raw, 'TURKPOS_RETVAL_Taksit')
      const time = ownString(raw, 'TURKPOS_RETVAL_Islem_Tarih')
      mappedResponse.order_id = ownDisplay(raw, 'TURKPOS_RETVAL_Siparis_ID')
      mappedResponse.amount =
        amount !== null && COMMA_AMOUNT.test(amount) ? this.valueFormatter.formatAmount(amount, txType) : null
      mappedResponse.currency = currency === null ? null : this.valueMapper.mapCurrency(currency, txType)
      mappedResponse.installment_count =
        installment !== null && INSTALLMENT.test(installment)
          ? this.valueFormatter.formatInstallment(installment, txType)
          : null
      mappedResponse.masked_number = ownDisplay(raw, 'TURKPOS_RETVAL_KK_No')
      // A date that cannot be read is an error: the bank approved, so the answer must not pass silently.
      mappedResponse.transaction_time = time === null ? null : this.valueFormatter.formatDateTime(time, txType)
    }
    this.logResult('mapped 3D payment response', mappedResponse)

    return this.mergeArraysPreferNonNullValues(defaultResponse, mappedResponse) as PosResponse
  }

  map3DHostResponseData(raw3DAuthResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    const result = this.map3DPayResponseData(raw3DAuthResponseData, txType, order)
    result.payment_model = MODEL.THREE_D_HOST

    return result
  }

  mapRefundResponse(rawResponseData: Raw): PosResponse {
    return this.mapCancelResponse(rawResponseData)
  }

  mapCancelResponse(rawResponseData: Raw): PosResponse {
    const raw = isRecord(rawResponseData) ? rawResponseData : {}

    const refundResult = child(child(raw, 'TP_Islem_Iptal_Iade_Kismi2Response'), 'TP_Islem_Iptal_Iade_Kismi2Result')
    const cancelResponse =
      refundResult ?? child(child(raw, 'TP_Islem_Iptal_OnProvResponse'), 'TP_Islem_Iptal_OnProvResult')
    const code = this.codeOf(cancelResponse)
    // Cancelling a pre-authorization answers with a result code alone; that code is the whole approval.
    const approved = code !== null && code > 0
    const procReturnCode = this.getProcReturnCode(cancelResponse ?? {})

    const result: Raw = {
      order_id: null,
      group_id: null,
      auth_code: null,
      ref_ret_num: null,
      proc_return_code: procReturnCode,
      transaction_id: null,
      error_code: approved ? null : procReturnCode,
      error_message: approved ? null : ownDisplay(cancelResponse, 'Sonuc_Str'),
      status: approved ? TX_APPROVED : TX_DECLINED,
      all: raw,
    }
    if (approved && refundResult !== null) {
      result.auth_code = ownDisplay(refundResult, 'Bank_AuthCode')
      result.ref_ret_num = ownDisplay(refundResult, 'Bank_HostRefNum')
      result.transaction_id = ownDisplay(refundResult, 'Bank_Trans_ID')
    }

    return result as PosResponse
  }

  mapStatusResponse(rawResponseData: Raw): PosResponse {
    const txType = TX_TYPE.STATUS
    const raw = isRecord(rawResponseData) ? rawResponseData : {}
    const statusResult = child(child(raw, 'TP_Islem_Sorgulama4Response'), 'TP_Islem_Sorgulama4Result')
    const code = this.codeOf(statusResult)
    const result = this.getDefaultStatusResponse(raw) as Raw
    result.proc_return_code = this.getProcReturnCode(statusResult ?? {})

    // One record describes one order; a list of records cannot be attributed and never reads as a result.
    const rawRecord = isRecord(statusResult) && Object.hasOwn(statusResult, 'DT_Bilgi') ? statusResult.DT_Bilgi : null
    const ambiguous = Array.isArray(rawRecord)
    const record = isRecord(rawRecord) ? rawRecord : null

    result.order_id = ownDisplay(record, 'Siparis_ID')
    result.transaction_id = ownDisplay(record, 'Bank_Trans_ID')

    const queried = code !== null && code > 0
    const approved = queried && record !== null
    result.status = approved ? TX_APPROVED : TX_DECLINED
    if (!approved) {
      result.error_message = ambiguous
        ? 'ambiguous status record'
        : queried
          ? 'status record is missing'
          : ownDisplay(statusResult, 'Sonuc_Str')

      return result as PosResponse
    }

    result.auth_code = ownDisplay(record, 'Bank_AuthCode')
    result.ref_ret_num = ownDisplay(record, 'Bank_HostRefNum')
    result.masked_number = ownDisplay(record, 'KK_No')
    const total = ownString(record, 'Toplam_Tutar')
    result.first_amount =
      total !== null && DOT_AMOUNT.test(total) ? this.valueFormatter.formatAmount(total, txType) : null

    const state = ownString(record, 'Durum')
    result.order_status = state === null ? null : this.valueMapper.mapOrderStatus(state)
    result.transaction_type = this.mapTransactionType(ownString(record, 'Islem_Tip'))

    if (result.transaction_type === TX_TYPE.PAY_AUTH) {
      result.capture_amount = result.first_amount
    } else if (
      result.transaction_type === TX_TYPE.PAY_PRE_AUTH &&
      result.order_status === PAYMENT_STATUS.PAYMENT_COMPLETED
    ) {
      result.order_status = PAYMENT_STATUS.PRE_AUTH_COMPLETED
    }

    const date = ownString(record, 'Tarih')
    const transactionDate = date === null ? null : this.valueFormatter.formatDateTime(date, txType)
    // The record carries the refunded total of the order, not a refund transaction: it has no refund time, and the
    // order status already says the order was refunded.
    if (result.order_status === PAYMENT_STATUS.CANCELED) {
      result.cancel_time = transactionDate
    }

    result.capture = result.first_amount !== null && result.first_amount === result.capture_amount
    result.capture_time = result.capture ? transactionDate : null
    result.transaction_time = transactionDate

    return result as PosResponse
  }

  mapOrderHistoryResponse(_rawResponseData: Raw): PosResponse {
    throw new NotImplementedError('Order history is not supported by this gateway')
  }

  /** Only the first result of the 3D page, `1`, reads as authenticated. */
  is3dAuthSuccess(mdStatus: string | null): boolean {
    return mdStatus === '1'
  }

  /** The own `mdStatus` text exactly as sent; anything else (missing, empty, number, list, inherited) is null. */
  extractMdStatus(raw3DAuthResponseData: Raw): string | null {
    return ownString(raw3DAuthResponseData, 'mdStatus')
  }

  /** The own result code of an answer record as canonical integer text; null when it cannot be read. */
  protected getProcReturnCode(response: Raw): string | null {
    const code = this.codeOf(response)

    return code === null ? null : String(code)
  }

  /** The result code under `Sonuc` (answers) or `TURKPOS_RETVAL_Sonuc` (callbacks). */
  private codeOf(response: unknown): number | null {
    return ownCode(response, 'Sonuc', 'TURKPOS_RETVAL_Sonuc')
  }

  /** Answer of the 3D Secure provision request. */
  private mapProvisionResponse(rawPaymentResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    const defaultResponse = this.getDefaultPaymentResponse(txType, MODEL.NON_SECURE)
    if (Object.keys(rawPaymentResponseData).length === 0) {
      return defaultResponse
    }

    const payResult = child(child(rawPaymentResponseData, 'TP_WMD_PayResponse'), 'TP_WMD_PayResult')
    const code = this.codeOf(payResult)
    const approved = code !== null && code > 0 && ownPositiveId(payResult, 'Dekont_ID')
    const procReturnCode = this.getProcReturnCode(payResult ?? {})

    const mappedResponse: Raw = {
      proc_return_code: procReturnCode,
      status: approved ? TX_APPROVED : TX_DECLINED,
      error_code: approved ? null : procReturnCode,
      error_message: approved ? null : (ownDisplay(payResult, 'Sonuc_Ack') ?? ownDisplay(payResult, 'Bank_HostMsg')),
      all: rawPaymentResponseData,
    }
    if (approved) {
      mappedResponse.order_id = ownDisplay(payResult, 'Siparis_ID')
      mappedResponse.transaction_id = ownDisplay(payResult, 'Bank_Trans_ID')
      mappedResponse.auth_code = ownDisplay(payResult, 'Bank_AuthCode')
      mappedResponse.ref_ret_num = ownDisplay(payResult, 'Bank_HostRefNum')
      mappedResponse.currency = this.orderCurrency(order)
      mappedResponse.transaction_time = this.valueFormatter.formatDateTime('now', txType)
    }
    this.logResult('mapped provision response', mappedResponse)

    return this.mergeArraysPreferNonNullValues(defaultResponse, mappedResponse) as PosResponse
  }

  /** A transaction type word the tables do not know is no transaction type, never an error. */
  private mapTransactionType(word: string | null): TxType | null {
    if (word === null) return null
    try {
      return this.valueMapper.mapTxType(word)
    } catch (error) {
      if (error instanceof NotImplementedError) return null
      throw error
    }
  }

  /** The currency of the order when it is text; anything else is no currency. */
  private orderCurrency(order: PosOrder): PosOrder['currency'] | null {
    const currency = ownString(order, 'currency')

    return currency === null ? null : (currency as PosOrder['currency'])
  }

  /** The amount of the order as the caller gave it, when it is a finite number. */
  private orderAmount(order: PosOrder): number | null {
    const amount = ownScalar(order, 'amount')

    return typeof amount === 'number' ? amount : null
  }

  /** A copy of the callback without the account GUID the bank echoes. */
  private withoutEchoedGuid(raw: Raw): Raw {
    if (!Object.hasOwn(raw, 'TURKPOS_RETVAL_GUID')) return raw

    return { ...raw, TURKPOS_RETVAL_GUID: REDACTED }
  }

  /** Mapped results are logged without the bank's raw data. */
  private logResult(message: string, result: Raw): void {
    this.logger.debug(message, {
      order_id: result.order_id,
      status: result.status,
      proc_return_code: result.proc_return_code,
      error_code: result.error_code,
    })
  }
}
