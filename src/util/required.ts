import { PosError } from '../errors.js'
import type { PosOrder } from '../types.js'

/** PHP isset(): neither undefined nor null. */
export function isSet<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null
}

/**
 * Returns a required order field. Missing (undefined/null) values, and empty strings, are rejected instead of being
 * cast to the literal "undefined" and signed/posted to the bank.
 *
 * @throws PosError when the field is missing
 */
export function required<K extends keyof PosOrder>(order: PosOrder, key: K): NonNullable<PosOrder[K]> {
  const value = order[key]
  if (!isSet(value) || value === '') {
    throw new PosError(`Order field "${String(key)}" is required`)
  }

  return value as NonNullable<PosOrder[K]>
}

/** Same rule for a field of a plain record (bank response, recurring options); returns it as a string. */
export function requiredString(data: Record<string, unknown>, key: string, what: string): string {
  const value = data[key]
  if (!isSet(value) || value === '') {
    throw new PosError(`${what} field "${key}" is required`)
  }

  return String(value)
}
