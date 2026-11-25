import { PosError } from '../../../errors.js'
import type { IyzicoPosAccount } from '../../../model/account/IyzicoPosAccount.js'
import { ownValue } from '../../../util/ownValue.js'
import { parseOrderAmount } from '../../../util/parseOrderAmount.js'
import { toKurus } from '../../../util/toKurus.js'
import { isRecord } from '../../request/mapper/paramRequestFields.js'
import { AbstractQueryRequestDataMapper } from './AbstractQueryRequestDataMapper.js'

/** A card number prefix: six or eight digits. */
const BIN_PATTERN = /^(?:\d{6}|\d{8})$/
const MAX_PAGE = 10_000

/** The caller's input as a record; anything else is a `PosError` instead of a `TypeError` further down. */
function input(data: unknown): Record<string, unknown> {
  if (!isRecord(data)) {
    throw new PosError('The query data must be an object.')
  }

  return data
}

/** A 6- or 8-digit BIN given as text or as a whole number, or null when it is absent. Anything else is refused. */
function optionalBin(params: Record<string, unknown>): string | null {
  const bin = ownValue(params, 'bin')
  if (bin === undefined || bin === null) return null
  const valid = typeof bin === 'string' || (typeof bin === 'number' && Number.isSafeInteger(bin))
  if (!valid || !BIN_PATTERN.test(String(bin))) {
    throw new PosError('BIN must have 6 or 8 digits')
  }

  return String(bin)
}

/**
 * Builds the iyzico query requests. The client signs every request at send time, from the exact bytes it sends, so a
 * hook may change any field of the prepared data and the request is still signed correctly. A history query goes out
 * as a GET whose data is the query string; the other queries are JSON bodies.
 */
export class IyzicoPosQueryRequestDataMapper extends AbstractQueryRequestDataMapper<IyzicoPosAccount> {
  static supports(gatewayClass: string): boolean {
    return gatewayClass === 'IyzicoPos'
  }

  /** The caller's body goes out as given; the client signs it. */
  override createCustomQueryRequestData(
    _account: IyzicoPosAccount,
    requestData: Record<string, unknown>,
  ): Record<string, unknown> {
    return requestData
  }

  /** The payments of one day (Türkiye time), one page at a time. */
  override createHistoryRequestData(
    _account: IyzicoPosAccount,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const params = input(data)
    const day = ownValue(params, 'transaction_date')
    if (!(day instanceof Date) || Number.isNaN(day.getTime())) {
      throw new PosError('History query field "transaction_date" must be a valid Date')
    }
    const page = ownValue(params, 'page')
    if (
      page !== undefined &&
      page !== null &&
      !(Number.isSafeInteger(page) && (page as number) >= 1 && (page as number) <= MAX_PAGE)
    ) {
      throw new PosError(`History query page must be a whole number from 1 to ${MAX_PAGE}`)
    }

    return {
      locale: this.lang(params),
      transactionDate: this.valueFormatter.formatDateTime(day, 'transactionDate'),
      page: page ?? 1,
    }
  }

  override createBinListRequestData(
    _account: IyzicoPosAccount,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const query = input(params)
    const bin = optionalBin(query)
    if (bin === null) {
      throw new PosError('BIN must have 6 or 8 digits')
    }

    return {
      locale: this.lang(query),
      conversationId: this.crypt.generateRandomString(),
      binNumber: bin,
    }
  }

  /** The price is whole kuruş divided by 100, so its JSON text is the amount that was asked for. */
  override createInstallmentPricesRequestData(
    _account: IyzicoPosAccount,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const query = input(params)
    const amount = parseOrderAmount(ownValue(query, 'amount'))
    if (Number.isNaN(amount)) {
      throw new PosError('Installment prices need an amount')
    }
    const price = toKurus(amount) / 100
    const bin = optionalBin(query)

    const requestData: Record<string, unknown> = {
      locale: this.lang(query),
      conversationId: this.crypt.generateRandomString(),
      price,
    }
    if (bin !== null) requestData.binNumber = bin

    return requestData
  }

  /** The language of the caller's own `lang` field, else the default. */
  private lang(params: Record<string, unknown>): string {
    return this.getLang({ lang: ownValue(params, 'lang') })
  }
}
