import type { CardType } from '../../../PosInterface.js'

export type QueryStatus = 'approved' | 'declined'

export type PosQueryHistoryResponse = Record<string, unknown> & {
  status: QueryStatus
  error_message: string | null
  all: unknown
}

interface CardInfo {
  bank_code: number | null
  bank_name: string | null
  card_prefix: string | null
  card_type: CardType | null
  card_class: string | null
  card_family: string | null
}

export type InstallmentRatesResponse = {
  status: QueryStatus
  error_message: string | null
  installment_rates: Array<CardInfo & { rates: Array<{ installment: number; rate: number; constant: number }> }>
  all: unknown
}

export type InstallmentPricesResponse = {
  status: QueryStatus
  error_message: string | null
  installment_prices: Array<
    CardInfo & { prices: Array<{ installment: number; installment_price: number; total_price: number | null }> }
  >
  all: unknown
}

export type BinListResponse = {
  status: QueryStatus
  error_message: string | null
  bin_list: Array<{
    bin: string | null
    bank_code: string | null
    bank_name: string | null
    card_type: CardType | null
    card_class: string | null
    card_family: string | null
  }>
  all: unknown
}

/** Turns raw bank answers of the non-payment queries into normalized, snake_case results. */
export interface QueryResponseDataMapperInterface {
  mapHistoryResponse(raw: Record<string, unknown>): PosQueryHistoryResponse
  mapInstallmentRatesResponse(raw: Record<string, unknown>): InstallmentRatesResponse
  mapInstallmentPricesResponse(raw: Record<string, unknown>): InstallmentPricesResponse
  mapBinListResponse(raw: Record<string, unknown>): BinListResponse
}
