import { PosError } from '../errors.js'
import { numberFormat2 } from './numberFormat2.js'

/**
 * An amount in kuruş as an integer, computed from the two-decimal text of the amount (`1.15` is `115`, `8.2` is
 * `820`) instead of multiplying by 100 and truncating, which loses a kuruş on values such as `1.15`. The amount is
 * rounded to two decimals half up. Amounts that are not finite, are 1e13 or more, are zero or negative, or round to
 * less than one kuruş are rejected: a bank request never carries them.
 */
export function toKurus(amount: number): number {
  const text = numberFormat2(amount)
  const kurus = Number(text.replace('.', ''))
  if (!(kurus >= 1)) {
    throw new PosError(`Invalid amount: ${amount}`)
  }
  return kurus
}
