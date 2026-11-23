import type { TxType } from '../../../PosInterface.js'
import type { ResponseValueFormatterInterface } from './ResponseValueFormatterInterface.js'

const PHP_NUMERIC = /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/

/** PHP `(int)` cast of a string or null. */
function phpInt(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (PHP_NUMERIC.test(value)) {
    const n = Math.trunc(Number(value))
    return Number.isFinite(n) ? n : 0
  }
  const n = Number.parseInt(value.replace(/^[ \t\n\r\v\f]+/, ''), 10)
  return Number.isNaN(n) ? 0 : n
}

/** PHP `(float)` cast of a string or number. */
function phpFloat(value: string | number): number {
  if (typeof value === 'number') return value
  const n = Number.parseFloat(value.replace(/^[ \t\n\r\v\f]+/, ''))
  return Number.isFinite(n) ? n : 0
}

// Bank date-time layouts seen across gateways.
const ISO_LIKE = /^(\d{4})-?(\d{2})-?(\d{2})(?:[T ]?(\d{2}):?(\d{2}):?(\d{2})(?:[.,](\d+))?)?(?:Z|[+-]\d{2}:?\d{2})?$/
const DOTTED = /^(\d{2})\.(\d{2})\.(\d{4})(?:[T ](\d{2}):(\d{2}):(\d{2}))?$/

function parseDateTime(input: string): Date {
  const value = input.trim()
  if (value.toLowerCase() === 'now') {
    return new Date()
  }

  let parts: [string, string, string, string?, string?, string?, string?] | null = null
  const iso = ISO_LIKE.exec(value)
  if (iso) {
    parts = [iso[1] as string, iso[2] as string, iso[3] as string, iso[4], iso[5], iso[6], iso[7]]
  } else {
    const dotted = DOTTED.exec(value)
    if (dotted) {
      parts = [dotted[3] as string, dotted[2] as string, dotted[1] as string, dotted[4], dotted[5], dotted[6]]
    }
  }
  if (parts === null) {
    throw new Error(`Unsupported date time format: "${input}"`)
  }

  const [y, mo, d, h = '0', mi = '0', s = '0', frac = ''] = parts
  const nums = [y, mo, d, h, mi, s].map(Number) as [number, number, number, number, number, number]
  const ms = frac === '' ? 0 : Number(frac.slice(0, 3).padEnd(3, '0'))
  const date = new Date(nums[0], nums[1] - 1, nums[2], nums[3], nums[4], nums[5], ms)

  // Reject overflowing components (e.g. month 13) instead of silently rolling over.
  if (
    date.getFullYear() !== nums[0] ||
    date.getMonth() !== nums[1] - 1 ||
    date.getDate() !== nums[2] ||
    date.getHours() !== nums[3] ||
    date.getMinutes() !== nums[4] ||
    date.getSeconds() !== nums[5]
  ) {
    throw new Error(`Unsupported date time format: "${input}"`)
  }

  return date
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
