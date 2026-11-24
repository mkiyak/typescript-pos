const DECIMAL = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)\s*$/

/** A finite order amount from a number or a plain decimal string (no exponent, no thousands separator); NaN otherwise. */
export function parseOrderAmount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN

  return typeof value === 'string' && DECIMAL.test(value) ? Number(value) : Number.NaN
}
