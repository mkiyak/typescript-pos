import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InterPosResponseDataMapper } from '../../../../../src/data-mapper/response/mapper/InterPosResponseDataMapper.js'
import { InterPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/InterPosResponseValueFormatter.js'
import type { ResponseValueFormatterInterface } from '../../../../../src/data-mapper/response/value-formatter/ResponseValueFormatterInterface.js'
import { InterPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/InterPosResponseValueMapper.js'
import type { ResponseValueMapperInterface } from '../../../../../src/data-mapper/response/value-mapper/ResponseValueMapperInterface.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import type { PosLogger } from '../../../../../src/logger.js'
import type { PosOrder } from '../../../../../src/types.js'
import {
  cancelTestDataProvider,
  paymentTestDataProvider,
  provisionSuccess,
  refundTestDataProvider,
  STUB_TIME,
  statusTestDataProvider,
  threeDHostPaymentDataProvider,
  threeDPaymentDataProvider,
  threeDPayPaymentDataProvider,
  threeDSuccessCallback,
} from './InterPosResponseDataMapper.data.js'

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

/** Same keys (in any order) with identical values. */
function expectSameSorted(actual: Data, expected: Data): void {
  expect(Object.keys(actual).sort()).toStrictEqual(Object.keys(expected).sort())
  expect(actual).toStrictEqual(expected)
}

/** Checks that the key holds a non-empty object, then removes it so the rest can be compared exactly. */
function takeNonEmpty(actual: Data, key: string): void {
  expect(actual).toHaveProperty(key)
  const value = actual[key]
  expect(value !== null && typeof value === 'object').toBe(true)
  expect(Object.keys(value as Data).length).toBeGreaterThan(0)
  delete actual[key]
}

describe('InterPosResponseDataMapper', () => {
  let formatter: Mocked<ResponseValueFormatterInterface>
  let valueMapper: Mocked<ResponseValueMapperInterface>
  let logger: Mocked<PosLogger>
  let mapper: InterPosResponseDataMapper

  beforeEach(() => {
    formatter = { formatInstallment: vi.fn(), formatAmount: vi.fn(), formatDateTime: vi.fn() }
    valueMapper = {
      mapTxType: vi.fn(),
      mapSecureType: vi.fn(),
      mapCurrency: vi.fn(),
      mapOrderStatus: vi.fn(),
      mapCardType: vi.fn(),
      mapCardFamilyName: vi.fn(),
      mapCardClass: vi.fn(),
    }
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    mapper = new InterPosResponseDataMapper(
      formatter as unknown as ResponseValueFormatterInterface,
      valueMapper as unknown as ResponseValueMapperInterface,
      logger as unknown as PosLogger,
    )
  })

  const realMapper = (log?: PosLogger) =>
    new InterPosResponseDataMapper(new InterPosResponseValueFormatter(), new InterPosResponseValueMapper(), log)

  it('supports', () => {
    expect(InterPosResponseDataMapper.supports('InterPos')).toBe(true)
    expect(InterPosResponseDataMapper.supports('AkbankPos')).toBe(false)
  })

  it.each([
    [null, false],
    ['', false],
    ['2', true],
    ['3', true],
    ['4', true],
    ['7', false],
    ['1', true],
  ])('is3dAuthSuccess(%j) -> %j', (mdStatus, expected) => {
    expect(mapper.is3dAuthSuccess(mdStatus)).toBe(expected)
  })

  it.each([
    [{}, null],
    [{ '3DStatus': '1' }, '1'],
  ])('extractMdStatus(%j) -> %j', (data, expected) => {
    expect(mapper.extractMdStatus(data)).toBe(expected)
  })

  it.each(paymentTestDataProvider)('mapPaymentResponse %s', (_name, { order, txType, responseData, expectedData }) => {
    if (expectedData.transaction_time instanceof Date) {
      formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
    }

    const actual: Data = mapper.mapPaymentResponse(responseData, txType as never, order as PosOrder)

    expect(actual).toHaveProperty('all')
    if (Object.keys(responseData).length > 0) takeNonEmpty(actual, 'all')
    else delete actual.all
    if (expectedData.transaction_time instanceof Date) {
      expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
      expect(formatter.formatDateTime).toHaveBeenCalledWith(responseData.TRXDATE ?? 'now', txType)
    }
    expectSameSorted(actual, expectedData)
  })

  it.each(threeDPaymentDataProvider)(
    'map3DPaymentData %s',
    (_name, { order, txType, threeDResponseData, paymentData, expectedData }) => {
      if (expectedData.transaction_time instanceof Date) {
        formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
      }
      formatter.formatAmount.mockReturnValue(expectedData.amount)
      valueMapper.mapCurrency.mockReturnValue(expectedData.currency)

      const actual: Data = mapper.map3DPaymentData(threeDResponseData, paymentData, txType as never, order as PosOrder)

      if (expectedData.transaction_time instanceof Date) {
        expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
        expect(formatter.formatDateTime).toHaveBeenCalledWith(paymentData.TRXDATE ?? threeDResponseData.TRXDATE, txType)
      }
      expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
      expect(formatter.formatAmount).toHaveBeenCalledWith(threeDResponseData.PurchAmount, txType)
      expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapCurrency).toHaveBeenCalledWith(threeDResponseData.Currency, txType)

      expect(actual).toHaveProperty('all')
      if (Object.keys(paymentData).length > 0) takeNonEmpty(actual, 'all')
      else delete actual.all
      takeNonEmpty(actual, '3d_all')
      expectSameSorted(actual, expectedData)
    },
  )

  it.each(threeDPayPaymentDataProvider)(
    'map3DPayResponseData %s',
    (_name, { order, txType, paymentData, expectedData }) => {
      formatter.formatAmount.mockReturnValue(expectedData.amount)
      valueMapper.mapCurrency.mockReturnValue(expectedData.currency)

      const actual: Data = mapper.map3DPayResponseData(paymentData, txType as never, order as PosOrder)

      expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
      expect(formatter.formatAmount).toHaveBeenCalledWith(paymentData.PurchAmount, txType)
      expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapCurrency).toHaveBeenCalledWith(paymentData.Currency, txType)
      takeNonEmpty(actual, 'all')
      expectSameSorted(actual, expectedData)
    },
  )

  it.each(threeDHostPaymentDataProvider)(
    'map3DHostResponseData %s',
    (_name, { order, txType, paymentData, expectedData }) => {
      formatter.formatAmount.mockReturnValue(expectedData.amount)
      valueMapper.mapCurrency.mockReturnValue(expectedData.currency)

      const actual: Data = mapper.map3DHostResponseData(paymentData, txType as never, order as PosOrder)

      expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
      expect(formatter.formatAmount).toHaveBeenCalledWith(paymentData.PurchAmount, txType)
      expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapCurrency).toHaveBeenCalledWith(paymentData.Currency, txType)
      takeNonEmpty(actual, 'all')
      expectSameSorted(actual, expectedData)
    },
  )

  it.each(statusTestDataProvider)('mapStatusResponse %s', (_name, { responseData, expectedData }) => {
    const actual: Data = mapper.mapStatusResponse(responseData)

    // the zero amounts and the placeholder void date are never converted
    expect(formatter.formatAmount).not.toHaveBeenCalled()
    expect(formatter.formatDateTime).not.toHaveBeenCalled()
    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expectedData)
  })

  it.each(refundTestDataProvider)('mapRefundResponse %s', (_name, { responseData, expectedData }) => {
    const actual: Data = mapper.mapRefundResponse(responseData)

    takeNonEmpty(actual, 'all')
    expect(actual).toStrictEqual(expectedData)
  })

  it.each(cancelTestDataProvider)('mapCancelResponse %s', (_name, { responseData, expectedData }) => {
    const actual: Data = mapper.mapCancelResponse(responseData)

    takeNonEmpty(actual, 'all')
    expect(actual).toStrictEqual(expectedData)
  })

  // deviation: F30 NotImplementedError instead of a plain not-implemented exception
  it('mapOrderHistoryResponse is not supported', () => {
    expect(() => mapper.mapOrderHistoryResponse({})).toThrow(NotImplementedError)
  })

  describe('additions with the real formatter and value mapper', () => {
    const order = { id: '33554969', amount: 1, currency: 'TRY' } as PosOrder
    const pay3dCallback: Data = {
      ShopCode: '3123',
      TxnStat: 'Y',
      Eci: '02',
      Pan: '540061******0430',
      OrderId: '20221225B83B',
      PurchAmount: '1,01',
      Currency: '949',
      '3DStatus': '1',
      mdStatus: '1',
      ProcReturnCode: '00',
      AuthCode: 'A1B2C3',
      TransId: 'T-1',
      TRXDATE: '09.08.2024 10:40:34',
      ErrorMessage: '',
      ErrorCode: '',
      HASH: 'x',
    }

    // addition: the full 3D model success path with real conversions
    it('maps the successful 3D model payment', () => {
      const actual: Data = realMapper().map3DPaymentData(threeDSuccessCallback, provisionSuccess, 'pay', order)

      expect(actual.status).toBe('approved')
      expect(actual.amount).toBe(1)
      expect(actual.currency).toBe('TRY')
      // deviation: F25 bank times are Türkiye time, not the machine zone
      expect(actual.transaction_time).toStrictEqual(new Date('2024-08-09T10:40:34+03:00'))
      expect(actual.transaction_security).toBe('Full 3D Secure')
    })

    it('3DStatus 2 is half 3D secure', () => {
      const actual: Data = realMapper().map3DPaymentData(
        { ...threeDSuccessCallback, '3DStatus': '2' },
        provisionSuccess,
        'pay',
        order,
      )

      expect(actual.transaction_security).toBe('Half 3D Secure')
      expect(actual.md_status).toBe('2')
    })

    // addition: an approved hosted callback maps as approved
    it('maps an approved 3D Pay callback', () => {
      const actual: Data = realMapper().map3DPayResponseData(pay3dCallback, 'pay', order)

      expect(actual.status).toBe('approved')
      expect(actual.amount).toBe(1.01)
      expect(actual.payment_model).toBe('3d_pay')
      expect(actual.order_id).toBe('20221225B83B')
      expect(actual.transaction_time).toStrictEqual(new Date('2024-08-09T10:40:34+03:00'))
    })

    // addition: the mapper itself approves on ProcReturnCode 00; the gateway applies the 3D rule
    it('an approved 3D Pay callback with a failed 3D leg is still mapped approved', () => {
      const actual: Data = realMapper().map3DPayResponseData(
        { ...pay3dCallback, mdStatus: '0', '3DStatus': '0' },
        'pay',
        order,
      )

      expect(actual.status).toBe('approved')
      expect(actual.md_status).toBe('0')
      expect(actual.transaction_security).toBe('MPI fallback')
      expect(actual).not.toHaveProperty('requires_manual_review')
    })

    // addition: strict approval; each input would be approved if the code were trimmed or coerced
    it.each([' 00', '00 ', '0', '000', 'OO', ' 00 ', 0, 99, null, ['00'], { a: '00' }])(
      'ProcReturnCode %j never approves',
      (code) => {
        const m = realMapper()
        expect(m.mapPaymentResponse({ ProcReturnCode: code, OrderId: 'o1' }, 'pay', order).status).toBe('declined')
        expect(m.map3DPayResponseData({ ...pay3dCallback, ProcReturnCode: code }, 'pay', order).status).toBe('declined')
        expect(m.map3DHostResponseData({ ...pay3dCallback, ProcReturnCode: code }, 'pay', order).status).toBe(
          'declined',
        )
        expect(m.mapCancelResponse({ ProcReturnCode: code }).status).toBe('declined')
        expect(m.mapRefundResponse({ ProcReturnCode: code }).status).toBe('declined')
        expect(m.mapStatusResponse({ ProcReturnCode: code }).status).toBe('declined')
        expect(
          m.map3DPaymentData(threeDSuccessCallback, { ...provisionSuccess, ProcReturnCode: code }, 'pay', order).status,
        ).toBe('declined')
      },
    )

    // addition: a code that is not text is not read at all
    it.each([0, 99, null, ['00'], { a: '00' }])('ProcReturnCode %j maps to null', (code) => {
      const m = realMapper()
      expect(m.mapPaymentResponse({ ProcReturnCode: code, OrderId: 'o1' }, 'pay', order).proc_return_code).toBeNull()
      expect(m.mapCancelResponse({ ProcReturnCode: code }).proc_return_code).toBeNull()
      expect(m.mapRefundResponse({ ProcReturnCode: code }).proc_return_code).toBeNull()
      expect(m.mapStatusResponse({ ProcReturnCode: code }).proc_return_code).toBeNull()
    })

    // addition: the unpadded code approves (guards the cases above against a vacuous harness)
    it('the exact code 00 approves every path', () => {
      const m = realMapper()
      expect(m.mapPaymentResponse({ ProcReturnCode: '00' }, 'pay', order).status).toBe('approved')
      expect(m.mapCancelResponse({ ProcReturnCode: '00' }).status).toBe('approved')
      expect(m.mapRefundResponse({ ProcReturnCode: '00' }).status).toBe('approved')
      expect(m.mapStatusResponse({ ProcReturnCode: '00' }).status).toBe('approved')
      expect(m.map3DHostResponseData(pay3dCallback, 'pay', order).status).toBe('approved')
      expect(m.map3DPaymentData(threeDSuccessCallback, provisionSuccess, 'pay', order).status).toBe('approved')
    })

    // addition: the authentication status is the exact text; padded or non-text values are not trimmed into success
    it.each([' 1', '1 ', '01', 1, ['1'], { a: '1' }])('3DStatus %j is not an authentication success', (value) => {
      const m = realMapper()
      const callback = { ...pay3dCallback, '3DStatus': value }
      const actual: Data = m.map3DPayResponseData(callback, 'pay', order)

      expect(m.is3dAuthSuccess(m.extractMdStatus(callback))).toBe(false)
      expect(actual.transaction_security === 'Full 3D Secure').toBe(false)
    })

    it.each([
      ['1', true],
      [' 1', false],
    ])('3DStatus %j success flag %j', (value, expected) => {
      const m = realMapper()

      expect(m.is3dAuthSuccess(m.extractMdStatus({ '3DStatus': value }))).toBe(expected)
    })

    it('extractMdStatus reads own text fields only', () => {
      const inherited = Object.create({ '3DStatus': '1' }) as Data
      expect(mapper.extractMdStatus(inherited)).toBeNull()
      expect(mapper.extractMdStatus(null as never)).toBeNull()
      expect(mapper.extractMdStatus(undefined as never)).toBeNull()
      expect(mapper.extractMdStatus([] as never)).toBeNull()
      expect(mapper.extractMdStatus({ '3DStatus': 1 })).toBeNull()
    })

    // addition: status answer with real values
    it('maps an approved status record', () => {
      const actual: Data = realMapper().mapStatusResponse({
        OrderId: 'o1',
        ProcReturnCode: '00',
        PurchAmount: '1,01',
        AuthCode: 'A1',
        TRXDATE: '09.08.2024 10:40:34',
        VoidDate: '1.1.0001 00:00:00',
        RefundedAmount: '0',
      })

      expect(actual.status).toBe('approved')
      expect(actual.first_amount).toBe(1.01)
      expect(actual.auth_code).toBe('A1')
      expect(actual.transaction_time).toStrictEqual(new Date('2024-08-09T10:40:34+03:00'))
      expect(actual.cancel_time).toBeNull()
      expect(actual.refund_amount).toBeNull()
    })

    it('a real void date sets cancel_time', () => {
      const actual: Data = realMapper().mapStatusResponse({
        ProcReturnCode: '00',
        VoidDate: '10.08.2024 11:00:00',
      })

      expect(actual.cancel_time).toStrictEqual(new Date('2024-08-10T11:00:00+03:00'))
    })

    // deviation: F23 an unreadable void date leaves cancel_time null and logs a warning instead of throwing
    it('an unparseable void date does not throw', () => {
      const m = new InterPosResponseDataMapper(
        new InterPosResponseValueFormatter(),
        new InterPosResponseValueMapper(),
        logger as unknown as PosLogger,
      )
      const actual: Data = m.mapStatusResponse({ ProcReturnCode: '00', VoidDate: '9.8.2024 1:00' })

      expect(actual.cancel_time).toBeNull()
      expect(logger.warn).toHaveBeenCalledTimes(1)
    })

    it('an unparseable transaction date does not hide an approved payment', () => {
      const actual: Data = realMapper().mapPaymentResponse({ ProcReturnCode: '00', TRXDATE: 'garbage' }, 'pay', order)

      expect(actual.status).toBe('approved')
      expect(actual.transaction_time).toBeNull()
    })

    it.each([
      ['0', null],
      ['0,00', null],
      ['00', null],
      ['1,01', 1.01],
      ['1.056,2', 1056.2],
    ])('RefundedAmount %j -> refund_amount %j', (refunded, expected) => {
      const actual: Data = realMapper().mapStatusResponse({ ProcReturnCode: '00', RefundedAmount: refunded })

      expect(actual.refund_amount).toBe(expected)
    })

    it('empty answers map to declined shapes without throwing', () => {
      const m = realMapper()

      expect(m.mapStatusResponse({}).status).toBe('declined')
      expect(m.mapCancelResponse({}).status).toBe('declined')
      expect(m.mapRefundResponse({}).status).toBe('declined')
      expect(m.map3DPaymentData({}, null, 'pay', {} as PosOrder).status).toBe('declined')
      expect(m.map3DPayResponseData({}, 'pay', {} as PosOrder).status).toBe('declined')
      expect(m.mapPaymentResponse(null as never, 'pay', order).status).toBe('declined')
    })

    it('mapPaymentResponse without TRXDATE reads the current time', () => {
      const actual: Data = realMapper().mapPaymentResponse({ ProcReturnCode: '00' }, 'pay', {
        amount: 1,
        currency: 'TRY',
      } as PosOrder)

      expect(actual.status).toBe('approved')
      expect(actual.transaction_time).toBeInstanceOf(Date)
      expect(actual.amount).toBe(1)
      expect(actual.currency).toBe('TRY')
    })

    it('a provision without TRXDATE leaves transaction_time null', () => {
      const actual: Data = realMapper().map3DPaymentData(
        threeDSuccessCallback,
        { ProcReturnCode: '00' },
        'pay',
        {} as PosOrder,
      )

      expect(actual.status).toBe('approved')
      expect(actual.transaction_time).toBeNull()
    })

    it('a stubbed formatter result is passed through unchanged', () => {
      formatter.formatDateTime.mockReturnValue(STUB_TIME)
      const actual: Data = mapper.map3DPayResponseData(pay3dCallback, 'pay', order)

      expect(actual.transaction_time).toBe(STUB_TIME)
    })

    it('non-scalar bank values map to null', () => {
      const m = realMapper()
      const cancel: Data = m.mapCancelResponse({
        ProcReturnCode: '81',
        OrderId: { a: 1 },
        AuthCode: ['x'],
        TransId: { b: 'c' },
        ErrorCode: ['e'],
        ErrorMessage: { m: 1 },
      })
      expect(cancel.order_id).toBeNull()
      expect(cancel.auth_code).toBeNull()
      expect(cancel.transaction_id).toBeNull()
      expect(cancel.error_code).toBeNull()
      expect(cancel.error_message).toBeNull()

      const threeD: Data = m.map3DPayResponseData(
        {
          ProcReturnCode: '00',
          OrderId: { a: 1 },
          Pan: ['4'],
          Eci: { a: 1 },
          TxnStat: ['Y'],
          PurchAmount: { a: 1 },
          Currency: ['949'],
          TRXDATE: { d: 1 },
          '3DStatus': { a: 1 },
        },
        'pay',
        {} as PosOrder,
      )
      expect(threeD.order_id).toBeNull()
      expect(threeD.masked_number).toBeNull()
      expect(threeD.eci).toBeNull()
      expect(threeD.tx_status).toBeNull()
      expect(threeD.amount).toBeNull()
      expect(threeD.currency).toBeNull()
      expect(threeD.md_status).toBeNull()
      expect(threeD.transaction_time).toBeNull()

      const status: Data = m.mapStatusResponse({
        ProcReturnCode: '00',
        OrderId: { a: 1 },
        PurchAmount: { a: 1 },
        RefundedAmount: ['1'],
        VoidDate: { a: 1 },
      })
      expect(status.order_id).toBeNull()
      expect(status.first_amount).toBeNull()
      expect(status.refund_amount).toBeNull()
      expect(status.cancel_time).toBeNull()

      for (const result of [cancel, threeD, status]) {
        expect(JSON.stringify(result)).not.toContain('[object Object]')
      }
    })

    it('non-record input never throws', () => {
      const m = realMapper()
      for (const input of [null, undefined, 'x', 5, []] as never[]) {
        expect(m.mapCancelResponse(input).status).toBe('declined')
        expect(m.mapStatusResponse(input).status).toBe('declined')
        expect(m.map3DPayResponseData(input, 'pay', {} as PosOrder).status).toBe('declined')
        expect(m.extractMdStatus(input)).toBeNull()
      }
    })

    // addition: the card number and the CAVV never reach a logger unmasked
    it('logger contexts never contain an unmasked card number or the authentication code', () => {
      const calls: string[] = []
      const push = (message: string, context?: unknown) => calls.push(JSON.stringify([message, context]))
      const spy: PosLogger = { debug: push, info: push, warn: push, error: push }
      const m = realMapper(spy)
      const callback = {
        ...threeDSuccessCallback,
        Pan: '4155650100416111',
        PayerAuthenticationCode: 'cavv-secret-value-123=',
      }

      m.map3DPaymentData(callback, { ...provisionSuccess, Pan: '4155650100416111' }, 'pay', order)
      m.map3DPayResponseData({ ...callback, ProcReturnCode: '00' }, 'pay', order)
      m.mapPaymentResponse({ ProcReturnCode: '00', Pan: '4155650100416111' }, 'pay', order)

      expect(calls.length).toBeGreaterThan(0)
      for (const call of calls) {
        expect(call).not.toMatch(/\d{16}/)
        expect(call).not.toContain('cavv-secret-value-123')
      }
    })
  })
})
