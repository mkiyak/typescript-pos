import type { AbstractPosAccount } from '../model/account/AbstractPosAccount.js'
import type { GatewayResponseData } from '../types.js'
import { AbstractCrypt } from './AbstractCrypt.js'

/** For gateways that need no cryptography. */
export class NullCrypt<A extends AbstractPosAccount = AbstractPosAccount> extends AbstractCrypt<A> {
  static supports(_gatewayClass: string): boolean {
    return true
  }

  create3DHash(_account: A, _formInputs: Record<string, string>): string {
    return ''
  }

  check3DHash(_account: A, _data: GatewayResponseData): boolean {
    return true
  }

  createHash(_account: A, _requestData: Record<string, unknown>): string {
    return ''
  }
}
