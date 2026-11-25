import type { IyzicoPosCrypt, IyzicoSignedAnswer } from '../crypt/IyzicoPosCrypt.js'
import { iyzicoAnswerKurus, iyzicoSignaturePrice } from '../crypt/iyzicoPrice.js'
import { iyzicoOrderCurrency, iyzicoOrderId } from '../data-mapper/request/mapper/iyzicoOrderFields.js'
import { IyzicoPosRequestValueMapper } from '../data-mapper/request/value-mapper/IyzicoPosRequestValueMapper.js'
import { TX_APPROVED, TX_DECLINED } from '../data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { IyzicoPosResponseValueMapper } from '../data-mapper/response/value-mapper/IyzicoPosResponseValueMapper.js'
import { HashMismatchError, OrderMismatchError, type OrderMismatchField, PosError, PosHttpError } from '../errors.js'
import type { IyzicoPosAccount } from '../model/account/IyzicoPosAccount.js'
import type { PaymentModel, TxType } from '../PosInterface.js'
import type { PosOrder, PosResponse } from '../types.js'
import { phpTrim } from '../util/phpTrim.js'

/**
 * Checks of the iyzico gateway for what comes back from the bank: the browser's 3D Secure callback and the answers
 * of the payment API. Each function decides one thing on own, exact values and either returns or throws; the gateway
 * composes them. Nothing here logs: callback and answer bodies hold card digits and signatures.
 *
 * The 3D Secure callback is signed over `conversationData:conversationId:mdStatus:paymentId:status`. A signed
 * callback is bound to the order before anything else; it can only lead to a payment when its status is exactly
 * `success`, its 3D status exactly `1` and its payment id plain digits. An unsigned callback can only ever be a
 * decline built from the order (the bank signs every callback it sends, so an unsigned body that reads as an approval
 * is a forgery or a broken integration and is refused).
 *
 * After a money request (3D Secure authorization, non-secure payment, capture, cancel, refund) the answer decides
 * whether money moved, so anything other than an exact `success` or `failure` is an unknown outcome, never a decline
 * (a decline invites a retry that could charge twice). An approval must carry a valid answer signature and is then
 * bound to the order: conversation id, basket id, payment id, amounts, currency and phase.
 */

/** Order ids: a letter or digit first, then letters, digits, `_` and `-`, at most 64 (no colon can occur). */
const ORDER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** iyzico payment ids: plain positive integers, at most 20 digits. */
const PAYMENT_ID = /^[1-9]\d{0,19}$/

/** A decline code as kept in a result. */
const CODE = /^[A-Za-z0-9_-]{1,16}$/

/** A 3D status as kept in a decline: one digit. */
const MD_STATUS = /^\d$/

/** A callback status word as kept in a decline. */
const STATUS_WORD = /^[a-z_]{1,16}$/

/** A 3D status that reads as success once padding and leading zeros are ignored. */
const LOOSE_MD_SUCCESS = /^0*1$/

/**
 * Characters never kept in a bank text: C0 and C1 controls, line and paragraph separators, bidi marks, embeddings,
 * overrides and isolates.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to find control characters
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g

/** A surrogate half without its partner. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** The callback words of a 3D Secure approval. */
const CALLBACK_SUCCESS = 'success'
const MD_SUCCESS = '1'

/** The two answer verdicts. */
const ANSWER_SUCCESS = 'success'
const ANSWER_FAILURE = 'failure'

/** The checkout form state of a completed payment. */
const CHECKOUT_SUCCESS = 'SUCCESS'

/** The longest bank text kept in a decline result. */
export const MAX_TEXT_LENGTH = 256

/** Bank and callback values are untrusted; only this much of one is echoed in errors. */
export const MAX_ECHOED_LENGTH = 64

const UNKNOWN_OUTCOME = 'Bank answer carries no result; the payment outcome is unknown'
const UNVERIFIABLE = 'Bank answer signature could not be verified; the payment outcome is unknown'

const REQUEST_VALUE_MAPPER = new IyzicoPosRequestValueMapper()
const RESPONSE_VALUE_MAPPER = new IyzicoPosResponseValueMapper()

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A plain record: an object literal or a record without a prototype (never a list, map, URLSearchParams or class). */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

declare const SIGNED: unique symbol

/**
 * A bank answer whose signature {@link requireSignedAnswer} verified. Only such an answer can be bound to an order,
 * turned into an approved result or raise a review flag, so an unverified answer cannot approve anything by mistake:
 * the compiler refuses it.
 */
export type SignedIyzicoAnswer = Record<string, unknown> & { readonly [SIGNED]: true }

