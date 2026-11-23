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

/** Callback field that did not match the order / account. */
export type OrderMismatchField = 'order_id' | 'amount' | 'currency' | 'merchant_id'

export class OrderMismatchError extends PosError {
  readonly field: OrderMismatchField
  readonly expected: string
  readonly actual: string

  constructor(field: OrderMismatchField, expected: string, actual: string) {
    super(`Callback ${field} mismatch: expected "${expected}", got "${actual}"`)
    this.field = field
    this.expected = expected
    this.actual = actual
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
