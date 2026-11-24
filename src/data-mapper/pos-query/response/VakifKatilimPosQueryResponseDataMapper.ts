import { PAYMENT_STATUS } from '../../../PosInterface.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import { child, exactString, NO_DATE, type Raw, scalar, text } from '../../response/mapper/boaResponseFields.js'
import { AbstractQueryResponseDataMapper } from './AbstractQueryResponseDataMapper.js'
import type { PosQueryHistoryResponse } from './QueryResponseDataMapperInterface.js'

/** The records of an answer: a single record (one order decodes as a record) or a list; anything else is none. */
function recordsOf(value: unknown): Raw[] {
  const list = Array.isArray(value) ? value : [value]
  return list.filter((item): item is Raw => item !== null && typeof item === 'object' && !Array.isArray(item))
}

/**
 * Normalizes the Vakıf Katılım order list. The list only says what the bank recorded: the answer counts as
 * approved when its `ResponseCode` is exactly `00`, a record when its own `ResponseCode` is exactly `00`, and
 * neither says more than that. Records come newest first.
 */
export class VakifKatilimPosQueryResponseDataMapper extends AbstractQueryResponseDataMapper {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'VakifKatilimPos'
  }

  override mapHistoryResponse(raw: Raw): PosQueryHistoryResponse {
    const values = this.emptyStringsToNull(raw) as Raw
    const procReturnCode = exactString(raw, 'ResponseCode')

    let status: PosQueryHistoryResponse['status'] = null
    if (procReturnCode !== null) {
      status =
        procReturnCode === AbstractQueryResponseDataMapper.PROCEDURE_SUCCESS_CODE
          ? AbstractQueryResponseDataMapper.TX_STATUS_APPROVED
          : AbstractQueryResponseDataMapper.TX_STATUS_DECLINED
    }

    const exactContracts = recordsOf(child(raw, 'VPosOrderData')?.OrderContract)
    const cleanContracts = recordsOf(child(values, 'VPosOrderData')?.OrderContract)
    const transactions: Raw[] = []
    // the cleaned copy and the exact copy list the same records in the same order
    for (const [index, exactTx] of exactContracts.entries()) {
      transactions.push(this.mapSingleHistoryTransaction(cleanContracts[index] ?? {}, exactTx))
    }
    transactions.reverse()

    const failed = procReturnCode !== null && procReturnCode !== AbstractQueryResponseDataMapper.PROCEDURE_SUCCESS_CODE

    return {
      proc_return_code: procReturnCode,
      error_code: failed ? procReturnCode : null,
      error_message: failed ? text(values, 'ResponseMessage') : null,
      status,
      trans_count: transactions.length,
      transactions,
      all: values,
    }
  }

  private mapSingleHistoryTransaction(rawTx: Raw, exactTx: Raw): Raw {
    const txType = QUERY_TYPE.HISTORY
    const procReturnCode = exactString(exactTx, 'ResponseCode')
    const approved = procReturnCode === AbstractQueryResponseDataMapper.PROCEDURE_SUCCESS_CODE

    const response = this.getDefaultHistoryTxResponse()
    response.proc_return_code = procReturnCode
    response.status = approved
      ? AbstractQueryResponseDataMapper.TX_STATUS_APPROVED
      : AbstractQueryResponseDataMapper.TX_STATUS_DECLINED
    response.error_code = approved ? null : procReturnCode
    response.error_message = approved ? null : text(rawTx, 'ResponseExplain')

    const currency = scalar(rawTx, 'FEC')
    response.currency = currency === null ? null : this.valueMapper.mapCurrency(currency, txType)
    const security = scalar(rawTx, 'TransactionSecurity')
    response.payment_model = security === null ? null : this.valueMapper.mapSecureType(security, txType)
    response.ref_ret_num = text(rawTx, 'RRN')
    response.transaction_id = text(rawTx, 'Stan')
    response.transaction_time = this.time(rawTx, 'OrderDate', txType)
    response.order_id = text(rawTx, 'MerchantOrderId')
    response.remote_order_id = text(rawTx, 'OrderId')

    if (!approved) return response

    response.auth_code = text(rawTx, 'ProvNumber')
    const installment = text(rawTx, 'InstallmentCount')
    response.installment_count =
      installment === null ? null : this.valueFormatter.formatInstallment(installment, txType)
    response.masked_number = text(rawTx, 'CardNumber')
    response.first_amount = this.amount(rawTx, 'FirstAmount', txType)
    const lastStatus = scalar(rawTx, 'LastOrderStatus') ?? scalar(rawTx, 'LastOrderStatusDescription')
    response.order_status = lastStatus === null ? null : this.valueMapper.mapOrderStatus(lastStatus)
    const initialStatus = scalar(rawTx, 'OrderStatus')
    const initial = initialStatus === null ? null : this.valueMapper.mapOrderStatus(initialStatus)

    if (initial === PAYMENT_STATUS.PAYMENT_COMPLETED) {
      response.capture_amount = this.amount(rawTx, 'TranAmount', txType) ?? 0
      response.capture = response.first_amount === response.capture_amount
      if (response.capture) response.capture_time = response.transaction_time
    } else if (initial === PAYMENT_STATUS.CANCELED) {
      response.cancel_time = response.transaction_time
    }

    return response
  }

  private amount(rawTx: Raw, key: string, txType: string): number | null {
    const value = scalar(rawTx, key)
    return value === null ? null : this.valueFormatter.formatAmount(value, txType)
  }

  /** A bank time that cannot be read leaves the field empty instead of failing the whole list. */
  private time(rawTx: Raw, key: string, txType: string): Date | null {
    const value = text(rawTx, key)
    if (value === null || NO_DATE.test(value)) return null
    try {
      return this.valueFormatter.formatDateTime(value, txType)
    } catch {
      return null
    }
  }
}
