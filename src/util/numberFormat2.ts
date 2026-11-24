import { PosError } from '../errors.js'

/** Amounts at or above this are rejected: PHP's own rounding becomes erratic beyond ~7e13, far past any real payment. */
const MAX_AMOUNT = 1e13

/**
 * PHP >= 8.4 `number_format($amount, 2, '.', '')`: `_php_math_round(value, 2, HALF_UP)` without pre-rounding, then
 * `%.2f`. The scaled value is rounded half up, but a value whose scaled form lies just below a tie
 * (0.285 * 100 = 28.499999999999996) is still rounded up when it is not below `(floor + 0.5) / 100`.
 * Verified against PHP 8.5 with a differential run.
 */
export function numberFormat2(amount: number): string {
  if (!Number.isFinite(amount) || Math.abs(amount) >= MAX_AMOUNT) {
    throw new PosError(`Invalid amount: ${amount}`)
  }

  const magnitude = Math.abs(amount)
  const floor = Math.floor(magnitude * 100)
  const cents = magnitude >= (floor + 0.5) / 100 ? floor + 1 : floor
  const text = (cents / 100).toFixed(2)

  return amount < 0 && cents !== 0 ? `-${text}` : text
}
