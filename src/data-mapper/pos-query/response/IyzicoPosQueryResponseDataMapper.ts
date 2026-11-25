import { iyzicoSignaturePrice } from '../../../crypt/iyzicoPrice.js'
import { MODEL, PAYMENT_STATUS, type PaymentModel, TX_TYPE } from '../../../PosInterface.js'
import { QUERY_TYPE } from '../../../pos-query/PosQueryInterface.js'
import { ownValue } from '../../../util/ownValue.js'
import { phpTrim } from '../../../util/phpTrim.js'
import { payTrPlainText } from '../../response/mapper/PayTrPosResponseDataMapper.js'
import { isRecord, ownScalar, ownText, type Raw } from '../../response/mapper/toslaResponseFields.js'
import { AbstractQueryResponseDataMapper } from './AbstractQueryResponseDataMapper.js'
import type {
  BinListResponse,
  InstallmentPricesResponse,
  PosQueryHistoryResponse,
} from './QueryResponseDataMapperInterface.js'

/** The only status word that means success. */
const SUCCESS = 'success'
/** Texts of the bank shown to the caller are cut to a printable length. */
const MESSAGE_LIMIT = 256
/** Names, codes and brands of a record stay short. */
const ITEM_TEXT_LIMIT = 64
const BANK_CODE_TEXT = /^\d{1,4}$/
const BIN_BANK_CODE_TEXT = /^\d{1,10}$/
const CARD_PREFIX_TEXT = /^(?:\d{6}|\d{8})$/
const ERROR_CODE_TEXT = /^[A-Za-z0-9_.-]{1,32}$/
const INSTALLMENT_TEXT = /^\d{1,2}$/
const MAX_INSTALLMENT = 12

/** An own text without control characters, trimmed and at most 64 characters; longer or non-text is null. */
function itemText(data: unknown, key: string): string | null {
  const text = payTrPlainText(data, key, Number.MAX_SAFE_INTEGER)
  if (text === null) return null
  const trimmed = phpTrim(text)

  return trimmed === '' || trimmed.length > ITEM_TEXT_LIMIT ? null : trimmed
}

