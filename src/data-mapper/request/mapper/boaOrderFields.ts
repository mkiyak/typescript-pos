import { PosError } from '../../../errors.js'
import type { PosOrder } from '../../../types.js'
import { ORDER_ID_PATTERN } from '../../../util/orderId.js'
import { ownValue } from '../../../util/ownValue.js'
import { parseOrderAmount } from '../../../util/parseOrderAmount.js'
import { required } from '../../../util/required.js'

/**
 * Order ids are signed and posted as plain ASCII: letters, digits, underscore and hyphen, at most 64 characters,
 * starting with a letter or a digit.
 */
export { ORDER_ID_PATTERN }

/** The 3D authentication packet is base64 text. */
export const MD_PATTERN = /^[A-Za-z0-9+/=]{1,1024}$/

/** Return URLs are signed as text: plain printable ASCII only, so the bank hashes the same bytes we do. */
const URL_PATTERN = /^https?:\/\/[\x21-\x7E]+$/i

/** The merchant order id: text or a safe integer number, restricted to a safe alphabet. */
export function orderIdOf(order: PosOrder): string {
  const raw: unknown = required(order, 'id')
  const id = typeof raw === 'string' || (typeof raw === 'number' && Number.isSafeInteger(raw)) ? String(raw) : ''
  if (!ORDER_ID_PATTERN.test(id)) {
    throw new PosError(
      'The order id may only hold letters, digits, underscores and hyphens (at most 64) and must start with a letter or a digit.',
    )
  }
  return id
}

/** The order amount as a positive number; the kuruş conversion rejects anything below one kuruş. */
export function orderAmountOf(order: PosOrder): number {
  const amount = parseOrderAmount(required(order, 'amount'))
  if (!(amount > 0)) {
    throw new PosError('The order amount must be a positive number.')
  }
  return amount
}

/** A required http(s) return URL made of printable ASCII only. */
export function orderUrlOf(order: PosOrder, key: 'success_url' | 'fail_url'): string {
  const value: unknown = required(order, key)
  if (typeof value !== 'string' || !URL_PATTERN.test(value)) {
    throw new PosError(`Order field "${key}" must be an http(s) URL of printable ASCII characters.`)
  }
  return value
}

/** A required order value that is non-empty text. */
export function orderStringOf(order: PosOrder, key: string): string {
  const value: unknown = required(order, key as keyof PosOrder)
  if (typeof value !== 'string') {
    throw new PosError(`Order field "${key}" must be text`)
  }
  return value
}

/** A required order value that is text or a finite number, as text. */
export function orderTextOf(order: PosOrder, key: string): string {
  const value: unknown = required(order, key as keyof PosOrder)
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  throw new PosError(`Order field "${key}" must be text`)
}

/** A required nested order object (not null, not a list). */
export function orderRecordOf(order: PosOrder, key: string): Record<string, unknown> {
  const value: unknown = required(order, key as keyof PosOrder)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PosError(`Order field "${key}" must be an object`)
  }
  return value as Record<string, unknown>
}

/** A text value of a nested order object; absent is an empty string, anything but text or a number is refused. */
export function optionalTextOf(source: Record<string, unknown>, key: string): string {
  const value = ownValue(source, key)
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  throw new PosError(`Order value "${key}" must be text or a number`)
}

/** An optional order date: absent means the fallback; anything but a valid `Date` is refused. */
export function orderDateOf(order: PosOrder, key: 'start_date' | 'end_date', fallback: Date | null): Date {
  const value: unknown = order[key]
  if (value === undefined || value === null) {
    if (fallback === null) throw new PosError(`Order field "${key}" is required`)
    return fallback
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new PosError(`Order field "${key}" must be a valid Date`)
  }
  return value
}
