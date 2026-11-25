import { PosError } from '../errors.js'
import type { PosOrder } from '../types.js'
import { ownValue } from './ownValue.js'

/**
 * An order field that carries a reference the bank issued (a reference number, an authorization code), as sent
 * back to the bank: a string with something in it besides whitespace. Missing, `null` and `''` mean "not given" and
 * give `null`; a blank string or a value of another type (a number, an object) is refused instead of being sent as
 * the text it happens to print as.
 *
 * @throws PosError when the field is given but is not a non-blank string
 */
export function optionalBankReference(order: PosOrder, key: 'ref_ret_num' | 'auth_code'): string | null {
  const value: unknown = ownValue(order as Record<string, unknown>, key)
  if (value === undefined || value === null || value === '') {
    return null
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PosError(`Order field "${key}" must be a non-blank string`)
  }

  return value
}

/** Same rule for a reference the request cannot do without. */
export function requiredBankReference(order: PosOrder, key: 'ref_ret_num' | 'auth_code'): string {
  const value = optionalBankReference(order, key)
  if (value === null) {
    throw new PosError(`Order field "${key}" is required`)
  }

  return value
}
