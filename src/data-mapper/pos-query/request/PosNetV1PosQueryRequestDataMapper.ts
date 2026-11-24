import { PosError } from '../../../errors.js'
import type { PosNetPosAccount } from '../../../model/account/PosNetPosAccount.js'
import { ownValue } from '../../../util/ownValue.js'
import { AbstractQueryRequestDataMapper } from './AbstractQueryRequestDataMapper.js'

const API_VERSION = 'V100'

/**
 * Adds the API fields and the merchant and terminal numbers to a custom query and signs it. The signature covers the
 * fields the request names in `MACParams` (colon separated); a `MAC` the caller already set is kept as it is.
 */
export class PosNetV1PosQueryRequestDataMapper extends AbstractQueryRequestDataMapper<PosNetPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PosNetV1Pos'
  }

  /**
   * @throws PosError when the request carries no `MAC` and `MACParams` is missing, empty or not a string
   */
  override createCustomQueryRequestData(
    account: PosNetPosAccount,
    requestData: Record<string, unknown>,
  ): Record<string, unknown> {
    const merged = this.mergeAccountData(requestData, {
      ApiType: 'JSON',
      ApiVersion: API_VERSION,
      MerchantNo: account.getMerchantId(),
      TerminalNo: account.getTerminalId(),
    })

    if (ownValue(merged, 'MAC') === undefined) {
      const macParams = ownValue(merged, 'MACParams')
      if (typeof macParams !== 'string' || macParams === '') {
        throw new PosError(
          'A custom query without a MAC needs MACParams: the colon separated names of the signed fields.',
        )
      }
      merged.MAC = this.crypt.hashFromParams(account, merged, macParams, ':')
    }

    return merged
  }
}
