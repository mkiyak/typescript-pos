import { NotImplementedError } from '../errors.js'
import type { PayFlexPosAccount } from '../model/account/PayFlexPosAccount.js'
import type { GatewayResponseData } from '../types.js'
import { AbstractCrypt } from './AbstractCrypt.js'

/**
 * VakifBank Common Payment. The gateway never calls any of these methods.
 *
 * - The registration request carries no `HashedData`: the field is optional (guide section 5) and the formula
 *   needs values that do not exist before the 3D step, so a registration cannot be signed with it (R2).
 * - The success/fail callback carries no signature; it is confirmed by the query API instead (R7).
 */
export class PayFlexCPV4PosCrypt extends AbstractCrypt<PayFlexPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayFlexCPV4Pos'
  }

  create3DHash(_account: PayFlexPosAccount, _formInputs: Record<string, string>): string {
    throw new NotImplementedError('Common payment has no 3D form hash.')
  }

  check3DHash(_account: PayFlexPosAccount, _data: GatewayResponseData): boolean {
    throw new NotImplementedError('The common payment callback is confirmed by the query API.')
  }

  createHash(_account: PayFlexPosAccount, _requestData: Record<string, unknown>): string {
    throw new NotImplementedError('The common payment registration is sent without HashedData.')
  }
}
