import { ORDER_ID_PATTERN } from '../crypt/ParamPosCrypt.js'
import {
  COMMA_AMOUNT,
  child,
  DOT_AMOUNT,
  isRecord,
  ownString,
  POS_INT,
  parseCode,
} from '../data-mapper/response/mapper/paramResponseFields.js'
import { TX_APPROVED, TX_DECLINED } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { type OrderMismatchField, PosError } from '../errors.js'
import type { PosLogger } from '../logger.js'
import type { PaymentModel, TxType } from '../PosInterface.js'
import type { PosResponse } from '../types.js'
import { phpTrim } from '../util/phpTrim.js'

/**
 * Helpers shared by the Param gateways (ParamPos and Param3DHostPos): reading a 3D callback without coercion, telling
 * its two shapes apart, deciding whether it reports an approval, pinning the signed fields of an approval, the
 * trusted result of a decline, removing the echoed merchant GUID from returned data, and the check of the bank's
 * status record that confirms every approval.
 */

/** The two signed callback shapes: the 3D Secure card check (`islemHash`) and the payment result (`TURKPOS_RETVAL_*`). */
export type CallbackShape = 'md' | 'turkpos'

/** Callback key names and values are attacker controlled; only this much of one is echoed in errors and logs. */
export const MAX_ECHOED_LENGTH = 64

/** The longest bank text kept in a decline result. */
const MAX_TEXT_LENGTH = 256

/** What replaces the merchant GUID a callback echoes. */
const REDACTED = '***'

/** The bank's transaction GUID of a 3D Secure session. */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The bank's opaque 3D value, posted back as text. */
const MD_VALUE = /^[\x21-\x7E]{1,1024}$/

/** A positive result code as the payment result callback writes it: no sign, no leading zero, no padding. */
const POSITIVE_CODE = /^[1-9]\d{0,8}$/

/** The merchant's transaction id of a payment: 24 upper-case hex digits. */
const TRANSACTION_ID = /^[0-9A-F]{24}$/

/** A 3D result as a decline reason: one digit. */
const MD_STATUS = /^\d$/

/** An installment count as the status record writes it. */
const INSTALLMENT = /^\d{1,2}$/

/** The state of a completed payment in the status record. */
const RECORD_SUCCESS = 'SUCCESS'

/** The hash field and the fields whose presence names each shape. */
const SHAPES: Readonly<Record<CallbackShape, { hash: string; markers: readonly string[] }>> = {
  md: { hash: 'islemHash', markers: ['mdStatus', 'islemHash'] },
  turkpos: { hash: 'TURKPOS_RETVAL_Hash', markers: ['TURKPOS_RETVAL_Sonuc', 'TURKPOS_RETVAL_Hash'] },
}

export type Mismatch = [field: OrderMismatchField, expected: string, actual: string]

/** What a bank status record must show for an approval to stand. */
export type RecordExpectations = {
  /** The order id the record must name (the order's, or the bank-assigned one of a hosted payment). */
  siparisId: string
  /** The receipt number the approval reported. */
  dekont: string
  /** The order amount in kuruş. */
  kurus: number
  /** The order's installment count, one counting as none (0). */
  installment: number
  /** `SALE` for a sale, `PRE_AUTH` for a pre-authorization. */
  transactionType: 'SALE' | 'PRE_AUTH'
  /** The merchant transaction id the record must hold, when the payment is bound through it. */
  islemId?: string
}

/**
 * What a status answer yields: its record (empty when there is none), whether the record shows a completed payment
 * of the order id with a receipt (evidence that money moved), the first way it fails to confirm the approval, and
 * whether the answer could not be read at all (no answer, no result, no integer result code, or a success code
 * without a record): such an answer says nothing about the payment, so the caller reports an unknown outcome.
 */
export type RecordCheck = {
  record: Record<string, unknown>
  evidence: boolean
  failure: Mismatch | null
  unreadable: boolean
}

/** The values of the order an approved result is built from. */
export type OrderValues = { orderId: string; amount: number; currency: string }

function present(data: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(data, key) && data[key] !== undefined && data[key] !== null
}

/** An own value; inherited members read as absent. */
function own(data: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(data, key) ? data[key] : undefined
}

/** An own string field; anything else (absent, inherited, another type) is undefined. */
function ownText(data: Record<string, unknown>, key: string): string | undefined {
  const value: unknown = Object.hasOwn(data, key) ? data[key] : undefined
  return typeof value === 'string' ? value : undefined
}

