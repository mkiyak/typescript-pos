import { NotImplementedError } from '../../../errors.js'
import { MODEL, TX_TYPE, type TxType } from '../../../PosInterface.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import type { PosOrder, PosResponse } from '../../../types.js'
import { AbstractResponseDataMapper } from './AbstractResponseDataMapper.js'
import { TX_APPROVED, TX_DECLINED } from './ResponseDataMapperInterface.js'
import {
  bankInteger,
  isRecord,
  ownScalar,
  ownString,
  ownText,
  ownTransactionId,
  ownTrimmed,
  type Raw,
} from './toslaResponseFields.js'

/** The request status of a completed payment as the bank writes it in a 3D callback. */
const COMPLETED_REQUEST_STATUS = '1'

/**
 * Response mapper of the Tosla gateway.
 *
 * Every decision (approved or not) reads the own, untrimmed text of the answer: a bank code of `' 00 '`, `['00']` or
 * an inherited `'00'` never approves anything, and a result code counts as success only when it is the number `0`.
 * Values that are not text or numbers read as null and never become "[object Object]".
 *
 * Mapped amounts and currencies are display values. A payment or 3D answer carries the order's own amount and
 * currency, never what the bank echoed; the amount of a status or history record is the bank's kuruş integer divided
 * by 100. A caller binds a payment to its order with its own order data and the bank's integer fields, never with
 * `amount`, `first_amount`, `capture_amount`, `refund_amount`, `currency` or `installment_count` of a mapped result.
 * The order id, 3D result and request status of a 3D callback are the browser's word until the bank confirms the
 * order; the bank code of a 3D callback is reported and decided on exactly as sent (a padded code stays padded).
 */
