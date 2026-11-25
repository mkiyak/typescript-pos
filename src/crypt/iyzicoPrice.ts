const PRICE_TEXT = /^\d{1,13}(?:\.\d{1,8})?$/

/** Trailing zeros of a decimal fraction removed, then a dangling point; integers are left alone. */
function stripTrailingZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}

const SIGNATURE_DECIMALS = 8

/** An exponent form of `String(number)`: one digit, optional fraction digits, a signed exponent. */
const EXPONENT_TEXT = /^(\d)(?:\.(\d+))?e([+-]\d+)$/

/**
 * The shortest decimal text that reads back as the same number, written without an exponent. This is the text the
 * number was most likely parsed from (`91184819.71`), unlike its exact binary expansion (`91184819.70999999...`).
 */
function plainNumberText(value: number): string {
  const text = String(value)
  const match = EXPONENT_TEXT.exec(text)
  if (match === null) return text
  const digits = (match[1] ?? '') + (match[2] ?? '')
  const point = 1 + Number(match[3])
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length)

  return `${digits.slice(0, point)}.${digits.slice(point)}`
}

/** A plain decimal text rounded half up to `places` decimals on its written digits. */
function roundDecimalText(text: string, places: number): string {
  const [whole = '', fraction = ''] = text.split('.')
  if (fraction.length <= places) return text
  const roundUp = fraction.charAt(places) >= '5'
  const scaled = BigInt(whole + fraction.slice(0, places)) + (roundUp ? 1n : 0n)
  const digits = scaled.toString().padStart(places + 1, '0')

  return `${digits.slice(0, -places)}.${digits.slice(-places)}`
}

/**
 * The text of a price inside an iyzico signature: at most eight decimals, trailing zeros and a dangling point
 * removed (`10.50` signs as `10.5`, `100.00` as `100`). A number is read from its shortest round-trip text and then
 * rounded half up to eight decimals, so float noise such as `10.209999999999999` collapses to `10.21` and large
 * amounts keep the digits they were written with (`91184819.71`, where an eight-decimal binary expansion would
 * read `91184819.70999999`). Anything that is not a finite amount from 0 up to (not including) 1e13, or a plain
 * decimal string of at most 13 integer and 8 fraction digits, has no signature text: exponent forms, signs, blanks
 * and other types are never converted.
 */
export function iyzicoSignaturePrice(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value >= 1e13) return null
    const text = roundDecimalText(plainNumberText(value), SIGNATURE_DECIMALS)

    return PRICE_TEXT.test(text) ? stripTrailingZeros(text) : null
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
