import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PosNetV1PosResponseDataMapper } from '../../../../../src/data-mapper/response/mapper/PosNetV1PosResponseDataMapper.js'
import { PosNetPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/PosNetPosResponseValueFormatter.js'
import type { ResponseValueFormatterInterface } from '../../../../../src/data-mapper/response/value-formatter/ResponseValueFormatterInterface.js'
import { PosNetV1PosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/PosNetV1PosResponseValueMapper.js'
import type { ResponseValueMapperInterface } from '../../../../../src/data-mapper/response/value-mapper/ResponseValueMapperInterface.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import type { PosLogger } from '../../../../../src/logger.js'
import { TX_TYPE } from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'
import {
  APPROVED_PROVISION,
  cancelTestDataProvider,
  paymentTestDataProvider,
  refundTestDataProvider,
  SUCCESS_3D_CALLBACK,
  statusTestDataProvider,
  threeDPaymentDataProvider,
} from './PosNetV1PosResponseDataMapper.data.js'

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

describe('PosNetV1PosResponseDataMapper', () => {
  let formatter: Mocked<ResponseValueFormatterInterface>
  let valueMapper: Mocked<ResponseValueMapperInterface>
  let logger: Mocked<PosLogger>
  let mapper: PosNetV1PosResponseDataMapper

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
    mapper = new PosNetV1PosResponseDataMapper(
      formatter as unknown as ResponseValueFormatterInterface,
      valueMapper as unknown as ResponseValueMapperInterface,
      logger as unknown as PosLogger,
    )
  })

  const realMapper = (log?: PosLogger) =>
    new PosNetV1PosResponseDataMapper(new PosNetPosResponseValueFormatter(), new PosNetV1PosResponseValueMapper(), log)

  it('supports', () => {
    expect(PosNetV1PosResponseDataMapper.supports('PosNetV1Pos')).toBe(true)
    expect(PosNetV1PosResponseDataMapper.supports('AkbankPos')).toBe(false)
  })

  it('uses the success procedure code 00', () => {
    expect(PosNetV1PosResponseDataMapper.PROCEDURE_SUCCESS_CODE).toBe('00')
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
    [{ MdStatus: '1' }, '1'],
  ])('extractMdStatus(%j) -> %j', (responseData, expected) => {
    expect(mapper.extractMdStatus(responseData)).toBe(expected)
  })

  // addition: non-string or inherited values are never a md status
  it.each([
    [{ MdStatus: 1 }],
    [{ MdStatus: ['1'] }],
    [{ MdStatus: { a: '1' } }],
    [{ MdStatus: null }],
    [Object.create({ MdStatus: '1' })],
  ])('extractMdStatus(%j) -> null (addition)', (responseData) => {
    expect(mapper.extractMdStatus(responseData)).toBeNull()
  })

  it.each(paymentTestDataProvider)('mapPaymentResponse %s', (_name, { order, txType, responseData, expectedData }) => {
    formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
    formatter.formatInstallment.mockReturnValue(expectedData.installment_count)

    const actual: Data = mapper.mapPaymentResponse(responseData, txType, order as PosOrder)

    if (expectedData.transaction_time !== null) {
      expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
      expect(formatter.formatDateTime).toHaveBeenCalledWith('now', txType)
    } else {
      expect(formatter.formatDateTime).not.toHaveBeenCalled()
    }
    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expectedData)
  })

  it('mapPaymentResponse with empty data is the declined default', () => {
    const order = { id: 'order-1', currency: 'TRY', amount: 1.01 } as PosOrder
    const actual = mapper.mapPaymentResponse({}, TX_TYPE.PAY_AUTH, order)

    expect(actual.status).toBe('declined')
    expect(actual.order_id).toBeNull()
    expect(actual.proc_return_code).toBeNull()
  })

  it.each(threeDPaymentDataProvider)(
    'map3DPaymentData %s',
    (_name, { order, txType, threeDResponseData, paymentData, expectedData }) => {
      valueMapper.mapTxType.mockReturnValue(expectedData.transaction_type)
      formatter.formatAmount.mockReturnValue(expectedData.amount)
      valueMapper.mapCurrency.mockReturnValue(expectedData.currency)
      formatter.formatInstallment.mockReturnValue(expectedData.installment_count)
      formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)

      const actual: Data = mapper.map3DPaymentData(threeDResponseData, paymentData, txType, order as PosOrder)

      expect(valueMapper.mapTxType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapTxType).toHaveBeenCalledWith(threeDResponseData.TranType)
      expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
      expect(formatter.formatAmount).toHaveBeenCalledWith(threeDResponseData.Amount, txType)
      if (threeDResponseData.CurrencyCode !== undefined) {
        expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
        expect(valueMapper.mapCurrency).toHaveBeenCalledWith(threeDResponseData.CurrencyCode, txType)
      } else {
        expect(valueMapper.mapCurrency).not.toHaveBeenCalled()
      }
      if (expectedData.status === 'approved') {
        expect(formatter.formatInstallment).toHaveBeenCalledTimes(1)
        // deviation: P19 bank scalars reach the formatter as text, the number 0 becomes "0"
        expect(formatter.formatInstallment).toHaveBeenCalledWith(
          String(paymentData.InstallmentData.InstallmentCount),
          txType,
        )
      }
      if (expectedData.transaction_time !== null) {
        expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
        expect(formatter.formatDateTime).toHaveBeenCalledWith('now', txType)
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

  it.each(statusTestDataProvider)('mapStatusResponse %s', (_name, { responseData, expectedData }) => {
    const rawTx = (responseData.TransactionData as Data[] | null)?.find((item) => item.TransactionStatus === '1')
    if (rawTx !== undefined) {
      formatter.formatAmount.mockReturnValue(expectedData.first_amount)
      valueMapper.mapCurrency.mockReturnValue(expectedData.currency)
      formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
      valueMapper.mapTxType.mockReturnValue(expectedData.transaction_type)
      valueMapper.mapOrderStatus.mockReturnValue(expectedData.order_status)
    }

    const actual: Data = mapper.mapStatusResponse(responseData)

    if (rawTx !== undefined) {
      expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
      expect(formatter.formatAmount).toHaveBeenCalledWith(rawTx.Amount, TX_TYPE.STATUS)
      expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapCurrency).toHaveBeenCalledWith(rawTx.CurrencyCode, TX_TYPE.STATUS)
      expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
      expect(formatter.formatDateTime).toHaveBeenCalledWith(rawTx.TransactionDate, TX_TYPE.STATUS)
      expect(valueMapper.mapTxType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapTxType).toHaveBeenCalledWith(rawTx.TransactionType)
      expect(valueMapper.mapOrderStatus).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapOrderStatus).toHaveBeenCalledWith(expectedData.transaction_type)
    } else {
      expect(formatter.formatAmount).not.toHaveBeenCalled()
    }
    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expectedData)
  })

  it.each(cancelTestDataProvider)('mapCancelResponse %s', (_name, { responseData, expectedData }) => {
    const actual: Data = mapper.mapCancelResponse(responseData)

    takeNonEmpty(actual, 'all')
    expect(actual).toStrictEqual(expectedData)
    expect(Object.keys(actual)).toStrictEqual(Object.keys(expectedData))
  })

  it.each(refundTestDataProvider)('mapRefundResponse %s', (_name, { responseData, expectedData }) => {
    const actual: Data = mapper.mapRefundResponse(responseData)

    takeNonEmpty(actual, 'all')
    expect(actual).toStrictEqual(expectedData)
    expect(Object.keys(actual)).toStrictEqual(Object.keys(expectedData))
  })

  // deviation: P28 NotImplementedError is the PosError subclass for unsupported operations
  it('mapOrderHistoryResponse is not supported', () => {
    expect(() => mapper.mapOrderHistoryResponse({})).toThrow(NotImplementedError)
  })

  it('map3DPayResponseData is not supported', () => {
    expect(() => mapper.map3DPayResponseData({}, TX_TYPE.PAY_AUTH, {})).toThrow(NotImplementedError)
  })

  it('map3DHostResponseData is not supported', () => {
    expect(() => mapper.map3DHostResponseData({}, TX_TYPE.PAY_AUTH, {})).toThrow(NotImplementedError)
  })

  describe('additions with the real formatter and value mapper', () => {
    const order = { id: '80603153823' } as PosOrder

    // addition: the full 3D success path with real conversions
    it('maps a successful 3D payment', () => {
      const before = Date.now()
      const actual: Data = realMapper().map3DPaymentData(SUCCESS_3D_CALLBACK, APPROVED_PROVISION, 'pay', order)

      expect(actual.status).toBe('approved')
      expect(actual.amount).toBe(1.75)
      expect(actual.currency).toBe('TRY')
      expect(actual.masked_number).toBe('540061')
      expect(actual.md_status).toBe('1')
      expect(actual.transaction_security).toBe('Full 3D Secure')
      expect(actual.installment_count).toBe(0)
      expect(actual).not.toHaveProperty('requires_manual_review')
      expect(Math.abs((actual.transaction_time as Date).getTime() - before)).toBeLessThan(5000)
    })

    // addition: a bank answer without a description still maps to a declined result
    it('mapPaymentResponse without a description is declined without throwing', () => {
      const actual: Data = realMapper().mapPaymentResponse({ ServiceResponseData: { ResponseCode: '0148' } }, 'pay', {
        id: '1',
        currency: 'TRY',
        amount: 1,
      } as PosOrder)

      expect(actual.status).toBe('declined')
      expect(actual.error_code).toBe('0148')
      expect(actual.error_message).toBeNull()
    })

    // addition: an answer without the service block is declined
    it('mapPaymentResponse without ServiceResponseData is declined', () => {
      const actual: Data = realMapper().mapPaymentResponse({ AuthCode: '1' }, 'pay', { id: '1' } as PosOrder)

      expect(actual.status).toBe('declined')
      expect(actual.proc_return_code).toBeNull()
    })

    // addition: cancel without any content never throws and is never approved
    it('mapCancelResponse({}) is declined', () => {
      const actual: Data = realMapper().mapCancelResponse({})

      expect(actual.status).toBe('declined')
      expect(actual.proc_return_code).toBeNull()
      expect(actual.error_message).toBeNull()
    })

    // addition: an approved provision without instalment data has installment_count 0
    it('approved payment without InstallmentData has installment_count 0', () => {
      const { InstallmentData: _omitted, ...withoutInstallments } = APPROVED_PROVISION
      const actual: Data = realMapper().mapPaymentResponse(withoutInstallments, 'pay', {
        id: '1',
        currency: 'TRY',
        amount: 1,
      } as PosOrder)

      expect(actual.status).toBe('approved')
      expect(actual.installment_count).toBe(0)
    })

    // addition: a callback without an amount maps to a null amount
    it('3D data without Amount has amount null', () => {
      const { Amount: _omitted, ...withoutAmount } = SUCCESS_3D_CALLBACK
      const actual: Data = realMapper().map3DPaymentData(withoutAmount, APPROVED_PROVISION, 'pay', order)

      expect(actual.amount).toBeNull()
    })

    // addition: the status answer with the real conversions (Türkiye time, "1,75" amount)
    it('mapStatusResponse maps the refunded transaction', () => {
      const first: Data = realMapper().mapStatusResponse(statusTestDataProvider[0]?.[1].responseData as Data)

      expect(first.status).toBe('approved')
      expect(first.first_amount).toBe(1.75)
      expect(first.currency).toBe('TRY')
      expect(first.transaction_type).toBe('refund')
      expect(first.order_status).toBe('FULLY_REFUNDED')
      expect((first.transaction_time as Date).toISOString()).toBe('2019-11-08T10:58:37.909Z')
      expect((first.refund_time as Date).toISOString()).toBe('2019-11-08T10:58:37.909Z')
      expect(first.cancel_time).toBeNull()
    })

    // addition: TransactionData that is not a list is never an approved status
    // deviation: strict status approval, the answer must carry a transaction list
    it.each(['oops', { a: 1 }, 5, null])('mapStatusResponse with TransactionData %j is declined', (data) => {
      const actual: Data = realMapper().mapStatusResponse({
        ServiceResponseData: { ResponseCode: '0000', ResponseDescription: 'Başarılı' },
        TransactionData: data,
      })

      expect(actual.status).toBe('declined')
      expect(actual.order_id).toBeNull()
      expect(actual.first_amount).toBeNull()
    })

    // addition: non-record items of the transaction list are skipped
    it('mapStatusResponse skips non-record transaction items', () => {
      const actual: Data = realMapper().mapStatusResponse({
        ServiceResponseData: { ResponseCode: '0000' },
        TransactionData: ['x', null, 7, { TransactionStatus: '1', OrderId: 'A', Amount: '2,50' }],
      })

      expect(actual.status).toBe('approved')
      expect(actual.order_id).toBe('A')
      expect(actual.first_amount).toBe(2.5)
    })

    // addition: non-scalar bank values never turn into "[object Object]"
    // deviation: scalar-only text, objects and lists read as missing instead of being stringified
    it('non-scalar bank values read as missing', () => {
      const actual: Data = realMapper().mapPaymentResponse(
        {
          ServiceResponseData: { ResponseCode: '0148', ResponseDescription: { a: 1 } },
          AuthCode: ['x'],
          ReferenceCode: { b: 2 },
        },
        'pay',
        { id: '1', currency: 'TRY', amount: 1 } as PosOrder,
      )

      expect(actual.error_message).toBeNull()
      expect(actual.auth_code).toBeNull()
      expect(actual.ref_ret_num).toBeNull()
      expect(JSON.stringify(actual)).not.toContain('[object')

      const callback: Data = realMapper().map3DPaymentData(
        { ...SUCCESS_3D_CALLBACK, CCPrefix: { a: 1 }, OrderId: ['x'], MdErrorMessage: { b: 1 }, MdStatus: '0' },
        null,
        'pay',
        order,
      )
      expect(callback.masked_number).toBeNull()
      expect(callback.remote_order_id).toBeNull()
      expect(callback.md_error_message).toBeNull()
      expect(JSON.stringify(callback)).not.toContain('[object')
    })

    // addition: ServiceResponseData of the wrong type reads as missing
    it.each(['x', ['00'], 7, null])('ServiceResponseData %j reads as missing', (service) => {
      const actual: Data = realMapper().mapPaymentResponse({ ServiceResponseData: service }, 'pay', {
        id: '1',
      } as PosOrder)

      expect(actual.status).toBe('declined')
      expect(actual.proc_return_code).toBeNull()
    })

    // addition: the strict-approval guard, a failed 3D leg turns an APPROVED provision into declined + review
    it.each(['0', '2', '3', '4', '5', '7', '9'])(
      'mdStatus %s with an approved provision is declined and flagged for review',
      (mdStatus) => {
        const actual: Data = realMapper().map3DPaymentData(
          { ...SUCCESS_3D_CALLBACK, MdStatus: mdStatus },
          APPROVED_PROVISION,
          'pay',
          order,
        )

        expect(actual.status).toBe('declined')
        expect(actual.requires_manual_review).toBe(true)
      },
    )

    // addition: the same for a callback without a usable md status
    it.each([{ MdStatus: null }, { MdStatus: 1 }, { MdStatus: ['1'] }, { MdStatus: '' }])(
      'callback with %j and an approved provision is declined and flagged for review',
      (override) => {
        const actual: Data = realMapper().map3DPaymentData(
          { ...SUCCESS_3D_CALLBACK, ...override },
          APPROVED_PROVISION,
          'pay',
          order,
        )

        expect(actual.status).toBe('declined')
        expect(actual.requires_manual_review).toBe(true)
        expect(actual.md_status).toBeNull()
      },
    )

    it('callback without MdStatus at all and an approved provision is declined and flagged', () => {
      const { MdStatus: _omitted, ...withoutMd } = SUCCESS_3D_CALLBACK
      const actual: Data = realMapper().map3DPaymentData(withoutMd, APPROVED_PROVISION, 'pay', order)

      expect(actual.status).toBe('declined')
      expect(actual.requires_manual_review).toBe(true)
    })

    // addition: a failed 3D leg with a declined provision is declined without a review flag
    it('mdStatus 0 with a declined provision is declined and not flagged', () => {
      const actual: Data = realMapper().map3DPaymentData(
        { ...SUCCESS_3D_CALLBACK, MdStatus: '0' },
        { ServiceResponseData: { ResponseCode: '0148', ResponseDescription: 'x' } },
        'pay',
        order,
      )

      expect(actual.status).toBe('declined')
      expect(actual).not.toHaveProperty('requires_manual_review')
    })

    // addition: a successful 3D leg with an approved provision is not flagged, a declined provision stays declined
    it('mdStatus 1 with a declined provision is declined and not flagged', () => {
      const actual: Data = realMapper().map3DPaymentData(
        SUCCESS_3D_CALLBACK,
        { ServiceResponseData: { ResponseCode: '0148', ResponseDescription: 'x' } },
        'pay',
        order,
      )

      expect(actual.status).toBe('declined')
      expect(actual.error_code).toBe('0148')
      expect(actual).not.toHaveProperty('requires_manual_review')
    })

    // addition: approval needs an actual provision answer
    it('mdStatus 1 without a provision answer is declined', () => {
      const actual: Data = realMapper().map3DPaymentData(SUCCESS_3D_CALLBACK, null, 'pay', order)

      expect(actual.status).toBe('declined')
      expect(actual).not.toHaveProperty('requires_manual_review')
    })

    // addition: the callback transaction type can only select a pay or pre-auth flow
    it('a callback TranType of another kind keeps the requested transaction type', () => {
      const actual: Data = realMapper().map3DPaymentData(
        { ...SUCCESS_3D_CALLBACK, TranType: 'TransactionInquiry' },
        APPROVED_PROVISION,
        'pay',
        order,
      )

      expect(actual.transaction_type).toBe('pay')
      // The amount keeps the whole-unit parsing of a payment, "175" is 1.75 and not 175 or 17500.
      expect(actual.amount).toBe(1.75)
    })

    it('a callback TranType of Auth selects the pre-authorisation type', () => {
      const actual: Data = realMapper().map3DPaymentData(
        { ...SUCCESS_3D_CALLBACK, TranType: 'Auth' },
        APPROVED_PROVISION,
        'pay',
        order,
      )

      expect(actual.transaction_type).toBe('pre')
    })

    // addition: logger contexts never carry a clear PAN
    it('logger contexts never contain an unmasked 16-digit card number', () => {
      const contexts: unknown[] = []
      const recording: PosLogger = {
        debug: (_m, c) => contexts.push(c),
        info: (_m, c) => contexts.push(c),
        warn: (_m, c) => contexts.push(c),
        error: (_m, c) => contexts.push(c),
      }
      const m = realMapper(recording)
      m.mapStatusResponse({
        ServiceResponseData: { ResponseCode: '0000' },
        TransactionData: [{ TransactionStatus: '1', CardNo: '4506341234564637', Note: '5555444433332222' }],
      })
      m.mapPaymentResponse({ ServiceResponseData: { ResponseCode: '00' }, CardNo: '4506341234564637' }, 'pay', {
        id: '1',
      } as PosOrder)
      m.map3DPaymentData(
        { ...SUCCESS_3D_CALLBACK, Note: '5555444433332222' },
        { CardNo: '4506341234564637' },
        'pay',
        order,
      )

      expect(JSON.stringify(contexts)).not.toMatch(/\d{16}/)
    })
  })
})
