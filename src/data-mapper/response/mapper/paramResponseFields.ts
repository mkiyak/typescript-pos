import { phpTrim } from '../../../util/phpTrim.js'
import { child, isRecord, type Raw } from './boaResponseFields.js'
import { ownScalar, ownString } from './toslaResponseFields.js'

export { child, isRecord, ownScalar, ownString, type Raw }

/** A result code: an optional minus sign and up to nine digits. */
export const CODE = /^-?\d{1,9}$/

/** A positive identifier (receipt, transaction): no sign, no leading zero, no padding. */
export const POS_INT = /^[1-9]\d{0,19}$/

/** An amount as the callbacks print it (`10,01`) and as status records print it (`10.01`). */
export const COMMA_AMOUNT = /^\d{1,13},\d{2}$/
export const DOT_AMOUNT = /^\d{1,13}(?:\.\d{1,4})?$/

/**
 * A result code read exactly as sent: the number or the text of an integer of at most nine digits. Padded text
 * (`' 1'`), fractions (`'1.0'`), exponents, booleans, lists and records read as null, so they never count as a
 * success code.
 */
export function parseCode(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || !CODE.test(String(value))) return null

    return value === 0 ? 0 : value
  }
  if (typeof value === 'string' && CODE.test(value)) {
    const code = Number(value)

    return code === 0 ? 0 : code
  }

  return null
}

/** The own result code of a record under the first key that is set; the code is null when it cannot be read. */
export function ownCode(data: unknown, ...keys: string[]): number | null {
  if (!isRecord(data)) return null
  for (const key of keys) {
    if (Object.hasOwn(data, key) && data[key] !== null && data[key] !== undefined) {
      return parseCode(data[key])
    }
  }

  return null
}

/** True for a positive integer given as a number or as exact text (a receipt or transaction number). */
export function isPositiveId(value: unknown): boolean {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0

  return typeof value === 'string' && POS_INT.test(value)
}

/** The own value of a record under `key` when it is a positive identifier. */
export function ownPositiveId(data: unknown, key: string): boolean {
  return isRecord(data) && Object.hasOwn(data, key) && isPositiveId(data[key])
}

/**
 * An own text or number field for display, as text without surrounding blanks; blank text and every other kind
 * (lists, records, booleans, inherited members) read as null and never become "[object Object]".
 */
export function ownDisplay(data: unknown, key: string): string | null {
  const value = ownScalar(data, key)
  if (value === null) return null
  const text = phpTrim(String(value))

  return text === '' ? null : text
}
