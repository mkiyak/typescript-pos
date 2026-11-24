import { TX_DECLINED } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { type OrderMismatchField, PosError } from '../errors.js'
import type { PaymentModel, TxType } from '../PosInterface.js'
import type { PosOrder, PosResponse } from '../types.js'

/**
 * Helpers shared by the gateways of the BOA platform (Kuveyt Turk, Vakıf Katılım): reading callback and bank
 * values without coercion, the trusted result of an unsigned decline, removing the echoed hashed password from raw
 * data, and the checks of a provision answer.
 */

/** The response code of an authenticated card and of an approved payment. */
export const SUCCESS_CODE = '00'

/** Order ids are plain ASCII so that the signed bytes are unambiguous. */
const ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/

/** The bank's own order id: a positive whole number without leading zeros. */
export const BANK_ORDER_ID = /^[1-9]\d{0,18}$/

/** The 3D session value the provision request carries: base64 text. */
export const MD = /^[A-Za-z0-9+/=]{1,1024}$/

/** An amount in kuruş as the bank writes it. */
const KURUS = /^(?:0|[1-9]\d{0,14})$/

/** A numeric currency code, with or without the leading zero. */
const CURRENCY_CODE = /^\d{1,4}$/

/** An installment count as the bank writes it. */
export const INSTALLMENT_TEXT = /^\d{1,2}$/

/** Callback values are attacker controlled; only this much of one is echoed in errors and logs. */
export const MAX_ECHOED_LENGTH = 64

/** Informational decline fields an unsigned declined callback may keep, as bounded plain text. */
const DECLINE_REASON_FIELDS = ['proc_return_code', 'error_code', 'error_message', 'md_error_message'] as const

/** The longest decline reason kept from an unsigned callback. */
const MAX_DECLINE_REASON_LENGTH = 256

/** Keys of a mapped result that an unsigned callback keeps as they are (the decision and the raw data). */
const KEPT_UNSIGNED_KEYS = new Set(['status', 'all', '3d_all'])

/** Raw bank data keys whose `HashPassword` echoes are replaced before a result is returned. */
const RAW_DATA_KEYS = ['all', '3d_all'] as const

const REDACTED = '***'

/** Deeper raw data than the decoders accept is not walked. */
const MAX_RAW_DEPTH = 64

/** A field that does not match, with the expected and the actual value (as text). */
export type Mismatch = [field: OrderMismatchField, expected: string, actual: string]

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** An own value; `null` counts as absent like a missing key. */
export function own(data: Record<string, unknown>, key: string): unknown {
  const value: unknown = Object.hasOwn(data, key) ? data[key] : undefined
  return value === null ? undefined : value
}

/** An own value when it is a string, otherwise undefined. */
export function ownText(data: Record<string, unknown>, key: string): string | undefined {
  const value = own(data, key)
  return typeof value === 'string' ? value : undefined
}

/** An element the bank marks as having no value (`xsi:nil="true"` and no text). */
export function isNil(value: unknown): boolean {
  if (!isRecord(value) || value['@xsi:nil'] !== 'true') return false
  return Object.keys(value).every((key) => key === '@xsi:nil' || (key === '#' && value[key] === ''))
}

/**
 * A bank or callback value read for a comparison: `undefined` when it is absent (missing, null or a nil element),
 * the text when it is a string, and `null` for anything else (a list from a repeated element, a record from an
 * element with attributes or children, a number), which never equals the order's value.
 */
export function textOf(data: Record<string, unknown> | null, key: string): string | null | undefined {
  if (data === null) return undefined
  const value = own(data, key)
  if (value === undefined || isNil(value)) return undefined
  return typeof value === 'string' ? value : null
}

/** A scalar value as text; anything else as an empty string. */
export function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/** A callback value shortened for logs and errors. */
export function echo(value: unknown): string {
  return asText(value).slice(0, MAX_ECHOED_LENGTH)
}

/** The order id every binding compares with: letters, digits, `_` and `-`, at most 64 characters. */
export function boaOrderId(order: PosOrder): string {
  const id: unknown = order.id
  const text = typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id)) ? String(id) : ''
  if (!ORDER_ID.test(text)) {
    throw new PosError('The order id may only hold letters, digits, underscores and hyphens (at most 64).')
  }

  return text
}

/** A numeric currency code, the leading zero optional, equal to the expected four-digit code. */
export function isCurrencyCode(text: string, expected: string): boolean {
  return CURRENCY_CODE.test(text) && text.padStart(4, '0') === expected
}

