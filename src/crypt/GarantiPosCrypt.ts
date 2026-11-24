import { createHash } from 'node:crypto'
import { MissingAccountInfoError, PosError } from '../errors.js'
import type { GarantiPosAccount } from '../model/account/GarantiPosAccount.js'
import type { GatewayResponseData } from '../types.js'
import { timingSafeEqualStr } from '../util/timingSafeEqualStr.js'
import { AbstractCrypt } from './AbstractCrypt.js'

/** Callback fields that decide the payment outcome; a signature that does not cover all of them is not trusted. */
const REQUIRED_HASH_PARAMS = ['oid', 'procreturncode', 'response', 'mdstatus'] as const

/** A missing or null part of the hash input counts as an empty string, never as the text "undefined". */
function part(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function sha(algorithm: 'sha1' | 'sha512', value: string): string {
  return createHash(algorithm).update(value, 'utf8').digest('hex').toUpperCase()
}

/** Garanti (GVP) request signature and 3D callback verification. All digests are upper-case hex. */
export class GarantiPosCrypt extends AbstractCrypt<GarantiPosAccount> {
  protected override readonly hashAlgorithm = 'sha512'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'GarantiPos'
  }

  /** The 3D form fields are signed together with the store key and the security data. */
  create3DHash(account: GarantiPosAccount, formInputs: Record<string, string>): string {
    const terminalId = this.requireTerminalId(formInputs.terminalid)

    const parts = [
      terminalId,
      formInputs.orderid,
      formInputs.txnamount,
      formInputs.txncurrencycode,
      formInputs.successurl,
      formInputs.errorurl,
      formInputs.txntype,
      formInputs.txninstallmentcount,
      account.getSecretKey(),
      this.securityData(account, terminalId, formInputs.txntype),
    ]

    return this.hashString(parts.map(part).join(this.hashSeparator))
  }

  /**
   * The signature of a callback is `hash` over the values named in `hashparams` plus the store key. A callback is
   * rejected when either is missing or when `hashparams` does not cover the fields that decide the outcome.
   * The generated hash is deliberately not logged: for the logged data it would be a valid forged callback hash.
   */
  check3DHash(account: GarantiPosAccount, data: GatewayResponseData): boolean {
    const { hash, hashparams } = data
    if (typeof hash !== 'string' || hash === '' || typeof hashparams !== 'string' || hashparams === '') {
      this.logger.error('hash check failed', { data, expected_hash: hash })
      return false
    }

    const names = hashparams.split(':')
    const coversOutcome = REQUIRED_HASH_PARAMS.every((name) => names.includes(name))
    const actualHash = coversOutcome ? this.hashFromParams(account, data, hashparams, ':') : ''

    if (coversOutcome && timingSafeEqualStr(hash.toUpperCase(), actualHash)) {
      this.logger.debug('hash check is successful')
      return true
    }

    this.logger.error('hash check failed', { data, expected_hash: hash })
    return false
  }

  createHash(account: GarantiPosAccount, requestData: Record<string, unknown>): string {
    const order = this.section(requestData, 'Order')
    const terminal = this.section(requestData, 'Terminal')
    const card = this.section(requestData, 'Card')
    const transaction = this.section(requestData, 'Transaction')
    const terminalId = this.requireTerminalId(terminal.ID)

    const parts = [
      order.OrderID,
      terminalId,
      card.Number,
      transaction.Amount,
      transaction.CurrencyCode,
      this.securityData(account, terminalId, transaction.Type),
    ]

    return this.hashString(parts.map(part).join(this.hashSeparator))
  }

  override hashString(str: string, _encryptionKey: string | null = null): string {
    return sha('sha512', str)
  }

  /** Cancel and refund are signed with the refund password, every other transaction with the provision password. */
  private securityData(account: GarantiPosAccount, terminalId: string, txType: unknown): string {
    let password: string | null = account.getPassword()
    if (txType === 'void' || txType === 'refund') {
      password = account.getRefundPassword()
      if (password === null) {
        throw new MissingAccountInfoError('Refund password is required for cancel and refund requests.')
      }
    }

    return sha('sha1', password + terminalId.padStart(9, '0'))
  }

  private requireTerminalId(value: unknown): string {
    if (value === null || value === undefined || value === '') {
      throw new PosError('Terminal id is required to sign the request.')
    }
    return String(value)
  }

  private section(requestData: Record<string, unknown>, name: string): Record<string, unknown> {
    const value = requestData[name]
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  }
}
