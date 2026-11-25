import { NotImplementedError } from '../../../errors.js'
import { MODEL, PAYMENT_STATUS, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosOrder, PosResponse } from '../../../types.js'
import { AbstractResponseDataMapper } from './AbstractResponseDataMapper.js'
import { TX_APPROVED, TX_DECLINED } from './ResponseDataMapperInterface.js'

type Raw = Record<string, unknown>

const BIN_NUMBER = /^\d{6,8}$/
const LAST_FOUR = /^\d{4}$/

function isRecord(value: unknown): value is Raw {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** An own text field exactly as sent; empty text, other kinds and inherited members read as null. */
function ownString(data: unknown, key: string): string | null {
  if (!isRecord(data) || !Object.hasOwn(data, key)) return null
  const value = data[key]

  return typeof value === 'string' && value !== '' ? value : null
}

/** An own text or finite number with its kind kept; everything else (lists, records, booleans, empty text) is null. */
function ownScalar(data: unknown, key: string): string | number | null {
  if (!isRecord(data) || !Object.hasOwn(data, key)) return null
  const value = data[key]
  if (typeof value === 'string') return value === '' ? null : value
  if (typeof value === 'number' && Number.isFinite(value)) return value

  return null
}

/** An own text or number as text. */
function ownText(data: unknown, key: string): string | null {
  const value = ownScalar(data, key)

  return value === null ? null : String(value)
}

/** An own whole number (number or digit text) as text, for epoch times and installment counts. */
function ownCount(data: unknown, key: string): string | null {
  const value = ownScalar(data, key)
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null
  if (typeof value === 'string' && /^\d{1,16}$/.test(value)) return value

  return null
}

/** The own answer verdict: the text `success`, exactly, and nothing else (no trimming, no case folding). */
function isSuccess(data: unknown): boolean {
  return isRecord(data) && Object.hasOwn(data, 'status') && data.status === 'success'
}

/**
 * Response mapper of the iyzico gateway.
 *
 * Every decision reads the own, untrimmed text of the answer: a status of `' success '`, `1`, `['success']` or an
 * inherited `'success'` never approves anything, and a field that is not the expected kind reads as null instead of
 * becoming "[object Object]". A time or an amount that cannot be read leaves that field null and logs the field name.
 *
 * This mapper decides nothing about money. A caller binds a payment to its order with the order's own data and the
 * answer's signature, never with `amount`, `first_amount`, `capture_amount`, `currency` or `installment_count` of a
 * mapped result (display values; the post-authorization answer even prints binary fractions such as
 * `10.209999999999999`), and never with the lists inside `all` (`itemTransactions`, `payments`, `cancels`). The
 * fraud verdict (`fraudStatus`) and the 3D result inside a payment answer are the caller's to check after it has
 * verified the answer signature and bound the answer to the order; the mapper reports `approved` for a payment that
 * iyzico answered with `success`.
 */
export class IyzicoPosResponseDataMapper extends AbstractResponseDataMapper {
  static override readonly PROCEDURE_SUCCESS_CODE = 'success'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'IyzicoPos'
  }

  mapPaymentResponse(rawPaymentResponseData: Raw, txType: TxType, _order: PosOrder): PosResponse {
    const mapped = this.mapPaymentCommonResponse(rawPaymentResponseData, txType, MODEL.NON_SECURE)
    this.logMapped('mapped payment response', mapped)

    return mapped
  }

  map3DPaymentData(
    raw3DAuthResponseData: Raw,
    rawPaymentResponseData: Raw | null,
    txType: TxType,
    _order: PosOrder,
  ): PosResponse {
    const mdStatus = this.extractMdStatus(raw3DAuthResponseData)

    let mapped: PosResponse
    if (this.is3dAuthSuccess(mdStatus)) {
      mapped = this.mapPaymentCommonResponse(rawPaymentResponseData ?? {}, txType, MODEL.THREE_D_SECURE)
    } else {
      mapped = this.getDefaultPaymentResponse(txType, MODEL.THREE_D_SECURE)
      mapped.order_id = ownText(raw3DAuthResponseData, 'conversationId')
      mapped.proc_return_code = this.getProcReturnCode(raw3DAuthResponseData)
    }

    mapped.md_status = mdStatus
    mapped.md_error_message = null
    mapped.transaction_security = null
    mapped['3d_all'] = raw3DAuthResponseData
    this.logMapped('mapped 3D payment data', mapped)

    return mapped
  }

  map3DPayResponseData(_raw3DAuthResponseData: Raw, _txType: TxType, _order: PosOrder): PosResponse {
    throw new NotImplementedError('3D Pay is not supported by this gateway')
  }

  map3DHostResponseData(raw3DAuthResponseData: Raw, txType: TxType, _order: PosOrder): PosResponse {
    const mdStatus = this.extractMdStatus(raw3DAuthResponseData)

    let mapped: PosResponse
    if (this.is3dAuthSuccess(mdStatus)) {
      mapped = this.mapPaymentCommonResponse(raw3DAuthResponseData, txType, MODEL.THREE_D_HOST)
    } else {
      mapped = this.getDefaultPaymentResponse(txType, MODEL.THREE_D_HOST)
      mapped.order_id = ownText(raw3DAuthResponseData, 'conversationId')
      mapped.proc_return_code = this.getProcReturnCode(raw3DAuthResponseData)
      mapped.all = raw3DAuthResponseData
    }

    mapped.md_status = mdStatus
    mapped.md_error_message = null
    mapped.transaction_security = null
    this.logMapped('mapped 3D host payment data', mapped)

    return mapped
  }

  mapRefundResponse(rawResponseData: Raw): PosResponse {
    const raw = isRecord(rawResponseData) ? rawResponseData : {}
    const approved = isSuccess(raw)

    return {
      order_id: ownText(raw, 'conversationId'),
      auth_code: null,
      ref_ret_num: ownText(raw, 'hostReference'),
      proc_return_code: this.getProcReturnCode(raw),
      transaction_id: ownScalar(raw, 'paymentTransactionId'),
      error_code: approved ? null : ownText(raw, 'errorCode'),
      error_message: approved ? null : ownString(raw, 'errorMessage'),
      status: approved ? TX_APPROVED : TX_DECLINED,
      all: raw,
    } as PosResponse
  }

  mapCancelResponse(rawResponseData: Raw): PosResponse {
    const raw = isRecord(rawResponseData) ? rawResponseData : {}
    const approved = isSuccess(raw)

    return {
      order_id: ownText(raw, 'conversationId'),
      auth_code: null,
      ref_ret_num: ownText(raw, 'cancelHostReference'),
      proc_return_code: this.getProcReturnCode(raw),
      transaction_id: ownScalar(raw, 'paymentId'),
      error_code: approved ? null : ownText(raw, 'errorCode'),
      error_message: approved ? null : ownString(raw, 'errorMessage'),
      status: approved ? TX_APPROVED : TX_DECLINED,
      all: raw,
    } as PosResponse
  }

  mapStatusResponse(rawResponseData: Raw): PosResponse {
    const txType = TX_TYPE.STATUS
    const raw = isRecord(rawResponseData) ? rawResponseData : {}
    const approved = isSuccess(raw)

    const result = this.getDefaultStatusResponse(raw)
    result.proc_return_code = this.getProcReturnCode(raw)
    result.order_id = ownText(raw, 'conversationId')
    result.transaction_id = ownScalar(raw, 'paymentId')
    result.ref_ret_num = ownText(raw, 'hostReference')
    // iyzico's own word (`SUCCESS`, `FAILURE`, ...): the cancel and refund states are only reported by the history.
    const paymentStatus = ownString(raw, 'paymentStatus')
    result.order_status = paymentStatus === null ? null : this.valueMapper.mapOrderStatus(paymentStatus, txType)
    result.status = approved ? TX_APPROVED : TX_DECLINED

    if (approved) {
      result.auth_code = ownText(raw, 'authCode')
      result.currency = this.currency(raw, txType)
      result.first_amount = this.amount(raw, 'price', txType)
      result.capture_amount = this.amount(raw, 'paidPrice', txType)
      result.masked_number = this.maskedNumber(raw)
      result.installment_count = this.installment(raw, txType)
    } else {
      result.error_code = ownText(raw, 'errorCode')
      result.error_message = ownString(raw, 'errorMessage')
    }

    return result
  }

  mapOrderHistoryResponse(rawResponseData: Raw): PosResponse {
    const raw = isRecord(rawResponseData) ? rawResponseData : {}
    const approved = isSuccess(raw)

    const transactions: Record<string, unknown>[] = []
    if (approved && Array.isArray(raw.payments)) {
      for (const payment of raw.payments as unknown[]) {
        // Entries that are not records carry nothing to map.
        if (!isRecord(payment)) continue
        transactions.push(this.mapSingleOrderHistoryTransaction(payment))
      }
    }

    return {
      order_id: ownText(raw, 'conversationId'),
      proc_return_code: this.getProcReturnCode(raw),
      error_code: approved ? null : ownText(raw, 'errorCode'),
      error_message: approved ? null : ownString(raw, 'errorMessage'),
      trans_count: transactions.length,
      transactions,
      status: approved ? TX_APPROVED : TX_DECLINED,
      all: raw,
    } as PosResponse
  }

  /**
   * Only `1` (full authentication) reads as authenticated. iyzico can also complete a payment after other results
   * (`0` is a failure and must stay one), so no other value approves.
   */
  is3dAuthSuccess(mdStatus: string | null): boolean {
    return mdStatus === '1'
  }

  /** The own `mdStatus` as text: the text as sent, or a safe integer; anything else (missing, list, inherited) is null. */
  extractMdStatus(raw3DAuthResponseData: Raw): string | null {
    const value = ownScalar(raw3DAuthResponseData, 'mdStatus')
    if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : null

    return value
  }

  /** The own `status` text exactly as sent (`success`, `failure`). */
  protected getProcReturnCode(response: Raw): string | null {
    return ownString(response, 'status')
  }

  /** `<bin>******<last four>`; either part missing or malformed leaves the number out. */
  private maskedNumber(raw: Raw): string | null {
    const bin = ownText(raw, 'binNumber')
    const lastFour = ownText(raw, 'lastFourDigits')
    if (bin === null || lastFour === null || !BIN_NUMBER.test(bin) || !LAST_FOUR.test(lastFour)) return null

    return `${bin}******${lastFour}`
  }

  private currency(raw: Raw, txType: TxType) {
    const currency = ownString(raw, 'currency')

    return currency === null ? null : this.valueMapper.mapCurrency(currency, txType)
  }

  private installment(raw: Raw, txType: TxType): number | null {
    const installment = ownCount(raw, 'installment')

    return installment === null ? null : this.valueFormatter.formatInstallment(installment, txType)
  }

  /** A display amount; one that cannot be read leaves the field null and logs the field name. */
  private amount(raw: Raw, key: string, txType: string): number | null {
    const value = ownScalar(raw, key)
    if (value === null) return null
    try {
      return this.valueFormatter.formatAmount(value, txType)
    } catch {
      this.logger.warn('bank amount could not be read', { field: key })

      return null
    }
  }

  /** A bank time that cannot be read never hides the answer: the field stays null and a warning is logged. */
  private time(text: string | null, key: string, txType: string): Date | null {
    if (text === null) return null
    try {
      return this.valueFormatter.formatDateTime(text, txType)
    } catch {
      this.logger.warn('bank timestamp could not be parsed', { field: key })

      return null
    }
  }

  /** A time the answer prints as a number (epoch milliseconds) or as text (reporting answers). */
  private timeField(raw: Raw, key: string, txType: string): Date | null {
    return this.time(ownText(raw, key), key, txType)
  }

  private mapPaymentCommonResponse(
    rawPaymentResponseData: Raw,
    txType: TxType,
    paymentModel: PaymentModel,
  ): PosResponse {
    const defaultResponse = this.getDefaultPaymentResponse(txType, paymentModel)
    if (!isRecord(rawPaymentResponseData) || Object.keys(rawPaymentResponseData).length === 0) {
      return defaultResponse
    }
    const raw = rawPaymentResponseData

    const approved = isSuccess(raw)
    const mapped: Raw = {
      order_id: ownText(raw, 'conversationId'),
      transaction_id: ownScalar(raw, 'paymentId'),
      proc_return_code: this.getProcReturnCode(raw),
      transaction_time: this.timeField(raw, 'systemTime', txType),
      status: approved ? TX_APPROVED : TX_DECLINED,
      error_code: approved ? null : ownText(raw, 'errorCode'),
      error_message: approved ? null : ownString(raw, 'errorMessage'),
      all: raw,
    }

    if (approved) {
      const phase = ownString(raw, 'phase')
      mapped.transaction_type = phase === null ? null : this.valueMapper.mapTxType(phase)
      mapped.ref_ret_num = ownText(raw, 'hostReference')
      mapped.auth_code = ownText(raw, 'authCode')
      mapped.installment_count = this.installment(raw, txType)
      mapped.currency = this.currency(raw, txType)
      mapped.amount = this.amount(raw, 'paidPrice', txType)
      mapped.masked_number = this.maskedNumber(raw)
    }

    return this.mergeArraysPreferNonNullValues(defaultResponse, mapped) as PosResponse
  }

  /** One payment of an order history answer. */
  private mapSingleOrderHistoryTransaction(rawPayment: Raw): Record<string, unknown> {
    const txType = TX_TYPE.ORDER_HISTORY
    // `1` and `'1'` both mean the payment was taken.
    const paymentStatus = ownScalar(rawPayment, 'paymentStatus')
    const completed = paymentStatus === 1 || paymentStatus === '1'

    const transaction = this.getDefaultOrderHistoryTxResponse()
    transaction.transaction_id = ownScalar(rawPayment, 'paymentId')
    transaction.auth_code = ownText(rawPayment, 'authCode')
    transaction.ref_ret_num = ownText(rawPayment, 'hostReference')
    transaction.payment_model = this.paymentModel(rawPayment, txType)
    transaction.status = completed ? TX_APPROVED : TX_DECLINED
    const phase = ownString(rawPayment, 'phase')
    transaction.transaction_type = phase === null ? null : this.valueMapper.mapTxType(phase)
    transaction.first_amount = this.amount(rawPayment, 'price', txType)
    transaction.capture_amount = this.amount(rawPayment, 'paidPrice', txType)
    transaction.currency = this.currency(rawPayment, txType)
    transaction.masked_number = this.maskedNumber(rawPayment)
    transaction.installment_count = this.installment(rawPayment, txType)
    transaction.transaction_time = this.timeField(rawPayment, 'createdDate', txType)
    transaction.capture = completed

    const refundStatus = ownString(rawPayment, 'paymentRefundStatus')
    if (refundStatus !== null) {
      transaction.order_status = this.valueMapper.mapOrderStatus(refundStatus, txType)
    } else {
      transaction.order_status = completed ? PAYMENT_STATUS.PAYMENT_COMPLETED : PAYMENT_STATUS.ERROR
    }

    const cancels = Object.hasOwn(rawPayment, 'cancels') ? rawPayment.cancels : null
    if (Array.isArray(cancels) && cancels.length > 0) {
      transaction.cancel_time = this.timeField(isRecord(cancels[0]) ? cancels[0] : {}, 'createdDate', txType)
    }

    return transaction
  }

  /** `threeDS` is `null` for a regular payment, `0`/`false` regular, `1`/`true` 3D Secure; other values map to null. */
  private paymentModel(rawPayment: Raw, txType: TxType): PaymentModel | null {
    if (!Object.hasOwn(rawPayment, 'threeDS')) return null
    const value = rawPayment.threeDS
    if (value === null) return MODEL.NON_SECURE
    if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
      return this.valueMapper.mapSecureType(value, txType)
    }

    return null
  }

  private logMapped(message: string, mapped: PosResponse): void {
    // The raw answers are left out of the log: they carry the card's first and last digits and the answer signature.
    this.logger.debug(message, {
      order_id: mapped.order_id,
      status: mapped.status,
      proc_return_code: mapped.proc_return_code,
    })
  }
}
