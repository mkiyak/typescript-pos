import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GarantiPosResponseDataMapper } from '../../../../../src/data-mapper/response/mapper/GarantiPosResponseDataMapper.js'
import { GarantiPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/GarantiPosResponseValueFormatter.js'
import type { ResponseValueFormatterInterface } from '../../../../../src/data-mapper/response/value-formatter/ResponseValueFormatterInterface.js'
import { GarantiPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/GarantiPosResponseValueMapper.js'
import type { ResponseValueMapperInterface } from '../../../../../src/data-mapper/response/value-mapper/ResponseValueMapperInterface.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import { noopLogger, type PosLogger } from '../../../../../src/logger.js'
import { MODEL, TX_TYPE } from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'
import {
  cancelTestDataProvider,
  orderHistoryTestDataProvider,
  paymentTestDataProvider,
  refundTestDataProvider,
  statusTestDataProvider,
  threeDPaymentDataProvider,
  threeDPayPaymentDataProvider,
  tr,
} from './GarantiPosResponseDataMapper.data.js'

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

/** PHP ksort + assertSame: same keys (any order) with identical values. */
function expectSameSorted(actual: Data, expected: Data): void {
  expect(Object.keys(actual).sort()).toStrictEqual(Object.keys(expected).sort())
  expect(actual).toStrictEqual(expected)
}

/** PHP assertSame without ksort: same keys in the same order. */
function expectSame(actual: Data, expected: Data): void {
  expect(actual).toStrictEqual(expected)
  expect(Object.keys(actual)).toStrictEqual(Object.keys(expected))
}

/** `assertArrayHasKey` + `assertIsArray` + `assertNotEmpty`, then `unset`. */
function takeNonEmpty(actual: Data, key: string): void {
  expect(actual).toHaveProperty(key)
  const value = actual[key]
  expect(value !== null && typeof value === 'object').toBe(true)
  expect(Object.keys(value as Data).length).toBeGreaterThan(0)
  delete actual[key]
}

/** Loose comparison: the mapper sees bank values after emptyStringsToNull ('' -> null). */
const arg = (value: unknown): unknown => (typeof value === 'string' && value.trim() === '' ? null : value)

/** PHP ksort of a flat record. */
function sortKeys(value: Data): Data {
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  )
}

describe('GarantiPosResponseDataMapper', () => {
  let formatter: Mocked<ResponseValueFormatterInterface>
  let valueMapper: Mocked<ResponseValueMapperInterface>
  let logger: Mocked<PosLogger>
  let mapper: GarantiPosResponseDataMapper

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
    mapper = new GarantiPosResponseDataMapper(
      formatter as unknown as ResponseValueFormatterInterface,
      valueMapper as unknown as ResponseValueMapperInterface,
      logger as unknown as PosLogger,
    )
  })

  const integrationMapper = (log: PosLogger = noopLogger) =>
    new GarantiPosResponseDataMapper(new GarantiPosResponseValueFormatter(), new GarantiPosResponseValueMapper(), log)

  // addition: L3 the result code the gateway checks after a money request; a repeated or nested element is no code
  it.each([
    [{ Transaction: { Response: { Code: '00' } } }, '00'],
    [{ Transaction: { Response: { Code: '92' } } }, '92'],
    [{ Transaction: { Response: {} } }, null],
    [{}, null],
    [{ Transaction: { Response: { Code: ['00', '00'] } } }, null],
    [{ Transaction: { Response: { Code: { Value: '00' } } } }, null],
    [{ Transaction: [{ Response: { Code: '00' } }] }, null],
  ] as Array<[Record<string, unknown>, string | null]>)('readProcReturnCode(%j) is %j', (raw, expected) => {
    expect(mapper.readProcReturnCode(raw)).toBe(expected)
  })

  it('supports', () => {
    expect(GarantiPosResponseDataMapper.supports('GarantiPos')).toBe(true)
    expect(GarantiPosResponseDataMapper.supports('AkbankPos')).toBe(false)
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

  // addition: the remaining mdStatus values of the bank are failures
  it.each(['0', '5', '6', '8', '9', '01', ' 1'])('is3dAuthSuccess(%j) is false (addition)', (mdStatus) => {
    expect(mapper.is3dAuthSuccess(mdStatus)).toBe(false)
  })

  it.each([
    [{}, null],
    [{ mdstatus: '1' }, '1'],
  ])('extractMdStatus(%j) -> %j', (responseData, expected) => {
    expect(mapper.extractMdStatus(responseData)).toBe(expected)
  })

  it('uses the success procedure code 00', () => {
    expect(GarantiPosResponseDataMapper.PROCEDURE_SUCCESS_CODE).toBe('00')
  })

  it.each(paymentTestDataProvider)('mapPaymentResponse %s', (_name, { order, txType, responseData, expectedData }) => {
    if (expectedData.transaction_time instanceof Date) {
      formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
    }

    const actual: Data = mapper.mapPaymentResponse(responseData, txType, order as PosOrder)

    if (expectedData.transaction_time instanceof Date) {
      expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
      expect(formatter.formatDateTime).toHaveBeenCalledWith(arg(responseData.Transaction?.ProvDate) ?? 'now', txType)
    }
    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expectedData)
  })

  it.each(threeDPaymentDataProvider)(
    'map3DPaymentData %s',
    (_name, { order, txType, threeDResponseData, paymentData, expectedData }) => {
      if (expectedData.transaction_time instanceof Date) {
        formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
      }
      valueMapper.mapTxType.mockReturnValue(expectedData.transaction_type)
      valueMapper.mapSecureType.mockReturnValue(expectedData.payment_model)
      formatter.formatAmount.mockReturnValue(expectedData.amount)
      valueMapper.mapCurrency.mockReturnValue(expectedData.currency)
      formatter.formatInstallment.mockReturnValue(expectedData.installment_count)

      const actual: Data = mapper.map3DPaymentData(threeDResponseData, paymentData, txType, order as PosOrder)

      if (expectedData.transaction_time instanceof Date) {
        expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
        expect(formatter.formatDateTime).toHaveBeenCalledWith(arg(paymentData.Transaction?.ProvDate) ?? 'now', txType)
      }
      expect(valueMapper.mapTxType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapTxType).toHaveBeenCalledWith(arg(threeDResponseData.txntype))
      expect(valueMapper.mapSecureType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapSecureType).toHaveBeenCalledWith(arg(threeDResponseData.secure3dsecuritylevel), txType)
      expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
      expect(formatter.formatAmount).toHaveBeenCalledWith(arg(threeDResponseData.txnamount), txType)
      expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapCurrency).toHaveBeenCalledWith(arg(threeDResponseData.txncurrencycode), txType)
      expect(formatter.formatInstallment).toHaveBeenCalledTimes(1)
      expect(formatter.formatInstallment).toHaveBeenCalledWith(arg(threeDResponseData.txninstallmentcount), txType)

      expect(actual).toHaveProperty('all')
      if (Object.keys(paymentData).length > 0) {
        expect(Object.keys(actual.all as Data).length).toBeGreaterThan(0)
      }
      takeNonEmpty(actual, '3d_all')
      delete actual.all
      expectSameSorted(actual, expectedData)
    },
  )

  it('map3DHostResponseData is not supported', () => {
    expect(() => mapper.map3DHostResponseData({}, TX_TYPE.PAY_AUTH, {})).toThrow(NotImplementedError)
  })

  it.each(threeDPayPaymentDataProvider)(
    'map3DPayResponseData %s',
    (_name, { order, txType, paymentData, expectedData }) => {
      valueMapper.mapTxType.mockReturnValue(expectedData.transaction_type)
      valueMapper.mapSecureType.mockReturnValue(expectedData.payment_model)
      formatter.formatAmount.mockReturnValue(expectedData.amount)
      valueMapper.mapCurrency.mockReturnValue(expectedData.currency)
      formatter.formatInstallment.mockReturnValue(expectedData.installment_count)
      if (expectedData.transaction_time !== undefined && expectedData.transaction_time !== null) {
        formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
      }

      const actual: Data = mapper.map3DPayResponseData(paymentData, txType, order as PosOrder)

      expect(valueMapper.mapTxType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapTxType).toHaveBeenCalledWith(arg(paymentData.txntype))
      expect(valueMapper.mapSecureType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapSecureType).toHaveBeenCalledWith(arg(paymentData.secure3dsecuritylevel), txType)
      expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
      expect(formatter.formatAmount).toHaveBeenCalledWith(arg(paymentData.txnamount), txType)
      expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapCurrency).toHaveBeenCalledWith(arg(paymentData.txncurrencycode), txType)
      expect(formatter.formatInstallment).toHaveBeenCalledTimes(1)
      expect(formatter.formatInstallment).toHaveBeenCalledWith(arg(paymentData.txninstallmentcount), txType)
      if (expectedData.transaction_time !== undefined && expectedData.transaction_time !== null) {
        expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
        expect(formatter.formatDateTime).toHaveBeenCalledWith('now', txType)
        // the time of an approved 3D Pay response is the one the formatter returned
        expect(actual.transaction_time).toBe(expectedData.transaction_time)
      } else {
        expect(formatter.formatDateTime).not.toHaveBeenCalled()
      }

      takeNonEmpty(actual, 'all')
      expectSameSorted(actual, expectedData)
    },
  )

  it.each(statusTestDataProvider)('mapStatusResponse %s', (_name, { responseData, expectedData }) => {
    const txType = TX_TYPE.STATUS
    const inq = responseData.Order?.OrderInqResult
    formatter.formatInstallment.mockReturnValue(expectedData.installment_count)

    const amountCalls: unknown[] = []
    const dateCalls: unknown[] = []
    if (expectedData.status === 'approved') {
      valueMapper.mapOrderStatus.mockReturnValue(expectedData.order_status)
      formatter.formatAmount.mockImplementation((amount: unknown, txTypeArg: unknown) => {
        expect(txTypeArg).toBe(txType)
        amountCalls.push(amount)
        return amountCalls.length === 1 ? expectedData.capture_amount : expectedData.first_amount
      })
      formatter.formatDateTime.mockImplementation((dateTime: unknown, txTypeArg: unknown) => {
        expect(txTypeArg).toBe(txType)
        dateCalls.push(dateTime)
        return dateCalls.length === 1 ? expectedData.transaction_time : expectedData.capture_time
      })
    }

    const actual: Data = mapper.mapStatusResponse(responseData)

    expect(formatter.formatInstallment).toHaveBeenCalledTimes(1)
    expect(formatter.formatInstallment).toHaveBeenCalledWith(arg(inq.InstallmentCnt), txType)
    if (expectedData.status === 'approved') {
      expect(valueMapper.mapOrderStatus).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapOrderStatus.mock.calls[0]?.[0]).toBe(arg(inq.Status))

      expect(amountCalls.length).toBeGreaterThan(0)
      expect(amountCalls[0]).toBe(arg(inq.AuthAmount))
      if (amountCalls.length > 1) {
        const authAmount = arg(inq.AuthAmount)
        expect(amountCalls[1]).toBe(authAmount !== null && Number(authAmount) > 0 ? authAmount : arg(inq.PreAuthAmount))
      }

      expect(dateCalls.length).toBeGreaterThan(0)
      expect(dateCalls[0]).toBe(arg(inq.ProvDate) ?? arg(inq.PreAuthDate))
      if (dateCalls.length > 1) {
        expect(dateCalls[1]).toBe(arg(inq.AuthDate))
      }
    }

    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expectedData)
  })

  // Real formatter and mapper: iteration, sorting and conditionals make the calls hard to stub.
  it.each(orderHistoryTestDataProvider)('mapOrderHistoryResponse %s', (_name, { responseData, expectedData }) => {
    const actual: Data = integrationMapper().mapOrderHistoryResponse(responseData)

    const transactions = actual.transactions as Data[]
    const [first, second] = transactions
    if (
      first !== undefined &&
      second !== undefined &&
      first.transaction_time !== null &&
      second.transaction_time !== null
    ) {
      expect((second.transaction_time as Date).getTime()).toBeGreaterThan((first.transaction_time as Date).getTime())
    }

    transactions.forEach((transaction, key) => {
      const expectedTx = (expectedData.transactions as Data[])[key] as Data
      expect(transaction.transaction_time).toStrictEqual(expectedTx.transaction_time)
      expect(transaction.capture_time).toStrictEqual(expectedTx.capture_time)
      delete transaction.transaction_time
      delete expectedTx.transaction_time
      delete transaction.capture_time
      delete expectedTx.capture_time
      transactions[key] = sortKeys(transaction)
      ;(expectedData.transactions as Data[])[key] = sortKeys(expectedTx)
    })
    expect(transactions).toHaveLength(actual.trans_count)

    takeNonEmpty(actual, 'all')
    expectSame(actual, expectedData)
  })

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

  describe('additions', () => {
    const success3DPay = (threeDPayPaymentDataProvider[0] as [string, Data])[1].paymentData as Data
    const secureCallback = (threeDPaymentDataProvider.find(([name]) => name === 'success1') as [string, Data])[1]
    const order = {} as PosOrder

    // addition: the bank approved (procreturncode 00) although 3D failed (mdstatus 0) -> declined, manual review
    it('3D Pay approved by the bank with a failed 3D is declined and flagged for review', () => {
      const warn = vi.fn()
      const actual = integrationMapper({ ...noopLogger, warn }).map3DPayResponseData(
        { ...success3DPay, mdstatus: '0' },
        TX_TYPE.PAY_AUTH,
        order,
      ) as Data

      expect(actual.status).toBe('declined')
      expect(actual.requires_manual_review).toBe(true)
      expect(actual.transaction_security).toBe('MPI fallback')
      expect(actual.md_status).toBe('0')
      expect(actual.proc_return_code).toBe('00')
      expect(actual.transaction_time).toBeNull()
      expect(actual.auth_code).toBeNull()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[1]).toMatchObject({
        order_id: '20221101657A',
        md_status: '0',
        proc_return_code: '00',
      })
    })

    // addition: response 'Error' discards the provision answer even with mdstatus 1 and procreturncode 00
    it('3D Pay with response Error but procreturncode 00 is declined and flagged for review', () => {
      const warn = vi.fn()
      const actual = integrationMapper({ ...noopLogger, warn }).map3DPayResponseData(
        { ...success3DPay, response: 'Error' },
        TX_TYPE.PAY_AUTH,
        order,
      ) as Data

      expect(actual.status).toBe('declined')
      expect(actual.requires_manual_review).toBe(true)
      expect(actual.error_code).toBe('00')
      expect(warn).toHaveBeenCalledTimes(1)
    })

    // addition: an approved 3D Pay response and an ordinary decline are not flagged and log no warning
    it('3D Pay approved and 3D Pay declined without authorization are not flagged', () => {
      const warn = vi.fn()
      const real = integrationMapper({ ...noopLogger, warn })

      const approved = real.map3DPayResponseData(success3DPay, TX_TYPE.PAY_AUTH, order) as Data
      expect(approved.status).toBe('approved')
      expect(approved.requires_manual_review).toBe(false)
      expect(approved.transaction_time).toBeInstanceOf(Date)
      expect(approved.payment_model).toBe(MODEL.THREE_D_PAY)

      const declined = real.map3DPayResponseData(
        { ...success3DPay, response: 'Declined', procreturncode: '92' },
        TX_TYPE.PAY_AUTH,
        order,
      ) as Data
      expect(declined.status).toBe('declined')
      expect(declined.requires_manual_review).toBe(false)
      expect(declined.error_code).toBe('92')
      expect(warn).not.toHaveBeenCalled()
    })

    // addition: 3D Secure does not add the key (no provision follows a failed 3D)
    it('3D Secure responses carry no requires_manual_review key', () => {
      const actual = integrationMapper().map3DPaymentData(
        secureCallback.threeDResponseData as Data,
        secureCallback.paymentData as Data,
        TX_TYPE.PAY_AUTH,
        order,
      ) as Data
      expect(actual).not.toHaveProperty('requires_manual_review')
    })

    // addition: a failed 3D discards a provision answer that was supplied anyway
    it('3D Secure with a failed 3D ignores the provision response', () => {
      const actual = integrationMapper().map3DPaymentData(
        { ...(secureCallback.threeDResponseData as Data), mdstatus: '0' },
        secureCallback.paymentData as Data,
        TX_TYPE.PAY_AUTH,
        order,
      ) as Data
      expect(actual.status).toBe('declined')
      expect(actual.transaction_security).toBe('MPI fallback')
      expect(actual.auth_code).toBeNull()
      expect(actual.batch_num).toBeNull()
    })

    // addition: missing nested objects read as empty, never a TypeError
    it.each([
      ['mapStatusResponse', { Transaction: { Response: { Code: '99', ErrorMsg: 'x' } } }],
      ['mapStatusResponse', {}],
      ['mapStatusResponse', { Order: { OrderID: '1' }, Transaction: { Response: { Code: '00' } } }],
      ['mapCancelResponse', {}],
      ['mapRefundResponse', { Transaction: { Response: { Code: '99' } } }],
      ['mapOrderHistoryResponse', {}],
      ['mapOrderHistoryResponse', { Transaction: { Response: { Code: '00' } }, Order: { OrderID: '1' } }],
      [
        'mapOrderHistoryResponse',
        { Transaction: { Response: { Code: '00' } }, Order: { OrderHistInqResult: { OrderTxnList: '' } } },
      ],
      ['mapPaymentResponse', {}],
      ['mapPaymentResponse', { Transaction: { Response: { Code: '00' } } }],
    ] as const)('%s with %j does not throw', (method, raw) => {
      const real = integrationMapper()
      const call = () =>
        method === 'mapPaymentResponse'
          ? real.mapPaymentResponse(raw as Data, TX_TYPE.PAY_AUTH, order)
          : real[method](raw as Data)
      expect(call).not.toThrow()
    })

    it('mapStatusResponse without an Order maps declined with the error of the transaction', () => {
      const actual = integrationMapper().mapStatusResponse({
        Transaction: { Response: { Code: '99', ErrorMsg: 'x' } },
      }) as Data

      expect(actual.status).toBe('declined')
      expect(actual.proc_return_code).toBe('99')
      expect(actual.error_code).toBe('99')
      expect(actual.error_message).toBe('x')
      expect(actual.order_id).toBeNull()
      expect(actual.order_status).toBeNull()
      expect(actual.installment_count).toBe(0)
    })

    it('mapStatusResponse maps an approved answer with the real formatter and mapper', () => {
      const [, success] = statusTestDataProvider.find(([name]) => name === 'success_pay') as [string, Data]
      const actual = integrationMapper().mapStatusResponse(success.responseData) as Data

      expect(actual.status).toBe('approved')
      expect(actual.order_id).toBe(success.expectedData.order_id)
      expect(actual.capture_amount).toBe(success.expectedData.capture_amount)
      expect(actual.first_amount).toBe(success.expectedData.first_amount)
      expect(actual.capture).toBe(success.expectedData.capture)
      expect(actual.transaction_time).toStrictEqual(success.expectedData.transaction_time)
    })

    // addition: one OrderTxn decodes to an object, several to a list; a list of one maps the same
    it('mapOrderHistoryResponse maps a single OrderTxn object and a list of one identically', () => {
      const [, single] = orderHistoryTestDataProvider.find(([name]) => name === 'success_single_pay_tx') as [
        string,
        Data,
      ]
      const real = integrationMapper()
      const asObject = real.mapOrderHistoryResponse(single.responseData) as Data
      expect(asObject.trans_count).toBe(1)
      expect(asObject.transactions).toHaveLength(1)

      const rawTx = single.responseData.Order.OrderHistInqResult.OrderTxnList.OrderTxn
      const asList = real.mapOrderHistoryResponse({
        ...single.responseData,
        Order: {
          ...single.responseData.Order,
          OrderHistInqResult: { OrderTxnList: { OrderTxn: [rawTx] } },
        },
      }) as Data
      expect(asList.trans_count).toBe(1)
      expect(asList.transactions).toStrictEqual(asObject.transactions)
    })

    it('mapOrderHistoryResponse of an approved order without transactions has none', () => {
      const actual = integrationMapper().mapOrderHistoryResponse({
        Order: { OrderID: 'x' },
        Transaction: { Response: { Code: '00' } },
      }) as Data
      expect(actual.status).toBe('approved')
      expect(actual.trans_count).toBe(0)
      expect(actual.transactions).toStrictEqual([])
    })

    it('mapOrderHistoryResponse reads the order history dates as Türkiye time', () => {
      const [, single] = orderHistoryTestDataProvider.find(([name]) => name === 'success_single_pay_tx') as [
        string,
        Data,
      ]
      const actual = integrationMapper().mapOrderHistoryResponse(single.responseData) as Data
      expect((actual.transactions as Data[])[0]?.transaction_time).toStrictEqual(tr('2024-01-07 00:00:00'))
    })

    // addition: nothing sensitive reaches the logger unmasked
    it('logger contexts never carry an unmasked card number', () => {
      const pan = '5555444433332222'
      const calls: unknown[] = []
      const recorder: PosLogger = {
        debug: (_m, ctx) => calls.push(ctx),
        info: (_m, ctx) => calls.push(ctx),
        warn: (_m, ctx) => calls.push(ctx),
        error: (_m, ctx) => calls.push(ctx),
      }
      const real = integrationMapper(recorder)
      const withCard = (data: Data): Data => ({
        ...data,
        Card: { Number: pan, ExpireDate: '1230', CVV2Val: '123' },
        number: pan,
        cardnumber: pan,
      })

      real.mapPaymentResponse(
        withCard((paymentTestDataProvider[0] as [string, Data])[1].responseData),
        TX_TYPE.PAY_AUTH,
        { currency: 'TRY', amount: 1.01 } as PosOrder,
      )
      real.map3DPaymentData(
        withCard(secureCallback.threeDResponseData as Data),
        withCard(secureCallback.paymentData as Data),
        TX_TYPE.PAY_AUTH,
        order,
      )
      real.map3DPayResponseData(withCard({ ...success3DPay, mdstatus: '0' }), TX_TYPE.PAY_AUTH, order)

      expect(calls.length).toBeGreaterThan(0)
      expect(JSON.stringify(calls)).not.toContain(pan)
      expect(JSON.stringify(calls)).not.toContain('"CVV2Val":"123"')
    })
  })
})
