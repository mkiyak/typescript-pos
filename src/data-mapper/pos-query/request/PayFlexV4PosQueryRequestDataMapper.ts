import type { PayFlexPosAccount } from '../../../model/account/PayFlexPosAccount.js'
import { AbstractQueryRequestDataMapper } from './AbstractQueryRequestDataMapper.js'

/** Adds the merchant credentials to a custom query; values the caller already set are kept. */
export class PayFlexV4PosQueryRequestDataMapper extends AbstractQueryRequestDataMapper<PayFlexPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayFlexV4Pos'
  }

  override createCustomQueryRequestData(
    account: PayFlexPosAccount,
    requestData: Record<string, unknown>,
  ): Record<string, unknown> {
    return this.mergeAccountData(requestData, {
      MerchantId: account.getMerchantId(),
      Password: account.getPassword(),
      TerminalNo: account.getTerminalId(),
    })
  }
}
