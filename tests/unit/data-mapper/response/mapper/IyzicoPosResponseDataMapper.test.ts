import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IyzicoPosResponseDataMapper } from '../../../../../src/data-mapper/response/mapper/IyzicoPosResponseDataMapper.js'
import { IyzicoPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/IyzicoPosResponseValueFormatter.js'
import { IyzicoPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/IyzicoPosResponseValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import type { PosLogger } from '../../../../../src/logger.js'
import { MODEL, TX_TYPE } from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'
import {
  type Case,
  cancelCases,
  orderHistoryCases,
  paymentCases,
  refundCases,
  statusCases,
  threeDHostCases,
  threeDPaymentCases,
} from './IyzicoPosResponseDataMapper.data.js'

// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

function sorted(data: Data): Data {
  return Object.fromEntries(Object.entries(data).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

const ORDER = {} as PosOrder

describe('IyzicoPosResponseDataMapper', () => {
  let logger: { [K in keyof PosLogger]: ReturnType<typeof vi.fn> }
  let mapper: IyzicoPosResponseDataMapper

  beforeEach(() => {
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    mapper = new IyzicoPosResponseDataMapper(
      new IyzicoPosResponseValueFormatter(),
      new IyzicoPosResponseValueMapper(),
      logger as unknown as PosLogger,
    )
  })

  const warnedFields = (): unknown[] => logger.warn.mock.calls.map((c) => (c[1] as Data)?.field)

  const payment = (overrides: Data): Data => ({
    status: 'success',
    conversationId: 'order-1',
    systemTime: 1781209771102,
    paymentId: '1001',
    paidPrice: 10.01,
    installment: 1,
    currency: 'TRY',
    phase: 'AUTH',
    hostReference: 'ref',
    authCode: '123456',
    ...overrides,
  })

  it('supports', () => {
    expect(IyzicoPosResponseDataMapper.supports('IyzicoPos')).toBe(true)
    expect(IyzicoPosResponseDataMapper.supports('AkbankPos')).toBe(false)
    expect(IyzicoPosResponseDataMapper.PROCEDURE_SUCCESS_CODE).toBe('success')
  })

  it.each([
    [null, false],
    ['0', false],
    ['1', true],
    ['2', false],
    ['4', false],
    // addition: only the exact text approves
    [' 1', false],
    ['1 ', false],
  ])('is3dAuthSuccess(%j) -> %j', (mdStatus, expected) => {
    expect(mapper.is3dAuthSuccess(mdStatus)).toBe(expected)
  })

  it.each([
    [{}, null],
    [{ mdStatus: '1' }, '1'],
    [{ mdStatus: '0' }, '0'],
    // addition: a safe integer reads like its text; other kinds and inherited values are null
    [{ mdStatus: 1 }, '1'],
    [{ mdStatus: ['1'] }, null],
    [{ mdStatus: { a: 1 } }, null],
    [{ mdStatus: 1.5 }, null],
    [Object.create({ mdStatus: '1' }), null],
  ])('extractMdStatus(%j) -> %j', (data, expected) => {
    expect(mapper.extractMdStatus(data as Data)).toBe(expected)
  })

  it.each(Object.entries(paymentCases))('mapPaymentResponse: %s', (_name, c: Case) => {
    const actual = mapper.mapPaymentResponse(c.responseData, c.txType as never, ORDER) as Data
    expect(actual.all).toEqual(c.responseData)
    delete actual.all
    expect(sorted(actual)).toEqual(sorted(c.expectedData))
  })

  it.each(Object.entries(threeDPaymentCases))('map3DPaymentData: %s', (_name, c: Case) => {
    const actual = mapper.map3DPaymentData(c.responseData, c.paymentData ?? null, c.txType as never, ORDER) as Data
    expect(actual['3d_all']).toBe(c.responseData)
    delete actual['3d_all']
    expect(actual).toHaveProperty('all')
    delete actual.all
    expect(sorted(actual)).toEqual(sorted(c.expectedData))
  })

  it('map3DPayResponseData throws', () => {
    expect(() => mapper.map3DPayResponseData({}, TX_TYPE.PAY_AUTH, ORDER)).toThrow(NotImplementedError)
  })

  it.each(Object.entries(threeDHostCases))('map3DHostResponseData: %s', (_name, c: Case) => {
    const actual = mapper.map3DHostResponseData(c.responseData, c.txType as never, ORDER) as Data
    expect(actual.all).toEqual(c.responseData)
    delete actual.all
    expect(sorted(actual)).toEqual(sorted(c.expectedData))
  })

  it.each(Object.entries(cancelCases))('mapCancelResponse: %s', (_name, c: Case) => {
    const actual = mapper.mapCancelResponse(c.responseData) as Data
    expect(actual.all).toEqual(c.responseData)
    delete actual.all
    expect(sorted(actual)).toEqual(sorted(c.expectedData))
  })

  it.each(Object.entries(refundCases))('mapRefundResponse: %s', (_name, c: Case) => {
    const actual = mapper.mapRefundResponse(c.responseData) as Data
    expect(actual.all).toEqual(c.responseData)
    delete actual.all
    expect(sorted(actual)).toEqual(sorted(c.expectedData))
  })

  it.each(Object.entries(statusCases))('mapStatusResponse: %s', (_name, c: Case) => {
    const actual = mapper.mapStatusResponse(c.responseData) as Data
    expect(actual.all).toEqual(c.responseData)
    delete actual.all
    expect(sorted(actual)).toEqual(sorted(c.expectedData))
  })

  it.each(Object.entries(orderHistoryCases))('mapOrderHistoryResponse: %s', (_name, c: Case) => {
    const actual = mapper.mapOrderHistoryResponse(c.responseData) as Data
    expect(actual.all).toEqual(c.responseData)
    delete actual.all
    expect(sorted(actual)).toEqual(sorted(c.expectedData))
  })

  // ---- additions ----

  it('addition: an approved answer missing optional fields maps them to null without throwing', () => {
    const actual = mapper.mapPaymentResponse({ status: 'success', paymentId: '5' }, TX_TYPE.PAY_AUTH, ORDER) as Data
    expect(actual.status).toBe('approved')
    for (const key of ['order_id', 'transaction_time', 'installment_count', 'currency', 'amount', 'ref_ret_num']) {
      expect(actual[key]).toBeNull()
    }
    expect(actual.transaction_type).toBe(TX_TYPE.PAY_AUTH)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  // Each approval guard: the input below would be approved if the guard were removed.
  it.each([
    ['number 1', 1],
    ['list', ['success']],
    ['padded', ' success'],
    ['trailing space', 'success '],
    ['upper case', 'SUCCESS'],
    ['record', { a: 'success' }],
  ])('addition: a status that is %s is declined', (_name, status) => {
    const actual = mapper.mapPaymentResponse(payment({ status }), TX_TYPE.PAY_AUTH, ORDER) as Data
    expect(actual.status).toBe('declined')
    expect(actual.amount).toBeNull()
    expect(actual.auth_code).toBeNull()
  })

  it('addition: an inherited status never approves', () => {
    const raw = Object.assign(Object.create({ status: 'success' }), { conversationId: 'order-1', paymentId: '1' })
    const actual = mapper.mapPaymentResponse(raw, TX_TYPE.PAY_AUTH, ORDER) as Data
    expect(actual.status).toBe('declined')
  })

  it.each([
    ['cancel', (m: IyzicoPosResponseDataMapper, r: Data) => m.mapCancelResponse(r)],
    ['refund', (m: IyzicoPosResponseDataMapper, r: Data) => m.mapRefundResponse(r)],
    ['status', (m: IyzicoPosResponseDataMapper, r: Data) => m.mapStatusResponse(r)],
    ['order history', (m: IyzicoPosResponseDataMapper, r: Data) => m.mapOrderHistoryResponse(r)],
  ])('addition: %s with a non-exact status is declined', (_name, run) => {
    for (const status of [1, ['success'], ' success', 'Success']) {
      expect((run(mapper, { status, conversationId: 'o' }) as Data).status).toBe('declined')
    }
    const inherited = Object.create({ status: 'success' })
    expect((run(mapper, inherited) as Data).status).toBe('declined')
  })

  it('addition: the 3D Secure payment of a failed authentication is declined even with an approved payment answer', () => {
    const actual = mapper.map3DPaymentData(
      { mdStatus: '0', conversationId: 'order-1', status: 'success' },
      payment({}),
      TX_TYPE.PAY_AUTH,
      ORDER,
    ) as Data
    expect(actual.status).toBe('declined')
    expect(actual.amount).toBeNull()
    expect(actual.transaction_id).toBeNull()
  })

  it.each([[' 1'], ['1 '], [['1']], [undefined]])('addition: 3D Host with mdStatus %j is declined', (mdStatus) => {
    const actual = mapper.map3DHostResponseData(payment({ mdStatus }), TX_TYPE.PAY_AUTH, ORDER) as Data
    expect(actual.status).toBe('declined')
    expect(actual.amount).toBeNull()
  })

  it('addition: a numeric mdStatus 1 authenticates', () => {
    const actual = mapper.map3DHostResponseData(payment({ mdStatus: 1 }), TX_TYPE.PAY_AUTH, ORDER) as Data
    expect(actual.status).toBe('approved')
    expect(actual.md_status).toBe('1')
    expect(actual.payment_model).toBe(MODEL.THREE_D_HOST)
  })

  it('addition: systemTime that cannot be read leaves transaction_time null and warns once with the key only', () => {
    const actual = mapper.mapPaymentResponse(payment({ systemTime: 'x' }), TX_TYPE.PAY_AUTH, ORDER) as Data
    expect(actual.transaction_time).toBeNull()
    expect(actual.status).toBe('approved')
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0]?.[1]).toEqual({ field: 'systemTime' })
  })

  it('addition: an unreadable paidPrice leaves amount null and warns with the key only', () => {
    const actual = mapper.mapPaymentResponse(payment({ paidPrice: 'abc' }), TX_TYPE.PAY_AUTH, ORDER) as Data
    expect(actual.amount).toBeNull()
    expect(warnedFields()).toEqual(['paidPrice'])
  })

  it('addition: a paidPrice of 1e13 or more leaves amount null and warns with the key only', () => {
    const actual = mapper.mapPaymentResponse(payment({ paidPrice: 1e13 }), TX_TYPE.PAY_AUTH, ORDER) as Data
    expect(actual.amount).toBeNull()
    expect(warnedFields()).toEqual(['paidPrice'])
  })

  it('addition: non-scalar values never become text', () => {
    const actual = mapper.mapPaymentResponse(
      payment({
        conversationId: { a: 1 },
        paymentId: ['1'],
        authCode: {},
        hostReference: [1],
        currency: ['TRY'],
        installment: {},
      }),
      TX_TYPE.PAY_AUTH,
      ORDER,
    ) as Data
    for (const key of ['order_id', 'transaction_id', 'auth_code', 'ref_ret_num', 'currency', 'installment_count']) {
      expect(actual[key]).toBeNull()
    }
  })

  it('addition: the masked number needs a plain bin and last four digits', () => {
    const ok = mapper.mapPaymentResponse(
      payment({ binNumber: '460345', lastFourDigits: '0000' }),
      TX_TYPE.PAY_AUTH,
      ORDER,
    ) as Data
    expect(ok.masked_number).toBe('460345******0000')
    const bad = mapper.mapPaymentResponse(
      payment({ binNumber: '46<script>', lastFourDigits: '0000' }),
      TX_TYPE.PAY_AUTH,
      ORDER,
    ) as Data
    expect(bad.masked_number).toBeNull()
  })

  it('addition: order history skips payments that are not a list or not records', () => {
    const notList = mapper.mapOrderHistoryResponse({ status: 'success', conversationId: 'o', payments: 'x' }) as Data
    expect(notList.transactions).toEqual([])
    expect(notList.trans_count).toBe(0)
    const withNull = mapper.mapOrderHistoryResponse({
      status: 'success',
      conversationId: 'o',
      payments: [null, 'x', 7, { paymentId: 1, paymentStatus: 1, threeDS: 0, phase: 'AUTH' }],
    }) as Data
    expect(withNull.trans_count).toBe(1)
    expect(withNull.transactions).toHaveLength(1)
  })

  it('addition: order history ignores payments of a declined answer', () => {
    const actual = mapper.mapOrderHistoryResponse({
      status: 'failure',
      payments: [{ paymentId: 1, paymentStatus: 1 }],
    }) as Data
    expect(actual.status).toBe('declined')
    expect(actual.transactions).toEqual([])
  })

  it.each([
    [true, MODEL.THREE_D_SECURE],
    [1, MODEL.THREE_D_SECURE],
    [false, MODEL.NON_SECURE],
    [0, MODEL.NON_SECURE],
    [null, MODEL.NON_SECURE],
    [{}, null],
    [undefined, null],
  ])('addition: order history threeDS %j -> %j', (threeDS, expected) => {
    const payments = [{ paymentId: 1, paymentStatus: 1, phase: 'AUTH', ...(threeDS === undefined ? {} : { threeDS }) }]
    const actual = mapper.mapOrderHistoryResponse({ status: 'success', payments }) as Data
    expect(actual.transactions[0].payment_model).toBe(expected)
  })

  it('addition: order history paymentStatus "1" is approved like 1; other values are declined', () => {
    const run = (paymentStatus: unknown) =>
      (mapper.mapOrderHistoryResponse({ status: 'success', payments: [{ paymentId: 1, paymentStatus }] }) as Data)
        .transactions[0]
    expect(run('1').status).toBe('approved')
    expect(run(1).capture).toBe(true)
    expect(run(true).status).toBe('declined')
    expect(run(' 1').status).toBe('declined')
  })

  it('addition: an unreadable createdDate leaves transaction_time null and warns', () => {
    const actual = mapper.mapOrderHistoryResponse({
      status: 'success',
      payments: [{ paymentId: 1, paymentStatus: 1, createdDate: 'x' }],
    }) as Data
    expect(actual.transactions[0].transaction_time).toBeNull()
    expect(warnedFields()).toEqual(['createdDate'])
  })

  it('addition: createdDate without an offset is Türkiye time', () => {
    const actual = mapper.mapOrderHistoryResponse({
      status: 'success',
      payments: [{ paymentId: 1, paymentStatus: 1, createdDate: '2026-06-11 23:29:31' }],
    }) as Data
    expect(actual.transactions[0].transaction_time).toEqual(new Date('2026-06-11T23:29:31+03:00'))
  })

  it.each([[[{}]], [[null]], [['x']], ['x'], [{}]])(
    'addition: cancels %j gives cancel_time null or no key',
    (cancels) => {
      const actual = mapper.mapOrderHistoryResponse({
        status: 'success',
        payments: [{ paymentId: 1, paymentStatus: 1, cancels }],
      }) as Data
      const tx = actual.transactions[0]
      if (Array.isArray(cancels) && cancels.length > 0) expect(tx.cancel_time).toBeNull()
      else expect(tx).not.toHaveProperty('cancel_time')
    },
  )

  it('addition: a declined status answer without errorCode has error_code null', () => {
    const actual = mapper.mapStatusResponse({ status: 'failure', errorMessage: 'm' }) as Data
    expect(actual.status).toBe('declined')
    expect(actual.error_code).toBeNull()
    expect(actual.error_message).toBe('m')
  })

  it('addition: the debug log carries no raw answer', () => {
    mapper.mapPaymentResponse(payment({ binNumber: '460345', signature: 'abc' }), TX_TYPE.PAY_AUTH, ORDER)
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('460345')
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('abc')
  })

  it('addition: non-record input never throws', () => {
    for (const bad of [null, 'x', 5, [1]]) {
      expect(() => mapper.mapCancelResponse(bad as never)).not.toThrow()
      expect(() => mapper.mapRefundResponse(bad as never)).not.toThrow()
      expect(() => mapper.mapStatusResponse(bad as never)).not.toThrow()
      expect(() => mapper.mapOrderHistoryResponse(bad as never)).not.toThrow()
      expect((mapper.mapPaymentResponse(bad as never, TX_TYPE.PAY_AUTH, ORDER) as Data).status).toBe('declined')
    }
  })
})