/** An own value; inherited members read as absent. */
function own(data: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(data, key) ? data[key] : undefined
}

/** An own string; anything else reads as undefined. */
function ownString(data: Record<string, unknown>, key: string): string | undefined {
  const value = own(data, key)
  return typeof value === 'string' ? value : undefined
}

/** An own iyzico payment id as text: a digit string or a positive safe integer; anything else is null. */
function ownPaymentId(data: Record<string, unknown>): string | null {
  const value = own(data, 'paymentId')
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  return typeof value === 'string' && PAYMENT_ID.test(value) ? value : null
}

/** A value for an error message: plain text of strings and finite numbers, at most 64 characters. */
function echo(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, MAX_ECHOED_LENGTH)
  return iyzicoPlainText(value, MAX_ECHOED_LENGTH) ?? ''
}

/** An amount in kuruş as decimal text (`10000` → `100.00`). */
function kurusText(kurus: number): string {
  return `${Math.trunc(kurus / 100)}.${String(kurus % 100).padStart(2, '0')}`
}

/** An answer price for an error message: its signature text when it has one, else the echoed value. */
function priceText(value: unknown): string {
  return iyzicoSignaturePrice(value) ?? echo(value)
}

/**
 * Bank text as bounded plain text: control characters, line separators and bidi controls removed, at most `max`
 * characters without splitting a surrogate pair. Anything that is not a string, or nothing left, is null.
 */
export function iyzicoPlainText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  let plain = value.replace(CONTROL_CHARACTERS, '').replace(LONE_SURROGATE, '').slice(0, max)
  // a cut right after the first half of a surrogate pair would leave a lone surrogate
  if (/[\uD800-\uDBFF]$/.test(plain)) plain = plain.slice(0, -1)

  return plain === '' ? null : plain
}

/** A bank code as kept in a result: a short token (string or safe integer); anything else is null. */
export function iyzicoCode(value: unknown): string | null {
  let text: string | null = null
  if (typeof value === 'string') text = value
  else if (typeof value === 'number' && Number.isSafeInteger(value)) text = String(value)

  return text !== null && CODE.test(text) ? text : null
}

/**
 * The callback as it must arrive: a plain record whose own fields are all plain string values. A list or record (form
 * parsers with nested keys), a number, null, a function or a getter could be read differently by the signature check
 * and the decision, so it is refused before anything is read; so is any object other than a plain record (a map,
 * `URLSearchParams`, a class instance), whose fields would be read differently. Returns a copy without a prototype.
 *
 * @throws PosError
 */
export function assertFlatIyzicoCallback(body: unknown): Record<string, string> {
  if (!isPlainRecord(body)) {
    throw new PosError('3D callback data must be a record')
  }
  const flat: Record<string, string> = Object.create(null) as Record<string, string>
  // own property names include non-enumerable ones, which a spread or `Object.entries` would skip
  for (const key of Object.getOwnPropertyNames(body)) {
    const descriptor = Object.getOwnPropertyDescriptor(body, key)
    if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string') {
      throw new PosError(`3D callback field "${echo(key)}" must be a string`)
    }
    Object.defineProperty(flat, key, { value: descriptor.value, enumerable: true, writable: true, configurable: true })
  }

  return flat
}

/** Whether the callback carries a signature to verify (an own, non-empty `signature`). */
export function callbackHasSignature(body: Record<string, string>): boolean {
  const signature = ownString(body, 'signature')
  return signature !== undefined && signature !== ''
}

/**
 * Whether an unsigned callback reads as an approval, padding, case and leading zeros ignored: a status of `success`
 * or a 3D status of `1`. iyzico signs every callback it sends, so such a body is a forgery or a broken integration;
 * the gateway refuses it instead of mapping it.
 */
export function unsignedCallbackReadsAsApproval(body: Record<string, string>): boolean {
  const status = ownString(body, 'status')
  const mdStatus = ownString(body, 'mdStatus')

  return (
    (status !== undefined && phpTrim(status).toLowerCase() === CALLBACK_SUCCESS) ||
    (mdStatus !== undefined && LOOSE_MD_SUCCESS.test(phpTrim(mdStatus)))
  )
}

/**
 * Binds a signed callback to the order before anything else is read from it: its own `conversationId` must be the
 * order id. A genuine callback of another order says nothing about this one, so no response is attached and no
 * payment is presumed.
 *
 * @throws OrderMismatchError
 */
export function assertCallbackOrder(body: Record<string, string>, orderId: string): void {
  const conversationId = ownString(body, 'conversationId')
  if (conversationId !== orderId) {
    throw new OrderMismatchError('order_id', orderId, echo(conversationId))
  }
}

