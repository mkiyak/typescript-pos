import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VakifKatilimPosResponseDataMapper } from '../../../../../src/data-mapper/response/mapper/VakifKatilimPosResponseDataMapper.js'
import { BoaPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/BoaPosResponseValueFormatter.js'
import type { ResponseValueFormatterInterface } from '../../../../../src/data-mapper/response/value-formatter/ResponseValueFormatterInterface.js'
import type { ResponseValueMapperInterface } from '../../../../../src/data-mapper/response/value-mapper/ResponseValueMapperInterface.js'
import { VakifKatilimPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/VakifKatilimPosResponseValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import type { PosLogger } from '../../../../../src/logger.js'
import { TX_TYPE } from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'
import {
  cancelTestDataProvider,
  orderHistoryTestDataProvider,
  paymentTestDataProvider,
  refundTestDataProvider,
  statusTestDataProvider,
  threeDHostPaymentDataProvider,
  threeDPaymentDataProvider,
} from './VakifKatilimPosResponseDataMapper.data.js'

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

const NO_DATES = ['0001-01-01T00:00:00', '00010101T00:00:00']

describe('VakifKatilimPosResponseDataMapper', () => {
  let formatter: Mocked<ResponseValueFormatterInterface>
  let valueMapper: Mocked<ResponseValueMapperInterface>
  let logger: Mocked<PosLogger>
  let mapper: VakifKatilimPosResponseDataMapper
  const realValueMapper = new VakifKatilimPosResponseValueMapper()

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
    mapper = new VakifKatilimPosResponseDataMapper(
      formatter as unknown as ResponseValueFormatterInterface,
      valueMapper as unknown as ResponseValueMapperInterface,
      logger as unknown as PosLogger,
    )
  })

  const realMapper = (log?: PosLogger) =>
    new VakifKatilimPosResponseDataMapper(
      new BoaPosResponseValueFormatter(),
      new VakifKatilimPosResponseValueMapper(),
      log,
    )

  it('supports', () => {
    expect(VakifKatilimPosResponseDataMapper.supports('VakifKatilimPos')).toBe(true)
    expect(VakifKatilimPosResponseDataMapper.supports('AkbankPos')).toBe(false)
  })

  it.each([
    [null, false],
    ['', false],
    ['HashDataError', false],
    ['00', true],
  ])('is3dAuthSuccess(%j) -> %j', (mdStatus, expected) => {
    expect(mapper.is3dAuthSuccess(mdStatus)).toBe(expected)
  })

  it.each([
    [{}, null],
    [{ ResponseCode: '00' }, '00'],
  ])('extractMdStatus(%j) -> %j', (responseData, expected) => {
    expect(mapper.extractMdStatus(responseData)).toBe(expected)
  })

  it.each(paymentTestDataProvider)('mapPaymentResponse %s', (_name, { txType, responseData, expectedData }) => {
    const message = responseData.VPosMessage
    const approved = expectedData.status === 'approved'
    if (approved) {
      formatter.formatAmount.mockReturnValue(expectedData.amount)
      formatter.formatInstallment.mockReturnValue(expectedData.installment_count)
      valueMapper.mapCurrency.mockReturnValue(expectedData.currency)
      if (expectedData.transaction_time) formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
    }

    const actual: Data = mapper.mapPaymentResponse(responseData, txType, {} as PosOrder)

    if (approved) {
      expect(formatter.formatAmount.mock.calls).toStrictEqual([[message.Amount, txType]])
      expect(formatter.formatInstallment.mock.calls).toStrictEqual([[message.InstallmentCount, txType]])
      expect(valueMapper.mapCurrency.mock.calls).toStrictEqual([[message.CurrencyCode, txType]])
      const txTimeWith = NO_DATES.includes(responseData.TransactionTime) ? 'now' : responseData.TransactionTime
      expect(formatter.formatDateTime.mock.calls).toStrictEqual([[txTimeWith, txType]])
    } else {
      expect(formatter.formatAmount).not.toHaveBeenCalled()
    }
    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expectedData)
  })

  it.each(threeDPaymentDataProvider)(
    'map3DPaymentData %s',
    (_name, { order, txType, threeDResponseData, paymentData, expectedData }) => {
      const message = paymentData.VPosMessage
      const callbackApproved = threeDResponseData.ResponseCode === '00'
      if (callbackApproved) {
        formatter.formatAmount.mockReturnValue(expectedData.amount)
        valueMapper.mapCurrency.mockReturnValue(expectedData.currency)
        formatter.formatInstallment.mockReturnValue(expectedData.installment_count)
        formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
      }

      const actual: Data = mapper.map3DPaymentData(threeDResponseData, paymentData, txType, order)

      if (callbackApproved) {
        expect(formatter.formatAmount.mock.calls).toStrictEqual([[message.Amount, txType]])
        expect(valueMapper.mapCurrency.mock.calls).toStrictEqual(
          message.CurrencyCode === undefined ? [] : [[message.CurrencyCode, txType]],
        )
        expect(formatter.formatInstallment.mock.calls).toStrictEqual([[message.InstallmentCount, txType]])
        const txTimeWith = NO_DATES.includes(paymentData.TransactionTime) ? 'now' : paymentData.TransactionTime
        expect(formatter.formatDateTime.mock.calls).toStrictEqual([[txTimeWith, txType]])
      }

      expect(actual).toHaveProperty('all')
      if (Object.keys(paymentData).length > 0) takeNonEmpty(actual, 'all')
      else delete actual.all
      takeNonEmpty(actual, '3d_all')
      expectSameSorted(actual, expectedData)
    },
  )

  it.each(threeDHostPaymentDataProvider)(
    'map3DHostResponseData %s',
    (_name, { order, txType, paymentData, expectedData }) => {
      if (expectedData.transaction_time) formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)

      const actual: Data = mapper.map3DHostResponseData(paymentData, txType, order)

      expect(formatter.formatDateTime.mock.calls).toStrictEqual(expectedData.transaction_time ? [['now', txType]] : [])
      takeNonEmpty(actual, 'all')
      expectSameSorted(actual, expectedData)
    },
  )

  it('map3DPayResponseData is not supported', () => {
    expect(() => mapper.map3DPayResponseData({}, TX_TYPE.PAY_AUTH, {} as PosOrder)).toThrow(NotImplementedError)
  })

  it.each(refundTestDataProvider)('mapRefundResponse %s', (_name, { responseData, expectedData }) => {
    const actual: Data = mapper.mapRefundResponse(responseData)

    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expectedData)
  })

  it.each(cancelTestDataProvider)('mapCancelResponse %s', (_name, { responseData, expectedData }) => {
    const actual: Data = mapper.mapCancelResponse(responseData)

    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expectedData)
  })

  it.each(statusTestDataProvider)('mapStatusResponse %s', (_name, { responseData, expectedData }) => {
    const txType = TX_TYPE.STATUS
    const approved = expectedData.status === 'approved'
    const orderContract = responseData.VPosOrderData?.OrderContract
    if (approved) {
      // call 1 is the first amount, call 2 the captured amount
      formatter.formatAmount
        .mockReturnValueOnce(expectedData.first_amount)
        .mockReturnValueOnce(expectedData.capture_amount)
      valueMapper.mapOrderStatus
        .mockReturnValueOnce(expectedData.order_status)
        .mockImplementationOnce((status: string) => realValueMapper.mapOrderStatus(status))
      formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
      formatter.formatInstallment.mockReturnValue(expectedData.installment_count)
      valueMapper.mapSecureType.mockReturnValue(expectedData.payment_model)
      valueMapper.mapCurrency.mockReturnValue(expectedData.currency)
    }

    const actual: Data = mapper.mapStatusResponse(responseData)

    if (approved) {
      const amountCalls = [[orderContract.FirstAmount, txType]]
      if (orderContract.TranAmount !== undefined) amountCalls.push([orderContract.TranAmount, txType])
      expect(formatter.formatAmount.mock.calls).toStrictEqual(amountCalls)
      expect(valueMapper.mapOrderStatus.mock.calls).toStrictEqual([
        [orderContract.LastOrderStatus],
        [orderContract.OrderStatus],
      ])
      expect(formatter.formatDateTime.mock.calls).toStrictEqual([[orderContract.OrderDate, txType]])
      expect(formatter.formatInstallment.mock.calls).toStrictEqual([[orderContract.InstallmentCount, txType]])
      expect(valueMapper.mapSecureType.mock.calls).toStrictEqual([[orderContract.TransactionSecurity, txType]])
      expect(valueMapper.mapCurrency.mock.calls).toStrictEqual([[orderContract.FEC, txType]])
    }
    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expectedData)
  })

  it.each(orderHistoryTestDataProvider)('mapOrderHistoryResponse %s', (_name, { input, expected }) => {
    const actual: Data = realMapper().mapOrderHistoryResponse(input)

    if (actual.transactions.length > 1) {
      const [first, second] = actual.transactions as [Data, Data]
      if (first.transaction_time !== null && second.transaction_time !== null) {
        expect(second.transaction_time.getTime()).toBeGreaterThan(first.transaction_time.getTime())
      }
    }
    expect(actual.transactions).toHaveLength(actual.trans_count)

    for (const [key, tx] of (actual.transactions as Data[]).entries()) {
      const want = (expected.transactions as Data[])[key] as Data
      expect(tx.transaction_time, `tx: ${key}`).toStrictEqual(want.transaction_time)
      expect(tx.capture_time, `tx: ${key}`).toStrictEqual(want.capture_time)
      // the dates are compared above, the rest is compared key-sorted
      for (const field of ['cancel_time', 'transaction_time', 'capture_time']) {
        delete tx[field]
        delete want[field]
      }
      expectSameSorted(tx, want)
    }

    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expected)
  })

  describe('additions', () => {
    const order = {} as PosOrder
    const clone = <T>(value: T): T => structuredClone(value)
    const find = (list: Array<[string, Data]>, name: string): Data => {
      const entry = list.find(([n]) => n === name)
      if (entry === undefined) throw new Error(`missing fixture ${name}`)
      return clone(entry[1])
    }
    const payment = (): Data => find(paymentTestDataProvider, 'success1').responseData
    const threeD = find(threeDPaymentDataProvider, 'success1')
    const callback = (): Data => clone(threeD.threeDResponseData)
    const provision = (): Data => clone(threeD.paymentData)
    const hostCallback = (): Data => find(threeDHostPaymentDataProvider, 'success').paymentData
    const statusRaw = (): Data => find(statusTestDataProvider, 'success1').responseData
    const historyRaw = (): Data => find(orderHistoryTestDataProvider, 'success_pay_then_cancel').input
    const cancelRaw = (): Data => find(cancelTestDataProvider, 'success1').responseData

    // addition: V4, the real formatter and value mapper turn the kuruş amounts and bank codes into library values
    it('maps the approved 3D flow with the real formatter and value mapper', () => {
      const actual: Data = realMapper().map3DPaymentData(callback(), provision(), TX_TYPE.PAY_AUTH, {
        currency: 'TRY',
      } as PosOrder)

      expect(actual.status).toBe('approved')
      expect(actual.amount).toBe(10.01)
      expect(actual.currency).toBe('TRY')
      expect(actual.payment_model).toBe('3d')
      expect(actual.installment_count).toBe(0)
      expect(actual.order_id).toBe('2024070152BF')
      expect(actual.batch_num).toBe('0')
      // deviation: B13 the bank time has no offset and is read as Türkiye time
      expect(actual.transaction_time).toStrictEqual(new Date('2024-07-01T12:49:44.428+03:00'))
    })

    // addition: V4, an answer that is a list of order records maps the first record
    it('maps the first record of a status answer that holds several', () => {
      const raw = historyRaw()
      const actual: Data = realMapper().mapStatusResponse(raw)

      expect(actual.status).toBe('approved')
      expect(actual.order_status).toBe('CANCELED')
      expect(actual.order_id).toBe('202407019FDB')
      expect(actual.remote_order_id).toBe('6373641')
      expect(actual.transaction_id).toBe('435438')
    })

    // addition: V4, an order record that is not a record leaves the declined defaults
    it.each([
      [{ OrderContract: 'x' }],
      [{ OrderContract: ['x'] }],
      [{ OrderContract: [] }],
      [{}],
      [''],
      [null],
      ['text'],
      [['a']],
    ])('mapStatusResponse with VPosOrderData %j is declined with defaults', (data) => {
      const actual: Data = realMapper().mapStatusResponse({
        VPosOrderData: data,
        ResponseCode: '00',
        MerchantOrderId: 'A1',
      })

      expect(actual.status).toBe('declined')
      expect(actual.order_status).toBeNull()
      expect(actual.first_amount).toBeNull()
      expect(actual.masked_number).toBeNull()
    })

    // addition: V4, one record is a single object, not a list
    it('maps an order history of a single record', () => {
      const raw = historyRaw()
      raw.VPosOrderData.OrderContract = raw.VPosOrderData.OrderContract[0]
      const actual: Data = realMapper().mapOrderHistoryResponse(raw)

      expect(actual.trans_count).toBe(1)
      expect(actual.transactions).toHaveLength(1)
      expect(actual.order_id).toBe('202407019FDB')
      expect(actual.remote_order_id).toBe('6373641')
    })

    it.each([
      [{ OrderContract: 'x' }],
      [{ OrderContract: ['x', 5] }],
      [{ OrderContract: [] }],
      [null],
      ['text'],
      [['a']],
    ])('mapOrderHistoryResponse with VPosOrderData %j lists nothing', (data) => {
      const actual: Data = realMapper().mapOrderHistoryResponse({ VPosOrderData: data, ResponseCode: '00' })

      expect(actual.trans_count).toBe(0)
      expect(actual.transactions).toStrictEqual([])
      expect(actual.order_id).toBeNull()
    })

    // addition: V4, an answer without the message is not a crash
    it('mapCancelResponse without a VPosMessage keeps no order id and does not throw', () => {
      const actual: Data = realMapper().mapCancelResponse({ ResponseCode: '00' })

      expect(actual.order_id).toBeNull()
      expect(actual.proc_return_code).toBe('00')
      expect(actual.remote_order_id).toBeNull()
    })

    it.each([[{}], [null], ['x'], [[]]])(
      'mapCancelResponse(%j) and mapRefundResponse are declined without throwing',
      (raw) => {
        for (const actual of [
          realMapper().mapCancelResponse(raw as never),
          realMapper().mapRefundResponse(raw as never),
        ] as Data[]) {
          expect(actual.status).toBe('declined')
          expect(actual.order_id).toBeNull()
          expect(actual.proc_return_code).toBeNull()
        }
      },
    )

    it('map3DHostResponseData of an empty answer is declined', () => {
      const actual: Data = realMapper().map3DHostResponseData({}, TX_TYPE.PAY_AUTH, order)

      expect(actual.status).toBe('declined')
      expect(actual.payment_model).toBe('3d_host')
      expect(actual.proc_return_code).toBeNull()
      expect(actual.order_id).toBeNull()
    })

    it.each(NO_DATES)('maps the no-date placeholder %s of a payment answer to now', (placeholder) => {
      const raw = payment()
      raw.TransactionTime = placeholder
      const before = Date.now()
      const actual: Data = realMapper().mapPaymentResponse(raw, TX_TYPE.PAY_AUTH, order)

      expect(actual.status).toBe('approved')
      expect(actual.transaction_time).toBeInstanceOf(Date)
      expect(actual.transaction_time.getTime()).toBeGreaterThanOrEqual(before)
    })

    // addition: V4, the bank time of a payment answer is read as Türkiye time, a missing one is now
    it('reads the payment answer time and falls back to now when it is missing', () => {
      const raw = payment()
      raw.TransactionTime = '2024-07-01T12:49:44.4281161'
      const read: Data = realMapper().mapPaymentResponse(raw, TX_TYPE.PAY_AUTH, order)
      expect(read.transaction_time).toStrictEqual(new Date('2024-07-01T12:49:44.428+03:00'))

      delete raw.TransactionTime
      const before = Date.now()
      const missing: Data = realMapper().mapPaymentResponse(raw, TX_TYPE.PAY_AUTH, order)
      expect(missing.status).toBe('approved')
      expect(missing.transaction_time.getTime()).toBeGreaterThanOrEqual(before)
    })

    // addition: V4, a bank time that cannot be read never hides the bank answer
    it('keeps the answer when its time cannot be read', () => {
      const raw = payment()
      raw.TransactionTime = 'garbage'
      const actual: Data = realMapper(logger as unknown as PosLogger).mapPaymentResponse(raw, TX_TYPE.PAY_AUTH, order)

      expect(actual.status).toBe('approved')
      expect(actual.transaction_time).toBeNull()
      expect(logger.warn).toHaveBeenCalledOnce()
    })

    // addition: approval is read from the exact own text of the untouched answer
    describe('approval reads the exact own ResponseCode', () => {
      const notExactly00: Array<[string, unknown]> = [
        ['padded left', ' 00'],
        ['padded right', '00 '],
        ['a number', 0],
        ['a duplicated element', ['00', '00']],
        ['an element with an attribute', { '@a': 'b', '#': '00' }],
        ['an empty record', {}],
        ['a nil element', { '@xsi:nil': 'true', '#': '' }],
        ['lower case letters', 'oo'],
      ]

      it.each(notExactly00)('mapPaymentResponse, %s', (_n, code) => {
        const raw = payment()
        raw.ResponseCode = code
        const actual: Data = realMapper().mapPaymentResponse(raw, TX_TYPE.PAY_AUTH, order)

        expect(actual.status).toBe('declined')
        expect(actual.auth_code).toBeNull()
        expect(actual.amount).toBeNull()
        expect(actual.masked_number ?? null).toBeNull()
      })

      it.each(notExactly00)('map3DPaymentData callback and provision, %s', (_n, code) => {
        const cb = callback()
        cb.ResponseCode = code
        const providedAnswer = provision()
        const actual: Data = realMapper().map3DPaymentData(cb, providedAnswer, TX_TYPE.PAY_AUTH, order)
        expect(actual.status).toBe('declined')

        const answer = provision()
        answer.ResponseCode = code
        const other: Data = realMapper().map3DPaymentData(callback(), answer, TX_TYPE.PAY_AUTH, order)
        expect(other.status).toBe('declined')
        expect(other.auth_code).toBeNull()
        expect(other.amount).toBeNull()
      })

      it.each(notExactly00)('map3DHostResponseData, %s', (_n, code) => {
        const raw = hostCallback()
        raw.ResponseCode = code
        const actual: Data = realMapper().map3DHostResponseData(raw, TX_TYPE.PAY_AUTH, order)

        expect(actual.status).toBe('declined')
        expect(actual.auth_code).toBeNull()
        expect(actual.order_id).toBeNull()
      })

      it.each(notExactly00)('mapCancelResponse and mapRefundResponse, %s', (_n, code) => {
        const raw = cancelRaw()
        raw.ResponseCode = code
        for (const actual of [realMapper().mapCancelResponse(raw), realMapper().mapRefundResponse(raw)] as Data[]) {
          expect(actual.status).toBe('declined')
          expect(actual.transaction_id).toBeNull()
          expect(actual.ref_ret_num).toBeNull()
        }
      })

      it.each(notExactly00)('mapStatusResponse and mapOrderHistoryResponse, %s', (_n, code) => {
        const status = statusRaw()
        status.ResponseCode = code
        const actual: Data = realMapper().mapStatusResponse(status)
        expect(actual.status).toBe('declined')
        expect(actual.first_amount).toBeNull()

        const history = historyRaw()
        history.ResponseCode = code
        const list: Data = realMapper().mapOrderHistoryResponse(history)
        expect(list.status).toBe('declined')
      })

      it.each(notExactly00)('the order record of a status answer, %s', (_n, code) => {
        const raw = statusRaw()
        raw.VPosOrderData.OrderContract.ResponseCode = code
        const actual: Data = realMapper().mapStatusResponse(raw)

        expect(actual.status).toBe('declined')
        expect(actual.first_amount).toBeNull()
        expect(actual.masked_number).toBeNull()
        expect(actual.order_status).toBeNull()
      })

      it.each(notExactly00)('the order records of a history answer, %s', (_n, code) => {
        const raw = historyRaw()
        for (const record of raw.VPosOrderData.OrderContract) record.ResponseCode = code
        const actual: Data = realMapper().mapOrderHistoryResponse(raw)

        for (const tx of actual.transactions as Data[]) {
          expect(tx.status).toBe('declined')
          expect(tx.capture_amount).toBeNull()
          expect(tx.masked_number).toBeNull()
        }
      })

      it.each([[' 00'], ['00 ']])('extractMdStatus hands the exact text %j on and it is no success', (code) => {
        const m = realMapper()
        expect(m.extractMdStatus({ ResponseCode: code })).toBe(code)
        expect(m.is3dAuthSuccess(m.extractMdStatus({ ResponseCode: code }))).toBe(false)
      })

      it.each([[0], [undefined], [null], [['00']], [{ '#': '00' }], ['']])(
        'extractMdStatus reads %j as absent',
        (code) => {
          expect(realMapper().extractMdStatus({ ResponseCode: code })).toBeNull()
        },
      )

      it('an inherited ResponseCode is not read', () => {
        const inherited = Object.create({ ResponseCode: '00' }) as Data
        expect(realMapper().extractMdStatus(inherited)).toBeNull()
        const payments = realMapper().mapPaymentResponse(Object.assign(inherited, { VPosMessage: {} }), 'pay', order)
        expect(payments.status).toBe('declined')
      })

      // The decision is taken on the untouched answer, but the values are read trimmed.
      it('still reads padded values of an approved answer trimmed', () => {
        const raw = payment()
        raw.RRN = ' 904115005554 '
        const actual: Data = realMapper().mapPaymentResponse(raw, TX_TYPE.PAY_AUTH, order)

        expect(actual.status).toBe('approved')
        expect(actual.ref_ret_num).toBe('904115005554')
      })
    })

    // addition: an approval needs the message that carries the booked values
    describe('approval needs its message', () => {
      it.each([[undefined], [null], ['x'], [['a']], [''], [{ '@xsi:nil': 'true', '#': '' }]])(
        'mapPaymentResponse with VPosMessage %j is declined',
        (message) => {
          const raw = payment()
          if (message === undefined) delete raw.VPosMessage
          else raw.VPosMessage = message
          const actual: Data = realMapper().mapPaymentResponse(raw, TX_TYPE.PAY_AUTH, order)

          if (message !== null && typeof message === 'object' && !Array.isArray(message)) {
            // a record, even an empty-looking one, is a message: the values stay null
            expect(actual.amount).toBeNull()
            return
          }
          expect(actual.status).toBe('declined')
          expect(actual.proc_return_code).toBe('00')
          expect(actual.error_code).toBeNull()
          expect(actual.auth_code).toBeNull()
          expect(actual.amount).toBeNull()
        },
      )

      it.each([[undefined], [null], ['x'], [['a']]])('a provision with VPosMessage %j is declined', (message) => {
        const answer = provision()
        if (message === undefined) delete answer.VPosMessage
        else answer.VPosMessage = message
        const actual: Data = realMapper().map3DPaymentData(callback(), answer, TX_TYPE.PAY_AUTH, order)

        expect(actual.status).toBe('declined')
        expect(actual.auth_code).toBeNull()
        expect(actual.amount).toBeNull()
        // the approved code stays visible: the gateway must treat it as an unknown outcome, not as a decline
        expect(actual.proc_return_code).toBe('00')
      })
    })

    // addition: V7, the card authentication decides, a provision answer never turns it around
    describe('3D flow', () => {
      it('a failed callback is declined even when the provision answer is approved', () => {
        const cb = callback()
        cb.ResponseCode = 'MPIAuthenticationStatusN'
        const actual: Data = realMapper().map3DPaymentData(cb, provision(), TX_TYPE.PAY_AUTH, {
          currency: 'TRY',
        } as PosOrder)

        expect(actual.status).toBe('declined')
        expect(actual.proc_return_code).toBe('MPIAuthenticationStatusN')
        expect(actual.error_code).toBe('MPIAuthenticationStatusN')
      })

      // deviation: the card authentication alone is not a payment; nothing was booked
      it.each([[null], [{}]])('an approved callback without a provision answer (%j) is declined', (answer) => {
        const actual: Data = realMapper().map3DPaymentData(callback(), answer, TX_TYPE.PAY_AUTH, order)

        expect(actual.status).toBe('declined')
        expect(actual.proc_return_code).toBe('00')
        expect(actual.payment_model).toBe('3d')
        expect(actual.auth_code).toBeNull()
        takeNonEmpty(actual, '3d_all')
      })

      it('does not read the order id from a message of the callback', () => {
        const cb = callback()
        delete cb.MerchantOrderId
        cb.VPosMessage = { MerchantOrderId: 'FROM-THE-BROWSER' }
        const actual: Data = realMapper().map3DPaymentData(cb, null, TX_TYPE.PAY_AUTH, order)

        expect(actual.order_id).toBeNull()
      })

      it('never reads amounts and cards from the callback', () => {
        const cb = callback()
        cb.VPosMessage = { Amount: '1', CurrencyCode: '0840', CardNumber: '4111********1111', BatchID: '9' }
        const actual: Data = realMapper().map3DPaymentData(cb, null, TX_TYPE.PAY_AUTH, order)

        expect(actual.amount).toBeNull()
        expect(actual.currency).toBeNull()
        expect(actual.masked_number).toBeUndefined()
        expect(actual.batch_num).toBeNull()
      })

      it('takes the currency of the order when the provision names none, and not when it names one', () => {
        const withOrder: Data = realMapper().map3DPaymentData(callback(), provision(), TX_TYPE.PAY_AUTH, {
          currency: 'EUR',
        } as PosOrder)
        expect(withOrder.currency).toBe('EUR')

        const answer = provision()
        answer.VPosMessage.CurrencyCode = '0840'
        const named: Data = realMapper().map3DPaymentData(callback(), answer, TX_TYPE.PAY_AUTH, {
          currency: 'EUR',
        } as PosOrder)
        expect(named.currency).toBe('USD')
      })

      it('does not mutate the answers it maps', () => {
        const cb = callback()
        const answer = provision()
        const before = structuredClone([cb, answer])
        realMapper().map3DPaymentData(cb, answer, TX_TYPE.PAY_AUTH, order)
        expect([cb, answer]).toStrictEqual(before)
      })

      it.each([[null], ['x'], [['a']], [5]])('a callback of %j is declined without throwing', (raw) => {
        const actual: Data = realMapper().map3DPaymentData(raw as never, null, TX_TYPE.PAY_AUTH, order)

        expect(actual.status).toBe('declined')
        expect(actual.order_id).toBeNull()
      })
    })

    // addition: non-scalar bank values never become "[object Object]" in text fields
    describe('non-scalar values', () => {
      const hostile: Array<[string, unknown]> = [
        ['a record', { a: 'b' }],
        ['a list', ['1', '2']],
        ['a nil element', { '@xsi:nil': 'true', '#': '' }],
        ['a boolean', true],
      ]

      it.each(hostile)('payment answer fields, %s', (_n, value) => {
        const raw = payment()
        raw.MerchantOrderId = value
        raw.OrderId = value
        raw.RRN = value
        raw.Stan = value
        raw.ProvisionNumber = value
        raw.VPosMessage.CardNumber = value
        raw.VPosMessage.BatchID = value
        raw.VPosMessage.Amount = value
        raw.VPosMessage.CurrencyCode = value
        raw.VPosMessage.InstallmentCount = value
        const actual: Data = realMapper().mapPaymentResponse(raw, TX_TYPE.PAY_AUTH, order)

        expect(actual.status).toBe('approved')
        for (const key of [
          'order_id',
          'remote_order_id',
          'ref_ret_num',
          'transaction_id',
          'auth_code',
          'masked_number',
          'batch_num',
          'amount',
          'currency',
          'installment_count',
        ]) {
          expect(actual[key], key).toBeNull()
        }
      })

      it.each(hostile)('callback and provision fields, %s', (_n, value) => {
        const cb = callback()
        cb.MerchantOrderId = value
        const answer = provision()
        answer.MerchantOrderId = value
        answer.OrderId = value
        answer.VPosMessage.BatchId = value
        answer.VPosMessage.CardNumber = value
        const actual: Data = realMapper().map3DPaymentData(cb, answer, TX_TYPE.PAY_AUTH, order)

        expect(actual.order_id).toBeNull()
        expect(actual.remote_order_id).toBeNull()
        expect(actual.batch_num).toBeNull()
        expect(actual.masked_number).toBeNull()
      })

      it.each(hostile)('3D host fields, %s', (_n, value) => {
        const raw = hostCallback()
        raw.MerchantOrderId = value
        raw.OrderId = value
        raw.RRN = value
        raw.Stan = value
        raw.ProvisionNumber = value
        const actual: Data = realMapper().map3DHostResponseData(raw, TX_TYPE.PAY_AUTH, order)

        for (const key of ['order_id', 'remote_order_id', 'ref_ret_num', 'transaction_id', 'auth_code']) {
          expect(actual[key], key).toBeNull()
        }
      })

      it.each(hostile)('order record fields, %s', (_n, value) => {
        const raw = statusRaw()
        const contract = raw.VPosOrderData.OrderContract
        for (const key of [
          'MerchantOrderId',
          'OrderId',
          'CardNumber',
          'FEC',
          'TransactionSecurity',
          'FirstAmount',
          'InstallmentCount',
          'OrderDate',
          'RRN',
          'Stan',
          'ProvNumber',
          'LastOrderStatus',
        ]) {
          contract[key] = value
        }
        const actual: Data = realMapper().mapStatusResponse(raw)

        for (const key of [
          'order_id',
          'remote_order_id',
          'masked_number',
          'currency',
          'payment_model',
          'first_amount',
          'installment_count',
          'transaction_time',
          'ref_ret_num',
          'transaction_id',
          'auth_code',
          'order_status',
        ]) {
          expect(actual[key], key).toBeNull()
        }
      })

      it.each(hostile)('cancel answer fields, %s', (_n, value) => {
        const raw = cancelRaw()
        raw.VPosMessage.MerchantOrderId = value
        raw.MerchantOrderId = value
        raw.OrderId = value
        raw.Stan = value
        raw.RRN = value
        const actual: Data = realMapper().mapCancelResponse(raw)

        for (const key of ['order_id', 'remote_order_id', 'transaction_id', 'ref_ret_num']) {
          expect(actual[key], key).toBeNull()
        }
      })

      it.each(hostile)('history record fields, %s', (_n, value) => {
        const raw = historyRaw()
        for (const record of raw.VPosOrderData.OrderContract) {
          record.MerchantOrderId = value
          record.OrderId = value
          record.CardNumber = value
        }
        const actual: Data = realMapper().mapOrderHistoryResponse(raw)

        expect(actual.order_id).toBeNull()
        expect(actual.remote_order_id).toBeNull()
        expect((actual.transactions as Data[]).every((tx) => tx.masked_number === null)).toBe(true)
      })
    })

    // addition: V4, a status answer is declined by the record's own code even when the answer is approved
    it('declines a status record the bank itself declined', () => {
      const raw = statusRaw()
      raw.VPosOrderData.OrderContract.ResponseCode = '51'
      raw.VPosOrderData.OrderContract.ResponseExplain = 'Limit Yetersiz.'
      const actual: Data = realMapper().mapStatusResponse(raw)

      expect(actual.status).toBe('declined')
      expect(actual.proc_return_code).toBe('51')
      expect(actual.error_code).toBe('51')
      expect(actual.error_message).toBe('Limit Yetersiz.')
      expect(actual.masked_number).toBeNull()
      expect(actual.first_amount).toBeNull()
    })

    it('declines a history record the bank itself declined and keeps the approved ones', () => {
      const raw = historyRaw()
      raw.VPosOrderData.OrderContract[1].ResponseCode = '51'
      raw.VPosOrderData.OrderContract[1].ResponseExplain = 'Limit Yetersiz.'
      const actual: Data = realMapper().mapOrderHistoryResponse(raw)

      expect(actual.status).toBe('approved')
      const [first, second] = actual.transactions as [Data, Data]
      expect(first.status).toBe('approved')
      expect(second.status).toBe('declined')
      expect(second.error_code).toBe('51')
      expect(second.error_message).toBe('Limit Yetersiz.')
      expect(second.masked_number).toBeNull()
      expect(second.cancel_time).toBeUndefined()
    })

    // addition: a zero amount is not a capture
    it('does not call a zero amount a capture', () => {
      const raw = statusRaw()
      raw.VPosOrderData.OrderContract.FirstAmount = '0.00'
      raw.VPosOrderData.OrderContract.TranAmount = '0'
      const actual: Data = realMapper().mapStatusResponse(raw)

      expect(actual.status).toBe('approved')
      expect(actual.capture).toBe(false)
      expect(actual.capture_time).toBeNull()
    })

    it('marks a captured status record with the capture time', () => {
      const raw = statusRaw()
      raw.VPosOrderData.OrderContract.TranAmount = '9.30'
      const actual: Data = realMapper().mapStatusResponse(raw)

      expect(actual.capture).toBe(true)
      expect(actual.capture_amount).toBe(9.3)
      expect(actual.capture_time).toStrictEqual(actual.transaction_time)
    })

    // addition: a time the bank prints as "no date" or cannot be read never hides the answer
    it.each([
      ['the year-one placeholder', '0001-01-01T00:00:00'],
      ['garbage', 'garbage'],
    ])('reads %s of an order date as absent without losing the answer', (_n, date) => {
      const raw = statusRaw()
      raw.VPosOrderData.OrderContract.OrderDate = date
      const actual: Data = realMapper().mapStatusResponse(raw)

      expect(actual.status).toBe('approved')
      expect(actual.transaction_time).toBeNull()
    })

    it('does not read the order status of a history record from a nested value', () => {
      const raw = historyRaw()
      raw.VPosOrderData.OrderContract[0].OrderStatus = { a: 'b' }
      raw.VPosOrderData.OrderContract[0].LastOrderStatus = { a: 'b' }
      raw.VPosOrderData.OrderContract[0].LastOrderStatusDescription = { a: 'b' }
      const actual: Data = realMapper().mapOrderHistoryResponse(raw)

      const [first] = actual.transactions as [Data]
      expect(first.status).toBe('approved')
      expect(first.order_status).toBeNull()
      expect(first.capture_amount).toBeNull()
    })

    // addition: the answers handed in are never changed
    it('does not change the answers it maps', () => {
      const answers = [payment(), statusRaw(), historyRaw(), cancelRaw(), hostCallback()]
      const before = structuredClone(answers)
      const m = realMapper()
      m.mapPaymentResponse(answers[0] as Data, TX_TYPE.PAY_AUTH, order)
      m.mapStatusResponse(answers[1] as Data)
      m.mapOrderHistoryResponse(answers[2] as Data)
      m.mapCancelResponse(answers[3] as Data)
      m.map3DHostResponseData(answers[4] as Data, TX_TYPE.PAY_AUTH, order)
      expect(answers).toStrictEqual(before)
    })

    it.each([[null], ['x'], [['a']], [5]])(
      'mapPaymentResponse(%j) and mapStatusResponse are declined without throwing',
      (raw) => {
        const m = realMapper()
        expect((m.mapPaymentResponse(raw as never, TX_TYPE.PAY_AUTH, order) as Data).status).toBe('declined')
        expect((m.mapStatusResponse(raw as never) as Data).status).toBe('declined')
        expect((m.mapOrderHistoryResponse(raw as never) as Data).status).toBe('declined')
        expect((m.map3DHostResponseData(raw as never, TX_TYPE.PAY_AUTH, order) as Data).status).toBe('declined')
      },
    )
  })
})
