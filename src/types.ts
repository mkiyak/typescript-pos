import type { Currency, Lang, PaymentModel, TxType } from './PosInterface.js'

export type PosOrder = Record<string, unknown> & {
  id?: string
  amount?: number
  currency?: Currency
  installment?: number
  success_url?: string
  fail_url?: string
  ip?: string
  lang?: Lang
  transaction_id?: string
  ref_ret_num?: string
  auth_code?: string
  pre_auth_amount?: number
  order_type?: string
}

/** Callback POST body sent back by the bank. */
export type GatewayResponseData = Record<string, string | undefined>

export type PosResponse = Record<string, unknown> & {
  status: 'approved' | 'declined'
  order_id: string | null
  proc_return_code: string | null
  error_code: string | null
  error_message: string | null
  /** `true` when the bank may have moved money although the response is declined: review it manually. */
  requires_manual_review?: boolean
  all: unknown
}

export type ThreeDFormData = {
  gateway: string
  method: 'POST' | 'GET'
  inputs: Record<string, string>
}

/**
 * `requestData` (a structured clone of the mapped request) is
 * mutable: change it in place or replace it. `order` is a frozen shallow copy, so hooks cannot modify the caller's
 * order object (writes throw in strict mode).
 */
export interface RequestDataPreparedEvent {
  requestData: Record<string, unknown>
  readonly bankName: string
  readonly txType: TxType
  readonly gatewayClass: string
  readonly order: PosOrder
  readonly paymentModel: PaymentModel
}

/** `formInputs` is mutable. */
export interface Before3DFormHashCalculatedEvent {
  formInputs: Record<string, string>
  readonly bankName: string
  readonly txType: TxType
  readonly paymentModel: PaymentModel
  readonly gatewayClass: string
}

export interface PosHooks {
  onRequestDataPrepared?: Array<(e: RequestDataPreparedEvent) => void | Promise<void>>
  onBefore3DFormHashCalculated?: Array<(e: Before3DFormHashCalculatedEvent) => void | Promise<void>>
}
