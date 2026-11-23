import { NotImplementedError } from '../errors.js'
import type { AssecoPosAccount } from '../model/account/AssecoPosAccount.js'
import type { GatewayResponseData } from '../types.js'
import { strnatcasecmp } from '../util/strnatcasecmp.js'
import { timingSafeEqualStr } from '../util/timingSafeEqualStr.js'
import { AbstractCrypt } from './AbstractCrypt.js'

/** Keys that never take part in the hash (bank response fields). Compared in lower case. */
const EXCLUDED_KEYS: ReadonlySet<string> = new Set(['hash', 'encoding', 'nationalidno'])

/** PHP `(string)` cast for a scalar form value (null/undefined/false -> '', true -> '1'). */
function phpString(value: unknown): string {
  if (value === null || value === undefined || value === false) return ''
  if (value === true) return '1'
  return String(value)
}

/** NestPay/EST "ver3" hash. */
export class AssecoPosCrypt extends AbstractCrypt<AssecoPosAccount> {
  protected override readonly hashAlgorithm = 'sha512'

  protected override readonly hashSeparator = '|'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'AssecoPos'
  }

  /**
   * Sorts the inputs by key (natural, case-insensitive), drops `hash`, `encoding` and `nationalidno`, appends the
   * store key, escapes `\` and `|` in every value, joins with `|` and returns base64(sha512(utf8)).
   *
   * `nationalidno` (seen in Ziraat callbacks) must not be part of the hash string; confirmed by Asseco.
   */
  create3DHash(account: AssecoPosAccount, formInputs: Record<string, string>): string {
    const values = Object.entries(formInputs)
      .sort(([a], [b]) => strnatcasecmp(a, b))
      .filter(([key]) => !EXCLUDED_KEYS.has(key.toLowerCase()))
      .map(([, value]) => phpString(value))

    values.push(account.getSecretKey())

    const escaped = values.map((value) =>
      value.replaceAll('\\', '\\\\').replaceAll(this.hashSeparator, `\\${this.hashSeparator}`),
    )

    return this.hashString(escaped.join(this.hashSeparator))
  }

  /** A missing, empty or non-string `HASH` never matches. The store key is never logged. */
  check3DHash(account: AssecoPosAccount, data: GatewayResponseData): boolean {
    const actualHash = this.create3DHash(account, data as Record<string, string>)

    if (timingSafeEqualStr(data.HASH, actualHash)) {
      this.logger.debug('hash check is successful')
      return true
    }

    // The generated hash is deliberately not logged: for the logged data it would be a valid forged callback hash.
    this.logger.error('hash check failed', { data, expected_hash: data.HASH })
    return false
  }

  createHash(_account: AssecoPosAccount, _requestData: Record<string, unknown>): string {
    throw new NotImplementedError()
  }
}
