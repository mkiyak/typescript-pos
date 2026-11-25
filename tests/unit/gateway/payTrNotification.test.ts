import { describe, expect, it } from 'vitest'
import { HashMismatchError, PosError } from '../../../src/errors.js'
import {
  approvedNotificationResult,
  flatNotification,
  notificationOrderId,
  paymentAmountMatches,
  readsAsApproval,
  signedDecline,
  signedTotalKurus,
  totalAmountAccepted,
  trustedBrowserDecline,
} from '../../../src/gateway/payTrNotification.js'
import type { PosResponse } from '../../../src/types.js'

// addition: the notification helpers of the PayTR gateway (flat body, unverified lookup key, browser-return
// classification, signed decline shaping, approval pins and amount rules)

const declined = (over: Record<string, unknown> = {}): PosResponse =>
  ({
    order_id: 'echo',
    status: 'declined',
    proc_return_code: null,
    error_code: 'x',
    error_message: 'y',
    amount: 1,
    currency: 'TRY',
    installment_count: 3,
    transaction_time: new Date(),
    ...over,
  }) as unknown as PosResponse

describe('notificationOrderId', () => {
  // addition: N1 the unverified lookup key of a notification
  it.each([
    ['X1', 'X1'],
    ['20260623E335', '20260623E335'],
    ['a_b-1', 'a_b-1'],
  ])('reads %j', (oid, expected) => {
    expect(notificationOrderId({ merchant_oid: oid })).toBe(expected)
  })

  // addition: N1 anything that is not one own order id is refused
  it.each([
    ['{}', {}],
    ['a blank in the id', { merchant_oid: 'a b' }],
    ['a list', { merchant_oid: ['x'] }],
    ['a number', { merchant_oid: 5 }],
    ['an empty id', { merchant_oid: '' }],
    ['65 characters', { merchant_oid: 'a'.repeat(65) }],
    ['a leading hyphen', { merchant_oid: '-a' }],
    ['null', null],
    ['a list body', [{ merchant_oid: 'X1' }]],
    ['text', 'merchant_oid=X1'],
    ['an inherited id', Object.create({ merchant_oid: 'X1' })],
  ])('refuses %s', (_name, body) => {
    expect(() => notificationOrderId(body)).toThrow(new PosError('Notification carries no valid merchant_oid'))
  })
})

describe('flatNotification', () => {
  // addition: N2 a flat record of own strings passes unchanged
  it('returns the same record', () => {
    const body = { merchant_oid: 'X1', status: 'success' }
    expect(flatNotification(body)).toBe(body)
    const bare = Object.assign(Object.create(null) as Record<string, string>, { a: 'b' })
    expect(flatNotification(bare)).toBe(bare)
  })

  // addition: N2 every other shape is refused before anything is read
  it.each([
    ['a list hash', { hash: ['x'] }],
    ['a record status', { status: { a: 1 } }],
    ['a number', { total_amount: 1001 }],
    ['null', { status: null }],
    ['undefined', { status: undefined }],
    ['a boolean', { test_mode: true }],
  ])('refuses %s', (_name, body) => {
    expect(() => flatNotification(body)).toThrow(PosError)
  })

  it('names the field (at most 64 characters)', () => {
    expect(() => flatNotification({ status: { a: 1 } })).toThrow(
      new PosError('3D callback field "status" must be a string'),
    )
    const long = 'k'.repeat(100)
    expect(() => flatNotification({ [long]: 1 })).toThrow(`3D callback field "${'k'.repeat(64)}" must be a string`)
  })

  it('refuses a non-enumerable field that is not a string', () => {
    const body = { status: 'failed' }
    Object.defineProperty(body, 'hash', { value: ['x'], enumerable: false })
    expect(() => flatNotification(body)).toThrow(PosError)
  })

  it.each([
    ['null', null],
    ['a list', ['a']],
    ['text', 'status=success'],
    ['a class instance', new Date()],
    ['a map', new Map([['status', 'success']])],
  ])('refuses %s as a body', (_name, body) => {
    expect(() => flatNotification(body)).toThrow(new PosError('3D callback data must be a record'))
  })
})