/** A scalar value as text for errors and logs; anything else as an empty string. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)

  return ''
}

/** Text shortened for logs and errors. */
export function echo(value: unknown): string {
  return asText(value).slice(0, MAX_ECHOED_LENGTH)
}

/**
 * A bank callback is a flat form of strings (a null or undefined value counts as absent everywhere). Another value
 * (a number, a boolean, a record, a list, a function) could be read differently by the signature check and the
 * response mapper, so it is refused before anything else.
 */
export function flatCallback(data: unknown, logger: PosLogger): Record<string, unknown> {
  if (!isRecord(data)) {
    throw new PosError('3D callback data must be a record')
  }
  // own property names include non-enumerable ones, which a spread or `Object.entries` would skip
  for (const key of Object.getOwnPropertyNames(data)) {
    const value: unknown = data[key]
    if (value !== undefined && value !== null && typeof value !== 'string') {
      const field = key.slice(0, MAX_ECHOED_LENGTH)
      logger.error('3D callback field is not a string', { field, type: typeof value })
      throw new PosError(`3D callback field "${field}" must be a string`)
    }
  }

  return data
}

/** The shape of a callback; one that shows both shapes or neither is no Param callback. */
export function callbackShape(callback: Record<string, unknown>): CallbackShape {
  const md = SHAPES.md.markers.some((key) => present(callback, key))
  const turkpos = SHAPES.turkpos.markers.some((key) => present(callback, key))
  if (md === turkpos) {
    throw new PosError('Unexpected 3D callback')
  }

  return md ? 'md' : 'turkpos'
}

/** The callback's own, non-empty signature of its shape, or undefined when it carries none. */
export function callbackHash(callback: Record<string, unknown>, shape: CallbackShape): string | undefined {
  const hash = ownText(callback, SHAPES[shape].hash)
  return hash === undefined || hash === '' ? undefined : hash
}

/** Whether a text could be read as a number above zero by a lenient reader (padding, signs, fractions, trailing text). */
function readsPositive(value: string | undefined): boolean {
  if (value === undefined) return false
  const trimmed = phpTrim(value)

  return Number.parseInt(trimmed, 10) > 0 || Number(trimmed) > 0
}

/**
 * Whether the callback reads as an approval, padding ignored (the pins then read the exact text): a 3D result `1`
 * for the card check; a result code or a receipt number above zero for the payment result.
 */
export function reportsApproval(callback: Record<string, unknown>, shape: CallbackShape): boolean {
  if (shape === 'md') {
    const mdStatus = ownText(callback, 'mdStatus')
    return mdStatus !== undefined && phpTrim(mdStatus) === '1'
  }

  return (
    readsPositive(ownText(callback, 'TURKPOS_RETVAL_Sonuc')) ||
    readsPositive(ownText(callback, 'TURKPOS_RETVAL_Dekont_ID'))
  )
}

/**
 * The signed fields of an approval that are not in their exact format (empty when all are). The signed values run
 * together without separators, so each one is pinned; declines are not checked (they grant nothing, and the bank's
 * texts are free form).
 */
export function approvalFieldsMalformed(callback: Record<string, unknown>, shape: CallbackShape): string[] {
  const malformed: string[] = []
  const check = (key: string, ok: (value: string | undefined) => boolean): void => {
    if (!ok(ownText(callback, key))) malformed.push(key)
  }
  const matches = (pattern: RegExp) => (value: string | undefined) => value !== undefined && pattern.test(value)

  if (shape === 'md') {
    check('mdStatus', (value) => value === '1')
    check('islemGUID', matches(GUID))
    check('md', matches(MD_VALUE))
    check('orderId', matches(ORDER_ID_PATTERN))
    check('transactionAmount', (value) => !present(callback, 'transactionAmount') || matches(COMMA_AMOUNT)(value))

    return malformed
  }

  check('TURKPOS_RETVAL_Sonuc', matches(POSITIVE_CODE))
  check('TURKPOS_RETVAL_Dekont_ID', matches(POS_INT))
  check('TURKPOS_RETVAL_Tahsilat_Tutari', matches(COMMA_AMOUNT))
  check('TURKPOS_RETVAL_Siparis_ID', matches(ORDER_ID_PATTERN))
  check('TURKPOS_RETVAL_Islem_ID', matches(TRANSACTION_ID))

  return malformed
}

