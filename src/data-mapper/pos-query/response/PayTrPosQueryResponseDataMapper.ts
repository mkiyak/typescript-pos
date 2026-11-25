import { UnsupportedTransactionTypeError } from '../../../errors.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import { ownValue } from '../../../util/ownValue.js'
import { phpTrim } from '../../../util/phpTrim.js'
import { payTrDecimalKurus, payTrPlainText } from '../../response/mapper/PayTrPosResponseDataMapper.js'
import { isRecord, ownScalar, type Raw } from '../../response/mapper/toslaResponseFields.js'
import { AbstractQueryResponseDataMapper } from './AbstractQueryResponseDataMapper.js'
import type {
  BinListResponse,
  InstallmentPricesResponse,
  InstallmentRatesResponse,
  PosQueryHistoryResponse,
} from './QueryResponseDataMapperInterface.js'

/** The only status word that means success. */
const SUCCESS = 'success'
/** Texts of the bank shown to the caller are cut to a printable length. */
const MESSAGE_LIMIT = 256
/** Names, codes and brands of a BIN record or a history row stay short. */
const ITEM_TEXT_LIMIT = 64
/** `taksit_2` … `taksit_12`; the key of the single payment (`taksit_1`) is never read. */
const RATE_KEY = /^taksit_([1-9]\d?)$/
/** A rate is a percentage: up to three integer digits and four decimals, written with a dot. */
const RATE_TEXT = /^\d{1,3}(?:\.\d{1,4})?$/
const MAX_RATE = 1000
const BANK_CODE = /^\d{1,10}$/
const INSTALLMENT_COUNT = /^\d{1,2}$/

/** An own text without control characters, trimmed and at most `limit` characters; longer or non-text is null. */
function itemText(data: unknown, key: string): string | null {
  const text = payTrPlainText(data, key, Number.MAX_SAFE_INTEGER)
  if (text === null) return null
  const trimmed = phpTrim(text)

  return trimmed === '' || trimmed.length > ITEM_TEXT_LIMIT ? null : trimmed
}

/**
 * Normalizes the answers of the PayTR query endpoints (history, installment rates, BIN list). An answer counts as a
 * success only when its own `status` is exactly `success`. Values that are not the expected kind (lists, records,
 * malformed numbers, overlong texts) read as null or are dropped, with a log line that names the field and never its
 * value; they never become "[object Object]". Amounts are read from strict decimal text and are display values.
 * History lists records only: whatever its result says, it is a report and never a confirmation of a payment, so its
 * rows carry no authorization code, reference or transaction id.
 */
