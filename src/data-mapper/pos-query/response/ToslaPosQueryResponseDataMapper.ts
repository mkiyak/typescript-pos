import { UnsupportedTransactionTypeError } from '../../../errors.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import { ownValue } from '../../../util/ownValue.js'
import { phpTrim } from '../../../util/phpTrim.js'
import { AbstractQueryResponseDataMapper } from './AbstractQueryResponseDataMapper.js'
import type {
  InstallmentPricesResponse,
  InstallmentRatesResponse,
  PosQueryHistoryResponse,
} from './QueryResponseDataMapperInterface.js'

type Raw = Record<string, unknown>

const TEXT_LIMIT = 256
/** Larger than any amount the library sends (1e13 TL is 1e15 kuruş): a bigger bank number is not a price. */
const MAX_KURUS = 999_999_999_999_999
/** `T2` … `T99`: the bank names a rate by the installment count. */
const RATE_KEY = /^T([1-9]\d?)$/
const STRICT_DECIMAL = /^-?\d{1,6}(?:\.\d{1,6})?$/
const BANK_CODE_TEXT = /^\d{1,4}$/
const CARD_PREFIX_TEXT = /^\d{6,8}$/
const BANK_INTEGER_TEXT = /^(?:0|[1-9]\d{0,14})$/

function isRecord(value: unknown): value is Raw {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** An own string field, trimmed and cut to a printable length; anything else (numbers, objects) and '' read as null. */
function text(data: Raw, key: string): string | null {
  const value = ownValue(data, key)
  if (typeof value !== 'string') return null
  const trimmed = phpTrim(value)
  return trimmed === '' ? null : trimmed.slice(0, TEXT_LIMIT)
}

/**
 * A whole number from the bank: a safe non-negative integer, or its plain decimal text (the bank sometimes sends
 * numbers as text). Signs, fractions, exponents, padding and leading zeros are not accepted.
 */
function bankInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_KURUS ? value : null
  }
  if (typeof value === 'string' && BANK_INTEGER_TEXT.test(value)) {
    return Number(value)
  }
  return null
}

/** A rate value: absent reads as 0, a finite number or strict decimal text is taken, anything else is unusable. */
function rateValue(record: Raw, key: string): number | null {
  const value = ownValue(record, key)
  if (value === undefined || value === null) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && STRICT_DECIMAL.test(value)) return Number(value)
  return null
}

/**
 * Normalizes the installment answers of Tosla. The bank answers prices in kuruş; the library reports TL, computed
 * from whole kuruş so no floating point error creeps in. Entries the bank sends in an unexpected shape are dropped
 * (and logged without their values) instead of being guessed at; `history` and the bin list are not offered.
 */
