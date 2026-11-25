import { createHash, createHmac, pbkdf2Sync } from 'node:crypto'
import { NotImplementedError, PosError } from '../errors.js'
import type { ParamPosAccount } from '../model/account/ParamPosAccount.js'
import { encodeIso88599, isIso88599Representable } from '../serializer/iso88599.js'
import type { GatewayResponseData } from '../types.js'
import { ownValue } from '../util/ownValue.js'
import { timingSafeEqualStr } from '../util/timingSafeEqualStr.js'
import { AbstractCrypt } from './AbstractCrypt.js'

const LOG_VALUE_LIMIT = 64

/** A base64 SHA-1 digest: 20 bytes, 27 characters and one padding character. */
const HASH_PATTERN = /^[A-Za-z0-9+/]{27}=$/
export const ORDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const CURRENCY_CODE = /^\d{4}$/

/**
 * The transaction id of a hosted payment is shown to the payer, so it must not let anyone test password guesses
 * offline: the HMAC key is stretched from the API password first (PBKDF2, a fixed label and the account's
 * identifiers as salt), once per account object.
 */
const HOST_ID_SALT_LABEL = 'typescript-pos/param/3d-host-id'
const HOST_ID_ITERATIONS = 200_000
const HOST_ID_KEY_BYTES = 32
const hostIdKeys = new WeakMap<object, Buffer>()

/** The request bodies the bank signs, and the fields each signature covers (after the client code and the GUID). */
const REQUEST_FIELDS: Readonly<Record<string, readonly string[]>> = {
  TP_WMD_UCD: ['Taksit', 'Islem_Tutar', 'Toplam_Tutar', 'Siparis_ID'],
  Pos_Odeme: ['Taksit', 'Islem_Tutar', 'Toplam_Tutar', 'Siparis_ID', 'Hata_URL', 'Basarili_URL'],
  TP_Islem_Odeme_WD: ['Islem_Tutar', 'Toplam_Tutar', 'Siparis_ID', 'Hata_URL', 'Basarili_URL'],
  TP_Islem_Odeme_OnProv_WMD: ['Islem_Tutar', 'Toplam_Tutar', 'Siparis_ID', 'Hata_URL', 'Basarili_URL'],
}

/** The signed values of a 3D Secure callback, in signing order; the account's GUID follows them. */
const MD_FIELDS = ['islemGUID', 'md', 'mdStatus', 'orderId'] as const

/** The signed values of a 3D Pay / 3D Host callback, in signing order; the client code and the GUID come first. */
const TURKPOS_FIELDS = [
  'TURKPOS_RETVAL_Dekont_ID',
  'TURKPOS_RETVAL_Tahsilat_Tutari',
  'TURKPOS_RETVAL_Siparis_ID',
  'TURKPOS_RETVAL_Islem_ID',
] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** A non-empty own string of the record, or a `PosError` naming the field (never `undefined` in a signature). */
function requiredString(record: Record<string, unknown>, name: string): string {
  const value: unknown = ownValue(record, name)
  if (typeof value !== 'string' || value === '') {
    throw new PosError(`Param request field "${name}" is missing`)
  }
  return value
}

/**
 * Param: base64 SHA-1 signatures.
 *
 * The request signature covers the client code, the merchant key (GUID), the amounts, the order id and, for the
 * 3D Pay, foreign currency and pre-authorization bodies, the two return URLs; the values are joined without
 * separators and signed as ISO-8859-9 bytes. The GUID is read from the request itself, so a hook that edits a
 * signed field makes the request fail instead of being signed again.
 *
 * Two callback shapes are signed. The 3D Secure card-check callback (`islemHash`) covers the transaction GUID, the
 * `md` value, the 3D status and the order id, followed by the account's GUID. The 3D Pay / 3D Host callback
 * (`TURKPOS_RETVAL_Hash`) covers the client code, the GUID, the receipt number, the collected amount, the order id
 * and the transaction id. That callback carries the merchant GUID it is signed with, so a valid signature only
 * proves that the sender has seen one callback of this merchant: the gateways never treat it as proof of payment,
 * and the GUID inside the callback is never read (the account's own GUID is used).
 */
