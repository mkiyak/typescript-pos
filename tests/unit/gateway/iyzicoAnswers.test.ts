import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IYZICO_SIGNED_FIELDS, IyzicoPosCrypt, type IyzicoSignedAnswer } from '../../../src/crypt/IyzicoPosCrypt.js'
import { iyzicoSignaturePrice } from '../../../src/crypt/iyzicoPrice.js'
import { IyzicoPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/IyzicoPosResponseDataMapper.js'
import { IyzicoPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/IyzicoPosResponseValueFormatter.js'
import { IyzicoPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/IyzicoPosResponseValueMapper.js'
import { HashMismatchError, OrderMismatchError, PosError, PosHttpError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import {
  answerOutcome,
  approvedFromAnswer,
  assertCallbackApprovalPins,
  assertCallbackOrder,
  assertFlatIyzicoCallback,
  bindCancelAnswer,
  bindCheckoutRecord,
  bindPaymentAnswer,
  bindRefundAnswer,
  callbackHasSignature,
  checkoutPaymentCompleted,
  declinedFromAnswer,
  heldForReview,
  type IyzicoPaymentExpectation,
  iyzicoCode,
  iyzicoPlainText,
  requireSignedAnswer,
  reviewFlags,
  type SignedIyzicoAnswer,
  signedCallbackApproves,
  trustedDecline,
  unsignedCallbackReadsAsApproval,
} from '../../../src/gateway/iyzicoAnswers.js'
import type { PosLogger } from '../../../src/logger.js'
import type { PosOrder, PosResponse } from '../../../src/types.js'

// addition: the iyzico callback and bank answer checks the gateway composes (flat callback, unsigned callbacks only
// decline, approval pins, unknown outcomes after money requests, answer signatures, binding to the order, fraud and
// 3D review flags, bounded decline texts, results built from the order and signed values only)

type MockLogger = { [K in keyof PosLogger]: ReturnType<typeof vi.fn> }

const SECRET = 'sandbox-secretKey'
const IA = AccountFactory.createIyzicoPosAccount('iyzico', 'sandbox-apiKey', SECRET)
const URL_AUTH = 'https://sandbox-api.iyzipay.com/payment/v2/3dsecure/auth'
const ORDER: PosOrder = { id: 'order-001', amount: 100, currency: 'TRY', installment: 0 }
const KURUS = 10000

const HX = (msg: string, key: string = SECRET): string => createHmac('sha256', key).update(msg, 'utf8').digest('hex')

/** Signs an answer over the field list of its kind, prices written as the signature writes them. */
function signed(answer: Record<string, unknown>, kind: IyzicoSignedAnswer = 'payment'): SignedIyzicoAnswer {
  const parts = IYZICO_SIGNED_FIELDS[kind].map((name) => {
    const value = answer[name]
    if (name === 'price' || name === 'paidPrice') return iyzicoSignaturePrice(value) ?? 'x'
    return String(value)
  })
  return asSigned({ ...answer, signature: HX(parts.join(':')) })
}

/** Marks an edited signed fixture as verified for the compiler (the code under test still reads it as given). */
function asSigned(answer: Record<string, unknown>): SignedIyzicoAnswer {
  return answer as SignedIyzicoAnswer
}

/** P4: the 3D Secure authorization answer of order-001, payment 1001, 100 TRY. */
const P4_UNSIGNED: Record<string, unknown> = {
  status: 'success',
  locale: 'tr',
  systemTime: 1781209771102,
  conversationId: 'order-001',
  price: 100,
  paidPrice: 100,
  installment: 1,
  paymentId: '1001',
  fraudStatus: 1,
  mdStatus: 1,
  phase: 'AUTH',
  basketId: 'order-001',
  currency: 'TRY',
  authCode: '123456',
  hostReference: 'host-ref',
  binNumber: '460345',
  lastFourDigits: '0000',
}
const P4 = signed(P4_UNSIGNED)

/** CF2: the checkout form record of order-001, token tok-123 (110 charged for a 100 basket). */
const CF2 = signed(
  {
    status: 'success',
    paymentStatus: 'SUCCESS',
    paymentId: '1001',
    currency: 'TRY',
    basketId: 'order-001',
    conversationId: 'order-001',
    paidPrice: 110,
    price: 100,
    token: 'tok-123',
    fraudStatus: 1,
    mdStatus: 1,
    phase: 'AUTH',
  },
  'checkoutFormRetrieve',
)

/** CB3: the signed 3D Secure callback of order-001, payment 1001. */
const CB3: Record<string, string> = {
  conversationId: 'order-001',
  mdStatus: '1',
  paymentId: '1001',
  status: 'success',
  signature: '45b616fbe1dc2f78d796505551d4c4bbaf7ada9cfa6fc960b668a3a000ead074',
}

const EXPECT_3DS: IyzicoPaymentExpectation = {
  orderId: 'order-001',
  paymentId: '1001',
  kurus: KURUS,
  paidPriceRule: 'equal',
  currency: 'TRY',
  phase: 'AUTH',
}

let logger: MockLogger
let crypt: IyzicoPosCrypt
let mapper: IyzicoPosResponseDataMapper

beforeEach(() => {
  logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  crypt = new IyzicoPosCrypt(logger as unknown as PosLogger)
  mapper = new IyzicoPosResponseDataMapper(
    new IyzicoPosResponseValueFormatter(),
    new IyzicoPosResponseValueMapper(),
    logger as unknown as PosLogger,
  )
})

function approvedResult(answer: SignedIyzicoAnswer = P4): PosResponse {
  return approvedFromAnswer(mapper.mapPaymentResponse(answer, 'pay', ORDER), ORDER, answer, '3d', 'pay')
}

function catchError(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error('expected an error')
}

describe('vectors', () => {
  it('the test signatures are the planning vectors', () => {
    expect(P4.signature).toBe('f1689a8ed87fb7dda212cffaf08d2415e8a13f7b7a8a7fc499297582febfde30')
    expect(CF2.signature).toBe('0073309e4f8c2ae874d5a805470c020753ca4b3db071fa3a558e07549158636a')
    expect(HX(':order-001:1:1001:success')).toBe(CB3.signature)
    expect(crypt.check3DHash(IA, CB3)).toBe(true)
  })
})

describe('iyzicoPlainText', () => {
  it('removes control characters, line separators and bidi controls and keeps at most the limit', () => {
    const noisy = `${'a\u0000b\u0007\n\r\t\u2028\u2029\u202E\u2066\u200F\u061C\u0085c'.repeat(15)}${'z'.repeat(150)}`
    expect(noisy.length).toBeGreaterThan(300)
    const plain = iyzicoPlainText(noisy, 256) as string
    expect(plain.length).toBeLessThanOrEqual(256)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to find control characters
    expect(plain).not.toMatch(/[\x00-\x1F\x7F-\x9F\u2028\u2029\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/)
    expect(plain.startsWith('abcabc')).toBe(true)
  })

  it('never splits a surrogate pair and drops lone surrogates', () => {
    expect(iyzicoPlainText(`${'a'.repeat(255)}😀`, 256)).toBe('a'.repeat(255))
    expect(iyzicoPlainText(`${'a'.repeat(254)}😀`, 256)).toBe(`${'a'.repeat(254)}😀`)
    expect(iyzicoPlainText('a\uD800b\uDC00c', 256)).toBe('abc')
  })

  it.each<[unknown]>([[''], ['\u0000\n\u2028'], [null], [undefined], [5062], [['x']], [{}]])(
    '%j has no plain text',
    (value) => {
      expect(iyzicoPlainText(value, 256)).toBeNull()
    },
  )
})

describe('iyzicoCode', () => {
  it.each<[unknown, string | null]>([
    ['5062', '5062'],
    [5062, '5062'],
    ['ERR_1-a', 'ERR_1-a'],
    ['a'.repeat(16), 'a'.repeat(16)],
    ['10 000', null],
    ['a'.repeat(17), null],
    ['', null],
    ['50\n62', null],
    [1.5, null],
    [2 ** 53, null],
    [null, null],
    [['5062'], null],
    [{}, null],
  ])('%j reads as %j', (value, expected) => {
    expect(iyzicoCode(value)).toBe(expected)
  })
})

describe('assertFlatIyzicoCallback', () => {
  it('returns a copy of the own string fields', () => {
    const flat = assertFlatIyzicoCallback({ ...CB3 })
    expect(flat).toEqual(CB3)
    expect(Object.getPrototypeOf(flat)).toBeNull()
  })

  it.each<[string, unknown]>([
    ['a list value', { status: ['x'] }],
    ['a nested record', { conversationId: 'order-001', status: { 0: 'success' } }],
    ['an empty nested record', { status: {} }],
    ['a function', { status: () => 'success' }],
    ['a number', { mdStatus: 1 }],
    ['a boolean', { mdStatus: true }],
    ['null', { status: null }],
    ['undefined', { status: undefined }],
    ['an own __proto__ record', JSON.parse('{"__proto__":{"status":"success"},"status":"failure"}')],
  ])('refuses %s', (_name, body) => {
    expect(() => assertFlatIyzicoCallback(body)).toThrow(PosError)
  })

  it.each<[unknown]>([[null], [undefined], ['status=success'], [['success']], [1]])('refuses %j as a body', (body) => {
    expect(() => assertFlatIyzicoCallback(body)).toThrow('3D callback data must be a record')
  })

  it('refuses a getter: it could read differently for the signature and the decision', () => {
    let reads = 0
    const body = { conversationId: 'order-001' }
    Object.defineProperty(body, 'status', {
      enumerable: true,
      get: () => (++reads > 1 ? 'success' : 'failure'),
    })
    expect(() => assertFlatIyzicoCallback(body)).toThrow(PosError)
  })

  it('checks non-enumerable own fields too', () => {
    const body = { conversationId: 'order-001' }
    Object.defineProperty(body, 'status', { enumerable: false, value: ['success'] })
    expect(() => assertFlatIyzicoCallback(body)).toThrow(PosError)
  })

  it('accepts a record without a prototype', () => {
    const body = Object.create(null) as Record<string, unknown>
    body.conversationId = 'order-001'
    expect(assertFlatIyzicoCallback(body)).toEqual({ conversationId: 'order-001' })
  })

  class Body {
    conversationId = 'order-001'
  }

  it.each<[string, unknown]>([
    ['an object with another prototype', Object.create({ status: 'success', mdStatus: '1' })],
    ['URLSearchParams', new URLSearchParams('status=success&mdStatus=1')],
    ['a Map', new Map([['status', 'success']])],
    ['a class instance', new Body()],
    ['a Date', new Date()],
  ])('refuses %s: only plain records are callback bodies', (_name, body) => {
    expect(() => assertFlatIyzicoCallback(body)).toThrow(new PosError('3D callback data must be a record'))
  })

  it('keeps an own __proto__ string as data', () => {
    const flat = assertFlatIyzicoCallback(JSON.parse('{"__proto__":"x","status":"failure"}'))
    expect(Object.hasOwn(flat, '__proto__')).toBe(true)
    expect(flat.status).toBe('failure')
  })
})

describe('callbackHasSignature', () => {
  it.each<[Record<string, string>, boolean]>([
    [CB3, true],
    [{ signature: 'x' }, true],
    [{ signature: '' }, false],
    [{}, false],
  ])('%j → %s', (body, expected) => {
    expect(callbackHasSignature(body)).toBe(expected)
  })

  it('an inherited signature does not count', () => {
    expect(callbackHasSignature(Object.create({ signature: 'abc' }))).toBe(false)
  })
})

describe('unsignedCallbackReadsAsApproval', () => {
  it.each<[Record<string, string>]>([
    [{ status: 'success' }],
    [{ status: ' SUCCESS ' }],
    [{ status: 'Success\n' }],
    [{ mdStatus: '1' }],
    [{ mdStatus: ' 1' }],
    // deviation: T2 the plan reads only a trimmed '1'; leading zeros count too (only more unsigned bodies refused)
    [{ mdStatus: '01' }],
    [{ status: 'failure', mdStatus: '1' }],
    [{ status: 'success', mdStatus: '0' }],
  ])('%j reads as an approval', (body) => {
    expect(unsignedCallbackReadsAsApproval(body)).toBe(true)
  })

  it.each<[Record<string, string>]>([
    [{ status: 'failure', mdStatus: '0' }],
    [{ status: 'failure' }],
    [{ mdStatus: '0' }],
    [{ mdStatus: '2' }],
    [{ mdStatus: '10' }],
    [{}],
    [{ status: 'successful' }],
  ])('%j does not', (body) => {
    expect(unsignedCallbackReadsAsApproval(body)).toBe(false)
  })
})

describe('assertCallbackOrder', () => {
  it('passes the callback of the order', () => {
    expect(() => assertCallbackOrder(CB3, 'order-001')).not.toThrow()
  })

  it.each<[Record<string, string>, string]>([
    [{ ...CB3, conversationId: 'order-002' }, 'order-002'],
    [{ ...CB3, conversationId: ' order-001' }, ' order-001'],
    [{ ...CB3, conversationId: 'order-001:x' }, 'order-001:x'],
    [{ mdStatus: '1' }, ''],
  ])('%j is another order, without a response', (body, actual) => {
    const error = catchError(() => assertCallbackOrder(body, 'order-001')) as OrderMismatchError
    expect(error).toBeInstanceOf(OrderMismatchError)
    expect(error.field).toBe('order_id')
    expect(error.expected).toBe('order-001')
    expect(error.actual).toBe(actual)
    expect(error.response).toBeUndefined()
    expect(error.paymentMayHaveCompleted).toBe(false)
  })

  it('echoes at most 64 characters of a foreign id', () => {
    const error = catchError(() =>
      assertCallbackOrder({ conversationId: 'x'.repeat(300) }, 'order-001'),
    ) as OrderMismatchError
    expect(error.actual).toHaveLength(64)
  })
})

describe('signedCallbackApproves', () => {
  it.each<[Record<string, string>, boolean]>([
    [CB3, true],
    [{ ...CB3, status: 'failure' }, false],
    [{ ...CB3, mdStatus: '0' }, false],
    [{ ...CB3, status: ' success' }, false],
    [{ ...CB3, status: 'SUCCESS' }, false],
    [{ ...CB3, mdStatus: ' 1' }, false],
    [{ ...CB3, mdStatus: '01' }, false],
    [{ conversationId: 'order-001' }, false],
  ])('%j → %s', (body, expected) => {
    expect(signedCallbackApproves(body)).toBe(expected)
  })
})

describe('assertCallbackApprovalPins', () => {
  it('returns the signed payment id of an approval', () => {
    expect(assertCallbackApprovalPins(CB3, 'order-001')).toBe('1001')
    expect(assertCallbackApprovalPins({ ...CB3, paymentId: '9'.repeat(20) }, 'order-001')).toBe('9'.repeat(20))
  })

  it.each<[string, Record<string, string>]>([
    ['pay-1', { ...CB3, paymentId: 'pay-1' }],
    ['0', { ...CB3, paymentId: '0' }],
    ['a leading zero', { ...CB3, paymentId: '01001' }],
    ['21 digits', { ...CB3, paymentId: '1'.repeat(21) }],
    ['an empty id', { ...CB3, paymentId: '' }],
    ['no id', { conversationId: 'order-001', mdStatus: '1', status: 'success' }],
    ['a padded id', { ...CB3, paymentId: ' 1001' }],
    ['a colon in the id', { ...CB3, paymentId: '1001:1' }],
    ['a status other than success', { ...CB3, status: 'failure' }],
    ['a 3D status other than 1', { ...CB3, mdStatus: '0' }],
    ['a conversation id with a colon', { ...CB3, conversationId: 'order-001:1' }],
    ['no conversation id', { mdStatus: '1', paymentId: '1001', status: 'success' }],
    ['the conversation id of another order', { ...CB3, conversationId: 'order-002' }],
  ])('refuses %s', (_name, body) => {
    expect(() => assertCallbackApprovalPins(body, 'order-001')).toThrow(
      new HashMismatchError('3D callback fields are malformed'),
    )
  })
})

describe('trustedDecline', () => {
  const unsigned = { status: 'failure', mdStatus: '0', conversationId: 'other', paymentId: '999', errorCode: '1' }

  it('keeps the order id and only bounded decline words', () => {
    const base = mapper.map3DPaymentData(unsigned, null, 'pay', ORDER)
    const result = trustedDecline(base, ORDER, unsigned)
    expect(result).toEqual({
      order_id: 'order-001',
      transaction_id: null,
      transaction_time: null,
      transaction_type: 'pay',
      installment_count: null,
      currency: null,
      amount: null,
      payment_model: '3d',
      auth_code: null,
      ref_ret_num: null,
      batch_num: null,
      proc_return_code: 'failure',
      status: 'declined',
      error_code: null,
      error_message: null,
      all: null,
      md_status: '0',
      md_error_message: null,
      transaction_security: null,
      '3d_all': unsigned,
    })
    expect(result).not.toHaveProperty('requires_manual_review')
  })

  it.each<[Record<string, string>, string | null, string | null]>([
    [{ status: 'FAIL URE', mdStatus: '00' }, null, null],
    [{ status: 'x'.repeat(17), mdStatus: '9' }, null, '9'],
    [{ status: 'failure_x', mdStatus: '' }, 'failure_x', null],
    [{}, null, null],
  ])('%j keeps proc_return_code %j and md_status %j', (body, procReturnCode, mdStatus) => {
    const result = trustedDecline(mapper.map3DPaymentData(body, null, 'pay', ORDER), ORDER, body)
    expect(result.proc_return_code).toBe(procReturnCode)
    expect(result.md_status).toBe(mdStatus)
    expect(result.order_id).toBe('order-001')
  })

  it('refuses a base that is not a decline', () => {
    const base = { ...mapper.map3DPaymentData(unsigned, null, 'pay', ORDER), status: 'approved' } as PosResponse
    expect(() => trustedDecline(base, ORDER, unsigned)).toThrow(PosError)
  })

  it('refuses an order without a valid id', () => {
    const base = mapper.map3DPaymentData(unsigned, null, 'pay', ORDER)
    expect(() => trustedDecline(base, { ...ORDER, id: 'a b' }, unsigned)).toThrow(PosError)
  })

  it('never copies a manual review flag from the base', () => {
    const base = { ...mapper.map3DPaymentData(unsigned, null, 'pay', ORDER), requires_manual_review: true }
    expect(trustedDecline(base, ORDER, unsigned)).not.toHaveProperty('requires_manual_review')
  })
})

describe('answerOutcome', () => {
  it.each<[unknown]>([
    [{}],
    [{ status: 'SUCCESS' }],
    [{ status: ' success' }],
    [{ status: 'success ' }],
    [{ status: 1 }],
    [{ status: 'x' }],
    [{ status: ['success'] }],
    [{ status: null }],
    [Object.create({ status: 'success' })],
    [null],
    [undefined],
    [''],
    ['<html>WAF</html>'],
    [[{ status: 'success' }]],
  ])('%j is an unknown outcome', (answer) => {
    const error = catchError(() => answerOutcome(answer, URL_AUTH)) as PosHttpError
    expect(error).toBeInstanceOf(PosHttpError)
    expect(error.message).toBe('Bank answer carries no result; the payment outcome is unknown')
    expect(error.url).toBe(URL_AUTH)
  })

  it.each<[string]>([['success'], ['failure']])('%s is a result', (status) => {
    expect(answerOutcome({ status }, URL_AUTH)).toBe(status)
  })
})

describe('requireSignedAnswer', () => {
  it('accepts a signed answer', () => {
    expect(() => requireSignedAnswer(crypt, IA, P4, 'payment', URL_AUTH)).not.toThrow()
  })

  it('reads prices as the signature writes them', () => {
    expect(() =>
      requireSignedAnswer(crypt, IA, { ...P4, price: '100.00', paidPrice: '100.0' }, 'payment', URL_AUTH),
    ).not.toThrow()
    expect(() =>
      requireSignedAnswer(crypt, IA, { ...P4, price: 100.000000001, paidPrice: 99.999999999 }, 'payment', URL_AUTH),
    ).not.toThrow()
  })

  it.each<[string, Record<string, unknown>]>([
    ['no signature', { ...P4, signature: undefined }],
    ['a wrong signature', { ...P4, signature: HX('1001:TRY:order-001:order-001:100:101') }],
    ['a changed amount', { ...P4, paidPrice: 100.01 }],
    ['a changed basket id', { ...P4, basketId: 'order-002' }],
    ['a signature of another kind', signed(P4_UNSIGNED, 'refund')],
    ['a list as the price', { ...P4, price: [100] }],
  ])('%s after a money request is an unknown outcome', (_name, answer) => {
    const error = catchError(() => requireSignedAnswer(crypt, IA, answer, 'payment', URL_AUTH)) as PosHttpError
    expect(error).toBeInstanceOf(PosHttpError)
    expect(error.message).toBe('Bank answer signature could not be verified; the payment outcome is unknown')
    expect(error.url).toBe(URL_AUTH)
  })

  it('a read-only answer with a wrong signature is a mismatch', () => {
    expect(() => requireSignedAnswer(crypt, IA, { ...P4, paidPrice: 1 }, 'payment', URL_AUTH, true)).toThrow(
      new HashMismatchError('Bank answer signature mismatch'),
    )
  })

  it('never logs the signature or the secret key', () => {
    expect(() => requireSignedAnswer(crypt, IA, { ...P4, paidPrice: 1 }, 'payment', URL_AUTH)).toThrow(PosHttpError)
    const logged = JSON.stringify([logger.debug.mock.calls, logger.error.mock.calls, logger.warn.mock.calls])
    expect(logged).not.toContain(SECRET)
    expect(logged).not.toContain(P4.signature)
  })
})

describe('bindPaymentAnswer', () => {
  it('passes the answer of the order', () => {
    expect(() => bindPaymentAnswer(P4, EXPECT_3DS, approvedResult())).not.toThrow()
  })

  it.each<[string, Record<string, unknown>, string, string, string]>([
    ['conversation id', { conversationId: 'order-002' }, 'order_id', 'order-001', 'order-002'],
    ['missing conversation id', { conversationId: undefined }, 'order_id', 'order-001', ''],
    ['basket id', { basketId: 'order-002' }, 'order_id', 'order-001', 'order-002'],
    ['basket id with a colon', { basketId: 'order-001:x' }, 'order_id', 'order-001', 'order-001:x'],
    ['payment id', { paymentId: '1002' }, 'transaction_id', '1001', '1002'],
    ['payment id as a number', { paymentId: 1002 }, 'transaction_id', '1001', '1002'],
    ['missing payment id', { paymentId: undefined }, 'transaction_id', '1001', ''],
    ['currency', { currency: 'USD' }, 'currency', 'TRY', 'USD'],
    ['lower-case currency', { currency: 'try' }, 'currency', 'TRY', 'try'],
    ['numeric currency', { currency: 949 }, 'currency', 'TRY', '949'],
    ['price', { price: 99.99 }, 'amount', '100.00', '99.99'],
    ['paid price', { paidPrice: 99.99 }, 'amount', '100.00', '99.99'],
    ['paid price above the order', { paidPrice: 110 }, 'amount', '100.00', '110'],
    ['sub-kuruş paid price', { paidPrice: 100.001 }, 'amount', '100.00', '100.001'],
    ['unreadable price', { price: 'abc' }, 'amount', '100.00', 'abc'],
    ['phase', { phase: 'PRE_AUTH' }, 'transaction_type', 'AUTH', 'PRE_AUTH'],
    ['missing phase', { phase: undefined }, 'transaction_type', 'AUTH', ''],
  ])('%s → mismatch with the approved result attached', (_name, change, field, expected, actual) => {
    const answer = { ...P4, ...change }
    const approved = approvedResult()
    const error = catchError(() => bindPaymentAnswer(asSigned(answer), EXPECT_3DS, approved)) as OrderMismatchError
    expect(error).toBeInstanceOf(OrderMismatchError)
    expect(error.field).toBe(field)
    expect(error.expected).toBe(expected)
    expect(error.actual).toBe(actual)
    expect(error.actual.length).toBeLessThanOrEqual(64)
    expect(error.paymentMayHaveCompleted).toBe(true)
    expect(error.response?.status).toBe('approved')
    expect(error.response?.order_id).toBe('order-001')
    expect(error.response?.transaction_id).toBe(approved.transaction_id)
    expect(error.response?.requires_manual_review).toBe(true)
  })

  it('echoes at most 64 characters', () => {
    const error = catchError(() =>
      bindPaymentAnswer(asSigned({ ...P4, conversationId: 'y'.repeat(500) }), EXPECT_3DS, approvedResult()),
    ) as OrderMismatchError
    expect(error.actual).toBe('y'.repeat(64))
  })

  it('ignores inherited fields', () => {
    const answer = Object.create(P4) as Record<string, unknown>
    expect(() => bindPaymentAnswer(asSigned(answer), EXPECT_3DS, approvedResult())).toThrow(OrderMismatchError)
  })

  it('rounds the answer amount to eight decimals before taking the kuruş', () => {
    const order = { ...ORDER, amount: 10.21 }
    const answer = { ...P4, price: 10.21, paidPrice: 10.209999999999999 }
    expect(() => bindPaymentAnswer(asSigned(answer), { ...EXPECT_3DS, kurus: 1021 }, approvedResult())).not.toThrow()
    expect(
      approvedFromAnswer(mapper.mapPaymentResponse(answer, 'pay', order), order, asSigned(answer), '3d', 'pay').amount,
    ).toBe(10.21)
  })

  it('binds amounts above 2^26 exactly', () => {
    const answer = { ...P4, price: 91184819.71, paidPrice: 91184819.71 }
    expect(() =>
      bindPaymentAnswer(asSigned(answer), { ...EXPECT_3DS, kurus: 9118481971 }, approvedResult()),
    ).not.toThrow()
    expect(() => bindPaymentAnswer(asSigned(answer), { ...EXPECT_3DS, kurus: 9118481970 }, approvedResult())).toThrow(
      OrderMismatchError,
    )
    expect(
      crypt.checkResponseSignature(
        IA,
        signed({ ...P4_UNSIGNED, price: 91184819.71, paidPrice: 91184819.71 }),
        'payment',
      ),
    ).toBe(true)
    expect(HX('1001:TRY:order-001:order-001:91184819.71:91184819.71')).toBe(
      signed({ ...P4_UNSIGNED, price: 91184819.71, paidPrice: 91184819.71 }).signature,
    )
  })

  it('a paid price above the basket passes only when the payer may pay more', () => {
    const answer = { ...P4, paidPrice: 110 }
    expect(() =>
      bindPaymentAnswer(asSigned(answer), { ...EXPECT_3DS, paidPriceRule: 'atLeast' }, approvedResult()),
    ).not.toThrow()
    expect(() => bindPaymentAnswer(asSigned(answer), EXPECT_3DS, approvedResult())).toThrow(OrderMismatchError)
    for (const change of [{ paidPrice: 99 }, { paidPrice: 99.99 }, { price: 99 }, { price: 110 }]) {
      const error = catchError(() =>
        bindPaymentAnswer(
          asSigned({ ...answer, ...change }),
          { ...EXPECT_3DS, paidPriceRule: 'atLeast' },
          approvedResult(),
        ),
      ) as OrderMismatchError
      expect(error.field).toBe('amount')
    }
  })

  it('a capture binds the paid price only', () => {
    const expected: IyzicoPaymentExpectation = { ...EXPECT_3DS, paidPriceRule: 'ignorePrice', phase: 'POST_AUTH' }
    const answer = { ...P4, phase: 'POST_AUTH', price: 120 }
    expect(() => bindPaymentAnswer(asSigned(answer), expected, approvedResult())).not.toThrow()
    expect(
      (
        catchError(() =>
          bindPaymentAnswer(asSigned({ ...answer, paidPrice: 99 }), expected, approvedResult()),
        ) as OrderMismatchError
      ).field,
    ).toBe('amount')
    expect(
      (
        catchError(() =>
          bindPaymentAnswer(asSigned({ ...answer, phase: 'AUTH' }), expected, approvedResult()),
        ) as OrderMismatchError
      ).field,
    ).toBe('transaction_type')
  })

  it('a pre-authorization must answer PRE_AUTH', () => {
    const expected: IyzicoPaymentExpectation = { ...EXPECT_3DS, phase: 'PRE_AUTH' }
    expect(() => bindPaymentAnswer(asSigned({ ...P4, phase: 'PRE_AUTH' }), expected, approvedResult())).not.toThrow()
    expect(() => bindPaymentAnswer(P4, expected, approvedResult())).toThrow(OrderMismatchError)
  })

  it('without an expected payment id any iyzico payment id passes, nothing else', () => {
    const expected: IyzicoPaymentExpectation = { ...EXPECT_3DS, paymentId: undefined }
    expect(() =>
      bindPaymentAnswer(asSigned({ ...P4, paymentId: '35790626' }), expected, approvedResult()),
    ).not.toThrow()
    expect(() => bindPaymentAnswer(asSigned({ ...P4, paymentId: 35790626 }), expected, approvedResult())).not.toThrow()
    for (const paymentId of ['pay-1', '0', '', undefined, 1.5, -1, ['1001']]) {
      const error = catchError(() =>
        bindPaymentAnswer(asSigned({ ...P4, paymentId }), expected, approvedResult()),
      ) as OrderMismatchError
      expect(error.field).toBe('transaction_id')
      expect(error.expected).toBe('an iyzico payment id')
    }
  })
})

describe('signed answers only', () => {
  it('an answer reaches the binding only after its signature was verified (checked by the compiler)', () => {
    const plain: Record<string, unknown> = { ...P4_UNSIGNED, basketId: 'order-002' }
    // @ts-expect-error a plain record has not been verified
    expect(() => bindPaymentAnswer(plain, EXPECT_3DS, approvedResult())).toThrow(OrderMismatchError)
    // @ts-expect-error a plain record has not been verified
    reviewFlags(plain)
    // @ts-expect-error a plain record has not been verified
    checkoutPaymentCompleted(plain)
    // @ts-expect-error a plain record has not been verified
    expect(() => bindCheckoutRecord(plain, { orderId: 'order-001', token: 'tok-123' })).toThrow(OrderMismatchError)
    const answer: Record<string, unknown> = { ...P4 }
    requireSignedAnswer(crypt, IA, answer, 'payment', URL_AUTH)
    // narrowed by the assertion: no cast needed
    expect(() => bindPaymentAnswer(answer, EXPECT_3DS, approvedResult(answer))).not.toThrow()
    expect(reviewFlags(answer)).toEqual({ manualReview: false })
  })
})

describe('bindRefundAnswer', () => {
  const refund = { status: 'success', paymentId: '1001', price: 40, currency: 'TRY', conversationId: 'order-001' }
  const expected = { orderId: 'order-001', paymentId: '1001', kurus: 4000, currency: 'TRY' }
  const approved = (): PosResponse => ({ ...mapper.mapRefundResponse(refund), order_id: 'order-001' })

  it('passes the refund of the order', () => {
    expect(() => bindRefundAnswer(asSigned(refund), expected, approved())).not.toThrow()
    expect(() => bindRefundAnswer(asSigned({ ...refund, price: '40.00' }), expected, approved())).not.toThrow()
  })

  it.each<[Record<string, unknown>, string]>([
    [{ conversationId: 'order-002' }, 'order_id'],
    [{ paymentId: '1002' }, 'transaction_id'],
    [{ currency: 'EUR' }, 'currency'],
    [{ price: 41 }, 'amount'],
    [{ price: 40.001 }, 'amount'],
    [{ price: undefined }, 'amount'],
  ])('%j → %s', (change, field) => {
    const error = catchError(() =>
      bindRefundAnswer(asSigned({ ...refund, ...change }), expected, approved()),
    ) as OrderMismatchError
    expect(error.field).toBe(field)
    expect(error.paymentMayHaveCompleted).toBe(true)
  })
})

describe('bindCancelAnswer', () => {
  const cancel = { status: 'success', paymentId: '1001', conversationId: 'order-001' }
  const approved = (): PosResponse => ({ ...mapper.mapCancelResponse(cancel), order_id: 'order-001' })

  it('passes the cancel of the order, also without the ids', () => {
    expect(() => bindCancelAnswer(cancel, { orderId: 'order-001', paymentId: '1001' }, approved())).not.toThrow()
    expect(() =>
      bindCancelAnswer({ status: 'success' }, { orderId: 'order-001', paymentId: '1001' }, approved()),
    ).not.toThrow()
    expect(() =>
      bindCancelAnswer({ ...cancel, paymentId: 1001 }, { orderId: 'order-001', paymentId: '1001' }, approved()),
    ).not.toThrow()
  })

  it.each<[Record<string, unknown>, string]>([
    [{ conversationId: 'order-002' }, 'order_id'],
    [{ conversationId: null }, 'order_id'],
    [{ paymentId: '1002' }, 'transaction_id'],
    [{ paymentId: ['1001'] }, 'transaction_id'],
  ])('%j → %s', (change, field) => {
    const error = catchError(() =>
      bindCancelAnswer({ ...cancel, ...change }, { orderId: 'order-001', paymentId: '1001' }, approved()),
    ) as OrderMismatchError
    expect(error.field).toBe(field)
    expect(error.paymentMayHaveCompleted).toBe(true)
  })
})

describe('bindCheckoutRecord', () => {
  it('passes the record of the checkout', () => {
    expect(() => bindCheckoutRecord(CF2, { orderId: 'order-001', token: 'tok-123' })).not.toThrow()
  })

  it.each<[string, Record<string, unknown>]>([
    ['token', { token: 'tok-999' }],
    ['missing token', { token: undefined }],
    ['basket id', { basketId: 'order-002' }],
    ['conversation id', { conversationId: 'order-002' }],
    ['missing basket id', { basketId: undefined }],
    ['numeric basket id', { basketId: 1 }],
  ])('a record of another %s is no evidence for this order (no response)', (_name, change) => {
    const error = catchError(() =>
      bindCheckoutRecord(asSigned({ ...CF2, ...change }), { orderId: 'order-001', token: 'tok-123' }),
    ) as OrderMismatchError
    expect(error).toBeInstanceOf(OrderMismatchError)
    expect(error.field).toBe('order_id')
    expect(error.response).toBeUndefined()
    expect(error.paymentMayHaveCompleted).toBe(false)
  })
})

describe('checkoutPaymentCompleted', () => {
  it.each<[unknown, boolean]>([
    ['SUCCESS', true],
    ['INIT_THREEDS', false],
    ['CALLBACK_THREEDS', false],
    ['FAILURE', false],
    ['success', false],
    [' SUCCESS', false],
    [undefined, false],
    [['SUCCESS'], false],
  ])('%j → %s', (paymentStatus, expected) => {
    expect(checkoutPaymentCompleted(asSigned({ ...CF2, paymentStatus }))).toBe(expected)
  })
})

describe('reviewFlags', () => {
  it.each<[unknown]>([[1], ['1']])('fraudStatus %j needs no review', (fraudStatus) => {
    expect(reviewFlags(asSigned({ ...P4, fraudStatus }))).toEqual({ manualReview: false })
  })

  it.each<[unknown]>([[0], ['0'], [-1], ['-1'], ['x'], [' 1'], [true], [null], [undefined], [1.0000001]])(
    'fraudStatus %j needs review',
    (fraudStatus) => {
      expect(reviewFlags(asSigned({ ...P4, fraudStatus }))).toEqual({ manualReview: true })
    },
  )

  it('an inherited fraud status needs review', () => {
    const answer = Object.create({ fraudStatus: 1 }) as Record<string, unknown>
    expect(reviewFlags(asSigned(answer), false)).toEqual({ manualReview: true })
  })

  it.each<[unknown, boolean]>([
    [1, false],
    ['1', false],
    [undefined, false],
    [0, true],
    ['0', true],
    ['2', true],
    [' 1', true],
    [null, true],
    [true, true],
  ])('mdStatus %j → review %s', (mdStatus, review) => {
    const answer: Record<string, unknown> = { ...P4, mdStatus }
    if (mdStatus === undefined) delete answer.mdStatus
    expect(reviewFlags(asSigned(answer))).toEqual({ manualReview: review })
  })

  it('the 3D status is not read for a payment without 3D Secure', () => {
    expect(reviewFlags(asSigned({ ...P4, mdStatus: 0 }), false)).toEqual({ manualReview: false })
  })
})

describe('heldForReview', () => {
  it('declines the approved result and flags it for review', () => {
    const approved = approvedResult()
    const held = heldForReview(approved)
    expect(held).toEqual({ ...approved, status: 'declined', requires_manual_review: true })
  })

  it('refuses a result that is not an approval', () => {
    expect(() => heldForReview({ ...approvedResult(), status: 'declined' })).toThrow(PosError)
  })
})

describe('declinedFromAnswer', () => {
  const noisy = `Kart\u0000 limiti\n yetersiz\u2028\u202E${'x'.repeat(300)}`
  const failure = {
    status: 'failure',
    errorCode: '10051',
    errorMessage: noisy,
    conversationId: 'order-002',
    paidPrice: 100,
    currency: 'TRY',
    installment: 3,
  }

  it('keeps the order id, a short code and a bounded plain text', () => {
    const mapped = {
      ...mapper.mapPaymentResponse(failure, 'pay', ORDER),
      amount: 100,
      currency: 'TRY',
      installment_count: 3,
    }
    const result = declinedFromAnswer(mapped, 'order-001', failure)
    expect(result.status).toBe('declined')
    expect(result.order_id).toBe('order-001')
    expect(result.error_code).toBe('10051')
    expect((result.error_message as string).length).toBeLessThanOrEqual(256)
    expect(result.error_message?.startsWith('Kart limiti yetersiz')).toBe(true)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to find control characters
    expect(result.error_message).not.toMatch(/[\x00-\x1F\u2028\u202E]/)
    expect(result.amount).toBeNull()
    expect(result.currency).toBeNull()
    expect(result.installment_count).toBeNull()
    expect(result).not.toHaveProperty('requires_manual_review')
  })

  it.each<[unknown, string | null]>([
    ['10 000', null],
    [5062, '5062'],
    [['5062'], null],
    [undefined, null],
  ])('errorCode %j → %j', (errorCode, expected) => {
    const answer = { ...failure, errorCode }
    expect(declinedFromAnswer(mapper.mapPaymentResponse(answer, 'pay', ORDER), 'order-001', answer).error_code).toBe(
      expected,
    )
  })

  it('drops a manual review flag', () => {
    const mapped = { ...mapper.mapPaymentResponse(failure, 'pay', ORDER), requires_manual_review: true }
    expect(declinedFromAnswer(mapped, 'order-001', failure)).not.toHaveProperty('requires_manual_review')
  })

  it('refuses an approved input', () => {
    expect(() => declinedFromAnswer(mapper.mapPaymentResponse(P4, 'pay', ORDER), 'order-001', P4)).toThrow(PosError)
  })
})

describe('approvedFromAnswer', () => {
  it('is built from the order and the signed values', () => {
    const answer = { ...P4, conversationId: 'echo', currency: 'USD', phase: 'PRE_AUTH' }
    const result = approvedFromAnswer(
      mapper.mapPaymentResponse(answer, 'pay', ORDER),
      ORDER,
      asSigned(answer),
      '3d',
      'pay',
    )
    expect(result.status).toBe('approved')
    expect(result.order_id).toBe('order-001')
    expect(result.currency).toBe('TRY')
    expect(result.amount).toBe(100)
    expect(result.transaction_id).toBe('1001')
    expect(result.payment_model).toBe('3d')
    expect(result.transaction_type).toBe('pay')
    expect(result.auth_code).toBe('123456')
    expect(result.masked_number).toBe('460345******0000')
  })

  it.each<[unknown, number | null]>([
    [110, 110],
    ['110.50', 110.5],
    [10.209999999999999, 10.21],
    [91184819.71, 91184819.71],
    [100.001, null],
    ['abc', null],
    [undefined, null],
  ])('the amount is the signed paid price %j → %j', (paidPrice, amount) => {
    const answer = { ...P4, paidPrice }
    expect(
      approvedFromAnswer(mapper.mapPaymentResponse(answer, 'pay', ORDER), ORDER, asSigned(answer), '3d', 'pay').amount,
    ).toBe(amount)
  })

  it.each<[unknown, string | null]>([
    [1001, '1001'],
    ['1001', '1001'],
    ['pay-1', null],
    [1.5, null],
    [undefined, null],
  ])('the transaction id is the payment id text %j → %j', (paymentId, expected) => {
    const answer = { ...P4, paymentId }
    expect(
      approvedFromAnswer(mapper.mapPaymentResponse(answer, 'pay', ORDER), ORDER, asSigned(answer), '3d', 'pay')
        .transaction_id,
    ).toBe(expected)
  })

  it('the currency is the order currency (default TRY)', () => {
    const order = { id: 'order-001', amount: 100 } as PosOrder
    expect(approvedFromAnswer(mapper.mapPaymentResponse(P4, 'pay', order), order, P4, 'regular', 'pre').currency).toBe(
      'TRY',
    )
    const usd = { ...ORDER, currency: 'USD' } as PosOrder
    expect(approvedFromAnswer(mapper.mapPaymentResponse(P4, 'pay', usd), usd, P4, 'regular', 'pre').currency).toBe(
      'USD',
    )
  })

  it('refuses a declined input', () => {
    const failure = { status: 'failure', errorCode: '1' }
    expect(() =>
      approvedFromAnswer(mapper.mapPaymentResponse(failure, 'pay', ORDER), ORDER, asSigned(failure), '3d', 'pay'),
    ).toThrow(PosError)
  })
})

describe('colon regroupings', () => {
  /** Every way to cut a signed text at its colons into the given fields. */
  function regroupings(text: string, names: readonly string[]): Array<Record<string, string>> {
    const tokens = text.split(':')
    const out: Array<Record<string, string>> = []
    const pick = (start: number, cuts: number[]): void => {
      if (cuts.length === names.length - 1) {
        const bounds = [0, ...cuts.map((c) => c + 1), tokens.length]
        const record: Record<string, string> = {}
        names.forEach((name, i) => {
          record[name] = tokens.slice(bounds[i], bounds[i + 1]).join(':')
        })
        out.push(record)
        return
      }
      for (let gap = start; gap < tokens.length - 1; gap++) pick(gap + 1, [...cuts, gap])
    }
    pick(0, [])
    return out
  }

  /** The signed callback path as the gateway composes it. */
  function callbackVerdict(body: Record<string, string>): string {
    try {
      assertCallbackOrder(body, 'order-001')
    } catch (error) {
      if (error instanceof OrderMismatchError) return 'mismatch'
      throw error
    }
    if (!signedCallbackApproves(body)) return 'decline'
    try {
      return `approve:${assertCallbackApprovalPins(body, 'order-001')}`
    } catch (error) {
      if (error instanceof HashMismatchError) return 'malformed'
      throw error
    }
  }

  const CALLBACK_FIELDS = ['conversationData', 'conversationId', 'mdStatus', 'paymentId', 'status']

  it.each<[string, string | null]>([
    ['x:y:order-001:1:1001:success', '1001'],
    [':order-001:1:1001:success', '1001'],
    ['order-001:1:1001:success:order-001:1:1001:success', '1001'],
    ['order-001:1:1002:success:order-001:1:1001:success', '1001'],
    [':order-001:1:1001:success:success', null],
    ['x:y:order-001:1:pay-1:success', null],
    ['a:order-001:1:1001:success:x', null],
    ['order-001:1:1001:success:order-001:0:1001:failure', null],
    ['x:order-001:1:1001:success:order-001:0::failure', null],
    ['1:1001:success:order-001:1:1001', null],
  ])(
    'every verifying reading of %j approves at most the reading that puts the colons in the conversation data',
    (text, approvedPaymentId) => {
      const signature = HX(text)
      const readings = regroupings(text, CALLBACK_FIELDS)
      expect(readings.length).toBeGreaterThan(0)
      const verdicts = readings.map((reading) => {
        const body = assertFlatIyzicoCallback({ ...reading, signature })
        expect(crypt.check3DHash(IA, body)).toBe(true)
        return { reading, verdict: callbackVerdict(body) }
      })
      const approvals = verdicts.filter((v) => v.verdict.startsWith('approve:'))
      for (const { verdict } of verdicts) {
        expect(['mismatch', 'decline', 'malformed'].includes(verdict) || verdict.startsWith('approve:')).toBe(true)
      }
      if (approvedPaymentId === null) {
        expect(approvals).toEqual([])
      } else {
        expect(approvals).toHaveLength(1)
        const tokens = text.split(':')
        expect(approvals[0]?.reading).toEqual({
          conversationData: tokens.slice(0, -4).join(':'),
          conversationId: 'order-001',
          mdStatus: '1',
          paymentId: approvedPaymentId,
          status: 'success',
        })
      }
    },
  )

  /** The signed approval answer path as the gateway composes it. */
  function answerVerdict(
    answer: Record<string, unknown>,
    kind: IyzicoSignedAnswer,
    expected: IyzicoPaymentExpectation,
  ): string {
    try {
      requireSignedAnswer(crypt, IA, answer, kind, URL_AUTH)
      if (kind === 'checkoutFormRetrieve') {
        bindCheckoutRecord(answer, { orderId: 'order-001', token: 'tok-123' })
        if (!checkoutPaymentCompleted(answer)) return 'decline'
      }
      bindPaymentAnswer(answer, expected, approvedResult())
      return 'approve'
    } catch (error) {
      if (error instanceof PosHttpError) return 'unknown'
      if (error instanceof OrderMismatchError) return 'mismatch'
      throw error
    }
  }

  it.each<[IyzicoSignedAnswer, string, IyzicoPaymentExpectation]>([
    ['payment', '1001:TRY:order-001:order-001:100:100', EXPECT_3DS],
    ['payment', 'x:1001:TRY:order-001:order-001:100:100', EXPECT_3DS],
    ['payment', '1001:TRY:order-001:order-001:100:100:100', EXPECT_3DS],
    ['payment', '1001:TRY:order-001:order-001:order-001:100:100', EXPECT_3DS],
    ['payment', '1001:1001:TRY:order-001:order-001:100:100', { ...EXPECT_3DS, paymentId: undefined }],
    ['payment', '1001:TRY:TRY:order-001:order-001:100:100', EXPECT_3DS],
    ['payment', '1001:TRY:order-001:order-001:100:100:x', EXPECT_3DS],
    [
      'checkoutFormRetrieve',
      'SUCCESS:1001:TRY:order-001:order-001:110:100:tok-123',
      { ...EXPECT_3DS, paidPriceRule: 'atLeast' },
    ],
    [
      'checkoutFormRetrieve',
      'SUCCESS:SUCCESS:1001:TRY:order-001:order-001:110:100:tok-123',
      { ...EXPECT_3DS, paidPriceRule: 'atLeast' },
    ],
    [
      'checkoutFormRetrieve',
      'FAILURE:1001:TRY:order-001:order-001:110:100:tok-123:x',
      { ...EXPECT_3DS, paidPriceRule: 'atLeast' },
    ],
  ])('%s %j: a regrouped signed answer approves only as the bank wrote it', (kind, text, expected) => {
    const names = IYZICO_SIGNED_FIELDS[kind]
    const signature = HX(text)
    const readings = regroupings(text, names)
    const extraColons = text.split(':').length > names.length
    let approvals = 0
    for (const reading of readings) {
      const answer: Record<string, unknown> = {
        status: 'success',
        fraudStatus: 1,
        phase: 'AUTH',
        ...reading,
        signature,
      }
      const verdict = answerVerdict(answer, kind, expected)
      expect(['approve', 'decline', 'mismatch', 'unknown']).toContain(verdict)
      if (verdict === 'approve') {
        approvals++
        // only the reading without a colon in any field can be the bank's own
        for (const name of names) expect(reading[name]).not.toContain(':')
      }
    }
    expect(approvals).toBe(extraColons ? 0 : 1)
  })
})
