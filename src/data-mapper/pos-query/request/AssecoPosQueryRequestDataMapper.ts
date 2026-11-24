import type { AssecoPosAccount } from '../../../model/account/AssecoPosAccount.js'
import { AbstractQueryRequestDataMapper } from './AbstractQueryRequestDataMapper.js'

/** Adds the API user's credentials to a custom query; values the caller already set are kept. */
export class AssecoPosQueryRequestDataMapper extends AbstractQueryRequestDataMapper<AssecoPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'AssecoPos'
  }

  override createCustomQueryRequestData(
    account: AssecoPosAccount,
    requestData: Record<string, unknown>,
  ): Record<string, unknown> {
    return this.mergeAccountData(requestData, {
      Name: account.getUsername(),
      Password: account.getPassword(),
      ClientId: account.getMerchantId(),
    })
  }
}
