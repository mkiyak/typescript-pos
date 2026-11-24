import { PosError } from '../errors.js'

const INSTALLMENT_TEXT = /^\d{1,2}$/

/**
 * The installment count of an order: absent means none; otherwise one or two digits as text, or a whole number
 * from 0 to 99. Anything else (exponent or hex text, blanks, fractions, negative or huge numbers) is refused.
 *
 * @throws PosError
 */
export function parseInstallment(value: unknown): number {
  const raw: unknown = value ?? 0
  if (typeof raw === 'string' && INSTALLMENT_TEXT.test(raw)) {
    return Number.parseInt(raw, 10)
  }
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 99) {
    return raw
  }
  throw new PosError('The installment count must be a whole number from 0 to 99.')
}
