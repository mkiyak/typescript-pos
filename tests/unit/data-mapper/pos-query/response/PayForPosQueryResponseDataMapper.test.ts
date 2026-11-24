import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PayForPosQueryResponseDataMapper } from '../../../../../src/data-mapper/pos-query/response/PayForPosQueryResponseDataMapper.js'
import { BasicResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { PayForPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/PayForPosResponseValueMapper.js'
import { UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { noopLogger } from '../../../../../src/logger.js'

const mapper = new PayForPosQueryResponseDataMapper(
  new BasicResponseValueFormatter(),
  new PayForPosResponseValueMapper(),
  noopLogger,
)

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../test_data/payfor/history/${name}`, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >

function sorted(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
}

function check(actual: Record<string, unknown>, expected: Record<string, unknown>) {
  const transactions = actual.transactions as Array<Record<string, unknown>>
  const expectedTx = expected.transactions as Array<Record<string, unknown>>
  expect(transactions).toHaveLength(expectedTx.length)
  expect(actual.all).toBeTypeOf('object')
  expect(Object.keys(actual.all as object).length).toBeGreaterThan(0)
  expect({
    ...actual,
    all: undefined,
    transactions: transactions.map(sorted),
  }).toEqual({ ...expected, all: undefined, transactions: expectedTx.map(sorted) })
}

const tx = (over: Record<string, unknown>) => ({
  auth_code: null,
  proc_return_code: null,
  transaction_id: null,
  transaction_time: null,
  capture_time: null,
  error_message: null,
  ref_ret_num: null,
  order_status: null,
  transaction_type: null,
  first_amount: null,
  capture_amount: null,
  status: 'declined',
  error_code: null,
  capture: null,
  currency: null,
  masked_number: null,
  order_id: null,
  ...over,
})

describe('PayForPosQueryResponseDataMapper', () => {
  it('testSupports', () => {
    expect(PayForPosQueryResponseDataMapper.supports('PayForPos')).toBe(true)
    expect(PayForPosQueryResponseDataMapper.supports('AssecoPos')).toBe(false)
  })

  it('testMapInstallmentRatesResponseThrows', () => {
    expect(() => mapper.mapInstallmentRatesResponse({})).toThrow(UnsupportedTransactionTypeError)
  })

  // deviation: F22 offset-less bank times are Türkiye time; the shared fixtures carry a neutral client name
  describe('testMapHistoryResponse', () => {
    it('single_success_pay', () => {
      const actual = mapper.mapHistoryResponse(fixture('success_pay_response.json'))
      check(actual, {
        proc_return_code: '00',
        error_code: null,
        error_message: null,
        status: 'approved',
        trans_count: 1,
        transactions: [
          tx({
            auth_code: 'S90726',
            proc_return_code: '00',
            transaction_time: new Date('2024-01-21T21:40:47+03:00'),
            capture_time: new Date('2024-01-21T21:40:47+03:00'),
            order_status: 'PAYMENT_COMPLETED',
            transaction_type: 'pay',
            first_amount: 1.01,
            capture_amount: 1.01,
            status: 'approved',
            capture: true,
            currency: 'TRY',
            masked_number: '415565******6111',
            order_id: '202401212A22',
          }),
        ],
      })
    })

    it('single_success_pre_pay', () => {
      const actual = mapper.mapHistoryResponse(fixture('success_pre_pay_response.json'))
      check(actual, {
        proc_return_code: '00',
        error_code: null,
        error_message: null,
        status: 'approved',
        trans_count: 1,
        transactions: [
          tx({
            auth_code: 'S95711',
            proc_return_code: '00',
            transaction_time: new Date('2024-01-21T21:59:31+03:00'),
            order_status: 'PRE_AUTH_COMPLETED',
            transaction_type: 'pre',
            first_amount: 2.01,
            status: 'approved',
            capture: false,
            currency: 'TRY',
            masked_number: '415565******6111',
            order_id: '2024012186F9',
          }),
        ],
      })
    })

    it('single_failed_order_not_found', () => {
      const actual = mapper.mapHistoryResponse(fixture('fail_order_not_found_response.json'))
      check(actual, {
        proc_return_code: 'V013',
        error_code: 'V013',
        error_message: 'Seçili İşlem Bulunamadı!',
        status: 'declined',
        trans_count: 0,
        transactions: [],
      })
    })

    it('daily_history', () => {
      const actual = mapper.mapHistoryResponse(fixture('daily_history.json'))
      check(actual, {
        proc_return_code: null,
        error_code: null,
        error_message: null,
        status: null,
        trans_count: 3,
        transactions: [
          tx({
            proc_return_code: 'V000',
            transaction_type: 'pay',
            error_code: 'V000',
            currency: 'TRY',
            order_id: '3450201880',
          }),
          tx({
            proc_return_code: 'V000',
            transaction_type: 'pay',
            error_code: 'V000',
            currency: 'TRY',
            order_id: '1171158618',
          }),
          tx({
            auth_code: 'S70708',
            proc_return_code: '00',
            transaction_time: new Date('2024-03-14T21:40:18+03:00'),
            capture_time: new Date('2024-03-14T21:40:18+03:00'),
            order_status: 'PAYMENT_COMPLETED',
            transaction_type: 'pay',
            first_amount: 100,
            capture_amount: 100,
            status: 'approved',
            capture: true,
            currency: 'TRY',
            masked_number: '415956******7732',
            order_id: '1427731461',
          }),
        ],
      })
    })
  })

  // addition: robustness against odd answers
  it('maps an empty answer to an empty report without throwing', () => {
    const actual = mapper.mapHistoryResponse({})
    expect(actual.trans_count).toBe(0)
    expect(actual.transactions).toEqual([])
    expect(actual.status).toBeNull()
  })

  // addition: a day with exactly one transaction decodes from XML as a single record, like an order report
  it('reads a single-record day report as one transaction', () => {
    const actual = mapper.mapHistoryResponse(fixture('success_pay_response.json'))
    expect(actual.trans_count).toBe(1)
    expect(actual.status).toBe('approved')
  })

  it('maps a PaymentRequestExtended that is a string to no transactions', () => {
    const actual = mapper.mapHistoryResponse({ PaymentRequestExtended: 'x' })
    expect(actual.transactions).toEqual([])
    expect(actual.trans_count).toBe(0)
  })

  it('turns non-scalar bank values into null instead of "[object Object]"', () => {
    const actual = mapper.mapHistoryResponse({
      PaymentRequestExtended: {
        PaymentRequest: {
          ProcReturnCode: '00',
          OrderId: { a: 1 },
          TxnType: 'Auth',
          Currency: ['949'],
          AuthCode: { x: 1 },
          CardMask: ['x'],
          PurchAmount: { y: 1 },
          InsertDatetime: { z: 1 },
        },
      },
    })
    const first = (actual.transactions as Array<Record<string, unknown>>)[0] ?? {}
    expect(first.order_id).toBeNull()
    expect(first.currency).toBeNull()
    expect(first.auth_code).toBeNull()
    expect(first.masked_number).toBeNull()
    expect(first.first_amount).toBeNull()
    expect(first.transaction_time).toBeNull()
  })

  it('does not approve a record whose code only looks like success after trimming', () => {
    const actual = mapper.mapHistoryResponse({
      PaymentRequestExtended: { PaymentRequest: { ProcReturnCode: ' 00 ', OrderId: '1', TxnType: 'Auth' } },
    })
    expect(actual.status).toBe('declined')
    expect(actual.transactions).toEqual([])
  })
})
