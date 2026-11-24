import { createHmac } from 'node:crypto'
import { MissingAccountInfoError, NotImplementedError, PosError } from '../errors.js'
import type { AkbankPosAccount } from '../model/account/AkbankPosAccount.js'
import type { GatewayResponseData } from '../types.js'
import { ownValue } from '../util/ownValue.js'
import { timingSafeEqualStr } from '../util/timingSafeEqualStr.js'
import { AbstractCrypt } from './AbstractCrypt.js'

/** The fields of the 3D form hash in signing order; an optional field that is absent signs as an empty string. */
const FORM_HASH_FIELDS: ReadonlyArray<readonly [name: string, optional: boolean]> = [
  ['paymentModel', false],
  ['txnCode', false],
  ['merchantSafeId', false],
  ['terminalSafeId', false],
  ['orderId', false],
  ['lang', false],
  ['amount', false],
  ['ccbRewardAmount', true],
  ['pcbRewardAmount', true],
  ['xcbRewardAmount', true],
  ['currencyCode', false],
  ['installCount', false],
  ['okUrl', false],
  ['failUrl', false],
  ['emailAddress', true],
  ['subMerchantId', true],
  // the 3D host model carries no card data
  ['creditCard', true],
  ['expiredDate', true],
  ['cvv', true],
  ['randomNumber', false],
  ['requestDateTime', false],
  ['b2bIdentityNumber', true],
]

const LOG_VALUE_LIMIT = 256

function truncated(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, LOG_VALUE_LIMIT) : undefined
}

/** Akbank (new API): HMAC-SHA512 over the request body, the 3D form fields and the callback fields. */
export class AkbankPosCrypt extends AbstractCrypt<AkbankPosAccount> {
  protected override readonly hashAlgorithm = 'sha512'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'AkbankPos'
  }

  /** Uppercase hex, 128 characters unless told otherwise. */
  override generateRandomString(length = 128): string {
    return super.generateRandomString(length)
  }

  /** Signs the 3D form fields, concatenated without separator in the order the bank defines. */
  create3DHash(account: AkbankPosAccount, formInputs: Record<string, string>): string {
    let text = ''
    for (const [name, optional] of FORM_HASH_FIELDS) {
      const value: unknown = ownValue(formInputs, name)
      if (optional && (value === undefined || value === null)) continue
      if (typeof value !== 'string' || (!optional && value === '')) {
        throw new PosError(`3D form field "${name}" is required to sign the request.`)
      }
      text += value
    }

    return this.hashString(text, account.getSecretKey())
  }

  /**
   * The callback signature covers the values of the fields named in `hashParams`. Only a field list whose decisive
   * response code sits at a fixed position is accepted (the values are concatenated without separator, so a
   * different arrangement could regroup the signed characters), and only own top-level non-empty strings are
   * hashed. The generated hash is deliberately not logged: for the logged data it would be a valid callback hash.
   */
  check3DHash(account: AkbankPosAccount, data: GatewayResponseData): boolean {
    const secretKey = this.requireKey(account.getSecretKey())
    const hash = ownValue(data, 'hash')
    const hashParams = ownValue(data, 'hashParams')

    if (typeof hash === 'string' && hash !== '' && typeof hashParams === 'string' && hashParams !== '') {
      const signedText = this.signedText(data, hashParams.split('+'))
      if (signedText !== null && timingSafeEqualStr(hash, this.hashString(signedText, secretKey))) {
        this.logger.debug('hash check is successful')
        return true
      }
    }

    this.logger.error('hash check failed', {
      order_id: truncated(ownValue(data, 'orderId')),
      hash_params: truncated(hashParams),
    })
    return false
  }

  createHash(_account: AkbankPosAccount, _requestData: Record<string, unknown>): string {
    throw new NotImplementedError('AkbankPos requests are signed through hashString.')
  }

  /** Base64 of the HMAC-SHA512 of `str` under the secret key. */
  override hashString(str: string, encryptionKey: string | null = null): string {
    const key = this.requireKey(encryptionKey)
    return createHmac('sha512', key).update(str, 'utf8').digest('base64')
  }

  private requireKey(key: string | null): string {
    if (key === null || key.trim() === '') {
      throw new MissingAccountInfoError('Encryption key is required')
    }
    return key
  }

  /** The concatenated values of the named fields; null when the field list or any value is not acceptable. */
  private signedText(data: GatewayResponseData, names: string[]): string | null {
    if (new Set(names).size !== names.length || names.includes('')) return null
    const decisiveAtFixedOffset = names[0] === 'responseCode' || (names[0] === 'txnCode' && names[1] === 'responseCode')
    if (!decisiveAtFixedOffset) return null

    let text = ''
    for (const name of names) {
      const value: unknown = ownValue(data, name)
      if (typeof value !== 'string' || value === '') return null
      text += value
    }
    return text
  }
}
