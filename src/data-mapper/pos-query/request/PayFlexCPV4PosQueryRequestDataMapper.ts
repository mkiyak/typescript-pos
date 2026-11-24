import type { PayFlexPosAccount } from '../../../model/account/PayFlexPosAccount.js'
import { AbstractQueryRequestDataMapper } from './AbstractQueryRequestDataMapper.js'

/**
 * Adds the credentials the common payment transaction query takes: the host merchant, the merchant (the
 * sub-merchant of a sub-dealer account, otherwise '1', as in the status query) and the password.
 */
export class PayFlexCPV4PosQueryRequestDataMapper extends AbstractQueryRequestDataMapper<PayFlexPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayFlexCPV4Pos'
  }

  override createCustomQueryRequestData(
    account: PayFlexPosAccount,
    requestData: Record<string, unknown>,
  ): Record<string, unknown> {
    const subMerchantId = account.getSubMerchantId()
    const merchantId = account.isSubBranch() && subMerchantId !== null && subMerchantId !== '' ? subMerchantId : '1'

    return this.mergeAccountData(requestData, {
      HostMerchantId: account.getMerchantId(),
      MerchantId: merchantId,
      Password: account.getPassword(),
    })
  }
}
