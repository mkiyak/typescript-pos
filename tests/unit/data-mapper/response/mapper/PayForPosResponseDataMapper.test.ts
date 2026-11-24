import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayForPosResponseDataMapper } from '../../../../../src/data-mapper/response/mapper/PayForPosResponseDataMapper.js'
import { BasicResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import type { ResponseValueFormatterInterface } from '../../../../../src/data-mapper/response/value-formatter/ResponseValueFormatterInterface.js'
import { PayForPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/PayForPosResponseValueMapper.js'
import type { ResponseValueMapperInterface } from '../../../../../src/data-mapper/response/value-mapper/ResponseValueMapperInterface.js'
import type { PosLogger } from '../../../../../src/logger.js'
import { TX_TYPE } from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'
import {
  cancelTestDataProvider,
  NOW,
  paymentTestDataProvider,
  refundTestDataProvider,
  statusTestDataProvider,
  threeDHostPaymentDataProvider,
  threeDPaymentDataProvider,
  threeDPayPaymentDataProvider,
} from './PayForPosResponseDataMapper.data.js'

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

/** Same keys (in any order) with identical values. */
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

const history = (name: string): Data =>
  JSON.parse(readFileSync(new URL(`../../../test_data/payfor/history/${name}`, import.meta.url), 'utf8')) as Data

const T = (iso: string) => new Date(`${iso}+03:00`)

// deviation: F22 the expected instants are Türkiye time (UTC+03:00); bank times carry no zone
const orderHistoryTestDataProvider: Array<[string, { fixture: string; expectedData: Data }]> = [
  [
    'success_pre_pay_post_pay_then_cancel',
    {
      fixture: 'success_pre_pay_post_pay_then_cancel_response.json',
      expectedData: {
        order_id: '2024012107B7',
        proc_return_code: null,
        error_code: null,
        error_message: null,
        status: null,
        trans_count: 3,
        transactions: [
          {
            auth_code: 'S65465',
            proc_return_code: '00',
            transaction_id: null,
            transaction_time: T('2024-01-21T17:39:02'),
            capture_time: null,
            error_message: null,
            ref_ret_num: null,
            order_status: 'PRE_AUTH_COMPLETED',
            transaction_type: 'pre',
            first_amount: 2.01,
            capture_amount: null,
            status: 'approved',
            error_code: null,
            capture: false,
            currency: 'TRY',
            masked_number: '415565******6111',
          },
          {
            auth_code: 'S75952',
            proc_return_code: '00',
            transaction_id: null,
            transaction_time: T('2024-01-21T17:39:06'),
            capture_time: T('2024-01-21T17:39:06'),
            error_message: null,
            ref_ret_num: null,
            order_status: 'PAYMENT_COMPLETED',
            transaction_type: 'post',
            first_amount: 2.03,
            capture_amount: 2.03,
            status: 'approved',
            error_code: null,
            capture: true,
            currency: 'TRY',
            masked_number: '415565******6111',
          },
          {
            auth_code: 'S10420',
            proc_return_code: '00',
            transaction_id: null,
            transaction_time: T('2024-01-21T17:39:16'),
            capture_time: null,
            error_message: null,
            ref_ret_num: null,
            order_status: null,
            transaction_type: 'cancel',
            first_amount: 2.03,
            capture_amount: null,
            status: 'approved',
            error_code: null,
            capture: null,
            currency: 'TRY',
            masked_number: '415565******6111',
          },
        ],
      },
    },
  ],
  [
    'success_pay',
    {
      fixture: 'success_pay_response.json',
      expectedData: {
        order_id: '202401212A22',
        proc_return_code: '00',
        error_code: null,
        error_message: null,
        status: 'approved',
        trans_count: 1,
        transactions: [
          {
            auth_code: 'S90726',
            proc_return_code: '00',
            transaction_id: null,
            transaction_time: T('2024-01-21T21:40:47'),
            capture_time: T('2024-01-21T21:40:47'),
            error_message: null,
            ref_ret_num: null,
            order_status: 'PAYMENT_COMPLETED',
            transaction_type: 'pay',
            first_amount: 1.01,
            capture_amount: 1.01,
            status: 'approved',
            error_code: null,
            capture: true,
            currency: 'TRY',
            masked_number: '415565******6111',
          },
        ],
      },
    },
  ],
  [
    'success_pre_pay',
    {
      fixture: 'success_pre_pay_response.json',
      expectedData: {
        order_id: '2024012186F9',
        proc_return_code: '00',
        error_code: null,
        error_message: null,
        status: 'approved',
        trans_count: 1,
        transactions: [
          {
            auth_code: 'S95711',
            proc_return_code: '00',
            transaction_id: null,
            transaction_time: T('2024-01-21T21:59:31'),
            capture_time: null,
            error_message: null,
            ref_ret_num: null,
            order_status: 'PRE_AUTH_COMPLETED',
            transaction_type: 'pre',
            first_amount: 2.01,
            capture_amount: null,
            status: 'approved',
            error_code: null,
            capture: false,
            currency: 'TRY',
            masked_number: '415565******6111',
          },
        ],
      },
    },
  ],
  [
    'success_pay_refund_fail',
    {
      fixture: 'success_pay_refund_fail_response.json',
      expectedData: {
        order_id: '202401211C79',
        proc_return_code: null,
        error_code: null,
        error_message: null,
        status: null,
        trans_count: 2,
        transactions: [
          {
            auth_code: 'S83066',
            proc_return_code: '00',
            transaction_id: null,
            transaction_time: T('2024-01-21T22:14:23'),
            capture_time: T('2024-01-21T22:14:23'),
            error_message: null,
            ref_ret_num: null,
            order_status: 'PAYMENT_COMPLETED',
            transaction_type: 'pay',
            first_amount: 1.01,
            capture_amount: 1.01,
            status: 'approved',
            error_code: null,
            capture: true,
            currency: 'TRY',
            masked_number: '415565******6111',
          },
          {
            auth_code: null,
            proc_return_code: 'V014',
            transaction_id: null,
            transaction_time: null,
            capture_time: null,
            error_message: null,
            ref_ret_num: null,
            order_status: null,
            transaction_type: 'refund',
            first_amount: null,
            capture_amount: null,
            status: 'declined',
            error_code: 'V014',
            capture: null,
            currency: 'TRY',
            masked_number: null,
          },
        ],
      },
    },
  ],
  [
    'fail_order_not_found',
    {
      fixture: 'fail_order_not_found_response.json',
      expectedData: {
        order_id: '202401010C2022',
        proc_return_code: 'V013',
        error_code: 'V013',
        error_message: 'Seçili İşlem Bulunamadı!',
        status: 'declined',
        trans_count: 0,
        transactions: [],
      },
    },
  ],
]

describe('PayForPosResponseDataMapper', () => {
  let formatter: Mocked<ResponseValueFormatterInterface>
  let valueMapper: Mocked<ResponseValueMapperInterface>
  let logger: Mocked<PosLogger>
  let mapper: PayForPosResponseDataMapper

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
    mapper = new PayForPosResponseDataMapper(
      formatter as unknown as ResponseValueFormatterInterface,
      valueMapper as unknown as ResponseValueMapperInterface,
      logger as unknown as PosLogger,
    )
  })

  const realMapper = (log?: PosLogger) =>
    new PayForPosResponseDataMapper(new BasicResponseValueFormatter(), new PayForPosResponseValueMapper(), log)

  it('supports', () => {
    expect(PayForPosResponseDataMapper.supports('PayForPos')).toBe(true)
    expect(PayForPosResponseDataMapper.supports('AkbankPos')).toBe(false)
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
    [{ '3DStatus': '1' }, '1'],
  ])('extractMdStatus(%j) -> %j', (responseData, expected) => {
    expect(mapper.extractMdStatus(responseData)).toBe(expected)
  })

  // addition: non-string or inherited values are never a md status
  it.each([
    [{ '3DStatus': 1 }],
    [{ '3DStatus': ['1'] }],
    [{ '3DStatus': { a: '1' } }],
    [{ '3DStatus': null }],
    [Object.create({ '3DStatus': '1' })],
  ])('extractMdStatus(%j) -> null (addition)', (responseData) => {
    expect(mapper.extractMdStatus(responseData)).toBeNull()
  })

  // addition: a missing callback reads as no md status instead of throwing
  it.each([[null], [undefined], [['1']]])('extractMdStatus(%j) -> null without throwing', (responseData) => {
    expect(mapper.extractMdStatus(responseData as never)).toBeNull()
  })

  it.each(paymentTestDataProvider)('mapPaymentResponse %s', (_name, { order, txType, responseData, expectedData }) => {
    // deviation: Q6 an approved payment is stamped with the current time; the stub returns a fixed instant
    const expected = { ...expectedData }
    if (expected.transaction_time !== null) expected.transaction_time = NOW
    formatter.formatDateTime.mockReturnValue(NOW)

    const actual: Data = mapper.mapPaymentResponse(responseData, txType as never, order as PosOrder)

    if (expected.transaction_time !== null) {
      expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
      expect(formatter.formatDateTime).toHaveBeenCalledWith('now', txType)
    } else {
      expect(formatter.formatDateTime).not.toHaveBeenCalled()
    }
    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expected)
  })

  it.each(threeDPaymentDataProvider)(
    'map3DPaymentData %s',
    (_name, { order, txType, threeDResponseData, paymentData, expectedData }) => {
      valueMapper.mapTxType.mockReturnValue(expectedData.transaction_type)
      valueMapper.mapSecureType.mockReturnValue(expectedData.payment_model)
      formatter.formatAmount.mockReturnValue(expectedData.amount)
      valueMapper.mapCurrency.mockReturnValue(expectedData.currency)
      formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
      formatter.formatInstallment.mockReturnValue(expectedData.installment_count)

      const actual: Data = mapper.map3DPaymentData(threeDResponseData, paymentData, txType as never, order as PosOrder)

      expect(valueMapper.mapTxType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapTxType).toHaveBeenCalledWith(threeDResponseData.TxnType)
      expect(valueMapper.mapSecureType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapSecureType).toHaveBeenCalledWith(threeDResponseData.SecureType, txType)
      expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
      expect(formatter.formatAmount).toHaveBeenCalledWith(threeDResponseData.PurchAmount, txType)
      expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapCurrency).toHaveBeenCalledWith(threeDResponseData.Currency, txType)
      if (expectedData.status === 'approved') {
        expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
        expect(formatter.formatDateTime).toHaveBeenCalledWith(threeDResponseData.TransactionDate, txType)
        expect(formatter.formatInstallment).toHaveBeenCalledTimes(1)
        expect(formatter.formatInstallment).toHaveBeenCalledWith(threeDResponseData.InstallmentCount, txType)
      }

      expect(actual).toHaveProperty('all')
      if (Object.keys(paymentData).length > 0) {
        expect(Object.keys(actual.all as Data).length).toBeGreaterThan(0)
      }
      takeNonEmpty(actual, '3d_all')
      delete actual.all
      expectSameSorted(actual, expectedData)
    },
  )

  describe.each([
    ['map3DPayResponseData', threeDPayPaymentDataProvider],
    ['map3DHostResponseData', threeDHostPaymentDataProvider],
  ] as const)('%s', (method, provider) => {
    it.each(provider)('%s', (_name, { order, txType, paymentData, expectedData }) => {
      valueMapper.mapTxType.mockReturnValue(expectedData.transaction_type)
      valueMapper.mapSecureType.mockReturnValue(expectedData.payment_model)
      formatter.formatAmount.mockReturnValue(expectedData.amount)
      valueMapper.mapCurrency.mockReturnValue(expectedData.currency)
      formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
      formatter.formatInstallment.mockReturnValue(expectedData.installment_count)

      const actual: Data = mapper[method](paymentData, txType as never, order as PosOrder)

      expect(valueMapper.mapTxType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapTxType).toHaveBeenCalledWith(paymentData.TxnType)
      expect(valueMapper.mapSecureType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapSecureType).toHaveBeenCalledWith(paymentData.SecureType, txType)
      expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
      expect(formatter.formatAmount).toHaveBeenCalledWith(paymentData.PurchAmount, txType)
      expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapCurrency).toHaveBeenCalledWith(paymentData.Currency, txType)
      if (expectedData.status === 'approved') {
        expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
        expect(formatter.formatDateTime).toHaveBeenCalledWith(paymentData.TransactionDate, txType)
        expect(formatter.formatInstallment).toHaveBeenCalledTimes(1)
        expect(formatter.formatInstallment).toHaveBeenCalledWith(paymentData.InstallmentCount, txType)
      }

      takeNonEmpty(actual, 'all')
      expectSameSorted(actual, expectedData)
    })
  })

  it.each(statusTestDataProvider)('mapStatusResponse %s', (_name, { responseData, expectedData }) => {
    const approved = expectedData.status === 'approved'
    valueMapper.mapTxType.mockReturnValue(expectedData.transaction_type)
    valueMapper.mapCurrency.mockReturnValue(expectedData.currency)
    formatter.formatAmount.mockReturnValue(expectedData.first_amount)
    formatter.formatInstallment.mockReturnValue(expectedData.installment_count)
    formatter.formatDateTime.mockReturnValueOnce(expectedData.transaction_time)
    formatter.formatDateTime.mockReturnValueOnce(expectedData.cancel_time)

    const actual: Data = mapper.mapStatusResponse(responseData)

    expect(valueMapper.mapTxType).toHaveBeenCalledTimes(1)
    expect(valueMapper.mapTxType).toHaveBeenCalledWith(responseData.TxnType)
    expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
    expect(valueMapper.mapCurrency).toHaveBeenCalledWith(responseData.Currency, TX_TYPE.STATUS)
    expect(formatter.formatInstallment).toHaveBeenCalledTimes(1)
    expect(formatter.formatInstallment).toHaveBeenCalledWith(responseData.InstallmentCount, TX_TYPE.STATUS)
    if (approved) {
      expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
      expect(formatter.formatAmount).toHaveBeenCalledWith(responseData.PurchAmount, TX_TYPE.STATUS)
      expect(formatter.formatDateTime.mock.calls[0]).toStrictEqual([responseData.InsertDatetime, TX_TYPE.STATUS])
      if (expectedData.cancel_time !== null) {
        expect(formatter.formatDateTime.mock.calls[1]).toStrictEqual([
          `${responseData.VoidDate}T${responseData.VoidTime}`,
          TX_TYPE.STATUS,
        ])
      }
    } else {
      expect(formatter.formatAmount).not.toHaveBeenCalled()
      expect(formatter.formatDateTime).not.toHaveBeenCalled()
    }
    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expectedData)
  })

  it.each(orderHistoryTestDataProvider)('mapOrderHistoryResponse %s', (_name, { fixture, expectedData }) => {
    const actual: Data = realMapper(logger as unknown as PosLogger).mapOrderHistoryResponse(history(fixture))

    if (
      actual.transactions.length > 1 &&
      actual.transactions[0].transaction_time !== null &&
      actual.transactions[1].transaction_time !== null
    ) {
      expect(actual.transactions[1].transaction_time.getTime()).toBeGreaterThan(
        actual.transactions[0].transaction_time.getTime(),
      )
    }
    expect(actual.transactions).toHaveLength(actual.trans_count)
    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expectedData)
    for (const [index, tx] of (actual.transactions as Data[]).entries()) {
      expectSameSorted(tx, expectedData.transactions[index])
    }
  })

  it.each(refundTestDataProvider)('mapRefundResponse %s', (_name, { responseData, expectedData }) => {
    const actual: Data = mapper.mapRefundResponse(responseData)

    takeNonEmpty(actual, 'all')
    expect(actual).toStrictEqual(expectedData)
    expect(Object.keys(actual)).toStrictEqual(Object.keys(expectedData))
  })

  it.each(cancelTestDataProvider)('mapCancelResponse %s', (_name, { responseData, expectedData }) => {
    const actual: Data = mapper.mapCancelResponse(responseData)

    takeNonEmpty(actual, 'all')
    expect(actual).toStrictEqual(expectedData)
    expect(Object.keys(actual)).toStrictEqual(Object.keys(expectedData))
  })

  describe('additions with the real formatter and value mapper', () => {
    const order = { id: '202210313C0D', amount: 1.01, currency: 'TRY' } as PosOrder
    const model3d = threeDPaymentDataProvider.find(
      ([name]) => name === 'success1',
    )?.[1] as (typeof threeDPaymentDataProvider)[number][1]
    const pay3d = threeDPayPaymentDataProvider.find(
      ([name]) => name === 'success1',
    )?.[1] as (typeof threeDPayPaymentDataProvider)[number][1]
    const statusCancelled = statusTestDataProvider.find(
      ([name]) => name === 'success_pre_pay_then_cancel',
    )?.[1] as (typeof statusTestDataProvider)[number][1]

    // addition: the full 3D model success path with real conversions
    it('maps a successful 3D model payment', () => {
      const actual: Data = realMapper().map3DPaymentData(model3d.threeDResponseData, model3d.paymentData, 'pay', order)

      expect(actual.status).toBe('approved')
      expect(actual.amount).toBe(1.01)
      expect(actual.currency).toBe('TRY')
      expect(actual.md_status).toBe('1')
      expect(actual.transaction_time).toStrictEqual(new Date('2022-10-31T22:34:18+03:00'))
      expect(actual.installment_count).toBe(0)
      expect(actual.batch_num).toBe('4320')
      expect(actual.transaction_security).toBeNull()
      expect(actual).not.toHaveProperty('requires_manual_review')
    })

    // addition: the 3D Pay success with real conversions
    it('maps a successful 3D Pay payment', () => {
      const actual: Data = realMapper().map3DPayResponseData(pay3d.paymentData, 'pay', order)

      expect(actual.status).toBe('approved')
      expect(actual.installment_count).toBe(2)
      expect(actual.payment_model).toBe('3d_pay')
      expect(actual.amount).toBe(1.01)
    })

    // addition: the mapper itself approves a hosted payment on ProcReturnCode 00; the gateway applies the 3D rule
    it('3D Pay with ProcReturnCode 00 and 3DStatus 2 is still mapped approved', () => {
      const actual: Data = realMapper().map3DPayResponseData({ ...pay3d.paymentData, '3DStatus': '2' }, 'pay', order)

      expect(actual.status).toBe('approved')
      expect(actual.md_status).toBe('2')
      expect(actual.md_error_code).toBe('00')
    })

    // addition: strict approval of the 3D model — an approved provision never rescues a failed 3D leg
    // (without the 3D guard each of these inputs would map as approved)
    it.each(['2', '3', '4', '7', '-1', '0', '01', ' 1', '1 ', '', null, 1])(
      'an approved provision after 3DStatus %j is declined and flagged for manual review',
      (status) => {
        const callback: Data = { ...model3d.threeDResponseData, '3DStatus': status }
        const actual: Data = realMapper().map3DPaymentData(callback, model3d.paymentData, 'pay', order)

        expect(actual.status).toBe('declined')
        expect(actual.requires_manual_review).toBe(true)
        expect(actual.md_status).toBe(typeof status === 'string' && status !== '' ? status : null)
        expect(actual.md_error_code).not.toBeNull()
      },
    )

    // addition: a failed 3D leg without a provision is declined and not flagged
    it('a failed 3D leg without a provision is declined without a review flag', () => {
      const callback: Data = { ...model3d.threeDResponseData, '3DStatus': '-1' }
      const actual: Data = realMapper().map3DPaymentData(callback, null, 'pay', order)

      expect(actual.status).toBe('declined')
      expect(actual).not.toHaveProperty('requires_manual_review')
    })

    // addition: a successful 3D leg without a provision never approves
    it.each([null, {}])('3D success with provision %j is declined', (provision) => {
      const actual: Data = realMapper().map3DPaymentData(model3d.threeDResponseData, provision, 'pay', order)

      expect(actual.status).toBe('declined')
      expect(actual).not.toHaveProperty('requires_manual_review')
    })

    // addition: a declined provision after a successful 3D leg is declined with the provision error
    it('3D success with a declined provision is declined with the bank error', () => {
      const provision = { ...model3d.paymentData, ProcReturnCode: 'M041', ErrMsg: 'Geçersiz kart numarası' }
      const actual: Data = realMapper().map3DPaymentData(model3d.threeDResponseData, provision, 'pay', order)

      expect(actual.status).toBe('declined')
      expect(actual.error_code).toBe('M041')
      expect(actual.error_message).toBe('Geçersiz kart numarası')
      expect(actual).not.toHaveProperty('requires_manual_review')
    })

    // addition: only an exact 00 approves a hosted payment
    it.each(['0', '000', '0 0', ' 00', '00 ', 'V033', '', null])(
      '3D Pay with ProcReturnCode %j is declined',
      (code) => {
        const actual: Data = realMapper().map3DPayResponseData(
          { ...pay3d.paymentData, ProcReturnCode: code },
          'pay',
          order,
        )

        expect(actual.status).toBe('declined')
      },
    )

    // addition: only an exact 00 approves the provision, payment, cancel and status answers
    it.each(['0', '000', ' 00', '00 ', 'V033', '', null, 0])(
      'ProcReturnCode %j never approves a single answer',
      (code) => {
        const raw = { ProcReturnCode: code, TransId: '1', AuthCode: 'A', ErrMsg: 'x' }

        expect(realMapper().mapPaymentResponse(raw, 'pay', order).status).toBe('declined')
        expect(realMapper().mapCancelResponse(raw).status).toBe('declined')
        expect(realMapper().mapRefundResponse(raw).status).toBe('declined')
        expect(realMapper().mapStatusResponse(raw).status).toBe('declined')
        expect(realMapper().mapOrderHistoryResponse({ PaymentRequestExtended: { PaymentRequest: raw } }).status).toBe(
          'declined',
        )
      },
    )

    // addition: a 5-digit VoidTime is padded to the six digits of the date-time layout
    // deviation: F21 without padding the formatter would receive `20240119T13405`
    it('mapStatusResponse pads a short VoidTime', () => {
      const raw = { ...statusCancelled.responseData, VoidTime: '13405' }
      const actual: Data = realMapper().mapStatusResponse(raw)

      expect(actual.cancel_time).toStrictEqual(new Date('2024-01-19T01:34:05+03:00'))
    })

    // addition: the status answer of the real fixtures with real conversions
    it('mapStatusResponse with the real conversions', () => {
      const actual: Data = realMapper().mapStatusResponse(statusCancelled.responseData)

      expect(actual.status).toBe('approved')
      expect(actual.order_status).toBe('CANCELED')
      expect(actual.transaction_type).toBe('pre')
      expect(actual.first_amount).toBe(1.01)
      expect(actual.installment_count).toBe(3)
      expect(actual.transaction_time).toStrictEqual(new Date('2024-01-19T21:47:43+03:00'))
      expect(actual.cancel_time).toStrictEqual(new Date('2024-01-19T21:47:44+03:00'))
    })

    // addition: empty answers never throw and are never approved
    it('empty answers map to declined shapes', () => {
      const m = realMapper()

      expect(m.mapStatusResponse({}).status).toBe('declined')
      expect(m.mapCancelResponse({}).status).toBe('declined')
      expect(m.mapRefundResponse({}).status).toBe('declined')
      expect(m.mapPaymentResponse({}, 'pay', order).status).toBe('declined')
      expect(m.map3DPaymentData({}, null, 'pay', {} as PosOrder).status).toBe('declined')
      expect(m.map3DPayResponseData({}, 'pay', {} as PosOrder).status).toBe('declined')
      expect(m.map3DHostResponseData({}, 'pay', {} as PosOrder).status).toBe('declined')
      const history = m.mapOrderHistoryResponse({})
      expect(history.status).toBeNull()
      expect(history.trans_count).toBe(0)
      expect(history.transactions).toStrictEqual([])
    })

    // addition: a payment answer without any success code is declined without throwing
    it('mapPaymentResponse with only an error code is declined', () => {
      const actual: Data = realMapper().mapPaymentResponse({ ProcReturnCode: 'M041' }, 'pay', { amount: 1 } as PosOrder)

      expect(actual.status).toBe('declined')
      expect(actual.error_code).toBe('M041')
      expect(actual.amount).toBe(1)
      expect(actual.transaction_time).toBeNull()
    })

    // addition: an order history of an unexpected shape yields no transactions
    it.each(['x', 5, [], null, true])(
      'mapOrderHistoryResponse with PaymentRequestExtended %j has no transactions',
      (value) => {
        const actual: Data = realMapper().mapOrderHistoryResponse({ PaymentRequestExtended: value })

        expect(actual.status).toBeNull()
        expect(actual.trans_count).toBe(0)
        expect(actual.transactions).toStrictEqual([])
      },
    )

    // addition: list entries that are not records are skipped, records without a request too
    it('mapOrderHistoryResponse skips malformed list entries', () => {
      const actual: Data = realMapper().mapOrderHistoryResponse({
        PaymentRequestExtended: [
          'x',
          null,
          { PaymentRequest: 'y' },
          { PaymentRequest: { ProcReturnCode: '00', OrderId: 'A1', TxnType: 'Auth', Currency: '949' } },
        ],
      })

      expect(actual.trans_count).toBe(1)
      expect(actual.order_id).toBe('A1')
      expect(actual.transactions[0].transaction_type).toBe('pay')
    })

    // addition: non-scalar bank values never become "[object Object]" text
    it('non-scalar bank values map to null', () => {
      const actual: Data = realMapper().mapCancelResponse({
        ProcReturnCode: { a: '00' },
        TransId: { a: 1 },
        AuthCode: ['x'],
        HostRefNum: { b: 'c' },
        ErrMsg: ['m'],
      })

      expect(actual.status).toBe('declined')
      expect(actual.order_id).toBeNull()
      expect(actual.auth_code).toBeNull()
      expect(actual.ref_ret_num).toBeNull()
      expect(actual.proc_return_code).toBeNull()
      expect(actual.error_message).toBeNull()
      expect(JSON.stringify(actual)).not.toContain('[object Object]')

      const status: Data = realMapper().mapStatusResponse({
        ProcReturnCode: '00',
        OrderId: { a: 1 },
        OrgOrderId: ['x'],
        CardMask: { a: 1 },
        AuthCode: { a: 1 },
      })
      expect(status.order_id).toBeNull()
      expect(status.org_order_id).toBeNull()
      expect(status.masked_number).toBeNull()
      expect(status.auth_code).toBeNull()

      const threeD: Data = realMapper().map3DPayResponseData(
        { ProcReturnCode: '00', OrderId: { a: 1 }, '3DStatus': { a: 1 }, CardMask: ['4'], Eci: { a: 1 } },
        'pay',
        {} as PosOrder,
      )
      expect(threeD.order_id).toBeNull()
      expect(threeD.md_status).toBeNull()
      expect(threeD.masked_number).toBeNull()
      expect(threeD.eci).toBeNull()
    })

    // addition: callback values the bank did not send as text never reach the card number of a result
    it('logger contexts never contain an unmasked 16-digit card number', () => {
      const calls: string[] = []
      const spy: PosLogger = {
        debug: (message, context) => calls.push(JSON.stringify([message, context])),
        info: (message, context) => calls.push(JSON.stringify([message, context])),
        warn: (message, context) => calls.push(JSON.stringify([message, context])),
        error: (message, context) => calls.push(JSON.stringify([message, context])),
      }
      const m = realMapper(spy)
      const callback = { ...model3d.threeDResponseData, Pan: '4155650100416111', CardNo: '4155650100416111' }
      const provision = { ...model3d.paymentData, Pan: '4155650100416111' }

      m.map3DPaymentData(callback, provision, 'pay', order)
      m.mapPaymentResponse({ ProcReturnCode: '00', Pan: '4155650100416111' }, 'pay', order)

      expect(calls.length).toBeGreaterThan(0)
      for (const call of calls) {
        expect(call).not.toMatch(/\d{16}/)
      }
    })
  })
})
