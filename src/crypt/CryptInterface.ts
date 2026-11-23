import type { AbstractPosAccount } from '../model/account/AbstractPosAccount.js'
import type { GatewayResponseData } from '../types.js'

export interface CryptInterface<A extends AbstractPosAccount = AbstractPosAccount> {
  /** Hashes a string (base64 output). Some gateways use `encryptionKey` (e.g. HMAC). */
  hashString(str: string, encryptionKey?: string | null): string

  /** Verifies the hash of a 3D Secure callback. Must never throw on missing/malformed hash fields. */
  check3DHash(account: A, data: GatewayResponseData): boolean

  /** Creates the hash for 3D form inputs. */
  create3DHash(account: A, formInputs: Record<string, string>): string

  /** Creates the hash for API requests. */
  createHash(account: A, requestData: Record<string, unknown>): string

  /**
   * Hashes the values of the params listed in `hashParamsValue` (e.g. "MerchantNo:TerminalNo"),
   * found recursively in `data`, with the account secret key appended.
   */
  hashFromParams(account: A, data: Record<string, unknown>, hashParamsValue: string, paramSeparator?: string): string

  /** Random uppercase hex string, used as a nonce. Default length 24. */
  generateRandomString(length?: number): string
}
