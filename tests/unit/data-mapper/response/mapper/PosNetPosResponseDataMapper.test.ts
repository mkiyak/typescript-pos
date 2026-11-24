import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PosNetPosResponseDataMapper } from '../../../../../src/data-mapper/response/mapper/PosNetPosResponseDataMapper.js'
import { PosNetPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/PosNetPosResponseValueFormatter.js'
import type { ResponseValueFormatterInterface } from '../../../../../src/data-mapper/response/value-formatter/ResponseValueFormatterInterface.js'
import { PosNetPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/PosNetPosResponseValueMapper.js'
import type { ResponseValueMapperInterface } from '../../../../../src/data-mapper/response/value-mapper/ResponseValueMapperInterface.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import type { PosLogger } from '../../../../../src/logger.js'
import { TX_TYPE } from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'
import {
  paymentTestDataProvider,
  refundTestDataProvider,
  statusTestDataProvider,
  threeDPaymentDataProvider,
} from './PosNetPosResponseDataMapper.data.js'

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

describe('PosNetPosResponseDataMapper', () => {
  let formatter: Mocked<ResponseValueFormatterInterface>
  let valueMapper: Mocked<ResponseValueMapperInterface>
  let logger: Mocked<PosLogger>
  let mapper: PosNetPosResponseDataMapper

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
    mapper = new PosNetPosResponseDataMapper(
      formatter as unknown as ResponseValueFormatterInterface,
      valueMapper as unknown as ResponseValueMapperInterface,
      logger as unknown as PosLogger,
    )
  })

  const realMapper = (log?: PosLogger) =>
    new PosNetPosResponseDataMapper(new PosNetPosResponseValueFormatter(), new PosNetPosResponseValueMapper(), log)

  it('supports', () => {
    expect(PosNetPosResponseDataMapper.supports('PosNetPos')).toBe(true)
    expect(PosNetPosResponseDataMapper.supports('AkbankPos')).toBe(false)
  })

  it('uses the success procedure code 1', () => {
    expect(PosNetPosResponseDataMapper.PROCEDURE_SUCCESS_CODE).toBe('1')
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
    [{ oosResolveMerchantDataResponse: { mdStatus: '1' } }, '1'],
  ])('extractMdStatus(%j) -> %j', (responseData, expected) => {
    expect(mapper.extractMdStatus(responseData)).toBe(expected)
  })

  // addition: non-string or inherited values are never a md status
  it.each([
    [{ oosResolveMerchantDataResponse: { mdStatus: { a: 1 } } }],
    [{ oosResolveMerchantDataResponse: { mdStatus: ['1'] } }],
    [{ oosResolveMerchantDataResponse: { mdStatus: 1 } }],
    [{ oosResolveMerchantDataResponse: 'x' }],
    [{ oosResolveMerchantDataResponse: null }],
    [{ oosResolveMerchantDataResponse: Object.create({ mdStatus: '1' }) }],
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

  it.each(threeDPaymentDataProvider)(
    'map3DPaymentData %s',
    (_name, { order, txType, threeDResponseData, paymentData, expectedData }) => {
      formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
      formatter.formatInstallment.mockReturnValue(expectedData.installment_count)
      formatter.formatAmount.mockReturnValue(expectedData.amount)
      valueMapper.mapCurrency.mockReturnValue(expectedData.currency)

      const actual: Data = mapper.map3DPaymentData(threeDResponseData, paymentData, txType, order as PosOrder)

      const resolved = threeDResponseData.oosResolveMerchantDataResponse
      if (resolved !== undefined) {
        expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
        expect(formatter.formatAmount).toHaveBeenCalledWith(resolved.amount, txType)
        expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
        expect(valueMapper.mapCurrency).toHaveBeenCalledWith(resolved.currency, txType)
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
    const transaction = responseData.transactions?.transaction
    if (transaction !== undefined) {
      formatter.formatAmount.mockReturnValue(expectedData.first_amount)
      valueMapper.mapCurrency.mockReturnValue(expectedData.currency)
      formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
      valueMapper.mapTxType.mockReturnValue(expectedData.transaction_type)
    }

    const actual: Data = mapper.mapStatusResponse(responseData)

    if (transaction !== undefined) {
      expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
      expect(formatter.formatAmount).toHaveBeenCalledWith('1,16', TX_TYPE.STATUS)
      expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapCurrency).toHaveBeenCalledWith('TL', TX_TYPE.STATUS)
      expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
      expect(formatter.formatDateTime).toHaveBeenCalledWith(transaction.tranDate, TX_TYPE.STATUS)
      expect(valueMapper.mapTxType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapTxType).toHaveBeenCalledWith('Sale')
    }
    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expectedData)
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
    const success3D = threeDPaymentDataProvider[0]?.[1]
    const resolveOk = {
      approved: '1',
      oosResolveMerchantDataResponse: {
        xid: 'YKB_0000080603153823',
        amount: '5696',
        currency: 'TL',
        mdStatus: '1',
        mdErrorMessage: '',
      },
    }

    // addition: the full 3D success path with real conversions
    it('maps a successful 3D payment', () => {
      const before = Date.now()
      const actual: Data = realMapper().map3DPaymentData(
        success3D?.threeDResponseData as Data,
        success3D?.paymentData as Data,
        'pay',
        { id: '80603153823' },
      )

      expect(actual.amount).toBe(56.96)
      expect(actual.currency).toBe('TRY')
      expect(actual.md_status).toBe('1')
      expect(actual.transaction_security).toBe('Full 3D Secure')
      expect(actual.installment_count).toBe(0)
      expect(actual.status).toBe('approved')
      expect(Math.abs((actual.transaction_time as Date).getTime() - before)).toBeLessThan(5000)
    })

    // addition: mdStatus 2 to 4 is half 3D
    it.each(['2', '3', '4'])('mdStatus %s is Half 3D Secure', (mdStatus) => {
      const raw = {
        approved: '1',
        oosResolveMerchantDataResponse: { ...resolveOk.oosResolveMerchantDataResponse, mdStatus },
      }
      const actual: Data = realMapper().map3DPaymentData(raw, null, 'pay', { id: '1' })

      expect(actual.transaction_security).toBe('Half 3D Secure')
    })

    // addition: an approved provision without instalment info does not throw
    it('approved provision without instInfo has installment_count 0', () => {
      const actual: Data = realMapper().mapPaymentResponse(
        { approved: '1', respCode: '', authCode: '1', hostlogkey: '2' },
        'pay',
        { id: '1', currency: 'TRY', amount: 1 },
      )

      expect(actual.status).toBe('approved')
      expect(actual.installment_count).toBe(0)
    })

    // addition: several transaction elements decode to a list; the first one is used
    it('mapStatusResponse takes the first of several transactions', () => {
      const actual: Data = realMapper().mapStatusResponse({
        approved: '1',
        transactions: {
          transaction: [
            {
              orderID: 'FIRST',
              amount: '1,16',
              currencyCode: 'TL',
              state: 'Sale',
              tranDate: '2019-10-10 11:21:14.281',
            },
            {
              orderID: 'SECOND',
              amount: '9,99',
              currencyCode: 'US',
              state: 'return',
              tranDate: '2019-10-11 11:21:14.281',
            },
          ],
        },
      })

      expect(actual.status).toBe('approved')
      expect(actual.order_id).toBe('FIRST')
      expect(actual.first_amount).toBe(1.16)
      expect(actual.currency).toBe('TRY')
      expect(actual.transaction_type).toBe('pay')
      expect((actual.transaction_time as Date).toISOString()).toBe('2019-10-10T08:21:14.281Z')
    })

    // addition: an approved flag without any transaction record is not an approved status
    it('mapStatusResponse without transactions is declined', () => {
      const actual: Data = realMapper().mapStatusResponse({ approved: '1' })

      expect(actual.status).toBe('declined')
      expect(actual.order_id).toBeNull()
      expect(actual.proc_return_code).toBe('1')
    })

    // addition: cancel answers carry the transaction block
    it('mapCancelResponse reads the transaction block', () => {
      const actual: Data = realMapper().mapCancelResponse({
        approved: '1',
        respCode: '',
        transaction: { authCode: '1', hostlogkey: '2', tranDate: '3' },
      })

      expect(actual.status).toBe('approved')
      expect(actual.auth_code).toBe('1')
      expect(actual.ref_ret_num).toBe('2')
      expect(actual.date).toBe('3')
    })

    // addition: a malformed resolve answer is a declined result, never a crash
    it('map3DPaymentData with an empty resolve answer is declined', () => {
      const actual: Data = realMapper().map3DPaymentData({ oosResolveMerchantDataResponse: '' }, null, 'pay', {
        id: '1',
      })

      expect(actual.status).toBe('declined')
      expect(actual.payment_model).toBe('3d')
    })

    // addition: non-scalar bank values never turn into "[object Object]"
    it('non-scalar bank values read as missing', () => {
      const actual: Data = realMapper().mapPaymentResponse(
        { approved: '1', respCode: '', respText: { a: 1 }, authCode: ['x'], hostlogkey: { b: 2 } },
        'pay',
        { id: '1', currency: 'TRY', amount: 1 },
      )

      expect(actual.error_message).toBeNull()
      expect(actual.auth_code).toBeNull()
      expect(actual.ref_ret_num).toBeNull()
      expect(JSON.stringify(actual)).not.toContain('[object')
    })

    // addition: a 3D leg that did not succeed makes the result declined even when the provision was approved
    it('3D failure with an approved provision is declined and flagged for review', () => {
      const raw = {
        approved: '1',
        oosResolveMerchantDataResponse: { ...resolveOk.oosResolveMerchantDataResponse, mdStatus: '9' },
      }
      const actual: Data = realMapper().map3DPaymentData(raw, { approved: '1', respCode: '' }, 'pay', { id: '1' })

      expect(actual.status).toBe('declined')
      expect(actual.requires_manual_review).toBe(true)
    })

    // addition: the 3D leg must be approved by the bank as well
    it('resolve answer with approved 0 is declined', () => {
      const raw = {
        approved: '0',
        respCode: 'E1',
        oosResolveMerchantDataResponse: resolveOk.oosResolveMerchantDataResponse,
      }
      const actual: Data = realMapper().map3DPaymentData(raw, null, 'pay', { id: '1' })

      expect(actual.status).toBe('declined')
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
        approved: '1',
        transactions: {
          transaction: {
            orderID: 'A',
            ccno: '4506341234564637',
            amount: '1,16',
            currencyCode: 'TL',
            state: 'Sale',
            note: '5555444433332222',
          },
        },
      })
      m.mapPaymentResponse({ approved: '1', ccno: '4506341234564637' }, 'pay', { id: '1' })
      m.map3DPaymentData({ approved: '1', text: '5555444433332222' }, { ccno: '4506341234564637' }, 'pay', { id: '1' })

      expect(JSON.stringify(contexts)).not.toMatch(/\d{16}/)
    })
  })
})
