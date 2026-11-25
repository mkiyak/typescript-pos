import { UnsupportedTransactionTypeError } from '../../../errors.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import { ownValue } from '../../../util/ownValue.js'
import { phpTrim } from '../../../util/phpTrim.js'
import { child, isRecord, ownCode, ownDisplay, type Raw } from '../../response/mapper/paramResponseFields.js'
import { AbstractQueryResponseDataMapper } from './AbstractQueryResponseDataMapper.js'
import type {
  BinListResponse,
  InstallmentPricesResponse,
  InstallmentRatesResponse,
  PosQueryHistoryResponse,
} from './QueryResponseDataMapperInterface.js'

/** What replaces a credential the bank echoed. */
const REDACTED = '***'
/** Fields that carry the account's credentials; a bank answer that echoes one is returned without its value. */
const CREDENTIAL_KEYS: ReadonlySet<string> = new Set([
  'guid',
  'turkpos_retval_guid',
  'client_password',
  'client_username',
])
const MAX_REDACTION_DEPTH = 64

/** Text of the bank shown to the caller is cut to a printable length. */
const TEXT_LIMIT = 256
/** Strings of a BIN record (names, codes) stay short. */
const ITEM_TEXT_LIMIT = 64
/** `MO_02` … `MO_12`: the rate of an installment count; `MO_01` (single payment) is never read. */
const RATE_KEYS: readonly string[] = Array.from(
  { length: 11 },
  (_unused, index) => `MO_${String(index + 2).padStart(2, '0')}`,
)
/** Rates have at most six integer digits and six decimals, like their text form. */
const STRICT_DECIMAL = /^-?\d{1,6}(?:\.\d{1,6})?$/
/** A secret shorter than this is only removed when a value equals it, never from inside longer text. */
const MIN_SUBSTRING_SECRET = 8

/**
 * A copy of `value` in which credential fields and values equal to one of `secrets` are replaced with `***`. The
 * value itself is returned when nothing had to be replaced, so an untouched answer stays the same object.
 */
export function redactEchoedCredentials(value: unknown, secrets: readonly string[] = [], depth = 0): unknown {
  if (typeof value === 'string') return redactText(value, secrets)
  if (value === null || typeof value !== 'object') return value
  // deeper than any real SOAP body: refuse to carry it
  if (depth > MAX_REDACTION_DEPTH) return REDACTED

  if (Array.isArray(value)) {
    let changed = false
    const items = value.map((item: unknown) => {
      const next = redactEchoedCredentials(item, secrets, depth + 1)
      if (next !== item) changed = true
      return next
    })
    return changed ? items : value
  }

  let changed = false
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    const item = (value as Raw)[key]
    const next = CREDENTIAL_KEYS.has(key.toLowerCase()) ? REDACTED : redactEchoedCredentials(item, secrets, depth + 1)
    if (next !== item) changed = true
    // always an own property, even for a key such as `__proto__`
    Object.defineProperty(out, key, { value: next, enumerable: true, writable: true, configurable: true })
  }
  return changed ? out : value
}

function redactText(text: string, secrets: readonly string[]): string {
  let result = text
  for (const secret of secrets) {
    if (secret === '') continue
    if (result === secret) return REDACTED
    if (secret.length >= MIN_SUBSTRING_SECRET && result.includes(secret)) result = result.split(secret).join(REDACTED)
  }
  return result
}

/** An own text of the bank, trimmed and cut; text that is empty and every other kind read as null. */
function text(data: unknown, key: string, limit: number): string | null {
  const value = ownValue(isRecord(data) ? data : {}, key)
  if (typeof value !== 'string') return null
  const trimmed = phpTrim(value)

  return trimmed === '' ? null : trimmed.slice(0, limit)
}

/** An own string field of a BIN record: at most 64 characters, else null. */
function itemText(data: Raw, key: string): string | null {
  const value = ownValue(data, key)
  if (typeof value !== 'string') return null
  const trimmed = phpTrim(value)

  return trimmed === '' || trimmed.length > ITEM_TEXT_LIMIT ? null : trimmed
}

/** The records of a data set element: one record is decoded as a record, several as a list. Non-records are dropped. */
function records(value: unknown): Raw[] {
  if (isRecord(value)) return [value]
  if (Array.isArray(value)) return value.filter(isRecord)

  return []
}

