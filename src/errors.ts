import type { PosResponse } from './types.js'
import { maskSensitiveData } from './util/maskSensitiveData.js'

export class PosError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
  }
}

export class HashMismatchError extends PosError {}
export class UnsupportedPaymentModelError extends PosError {}
export class UnsupportedTransactionTypeError extends PosError {}
export class UnsupportedFormFormatError extends PosError {}
export class MissingAccountInfoError extends PosError {}
export class CardTypeRequiredError extends PosError {}
export class CardTypeNotSupportedError extends PosError {}
export class GatewayClassNotConfiguredError extends PosError {}
export class NotImplementedError extends PosError {}
/** Invalid card input, e.g. an expiry month or year that is not a valid date. */
export class InvalidCardError extends PosError {}

/** Callback field that did not match the order / account. */
export type OrderMismatchField =
  | 'order_id'
  | 'amount'
  | 'currency'
  | 'merchant_id'
  | 'storetype'
  | 'transaction_id'
  | 'transaction_type'
  | 'terminal_id'
  | 'payment_model'

export class OrderMismatchError extends PosError {
  readonly field: OrderMismatchField
  readonly expected: string
  readonly actual: string
  /**
   * The response mapped from the callback (hash-verified when hash verification is enabled), when one exists, so
   * merchants can inspect `transaction_id`, `proc_return_code` and `requires_manual_review` when money may have
   * moved. The raw bank data in `all` is masked (card numbers, passwords and keys never reach logs).
   */
  readonly response?: PosResponse
  /**
   * `true` when the bank reported the callback as a completed payment (`status === 'approved'` or
   * `proc_return_code === '00'`), or when the mapped response is already flagged `requires_manual_review` (the host
   * approved although the API declined), although it does not belong to this order: the card may have been charged.
   * Alert, then void or refund it. `response.requires_manual_review` is also `true` in that case.
   * Always `false` when no response is attached.
   */
  readonly paymentMayHaveCompleted: boolean

  constructor(field: OrderMismatchField, expected: string, actual: string, response?: PosResponse) {
    super(`Callback ${field} mismatch: expected "${expected}", got "${actual}"`)
    this.field = field
    this.expected = expected
    this.actual = actual
    this.paymentMayHaveCompleted =
      response !== undefined &&
      (response.status === 'approved' || response.proc_return_code === '00' || response.requires_manual_review === true)
    if (response !== undefined) {
      this.response = { ...response, all: maskSensitiveData(response.all) }
      if (this.paymentMayHaveCompleted) this.response.requires_manual_review = true
    }
  }
}

export interface PosHttpErrorInfo {
  url: string
  status?: number
  body?: string
}

const SNIPPET_MAX = 500

export class PosHttpError extends PosError {
  readonly status?: number
  readonly url: string
  readonly bodySnippet?: string

  constructor(message: string, info: PosHttpErrorInfo, options?: ErrorOptions) {
    super(message, options)
    this.url = info.url
    if (info.status !== undefined) this.status = info.status
    if (info.body !== undefined) this.bodySnippet = maskSensitiveData(info.body).slice(0, SNIPPET_MAX)
  }
}