export class ParamPosCrypt extends AbstractCrypt<ParamPosAccount> {
  protected override readonly hashAlgorithm = 'sha1'

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'ParamPos' || gatewayClass === 'Param3DHostPos'
  }

  create3DHash(_account: ParamPosAccount, _formInputs: Record<string, string>): string {
    throw new NotImplementedError('Param 3D forms are built by the bank; there is no form hash.')
  }

  /**
   * Checks the signature of a 3D callback. Only own top-level string fields are signed (an absent or null one counts
   * as empty; any other type makes the check fail instead of being converted to text), the signature must be an
   * own 28-character base64 string, and the comparison is constant time. The data and the generated hash are
   * deliberately not logged: a failure logs the order id only. Never throws for callback input.
   */
  check3DHash(account: ParamPosAccount, data: GatewayResponseData): boolean {
    const signed = isRecord(data) ? this.signedString(account, data) : null
    if (signed !== null) {
      const received: unknown = ownValue(data, signed.hashField)
      if (
        typeof received === 'string' &&
        HASH_PATTERN.test(received) &&
        timingSafeEqualStr(received, this.hashString(signed.text))
      ) {
        this.logger.debug('hash check is successful', { order_id: this.orderIdForLog(data) })
        return true
      }
    }

    this.logger.error('hash check failed', { order_id: this.orderIdForLog(data) })
    return false
  }

  /** Request signature, see the class description. */
  createHash(_account: ParamPosAccount, requestData: Record<string, unknown>): string {
    const names = Object.keys(REQUEST_FIELDS).filter((name) => Object.hasOwn(requestData, name))
    const bodyName = names.length === 1 ? names[0] : undefined
    const body: unknown = bodyName === undefined ? undefined : ownValue(requestData, bodyName)
    if (bodyName === undefined || !isRecord(body)) {
      throw new PosError('Param request hash: unknown request')
    }

    const client: unknown = ownValue(body, 'G')
    if (!isRecord(client)) {
      throw new PosError('Param request field "G" is missing')
    }
    const parts = [
      requiredString(client, 'CLIENT_CODE'),
      requiredString(body, 'GUID'),
      ...(REQUEST_FIELDS[bodyName] as readonly string[]).map((name) => requiredString(body, name)),
    ]
    const text = parts.join(this.hashSeparator)
    if (!isIso88599Representable(text)) {
      throw new PosError('Param request contains a character the bank cannot read (ISO-8859-9)')
    }

    // Plain ASCII is the same in UTF-8 and ISO-8859-9; only other letters need the single-byte form.
    return Buffer.byteLength(text, 'utf8') === text.length
      ? this.hashString(text)
      : createHash(this.hashAlgorithm).update(encodeIso88599(text)).digest('base64')
  }

  /**
   * The transaction id of a hosted payment: the first 24 hex digits, upper-cased, of an HMAC-SHA-256 over the client
   * code, the order id, the amount in kuruş and the currency code. The key is derived from the API password (PBKDF2,
   * see `hostIdKey`), so the id the payer sees reveals nothing cheap to attack. The hosted request carries no order
   * id, so this id is the only server-chosen link between the payment and the order that the bank keeps; it can be
   * recomputed later without any stored state. A weak API password still weakens it: use a strong one.
   */
  create3DHostTransactionId(account: ParamPosAccount, orderId: string, kurus: number, currencyCode: string): string {
    if (typeof orderId !== 'string' || !ORDER_ID_PATTERN.test(orderId)) {
      throw new PosError('Param transaction id: the order id is not valid')
    }
    if (typeof kurus !== 'number' || !Number.isSafeInteger(kurus) || kurus <= 0) {
      throw new PosError('Param transaction id: the amount is not valid')
    }
    if (typeof currencyCode !== 'string' || !CURRENCY_CODE.test(currencyCode)) {
      throw new PosError('Param transaction id: the currency code is not valid')
    }

    return createHmac('sha256', this.hostIdKey(account))
      .update(`${account.getMerchantId()}|${orderId}|${kurus}|${currencyCode}`, 'utf8')
      .digest('hex')
      .slice(0, 24)
      .toUpperCase()
  }

  /** The stretched key of an account, computed once per account object. */
  private hostIdKey(account: ParamPosAccount): Buffer {
    let key = hostIdKeys.get(account)
    if (key === undefined) {
      const salt = [HOST_ID_SALT_LABEL, account.getMerchantId(), account.getUsername(), account.getSecretKey()].join(
        '|',
      )
      key = pbkdf2Sync(account.getPassword(), salt, HOST_ID_ITERATIONS, HOST_ID_KEY_BYTES, 'sha256')
      hostIdKeys.set(account, key)
    }
    return key
  }

  /** The text a callback signature covers and the field that carries it; null when a signed value is not a string. */
  private signedString(
    account: ParamPosAccount,
    data: Record<string, unknown>,
  ): { hashField: string; text: string } | null {
    const turkpos =
      ownValue(data, 'TURKPOS_RETVAL_Hash') !== undefined && ownValue(data, 'TURKPOS_RETVAL_Hash') !== null
    const fields: readonly string[] = turkpos ? TURKPOS_FIELDS : MD_FIELDS
    const values: string[] = []
    for (const name of fields) {
      const value: unknown = ownValue(data, name)
      if (value === undefined || value === null) {
        values.push('')
      } else if (typeof value === 'string') {
        values.push(value)
      } else {
        return null
      }
    }

    if (turkpos) {
      const [dekont, tutar, orderId, islemId] = values
      return {
        hashField: 'TURKPOS_RETVAL_Hash',
        text: `${account.getMerchantId()}${account.getSecretKey()}${dekont}${tutar}${orderId}${islemId}`,
      }
    }

    return { hashField: 'islemHash', text: values.join('') + account.getSecretKey() }
  }

  private orderIdForLog(data: unknown): string | undefined {
    if (!isRecord(data)) return undefined
    for (const name of ['orderId', 'TURKPOS_RETVAL_Siparis_ID']) {
      const orderId: unknown = ownValue(data, name)
      if (typeof orderId === 'string') return orderId.slice(0, LOG_VALUE_LIMIT)
    }
    return undefined
  }
}