describe('readsAsApproval', () => {
  // addition: N5 an unsigned body that reads as an approval (padding and case ignored)
  it.each([
    [{ status: 'success' }],
    [{ status: ' SUCCESS ' }],
    [{ status: '\tSuccess\n' }],
    [{ total_amount: '1001' }],
    [{ total_amount: ' 0001 ' }],
    [{ status: 'failed', total_amount: '5' }],
  ])('%j reads as an approval', (body) => {
    expect(readsAsApproval(body)).toBe(true)
  })

  it.each([
    [{ fail_message: 'Kart limiti yetersiz' }],
    [{ status: 'failed' }],
    [{ status: 'successful' }],
    [{ total_amount: '0' }],
    [{ total_amount: '000' }],
    [{ total_amount: '10.01' }],
    [{ total_amount: '-5' }],
    [{}],
  ])('%j does not', (body) => {
    expect(readsAsApproval(body)).toBe(false)
  })
})

describe('trustedBrowserDecline', () => {
  // addition: N5 the browser's failure text is the only value kept, as bounded plain text
  it('builds the decline from the order id and the failure text only', () => {
    const body = {
      fail_message: 'Kart limiti yetersiz',
      merchant_oid: 'other',
      total_amount: '0',
      failed_reason_code: '51',
    }
    const result = trustedBrowserDecline(body, 'order-1', 'pay', '3d_pay')
    expect(result).toStrictEqual({
      order_id: 'order-1',
      transaction_id: null,
      transaction_time: null,
      transaction_type: 'pay',
      installment_count: null,
      currency: null,
      amount: null,
      payment_model: '3d_pay',
      auth_code: null,
      ref_ret_num: null,
      batch_num: null,
      proc_return_code: null,
      status: 'declined',
      error_code: null,
      error_message: null,
      all: body,
      md_status: null,
      md_error_message: 'Kart limiti yetersiz',
      transaction_security: null,
    })
    expect(result).not.toHaveProperty('requires_manual_review')
  })

  it('cuts the failure text to 256 characters and drops control characters', () => {
    const text = `${'a\u0000b\u0007'.repeat(10)}${'c'.repeat(300)}`
    const result = trustedBrowserDecline({ fail_message: text }, 'o', 'pay', '3d_host')
    const message = result.md_error_message as string
    expect(message.length).toBe(256)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what must be absent
    expect(message).not.toMatch(/[\u0000-\u001F]/)
    expect(message.startsWith('abab')).toBe(true)
  })

  it('has no failure text when the body has none', () => {
    expect(trustedBrowserDecline({ other: 'x' }, 'o', 'pay', '3d_host').md_error_message).toBeNull()
  })
})

describe('signedDecline', () => {
  // addition: N7 a signed decline takes the order's id, bounded reasons and no amount, currency or installment
  it('shapes the mapped decline', () => {
    const body = { failed_reason_code: '05', failed_reason_msg: 'Do not honour' }
    const result = signedDecline(declined(), body, 'order-host-fail')
    expect(result).toMatchObject({
      order_id: 'order-host-fail',
      status: 'declined',
      error_code: '05',
      error_message: 'Do not honour',
      amount: null,
      currency: null,
      installment_count: null,
      transaction_time: null,
    })
  })

  it.each([
    ['0 5', null],
    ['', null],
    ['a'.repeat(17), null],
    ['A_1-b', 'A_1-b'],
  ])('reason code %j reads as %j', (code, expected) => {
    expect(signedDecline(declined(), { failed_reason_code: code }, 'o').error_code).toBe(expected)
  })

  it('keeps at most 256 characters of the reason text', () => {
    const result = signedDecline(declined(), { failed_reason_msg: 'm'.repeat(300) }, 'o')
    expect((result.error_message as string).length).toBe(256)
    expect(signedDecline(declined(), {}, 'o').error_message).toBeNull()
    expect(signedDecline(declined(), {}, 'o').error_code).toBeNull()
  })

  // addition: N7 fail-closed guard: a decline path never returns anything but a decline
  it('refuses a mapped result that is not declined', () => {
    expect(() => signedDecline(declined({ status: 'approved' }), {}, 'o')).toThrow(PosError)
  })
})