/** The payment result's own result code as canonical integer text; the card check carries none. */
export function callbackCode(callback: Record<string, unknown>, shape: CallbackShape): string | null {
  if (shape === 'md') return null
  const code = parseCode(ownText(callback, 'TURKPOS_RETVAL_Sonuc'))

  return code === null ? null : String(code)
}

/** A copy of the data without the merchant GUID the bank echoes; anything else is returned as it is. */
export function withoutEchoedGuid<T>(data: T): T {
  if (!isRecord(data) || !Object.hasOwn(data, 'TURKPOS_RETVAL_GUID')) return data

  return { ...data, TURKPOS_RETVAL_GUID: REDACTED } as T
}

/**
 * An exact amount in kuruş from the bank's text: `10,01` for the callbacks (`comma`), `10.01` (up to four decimals)
 * for the status record (`dot`). A non-zero third or fourth decimal, another separator or any other kind is null.
 */
export function amountKurus(value: unknown, kind: 'comma' | 'dot'): number | null {
  if (typeof value !== 'string' || !(kind === 'comma' ? COMMA_AMOUNT : DOT_AMOUNT).test(value)) return null
  const [whole = '', fraction = ''] = value.split(kind === 'comma' ? ',' : '.')
  const digits = fraction.padEnd(4, '0')
  if (digits.slice(2) !== '00') return null

  return Number(whole) * 100 + Number(digits.slice(0, 2))
}

/**
 * The result of a declined callback, built from trusted data only. A Param signature can be produced by anyone who
 * has seen one callback of the merchant, so no callback id, amount or reference is echoed as fact: every mapped
 * value becomes null, the order id is the order's, the transaction type and payment model are the call's. The bank's
 * result code (an integer) and its text (at most 256 characters) stay as decline reasons, so does the 3D result of a
 * card check (one digit). The raw callback stays in `all` (and `3d_all` for the card check) without the echoed GUID.
 * Never flagged for manual review.
 */
export function trustedDecline(
  mapped: PosResponse,
  callback: Record<string, unknown>,
  shape: CallbackShape,
  orderId: string,
  txType: TxType,
  paymentModel: PaymentModel,
): PosResponse {
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(mapped)) {
    if (key !== 'requires_manual_review') result[key] = null
  }
  const code = callbackCode(callback, shape)
  const text = shape === 'turkpos' ? ownText(callback, 'TURKPOS_RETVAL_Sonuc_Str') : undefined
  const mdStatus = shape === 'md' ? ownText(callback, 'mdStatus') : undefined
  const raw = withoutEchoedGuid(callback)

  return {
    ...result,
    status: TX_DECLINED,
    order_id: orderId,
    transaction_type: txType,
    payment_model: paymentModel,
    proc_return_code: code,
    error_code: code,
    error_message: text === undefined || text === '' ? null : text.slice(0, MAX_TEXT_LENGTH),
    md_status: mdStatus !== undefined && MD_STATUS.test(mdStatus) ? mdStatus : null,
    all: raw,
    ...(shape === 'md' ? { '3d_all': raw } : {}),
  }
}

/**
 * Checks the bank's status answer for one order against an approval. Only the raw answer is read (own values, exact
 * text), never mapped display values. The answer must hold one record (a list cannot be attributed); the record
 * must name the order id, show a successful payment, carry the reported receipt, be of the transaction type, hold
 * the order amount in exact kuruş, nothing refunded and the order's installment count. The record carries no
 * currency. A failure code or a list of records is a failed confirmation; an answer that cannot be read is
 * `unreadable`. Evidence that money moved is a record of a successful payment of this order id with a receipt number.
 */
