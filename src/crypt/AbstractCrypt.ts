import { createHash } from 'node:crypto'
import { createSafeLogger, noopLogger, type PosLogger } from '../logger.js'
import type { AbstractPosAccount } from '../model/account/AbstractPosAccount.js'
import type { GatewayResponseData } from '../types.js'
import { randomHexString } from '../util/random.js'
import type { CryptInterface } from './CryptInterface.js'

type Container = Record<string, unknown> | unknown[]

function isContainer(value: unknown): value is Container {
  if (Array.isArray(value)) return true
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** PHP `(string)` cast for the scalar values found in request data. */
function phpString(value: unknown): string {
  if (value === null || value === undefined || value === false) return ''
  if (value === true) return '1'
  if (isContainer(value)) return 'Array'
  return String(value)
}

export abstract class AbstractCrypt<A extends AbstractPosAccount = AbstractPosAccount> implements CryptInterface<A> {
  /** Node `crypto.createHash` algorithm. */
  protected readonly hashAlgorithm: string = 'sha1'

  /** Separator between hashed fields. */
  protected readonly hashSeparator: string = ''

  protected readonly logger: PosLogger

  constructor(logger: PosLogger = noopLogger) {
    this.logger = createSafeLogger(logger)
  }

  abstract check3DHash(account: A, data: GatewayResponseData): boolean

  abstract create3DHash(account: A, formInputs: Record<string, string>): string

  abstract createHash(account: A, requestData: Record<string, unknown>): string

  generateRandomString(length = 24): string {
    return randomHexString(length)
  }

  hashFromParams(account: A, data: Record<string, unknown>, hashParamsValue: string, paramSeparator = ':'): string {
    if (hashParamsValue === '') {
      throw new Error('hashParamsValue cannot be empty')
    }

    const secretKey = account.getSecretKey()
    const hashParams = hashParamsValue.split(paramSeparator)
    const hashVal = this.buildHashString(data, hashParams, '', secretKey)

    return this.hashString(hashVal, secretKey)
  }

  hashString(str: string, _encryptionKey: string | null = null): string {
    return createHash(this.hashAlgorithm).update(str, 'utf8').digest('base64')
  }

  protected concatenateHashKey(hashKey: string, hashString: string): string {
    return hashString + hashKey
  }

  /**
   * @param data       data from which the hash string will be built
   * @param paramNames parameter names used in hash calculation
   * @param separator  separator between the parameter values
   * @param secretKey  attached to the hash string when provided
   */
  protected buildHashString(
    data: Record<string, unknown>,
    paramNames: string[],
    separator = '',
    secretKey: string | null = null,
  ): string {
    const paramsVal = this.buildHashData(data, paramNames).join(separator)

    if (secretKey !== null) {
      return this.concatenateHashKey(secretKey, paramsVal)
    }

    return paramsVal
  }

  protected buildHashData(data: Record<string, unknown>, paramNames: string[]): string[] {
    return paramNames.map((name) => this.recursiveFind(data, name))
  }

  /**
   * Depth-first pre-order search (PHP RecursiveIteratorIterator::SELF_FIRST) for the first own key equal to `needle`.
   * Array indexes never match (they are integers in PHP). Returns '' when not found.
   */
  private recursiveFind(haystack: Container, needle: string): string {
    return this.findIn(haystack, needle) ?? ''
  }

  private findIn(haystack: Container, needle: string): string | undefined {
    const isList = Array.isArray(haystack)
    for (const [key, value] of Object.entries(haystack)) {
      if (!isList && key === needle) return phpString(value)
      if (isContainer(value)) {
        const found = this.findIn(value, needle)
        if (found !== undefined) return found
      }
    }
    return undefined
  }
}