export class ToslaPosQueryResponseDataMapper extends AbstractQueryResponseDataMapper {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'ToslaPos'
  }

  override mapHistoryResponse(_raw: Raw): PosQueryHistoryResponse {
    throw new UnsupportedTransactionTypeError(`Query type [${QUERY_TYPE.HISTORY}] is not supported.`)
  }

  override mapInstallmentRatesResponse(raw: Raw): InstallmentRatesResponse {
    const result = this.getDefaultInstallmentRatesResponse()
    const approved = this.isApproved(raw)

    result.status = approved ? 'approved' : 'declined'
    result.error_message = approved ? null : text(raw, 'Message')
    result.all = raw
    if (!approved) return result

    const rates = this.parseRates(raw)
    if (rates.length > 0) {
      result.installment_rates = [
        {
          bank_code: this.bankCode(ownValue(raw, 'BankCode')),
          bank_name: text(raw, 'BankName'),
          card_prefix: this.cardPrefix(ownValue(raw, 'CardPrefix')),
          card_type: this.valueMapper.mapCardType(this.stringOrNull(ownValue(raw, 'CardType'))),
          card_class: this.valueMapper.mapCardClass(this.stringOrNull(ownValue(raw, 'CardClass'))),
          card_family: null,
          rates,
        },
      ]
    }

    return result
  }

  override mapInstallmentPricesResponse(raw: Raw): InstallmentPricesResponse {
    const result = this.getDefaultInstallmentPricesResponse()
    const approved = this.isApproved(raw)

    result.status = approved ? 'approved' : 'declined'
    result.error_message = approved ? null : text(raw, 'Message')
    result.all = raw
    if (!approved) return result

    const prices = this.parsePrices(raw)
    if (prices.length > 0) {
      result.installment_prices = [
        {
          bank_code: null,
          bank_name: null,
          card_prefix: null,
          card_type: null,
          card_class: null,
          card_family: null,
          prices,
        },
      ]
    }

    return result
  }

  /** The bank reports success with the number 0; text such as "0", a missing code or an inherited one is no success. */
  private isApproved(raw: Raw): boolean {
    return ownValue(raw, 'Code') === 0
  }

  private stringOrNull(value: unknown): string | null {
    return typeof value === 'string' ? value : null
  }

  private bankCode(value: unknown): number | null {
    if (typeof value === 'string') return BANK_CODE_TEXT.test(value) ? Number(value) : null
    return bankInteger(value)
  }

  private cardPrefix(value: unknown): string | null {
    if (typeof value === 'string') return CARD_PREFIX_TEXT.test(value) ? value : null
    if (typeof value === 'number' && Number.isSafeInteger(value) && CARD_PREFIX_TEXT.test(String(value))) {
      return String(value)
    }
    return null
  }

  /** `{"T2": {"Rate": 2.99, "Constant": 2}, …}` of the first commission package as a list sorted by installment. */
  private parseRates(raw: Raw): Array<{ installment: number; rate: number; constant: number }> {
    const packages = ownValue(raw, 'CommissionPackages')
    const first: unknown = Array.isArray(packages) ? packages[0] : undefined
    const table: unknown = isRecord(first) ? ownValue(first, 'InstallmentRate') : undefined
    if (!isRecord(table)) return []

    const rates: Array<{ installment: number; rate: number; constant: number }> = []
    for (const key of Object.keys(table)) {
      const match = RATE_KEY.exec(key)
      const installment = match === null ? 0 : Number(match[1])
      // T1 is the single payment; keys of any other shape are not installment rates
      if (installment < 2) continue

      const entry = table[key]
      const rate = isRecord(entry) ? rateValue(entry, 'Rate') : null
      const constant = isRecord(entry) ? rateValue(entry, 'Constant') : null
      if (rate === null || constant === null) {
        this.logger.warn('Installment rate dropped: unexpected shape', { key })
        continue
      }
      rates.push({ installment, rate, constant })
    }

    return rates.sort((a, b) => a.installment - b.installment)
  }

  /**
   * `[{"Installment": 2, "Amount": 10101}, …]`: `Amount` is the total in kuruş. The per-installment price is the
   * total divided by the installment count, rounded half up to a whole kuruş.
   */
  private parsePrices(raw: Raw): Array<{ installment: number; installment_price: number; total_price: number | null }> {
    const options = ownValue(raw, 'InstallmentOptions')
    if (!Array.isArray(options)) return []

    const prices: Array<{ installment: number; installment_price: number; total_price: number | null }> = []
    options.forEach((entry: unknown, index) => {
      const installment = isRecord(entry) ? bankInteger(ownValue(entry, 'Installment')) : null
      const kurus = isRecord(entry) ? bankInteger(ownValue(entry, 'Amount')) : null
      if (installment === null || installment < 1 || installment > 99 || kurus === null) {
        this.logger.warn('Installment option dropped: unexpected shape', { index })
        return
      }
      prices.push({
        installment,
        installment_price: Math.round(kurus / installment) / 100,
        total_price: kurus / 100,
      })
    })

    return prices.sort((a, b) => a.installment - b.installment)
  }
}