export class PayTrPosQueryResponseDataMapper extends AbstractQueryResponseDataMapper {
  static override readonly PROCEDURE_SUCCESS_CODE: string = SUCCESS

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'PayTrPos'
  }

  override mapInstallmentPricesResponse(_raw: Raw): InstallmentPricesResponse {
    throw new UnsupportedTransactionTypeError(`Query type [${QUERY_TYPE.INSTALLMENT_PRICES}] is not supported.`)
  }

  override mapBinListResponse(raw: Raw): BinListResponse {
    const result = this.getDefaultBinListResponse()
    const approved = this.isSuccess(raw)

    result.status = approved ? 'approved' : 'declined'
    result.error_message = approved ? null : (payTrPlainText(raw, 'err_msg', MESSAGE_LIMIT) ?? this.wordOf(raw))
    result.all = raw
    if (!approved) return result

    result.bin_list.push({
      bin: null,
      bank_code: this.bankCode(raw),
      bank_name: itemText(raw, 'bank'),
      card_type: this.valueMapper.mapCardType(itemText(raw, 'schema')),
      card_class: this.valueMapper.mapCardClass(itemText(raw, 'cardType')),
      card_family: this.valueMapper.mapCardFamilyName(itemText(raw, 'brand')),
    })

    return result
  }

  /**
   * The `transactions` rows are report lines only: a row's status never confirms a payment, whatever the answer
   * says. Card numbers are kept only when masked.
   */
  override mapHistoryResponse(raw: Raw): PosQueryHistoryResponse {
    const approved = this.isSuccess(raw)
    const procReturnCode = this.wordOf(raw)

    const list = approved ? ownValue(isRecord(raw) ? raw : {}, 'list') : undefined
    const transactions = Array.isArray(list) ? list.filter(isRecord).map((row) => this.mapHistoryTransaction(row)) : []

    return {
      proc_return_code: procReturnCode,
      error_code: approved ? null : (this.ownCode(raw, 'err_no') ?? procReturnCode),
      error_message: approved ? null : payTrPlainText(raw, 'err_msg', MESSAGE_LIMIT),
      trans_count: transactions.length,
      transactions,
      status: approved ? 'approved' : 'declined',
      all: raw,
    }
  }

  override mapInstallmentRatesResponse(raw: Raw): InstallmentRatesResponse {
    const result = this.getDefaultInstallmentRatesResponse()
    const approved = this.isSuccess(raw)

    result.status = approved ? 'approved' : 'declined'
    result.error_message = approved ? null : payTrPlainText(raw, 'err_msg', MESSAGE_LIMIT)
    result.all = raw
    if (!approved) return result

    const oranlar = ownValue(isRecord(raw) ? raw : {}, 'oranlar')
    if (!isRecord(oranlar)) return result

    // A card family without a single readable rate is left out of the result instead of being listed empty.
    for (const family of Object.keys(oranlar)) {
      const row: unknown = ownValue(oranlar, family)
      if (!isRecord(row)) continue
      if (family.length > ITEM_TEXT_LIMIT) {
        this.logger.warn('Installment rate family dropped: name too long')
        continue
      }

      const rates = this.parseRates(row)
      if (rates.length === 0) continue
      result.installment_rates.push({
        bank_code: null,
        bank_name: null,
        card_prefix: null,
        card_type: null,
        card_class: null,
        card_family: this.valueMapper.mapCardFamilyName(family),
        rates,
      })
    }

    return result
  }

  /** The own status is exactly the word `success`. */
  private isSuccess(raw: unknown): boolean {
    return ownValue(isRecord(raw) ? raw : {}, 'status') === SUCCESS
  }

  /** The own status word as a short text, else null. */
  private wordOf(raw: unknown): string | null {
    return payTrPlainText(raw, 'status', ITEM_TEXT_LIMIT)
  }

  /** An own error number as a short text (text or number), else null. */
  private ownCode(raw: unknown, key: string): string | null {
    const value = ownScalar(raw, key)
    if (value === null) return null
    const text = payTrPlainText({ [key]: String(value) }, key, ITEM_TEXT_LIMIT)

    return text
  }

  /** The bank code as text: a whole number or digit text; a leading zero of text is kept. */
  private bankCode(raw: unknown): string | null {
    const value = ownScalar(raw, 'bankCode')
    if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null

    return typeof value === 'string' && BANK_CODE.test(value) ? value : null
  }

  /** `taksit_2` … `taksit_12` of one card family, sorted by installment count; malformed entries are dropped. */
  private parseRates(row: Raw): Array<{ installment: number; rate: number; constant: number }> {
    const rates: Array<{ installment: number; rate: number; constant: number }> = []
    for (const key of Object.keys(row)) {
      const match = RATE_KEY.exec(key)
      const installment = match === null ? Number.NaN : Number(match[1])
      // `taksit_1` is the single payment, not an installment
      if (installment === 1) continue
      const rate = this.readRate(ownValue(row, key))
      if (!(installment >= 2 && installment <= 12) || rate === null) {
        this.logger.warn('Installment rate dropped: unexpected shape', { key: key.slice(0, ITEM_TEXT_LIMIT) })
        continue
      }
      rates.push({ installment, rate, constant: 0 })
    }

    return rates.sort((a, b) => a.installment - b.installment)
  }

  /** A rate from a finite number or plain decimal text with a dot; everything else is null. */
  private readRate(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value < MAX_RATE ? value : null
    if (typeof value === 'string' && RATE_TEXT.test(value)) return Number(value)

    return null
  }

  private mapHistoryTransaction(row: Raw): Record<string, unknown> {
    const type = ownScalar(row, 'islem_tipi')
    const currency = ownScalar(row, 'para_birimi')
    const time = ownScalar(row, 'islem_tarihi')
    const installment = this.installmentCount(ownScalar(row, 'taksit'))

    return this.mergeArraysPreferNonNullValues(this.getDefaultHistoryTxResponse(), {
      order_id: itemText(row, 'siparis_no'),
      transaction_type: this.transactionType(typeof type === 'string' ? type : null),
      transaction_time: typeof time === 'string' ? this.time(time) : null,
      first_amount: this.amount(ownScalar(row, 'islem_tutari'), 'islem_tutari'),
      capture_amount: this.amount(ownScalar(row, 'odeme_tutari'), 'odeme_tutari'),
      currency: typeof currency === 'string' ? this.valueMapper.mapCurrency(currency, QUERY_TYPE.HISTORY) : null,
      masked_number: this.maskedNumber(itemText(row, 'kart_no')),
      installment_count: installment,
      status: 'approved',
    })
  }

  /** A card number that is a whole run of 13 to 19 digits is a clear PAN, never a masked one: it is not kept. */
  private maskedNumber(text: string | null): string | null {
    return text !== null && /^\d{13,19}$/.test(text) ? null : text
  }

  /** A transaction type letter the table does not know is no transaction type, never an error. */
  private transactionType(word: string | null): string | null {
    if (word === null) return null
    try {
      return this.valueMapper.mapTxType(word)
    } catch {
      return null
    }
  }

  /** A bank time; one that cannot be read is null (the warning names the field, never the value). */
  private time(value: string): Date | null {
    try {
      return this.valueFormatter.formatDateTime(value, QUERY_TYPE.HISTORY)
    } catch {
      this.logger.warn('bank timestamp could not be parsed', { field: 'transaction_time' })

      return null
    }
  }

  /** A display amount read from strict decimal text (two decimals at most); anything else is null. */
  private amount(value: string | number | null, field: string): number | null {
    if (value === null) return null
    const kurus = payTrDecimalKurus(value)
    if (kurus === null) {
      this.logger.warn('bank amount could not be parsed', { field })

      return null
    }

    return kurus / 100
  }

  private installmentCount(value: string | number | null): number | null {
    if (value === null) return null
    const text = String(value)

    return INSTALLMENT_COUNT.test(text) ? this.valueFormatter.formatInstallment(text, QUERY_TYPE.HISTORY) : null
  }
}