/** The rows of the data set of an answer, wherever the bank put the table `table` (single row or list). */
function dataSetRows(result: Raw | null, table: string): Raw[] {
  const data = child(child(child(result, 'DT_Bilgi'), 'diffgr:diffgram'), 'NewDataSet')

  return records(data === null ? undefined : ownValue(data, table))
}

/**
 * Normalizes the answers of the Param query service (installment rates, BIN list, history). A result code counts only
 * when it is the integer text (or number) of at most nine digits, positive means success; anything else is a decline.
 * Values that are not the expected kind (lists, records, malformed numbers) read as absent and are dropped, with a
 * log line that names the field and never its value; they never become "[object Object]". An answer that cannot be
 * read maps to a declined result, never to an error. History lists records only: whatever its result says, it is a
 * report, not a confirmation of any payment. A credential the bank echoes in an answer is returned as `***`.
 */
export class ParamPosQueryResponseDataMapper extends AbstractQueryResponseDataMapper {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'ParamPos'
  }

  override mapInstallmentPricesResponse(_raw: Raw): InstallmentPricesResponse {
    throw new UnsupportedTransactionTypeError(`Query type [${QUERY_TYPE.INSTALLMENT_PRICES}] is not supported.`)
  }

  override mapInstallmentRatesResponse(raw: Raw): InstallmentRatesResponse {
    const result = this.getDefaultInstallmentRatesResponse()
    const rawResult = child(child(raw, 'TP_Ozel_Oran_SK_ListeResponse'), 'TP_Ozel_Oran_SK_ListeResult')
    const approved = this.isSuccess(rawResult)

    result.status = approved ? 'approved' : 'declined'
    result.error_message = approved ? null : text(rawResult, 'Sonuc_Str', TEXT_LIMIT)
    result.all = redactEchoedCredentials(raw)
    if (!approved) return result

    for (const row of dataSetRows(rawResult, 'DT_Ozel_Oranlar_SK')) {
      const rates = this.parseRates(row)
      if (rates.length === 0) continue

      result.installment_rates.push({
        bank_code: null,
        bank_name: null,
        card_prefix: null,
        card_type: null,
        card_class: null,
        card_family: this.valueMapper.mapCardFamilyName(text(row, 'Kredi_Karti_Banka', ITEM_TEXT_LIMIT)),
        rates,
      })
    }

    return result
  }

  override mapBinListResponse(raw: Raw): BinListResponse {
    const result = this.getDefaultBinListResponse()
    const rawResult = child(child(raw, 'BIN_SanalPosResponse'), 'BIN_SanalPosResult')
    const approved = this.isSuccess(rawResult)

    result.status = approved ? 'approved' : 'declined'
    result.error_message = approved ? null : text(rawResult, 'Sonuc_Str', TEXT_LIMIT)
    result.all = redactEchoedCredentials(raw)
    if (!approved) return result

    for (const row of dataSetRows(rawResult, 'Temp')) {
      result.bin_list.push({
        bin: itemText(row, 'BIN'),
        bank_code: itemText(row, 'Banka_Kodu'),
        bank_name: itemText(row, 'Kart_Banka'),
        card_type: this.valueMapper.mapCardType(itemText(row, 'Kart_Org')),
        card_class: this.valueMapper.mapCardClass(itemText(row, 'Kart_Tip')),
        card_family: null,
      })
    }

    return result
  }

  override mapHistoryResponse(raw: Raw): PosQueryHistoryResponse {
    const rawResult = child(child(raw, 'TP_Islem_IzlemeResponse'), 'TP_Islem_IzlemeResult')
    const code = ownCode(rawResult, 'Sonuc')
    const approved = code !== null && code > 0
    const procReturnCode = code === null ? null : String(code)

    // the newest record first: the bank lists the oldest first
    const transactions = approved
      ? dataSetRows(rawResult, 'Temp')
          .map((row) => this.mapHistoryTransaction(row))
          .reverse()
      : []

    return {
      proc_return_code: procReturnCode,
      error_code: approved ? null : procReturnCode,
      error_message: approved ? null : text(rawResult, 'Sonuc_Str', TEXT_LIMIT),
      status: approved ? 'approved' : 'declined',
      trans_count: transactions.length,
      transactions,
      all: redactEchoedCredentials(raw),
    }
  }

  /** The result code of an answer's result record is positive. */
  private isSuccess(rawResult: Raw | null): boolean {
    const code = ownCode(rawResult, 'Sonuc')

    return code !== null && code > 0
  }

  /**
   * The rates of one card program: `installment 2 … 12` from `MO_02` … `MO_12`. A negative rate marks an installment
   * count the program does not offer; a value that is not plain decimal text is dropped.
   */
  private parseRates(row: Raw): Array<{ installment: number; rate: number; constant: number }> {
    const rates: Array<{ installment: number; rate: number; constant: number }> = []
    RATE_KEYS.forEach((key, index) => {
      const value = ownValue(row, key)
      if (value === undefined || value === null) return
      if (typeof value !== 'string' || !STRICT_DECIMAL.test(value)) {
        this.logger.warn('Installment rate dropped: unexpected shape', { key })
        return
      }
      const rate = Number(value)
      if (rate < 0) return
      // `-0.0000` is zero, not minus zero
      rates.push({ installment: index + 2, rate: rate === 0 ? 0 : rate, constant: 0 })
    })

    return rates
  }

  private mapHistoryTransaction(row: Raw): Raw {
    const transaction = this.getDefaultHistoryTxResponse()
    const code = ownCode(row, 'Sonuc')
    const procReturnCode = code === null ? null : String(code)
    const approved = code !== null && code > 0
    const time = this.time(ownDisplay(row, 'Tarih'))

    transaction.proc_return_code = procReturnCode
    transaction.status = approved ? 'approved' : 'declined'
    transaction.transaction_type = this.transactionType(ownDisplay(row, 'Tip_Str'))

    if (approved) {
      const currency = ownDisplay(row, 'PB')
      transaction.currency = currency === null ? null : this.valueMapper.mapCurrency(currency, QUERY_TYPE.HISTORY)
      if (transaction.transaction_type === 'pay') {
        const amount = this.amount(ownDisplay(row, 'Tutar'), 'Tutar')
        transaction.first_amount = amount
        transaction.capture_amount = amount
        transaction.capture = true
        transaction.capture_time = time
      } else if (transaction.transaction_type === 'cancel' && this.isNegative(ownDisplay(row, 'Tutar'))) {
        // the cancelled sale's own amount is on its sale record; a cancel record names none
        transaction.refund_amount = transaction.first_amount
      }

      const refunded = this.amount(ownDisplay(row, 'Toplam_Iade_Tutar'), 'Toplam_Iade_Tutar')
      if (refunded !== null && refunded > 0) transaction.refund_amount = refunded
    } else {
      transaction.error_code = procReturnCode
      transaction.error_message = text(row, 'Sonuc_Str', TEXT_LIMIT)
    }

    transaction.order_id = ownDisplay(row, 'ORJ_ORDER_ID')
    transaction.payment_model = this.paymentModel(ownDisplay(row, 'Islem_Guvenlik'))
    transaction.transaction_time = time

    return transaction
  }

  /** A bank time; one that cannot be read is null (a warning names the field, never the value). */
  private time(value: string | null): Date | null {
    if (value === null) return null
    try {
      return this.valueFormatter.formatDateTime(value, QUERY_TYPE.HISTORY)
    } catch {
      this.logger.warn('bank timestamp could not be parsed', { field: 'transaction_time' })

      return null
    }
  }

  /** A display amount read from strict amount text; anything else is null. */
  private amount(value: string | null, field: string): number | null {
    if (value === null) return null
    try {
      return this.valueFormatter.formatAmount(value, QUERY_TYPE.HISTORY)
    } catch {
      this.logger.warn('bank amount could not be parsed', { field })

      return null
    }
  }

  private isNegative(value: string | null): boolean {
    return value !== null && STRICT_DECIMAL.test(value) && Number(value) < 0
  }

  /** A transaction type word the table does not know is no transaction type, never an error. */
  private transactionType(word: string | null): string | null {
    if (word === null) return null
    try {
      return this.valueMapper.mapTxType(word)
    } catch {
      return null
    }
  }

  private paymentModel(word: string | null): string | null {
    if (word === null) return null
    try {
      return this.valueMapper.mapSecureType(word, QUERY_TYPE.HISTORY)
    } catch {
      return null
    }
  }
}