export class ToslaPosResponseDataMapper extends AbstractResponseDataMapper {
  static override readonly PROCEDURE_SUCCESS_CODE = '00'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'ToslaPos'
  }

  mapPaymentResponse(rawPaymentResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    const defaultResponse = this.getDefaultPaymentResponse(txType, MODEL.NON_SECURE)
    if (!isRecord(rawPaymentResponseData) || Object.keys(rawPaymentResponseData).length === 0) {
      return defaultResponse
    }

    this.logger.debug('mapping payment response', [rawPaymentResponseData])
    const procReturnCode = this.getProcReturnCode(rawPaymentResponseData)
    const approved = procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE

    const mappedResponse: Raw = {
      order_id: ownText(rawPaymentResponseData, 'OrderId'),
      currency: order.currency ?? null,
      amount: order.amount ?? null,
      transaction_id: ownScalar(rawPaymentResponseData, 'TransactionId'),
      transaction_time: approved ? this.valueFormatter.formatDateTime('now', txType) : null,
      transaction_type: null,
      ref_ret_num: ownString(rawPaymentResponseData, 'HostReferenceNumber'),
      proc_return_code: procReturnCode,
      status: approved ? TX_APPROVED : TX_DECLINED,
      error_code: approved ? null : procReturnCode,
      error_message: approved ? null : ownString(rawPaymentResponseData, 'Message'),
      all: rawPaymentResponseData,
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

  map3DPayResponseData(raw3DAuthResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    const raw = isRecord(raw3DAuthResponseData) ? raw3DAuthResponseData : {}
    const exactCode = this.getProcReturnCode(raw)
    const mdStatus = this.extractMdStatus(raw)
    const requestStatus = ownScalar(raw, 'RequestStatus')
    const transactionStatus = requestStatus === null ? null : this.valueMapper.mapOrderStatus(requestStatus)

    // All three results are read exactly as the bank sent them, as own text: the request status must be the text
    // '1' itself, because the value mapper passes unknown words (such as 'PAYMENT_COMPLETED') through unchanged and
    // reads the number 1 like the text.
    const approved =
      exactCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE &&
      ownString(raw, 'RequestStatus') === COMPLETED_REQUEST_STATUS &&
      this.is3dAuthSuccess(mdStatus)
    // The code is reported exactly as sent: a padded code never reads like the approval text.
    const procReturnCode = exactCode

    const response: Raw = {
      order_id: ownText(raw, 'OrderId'),
      transaction_type: null,
      transaction_security: mdStatus === null ? null : this.mapResponseTransactionSecurity(mdStatus),
      currency: order.currency ?? null,
      amount: order.amount ?? null,
      md_status: mdStatus,
      status: approved ? TX_APPROVED : TX_DECLINED,
      proc_return_code: procReturnCode,
      tx_status: transactionStatus,
      md_error_message: null,
      all: raw,
    }

    if (approved) {
      response.transaction_time = this.valueFormatter.formatDateTime('now', txType)
    } else {
      response.error_message = ownTrimmed(raw, 'BankResponseMessage')
      response.error_code = procReturnCode
    }

    const result = this.mergeArraysPreferNonNullValues(
      this.getDefaultPaymentResponse(txType, MODEL.THREE_D_PAY),
      response,
    ) as PosResponse
    this.logger.debug('mapped 3D payment data', {
      order_id: result.order_id,
      status: result.status,
      md_status: mdStatus,
      proc_return_code: procReturnCode,
    })

    return result
  }

  map3DHostResponseData(raw3DAuthResponseData: Raw, txType: TxType, order: PosOrder): PosResponse {
    const result = this.map3DPayResponseData(raw3DAuthResponseData, txType, order)
    result.payment_model = MODEL.THREE_D_HOST

    return result
  }

  mapRefundResponse(rawResponseData: Raw): PosResponse {
    return this.mapReversalResponse(rawResponseData)
  }

  mapCancelResponse(rawResponseData: Raw): PosResponse {
    return this.mapReversalResponse(rawResponseData)
  }

  mapStatusResponse(rawResponseData: Raw): PosResponse {
    const txType = TX_TYPE.STATUS
    const raw = isRecord(rawResponseData) ? rawResponseData : {}
    const procReturnCode = this.getProcReturnCode(raw)
    const approved = this.isSuccess(raw)

    const result = this.getDefaultStatusResponse(raw)
    this.fillRecord(result, raw)
    result.status = approved ? TX_APPROVED : TX_DECLINED

    if (!approved) {
      result.error_message = ownString(raw, 'BankResponseMessage')

      return result
    }

    result.installment_count = bankInteger(raw.InstallmentCount)
    this.fillMoney(result, raw, txType)
    result.refund_amount = this.positiveAmount(raw, 'RefundedAmount', txType)

    if (procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE && this.isPaymentTransaction(result)) {
      this.fillCapture(result, typeof result.first_amount === 'number' ? result.first_amount : null)
    }

    return result
  }

  mapOrderHistoryResponse(rawResponseData: Raw): PosResponse {
    const raw = isRecord(rawResponseData) ? rawResponseData : {}
    const approved = this.isSuccess(raw)

    const mappedTransactions: PosResponse[] = []
    let orderId: string | null = null
    if (approved && Array.isArray(raw.Transactions)) {
      for (const transaction of raw.Transactions as unknown[]) {
        // Items that are not records carry nothing to map.
        if (!isRecord(transaction)) continue
        const mappedTransaction = this.mapSingleHistoryResponse(transaction)
        mappedTransactions.push(mappedTransaction)
        orderId = mappedTransaction.order_id
      }
    }

    return {
      order_id: orderId,
      proc_return_code: null,
      error_code: approved ? null : this.codeText(raw),
      error_message: approved ? null : (ownString(raw, 'message') ?? ownString(raw, 'Message')),
      status: approved ? TX_APPROVED : TX_DECLINED,
      trans_count: mappedTransactions.length,
      transactions: mappedTransactions,
      all: raw,
    } as PosResponse
  }

  /** Only the first result of the 3D page, `1` (full authentication), reads as authenticated. */
  is3dAuthSuccess(mdStatus: string | null): boolean {
    return mdStatus === '1'
  }

  /** The own `MdStatus` text exactly as sent; anything else (missing, empty, number, list, inherited) is null. */
  extractMdStatus(raw3DAuthResponseData: Raw): string | null {
    return ownString(raw3DAuthResponseData, 'MdStatus')
  }

  /** One transaction of an order history answer. */
  mapSingleHistoryResponse(rawResponseData: Raw): PosResponse {
    const txType = QUERY_TYPE.HISTORY
    const raw = isRecord(rawResponseData) ? rawResponseData : {}
    const procReturnCode = this.getProcReturnCode(raw)
    const approved = this.isSuccess(raw)

    const result = this.getDefaultOrderHistoryTxResponse()
    this.fillRecord(result, raw)
    result.status = approved ? TX_APPROVED : TX_DECLINED

    if (!approved) {
      result.error_message = ownString(raw, 'BankResponseMessage')

      return result as PosResponse
    }

    this.fillMoney(result, raw, txType)

    if (procReturnCode === AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE && this.isPaymentTransaction(result)) {
      // What was captured is the net amount plus the merchant commission, both in kuruş.
      const net = bankInteger(raw.NetAmount)
      const commission = bankInteger(raw.MerchantCommissionAmount)
      const captured = net === null || commission === null ? null : net + commission
      const firstKurus = bankInteger(raw.Amount)
      this.fillCapture(
        result,
        typeof result.first_amount === 'number' ? result.first_amount : null,
        captured === null ? null : this.valueFormatter.formatAmount(String(captured), txType),
        firstKurus !== null && captured !== null ? firstKurus <= captured : null,
      )
    }

    return result as PosResponse
  }

  protected mapResponseTransactionSecurity(mdStatus: string): string {
    if (mdStatus === '1') return 'Full 3D Secure'
    if (['2', '3', '4'].includes(mdStatus)) return 'Half 3D Secure'

    return 'MPI fallback'
  }

  /**
   * The result code `Code` of an answer as text, when it is an own integer number. Every answer carries it, a refund
   * declined before it reached the card network has no bank response code, and a refund is approved on `Code` alone;
   * an answer without it says nothing about the money.
   */
  override readProcReturnCode(raw: Raw): string | null {
    const code = isRecord(raw) && Object.hasOwn(raw, 'Code') ? raw.Code : undefined

    return typeof code === 'number' && Number.isSafeInteger(code) ? String(code) : null
  }

  /** The own `BankResponseCode` text exactly as sent. */
  protected getProcReturnCode(response: Raw): string | null {
    return ownString(response, 'BankResponseCode')
  }

  /** Cancel and refund answers share their shape; the result code `0` (a number) is the only success. */
  private mapReversalResponse(rawResponseData: Raw): PosResponse {
    const raw = isRecord(rawResponseData) ? rawResponseData : {}
    const approved = this.isSuccess(raw)

    return {
      order_id: ownText(raw, 'OrderId'),
      auth_code: ownString(raw, 'AuthCode'),
      ref_ret_num: ownString(raw, 'HostReferenceNumber'),
      proc_return_code: this.getProcReturnCode(raw),
      transaction_id: ownScalar(raw, 'TransactionId'),
      error_code: approved ? null : this.codeText(raw),
      error_message: approved ? null : ownString(raw, 'Message'),
      status: approved ? TX_APPROVED : TX_DECLINED,
      all: raw,
    } as PosResponse
  }

  /** The query itself succeeded: the own result code is the number 0. */
  private isSuccess(raw: Raw): boolean {
    return Object.hasOwn(raw, 'Code') && raw.Code === 0
  }

  /** The own result code as text (the response type keeps error codes as text). */
  private codeText(raw: Raw): string | null {
    return ownText(raw, 'Code')
  }

  /** Fields shared by a status answer and a history transaction. */
  private fillRecord(result: Raw, raw: Raw): void {
    result.proc_return_code = this.getProcReturnCode(raw)
    result.order_id = ownText(raw, 'OrderId')
    result.auth_code = ownString(raw, 'AuthCode')
    result.transaction_id = ownTransactionId(raw, 'TransactionId')
    result.masked_number = ownString(raw, 'CardNo')
    const requestStatus = ownScalar(raw, 'RequestStatus')
    result.order_status = requestStatus === null ? null : this.valueMapper.mapOrderStatus(requestStatus)
    const transactionType = ownScalar(raw, 'TransactionType')
    result.transaction_type = transactionType === null ? null : this.valueMapper.mapTxType(transactionType)
  }

  /** Currency, time and first amount; a record without a currency carries no money. */
  private fillMoney(result: Raw, raw: Raw, txType: string): void {
    const currency = bankInteger(raw.Currency)
    if (currency === null || currency <= 0) return

    result.currency = this.valueMapper.mapCurrency(raw.Currency as string | number, txType as TxType)
    // ex: 20231209154531
    result.transaction_time = this.time(raw.CreateDate, txType)
    result.first_amount = this.amount(raw, 'Amount', txType)
  }

  private fillCapture(
    result: Raw,
    firstAmount: number | null,
    captureAmount?: number | null,
    captured?: boolean | null,
  ): void {
    const capture = captureAmount === undefined ? firstAmount : captureAmount
    result.capture_amount = capture
    if (firstAmount === null || capture === null) return
    result.capture = captured ?? firstAmount <= capture
    result.capture_time = result.transaction_time
  }

  private isPaymentTransaction(result: Raw): boolean {
    return [TX_TYPE.PAY_AUTH, TX_TYPE.PAY_POST_AUTH, TX_TYPE.PAY_PRE_AUTH].includes(result.transaction_type as never)
  }

  /** The display amount of a kuruş integer field; any other value is no amount. */
  private amount(raw: Raw, key: string, txType: string): number | null {
    return bankInteger(raw[key]) === null ? null : this.valueFormatter.formatAmount(raw[key] as string | number, txType)
  }

  private positiveAmount(raw: Raw, key: string, txType: string): number | null {
    const kurus = bankInteger(raw[key])

    return kurus !== null && kurus > 0 ? this.valueFormatter.formatAmount(raw[key] as string | number, txType) : null
  }

  /** A bank time that cannot be read never hides the answer: the field stays null and a warning is logged. */
  private time(value: unknown, txType: string): Date | null {
    const text =
      typeof value === 'string'
        ? value
        : typeof value === 'number' && Number.isSafeInteger(value)
          ? String(value)
          : null
    if (text === null || text === '') return null
    try {
      return this.valueFormatter.formatDateTime(text, txType)
    } catch {
      this.logger.warn('bank timestamp could not be parsed', { field: 'CreateDate' })

      return null
    }
  }
}
