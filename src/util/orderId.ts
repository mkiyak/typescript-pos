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
 * The order id as sent to the bank. Accepts a string, or a safe non-negative integer number (converted with String).
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
