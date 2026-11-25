import { PosError } from '../errors.js'
import type { PosOrder } from '../types.js'
import { ownValue } from './ownValue.js'

/**
 * Letter or digit first, then letters, digits, '_' or '-'; 1–64 characters.
 *
 * Order ids are posted unescaped in form bodies and concatenated into signed strings without separators, so they are
 * kept to plain ASCII: a leading separator, a blank, '&', '%' or a non-ASCII letter never reaches a bank.
 */
export const ORDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/**
 * The order id of a new payment (a 3D form, a non-secure sale or pre-authorization) as sent to the bank. Accepts a
 * string, or a safe non-negative integer number (converted with String). Operations on an order that already exists
 * and callback bindings read the id with `existingOrderIdOf`.
 *
 * @param maxLength the bank's limit when it is below 64
 * @param pattern a stricter alphabet for banks that refuse some of the default characters
 * @param field the name reported in error messages, for callers that pass another field's value as `id`
 * @throws PosError when missing, of another type, or not matching `pattern` / longer than `maxLength`
 */
export function orderIdOf(order: PosOrder, maxLength = 64, pattern: RegExp = ORDER_ID_PATTERN, field = 'id'): string {
  if (order === null || typeof order !== 'object') {
    throw new PosError('Order data is required')
  }
  const raw: unknown = ownValue(order as Record<string, unknown>, 'id')
  if (raw === undefined || raw === null || raw === '') {
    throw new PosError(`Order field "${field}" is required`)
  }

  const id = typeof raw === 'string' ? raw : Number.isSafeInteger(raw) && (raw as number) >= 0 ? String(raw) : null
  if (id === null || id.length > maxLength || !pattern.test(id)) {
    const alphabet = pattern.source.includes('_') ? 'letters, digits, "_" or "-"' : 'letters, digits or "-"'
    throw new PosError(`Order field "${field}" must be 1-${maxLength} ${alphabet}, starting with a letter or digit`)
  }

  return id
}

/** C0 and C1 control characters, DEL, and a surrogate half without its partner. */
const UNSAFE_TEXT =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is refused
  /[\u0000-\u001F\u007F-\u009F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/**
 * The id of an order that already exists at the bank, as sent to it or compared with its callback.
 *
 * Orders created before the shared rule may carry ids the rule now refuses (a dot, a blank, a leading `_`), and their
 * callbacks, captures, cancels, refunds and lookups must keep working. Starting a payment always uses `orderIdOf`. Every
 * request that carries an existing id escapes it for its format, and a callback is compared with it exactly, so only
 * what can never be sent or compared safely is refused: another type, a control character, a broken surrogate pair.
 *
 * @param maxLength the bank's limit when it is below 64
 * @param field the name reported in error messages, for callers that pass another field's value as `id`
 * @throws PosError when missing, of another type, longer than `maxLength` or holding a control character
 */
export function existingOrderIdOf(order: PosOrder, maxLength = 64, field = 'id'): string {
  if (order === null || typeof order !== 'object') {
    throw new PosError('Order data is required')
  }
  const raw: unknown = ownValue(order as Record<string, unknown>, 'id')
  if (raw === undefined || raw === null || raw === '') {
    throw new PosError(`Order field "${field}" is required`)
  }

  const id = typeof raw === 'string' ? raw : Number.isSafeInteger(raw) && (raw as number) >= 0 ? String(raw) : null
  if (id === null || id.length > maxLength || UNSAFE_TEXT.test(id)) {
    throw new PosError(
      `Order field "${field}" must be text of 1-${maxLength} characters without control characters, or a non-negative whole number`,
    )
  }

  return id
}