/** Whether a signed callback reports a 3D Secure approval: status exactly `success` and 3D status exactly `1`. */
export function signedCallbackApproves(body: Record<string, string>): boolean {
  return ownString(body, 'status') === CALLBACK_SUCCESS && ownString(body, 'mdStatus') === MD_SUCCESS
}

/**
 * The payment id of a signed approval of the order, after pinning the signed fields that decide it. The signature joins its fields
 * with colons and any text verifies, so a signed text with extra colons can be read with other field boundaries;
 * with the status, 3D status, conversation id and payment id all colon-free, only the reading that puts every extra
 * colon into the conversation data can pass, and that is the bank's own reading.
 *
 * @throws HashMismatchError when any pinned field is not in its exact form
 */
export function assertCallbackApprovalPins(body: Record<string, string>, orderId: string): string {
  const conversationId = ownString(body, 'conversationId')
  const paymentId = ownString(body, 'paymentId')
  if (
    !signedCallbackApproves(body) ||
    conversationId !== orderId ||
    !ORDER_ID.test(conversationId) ||
    paymentId === undefined ||
    !PAYMENT_ID.test(paymentId)
  ) {
    throw new HashMismatchError('3D callback fields are malformed')
  }

  return paymentId
}

/**
 * The result of a callback that is not an approval (an unsigned one, or a signed decline): the order's id, the call's
 * transaction type and payment model from `base`, the 3D status when it is one digit and the status word when it is
 * a short lower-case word. Nothing else of the body is kept (only `3d_all` holds it): no amount, payment id,
 * reference, code or manual review flag, since a decline moves no money and an unsigned body proves nothing.
 *
 * @throws PosError when `base` is not a decline or the order has no valid id
 */
export function trustedDecline(base: PosResponse, order: PosOrder, body: Record<string, string>): PosResponse {
  if (base.status !== TX_DECLINED) {
    throw new PosError('3D callback without approval was mapped as approved')
  }
  const mdStatus = ownString(body, 'mdStatus')
  const status = ownString(body, 'status')

  return {
    order_id: iyzicoOrderId(order),
    transaction_id: null,
    transaction_time: null,
    transaction_type: base.transaction_type,
    installment_count: null,
    currency: null,
    amount: null,
    payment_model: base.payment_model,
    auth_code: null,
    ref_ret_num: null,
    batch_num: null,
    proc_return_code: status !== undefined && STATUS_WORD.test(status) ? status : null,
    status: TX_DECLINED,
    error_code: null,
    error_message: null,
    all: null,
    md_status: mdStatus !== undefined && MD_STATUS.test(mdStatus) ? mdStatus : null,
    md_error_message: null,
    transaction_security: null,
    '3d_all': body,
  }
}

/**
 * The verdict of an answer to a money request: its own `status` exactly `success` or `failure`. Anything else (no
 * status, another word or case, padding, another type, an empty or non-record answer) leaves it open whether money
 * moved: the caller must check the payment with a status or history query before any retry.
 *
 * @throws PosHttpError
 */
export function answerOutcome(answer: unknown, url: string): 'success' | 'failure' {
  const status = isRecord(answer) ? ownString(answer, 'status') : undefined
  if (status === ANSWER_SUCCESS || status === ANSWER_FAILURE) return status

  throw new PosHttpError(UNKNOWN_OUTCOME, { url })
}

/**
 * Requires a valid signature on a `success` answer. After a money request an approval that cannot be verified is an
 * unknown outcome, not a mismatch: money may have moved, and a "hash mismatch" would read as "nothing happened". For
 * a read-only answer (`readOnly`) it is a plain signature mismatch.
 *
 * @throws PosHttpError, or HashMismatchError when `readOnly`
 */
export function requireSignedAnswer(
  crypt: IyzicoPosCrypt,
  account: IyzicoPosAccount,
  answer: Record<string, unknown>,
  kind: IyzicoSignedAnswer,
  url: string,
  readOnly = false,
): asserts answer is SignedIyzicoAnswer {
  if (isRecord(answer) && crypt.checkResponseSignature(account, answer, kind)) return
  if (readOnly) throw new HashMismatchError('Bank answer signature mismatch')

  throw new PosHttpError(UNVERIFIABLE, { url })
}

/**
 * The result of a `failure` answer: the mapped decline with the order's id, the bank code when it is a short token,
 * the bank text as bounded plain text, and no amount, currency or installment count. No manual review flag: the
 * bank says the payment failed.
 *
 * @throws PosError when the mapper did not map the answer as declined
 */
