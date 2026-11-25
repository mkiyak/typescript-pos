import { NotImplementedError } from '../../../errors.js'
import { MODEL, PAYMENT_STATUS, type PaymentModel, TX_TYPE, type TxType } from '../../../PosInterface.js'
import type { PosOrder, PosResponse } from '../../../types.js'
import { AbstractResponseDataMapper } from './AbstractResponseDataMapper.js'
import { TX_APPROVED, TX_DECLINED } from './ResponseDataMapperInterface.js'
import { isRecord, ownScalar, ownString, ownText, type Raw } from './toslaResponseFields.js'

const DECIMAL = /^(\d{1,13})(?:[.,](\d{1,4}))?$/
const KURUS = /^[1-9]\d{0,14}$/
const SMALL_INTEGER = /^\d{1,2}$/
const REASON_CODE = /^[A-Za-z0-9_-]{1,16}$/
// Bank dates: `DD.MM.YYYY` or `YYYY-MM-DD hh:mm:ss` (the dotted form may carry a time). Nothing else is read, so a
// word such as "now" or a value with an offset never turns into a date.
const BANK_DATE = /^(?:\d{2}\.\d{2}\.\d{4}(?: \d{2}:\d{2}:\d{2})?|\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})$/
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is removed
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g

/**
 * A decimal amount in lira as the gateway prints it (`10.50`, `10,5`, or a number) as an integer number of kuruş.
 * Up to 13 integer digits and four decimals; a non-zero third or fourth decimal, padding, signs, exponents, lists and
 * every other kind of value read as null, so a malformed amount never turns into a number that could be compared.
 */
export function payTrDecimalKurus(value: unknown): number | null {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value
  if (typeof text !== 'string') return null
  const match = DECIMAL.exec(text)
  if (match === null) return null
  const fraction = (match[2] ?? '').padEnd(4, '0')
  if (fraction.slice(2) !== '00') return null

  return Number(match[1]) * 100 + Number(fraction.slice(0, 2))
}

/** Own text without control, line-separator and bidi characters and cut to `max` UTF-16 units (never inside a surrogate pair); other kinds, inherited members and empty text are null. */
export function payTrPlainText(data: unknown, key: string, max = 256): string | null {
  const text = ownString(data, key)
  if (text === null) return null
  let plain = text.replace(CONTROL_CHARACTERS, '').slice(0, max)
  // a cut right after the first half of a surrogate pair would leave a lone surrogate
  if (/[\uD800-\uDBFF]$/.test(plain)) plain = plain.slice(0, -1)

  return plain === '' ? null : plain
}

/** An own reason code (`51`, `004`); anything that is not a short token reads as null. */
function ownReasonCode(data: unknown, key: string): string | null {
  const code = ownText(data, key)

  return code !== null && REASON_CODE.test(code) ? code : null
}

/**
 * Response mapper of the PayTR gateway.
 *
 * Every decision (approved or not) reads the own, untrimmed word of the answer: a status counts as success only when
 * it is exactly `success` (never `' success'`, `'SUCCESS'`, a list, or a value inherited from a prototype). Values
 * that are not text or numbers read as null and never become "[object Object]".
 *
 * Mapped amounts, currencies and installment counts are display values taken from the body; a caller binds a payment
 * to its order with its own order data and the signed kuruş integer, never with `amount`, `first_amount`,
 * `capture_amount`, `refund_amount`, `currency` or `installment_count` of a mapped result. The status word of a
 * non-secure answer that is `wait_callback`, empty or unreadable maps to `declined` here only because the mapper has
 * no third state: the gateway must treat such an answer as an unknown outcome before it maps anything.
 *
 * PayTR reports the final result of a hosted or 3D payment once, in a signed notification; there is no separate 3D
 * authentication result, so an answer is never approved by the bank and failed by 3D at the same time.
 */
