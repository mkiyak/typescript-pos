import { PAYMENT_STATUS } from '../../../PosInterface.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import { AbstractQueryResponseDataMapper } from './AbstractQueryResponseDataMapper.js'
import type { BinListResponse, PosQueryHistoryResponse } from './QueryResponseDataMapperInterface.js'

type RawRecord = Record<string, unknown>

function isRecord(value: unknown): value is RawRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The nested object at `path`, or an empty object when any step is missing. */
function child(source: unknown, ...path: string[]): RawRecord {
  let current: unknown = source
  for (const key of path) {
    current = isRecord(current) ? current[key] : undefined
  }
  return isRecord(current) ? current : {}
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

/** The bank returns one entry as an object and several as a list. */
function asList(value: unknown): RawRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord)
  return isRecord(value) ? [value] : []
}

/** Normalizes the Garanti (GVP) order list and BIN inquiry answers. */
export class GarantiPosQueryResponseDataMapper extends AbstractQueryResponseDataMapper {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'GarantiPos'
  }

  override mapHistoryResponse(raw: Record<string, unknown>): PosQueryHistoryResponse {
    const data = this.emptyStringsToNull(raw) as RawRecord
    const procReturnCode = this.getProcReturnCode(data)
    const approved = procReturnCode === AbstractQueryResponseDataMapper.PROCEDURE_SUCCESS_CODE
    const status = approved
      ? AbstractQueryResponseDataMapper.TX_STATUS_APPROVED
      : AbstractQueryResponseDataMapper.TX_STATUS_DECLINED

    const transactions = approved
      ? asList(child(data, 'Order', 'OrderListInqResult', 'OrderTxnList').OrderTxn).map((tx) =>
          this.mapSingleHistoryTransaction(tx),
        )
      : []

    return {
      proc_return_code: procReturnCode,
      error_code: approved ? null : procReturnCode,
      error_message: approved ? null : text(child(data, 'Transaction', 'Response').ErrorMsg),
      status,
      trans_count: transactions.length,
      transactions,
      all: data,
    }
  }

  override mapBinListResponse(raw: Record<string, unknown>): BinListResponse {
    const data = this.emptyStringsToNull(raw) as RawRecord
    const approved = this.getProcReturnCode(data) === AbstractQueryResponseDataMapper.PROCEDURE_SUCCESS_CODE

    const result = this.getDefaultBinListResponse()
    result.status = approved
      ? AbstractQueryResponseDataMapper.TX_STATUS_APPROVED
      : AbstractQueryResponseDataMapper.TX_STATUS_DECLINED
    result.error_message = approved ? null : text(child(data, 'Transaction', 'Response').ErrorMsg)
    result.all = data

    if (approved) {
      for (const rawBin of asList(child(data, 'BINInqResult', 'BINList').BIN)) {
        result.bin_list.push(this.mapSingleBin(rawBin))
      }
    }

    return result
  }

  private mapSingleBin(rawBin: RawRecord): BinListResponse['bin_list'][number] {
    return {
      bin: String(rawBin.BINNum ?? ''),
      bank_code: text(rawBin.BankCode),
      bank_name: text(rawBin.BankName),
      card_type: this.valueMapper.mapCardType(text(rawBin.Organization)),
      card_class: this.valueMapper.mapCardClass(text(rawBin.CardType)),
      card_family: null,
    }
  }

  private getProcReturnCode(response: RawRecord): string | null {
    return text(child(response, 'Transaction', 'Response').Code)
  }

  private mapSingleHistoryTransaction(rawTx: RawRecord): Record<string, unknown> {
    const txType = QUERY_TYPE.HISTORY
    const procReturnCode = text(rawTx.ResponseCode)
    const approved = procReturnCode === AbstractQueryResponseDataMapper.PROCEDURE_SUCCESS_CODE

    const result = this.getDefaultHistoryTxResponse()
    result.auth_code = text(rawTx.AuthCode)
    result.ref_ret_num = text(rawTx.RetrefNum)
    result.order_id = text(rawTx.OrderID)
    result.batch_num = text(rawTx.BatchNum)
    result.proc_return_code = procReturnCode
    result.transaction_type = rawTx.TrxType != null ? this.valueMapper.mapTxType(String(rawTx.TrxType)) : null
    result.order_status =
      rawTx.Status != null
        ? this.valueMapper.mapOrderStatus(String(rawTx.Status), txType, result.transaction_type as never)
        : null
    result.status = approved
      ? AbstractQueryResponseDataMapper.TX_STATUS_APPROVED
      : AbstractQueryResponseDataMapper.TX_STATUS_DECLINED
    result.error_code = approved ? null : procReturnCode
    result.error_message = approved ? null : text(rawTx.SysErrMsg)
    result.payment_model = this.valueMapper.mapSecureType(text(rawTx.SafeType) ?? '', txType)
    result.transaction_time =
      rawTx.LastTrxDate != null ? this.valueFormatter.formatDateTime(String(rawTx.LastTrxDate), txType) : null

    if (approved) {
      result.masked_number = text(rawTx.CardNumberMasked)
      result.installment_count = this.valueFormatter.formatInstallment(text(rawTx.InstallmentCnt), txType)
      result.currency =
        rawTx.CurrencyCode != null ? this.valueMapper.mapCurrency(String(rawTx.CurrencyCode), txType) : null
      result.first_amount =
        rawTx.AuthAmount != null ? this.valueFormatter.formatAmount(rawTx.AuthAmount as string | number, txType) : null
      if (result.order_status === PAYMENT_STATUS.PAYMENT_COMPLETED) {
        result.capture_amount = result.first_amount
        result.capture = (result.first_amount as number) > 0 ? result.capture_amount === result.first_amount : null
        result.capture_time = result.transaction_time
      }
    }

    return result
  }
}
