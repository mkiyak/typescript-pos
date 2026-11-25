import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PayTrPosResponseDataMapper,
  payTrDecimalKurus,
} from '../../../../../src/data-mapper/response/mapper/PayTrPosResponseDataMapper.js'
import { PayTrPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/PayTrPosResponseValueFormatter.js'
import { PayTrPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/PayTrPosResponseValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import type { PosLogger } from '../../../../../src/logger.js'
import { MODEL, PAYMENT_STATUS, TX_TYPE } from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'
import {
  type Case,
  paymentCases,
  refundCases,
  statusCases,
  threeDHostCases,
  threeDPayCases,
} from './PayTrPosResponseDataMapper.data.js'
import { withBaseKeys } from './withBaseKeys.js'

// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

function sorted(data: Data): Data {
  return Object.fromEntries(Object.entries(data).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

describe('PayTrPosResponseDataMapper', () => {
  let logger: { [K in keyof PosLogger]: ReturnType<typeof vi.fn> }
  let mapper: PayTrPosResponseDataMapper

  beforeEach(() => {
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    mapper = new PayTrPosResponseDataMapper(
      new PayTrPosResponseValueFormatter(),
      new PayTrPosResponseValueMapper(),
      logger as unknown as PosLogger,
    )
  })

  const warnedFields = (): unknown[] => logger.warn.mock.calls.map((c) => (c[1] as Data)?.field)

  it('supports', () => {
    expect(PayTrPosResponseDataMapper.supports('PayTrPos')).toBe(true)
    expect(PayTrPosResponseDataMapper.supports('AkbankPos')).toBe(false)
  })

  it('map3DPaymentData throws', () => {
    expect(() => mapper.map3DPaymentData({}, {}, TX_TYPE.PAY_AUTH, {} as PosOrder)).toThrow(NotImplementedError)
  })

  it('mapCancelResponse throws', () => {
    expect(() => mapper.mapCancelResponse({})).toThrow(NotImplementedError)
  })

  it('mapOrderHistoryResponse throws', () => {
    expect(() => mapper.mapOrderHistoryResponse({})).toThrow(NotImplementedError)
  })

  it.each([
    ['success', true],
    ['failed', false],
    ['error', false],
    [null, false],
    // addition: only the exact word approves
    [' success', false],
    ['SUCCESS', false],
    ['success ', false],
  ])('is3dAuthSuccess(%j) -> %j', (mdStatus, expected) => {
    expect(mapper.is3dAuthSuccess(mdStatus)).toBe(expected)
  })

  it.each([
    [{ status: 'success' }, 'success'],
    [{ status: 'failed' }, 'failed'],
    [{}, null],
    // addition: non-text and inherited values read as null
    [{ status: 1 }, null],
    [{ status: ['success'] }, null],
    [Object.create({ status: 'success' }), null],
  ])('extractMdStatus(%j) -> %j', (data, expected) => {
    expect(mapper.extractMdStatus(data as Data)).toBe(expected)
  })

  /** Checks that the approval time is within the test window, then drops it. */
  function checkTime(actual: Data, expected: Data, before: number, after: number): void {
    if (actual.transaction_time instanceof Date) {
      expect(actual.transaction_time.getTime()).toBeGreaterThanOrEqual(before)
      expect(actual.transaction_time.getTime()).toBeLessThanOrEqual(after)
      delete actual.transaction_time
      delete expected.transaction_time
    }
  }

  it.each(Object.entries(paymentCases))('mapPaymentResponse: %s', (_name, c: Case) => {
    const before = Date.now()
    const actual = mapper.mapPaymentResponse(c.responseData, TX_TYPE.PAY_AUTH, (c.order ?? {}) as PosOrder) as Data
    const after = Date.now()
    expect(actual).toHaveProperty('all')
    delete actual.all
    const expected = { ...c.expectedData }
    checkTime(actual, expected, before, after)
    expect(sorted(actual)).toStrictEqual(sorted(expected))
  })

  it.each(Object.entries(threeDHostCases))('map3DHostResponseData: %s', (_name, c: Case) => {
    const before = Date.now()
    const actual = mapper.map3DHostResponseData(c.responseData, TX_TYPE.PAY_AUTH, {} as PosOrder) as Data
    const after = Date.now()
    expect(actual).toHaveProperty('all')
    delete actual.all
    const expected = { ...c.expectedData }
    checkTime(actual, expected, before, after)
    expect(sorted(actual)).toStrictEqual(sorted(expected))
  })

  it.each(Object.entries(threeDPayCases))('map3DPayResponseData: %s', (_name, c: Case) => {
    const actual = mapper.map3DPayResponseData(c.responseData, TX_TYPE.PAY_AUTH, {} as PosOrder) as Data
    expect(actual).toHaveProperty('all')
    delete actual.all
    const expected = { ...c.expectedData }
    // The approval time is "now", so it is dropped before the comparison.
    if (actual.transaction_time instanceof Date) {
      delete actual.transaction_time
      delete expected.transaction_time
    }
    expect(sorted(actual)).toStrictEqual(sorted(expected))
  })

  it.each(Object.entries(statusCases))('mapStatusResponse: %s', (_name, c: Case) => {
    const actual = mapper.mapStatusResponse(c.responseData) as Data
    expect(actual).toHaveProperty('all')
    delete actual.all
    for (const key of ['transaction_time', 'capture_time', 'refund_time']) {
      expect(actual[key]).toEqual(c.expectedData[key])
      actual[key] = c.expectedData[key]
    }
    expect(sorted(actual)).toStrictEqual(sorted(c.expectedData))
  })

  it.each(Object.entries(refundCases))('mapRefundResponse: %s', (_name, c: Case) => {
    const actual = mapper.mapRefundResponse(c.responseData) as Data
    expect(actual).toHaveProperty('all')
    delete actual.all
    // deviation: L5 the refund result carries `proc_return_code` (null) like every other result
    expect(sorted(actual)).toStrictEqual(sorted(withBaseKeys(c.expectedData)))
  })

  describe('approval guards', () => {
    const approvedBody = { merchant_oid: 'o1', status: 'success', total_amount: '1001', currency: 'TL' }

    // addition: a status that is not exactly the word success never approves, on every path
    it.each([
      [' success'],
      ['success '],
      ['SUCCESS'],
      ['Success'],
      ['success\n'],
      ['wait_callback'],
      [''],
      [1],
      [true],
      [['success']],
      [{ a: 'success' }],
      [null],
    ])('status %j is declined on every path', (status) => {
      const body = { ...approvedBody, status }
      for (const result of [
        mapper.mapPaymentResponse(body, TX_TYPE.PAY_AUTH, { id: 'o1' } as PosOrder),
        mapper.map3DPayResponseData(body, TX_TYPE.PAY_AUTH, {} as PosOrder),
        mapper.map3DHostResponseData(body, TX_TYPE.PAY_AUTH, {} as PosOrder),
        mapper.mapRefundResponse({ ...body, return_amount: '1.00' }),
        mapper.mapStatusResponse({ ...body, payment_total: '10.01' }),
      ]) {
        expect(result.status).toBe('declined')
        expect(result.amount ?? null).toBeNull()
        expect(result.refund_amount ?? null).toBeNull()
      }
    })

    // addition: a body inherited from a prototype carries no result
    it('inherited status never approves', () => {
      const body = Object.assign(Object.create({ status: 'success', total_amount: '1001' }), {
        merchant_oid: 'o1',
        x: 'y',
      })
      expect(mapper.map3DPayResponseData(body, TX_TYPE.PAY_AUTH, {} as PosOrder).status).toBe('declined')
      expect(mapper.mapPaymentResponse(body, TX_TYPE.PAY_AUTH, { id: 'o1' } as PosOrder).status).toBe('declined')
      expect(mapper.mapStatusResponse(body).status).toBe('declined')
      expect(mapper.mapRefundResponse(body).status).toBe('declined')
    })

    // addition: the value mapper alone never lets a non-secure wait_callback or an empty answer look approved
    it('wait_callback, empty and unreadable non-secure answers map to declined without codes', () => {
      for (const body of [{ status: 'wait_callback' }, {}, { status: 'x' }, { merchant_oid: 'o1' }]) {
        const r = mapper.mapPaymentResponse(body, TX_TYPE.PAY_AUTH, { id: 'o1' } as PosOrder)
        expect(r.status).toBe('declined')
        expect(r.amount).toBeNull()
        expect(r.transaction_time).toBeNull()
      }
    })

    // addition: approved callback needs a readable own kuruş total, never a made-up amount
    it('non-string status (1, array) is declined', () => {
      for (const status of [1, ['success']]) {
        const r = mapper.map3DPayResponseData({ ...approvedBody, status }, TX_TYPE.PAY_AUTH, {} as PosOrder)
        expect(r.status).toBe('declined')
        expect(r.md_status ?? null).toBeNull()
      }
    })
  })

  describe('additions', () => {
    // addition: a one-key body that is not fail_message reads no message
    it('one-key body { x: y } -> md_error_message null', () => {
      for (const r of [
        mapper.map3DPayResponseData({ x: 'y' }, TX_TYPE.PAY_AUTH, {} as PosOrder),
        mapper.map3DHostResponseData({ x: 'y' }, TX_TYPE.PAY_AUTH, {} as PosOrder),
      ]) {
        expect(r.md_error_message).toBeNull()
        expect(r.status).toBe('declined')
      }
    })

    // addition: a one-key success is not an approval (a real notification carries more fields)
    it('one-key { status: success } is declined', () => {
      expect(mapper.map3DPayResponseData({ status: 'success' }, TX_TYPE.PAY_AUTH, {} as PosOrder).status).toBe(
        'declined',
      )
    })

    // addition: control characters and length of the browser-supplied message
    it('fail_message is plain text of at most 256 characters', () => {
      const r = mapper.map3DPayResponseData(
        { fail_message: `a\u0000b\n${'x'.repeat(400)}` },
        TX_TYPE.PAY_AUTH,
        {} as PosOrder,
      )
      expect(r.md_error_message).toMatch(/^ab[x]{254}$/)
      expect(
        mapper.map3DPayResponseData({ fail_message: { a: 1 } }, TX_TYPE.PAY_AUTH, {} as PosOrder).md_error_message,
      ).toBeNull()
    })

    // addition: line separators and bidi controls are removed, and a cut never splits a surrogate pair
    it('fail_message loses line separators and bidi controls and is cut on character boundaries', () => {
      const map = (fail_message: string) =>
        mapper.map3DPayResponseData({ fail_message }, TX_TYPE.PAY_AUTH, {} as PosOrder).md_error_message
      expect(map('a\u2028b\u2029c\u202Ad\u202Ee\u2066f\u2069g')).toBe('abcdefg')
      const cut = map(`${'x'.repeat(255)}\u{1F600}tail`) as string
      expect(cut).toBe('x'.repeat(255))
      expect(map(`${'x'.repeat(254)}\u{1F600}tail`)).toBe(`${'x'.repeat(254)}\u{1F600}`)
      expect(cut).not.toMatch(/[\uD800-\uDFFF]/)
    })

    // addition: an approved body without installment_count/currency maps both to null
    it('approved body without installment_count and currency', () => {
      const r = mapper.map3DPayResponseData(
        { merchant_oid: 'o1', status: 'success', total_amount: '1050' },
        TX_TYPE.PAY_AUTH,
        {} as PosOrder,
      )
      expect(r.status).toBe('approved')
      expect(r.installment_count).toBeNull()
      expect(r.currency).toBeNull()
      expect(r.amount).toBe(10.5)
    })

    // addition: unreadable or non-kuruş total amounts map to null, never 0 or NaN
    it.each([['abc'], ['10.50'], ['-5'], [' 1001'], ['1e3'], [''], [['1001']], [{ a: 1 }], [1001.5]])(
      'total_amount %j -> amount null',
      (total) => {
        const body = { merchant_oid: 'o1', status: 'success', total_amount: total, currency: 'TL' }
        expect(mapper.map3DPayResponseData(body, TX_TYPE.PAY_AUTH, {} as PosOrder).amount).toBeNull()
        expect(mapper.mapPaymentResponse(body, TX_TYPE.PAY_AUTH, { id: 'o1' } as PosOrder).amount).toBeNull()
      },
    )

    // addition: non-scalar bank values never become "[object Object]"
    it('non-scalar fields map to null', () => {
      const r = mapper.map3DPayResponseData(
        {
          merchant_oid: { a: 1 },
          status: 'success',
          total_amount: '1001',
          currency: ['TL'],
          installment_count: { a: 1 },
        },
        TX_TYPE.PAY_AUTH,
        {} as PosOrder,
      )
      expect(r.order_id).toBeNull()
      expect(r.currency).toBeNull()
      expect(r.installment_count).toBeNull()
      const d = mapper.map3DPayResponseData(
        { merchant_oid: 'o1', status: 'failed', failed_reason_code: { a: 1 }, failed_reason_msg: ['x'] },
        TX_TYPE.PAY_AUTH,
        {} as PosOrder,
      )
      expect(d.error_code).toBeNull()
      expect(d.error_message).toBeNull()
    })

    // addition: reason code format and message cleaning on declines
    it('failed_reason_code must be a short token; message loses control characters and is capped', () => {
      const d = mapper.map3DPayResponseData(
        {
          merchant_oid: 'o1',
          status: 'failed',
          failed_reason_code: '<b>x</b>',
          failed_reason_msg: `a\u0007${'m'.repeat(300)}`,
        },
        TX_TYPE.PAY_AUTH,
        {} as PosOrder,
      )
      expect(d.error_code).toBeNull()
      expect(d.error_message).toMatch(/^a[m]{255}$/)
    })

    // addition: non-secure failure message may come as msg (official)
    it('payment decline reads msg when failed_reason_msg is absent', () => {
      const r = mapper.mapPaymentResponse({ status: 'failed', msg: 'Kart reddedildi' }, TX_TYPE.PAY_AUTH, {
        id: 'o1',
      } as PosOrder)
      expect(r.error_message).toBe('Kart reddedildi')
    })

    // addition: status amounts
    it('status payment_total with a decimal comma', () => {
      const r = mapper.mapStatusResponse({ status: 'success', payment_total: '10,8', returns: [] })
      expect(r.capture_amount).toBe(10.8)
    })

    it.each([['abc'], ['1.005'], ['1.0050'], [' 1'], ['-1'], ['1e2'], [['1']], [{ a: 1 }], [true]])(
      'status amount %j -> null',
      (amount) => {
        const r = mapper.mapStatusResponse({
          status: 'success',
          payment_amount: amount,
          payment_total: amount,
          returns: [],
        })
        expect(r.first_amount).toBeNull()
        expect(r.capture_amount).toBeNull()
        expect(r.capture).toBe(false)
      },
    )

    it('status amounts given as numbers are read', () => {
      const r = mapper.mapStatusResponse({ status: 'success', payment_amount: 10.5, payment_total: 10.5 })
      expect(r.first_amount).toBe(10.5)
      expect(r.capture_amount).toBe(10.5)
    })

    // addition: refund entries
    it('returns that are not an array are ignored', () => {
      for (const returns of ['x', { a: 1 }, 5, null]) {
        const r = mapper.mapStatusResponse({ status: 'success', payment_total: '10.00', returns })
        expect(r.refund_amount).toBeNull()
        expect(r.order_status).toBe(PAYMENT_STATUS.PAYMENT_COMPLETED)
      }
    })

    it('null, non-record and unreadable return entries are skipped', () => {
      const r = mapper.mapStatusResponse({
        status: 'success',
        payment_total: '10.00',
        returns: [null, 'x', 5, [], { return_amount: 'x' }, { return_amount: '3.00', return_date: '24.06.2026' }],
      })
      expect(r.refund_amount).toBe(3)
      expect(r.refund_time).toEqual(new Date('2026-06-24T00:00:00+03:00'))
      expect(r.order_status).toBe(PAYMENT_STATUS.PARTIALLY_REFUNDED)
    })

    it('only unreadable return entries leave the refund amount null', () => {
      const r = mapper.mapStatusResponse({
        status: 'success',
        payment_total: '10.00',
        returns: [{ return_amount: 'x' }, null],
      })
      expect(r.refund_amount).toBeNull()
      expect(r.order_status).toBe(PAYMENT_STATUS.PAYMENT_COMPLETED)
    })

    it('the refund_amount key of a return is not read', () => {
      const r = mapper.mapStatusResponse({
        status: 'success',
        payment_total: '10.00',
        returns: [{ refund_amount: '1000', return_date: '25.06.2026' }],
      })
      expect(r.refund_amount).toBeNull()
      expect(r.order_status).toBe(PAYMENT_STATUS.PAYMENT_COMPLETED)
    })

    // addition: kuruş sum, no float drift
    it('4.00 + 6.01 against 10.01 is fully refunded with 10.01', () => {
      const r = mapper.mapStatusResponse({
        status: 'success',
        payment_total: '10.01',
        returns: [
          { return_amount: '4.00', return_date: '24.06.2026' },
          { return_amount: '6.01', return_date: '25.06.2026' },
        ],
      })
      expect(r.order_status).toBe(PAYMENT_STATUS.FULLY_REFUNDED)
      expect(r.refund_amount).toBe(10.01)
      expect(r.refund_time).toEqual(new Date('2026-06-25T00:00:00+03:00'))
    })

    it('0.1 + 0.2 style sums stay exact', () => {
      const r = mapper.mapStatusResponse({
        status: 'success',
        payment_total: '0.30',
        returns: [{ return_amount: '0.10' }, { return_amount: '0.20' }],
      })
      expect(r.refund_amount).toBe(0.3)
      expect(r.order_status).toBe(PAYMENT_STATUS.FULLY_REFUNDED)
    })

    it('a refund above zero without a readable total stays payment completed', () => {
      const r = mapper.mapStatusResponse({ status: 'success', returns: [{ return_amount: '1.00' }] })
      expect(r.refund_amount).toBe(1)
      expect(r.order_status).toBe(PAYMENT_STATUS.PAYMENT_COMPLETED)
    })

    // addition: dates
    it('unreadable payment_date -> null and one warning naming the field', () => {
      for (const date of ['yesterday', 'now', '2026-13-45 99:99:99', '31.02.2026', '2026-06-23T14:30:00Z']) {
        logger.warn.mockClear()
        const r = mapper.mapStatusResponse({ status: 'success', payment_date: date, payment_total: '1.00' })
        expect(r.transaction_time).toBeNull()
        expect(r.capture_time).toBeNull()
        expect(r.status).toBe('approved')
        expect(logger.warn).toHaveBeenCalledTimes(1)
        expect(warnedFields()).toEqual(['payment_date'])
      }
    })

    it('non-text payment_date -> null without a throw', () => {
      for (const date of [{ a: 1 }, ['23.06.2026'], 20260623, true, '']) {
        const r = mapper.mapStatusResponse({ status: 'success', payment_date: date })
        expect(r.transaction_time).toBeNull()
      }
    })

    it('payment_date 2026-06-23 14:30:00 is Türkiye time', () => {
      const r = mapper.mapStatusResponse({ status: 'success', payment_date: '2026-06-23 14:30:00' })
      expect(r.transaction_time).toEqual(new Date('2026-06-23T14:30:00+03:00'))
      expect(r.capture_time).toEqual(new Date('2026-06-23T14:30:00+03:00'))
    })

    it('unreadable return_date -> refund_time null, warning names the field', () => {
      const r = mapper.mapStatusResponse({
        status: 'success',
        payment_total: '10.00',
        returns: [{ return_amount: '1.00', return_date: 'soon' }],
      })
      expect(r.refund_amount).toBe(1)
      expect(r.refund_time).toBeNull()
      expect(warnedFields()).toEqual(['return_date'])
    })

    // addition: status decline reads
    it('declined status without err_no -> error_code null', () => {
      const r = mapper.mapStatusResponse({ status: 'error' })
      expect(r.status).toBe('declined')
      expect(r.error_code).toBeNull()
      expect(r.error_message).toBeNull()
      expect(mapper.mapStatusResponse({}).status).toBe('declined')
    })

    it('status installment, currency and card number of other kinds map to null', () => {
      const r = mapper.mapStatusResponse({
        status: 'success',
        taksit: { a: 1 },
        currency: ['TL'],
        masked_pan: { a: 1 },
      })
      expect(r.installment_count).toBeNull()
      expect(r.currency).toBeNull()
      expect(r.masked_number).toBeNull()
      const n = mapper.mapStatusResponse({ status: 'success', taksit: 3, currency: 'JPY' })
      expect(n.installment_count).toBe(3)
      expect(n.currency).toBeNull()
    })

    // addition: refund decline reads
    it('refund declined without err_no/err_msg -> nulls', () => {
      const r = mapper.mapRefundResponse({ status: 'error' })
      expect(r.status).toBe('declined')
      expect(r.error_code).toBeNull()
      expect(r.error_message).toBeNull()
      expect(mapper.mapRefundResponse({}).status).toBe('declined')
    })

    it('refund amounts: unreadable -> null, comma read as a dot, reference number kept', () => {
      expect(mapper.mapRefundResponse({ status: 'success', return_amount: 'x' }).refund_amount).toBeNull()
      expect(mapper.mapRefundResponse({ status: 'success', return_amount: '1.005' }).refund_amount).toBeNull()
      expect(mapper.mapRefundResponse({ status: 'success', return_amount: '6,50' }).refund_amount).toBe(6.5)
      const r = mapper.mapRefundResponse({ status: 'success', merchant_oid: 'o1', reference_no: 'REF1' })
      expect(r.ref_ret_num).toBe('REF1')
      expect(r.order_id).toBe('o1')
    })

    // addition: payTrDecimalKurus
    it.each([
      ['10.50', 1050],
      ['10,5', 1050],
      ['1.005', null],
      ['1.0050', null],
      ['1.0000', 100],
      [' 1', null],
      ['1 ', null],
      ['', null],
      ['0', 0],
      ['0.00', 0],
      ['.5', null],
      ['1.', null],
      ['-1', null],
      ['1e3', null],
      ['9999999999999.99', 999999999999999],
      ['10000000000000', null],
      [10.5, 1050],
      [Number.NaN, null],
      [Number.POSITIVE_INFINITY, null],
      [-1, null],
      [null, null],
      [true, null],
      [['1'], null],
      [{ a: 1 }, null],
    ])('payTrDecimalKurus(%j) -> %j', (value, expected) => {
      expect(payTrDecimalKurus(value)).toBe(expected)
    })
  })

  it('keeps the model of each callback path', () => {
    expect(mapper.map3DPayResponseData({}, TX_TYPE.PAY_AUTH, {} as PosOrder).payment_model).toBe(MODEL.THREE_D_PAY)
    expect(mapper.map3DHostResponseData({}, TX_TYPE.PAY_AUTH, {} as PosOrder).payment_model).toBe(MODEL.THREE_D_HOST)
  })
})