export function paramRecordConfirms(answer: unknown, expected: RecordExpectations): RecordCheck {
  const result = child(child(answer, 'TP_Islem_Sorgulama4Response'), 'TP_Islem_Sorgulama4Result')
  const rawRecord: unknown = result !== null && Object.hasOwn(result, 'DT_Bilgi') ? result.DT_Bilgi : undefined
  const code = result === null ? null : parseCode(own(result, 'Sonuc'))
  if (code === null || (code > 0 && !isRecord(rawRecord) && !Array.isArray(rawRecord))) {
    return { record: {}, evidence: false, failure: null, unreadable: true }
  }
  // A failure code is the bank's own word that it holds no such payment; a list cannot be attributed to one payment.
  if (code <= 0 || !isRecord(rawRecord)) {
    const actual = code > 0 ? 'list' : 'none'
    return { record: {}, evidence: false, failure: ['order_status', 'one status record', actual], unreadable: false }
  }

  const record = rawRecord
  const text = (key: string): string => ownString(record, key) ?? ''
  const siparisId = text('Siparis_ID')
  const state = text('Durum')
  const paymentCode = parseCode(own(record, 'Odeme_Sonuc'))
  const dekont = text('Dekont_ID')
  const evidence =
    state === RECORD_SUCCESS &&
    paymentCode !== null &&
    paymentCode > 0 &&
    siparisId === expected.siparisId &&
    POS_INT.test(dekont)
  const closed = (failure: Mismatch): RecordCheck => ({ record, evidence, failure, unreadable: false })

  if (siparisId !== expected.siparisId) {
    return closed(['order_id', expected.siparisId, siparisId])
  }
  if (expected.islemId !== undefined && text('Islem_ID') !== expected.islemId) {
    return closed(['order_id', expected.islemId, text('Islem_ID')])
  }
  if (state !== RECORD_SUCCESS) {
    return closed(['order_status', RECORD_SUCCESS, state])
  }
  if (paymentCode === null || paymentCode <= 0) {
    return closed(['order_status', RECORD_SUCCESS, `${state} ${asText(own(record, 'Odeme_Sonuc'))}`])
  }
  if (dekont !== expected.dekont) {
    return closed(['transaction_id', expected.dekont, dekont])
  }
  if (text('Islem_Tip') !== expected.transactionType) {
    return closed(['transaction_type', expected.transactionType, text('Islem_Tip')])
  }
  if (amountKurus(own(record, 'Toplam_Tutar'), 'dot') !== expected.kurus) {
    return closed(['amount', String(expected.kurus), text('Toplam_Tutar')])
  }
  if (amountKurus(own(record, 'Toplam_Iade_Tutar'), 'dot') !== 0) {
    return closed(['order_status', '0', text('Toplam_Iade_Tutar')])
  }
  const installment = recordInstallment(record)
  if (installment === null || installment !== expected.installment) {
    return closed(['installment', String(expected.installment), text('Taksit')])
  }

  return { record, evidence, failure: null, unreadable: false }
}

/** The installment count of a status record, one counting as none (0); null when it cannot be read. */
function recordInstallment(record: Record<string, unknown>): number | null {
  const taksit = ownText(record, 'Taksit')
  if (taksit === undefined || !INSTALLMENT.test(taksit)) return null
  const count = Number(taksit)

  return count <= 1 ? 0 : count
}

/**
 * The result of an approval the bank's record confirmed (also attached, flagged, to a confirmation that failed): every
 * mapped value is dropped, the order id, amount and currency are the order's, the transaction type and payment model
 * the call's, the result code the one of the bank answer that approved, and the bank references (authorization
 * code, host reference, transaction id, card mask, installment count, time) come from the status record.
 */
export function confirmedResult(
  mapped: PosResponse,
  values: {
    order: OrderValues
    paymentModel: PaymentModel
    txType: TxType
    code: string | null
    mdStatus: string | null
    record: Record<string, unknown>
    transactionTime: Date | null
    all: unknown
    threeDAll: unknown
  },
): PosResponse {
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(mapped)) {
    if (key !== 'requires_manual_review') result[key] = null
  }
  const { record } = values

  return {
    ...result,
    status: TX_APPROVED,
    order_id: values.order.orderId,
    amount: values.order.amount,
    currency: values.order.currency,
    auth_code: ownString(record, 'Bank_AuthCode'),
    ref_ret_num: ownString(record, 'Bank_HostRefNum'),
    transaction_id: ownString(record, 'Bank_Trans_ID'),
    masked_number: ownString(record, 'KK_No'),
    installment_count: recordInstallment(record),
    transaction_time: values.transactionTime,
    proc_return_code: values.code,
    error_code: null,
    error_message: null,
    md_status: values.mdStatus,
    payment_model: values.paymentModel,
    transaction_type: values.txType,
    all: withoutEchoedGuid(values.all),
    ...(values.threeDAll === null ? {} : { '3d_all': withoutEchoedGuid(values.threeDAll) }),
  }
}
