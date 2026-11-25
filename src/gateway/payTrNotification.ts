import { payTrPlainText } from '../data-mapper/response/mapper/PayTrPosResponseDataMapper.js'
import { TX_APPROVED, TX_DECLINED } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { HashMismatchError, PosError } from '../errors.js'
import type { PaymentModel, TxType } from '../PosInterface.js'
import type { PosResponse } from '../types.js'
import { ORDER_ID_PATTERN } from '../util/orderId.js'
import { phpTrim } from '../util/phpTrim.js'

/**
 * Helpers of the PayTR gateway for the bodies its payment flows receive: the server-to-server notification (signed
 * with `hash`) and the browser's return to the merchant's fail page (unsigned, `fail_message` only).
 */

/** The signed total of an approval: a positive whole number of kuruş, without padding. */
const KURUS = /^[1-9]\d{0,14}$/

/** A total amount that reads as a payment once blanks and leading zeros are ignored. */
const LOOSE_KURUS = /^\s*0*[1-9]\d*\s*$/

/** The unsigned payment amount of a notification: whole kuruş. */
const PAYMENT_AMOUNT = /^\d{1,15}$/

/** An installment count as PayTR writes it. */
const INSTALLMENT_TEXT = /^\d{1,2}$/

/** A decline reason code: a short token. */
const REASON_CODE = /^[A-Za-z0-9_-]{1,16}$/

/** The status word of an approved notification. */
export const NOTIFICATION_SUCCESS = 'success'

/** The longest decline reason or failure text kept. */
export const MAX_TEXT_LENGTH = 256

/** Body keys and values are attacker controlled; only this much of one is echoed in errors and logs. */
export const MAX_ECHOED_LENGTH = 64

/** An own string value; anything else (absent, inherited, another type) is undefined. */
export function ownText(data: Record<string, unknown>, key: string): string | undefined {
  const value: unknown = Object.hasOwn(data, key) ? data[key] : undefined
  return typeof value === 'string' ? value : undefined
}

/** A value shortened for logs and errors. */
export function echo(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_ECHOED_LENGTH) : ''
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * The body as it must arrive: a plain record whose own values are all strings. Any other value (a list or record
 * from a form parser with nested keys, a number, null, undefined) could be read differently by the signature check
 * and the mapper, so it is refused before anything is read.
 *
 * @throws PosError
 */
export function flatNotification(body: unknown): Record<string, string> {
  if (!isPlainRecord(body)) {
    throw new PosError('3D callback data must be a record')
  }
  // own property names include non-enumerable ones, which a spread or `Object.entries` would skip
  for (const key of Object.getOwnPropertyNames(body)) {
    if (typeof body[key] !== 'string') {
      throw new PosError(`3D callback field "${key.slice(0, MAX_ECHOED_LENGTH)}" must be a string`)
    }
  }

  return body as Record<string, string>
}

/**
 * The order id a notification names, as a lookup key only: it is not verified. Load the order by it, then hand the
 * order and the body to `payment()`, which verifies the signature and binds the notification to that order.
 *
 * @throws PosError when the body has no own `merchant_oid` in the order id format
 */
export function notificationOrderId(body: unknown): string {
  const orderId = isPlainRecord(body) ? ownText(body, 'merchant_oid') : undefined
  if (orderId === undefined || !ORDER_ID_PATTERN.test(orderId)) {
    throw new PosError('Notification carries no valid merchant_oid')
  }

  return orderId
}

/**
 * Whether an unsigned body reads as an approval, padding and case ignored: a status of `success` or a positive
 * total amount. The browser never receives a result, so such a body is a forgery attempt or a misrouted
 * notification without its signature.
 */
export function readsAsApproval(body: Record<string, string>): boolean {
  const status = ownText(body, 'status')
  const total = ownText(body, 'total_amount')

  return (
    (status !== undefined && phpTrim(status).toLowerCase() === NOTIFICATION_SUCCESS) ||
    (total !== undefined && LOOSE_KURUS.test(total))
  )
}

