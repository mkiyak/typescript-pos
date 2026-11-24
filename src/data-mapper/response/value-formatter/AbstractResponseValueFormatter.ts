import { PosError } from '../../../errors.js'
import type { TxType } from '../../../PosInterface.js'
import type { ResponseValueFormatterInterface } from './ResponseValueFormatterInterface.js'

const PHP_NUMERIC = /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/

/** PHP `(int)` cast of a string or null. */
export function phpInt(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (PHP_NUMERIC.test(value)) {
    const n = Math.trunc(Number(value))
    return Number.isFinite(n) ? n : 0
  }
  const n = Number.parseInt(value.replace(/^[ \t\n\r\v\f]+/, ''), 10)
  return Number.isNaN(n) ? 0 : n
}

/** PHP `(float)` cast of a string or number. */
export function phpFloat(value: string | number): number {
  if (typeof value === 'number') return value
  const n = Number.parseFloat(value.replace(/^[ \t\n\r\v\f]+/, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Offset of bank timestamps that carry no UTC offset: Türkiye time, fixed UTC+03:00 (no DST since 2016).
 * Independent of the server timezone.
 */
export const BANK_TIMEZONE_OFFSET_MINUTES = 180

// Bank date-time layouts seen across gateways.
const ISO_LIKE = /^(\d{4})-?(\d{2})-?(\d{2})(?:[T ]?(\d{2}):?(\d{2}):?(\d{2})(?:[.,](\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/
const DOTTED = /^(\d{2})\.(\d{2})\.(\d{4})(?:[T ](\d{2}):(\d{2}):(\d{2}))?$/

type DateParts = [string, string, string, string?, string?, string?, string?, string?]

function unsupported(input: string): PosError {
  return new PosError(`Unsupported date time format: "${input}"`)
}

/** Offset in minutes east of UTC for `Z`, `+03:00`, `-0500`. */
function parseOffset(offset: string): number {
  if (offset === 'Z') return 0
  const sign = offset.startsWith('-') ? -1 : 1
  const digits = offset.slice(1).replace(':', '')
  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)))
}

/**
 * Parses a bank timestamp into an absolute instant. An explicit offset (`Z`, `±HH:MM`, `±HHMM`) is honoured;
 * without one the wall-clock time is Türkiye time (BANK_TIMEZONE_OFFSET_MINUTES). Independent of the server TZ.
 */
function parseDateTime(input: string): Date {
  const value = input.trim()
  if (value.toLowerCase() === 'now') {
    return new Date()
  }

  let parts: DateParts | null = null
  const iso = ISO_LIKE.exec(value)
  if (iso) {
    parts = [iso[1] as string, iso[2] as string, iso[3] as string, iso[4], iso[5], iso[6], iso[7], iso[8]]
  } else {
    const dotted = DOTTED.exec(value)
    if (dotted) {
      parts = [dotted[3] as string, dotted[2] as string, dotted[1] as string, dotted[4], dotted[5], dotted[6]]
    }
  }
  if (parts === null) {
    throw unsupported(input)
  }

  const [y, mo, d, h = '0', mi = '0', s = '0', frac = '', offset] = parts
  const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  const ms = frac === '' ? 0 : Number(frac.slice(0, 3).padEnd(3, '0'))
  const wallClock = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms))

  // Reject overflowing components (e.g. month 13, Feb 30) instead of silently rolling over.
  if (
    wallClock.getUTCFullYear() !== year ||
    wallClock.getUTCMonth() !== month - 1 ||
    wallClock.getUTCDate() !== day ||
    wallClock.getUTCHours() !== hour ||
    wallClock.getUTCMinutes() !== minute ||
    wallClock.getUTCSeconds() !== second
  ) {
    throw unsupported(input)
  }

  const offsetMinutes = offset === undefined ? BANK_TIMEZONE_OFFSET_MINUTES : parseOffset(offset)
  return new Date(wallClock.getTime() - offsetMinutes * 60_000)
}

export abstract class AbstractResponseValueFormatter implements ResponseValueFormatterInterface {
  formatInstallment(installment: string | null | undefined, _txType: TxType | string): number {
    const inst = phpInt(installment)

    return inst > 1 ? inst : 0
  }

  formatAmount(amount: string | number, _txType: TxType | string): number {
    return phpFloat(amount)
  }

  formatDateTime(dateTime: string, _txType: TxType | string): Date {
    return parseDateTime(dateTime)
  }
}
