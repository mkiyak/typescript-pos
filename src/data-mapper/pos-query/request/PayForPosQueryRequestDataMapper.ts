import { PosError } from '../../../errors.js'
import type { PayForPosAccount } from '../../../model/account/PayForPosAccount.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import { AbstractQueryRequestDataMapper } from './AbstractQueryRequestDataMapper.js'

/** Builds the PayFor query requests: every one carries the merchant, user and member id of the account. */
export class PayForPosQueryRequestDataMapper extends AbstractQueryRequestDataMapper<PayForPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayForPos'
  }

  /** The account fields are added after the caller's own; fields the caller already set are kept. */
  override createCustomQueryRequestData(
    account: PayForPosAccount,
    requestData: Record<string, unknown>,
  ): Record<string, unknown> {
    return this.mergeAccountData(requestData, this.getRequestAccountData(account))
  }

  /** Lists the transactions of one day (`transaction_date`, a valid Date). */
  override createHistoryRequestData(account: PayForPosAccount, data: Record<string, unknown>): Record<string, unknown> {
    const date = data.transaction_date
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new PosError('Query field "transaction_date" must be a valid Date')
    }

    return {
      ...this.getRequestAccountData(account),
      SecureType: 'Report',
      ReqDate: this.valueFormatter.formatDateTime(date, 'ReqDate'),
      TxnType: this.valueMapper.mapTxType(QUERY_TYPE.HISTORY),
      Lang: this.getLang(data),
    }
  }

  private getRequestAccountData(account: PayForPosAccount): Record<string, string> {
    return {
      MerchantId: account.getMerchantId(),
      UserCode: account.getUsername(),
      UserPass: account.getPassword(),
      MbrId: account.getMbrId(),
    }
  }
}
