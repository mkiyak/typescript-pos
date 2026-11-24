import { PosError } from '../../../errors.js'
import type { AkbankPosAccount } from '../../../model/account/AkbankPosAccount.js'
import { AbstractQueryRequestDataMapper } from './AbstractQueryRequestDataMapper.js'

const API_VERSION = '1.00'

function validDate(data: Record<string, unknown>, key: string): Date {
  const value = data[key]
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new PosError(`Query field "${key}" must be a valid Date`)
  }
  return value
}

/**
 * Builds the Akbank query requests. The terminal (and the sub-merchant of a sub-merchant account) and a random
 * number go into every request; the HTTP client signs the exact body it sends, so nothing is signed here.
 */
export class AkbankPosQueryRequestDataMapper extends AbstractQueryRequestDataMapper<AkbankPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'AkbankPos'
  }

  /**
   * The caller's keys come first and keep their values; terminal, version, request time and random number are added
   * only when the caller left them out.
   */
  override createCustomQueryRequestData(
    account: AkbankPosAccount,
    requestData: Record<string, unknown>,
  ): Record<string, unknown> {
    return this.mergeAccountData(requestData, {
      ...this.getAccountData(account),
      version: API_VERSION,
      requestDateTime: this.valueFormatter.formatDateTime(new Date(), 'requestDateTime'),
      randomNumber: this.crypt.generateRandomString(),
    })
  }

  /** A batch number wins over a date range; the bank allows at most one day between the two dates. */
  override createHistoryRequestData(account: AkbankPosAccount, data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {
      ...this.getAccountData(account),
      randomNumber: this.crypt.generateRandomString(),
    }

    if (data.batch_num !== undefined && data.batch_num !== null) {
      result.report = { batchNumber: data.batch_num }
    } else if (data.start_date !== undefined && data.end_date !== undefined) {
      result.report = {
        startDateTime: this.valueFormatter.formatDateTime(validDate(data, 'start_date'), 'startDateTime'),
        endDateTime: this.valueFormatter.formatDateTime(validDate(data, 'end_date'), 'endDateTime'),
      }
    } else {
      throw new PosError('History needs "batch_num" or both "start_date" and "end_date"')
    }

    return result
  }

  private getAccountData(account: AkbankPosAccount): Record<string, unknown> {
    const data: Record<string, unknown> = {
      terminal: { merchantSafeId: account.getMerchantId(), terminalSafeId: account.getTerminalId() },
    }
    const subMerchantId = account.getSubMerchantId()
    if (subMerchantId !== null) {
      data.subMerchant = { subMerchantId }
    }
    return data
  }
}
