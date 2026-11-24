import { PAYMENT_STATUS, TX_TYPE } from '../../../PosInterface.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import type { AkbankPosResponseValueMapper } from '../../response/value-mapper/AkbankPosResponseValueMapper.js'
import { AbstractQueryResponseDataMapper } from './AbstractQueryResponseDataMapper.js'
import type { PosQueryHistoryResponse } from './QueryResponseDataMapperInterface.js'

type Raw = Record<string, unknown>

/** Only strings, finite numbers and bigints are bank values; objects, arrays and the rest read as missing. */
function scalar(value: unknown): string | number | bigint | null {
  if (typeof value === 'string' || typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function field(data: Raw, key: string): string | number | bigint | null {
  return Object.hasOwn(data, key) ? scalar(data[key]) : null
}

function text(data: Raw, key: string): string | null {
  const value = field(data, key)
  return value === null ? null : String(value)
}

function isRecord(value: unknown): value is Raw {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Normalizes the transaction list of the Akbank history query. */
export class AkbankPosQueryResponseDataMapper extends AbstractQueryResponseDataMapper {
  static override readonly PROCEDURE_SUCCESS_CODE = 'VPS-0000'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'AkbankPos'
  }

  override mapHistoryResponse(raw: Record<string, unknown>): PosQueryHistoryResponse {
    const procReturnCode = text(raw, 'responseCode')
    const approved = procReturnCode === AkbankPosQueryResponseDataMapper.PROCEDURE_SUCCESS_CODE

    const transactions: Raw[] = []
    if (approved) {
      const list = isRecord(raw.data) ? raw.data.txnDetailList : undefined
      if (Array.isArray(list)) {
        for (const rawTx of list) {
          if (isRecord(rawTx)) transactions.push(this.mapSingleHistoryTransaction(rawTx))
        }
      }
    }

    return {
      proc_return_code: procReturnCode,
      error_code: procReturnCode !== null && !approved ? procReturnCode : null,
      error_message: procReturnCode !== null && !approved ? text(raw, 'responseMessage') : null,
      status: approved
        ? AbstractQueryResponseDataMapper.TX_STATUS_APPROVED
        : AbstractQueryResponseDataMapper.TX_STATUS_DECLINED,
      trans_count: transactions.length,
      transactions,
      all: raw,
    }
  }

  private formatAmountOrNull(value: unknown): number | null {
    const amount = scalar(value)
    if (amount === null) return null
    const str = String(amount)
    // a non-numeric amount is unknown, not zero
    if (str.trim() === '' || !Number.isFinite(Number(str))) return null
    return this.valueFormatter.formatAmount(str, QUERY_TYPE.HISTORY)
  }

  private formatDateOrNull(value: unknown): Date | null {
    const dateTime = scalar(value)
    return dateTime === null ? null : this.valueFormatter.formatDateTime(String(dateTime), QUERY_TYPE.HISTORY)
  }

  private mapOrderStatus(orderStatus: string | null, preAuthStatus: string | null): unknown {
    if (orderStatus === null) return null
    const mapper = this.valueMapper as Partial<AkbankPosResponseValueMapper>
    if (typeof mapper.mapOrderStatusDetailed === 'function') {
      return mapper.mapOrderStatusDetailed.call(this.valueMapper, orderStatus, preAuthStatus, false)
    }
    return this.valueMapper.mapOrderStatus(orderStatus)
  }

  private mapSingleHistoryTransaction(rawTx: Raw): Raw {
    const txType = QUERY_TYPE.HISTORY
    const transaction = this.getDefaultHistoryTxResponse()

    transaction.proc_return_code = text(rawTx, 'responseCode')
    if (transaction.proc_return_code === AkbankPosQueryResponseDataMapper.PROCEDURE_SUCCESS_CODE) {
      transaction.status = AbstractQueryResponseDataMapper.TX_STATUS_APPROVED
    }

    const currencyCode = text(rawTx, 'currencyCode')
    const txnCode = text(rawTx, 'txnCode')
    transaction.currency = currencyCode === null ? null : this.valueMapper.mapCurrency(currencyCode, txType)
    transaction.installment_count = this.valueFormatter.formatInstallment(text(rawTx, 'installmentCount'), txType)
    transaction.transaction_type = txnCode === null ? null : this.valueMapper.mapTxType(txnCode)
    transaction.first_amount = this.formatAmountOrNull(rawTx.amount)
    transaction.transaction_time = this.formatDateOrNull(rawTx.txnDateTime)

    if (transaction.status === AbstractQueryResponseDataMapper.TX_STATUS_APPROVED) {
      transaction.order_id = field(rawTx, 'orderId')
      transaction.masked_number = field(rawTx, 'maskedCardNumber')
      transaction.ref_ret_num = field(rawTx, 'rrn')
      // the batch number is missing for a canceled payment
      transaction.batch_num = field(rawTx, 'batchNumber')
      transaction.order_status = this.mapOrderStatus(text(rawTx, 'txnStatus'), text(rawTx, 'preAuthStatus'))
      transaction.auth_code = field(rawTx, 'authCode')
      if (transaction.order_status === PAYMENT_STATUS.PAYMENT_COMPLETED) {
        if (
          transaction.transaction_type === TX_TYPE.PAY_AUTH ||
          transaction.transaction_type === TX_TYPE.PAY_POST_AUTH
        ) {
          transaction.capture_amount = this.formatAmountOrNull(rawTx.amount)
          transaction.capture = transaction.first_amount === transaction.capture_amount
          if (transaction.capture) {
            transaction.capture_time = this.formatDateOrNull(rawTx.txnDateTime)
          }
        } else if (transaction.transaction_type === TX_TYPE.PAY_PRE_AUTH) {
          transaction.capture_amount = this.formatAmountOrNull(rawTx.preAuthCloseAmount)
          transaction.capture = transaction.first_amount === transaction.capture_amount
          if (transaction.capture) {
            transaction.capture_time = this.formatDateOrNull(rawTx.preAuthCloseDate)
          }
        }
      }
    } else {
      transaction.error_code = transaction.proc_return_code
    }

    return transaction
  }
}