export class PayTrPosResponseDataMapper extends AbstractResponseDataMapper {
  static override readonly PROCEDURE_SUCCESS_CODE = 'success'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayTrPos'
  }

  /** The synchronous answer of a non-secure sale. */
  mapPaymentResponse(rawPaymentResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    const defaultResponse = this.getDefaultPaymentResponse(txType, MODEL.NON_SECURE)
    if (!isRecord(rawPaymentResponseData) || Object.keys(rawPaymentResponseData).length === 0) {
      return defaultResponse
    }

    this.logger.debug('mapping payment response', [rawPaymentResponseData])
    const raw = rawPaymentResponseData
    const approved = this.getProcReturnCode(raw) === PayTrPosResponseDataMapper.PROCEDURE_SUCCESS_CODE
    const currency = this.currencyOf(raw, txType)

    const mappedResponse: Raw = {
      order_id: ownText(raw, 'merchant_oid') ?? (order.id === undefined ? null : ownText({ id: order.id }, 'id')),
      currency: currency ?? order.currency ?? null,
      amount: approved ? this.kurusAmount(raw, txType) : null,
      installment_count: this.installmentOf(raw, txType),
      transaction_time: approved ? new Date() : null,
      status: approved ? TX_APPROVED : TX_DECLINED,
      error_code: approved ? null : ownReasonCode(raw, 'failed_reason_code'),
      error_message: approved ? null : (payTrPlainText(raw, 'failed_reason_msg') ?? payTrPlainText(raw, 'msg')),
      all: raw,
    }
    this.logger.debug('mapped payment response', mappedResponse)

    return this.mergeArraysPreferNonNullValues(defaultResponse, mappedResponse) as PosResponse
  }

  map3DPaymentData(
    _raw3DAuthResponseData: Raw,
    _rawPaymentResponseData: Raw | null,
    _txType: TxType,
    _order: PosOrder,
  ): PosResponse {
    throw new NotImplementedError('3D Secure with a separate provision is not supported by this gateway')
  }

  map3DPayResponseData(raw3DAuthResponseData: Raw, txType: TxType, _order: PosOrder): PosResponse {
    return this.mapCallbackResponse(raw3DAuthResponseData, txType, MODEL.THREE_D_PAY)
  }

  map3DHostResponseData(raw3DAuthResponseData: Raw, txType: TxType, _order: PosOrder): PosResponse {
    return this.mapCallbackResponse(raw3DAuthResponseData, txType, MODEL.THREE_D_HOST)
  }

  mapRefundResponse(rawResponseData: Raw): PosResponse {
    const raw = isRecord(rawResponseData) ? rawResponseData : {}
    const approved = this.getProcReturnCode(raw) === PayTrPosResponseDataMapper.PROCEDURE_SUCCESS_CODE
    // A declined answer refunded nothing, whatever amount it echoes.
    const readable = approved && Object.hasOwn(raw, 'return_amount') && payTrDecimalKurus(raw.return_amount) !== null

    return {
      order_id: ownText(raw, 'merchant_oid'),
      status: approved ? TX_APPROVED : TX_DECLINED,
      refund_amount: readable
        ? this.valueFormatter.formatAmount(this.decimalText(raw.return_amount), TX_TYPE.REFUND)
        : null,
      ref_ret_num: ownString(raw, 'reference_no'),
      error_code: approved ? null : ownReasonCode(raw, 'err_no'),
      error_message: approved ? null : payTrPlainText(raw, 'err_msg'),
      all: raw,
    } as unknown as PosResponse
  }

  mapCancelResponse(_rawResponseData: Raw): PosResponse {
    throw new NotImplementedError('Cancel is not supported by this gateway')
  }

  mapStatusResponse(rawResponseData: Raw): PosResponse {
    const txType = TX_TYPE.STATUS
    const raw = isRecord(rawResponseData) ? rawResponseData : {}
    const procReturnCode = this.getProcReturnCode(raw)
    const result = this.getDefaultStatusResponse(raw)

    if (procReturnCode !== PayTrPosResponseDataMapper.PROCEDURE_SUCCESS_CODE) {
      result.error_code = ownReasonCode(raw, 'err_no')
      result.error_message = payTrPlainText(raw, 'err_msg')

      return result
    }

    const paymentAmount = this.decimalAmount(raw, 'payment_amount', txType)
    const paymentTotal = this.decimalAmount(raw, 'payment_total', txType)
    const totalKurus = Object.hasOwn(raw, 'payment_total') ? payTrDecimalKurus(raw.payment_total) : null
    const transactionTime = this.dateOf(raw, 'payment_date', TX_TYPE.PAY_AUTH)
    const refunds = this.refundsOf(raw)

    let orderStatus: string = PAYMENT_STATUS.PAYMENT_COMPLETED
    if (refunds.kurus !== null && refunds.kurus > 0 && totalKurus !== null) {
      orderStatus = refunds.kurus >= totalKurus ? PAYMENT_STATUS.FULLY_REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED
    }

    return this.mergeArraysPreferNonNullValues(result, {
      proc_return_code: procReturnCode,
      order_status: orderStatus,
      status: TX_APPROVED,
      transaction_time: transactionTime,
      capture_time: transactionTime,
      first_amount: paymentAmount,
      capture_amount: paymentTotal,
      capture: paymentTotal !== null && paymentTotal > 0,
      currency: this.currencyOf(raw, txType),
      masked_number: ownString(raw, 'masked_pan'),
      installment_count: this.installmentOf(raw, TX_TYPE.PAY_AUTH, 'taksit'),
      refund_amount: refunds.kurus === null ? null : refunds.kurus / 100,
      refund_time: refunds.time,
      all: raw,
    }) as PosResponse
  }

  mapOrderHistoryResponse(_rawResponseData: Raw): PosResponse {
    throw new NotImplementedError('Order history is not supported by this gateway')
  }

  /** The notification status word: exactly `success`. */
  is3dAuthSuccess(mdStatus: string | null): boolean {
    return mdStatus === 'success'
  }

  /** The own `status` text exactly as sent (PayTR sends no md status); anything else is null. */
  extractMdStatus(raw3DAuthResponseData: Raw): string | null {
    return typeof raw3DAuthResponseData === 'object' &&
      raw3DAuthResponseData !== null &&
      Object.hasOwn(raw3DAuthResponseData, 'status') &&
      typeof raw3DAuthResponseData.status === 'string'
      ? raw3DAuthResponseData.status
      : null
  }

  /** The own `status` text exactly as sent (`success`, `failed`, `error`, `wait_callback`). */
  protected getProcReturnCode(response: Raw): string | null {
    return ownString(response, 'status')
  }

  /** Shared mapping of the 3D Pay and 3D Host notification bodies. */
  private mapCallbackResponse(raw3DAuthResponseData: Raw, txType: TxType, paymentModel: PaymentModel): PosResponse {
    const callbackData = isRecord(raw3DAuthResponseData) ? raw3DAuthResponseData : {}
    this.logger.debug('mapping 3D callback response', [callbackData])
    const defaultResponse = {
      ...this.getDefaultPaymentResponse(txType, paymentModel),
      md_status: null,
      md_error_message: null,
      transaction_security: null,
    } as PosResponse

    const keys = Object.keys(callbackData)
    if (keys.length === 0) return defaultResponse
    if (keys.length === 1) {
      // The browser's failure text; it carries no result and nothing signed.
      defaultResponse.md_error_message = payTrPlainText(callbackData, 'fail_message')

      return defaultResponse
    }

    const approved = this.is3dAuthSuccess(this.extractMdStatus(callbackData))
    const mappedResponse: Raw = {
      order_id: ownText(callbackData, 'merchant_oid'),
      payment_model: paymentModel,
      status: approved ? TX_APPROVED : TX_DECLINED,
      all: callbackData,
    }
    if (approved) {
      mappedResponse.amount = this.kurusAmount(callbackData, txType)
      mappedResponse.installment_count = this.installmentOf(callbackData, txType)
      mappedResponse.currency = this.currencyOf(callbackData, txType)
      mappedResponse.transaction_time = new Date()
    } else {
      mappedResponse.error_code = ownReasonCode(callbackData, 'failed_reason_code')
      mappedResponse.error_message = payTrPlainText(callbackData, 'failed_reason_msg')
    }
    this.logger.debug('mapped 3D callback response', mappedResponse)

    return this.mergeArraysPreferNonNullValues(defaultResponse, mappedResponse) as PosResponse
  }

  /** `total_amount` is an integer number of kuruş; the display amount is that divided by 100, else null. */
  private kurusAmount(raw: Raw, txType: string): number | null {
    const total = ownText(raw, 'total_amount')

    return total !== null && KURUS.test(total) ? this.valueFormatter.formatAmount(total, txType) : null
  }

  private currencyOf(raw: Raw, txType: TxType): string | null {
    const currency = ownString(raw, 'currency')

    return currency === null ? null : this.valueMapper.mapCurrency(currency, txType)
  }

  /** Only one or two digits read as an installment count. */
  private installmentOf(raw: Raw, txType: TxType, key = 'installment_count'): number | null {
    const count = ownText(raw, key)

    return count !== null && SMALL_INTEGER.test(count) ? this.valueFormatter.formatInstallment(count, txType) : null
  }

  /** A decimal lira field of a status answer as a display amount; unreadable values are null. */
  private decimalAmount(raw: Raw, key: string, txType: string): number | null {
    if (!Object.hasOwn(raw, key) || payTrDecimalKurus(raw[key]) === null) return null

    return this.valueFormatter.formatAmount(this.decimalText(raw[key]), txType)
  }

  /** The text of a validated decimal amount, with the decimal comma written as a dot. */
  private decimalText(value: unknown): string {
    return String(value).replace(',', '.')
  }

  /** Refunds of a status answer: kuruş sum of the readable `return_amount` values and the last readable `return_date`. */
  private refundsOf(raw: Raw): { kurus: number | null; time: Date | null } {
    const returns = Object.hasOwn(raw, 'returns') ? raw.returns : null
    if (!Array.isArray(returns)) return { kurus: null, time: null }

    let kurus: number | null = null
    let time: Date | null = null
    for (const entry of returns as unknown[]) {
      if (!isRecord(entry) || Array.isArray(entry)) continue
      const amount = Object.hasOwn(entry, 'return_amount') ? payTrDecimalKurus(entry.return_amount) : null
      if (amount === null) {
        this.logger.warn('refund entry skipped', { field: 'return_amount' })
        continue
      }
      kurus = (kurus ?? 0) + amount
      const date = this.dateOf(entry, 'return_date', TX_TYPE.PAY_AUTH)
      if (date !== null) time = date
    }

    return { kurus, time }
  }

  /** A bank date that cannot be read never hides the answer: the field stays null and a warning names it. */
  private dateOf(raw: Raw, key: string, txType: string): Date | null {
    const value = ownScalar(raw, key)
    if (value === null) return null
    if (typeof value === 'string' && BANK_DATE.test(value)) {
      try {
        return this.valueFormatter.formatDateTime(value, txType)
      } catch {
        // falls through to the warning below
      }
    }
    this.logger.warn('bank timestamp could not be parsed', { field: key })

    return null
  }
}