/**
 * The result of an unsigned browser return: the order's id, the call's transaction type and payment model, and the
 * fail page's text as bounded plain text. No other value of the body is kept (only `all` holds the raw body), and it
 * never carries an amount, a code, a reference or a manual review flag.
 */
export function trustedBrowserDecline(
  body: Record<string, string>,
  orderId: string,
  txType: TxType,
  paymentModel: PaymentModel,
): PosResponse {
  return {
    order_id: orderId,
    transaction_id: null,
    transaction_time: null,
    transaction_type: txType,
    installment_count: null,
    currency: null,
    amount: null,
    payment_model: paymentModel,
    auth_code: null,
    ref_ret_num: null,
    batch_num: null,
    proc_return_code: null,
    status: TX_DECLINED,
    error_code: null,
    error_message: null,
    all: body,
    md_status: null,
    md_error_message: payTrPlainText(body, 'fail_message', MAX_TEXT_LENGTH),
    transaction_security: null,
  }
}

/**
 * A verified notification of this order that is not an approval: the mapped decline with the order's id, the
 * failure code when it is a short token, the failure text as bounded plain text, and no amount, currency,
 * installment count or time. Decline texts are free form, so nothing else is checked.
 *
 * @throws PosError when the mapper did not map it as declined (it would skip every approval check)
 */
export function signedDecline(mapped: PosResponse, body: Record<string, string>, orderId: string): PosResponse {
  if (mapped.status !== TX_DECLINED) {
    throw new PosError('3D callback without approval was mapped as approved')
  }
  const code = ownText(body, 'failed_reason_code')

  return {
    ...mapped,
    order_id: orderId,
    error_code: code !== undefined && REASON_CODE.test(code) ? code : null,
    error_message: payTrPlainText(body, 'failed_reason_msg', MAX_TEXT_LENGTH),
    amount: null,
    currency: null,
    installment_count: null,
    transaction_time: null,
  }
}

/**
 * The signed total of an approval in kuruş. The signed values run together without separators, so the total must be
 * digits only and the status exactly `success`: no character can then move between them.
 *
 * @throws HashMismatchError when the total is not a positive whole number without padding
 */
export function signedTotalKurus(body: Record<string, string>): number {
  const total = ownText(body, 'total_amount')
  if (total === undefined || !KURUS.test(total)) {
    throw new HashMismatchError('3D callback fields are malformed')
  }

  return Number(total)
}

/**
 * Whether the charged total fits the order amount (both in kuruş): equal for a single payment; for an installment
 * plan it may be higher, since the payer may pick a plan that carries a fee.
 */
export function totalAmountAccepted(total: number, kurus: number, installment: number): boolean {
  return installment > 1 ? total >= kurus : total === kurus
}

/** Whether the unsigned payment amount (whole kuruş) equals the order amount in kuruş. */
export function paymentAmountMatches(text: string, kurus: number): boolean {
  return PAYMENT_AMOUNT.test(text) && Number(text) === kurus
}

/**
 * The approved result of a verified notification: the order's id and currency, the signed total as the amount (it
 * may exceed the order amount by an installment fee), the mapped installment count only when the body's count is
 * one or two digits, and the call's payment model and transaction type.
 *
 * @throws PosError when the mapper did not map the approval as approved
 */
export function approvedNotificationResult(
  mapped: PosResponse,
  body: Record<string, string>,
  orderId: string,
  currency: string,
  total: number,
  paymentModel: PaymentModel,
  txType: TxType,
): PosResponse {
  if (mapped.status !== TX_APPROVED) {
    throw new PosError('Verified approval was not mapped as approved')
  }
  const installment = ownText(body, 'installment_count')
  const mappedInstallment: unknown = mapped.installment_count

  return {
    ...mapped,
    order_id: orderId,
    currency,
    amount: total / 100,
    installment_count:
      installment !== undefined && INSTALLMENT_TEXT.test(installment) && typeof mappedInstallment === 'number'
        ? mappedInstallment
        : null,
    payment_model: paymentModel,
    transaction_type: txType,
  }
}