describe('signedTotalKurus', () => {
  // addition: N8 (1) the signed total of an approval is a positive whole number of kuruş
  it.each([
    ['1001', 1001],
    ['1', 1],
    ['999999999999999', 999999999999999],
  ])('%j is %d', (text, expected) => {
    expect(signedTotalKurus({ total_amount: text })).toBe(expected)
  })

  it.each([['0'], ['01'], ['10.01'], [' 1001'], ['1001 '], ['-1'], [''], ['1e3'], ['1000000000000000']])(
    '%j is malformed',
    (text) => {
      expect(() => signedTotalKurus({ total_amount: text })).toThrow(
        new HashMismatchError('3D callback fields are malformed'),
      )
    },
  )

  it('a missing total is malformed', () => {
    expect(() => signedTotalKurus({})).toThrow(HashMismatchError)
  })
})

describe('totalAmountAccepted', () => {
  // addition: N8 (3) equal for a single payment; equal or higher (an installment fee) for an installment plan
  it.each([
    [1050, 1050, 0, true],
    [1100, 1050, 0, false],
    [1049, 1050, 0, false],
    [1100, 1050, 1, false],
    [1100, 1050, 3, true],
    [1050, 1050, 3, true],
    [1049, 1050, 3, false],
  ])('total %d for %d kuruş with installment %d: %s', (total, kurus, installment, expected) => {
    expect(totalAmountAccepted(total, kurus, installment)).toBe(expected)
  })
})

describe('paymentAmountMatches', () => {
  // addition: N8 (4) the unsigned payment amount, when sent, is the order amount in kuruş
  it.each([
    ['1050', true],
    ['01050', true],
    ['1049', false],
    ['10.50', false],
    ['', false],
    [' 1050', false],
    ['1'.repeat(16), false],
  ])('%j for 1050: %s', (text, expected) => {
    expect(paymentAmountMatches(text, 1050)).toBe(expected)
  })
})

describe('approvedNotificationResult', () => {
  const approved = (over: Record<string, unknown> = {}): PosResponse =>
    ({
      status: 'approved',
      order_id: 'echo',
      currency: 'USD',
      amount: 99,
      installment_count: 7,
      ...over,
    }) as unknown as PosResponse

  // addition: N8 the approved result takes the order's id and currency and the signed amount
  it('builds the approved result from the order and the signed total', () => {
    const result = approvedNotificationResult(
      approved(),
      { installment_count: '3' },
      'O1',
      'TRY',
      1100,
      '3d_host',
      'pay',
    )
    expect(result).toMatchObject({
      status: 'approved',
      order_id: 'O1',
      currency: 'TRY',
      amount: 11,
      installment_count: 7,
      payment_model: '3d_host',
      transaction_type: 'pay',
    })
  })

  it.each([[{}], [{ installment_count: 'x' }], [{ installment_count: '123' }], [{ installment_count: ' 3' }]])(
    'drops the installment count for %j',
    (body) => {
      expect(
        approvedNotificationResult(approved(), body, 'O1', 'TRY', 1001, '3d_pay', 'pay').installment_count,
      ).toBeNull()
    },
  )

  it('keeps no mapped installment count when the mapper has none', () => {
    const result = approvedNotificationResult(
      approved({ installment_count: undefined }),
      { installment_count: '3' },
      'O1',
      'TRY',
      1001,
      '3d_pay',
      'pay',
    )
    expect(result.installment_count).toBeNull()
  })

  // addition: N8 a signed approval that the mapper did not map as approved is refused
  it('refuses a mapped result that is not approved', () => {
    expect(() =>
      approvedNotificationResult(approved({ status: 'declined' }), {}, 'O1', 'TRY', 1001, '3d_pay', 'pay'),
    ).toThrow(PosError)
  })
})