export function declinedFromAnswer(mapped: PosResponse, orderId: string, answer: Record<string, unknown>): PosResponse {
  if (mapped.status !== TX_DECLINED) {
    throw new PosError('A failed bank answer was mapped as approved')
  }
  const { requires_manual_review: _review, ...rest } = mapped
  const data = isRecord(answer) ? answer : {}

  return {
    ...rest,
    order_id: orderId,
    status: TX_DECLINED,
    error_code: iyzicoCode(own(data, 'errorCode')),
    error_message: iyzicoPlainText(own(data, 'errorMessage'), MAX_TEXT_LENGTH),
    amount: null,
    currency: null,
    installment_count: null,
  }
}

/** What a signed payment answer must show for this order. */
export interface IyzicoPaymentExpectation {
  orderId: string
  /** The payment id the request named; absent for a new non-secure payment (any iyzico payment id then). */
  paymentId?: string
  /** The order amount in kuruş. */
  kurus: number
  /**
   * `equal`: basket and charged amount both equal the order amount. `atLeast`: the basket equals it and the payer
   * may be charged more (installment fees on the hosted page). `ignorePrice`: only the charged amount is bound (a
   * capture answer prints the pre-authorized basket as its price).
   */
  paidPriceRule: 'equal' | 'atLeast' | 'ignorePrice'
  /** The order currency. */
  currency: string
  phase: 'AUTH' | 'PRE_AUTH' | 'POST_AUTH'
}

function mismatch(field: OrderMismatchField, expected: string, actual: unknown, response?: PosResponse): never {
  throw new OrderMismatchError(field, expected, echo(actual), response)
}

function bindIds(
  answer: Record<string, unknown>,
  orderId: string,
  paymentId: string | undefined,
  withBasket: boolean,
  approvedResult: PosResponse,
): void {
  const conversationId = own(answer, 'conversationId')
  if (conversationId !== orderId) mismatch('order_id', orderId, conversationId, approvedResult)
  if (withBasket) {
    const basketId = own(answer, 'basketId')
    if (basketId !== orderId) mismatch('order_id', orderId, basketId, approvedResult)
  }
  const answered = ownPaymentId(answer)
  if (answered === null || (paymentId !== undefined && answered !== paymentId)) {
    mismatch('transaction_id', paymentId ?? 'an iyzico payment id', own(answer, 'paymentId'), approvedResult)
  }
}

function bindCurrency(answer: Record<string, unknown>, currency: string, approvedResult: PosResponse): void {
  const answered = ownString(answer, 'currency')
  if (answered === undefined || RESPONSE_VALUE_MAPPER.mapCurrency(answered) !== currency) {
    mismatch('currency', currency, own(answer, 'currency'), approvedResult)
  }
}

function bindAmount(
  answer: Record<string, unknown>,
  key: 'price' | 'paidPrice',
  kurus: number,
  atLeast: boolean,
  approvedResult: PosResponse,
): void {
  const value = own(answer, key)
  const answered = iyzicoAnswerKurus(value)
  if (answered === null || (atLeast ? answered < kurus : answered !== kurus)) {
    throw new OrderMismatchError('amount', kurusText(kurus), priceText(value), approvedResult)
  }
}

/**
 * Binds a signed payment approval to the order: conversation id and basket id are the order id, the payment id is
 * the one the request named, the currency maps to the order currency, the amounts (signature text rounded to eight
 * decimals, then whole kuruş, exactly) fit the order amount, and the phase is the one requested. Call it only after
 * the answer signature verified: the request was sent for this order, so a mismatch carries `approvedResult` and
 * means money may have moved.
 *
 * @throws OrderMismatchError
 */
export function bindPaymentAnswer(
  answer: SignedIyzicoAnswer,
  expected: IyzicoPaymentExpectation,
  approvedResult: PosResponse,
): void {
  bindIds(answer, expected.orderId, expected.paymentId, true, approvedResult)
  bindCurrency(answer, expected.currency, approvedResult)
  if (expected.paidPriceRule !== 'ignorePrice') {
    bindAmount(answer, 'price', expected.kurus, false, approvedResult)
  }
  bindAmount(answer, 'paidPrice', expected.kurus, expected.paidPriceRule === 'atLeast', approvedResult)
  const phase = own(answer, 'phase')
  if (phase !== expected.phase) mismatch('transaction_type', expected.phase, phase, approvedResult)
}

/**
 * Binds a signed refund approval: conversation id, payment id, currency and the refunded amount in kuruş.
 *
 * @throws OrderMismatchError
 */
