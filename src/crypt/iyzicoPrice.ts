const PRICE_TEXT = /^\d{1,13}(?:\.\d{1,8})?$/

/** Trailing zeros of a decimal fraction removed, then a dangling point; integers are left alone. */
function stripTrailingZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}

/**
 * The text of a price inside an iyzico signature: at most eight decimals, trailing zeros and a dangling point
 * removed (`10.50` signs as `10.5`, `100.00` as `100`). A number is rendered with eight decimals first, so float
 * noise such as `10.209999999999999` collapses to `10.21`. Anything that is not a finite amount from 0 up to (not
 * including) 1e13, or a plain decimal string of at most 13 integer and 8 fraction digits, has no signature text:
 * exponent forms, signs, blanks and other types are never converted.
 */
export function iyzicoSignaturePrice(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value >= 1e13) return null
    return stripTrailingZeros(value.toFixed(8))
  }
  if (typeof value === 'string' && PRICE_TEXT.test(value)) {
    return stripTrailingZeros(value)
  }
  return null
}

/** An answer amount in whole kuruş: the signature text of the price with at most two decimals, else `null`. */
export function iyzicoAnswerKurus(value: unknown): number | null {
  const text = iyzicoSignaturePrice(value)
  if (text === null) return null
  const [whole = '', fraction = ''] = text.split('.')
  if (fraction.length > 2) return null
  return Number(whole + fraction.padEnd(2, '0'))
}
