import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AkbankPosResponseDataMapper } from '../../../../../src/data-mapper/response/mapper/AkbankPosResponseDataMapper.js'
import { BasicResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import type { ResponseValueFormatterInterface } from '../../../../../src/data-mapper/response/value-formatter/ResponseValueFormatterInterface.js'
import { AkbankPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/AkbankPosResponseValueMapper.js'
import type { ResponseValueMapperInterface } from '../../../../../src/data-mapper/response/value-mapper/ResponseValueMapperInterface.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import type { PosLogger } from '../../../../../src/logger.js'
import { CURRENCY, TX_TYPE } from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'
import {
  cancelCases,
  orderHistoryCases,
  paymentCases,
  refundCases,
  threeDHostCases,
  threeDPayCases,
  threeDPaymentCases,
} from './AkbankPosResponseDataMapper.data.js'

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

/** PHP ksort + assertSame: same keys (any order) with identical values. */
function expectSameSorted(actual: Data, expected: Data): void {
  expect(Object.keys(actual).sort()).toStrictEqual(Object.keys(expected).sort())
  expect(actual).toStrictEqual(expected)
}

/** `assertArrayHasKey` + `assertIsArray` + `assertNotEmpty`, then `unset`. */
function takeNonEmpty(actual: Data, key: string): void {
  expect(actual).toHaveProperty(key)
  const value = actual[key]
  expect(value !== null && typeof value === 'object').toBe(true)
  expect(Object.keys(value as Data).length).toBeGreaterThan(0)
  delete actual[key]
}

describe('AkbankPosResponseDataMapper', () => {
  let formatter: Mocked<ResponseValueFormatterInterface>
  let valueMapper: Mocked<ResponseValueMapperInterface>
  let logger: Mocked<PosLogger>
  let mapper: AkbankPosResponseDataMapper

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
    mapper = new AkbankPosResponseDataMapper(
      formatter as unknown as ResponseValueFormatterInterface,
      valueMapper as unknown as ResponseValueMapperInterface,
      logger as unknown as PosLogger,
    )
  })

  /** The real formatter and value mapper, for the cases that need them. */
  function realMapper(): AkbankPosResponseDataMapper {
    return new AkbankPosResponseDataMapper(
      new BasicResponseValueFormatter(),
      new AkbankPosResponseValueMapper(),
      logger as unknown as PosLogger,
    )
  }

  it('supports', () => {
    expect(AkbankPosResponseDataMapper.supports('AkbankPos')).toBe(true)
    expect(AkbankPosResponseDataMapper.supports('AssecoPos')).toBe(false)
    expect(AkbankPosResponseDataMapper.PROCEDURE_SUCCESS_CODE).toBe('VPS-0000')
  })

  it.each([
    ['VPS-0000', true],
    ['VPS-1073', false],
  ])('is3dAuthSuccess(%j) -> %j', (mdStatus, expected) => {
    expect(mapper.is3dAuthSuccess(mdStatus)).toBe(expected)
  })

  it.each([
    [{}, null],
    [{ responseCode: 'VPS-0000' }, 'VPS-0000'],
  ])('extractMdStatus(%j) -> %j', (responseData, expected) => {
    expect(mapper.extractMdStatus(responseData)).toBe(expected)
  })

  // deviation: A22 status queries are not supported by this gateway
  it('mapStatusResponse is not supported', () => {
    expect(() => mapper.mapStatusResponse({})).toThrow(NotImplementedError)
  })

  describe('mapPaymentResponse', () => {
    it.each(Object.entries(paymentCases))('%s', (_name, c) => {
      const { order, txType, responseData, expectedData } = c as Data
      if (expectedData.transaction_time instanceof Date) {
        formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
      }
      valueMapper.mapTxType.mockReturnValue(expectedData.transaction_type)

      const actual = mapper.mapPaymentResponse(responseData, txType, order) as Data

      if (expectedData.transaction_time instanceof Date) {
        expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
        expect(formatter.formatDateTime).toHaveBeenCalledWith(responseData.txnDateTime, txType)
      }
      expect(valueMapper.mapTxType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapTxType).toHaveBeenCalledWith(responseData.txnCode)
      takeNonEmpty(actual, 'all')
      expectSameSorted(actual, expectedData)
    })
  })

  describe('map3DPaymentData', () => {
    it.each(Object.entries(threeDPaymentCases))('%s', (_name, c) => {
      const { order, txType, threeDResponseData, paymentData, expectedData } = c as Data
      if (expectedData.transaction_time instanceof Date) {
        formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
      }
      const hasTxnCode = paymentData.txnCode !== undefined
      if (hasTxnCode) {
        valueMapper.mapTxType.mockReturnValue(expectedData.transaction_type)
      }

      const actual = mapper.map3DPaymentData(threeDResponseData, paymentData, txType, order) as Data

      if (expectedData.transaction_time instanceof Date) {
        expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
        expect(formatter.formatDateTime).toHaveBeenCalledWith(paymentData.txnDateTime, txType)
        expect(actual.transaction_time).toBe(expectedData.transaction_time)
      }
      if (hasTxnCode) {
        expect(valueMapper.mapTxType).toHaveBeenCalledTimes(1)
        expect(valueMapper.mapTxType).toHaveBeenCalledWith(paymentData.txnCode)
      }
      takeNonEmpty(actual, '3d_all')
      if (Object.keys(paymentData).length > 0) {
        takeNonEmpty(actual, 'all')
      } else {
        expect(actual).toHaveProperty('all')
        delete actual.all
      }
      expectSameSorted(actual, expectedData)
    })
  })

  describe.each([
    ['map3DPayResponseData', threeDPayCases],
    ['map3DHostResponseData', threeDHostCases],
  ] as const)('%s', (method, cases) => {
    it.each(Object.entries(cases))('%s', (_name, c) => {
      const { order, txType, paymentData, expectedData } = c as Data
      if (expectedData.transaction_time instanceof Date) {
        formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
      }

      const actual = mapper[method](paymentData, txType, order) as Data

      if (expectedData.transaction_time instanceof Date) {
        expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
        expect(formatter.formatDateTime).toHaveBeenCalledWith(paymentData.txnDateTime, txType)
        expect(actual.transaction_time).toBe(expectedData.transaction_time)
      }
      expect(valueMapper.mapTxType).not.toHaveBeenCalled()
      takeNonEmpty(actual, 'all')
      // deviation: A9 key added
      expectSameSorted(actual, { ...expectedData, requires_manual_review: false })
    })
  })

  describe('mapRefundResponse', () => {
    it.each(Object.entries(refundCases))('%s', (_name, c) => {
      const { responseData, expectedData } = c as Data
      const actual = mapper.mapRefundResponse(responseData) as Data
      takeNonEmpty(actual, 'all')
      expectSameSorted(actual, expectedData)
    })
  })

  describe('mapCancelResponse', () => {
    it.each(Object.entries(cancelCases))('%s', (_name, c) => {
      const { responseData, expectedData } = c as Data
      const actual = mapper.mapCancelResponse(responseData) as Data
      takeNonEmpty(actual, 'all')
      expectSameSorted(actual, expectedData)
    })
  })

  describe('mapOrderHistoryResponse', () => {
    // The iteration, sorting and conditional statements are exercised with the real formatter and value mapper.
    it.each(Object.entries(orderHistoryCases))('%s', (_name, c) => {
      const { responseData, expectedData } = c as Data
      // deviation: A12 expected times are +03:00 instants
      const actual = realMapper().mapOrderHistoryResponse(responseData) as Data

      if (responseData.txnDetailList !== undefined) {
        expect(actual.transactions).toHaveLength(actual.trans_count)
        if (
          actual.transactions.length > 1 &&
          actual.transactions[0].transaction_time !== null &&
          actual.transactions[1].transaction_time !== null
        ) {
          expect(actual.transactions[1].transaction_time.getTime()).toBeGreaterThan(
            actual.transactions[0].transaction_time.getTime(),
          )
        }
        actual.transactions.forEach((tx: Data, key: number) => {
          expectSameSorted(tx, expectedData.transactions[key])
        })
      }

      takeNonEmpty(actual, 'all')
      const { transactions: actualTransactions, ...actualRest } = actual
      const { transactions: expectedTransactions, ...expectedRest } = expectedData
      expect(actualTransactions.length).toBe(expectedTransactions.length)
      expectSameSorted(actualRest, expectedRest)
    })
  })

  describe('additions', () => {
    const order: PosOrder = { id: '202404207281', amount: 1.01, currency: CURRENCY.TRY, installment: 0 } as PosOrder
    const declinedHostApproved = {
      txnCode: '1000',
      responseCode: 'VPS-1005',
      responseMessage: 'Provizyon Hatası',
      hostResponseCode: '00',
      hostMessage: '000 ONAY KODU XXXXXX',
      txnDateTime: '2024-04-20T15:20:45.000',
      merchantSafeId: '2023090417500272654BD9A49CF07574',
      terminalSafeId: '2023090417500284633D137A249DBBEB',
      orderId: '202404207281',
      authCode: '000000',
      rrn: '411224360676',
      batchNumber: '46',
      hashParams: 'txnCode+responseCode',
      hash: 'zF0sbk//9luDy8Zg0Q/R39TRXXCHrq7MQziTHBxjVU0iaE5AntVkFv0JNCE4AkF5i7DHC7czyqplDkIfVrTpAQ==',
    }

    // addition: A9 host approved, API declined
    it('map3DPayResponseData flags a declined answer whose host code is 00', () => {
      const actual = realMapper().map3DPayResponseData(declinedHostApproved, TX_TYPE.PAY_AUTH, order) as Data
      expect(actual.status).toBe('declined')
      expect(actual.requires_manual_review).toBe(true)
      expect(actual.payment_model).toBe('3d_pay')
      expect(actual.order_id).toBe('202404207281')
      expect(logger.warn).toHaveBeenCalledTimes(1)
      expect(logger.warn.mock.calls[0]?.[1]).toMatchObject({ order_id: '202404207281', proc_return_code: 'VPS-1005' })
    })

    // addition: A9 the same through 3D Host
    it('map3DHostResponseData flags a declined answer whose host code is 00', () => {
      const actual = realMapper().map3DHostResponseData(declinedHostApproved, TX_TYPE.PAY_AUTH, order) as Data
      expect(actual.status).toBe('declined')
      expect(actual.requires_manual_review).toBe(true)
      expect(actual.payment_model).toBe('3d_host')
      expect(logger.warn).toHaveBeenCalledTimes(1)
    })

    // addition: only the host code 00 triggers a review, other declined answers do not
    it('does not flag declined answers without a host approval', () => {
      for (const hostResponseCode of ['83', '', undefined]) {
        const raw = { ...declinedHostApproved, hostResponseCode }
        const actual = realMapper().map3DPayResponseData(raw, TX_TYPE.PAY_AUTH, order) as Data
        expect(actual.status).toBe('declined')
        expect(actual.requires_manual_review).toBe(false)
      }
      expect(logger.warn).not.toHaveBeenCalled()
    })

    // addition: an approved answer never asks for a review
    it('does not flag an approved 3D Pay answer', () => {
      const raw = { ...declinedHostApproved, responseCode: 'VPS-0000', authCode: '306456' }
      const actual = realMapper().map3DPayResponseData(raw, TX_TYPE.PAY_AUTH, order) as Data
      expect(actual.status).toBe('approved')
      expect(actual.requires_manual_review).toBe(false)
      expect(actual.batch_num).toBe(46)
      expect(actual.transaction_time).toStrictEqual(new Date('2024-04-20T15:20:45.000+03:00'))
    })

    // addition: the 3D Secure step does not carry the key
    it('map3DPaymentData has no requires_manual_review key', () => {
      const actual = realMapper().map3DPaymentData(
        { responseCode: 'VPS-1279', responseMessage: 'x', orderId: 'A1' },
        null,
        TX_TYPE.PAY_AUTH,
        order,
      ) as Data
      expect(actual).not.toHaveProperty('requires_manual_review')
      expect(actual.status).toBe('declined')
    })

    // addition: missing nested objects never raise a TypeError
    it('mapPaymentResponse without order and transaction objects declines', () => {
      valueMapper.mapTxType.mockReturnValue(TX_TYPE.PAY_AUTH)
      const actual = mapper.mapPaymentResponse(
        { responseCode: 'VPS-1061', txnCode: '1000', responseMessage: 'x' },
        TX_TYPE.PAY_AUTH,
        order,
      ) as Data
      expect(actual.status).toBe('declined')
      expect(actual.order_id).toBeNull()
      expect(actual.auth_code).toBeNull()
      expect(actual.error_message).toBe('x')
    })

    // addition: an approved answer without a transaction object keeps null values
    it('mapPaymentResponse approved without transaction has null auth code', () => {
      valueMapper.mapTxType.mockReturnValue(TX_TYPE.PAY_AUTH)
      formatter.formatDateTime.mockReturnValue(new Date(0))
      const actual = mapper.mapPaymentResponse(
        { responseCode: 'VPS-0000', txnCode: '1000', txnDateTime: '2024-04-20T15:20:45.000', order: { orderId: 'A1' } },
        TX_TYPE.PAY_AUTH,
        order,
      ) as Data
      expect(actual.status).toBe('approved')
      expect(actual.auth_code).toBeNull()
      expect(actual.batch_num).toBeNull()
      expect(actual.ref_ret_num).toBeNull()
    })

    // addition: PHP `> 0` on bank values ('000000' and '0' are not positive; JSON numbers work)
    it.each([
      [
        { authCode: '000000', rrn: '0', batchNumber: 0 },
        { auth_code: null, ref_ret_num: null, batch_num: null },
      ],
      [
        { authCode: '123456', rrn: 7, batchNumber: 39 },
        { auth_code: '123456', ref_ret_num: 7, batch_num: 39 },
      ],
    ])('declined payment transaction %j', (transaction, expected) => {
      valueMapper.mapTxType.mockReturnValue(TX_TYPE.PAY_AUTH)
      const actual = mapper.mapPaymentResponse(
        { responseCode: 'VPS-1005', txnCode: '1000', responseMessage: 'x', transaction },
        TX_TYPE.PAY_AUTH,
        order,
      ) as Data
      expect(actual).toMatchObject(expected)
    })

    // addition: a missing list reads as empty
    it('mapOrderHistoryResponse without a list is approved with no transactions', () => {
      const actual = realMapper().mapOrderHistoryResponse({ responseCode: 'VPS-0000' }) as Data
      expect(actual.status).toBe('approved')
      expect(actual.trans_count).toBe(0)
      expect(actual.transactions).toStrictEqual([])
      expect(actual.order_id).toBeNull()
    })

    // addition: JSON numbers (installCount, amount, batchNumber) reach the formatters as text
    it('mapOrderHistoryResponse accepts JSON numbers', () => {
      const actual = realMapper().mapOrderHistoryResponse({
        responseCode: 'VPS-0000',
        txnDetailList: [
          {
            responseCode: 'VPS-0000',
            txnCode: '1000',
            txnStatus: 'N',
            currencyCode: 949,
            installCount: 3,
            amount: 12.5,
            batchNumber: 39,
            txnDateTime: '2024-04-15T20:41:03.165',
            orderId: 'A1',
          },
        ],
      }) as Data
      expect(actual.transactions[0]).toMatchObject({
        installment_count: 3,
        first_amount: 12.5,
        capture_amount: 12.5,
        capture: true,
        currency: 'TRY',
        batch_num: 39,
      })
      expect(actual.order_id).toBe('A1')
    })

    // addition: logger contexts never carry a clear PAN
    it('masks a card number in logger contexts', () => {
      valueMapper.mapTxType.mockReturnValue(TX_TYPE.PAY_AUTH)
      mapper.mapPaymentResponse(
        { responseCode: 'VPS-1005', txnCode: '1000', responseMessage: 'x', card: { cardNumber: '5555444433332222' } },
        TX_TYPE.PAY_AUTH,
        order,
      )
      realMapper().map3DPayResponseData(
        { ...declinedHostApproved, cardNumber: '5555444433332222' },
        TX_TYPE.PAY_AUTH,
        order,
      )
      const logged = JSON.stringify([...logger.debug.mock.calls, ...logger.warn.mock.calls])
      expect(logged).not.toMatch(/\d{16}/)
    })
    // addition: objects, lists and non-numeric values never reach string-typed keys and never approve
    describe('non-scalar bank values', () => {
      const bad: unknown[] = [{ a: 1 }, ['a', 'b'], {}, [], true, Number.NaN]

      it.each(bad.map((value) => [JSON.stringify(value) ?? String(value), value]))(
        'payment response with %s values',
        (_label, value) => {
          valueMapper.mapTxType.mockReturnValue(TX_TYPE.PAY_AUTH)
          const actual = mapper.mapPaymentResponse(
            {
              responseCode: value,
              txnCode: value,
              responseMessage: value,
              hostMessage: value,
              order: { orderId: value, orderTrackId: value },
              transaction: { authCode: value, rrn: value, batchNumber: value },
            },
            TX_TYPE.PAY_AUTH,
            order,
          ) as Data
          expect(actual.status).toBe('declined')
          for (const key of ['proc_return_code', 'error_code', 'error_message', 'order_id', 'recurring_id']) {
            expect(actual[key]).toBeNull()
          }
          for (const key of ['auth_code', 'ref_ret_num', 'batch_num']) {
            expect(actual[key]).toBeNull()
          }
        },
      )

      it.each(bad.map((value) => [JSON.stringify(value) ?? String(value), value]))(
        '3D Pay, 3D Host and 3D Secure responses with %s values',
        (_label, value) => {
          const raw = {
            responseCode: value,
            responseMessage: value,
            orderId: value,
            authCode: value,
            rrn: value,
            batchNumber: value,
            secureEcomInd: value,
          }
          for (const method of ['map3DPayResponseData', 'map3DHostResponseData'] as const) {
            const actual = realMapper()[method](raw, TX_TYPE.PAY_AUTH, order) as Data
            expect(actual.status).toBe('declined')
            expect(actual.proc_return_code).toBeNull()
            expect(actual.order_id).toBeNull()
            expect(actual.md_error_message).toBeNull()
            expect(actual.auth_code).toBeNull()
          }
          const secure = realMapper().map3DPaymentData(raw, null, TX_TYPE.PAY_AUTH, order) as Data
          expect(secure.status).toBe('declined')
          expect(secure.order_id).toBeNull()
          expect(secure.md_error_message).toBeNull()
          expect(secure.eci).toBeNull()
        },
      )

      it.each(bad.map((value) => [JSON.stringify(value) ?? String(value), value]))(
        'refund, cancel and history responses with %s values',
        (_label, value) => {
          const raw = {
            responseCode: value,
            responseMessage: value,
            order: { orderId: value, orderTrackId: value },
            transaction: { authCode: value, rrn: value },
          }
          for (const actual of [realMapper().mapRefundResponse(raw), realMapper().mapCancelResponse(raw)] as Data[]) {
            expect(actual.status).toBe('declined')
            for (const key of ['proc_return_code', 'error_code', 'error_message', 'order_id', 'recurring_id']) {
              expect(actual[key]).toBeNull()
            }
          }
          const history = realMapper().mapOrderHistoryResponse({ ...raw, txnDetailList: value }) as Data
          expect(history.status).toBe('declined')
          expect(history.error_message).toBeNull()
          expect(history.transactions).toStrictEqual([])
        },
      )

      it.each(bad.map((value) => [JSON.stringify(value) ?? String(value), value]))(
        'history transactions with %s values',
        (_label, value) => {
          const tx = {
            responseCode: 'VPS-0000',
            txnCode: value,
            txnStatus: value,
            preAuthStatus: value,
            currencyCode: value,
            installCount: value,
            amount: value,
            preAuthCloseAmount: value,
            maskedCardNumber: value,
            rrn: value,
            batchNumber: value,
            authCode: value,
            orderId: value,
            recurringOrder: value,
          }
          const actual = realMapper().mapOrderHistoryResponse({
            responseCode: 'VPS-0000',
            txnDetailList: [tx, { ...tx, requestType: 'R', requestStatus: value }],
          }) as Data
          expect(actual.order_id).toBeNull()
          for (const t of actual.transactions as Data[]) {
            for (const key of [
              'order_status',
              'first_amount',
              'masked_number',
              'ref_ret_num',
              'batch_num',
              'auth_code',
              'currency',
              'transaction_type',
              'recurring_order',
            ]) {
              expect(t[key] ?? null).toBeNull()
            }
          }
        },
      )

      it.each(['abc', '', '  '])('history amount %j maps to null, not 0', (amount) => {
        const actual = realMapper().mapOrderHistoryResponse({
          responseCode: 'VPS-0000',
          txnDetailList: [{ responseCode: 'VPS-0000', txnCode: '1000', txnStatus: 'N', amount }],
        }) as Data
        expect(actual.transactions[0].first_amount).toBeNull()
      })
    })
  })
})
