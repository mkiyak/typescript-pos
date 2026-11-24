import { PosError } from '../../../errors.js'
import type { BoaPosAccount } from '../../../model/account/BoaPosAccount.js'
import { AbstractQueryRequestDataMapper } from './AbstractQueryRequestDataMapper.js'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 10

/** A date the caller must give as a valid `Date`; text or a missing value is refused instead of being signed. */
function requiredDate(data: Record<string, unknown>, key: string): Date {
  const value = Object.hasOwn(data, key) ? data[key] : undefined
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new PosError(`Query field "${key}" must be a valid Date`)
  }
  return value
}

/** A paging number that is a positive whole number; absent means the default. */
function positiveInteger(data: Record<string, unknown>, key: string, fallback: number): number {
  const value = Object.hasOwn(data, key) ? data[key] : undefined
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new PosError(`Query field "${key}" must be a positive whole number`)
  }
  return value
}

/**
 * Builds the Vakıf Katılım query requests. A custom query goes out exactly as the caller gave it (the caller
 * names the URL and supplies every field, signature included); `history` lists the orders of a date range and is
 * signed over the account fields like the gateway's own requests.
 */
export class VakifKatilimPosQueryRequestDataMapper extends AbstractQueryRequestDataMapper<BoaPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'VakifKatilimPos'
  }

  /** `start_date` and `end_date` are explicit instants (their Türkiye calendar day is sent), `page` counts from 1. */
  override createHistoryRequestData(account: BoaPosAccount, data: Record<string, unknown>): Record<string, unknown> {
    const startDate = requiredDate(data, 'start_date')
    const endDate = requiredDate(data, 'end_date')
    const page = positiveInteger(data, 'page', DEFAULT_PAGE)
    const pageSize = positiveInteger(data, 'page_size', DEFAULT_PAGE_SIZE)

    const result: Record<string, unknown> = {
      MerchantId: account.getMerchantId(),
      CustomerId: account.getCustomerId(),
      UserName: account.getUsername(),
      SubMerchantId: account.getSubMerchantId() ?? '0',
      StartDate: this.valueFormatter.formatDateTime(startDate, 'StartDate'),
      EndDate: this.valueFormatter.formatDateTime(endDate, 'EndDate'),
      LowerLimit: (page - 1) * pageSize,
      UpperLimit: pageSize,
      ProvNumber: null,
      OrderStatus: null,
      TranResult: null,
      OrderNo: null,
    }
    // the crypt gets a snapshot, so it sees exactly what is sent and cannot alter it
    result.HashData = this.crypt.createHash(account, { ...result })

    return result
  }
}