/** An own safe non-negative integer (a number, never text) or null. */
function ownInteger(data: unknown, key: string): number | null {
  const value = isRecord(data) ? ownValue(data, key) : undefined

  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** An own error code (text or number) that is a short token, else null. */
function errorCode(data: unknown, key: string): string | null {
  const code = ownText(data, key)

  return code !== null && ERROR_CODE_TEXT.test(code) ? code : null
}

/**
 * Normalizes the answers of the iyzico query endpoints (history, installment prices, BIN lookup). An answer counts as a
 * success only when its own `status` is exactly `success`. Values that are not the expected kind (lists, records,
 * malformed numbers, overlong texts) read as null or are dropped, with a log line that names the field and never its
 * value; they never become "[object Object]". Amounts are read from the text they were written with, so they stay
 * exact. History lists records only: whatever its result says, it is a report and never a confirmation of a payment,
 * so its rows carry no authorization code, bank reference or transaction id. Installment rates are not offered.
 */
export class IyzicoPosQueryResponseDataMapper extends AbstractQueryResponseDataMapper {
  static override readonly PROCEDURE_SUCCESS_CODE: string = SUCCESS

  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'IyzicoPos'
  }

  override mapHistoryResponse(raw: Raw): PosQueryHistoryResponse {
    const answer: Raw = isRecord(raw) ? raw : {}
    const approved = this.isSuccess(answer)

    const list = approved ? ownValue(answer, 'transactions') : undefined
    const transactions = Array.isArray(list)
      ? list.filter(isRecord).map((row) => this.mapHistoryTransaction(row as Raw))
      : []

    return {
      proc_return_code: itemText(answer, 'status'),
      error_code: approved ? null : errorCode(answer, 'errorCode'),
      error_message: approved ? null : payTrPlainText(answer, 'errorMessage', MESSAGE_LIMIT),
      trans_count: transactions.length,
      transactions,
      current_page: ownInteger(answer, 'currentPage'),
      total_pages: ownInteger(answer, 'totalPageCount'),
      status: approved ? 'approved' : 'declined',
      all: raw,
    }
  }

  override mapBinListResponse(raw: Raw): BinListResponse {
    const answer: Raw = isRecord(raw) ? raw : {}
    const result = this.getDefaultBinListResponse()
    const approved = this.isSuccess(answer)

    result.status = approved ? 'approved' : 'declined'
    result.error_message = approved ? null : payTrPlainText(answer, 'errorMessage', MESSAGE_LIMIT)
    result.all = raw
    if (!approved) return result

    result.bin_list.push({
      bin: itemText(answer, 'binNumber'),
      bank_code: this.binBankCode(ownValue(answer, 'bankCode')),
      bank_name: itemText(answer, 'bankName'),
      card_type: this.valueMapper.mapCardType(itemText(answer, 'cardAssociation')),
      card_class: this.valueMapper.mapCardClass(itemText(answer, 'cardType')),
      card_family: this.valueMapper.mapCardFamilyName(itemText(answer, 'cardFamily')),
    })

    return result
  }

  override mapInstallmentPricesResponse(raw: Raw): InstallmentPricesResponse {
    const answer: Raw = isRecord(raw) ? raw : {}
    const result = this.getDefaultInstallmentPricesResponse()
    const approved = this.isSuccess(answer)

    result.status = approved ? 'approved' : 'declined'
    result.error_message = approved ? null : payTrPlainText(answer, 'errorMessage', MESSAGE_LIMIT)
    result.all = raw
    if (!approved) return result

    const details = ownValue(answer, 'installmentDetails')
    if (!Array.isArray(details)) return result

    for (const detail of details) {
      // entries that are not records carry nothing to map
      if (!isRecord(detail)) continue
      result.installment_prices.push({
        bank_code: this.bankCode(ownValue(detail as Raw, 'bankCode')),
        bank_name: itemText(detail, 'bankName'),
        card_prefix: this.cardPrefix(ownValue(detail as Raw, 'binNumber')),
        card_type: this.valueMapper.mapCardType(itemText(detail, 'cardAssociation')),
        card_class: this.valueMapper.mapCardClass(itemText(detail, 'cardType')),
        card_family: this.valueMapper.mapCardFamilyName(itemText(detail, 'cardFamilyName')),
        prices: this.parsePrices(ownValue(detail as Raw, 'installmentPrices')),
      })
    }

    return result
  }

  /** The own status is exactly the word `success`. */
  private isSuccess(answer: Raw): boolean {
    return ownValue(answer, 'status') === SUCCESS
  }

  /** The bank code of an installment group: a whole number or digit text of at most four digits, as a number. */
  private bankCode(value: unknown): number | null {
    if (typeof value === 'string') return BANK_CODE_TEXT.test(value) ? Number(value) : null
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 9999) return value

    return null
  }

  /** The bank code of a BIN record as text: a whole number or digit text (a leading zero of text is kept). */
  private binBankCode(value: unknown): string | null {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null

    return typeof value === 'string' && BIN_BANK_CODE_TEXT.test(value) ? value : null
  }

  private cardPrefix(value: unknown): string | null {
    return typeof value === 'string' && CARD_PREFIX_TEXT.test(value) ? value : null
  }

  /** The installment plans of one group, sorted by installment count; malformed entries are dropped. */
  private parsePrices(
    value: unknown,
  ): Array<{ installment: number; installment_price: number; total_price: number | null }> {
    const prices: Array<{ installment: number; installment_price: number; total_price: number | null }> = []
    if (!Array.isArray(value)) return prices

    for (const entry of value) {
      if (!isRecord(entry)) continue
      const installment = this.installmentNumber(ownValue(entry as Raw, 'installmentNumber'))
      const installmentPrice = this.amount(ownValue(entry as Raw, 'installmentPrice'))
      const totalPrice = this.amount(ownValue(entry as Raw, 'totalPrice'))
      if (installment === null || installmentPrice === null || totalPrice === null) {
        this.logger.warn('Installment price dropped: unexpected shape')
        continue
      }
      prices.push({ installment, installment_price: installmentPrice, total_price: totalPrice })
    }

    return prices.sort((a, b) => a.installment - b.installment)
  }

  /** An installment count from 1 to 12, as a number or digit text. */
  private installmentNumber(value: unknown): number | null {
    let count: number
    if (typeof value === 'number') count = value
    else if (typeof value === 'string' && INSTALLMENT_TEXT.test(value)) count = Number(value)
    else return null

    return Number.isSafeInteger(count) && count >= 1 && count <= MAX_INSTALLMENT ? count : null
  }

  /** A display amount read from the text it was written with (eight decimals at most); anything else is null. */
  private amount(value: unknown): number | null {
    const text = iyzicoSignaturePrice(value)

    return text === null ? null : Number(text)
  }

  private mapHistoryTransaction(row: Raw): Record<string, unknown> {
    const type = itemText(row, 'transactionType')
    const transactionType = type === null ? null : this.transactionType(type)
    const status = ownScalar(row, 'transactionStatus')

    const transaction = this.getDefaultHistoryTxResponse()
    transaction.transaction_type = transactionType

    let approved = true
    if (transactionType === TX_TYPE.PAY_AUTH) {
      // 1 and 2 are the states of a taken payment; the number's own type is required
      approved = status === 1 || status === 2
      transaction.capture = approved
      transaction.capture_amount = this.displayAmount(row, 'paidPrice')
    }
    transaction.status = approved ? 'approved' : 'declined'
    transaction.payment_model = this.paymentModel(row)
    transaction.first_amount = this.displayAmount(row, 'price')
    const currency = itemText(row, 'transactionCurrency')
    transaction.currency = currency === null ? null : this.valueMapper.mapCurrency(currency, QUERY_TYPE.HISTORY)
    transaction.transaction_time = this.time(ownText(row, 'transactionDate'))
    transaction.installment_count = this.installmentCount(ownText(row, 'installment'))

    if (!approved) {
      transaction.order_status = PAYMENT_STATUS.ERROR
    } else if (transactionType === TX_TYPE.PAY_AUTH) {
      transaction.order_status = PAYMENT_STATUS.PAYMENT_COMPLETED
    } else if (transactionType === TX_TYPE.CANCEL) {
      transaction.order_status = PAYMENT_STATUS.CANCELED
    } else if (transactionType === TX_TYPE.REFUND) {
      transaction.order_status = PAYMENT_STATUS.FULLY_REFUNDED
    }

    return transaction
  }

  /** A transaction type word the table does not know is no transaction type, never an error. */
  private transactionType(word: string): string | null {
    try {
      return this.valueMapper.mapTxType(word)
    } catch {
      return null
    }
  }

  /** `threeDS` is `null` for a regular payment, `0`/`false` regular, `1`/`true` 3D Secure; other values map to null. */
  private paymentModel(row: Raw): PaymentModel | null {
    if (!Object.hasOwn(row, 'threeDS')) return null
    const value = row.threeDS
    if (value === null) return MODEL.NON_SECURE
    if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
      return this.valueMapper.mapSecureType(value, QUERY_TYPE.HISTORY)
    }

    return null
  }

  private displayAmount(row: Raw, key: string): number | null {
    if (!Object.hasOwn(row, key) || row[key] === null || row[key] === undefined) return null
    const amount = this.amount(row[key])
    if (amount === null) {
      this.logger.warn('bank amount could not be parsed', { field: key })
    }

    return amount
  }

  /** A bank time; one that cannot be read is null (the warning names the field, never the value). */
  private time(value: string | null): Date | null {
    if (value === null) return null
    try {
      return this.valueFormatter.formatDateTime(value, QUERY_TYPE.HISTORY)
    } catch {
      this.logger.warn('bank timestamp could not be parsed', { field: 'transaction_time' })

      return null
    }
  }

  private installmentCount(value: string | null): number | null {
    return value !== null && INSTALLMENT_TEXT.test(value)
      ? this.valueFormatter.formatInstallment(value, QUERY_TYPE.HISTORY)
      : null
  }
}
