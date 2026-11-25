import { PosError } from '../../../errors.js'
import type { ParamPosAccount } from '../../../model/account/ParamPosAccount.js'
import { TX_TYPE } from '../../../PosInterface.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import { ownValue } from '../../../util/ownValue.js'
import { phpTrim } from '../../../util/phpTrim.js'
import { accountData, envelope, isRecord, XMLNS } from '../../request/mapper/paramRequestFields.js'
import { AbstractQueryRequestDataMapper } from './AbstractQueryRequestDataMapper.js'

/** A SOAP action is one element name; markup, prefixes and spaces never reach the envelope. */
const ACTION_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/
/** A card number prefix: six or eight digits. */
const BIN_PATTERN = /^(?:\d{6}|\d{8})$/
const MAX_STATUS_LENGTH = 64

/** The bank words of the transaction types a history query can be limited to. */
const HISTORY_TYPE_WORDS: Readonly<Record<string, string>> = {
  [TX_TYPE.PAY_AUTH]: 'Satış',
  [TX_TYPE.CANCEL]: 'İptal',
  [TX_TYPE.REFUND]: 'İade',
}

/** A 6- or 8-digit BIN given as text or as a whole number; anything else is refused instead of being sent. */
function readBin(params: Record<string, unknown>): string | null {
  const bin = isRecord(params) ? ownValue(params, 'bin') : undefined
  if (bin === undefined || bin === null) return null
  const valid = typeof bin === 'string' || (typeof bin === 'number' && Number.isSafeInteger(bin))
  if (!valid || !BIN_PATTERN.test(String(bin))) {
    throw new PosError('BIN must have 6 or 8 digits')
  }

  return String(bin)
}

/** The optional status filter: text of a bounded size; blank text is no filter. */
function readOrderStatus(data: Record<string, unknown>): string | null {
  const status = ownValue(data, 'order_status')
  if (status === undefined || status === null) return null
  if (typeof status !== 'string' || status.length > MAX_STATUS_LENGTH) {
    throw new PosError(`Order status must be text of at most ${MAX_STATUS_LENGTH} characters`)
  }

  return phpTrim(status) === '' ? null : status
}

/**
 * Builds the Param query requests. Every body carries the account's client code, API user, API password and the
 * merchant key; there is no signature, so a hook that edits the prepared body cannot invalidate anything. History
 * windows are written in Türkiye time whatever the server's own zone is.
 */
export class ParamPosQueryRequestDataMapper extends AbstractQueryRequestDataMapper<ParamPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'ParamPos'
  }

  /**
   * A custom query names one SOAP action whose value holds the action's fields. The caller's fields come first and
   * are kept; the account fields are added where the caller left them out.
   */
  override createCustomQueryRequestData(
    account: ParamPosAccount,
    requestData: Record<string, unknown>,
  ): Record<string, unknown> {
    const actions = isRecord(requestData) ? Object.keys(requestData) : []
    const action = actions[0]
    const fields = action === undefined ? undefined : requestData[action]
    if (actions.length !== 1 || action === undefined || !ACTION_NAME.test(action) || !isRecord(fields)) {
      throw new PosError('Param custom queries need one SOAP action')
    }

    return envelope({ [action]: this.mergeAccountData(fields, { ...accountData(account) }) })
  }

  /** The records of a date window, optionally limited to a status text and to sales, cancels or refunds. */
  override createHistoryRequestData(account: ParamPosAccount, input: Record<string, unknown>): Record<string, unknown> {
    const data = isRecord(input) ? input : {}
    const requestData: Record<string, unknown> = {
      ...accountData(account),
      '@xmlns': XMLNS,
      Tarih_Bas: this.valueFormatter.formatDateTime(ownValue(data, 'start_date') as Date, 'Tarih_Bas'),
      Tarih_Bit: this.valueFormatter.formatDateTime(ownValue(data, 'end_date') as Date, 'Tarih_Bit'),
    }

    const status = readOrderStatus(data)
    if (status !== null) requestData.Islem_Durum = status

    const txType = ownValue(data, 'transaction_type')
    if (typeof txType === 'string' && Object.hasOwn(HISTORY_TYPE_WORDS, txType)) {
      requestData.Islem_Tip = HISTORY_TYPE_WORDS[txType]
    }

    return envelope({ [this.valueMapper.mapTxType(QUERY_TYPE.HISTORY)]: requestData })
  }

  /** The card programs of the merchant's special rates; the query takes no parameter. */
  override createInstallmentRatesRequestData(
    account: ParamPosAccount,
    _params: Record<string, unknown>,
  ): Record<string, unknown> {
    return envelope({
      [this.valueMapper.mapTxType(QUERY_TYPE.INSTALLMENT_RATES)]: { '@xmlns': XMLNS, ...accountData(account) },
    })
  }

  /** The cards of a BIN, or of every BIN when none is given. */
  override createBinListRequestData(
    account: ParamPosAccount,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const requestData: Record<string, unknown> = { '@xmlns': XMLNS, ...accountData(account) }
    const bin = readBin(params)
    if (bin !== null) requestData.BIN = bin

    return envelope({ [this.valueMapper.mapTxType(QUERY_TYPE.BIN_LIST)]: requestData })
  }
}
