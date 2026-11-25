import { phpTrim } from '../../../util/phpTrim.js'
import { isRecord, type Raw } from './boaResponseFields.js'

export { isRecord, type Raw }

/**
 * A kuruş amount or count as the bank sends it: a safe non-negative integer number, or the text of one (the bank
 * prints some numbers as text, e.g. a net amount of `'101'`). Fractions, signs, exponents, padding, lists, records and
 * everything else read as null, so a malformed value never turns into a number that could be compared or displayed.
 */
export function bankInteger(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null
  if (typeof value === 'string' && /^(?:0|[1-9]\d{0,14})$/.test(value)) return Number(value)

  return null
}

/** An own text field exactly as sent; empty text, other kinds and inherited members read as null. */
export function ownString(data: unknown, key: string): string | null {
  if (!isRecord(data) || !Object.hasOwn(data, key)) return null
  const value = data[key]

  return typeof value === 'string' && value !== '' ? value : null
}

/** An own text field trimmed; text that is empty after trimming reads as null. */
export function ownTrimmed(data: unknown, key: string): string | null {
  const value = ownString(data, key)
  if (value === null) return null
  const trimmed = phpTrim(value)

  return trimmed === '' ? null : trimmed
}

/** An own text or number field with its kind kept; empty text, non-finite numbers and other kinds read as null. */
export function ownScalar(data: unknown, key: string): string | number | null {
  if (!isRecord(data) || !Object.hasOwn(data, key)) return null
  const value = data[key]
  if (typeof value === 'string') return value === '' ? null : value
  if (typeof value === 'number' && Number.isFinite(value)) return value

  return null
}

/** An own text or number field as text (a number the bank sent unquoted reads like its text). */
export function ownText(data: unknown, key: string): string | null {
  const value = ownScalar(data, key)

  return value === null ? null : String(value)
}

/**
 * An own transaction identifier: a positive safe integer (number or text) kept as the bank sent it. The bank answers
 * `0` for "no transaction", which reads as null.
 */
export function ownTransactionId(data: unknown, key: string): string | number | null {
  const value = ownScalar(data, key)
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null
  if (typeof value === 'string' && /^[1-9]\d{0,29}$/.test(value)) return value

  return null
}
