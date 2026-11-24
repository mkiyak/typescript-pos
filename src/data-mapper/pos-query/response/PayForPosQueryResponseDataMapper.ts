import { PAYMENT_STATUS, TX_TYPE } from '../../../PosInterface.js'
import { AbstractQueryResponseDataMapper } from './AbstractQueryResponseDataMapper.js'
import type { PosQueryHistoryResponse } from './QueryResponseDataMapperInterface.js'

type Raw = Record<string, unknown>

function isRecord(value: unknown): value is Raw {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A scalar bank field as text; objects, lists, booleans and missing keys read as null. */
function text(data: unknown, key: string): string | null {
  if (!isRecord(data) || !Object.hasOwn(data, key)) return null
  const value = data[key]
  if (typeof value === 'string') return value
  if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'bigint') return String(value)
  return null
}

/** Own string field exactly as the bank sent it (no trimming): the success decision is taken on this value only. */
function exactString(data: unknown, key: string): string | null {
  if (!isRecord(data) || !Object.hasOwn(data, key)) return null
  const value = data[key]
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Normalizes the PayFor history report. The report only lists what the bank recorded: a record counts as
 * approved when its `ProcReturnCode` is exactly `00`, which says the recorded transaction succeeded, nothing more.
 * A single record (one order) and a list of records (one day) are both understood; anything else lists no
 * transactions.
 */
export class PayForPosQueryResponseDataMapper extends AbstractQueryResponseDataMapper {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayForPos'
  }

  override mapHistoryResponse(raw: Raw): PosQueryHistoryResponse {
    const values = this.emptyStringsToNull(raw) as Raw
    const extended = Object.hasOwn(values, 'PaymentRequestExtended') ? values.PaymentRequestExtended : null
    const exactExtended = Object.hasOwn(raw, 'PaymentRequestExtended') ? raw.PaymentRequestExtended : null

    const transactions: Raw[] = []
    let procReturnCode: string | null = null
    let status: string | null = null
    let errorMessage: string | null = null

    if (isRecord(extended) && isRecord(extended.PaymentRequest) && isRecord(exactExtended)) {
      const exactRequest = exactExtended.PaymentRequest
      procReturnCode = exactString(exactRequest, 'ProcReturnCode')
      status = AbstractQueryResponseDataMapper.TX_STATUS_DECLINED
      if (procReturnCode === AbstractQueryResponseDataMapper.PROCEDURE_SUCCESS_CODE) {
        status = AbstractQueryResponseDataMapper.TX_STATUS_APPROVED
        transactions.push(this.mapSingleHistoryTransaction(extended.PaymentRequest, exactRequest))
      }
      errorMessage = text(extended.PaymentRequest, 'ErrMsg')
    } else if (Array.isArray(extended) && Array.isArray(exactExtended)) {
      for (const [index, item] of extended.entries()) {
        const exactItem: unknown = exactExtended[index]
        if (!isRecord(item) || !isRecord(item.PaymentRequest) || !isRecord(exactItem)) continue
        transactions.push(this.mapSingleHistoryTransaction(item.PaymentRequest, exactItem.PaymentRequest))
      }
    }

    const failed = procReturnCode !== null && procReturnCode !== AbstractQueryResponseDataMapper.PROCEDURE_SUCCESS_CODE

    return {
      proc_return_code: procReturnCode,
      error_code: failed ? procReturnCode : null,
      error_message: failed ? errorMessage : null,
      status: status as PosQueryHistoryResponse['status'],
      trans_count: transactions.length,
      transactions,
      all: values,
    }
  }

  private mapSingleHistoryTransaction(rawTx: Raw, exactTx: unknown): Raw {
    const txType = TX_TYPE.ORDER_HISTORY
    const procReturnCode = exactString(exactTx, 'ProcReturnCode')
    const approved = procReturnCode === AbstractQueryResponseDataMapper.PROCEDURE_SUCCESS_CODE
    const bankTxType = text(rawTx, 'TxnType')
    const currency = text(rawTx, 'Currency')

    const response = this.getDefaultHistoryTxResponse()
    response.proc_return_code = procReturnCode
    response.order_id = text(rawTx, 'OrderId')
    response.status = approved
      ? AbstractQueryResponseDataMapper.TX_STATUS_APPROVED
      : AbstractQueryResponseDataMapper.TX_STATUS_DECLINED
    response.error_code = approved ? null : procReturnCode
    response.transaction_type = bankTxType === null ? null : this.valueMapper.mapTxType(bankTxType)
    response.currency = currency === null ? null : this.valueMapper.mapCurrency(currency, txType)

    if (!approved) return response

    response.auth_code = text(rawTx, 'AuthCode')
    response.ref_ret_num = text(rawTx, 'HostRefNum')
    response.masked_number = text(rawTx, 'CardMask')
    const amount = text(rawTx, 'PurchAmount')
    response.first_amount = amount === null ? null : this.valueFormatter.formatAmount(amount, txType)
    const insertTime = text(rawTx, 'InsertDatetime')
    response.transaction_time = insertTime === null ? null : this.valueFormatter.formatDateTime(insertTime, txType)

    let orderStatus: string | null = null
    if (response.transaction_type === TX_TYPE.PAY_AUTH || response.transaction_type === TX_TYPE.PAY_POST_AUTH) {
      response.capture = true
      response.capture_amount = response.first_amount
      response.capture_time = response.transaction_time
      orderStatus = PAYMENT_STATUS.PAYMENT_COMPLETED
    } else if (response.transaction_type === TX_TYPE.PAY_PRE_AUTH) {
      response.capture = false
      orderStatus = PAYMENT_STATUS.PRE_AUTH_COMPLETED
    }
    response.order_status = orderStatus

    return response
  }
}
