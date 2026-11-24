import type { PosNetPosAccount } from '../../../model/account/PosNetPosAccount.js'
import { AbstractQueryRequestDataMapper } from './AbstractQueryRequestDataMapper.js'

/** Adds the merchant and terminal numbers to a custom query; values the caller already set are kept. */
export class PosNetPosQueryRequestDataMapper extends AbstractQueryRequestDataMapper<PosNetPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PosNetPos'
  }

  override createCustomQueryRequestData(
    account: PosNetPosAccount,
    requestData: Record<string, unknown>,
  ): Record<string, unknown> {
    return this.mergeAccountData(requestData, {
      mid: account.getMerchantId(),
      tid: account.getTerminalId(),
    })
  }
}
