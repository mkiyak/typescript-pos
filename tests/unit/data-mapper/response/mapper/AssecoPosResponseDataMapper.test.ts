import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AssecoPosResponseDataMapper } from '../../../../../src/data-mapper/response/mapper/AssecoPosResponseDataMapper.js'
import { AssecoPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/AssecoPosResponseValueFormatter.js'
import type { ResponseValueFormatterInterface } from '../../../../../src/data-mapper/response/value-formatter/ResponseValueFormatterInterface.js'
import { AssecoPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/AssecoPosResponseValueMapper.js'
import type { ResponseValueMapperInterface } from '../../../../../src/data-mapper/response/value-mapper/ResponseValueMapperInterface.js'
import { noopLogger } from '../../../../../src/logger.js'
import { CURRENCY, MODEL, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'
import {
  cancelTestDataProvider,
  orderHistoryTestDataProvider,
  paymentTestDataProvider,
  refundTestDataProvider,
  statusRecurringOrderTestDataProvider,
  statusTestDataProvider,
  threeDHostPaymentDataProvider,
  threeDPaymentDataProvider,
  threeDPayPaymentDataProvider,
  tr,
} from './AssecoPosResponseDataMapper.data.js'

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
type Data = Record<string, unknown>

/** PHP assertSame on arrays (no ksort): same keys in the same order with identical values. */
function expectSame(actual: unknown, expected: unknown): void {
  expect(actual).toStrictEqual(expected)
  expect(Object.keys(actual as Data)).toStrictEqual(Object.keys(expected as Data))
}

/** `assertArrayHasKey($key)` + `assertIsArray` + `assertNotEmpty`, then `unset`. */
function takeNonEmpty(actual: Data, key: string): void {
  expect(actual).toHaveProperty(key)
  const value = actual[key]
  expect(value !== null && typeof value === 'object').toBe(true)
  expect(Object.keys(value as Data).length).toBeGreaterThan(0)
  delete actual[key]
}

/** Loose comparison: the mapper sees bank values after emptyStringsToNull ('' -> null). */
const arg = (value: unknown): unknown => (typeof value === 'string' && value.trim() === '' ? null : value)

/** 3D Pay / 3D Host responses always carry `requires_manual_review`. */
const withReview = (expected: Data, review = false): Data => ({ ...expected, requires_manual_review: review })

describe('AssecoPosResponseDataMapper', () => {
  let formatter: Mocked<ResponseValueFormatterInterface>
  let valueMapper: Mocked<ResponseValueMapperInterface>
  let mapper: AssecoPosResponseDataMapper

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
    mapper = new AssecoPosResponseDataMapper(
      formatter as unknown as ResponseValueFormatterInterface,
      valueMapper as unknown as ResponseValueMapperInterface,
      noopLogger,
    )
  })

  const integrationMapper = () =>
    new AssecoPosResponseDataMapper(new AssecoPosResponseValueFormatter(), new AssecoPosResponseValueMapper())

  // addition: L3 the result code the gateway checks after a money request; a repeated or nested element is no code
  it.each([
    [{ ProcReturnCode: '00' }, '00'],
    [{ ProcReturnCode: '99' }, '99'],
    [{ ProcReturnCode: '' }, ''],
    [{}, null],
    [{ ProcReturnCode: ['00', '00'] }, null],
    [{ ProcReturnCode: { a: '00' } }, null],
    [{ ProcReturnCode: true }, null],
    // addition: L3 an explicit decline or error without ProcReturnCode carries its result in Extra.ERRORCODE or Response
    [{ Response: 'Declined', ErrMsg: 'Net Tutar 0.', Extra: { ERRORCODE: '215021' } }, '215021'],
    [{ Response: 'Error', Extra: { ERRORCODE: 'CORE-2008' } }, 'CORE-2008'],
    [{ Response: 'Declined', ErrMsg: 'Red' }, 'Declined'],
    [{ Response: 'Error', Extra: { ERRORCODE: ['1', '2'] } }, 'Error'],
    [{ Response: 'Error', Extra: [{ ERRORCODE: '1' }] }, 'Error'],
    [{ Response: 'Declined', ProcReturnCode: '99', Extra: { ERRORCODE: '215021' } }, '99'],
    [{ Response: 'Approved' }, null],
    [{ Response: 'Approved', Extra: { ERRORCODE: '215021' } }, null],
    [{ Response: 'declined', Extra: { ERRORCODE: '215021' } }, null],
    [{ Response: ' Declined', Extra: { ERRORCODE: '215021' } }, null],
    [{ Response: ['Declined'] }, null],
  ] as Array<[Record<string, unknown>, string | null]>)('readProcReturnCode(%j) is %j', (raw, expected) => {
    expect(mapper.readProcReturnCode(raw)).toBe(expected)
  })

  it('supports', () => {
    expect(AssecoPosResponseDataMapper.supports('AssecoPos')).toBe(true)
    expect(AssecoPosResponseDataMapper.supports('AkbankPos')).toBe(false)
  })

  it.each([
    [null, false],
    ['', false],
    ['2', false],
    ['3', false],
    ['4', false],
    ['7', false],
    ['1', true],
  ])('is3dAuthSuccess(%j) -> %j', (mdStatus, expected) => {
    expect(mapper.is3dAuthSuccess(mdStatus)).toBe(expected)
  })

  it.each([
    [{}, null],
    [{ mdStatus: '1' }, '1'],
  ])('extractMdStatus(%j) -> %j', (responseData, expected) => {
    expect(mapper.extractMdStatus(responseData)).toBe(expected)
  })

  it.each(paymentTestDataProvider)('mapPaymentResponse %s', (_name, { order, txType, responseData, expectedData }) => {
    if (expectedData.transaction_time instanceof Date) {
      formatter.formatDateTime.mockReturnValueOnce(expectedData.transaction_time)
    }

    const actual: Data = mapper.mapPaymentResponse(responseData, txType, order)

    expect(valueMapper.mapTxType).not.toHaveBeenCalled()
    if (expectedData.transaction_time instanceof Date) {
      expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
      expect(formatter.formatDateTime).toHaveBeenCalledWith(arg(responseData.Extra.TRXDATE), txType)
    }
    takeNonEmpty(actual, 'all')
    expect(actual).toStrictEqual(expectedData)
  })

  it('mapPaymentResponse returns the default response for an empty bank response', () => {
    const actual = mapper.mapPaymentResponse({}, TX_TYPE.PAY_AUTH, {})
    expect(actual).toMatchObject({ status: 'declined', payment_model: MODEL.NON_SECURE, all: null })
  })

  it.each(threeDPaymentDataProvider)(
    'map3DPaymentData %s',
    (_name, { order, txType, threeDResponseData, paymentData: paymentResponse, expectedData }) => {
      formatter.formatAmount.mockReturnValueOnce(expectedData.amount)
      formatter.formatInstallment.mockReturnValueOnce(expectedData.installment_count)
      valueMapper.mapCurrency.mockReturnValueOnce(expectedData.currency)
      valueMapper.mapSecureType.mockReturnValueOnce(expectedData.payment_model)
      if (expectedData.transaction_time instanceof Date) {
        formatter.formatDateTime.mockReturnValueOnce(expectedData.transaction_time)
      }

      const actual: Data = mapper.map3DPaymentData(threeDResponseData, paymentResponse, txType, order)

      expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
      expect(formatter.formatAmount).toHaveBeenCalledWith(arg(threeDResponseData.amount), txType)
      expect(formatter.formatInstallment).toHaveBeenCalledTimes(1)
      expect(formatter.formatInstallment).toHaveBeenCalledWith(arg(threeDResponseData.taksit), txType)
      expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapCurrency).toHaveBeenCalledWith(arg(threeDResponseData.currency), txType)
      expect(valueMapper.mapSecureType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapSecureType).toHaveBeenCalledWith(arg(threeDResponseData.storetype), txType)
      if (expectedData.transaction_time instanceof Date) {
        expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
        expect(formatter.formatDateTime).toHaveBeenCalledWith(arg(paymentResponse.Extra.TRXDATE), txType)
      }

      expect(actual).toHaveProperty('all')
      if (Object.keys(paymentResponse).length > 0) {
        takeNonEmpty(actual, 'all')
      }
      delete actual.all
      takeNonEmpty(actual, '3d_all')
      expect(actual).toStrictEqual(expectedData)
    },
  )

  it.each(threeDPayPaymentDataProvider)(
    'map3DPayResponseData %s',
    (_name, { order, txType, paymentData: responseData, expectedData }) => {
      formatter.formatAmount.mockReturnValueOnce(expectedData.amount)
      formatter.formatInstallment.mockReturnValueOnce(expectedData.installment_count)
      valueMapper.mapCurrency.mockReturnValueOnce(expectedData.currency)
      valueMapper.mapSecureType.mockReturnValueOnce(expectedData.payment_model)
      if (expectedData.transaction_time instanceof Date) {
        formatter.formatDateTime.mockReturnValueOnce(expectedData.transaction_time)
      }

      const actual: Data = mapper.map3DPayResponseData(responseData, txType, order)

      expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
      expect(formatter.formatAmount).toHaveBeenCalledWith(arg(responseData.amount), txType)
      expect(formatter.formatInstallment).toHaveBeenCalledTimes(1)
      expect(formatter.formatInstallment).toHaveBeenCalledWith(arg(responseData.taksit), txType)
      expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapCurrency).toHaveBeenCalledWith(arg(responseData.currency), txType)
      expect(valueMapper.mapSecureType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapSecureType).toHaveBeenCalledWith(arg(responseData.storetype), txType)
      if (expectedData.transaction_time instanceof Date) {
        expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
        expect(formatter.formatDateTime).toHaveBeenCalledWith(arg(responseData.EXTRA_TRXDATE), txType)
      }

      takeNonEmpty(actual, 'all')
      expect(actual).toStrictEqual(withReview(expectedData))
    },
  )

  it.each(threeDHostPaymentDataProvider)(
    'map3DHostResponseData %s',
    (_name, { order, txType, paymentData: responseData, expectedData }) => {
      formatter.formatAmount.mockReturnValueOnce(expectedData.amount)
      formatter.formatInstallment.mockReturnValueOnce(expectedData.installment_count)
      valueMapper.mapCurrency.mockReturnValueOnce(expectedData.currency)
      valueMapper.mapSecureType.mockReturnValueOnce(expectedData.payment_model)
      const hasTime = expectedData.transaction_time !== null && expectedData.transaction_time !== undefined
      if (hasTime) {
        formatter.formatDateTime.mockReturnValueOnce(expectedData.transaction_time)
      }

      const actual: Data = mapper.map3DHostResponseData(responseData, txType, order)

      expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
      expect(formatter.formatAmount).toHaveBeenCalledWith(arg(responseData.amount), txType)
      expect(formatter.formatInstallment).toHaveBeenCalledTimes(1)
      expect(formatter.formatInstallment).toHaveBeenCalledWith(arg(responseData.taksit), txType)
      expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapCurrency).toHaveBeenCalledWith(arg(responseData.currency), txType)
      expect(valueMapper.mapSecureType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapSecureType).toHaveBeenCalledWith(arg(responseData.storetype), txType)
      if (hasTime) {
        expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
        expect(formatter.formatDateTime).toHaveBeenCalledWith('now', txType)
      }

      takeNonEmpty(actual, 'all')
      expect(actual).toStrictEqual(withReview(expectedData))
    },
  )

  describe('bank provisioned but 3D authentication failed', () => {
    const [, payCase] = threeDPayPaymentDataProvider[0] as [string, Data]
    const [, hostCase] = threeDHostPaymentDataProvider[0] as [string, Data]

    it.each(['0', '2', '3', '4', '7'])(
      '3D Pay with ProcReturnCode 00 and mdStatus %s is a declined manual review',
      (md) => {
        const raw = { ...(payCase.paymentData as Data), mdStatus: md }
        const actual = integrationMapper().map3DPayResponseData(raw, TX_TYPE.PAY_AUTH, payCase.order as PosOrder)
        expect(actual.status).toBe('declined')
        expect(actual.requires_manual_review).toBe(true)
        expect(actual.md_status).toBe(md)
      },
    )

    it('3D Host with ProcReturnCode 00 and mdStatus 2 is a declined manual review', () => {
      const raw = { ...(hostCase.paymentData as Data), ProcReturnCode: '00', mdStatus: '2' }
      const actual = integrationMapper().map3DHostResponseData(raw, TX_TYPE.PAY_AUTH, hostCase.order as PosOrder)
      expect(actual.status).toBe('declined')
      expect(actual.requires_manual_review).toBe(true)
    })

    it('a regular decline (ProcReturnCode not 00) is not flagged', () => {
      const raw = { ...(payCase.paymentData as Data), ProcReturnCode: '99', mdStatus: '1' }
      const actual = integrationMapper().map3DPayResponseData(raw, TX_TYPE.PAY_AUTH, payCase.order as PosOrder)
      expect(actual.status).toBe('declined')
      expect(actual.requires_manual_review).toBe(false)
    })

    it('an approved payment is not flagged', () => {
      const actual = integrationMapper().map3DPayResponseData(
        payCase.paymentData as Data,
        TX_TYPE.PAY_AUTH,
        payCase.order as PosOrder,
      )
      expect(actual.status).toBe('approved')
      expect(actual.requires_manual_review).toBe(false)
      expect(actual.transaction_time).toStrictEqual(tr('2022-10-30 11:22:43.000'))
    })
  })

  it.each(statusTestDataProvider)('mapStatusResponse %s', (_name, { responseData, expectedData }) => {
    const txType: TxType = TX_TYPE.STATUS
    const approved = expectedData.status === 'approved'
    const dates = ['AUTH_DTTM', 'CAPTURE_DTTM', 'VOID_DTTM']
    if (approved) {
      formatter.formatAmount
        .mockReturnValueOnce(expectedData.first_amount)
        .mockReturnValueOnce(expectedData.capture_amount)
        .mockReturnValue(false)
      valueMapper.mapTxType.mockReturnValueOnce(expectedData.transaction_type)
      valueMapper.mapOrderStatus.mockReturnValueOnce(expectedData.order_status)
      formatter.formatDateTime
        .mockReturnValueOnce(expectedData.transaction_time)
        .mockReturnValueOnce(expectedData.capture_time)
        .mockReturnValueOnce(expectedData.cancel_time)
        .mockReturnValue(false)
    }

    const actual: Data = mapper.mapStatusResponse(responseData)

    if (approved) {
      const extra = responseData.Extra
      expect(formatter.formatAmount).toHaveBeenCalledTimes(extra.CAPTURE_AMT ? 2 : 1)
      expect(formatter.formatAmount.mock.calls[0]).toStrictEqual([arg(extra.ORIG_TRANS_AMT), txType])
      if (extra.CAPTURE_AMT) {
        expect(formatter.formatAmount.mock.calls[1]).toStrictEqual([arg(extra.CAPTURE_AMT), txType])
      }
      expect(valueMapper.mapTxType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapTxType).toHaveBeenCalledWith(arg(extra.CHARGE_TYPE_CD))
      expect(valueMapper.mapOrderStatus).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapOrderStatus).toHaveBeenCalledWith(arg(extra.TRANS_STAT))
      // the set date fields are consumed in order: AUTH_DTTM, CAPTURE_DTTM, VOID_DTTM
      const setDates = dates.filter((key) => arg(extra[key]) !== undefined && arg(extra[key]) !== null)
      expect(formatter.formatDateTime.mock.calls.length).toBeGreaterThanOrEqual(1)
      expect(formatter.formatDateTime.mock.calls).toStrictEqual(
        setDates.slice(0, formatter.formatDateTime.mock.calls.length).map((key) => [arg(extra[key]), txType]),
      )
    }

    takeNonEmpty(actual, 'all')
    expect(actual).toStrictEqual(expectedData)
  })

  it.each(statusRecurringOrderTestDataProvider)(
    'mapStatusResponse recurring order %s',
    (_name, { responseData, expectedData }) => {
      const actual: Data = integrationMapper().mapStatusResponse(responseData)
      const expected: Data = structuredClone(expectedData)

      const actualOrders = actual.recurringOrders as Data[]
      const expectedOrders = expected.recurringOrders as Data[]
      for (const [key, actualOrder] of actualOrders.entries()) {
        const expectedOrder = expectedOrders[key] as Data
        expect(actualOrder.transaction_time).toEqual(expectedOrder.transaction_time)
        expect(actualOrder.capture_time).toEqual(expectedOrder.capture_time)
        delete actualOrder.transaction_time
        delete expectedOrder.transaction_time
        delete actualOrder.capture_time
        delete expectedOrder.capture_time
      }

      takeNonEmpty(actual, 'all')
      expect(actual).toStrictEqual(expected)
    },
  )

  it.each(refundTestDataProvider)('mapRefundResponse %s', (_name, { responseData, expectedData }) => {
    const actual: Data = mapper.mapRefundResponse(responseData)

    takeNonEmpty(actual, 'all')
    expectSame(actual, expectedData)
  })

  it.each(cancelTestDataProvider)('mapCancelResponse %s', (_name, { responseData, expectedData }) => {
    const actual: Data = mapper.mapCancelResponse(responseData)

    takeNonEmpty(actual, 'all')
    expectSame(actual, expectedData)
  })

  it.each(orderHistoryTestDataProvider)('mapOrderHistoryResponse %s', (_name, { responseData, expectedData }) => {
    const actual: Data = integrationMapper().mapOrderHistoryResponse(responseData)
    const expected: Data = structuredClone(expectedData)

    if (Object.keys(responseData.Extra).length > 0) {
      const transactions = actual.transactions as Data[]
      const expectedTransactions = expected.transactions as Data[]
      const [first, second] = transactions
      if (
        transactions.length > 1 &&
        first?.transaction_time !== null &&
        second?.transaction_time !== null &&
        first !== undefined &&
        second !== undefined
      ) {
        expect((second.transaction_time as Date).getTime()).toBeGreaterThan((first.transaction_time as Date).getTime())
      }

      for (const [key, transaction] of transactions.entries()) {
        const expectedTransaction = expectedTransactions[key] as Data
        expect(transaction.transaction_time).toEqual(expectedTransaction.transaction_time)
        expect(transaction.capture_time).toEqual(expectedTransaction.capture_time)
        delete transaction.transaction_time
        delete expectedTransaction.transaction_time
      }

      expect(transactions).toHaveLength(actual.trans_count as number)
    }

    takeNonEmpty(actual, 'all')
    expect(actual).toStrictEqual(expected)
  })

  it('maps fields missing from the bank response to null (PHP undefined index), never undefined', () => {
    const refund = integrationMapper().mapRefundResponse({ ProcReturnCode: '99' })
    expect(refund.order_id).toBeNull()
    expect(refund.error_code).toBeNull()
    expect(Object.values(refund)).not.toContain(undefined)

    const pay = integrationMapper().map3DPayResponseData(
      {
        mdStatus: '1',
        ProcReturnCode: '00',
        storetype: '3d_pay',
        amount: '1.01',
        currency: '949',
        EXTRA_TRXDATE: '20221030 11:22:43',
      },
      TX_TYPE.PAY_AUTH,
      { currency: CURRENCY.TRY },
    )
    expect(pay.status).toBe('approved')
    expect(Object.values(pay)).not.toContain(undefined)
  })
})
