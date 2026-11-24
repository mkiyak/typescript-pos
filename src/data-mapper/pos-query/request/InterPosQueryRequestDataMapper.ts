import type { InterPosAccount } from '../../../model/account/InterPosAccount.js'
import { AbstractQueryRequestDataMapper } from './AbstractQueryRequestDataMapper.js'

/** Adds the user code, user password and shop code to a custom query; values the caller already set are kept. */
export class InterPosQueryRequestDataMapper extends AbstractQueryRequestDataMapper<InterPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'InterPos'
  }

  override createCustomQueryRequestData(
    account: InterPosAccount,
    requestData: Record<string, unknown>,
  ): Record<string, unknown> {
    return this.mergeAccountData(requestData, {
      UserCode: account.getUsername(),
      UserPass: account.getPassword(),
      ShopCode: account.getMerchantId(),
    })
  }
}
