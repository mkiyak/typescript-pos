import { PosError } from '../../../errors.js'
import type { PayTrPosAccount } from '../../../model/account/PayTrPosAccount.js'
import { ownValue } from '../../../util/ownValue.js'
import { isRecord } from '../../request/mapper/paramRequestFields.js'
import { AbstractQueryRequestDataMapper } from './AbstractQueryRequestDataMapper.js'

/** A card number prefix: six or eight digits. */
const BIN_PATTERN = /^(?:\d{6}|\d{8})$/
/** The report window the bank accepts: at most three days. */
const MAX_HISTORY_SPAN_MS = 3 * 24 * 60 * 60 * 1000

/** A date of the history window: a valid `Date` or nothing else. */
function requiredDate(data: Record<string, unknown>, key: string): Date {
  const value = ownValue(data, key)
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new PosError(`History query field "${key}" must be a valid Date`)
  }

  return value
}

/** A 6- or 8-digit BIN given as text or as a whole number; anything else is refused instead of being signed. */
function requiredBin(params: Record<string, unknown>): string {
  const bin = isRecord(params) ? ownValue(params, 'bin') : undefined
  const valid = typeof bin === 'string' || (typeof bin === 'number' && Number.isSafeInteger(bin))
  if (!valid || !BIN_PATTERN.test(String(bin))) {
    throw new PosError('BIN must have 6 or 8 digits')
  }

  return String(bin)
}

/**
 * Builds the PayTR query requests. Every body carries `paytr_token`, an HMAC over the signed fields of its endpoint and
 * the merchant salt; the crypt picks the field list from the keys of the body. The token is computed last, so a hook
 * that edits a signed field afterwards makes the request invalid on purpose.
 */
export class PayTrPosQueryRequestDataMapper extends AbstractQueryRequestDataMapper<PayTrPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayTrPos'
  }

  /**
   * The caller's fields come first and are kept; `merchant_id` is added when the caller left it out. The token is
   * computed over the merged data (with the formula the keys select) unless the caller supplied a non-empty one.
   */
  override createCustomQueryRequestData(
    account: PayTrPosAccount,
    requestData: Record<string, unknown>,
  ): Record<string, unknown> {
    const merged = this.mergeAccountData(requestData, { merchant_id: account.getMerchantId() })
    // a null merchant id counts as absent
    if (merged.merchant_id === null) merged.merchant_id = account.getMerchantId()
    const given = ownValue(merged, 'paytr_token')
    // a caller token that is empty counts as absent, like a missing one
    if (given !== undefined && given !== null && given !== '') return merged

    return this.signed(account, merged)
  }

  /**
   * The transactions of a time window of at most three days. `dummy` is always sent (1 in test mode, else 0) and is
   * not part of the signature.
   */
  override createHistoryRequestData(account: PayTrPosAccount, data: Record<string, unknown>): Record<string, unknown> {
    const input = isRecord(data) ? data : {}
    const start = requiredDate(input, 'start_date')
    const end = requiredDate(input, 'end_date')
    if (end.getTime() < start.getTime()) {
      throw new PosError('History query end_date must not be before start_date')
    }
    if (end.getTime() - start.getTime() > MAX_HISTORY_SPAN_MS) {
      throw new PosError('History query window must not be longer than three days')
    }

    return this.signed(account, {
      merchant_id: account.getMerchantId(),
      start_date: this.valueFormatter.formatDateTime(start, 'start_date'),
      end_date: this.valueFormatter.formatDateTime(end, 'end_date'),
      dummy: this.isTestMode() ? 1 : 0,
    })
  }

  /** The installment rates of the merchant; the query takes no parameter. */
  override createInstallmentRatesRequestData(
    account: PayTrPosAccount,
    _params: Record<string, unknown>,
  ): Record<string, unknown> {
    return this.signed(account, { merchant_id: account.getMerchantId(), request_id: this.crypt.generateRandomString() })
  }

  /** The card details of a BIN; `bin` (6 or 8 digits) is required. */
  override createBinListRequestData(
    account: PayTrPosAccount,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    return this.signed(account, { merchant_id: account.getMerchantId(), bin_number: requiredBin(params) })
  }

  private signed(account: PayTrPosAccount, requestData: Record<string, unknown>): Record<string, unknown> {
    // the crypt gets a snapshot, so it sees exactly what is sent and cannot alter it
    return { ...requestData, paytr_token: this.crypt.createHash(account, { ...requestData }) }
  }
}