export function bindRefundAnswer(
  answer: SignedIyzicoAnswer,
  expected: { orderId: string; paymentId: string; kurus: number; currency: string },
  approvedResult: PosResponse,
): void {
  bindIds(answer, expected.orderId, expected.paymentId, false, approvedResult)
  bindCurrency(answer, expected.currency, approvedResult)
  bindAmount(answer, 'price', expected.kurus, false, approvedResult)
}

/**
 * Binds a cancel approval (cancel answers carry no signature): the conversation id and the payment id, each when the
 * answer prints it, must be the order's.
 *
 * @throws OrderMismatchError
 */
export function bindCancelAnswer(
  answer: Record<string, unknown>,
  expected: { orderId: string; paymentId: string },
  approvedResult: PosResponse,
): void {
  const conversationId = own(answer, 'conversationId')
  if (conversationId !== undefined && conversationId !== expected.orderId) {
    mismatch('order_id', expected.orderId, conversationId, approvedResult)
  }
  if (own(answer, 'paymentId') !== undefined && ownPaymentId(answer) !== expected.paymentId) {
    mismatch('transaction_id', expected.paymentId, own(answer, 'paymentId'), approvedResult)
  }
}

/**
 * Binds a signed checkout form record to this checkout: the token sent, and the order id as basket and conversation
 * id. The token comes from the unsigned browser callback, so a signed record of another checkout (another basket,
 * another token) is no evidence about this order: nothing is attached and no payment is presumed.
 *
 * @throws OrderMismatchError
 */
export function bindCheckoutRecord(answer: SignedIyzicoAnswer, expected: { orderId: string; token: string }): void {
  const token = own(answer, 'token')
  if (token !== expected.token) mismatch('order_id', expected.token, token)
  for (const key of ['basketId', 'conversationId']) {
    const value = own(answer, key)
    if (value !== expected.orderId) mismatch('order_id', expected.orderId, value)
  }
}

/** Whether a checkout form record shows a completed payment (`paymentStatus` exactly `SUCCESS`). */
export function checkoutPaymentCompleted(answer: SignedIyzicoAnswer): boolean {
  return own(answer, 'paymentStatus') === CHECKOUT_SUCCESS
}

/**
 * Whether a signed, bound approval must be held for manual review. iyzico's fraud check answers `1` (approved), `0`
 * (in review: iyzico decides later, goods must not ship yet) or `-1` (rejected); anything but `1` means the card was
 * charged or held while the payment is not cleared. When `checkMdStatus` is set, a 3D status that is present and not
 * `1` contradicts the approval (the bank charged although 3D Secure did not succeed); an absent one does not.
 */
export function reviewFlags(answer: SignedIyzicoAnswer, checkMdStatus = true): { manualReview: boolean } {
  const fraudStatus = own(answer, 'fraudStatus')
  let manualReview = fraudStatus !== 1 && fraudStatus !== '1'
  if (checkMdStatus) {
    const mdStatus = own(answer, 'mdStatus')
    if (mdStatus !== undefined && mdStatus !== 1 && mdStatus !== MD_SUCCESS) manualReview = true
  }

  return { manualReview }
}

/**
 * An approved result held for review: declined, with `requires_manual_review`, everything else kept.
 *
 * @throws PosError when the result is not an approval
 */
export function heldForReview(approved: PosResponse): PosResponse {
  if (approved.status !== TX_APPROVED) {
    throw new PosError('Only an approved result can be held for review')
  }

  return { ...approved, status: TX_DECLINED, requires_manual_review: true }
}

/**
 * The result of a signed approval, built from the order and signed values: the order's id and currency, the signed
 * charged amount (it may exceed the order amount on the hosted page), the signed payment id, and the call's payment
 * model and transaction type. Card digits, authorization code and references stay as the mapper read them (display
 * only).
 *
 * @throws PosError when the mapper did not map the answer as approved, or the order is invalid
 */
export function approvedFromAnswer(
  mapped: PosResponse,
  order: PosOrder,
  answer: SignedIyzicoAnswer,
  paymentModel: PaymentModel,
  txType: TxType,
): PosResponse {
  if (mapped.status !== TX_APPROVED) {
    throw new PosError('A successful bank answer was not mapped as approved')
  }
  const data = isRecord(answer) ? answer : {}
  const paid = iyzicoAnswerKurus(own(data, 'paidPrice'))

  return {
    ...mapped,
    order_id: iyzicoOrderId(order),
    currency: iyzicoOrderCurrency(order, REQUEST_VALUE_MAPPER),
    amount: paid === null ? null : paid / 100,
    transaction_id: ownPaymentId(data),
    payment_model: paymentModel,
    transaction_type: txType,
  }
}