/** One installment is a single payment, like none. */
export function normalizedInstallment(count: number): number {
  return count > 1 ? count : 0
}

/** A copy of raw bank data with every echoed `HashPassword` value replaced. */
function withoutHashPassword(value: unknown, depth = 0): unknown {
  if (depth > MAX_RAW_DEPTH) return REDACTED
  if (Array.isArray(value)) return value.map((item) => withoutHashPassword(item, depth + 1))
  if (!isRecord(value)) return value

  const copy: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    const item = value[key]
    copy[key] =
      key.toLowerCase() === 'hashpassword' && item !== '' && item !== null && item !== undefined
        ? REDACTED
        : withoutHashPassword(item, depth + 1)
  }
  return copy
}

/**
 * The response with the hashed password the bank echoes replaced in its raw data: it is the signing secret of the
 * merchant, and merchants keep responses.
 */
export function redactHashPassword(response: PosResponse): PosResponse {
  let result = response
  for (const key of RAW_DATA_KEYS) {
    if (Object.hasOwn(response, key) && response[key] !== null && typeof response[key] === 'object') {
      result = { ...result, [key]: withoutHashPassword(response[key]) }
    }
  }

  return result
}

/**
 * The result of an unsigned declined callback, built from trusted data only: every value the callback could have
 * chosen is dropped (null) and replaced by the order's id and the call's transaction type and payment model. Its
 * decline reasons grant nothing and a merchant needs them for a genuine decline, so they stay as informational
 * plain text of bounded length (anything but a string becomes null). The raw data is kept, without the echoed
 * hashed password.
 */
export function unsignedDeclineResult(
  response: PosResponse,
  orderId: string,
  txType: TxType,
  paymentModel: PaymentModel,
): PosResponse {
  const result: PosResponse = { ...response }
  delete result.requires_manual_review
  for (const key of Object.keys(result)) {
    if (!KEPT_UNSIGNED_KEYS.has(key)) result[key] = null
  }
  for (const key of DECLINE_REASON_FIELDS) {
    if (!Object.hasOwn(response, key)) continue
    const reason: unknown = response[key]
    result[key] = typeof reason === 'string' ? reason.slice(0, MAX_DECLINE_REASON_LENGTH) : null
  }

  return redactHashPassword({
    ...result,
    status: TX_DECLINED,
    order_id: orderId,
    transaction_type: txType,
    payment_model: paymentModel,
  })
}

/**
 * Whether the answer to a request that can move money has a response code that is not one plain value (a repeated
 * element, or one with children or attributes): it may hide a booking, so it is never read as a decline. An answer
 * without any response code never gets here: the HTTP client refuses it as an unknown outcome.
 */
export function hasAmbiguousResponseCode(answer: Record<string, unknown>): boolean {
  const code = own(answer, 'ResponseCode')

  return code !== undefined && !isNil(code) && typeof code !== 'string'
}

/**
 * The first way in which a booked provision answer (response code `00`) does not belong to the order, or null: it
 * must name the order id (top level and, when present, inside its message), the order's amount in kuruş and the
 * order's currency. `currencyKeys` are the message fields that carry a currency; with `currencyRequired` the first
 * of them must be present.
 */
export function provisionMismatch(
  provision: Record<string, unknown>,
  orderId: string,
  expectedKurus: string,
  expectedCurrency: string,
  currencyKeys: readonly string[],
  currencyRequired: boolean,
): Mismatch | null {
  const bookedOrderId = textOf(provision, 'MerchantOrderId')
  if (bookedOrderId !== orderId) {
    return ['order_id', orderId, bookedOrderId ?? '']
  }

  const value = own(provision, 'VPosMessage')
  const message = isRecord(value) ? value : null
  const amount = textOf(message, 'Amount')
  if (typeof amount !== 'string' || !KURUS.test(amount) || amount !== expectedKurus) {
    return ['amount', expectedKurus, amount ?? '']
  }

  const messageOrderId = textOf(message, 'MerchantOrderId')
  if (messageOrderId !== undefined && messageOrderId !== orderId) {
    return ['order_id', orderId, messageOrderId ?? '']
  }

  for (const [index, key] of currencyKeys.entries()) {
    const currency = textOf(message, key)
    if (currency === undefined && !(currencyRequired && index === 0)) continue
    if (typeof currency !== 'string' || !isCurrencyCode(currency, expectedCurrency)) {
      return ['currency', expectedCurrency, currency ?? '']
    }
  }

  return null
}
