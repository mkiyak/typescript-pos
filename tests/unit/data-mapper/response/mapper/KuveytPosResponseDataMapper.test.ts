import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KuveytPosResponseDataMapper } from '../../../../../src/data-mapper/response/mapper/KuveytPosResponseDataMapper.js'
import { BoaPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/BoaPosResponseValueFormatter.js'
import type { ResponseValueFormatterInterface } from '../../../../../src/data-mapper/response/value-formatter/ResponseValueFormatterInterface.js'
import { KuveytPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/KuveytPosResponseValueMapper.js'
import type { ResponseValueMapperInterface } from '../../../../../src/data-mapper/response/value-mapper/ResponseValueMapperInterface.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import type { PosLogger } from '../../../../../src/logger.js'
import { TX_TYPE } from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'
import {
  cancelTestDataProvider,
  paymentTestDataProvider,
  refundTestDataProvider,
  statusTestDataProvider,
  threeDPaymentDataProvider,
} from './KuveytPosResponseDataMapper.data.js'

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

describe('KuveytPosResponseDataMapper', () => {
  let formatter: Mocked<ResponseValueFormatterInterface>
  let valueMapper: Mocked<ResponseValueMapperInterface>
  let logger: Mocked<PosLogger>
  let mapper: KuveytPosResponseDataMapper

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
    mapper = new KuveytPosResponseDataMapper(
      formatter as unknown as ResponseValueFormatterInterface,
      valueMapper as unknown as ResponseValueMapperInterface,
      logger as unknown as PosLogger,
    )
  })

  const realMapper = (log?: PosLogger) =>
    new KuveytPosResponseDataMapper(new BoaPosResponseValueFormatter(), new KuveytPosResponseValueMapper(), log)

  // addition: L3 the gateway checks the response code of a payment answer or, in a refund answer, of the drawback
  // result's Value
  it.each([
    [{ ResponseCode: '00' }, '00'],
    [{ PartialDrawbackResponse: { PartialDrawbackResult: { Value: { ResponseCode: '28' } } } }, '28'],
    [{ DrawBackResponse: { DrawBackResult: { Value: { ResponseCode: '00' } } } }, '00'],
    [{ DrawBackResponse: { DrawBackResult: { Value: { OrderId: 0 } } } }, null],
    [{ DrawBackResponse: { DrawBackResult: { Value: { ResponseCode: { '@xsi:nil': 'true' } } } } }, null],
    [{ DrawBackResponse: { DrawBackResult: [{ Value: { ResponseCode: '00' } }] } }, null],
    [{ SaleReversalResponse: { SaleReversalResult: { Value: { ResponseCode: '00' } } } }, null],
    [{}, null],
  ] as Array<[Record<string, unknown>, string | null]>)('readProcReturnCode(%j) is %j', (raw, expected) => {
    expect(mapper.readProcReturnCode(raw)).toBe(expected)
  })

  it('supports', () => {
    expect(KuveytPosResponseDataMapper.supports('KuveytPos')).toBe(true)
    expect(KuveytPosResponseDataMapper.supports('AkbankPos')).toBe(false)
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
    const vPosMessage = responseData.VPosMessage
    if (vPosMessage !== undefined) {
      formatter.formatAmount.mockReturnValue(expectedData.amount)
      formatter.formatInstallment.mockReturnValue(expectedData.installment_count)
      valueMapper.mapCurrency.mockReturnValue(expectedData.currency)
      if (expectedData.transaction_time) formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
    }

    const actual: Data = mapper.mapPaymentResponse(responseData, txType, {} as PosOrder)

    if (vPosMessage !== undefined) {
      expect(formatter.formatAmount.mock.calls).toStrictEqual([[vPosMessage.Amount, txType]])
      expect(formatter.formatInstallment.mock.calls).toStrictEqual([[vPosMessage.InstallmentCount, txType]])
      expect(valueMapper.mapCurrency.mock.calls).toStrictEqual([[vPosMessage.CurrencyCode, txType]])
      expect(formatter.formatDateTime.mock.calls).toStrictEqual(expectedData.transaction_time ? [['now', txType]] : [])
    }
    if (Object.keys(responseData).length > 0) takeNonEmpty(actual, 'all')
    else delete actual.all
    expectSameSorted(actual, expectedData)
  })

  it.each(refundTestDataProvider)('mapRefundResponse %s', (_name, { responseData, expectedData }) => {
    const drawbackResult =
      responseData.PartialDrawbackResponse?.PartialDrawbackResult ?? responseData.DrawBackResponse?.DrawBackResult
    valueMapper.mapCurrency.mockReturnValue(expectedData.currency)

    const actual: Data = mapper.mapRefundResponse(responseData)

    if (expectedData.status === 'approved') {
      expect(valueMapper.mapCurrency.mock.calls).toStrictEqual([[drawbackResult.Value.CurrencyCode, TX_TYPE.REFUND]])
    } else {
      expect(valueMapper.mapCurrency).not.toHaveBeenCalled()
    }
    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expectedData)
  })

  it.each(cancelTestDataProvider)('mapCancelResponse %s', (_name, { responseData, expectedData }) => {
    valueMapper.mapCurrency.mockReturnValue(expectedData.currency)

    const actual: Data = mapper.mapCancelResponse(responseData)

    if (expectedData.status === 'approved') {
      expect(valueMapper.mapCurrency.mock.calls).toStrictEqual([
        [responseData.SaleReversalResponse.SaleReversalResult.Value.CurrencyCode, TX_TYPE.CANCEL],
      ])
    }
    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expectedData)
  })

  it.each(statusTestDataProvider)('mapStatusResponse %s', (_name, { responseData, expectedData }) => {
    const txType = TX_TYPE.STATUS
    const orderContract = responseData.GetMerchantOrderDetailResponse.GetMerchantOrderDetailResult.Value.OrderContract
    if (expectedData.status === 'approved') {
      valueMapper.mapOrderStatus.mockReturnValue(expectedData.order_status)
      valueMapper.mapCurrency.mockReturnValue(expectedData.currency)
      formatter.formatAmount.mockReturnValue(expectedData.first_amount)
      formatter.formatInstallment.mockReturnValue(expectedData.installment_count)
      formatter.formatDateTime
        .mockReturnValueOnce(expectedData.transaction_time)
        .mockReturnValueOnce(expectedData.capture_time ?? expectedData.cancel_time ?? expectedData.refund_time)
    }

    const actual: Data = mapper.mapStatusResponse(responseData)

    if (expectedData.status === 'approved') {
      expect(valueMapper.mapOrderStatus.mock.calls).toStrictEqual([[orderContract.LastOrderStatus]])
      expect(valueMapper.mapCurrency.mock.calls).toStrictEqual([[orderContract.FEC, txType]])
      expect(formatter.formatAmount.mock.calls).toStrictEqual([[orderContract.FirstAmount, txType]])
      // deviation: B13 the installment count is passed as text (the fixture holds the number the decoder would give as text)
      expect(formatter.formatInstallment.mock.calls).toStrictEqual([[String(orderContract.InstallmentCount), txType]])
      // order date first, then the date of the last update
      expect(formatter.formatDateTime.mock.calls).toStrictEqual([
        [orderContract.OrderDate, txType],
        [orderContract.UpdateSystemDate, txType],
      ])
    }
    takeNonEmpty(actual, 'all')
    // deviation: B13 the stub returns the dates; expected values carry the Türkiye time offset
    expectSameSorted(actual, expectedData)
  })

  it.each(threeDPaymentDataProvider)(
    'map3DPaymentData %s',
    (_name, { order, txType, threeDResponseData, paymentData, expectedData }) => {
      const callbackMessage = threeDResponseData.VPosMessage
      const callbackApproved = callbackCode(threeDResponseData) === '00'
      if (callbackMessage?.TransactionType !== undefined)
        valueMapper.mapTxType.mockReturnValue(expectedData.transaction_type)
      if (callbackApproved) {
        valueMapper.mapSecureType.mockReturnValue(expectedData.payment_model)
        formatter.formatAmount.mockReturnValue(expectedData.amount)
        valueMapper.mapCurrency.mockReturnValue(expectedData.currency)
        formatter.formatInstallment.mockReturnValue(expectedData.installment_count)
      }
      if (expectedData.transaction_time) formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)

      const actual: Data = mapper.map3DPaymentData(threeDResponseData, paymentData, txType, order)

      if (callbackMessage?.TransactionType !== undefined) {
        expect(valueMapper.mapTxType.mock.calls).toStrictEqual([[callbackMessage.TransactionType]])
      }
      if (callbackApproved) {
        expect(valueMapper.mapSecureType.mock.calls).toStrictEqual([[callbackMessage.TransactionSecurity, txType]])
        // call 1 is the callback, call 2 the provision answer
        const amountCalls = [[callbackMessage.Amount, txType]]
        const currencyCalls = [[callbackMessage.CurrencyCode, txType]]
        if (expectedData.status === 'approved') {
          amountCalls.push([paymentData.VPosMessage.Amount, txType])
          currencyCalls.push([paymentData.VPosMessage.CurrencyCode, txType])
          expect(formatter.formatInstallment.mock.calls).toStrictEqual([
            [paymentData.VPosMessage.InstallmentCount, txType],
          ])
        }
        expect(formatter.formatAmount.mock.calls).toStrictEqual(amountCalls)
        expect(valueMapper.mapCurrency.mock.calls).toStrictEqual(currencyCalls)
      }
      if (expectedData.transaction_time) {
        expect(formatter.formatDateTime.mock.calls).toStrictEqual([['now', txType]])
      }

      expect(actual).toHaveProperty('all')
      if (Object.keys(paymentData).length > 0) takeNonEmpty(actual, 'all')
      else delete actual.all
      takeNonEmpty(actual, '3d_all')
      expectSameSorted(actual, expectedData)
    },
  )

  it('map3DPayResponseData is not supported', () => {
    expect(() => mapper.map3DPayResponseData({}, TX_TYPE.PAY_AUTH, {} as PosOrder)).toThrow(NotImplementedError)
  })

  it('map3DHostResponseData is not supported', () => {
    expect(() => mapper.map3DHostResponseData({}, TX_TYPE.PAY_AUTH, {} as PosOrder)).toThrow(NotImplementedError)
  })

  it('mapOrderHistoryResponse is not supported', () => {
    expect(() => mapper.mapOrderHistoryResponse({})).toThrow(NotImplementedError)
  })

  describe('additions', () => {
    const order = {} as PosOrder
    const clone = <T>(value: T): T => structuredClone(value)
    const find = <T extends [string, Data]>(list: T[], name: string): Data => {
      const entry = list.find(([n]) => n === name)
      if (entry === undefined) throw new Error(`missing fixture ${name}`)
      return clone(entry[1])
    }
    const tdv2 = find(threeDPaymentDataProvider, 'success_tdv2')
    const callback = (): Data => clone(tdv2.threeDResponseData)
    const provision = (): Data => clone(tdv2.paymentData)

    // addition: the real formatter and value mapper turn the kuruş amounts and bank codes into library values
    it('maps the approved 3D flow with the real formatter and value mapper', () => {
      const actual: Data = realMapper().map3DPaymentData(callback(), provision(), TX_TYPE.PAY_AUTH, order)

      expect(actual.status).toBe('approved')
      expect(actual.amount).toBe(1.01)
      expect(actual.currency).toBe('TRY')
      expect(actual.payment_model).toBe('3d')
      expect(actual.installment_count).toBe(0)
      expect(actual.order_id).toBe('2024042111A0')
      expect(actual.batch_num).toBe('545')
      expect(actual.transaction_time).toBeInstanceOf(Date)
    })

    // addition: the SOAP decoder yields text, the fixtures hold numbers
    it('maps a status answer whose numbers arrive as text', () => {
      const data = find(statusTestDataProvider, 'success1')
      const contract = data.responseData.GetMerchantOrderDetailResponse.GetMerchantOrderDetailResult.Value.OrderContract
      contract.OrderId = '114293600'
      contract.LastOrderStatus = '1'
      contract.InstallmentCount = '0'

      const actual: Data = realMapper().mapStatusResponse(data.responseData)

      expect(actual.status).toBe('approved')
      expect(actual.order_status).toBe('PAYMENT_COMPLETED')
      expect(actual.remote_order_id).toBe('114293600')
      expect(actual.installment_count).toBe(0)
      expect(actual.first_amount).toBe(1.01)
      expect(actual.capture).toBe(true)
      // deviation: B13 bank times without an offset are Türkiye time
      expect(actual.transaction_time).toStrictEqual(new Date('2023-07-08T23:45:15.797+03:00'))
      expect(actual.capture_time).toStrictEqual(new Date('2023-07-08T23:45:35.283+03:00'))
    })

    it('reads a status date it cannot parse as absent without losing the answer', () => {
      const data = find(statusTestDataProvider, 'success1')
      data.responseData.GetMerchantOrderDetailResponse.GetMerchantOrderDetailResult.Value.OrderContract.OrderDate =
        'garbage'
      const actual: Data = realMapper(logger as unknown as PosLogger).mapStatusResponse(data.responseData)

      expect(actual.status).toBe('approved')
      expect(actual.transaction_time).toBeNull()
      expect(logger.warn).toHaveBeenCalledOnce()
    })

    it.each([
      [{}],
      [{ GetMerchantOrderDetailResponse: 'x' }],
      [{ GetMerchantOrderDetailResponse: [] }],
      [{ GetMerchantOrderDetailResponse: { GetMerchantOrderDetailResult: { Value: 'x' } } }],
      [{ GetMerchantOrderDetailResponse: { GetMerchantOrderDetailResult: { Value: { OrderContract: ['x'] } } } }],
    ])('mapStatusResponse(%j) is declined without throwing', (raw) => {
      const actual: Data = realMapper().mapStatusResponse(raw)
      expect(actual.status).toBe('declined')
      expect(actual.order_id).toBeNull()
    })

    it.each([[{}], [{ DrawBackResponse: 'x' }], [{ PartialDrawbackResponse: { PartialDrawbackResult: 'x' } }]])(
      'mapRefundResponse(%j) is declined without throwing',
      (raw) => {
        const actual: Data = realMapper().mapRefundResponse(raw)
        expect(actual.status).toBe('declined')
        expect(actual.order_id).toBeNull()
      },
    )

    it.each([[{}], [{ SaleReversalResponse: [] }], [{ SaleReversalResponse: { SaleReversalResult: { Value: 'x' } } }]])(
      'mapCancelResponse(%j) is declined without throwing',
      (raw) => {
        const actual: Data = realMapper().mapCancelResponse(raw)
        expect(actual.status).toBe('declined')
        expect(actual.order_id).toBeNull()
      },
    )

    // addition: an approval needs the message that carries the booked values; the default response stays declined
    it('mapPaymentResponse without a VPosMessage is declined with defaults', () => {
      const actual: Data = realMapper().mapPaymentResponse({ ResponseCode: '00' }, TX_TYPE.PAY_AUTH, order)
      expect(actual.status).toBe('declined')
      expect(actual.proc_return_code).toBe('00')
      expect(actual.error_code).toBeNull()
      expect(actual.amount).toBeNull()
      expect(actual.order_id).toBeNull()
    })

    it('map3DPaymentData without a provision answer is declined with defaults', () => {
      const actual: Data = realMapper().map3DPaymentData({ ResponseCode: '00' }, null, TX_TYPE.PAY_AUTH, order)
      expect(actual.status).toBe('declined')
      expect(actual.payment_model).toBeNull()
      expect(actual.amount).toBeNull()
    })

    // deviation: the card authentication alone is not a payment; nothing was booked until the provision says so
    it('map3DPaymentData of an approved callback and no provision never reports an approval', () => {
      for (const missing of [null, {}]) {
        const actual: Data = realMapper().map3DPaymentData(callback(), missing, TX_TYPE.PAY_AUTH, order)
        expect(actual.status).toBe('declined')
        expect(actual.auth_code).toBeNull()
      }
    })

    // addition: the decision reads the exact text, so padded or non-text codes never approve
    const badCodes: Array<[string, unknown]> = [
      ['leading blank', ' 00'],
      ['trailing blank', '00 '],
      ['newline', '00\n'],
      ['short', '0'],
      ['number', 0],
      ['list', ['00']],
      ['record', { value: '00' }],
      ['boolean', true],
      ['lower case word', 'ok'],
    ]
    describe.each(badCodes)('ResponseCode %s', (_label, code) => {
      it('never approves a payment answer', () => {
        const answer = provision()
        answer.ResponseCode = code
        const actual: Data = realMapper().mapPaymentResponse(answer, TX_TYPE.PAY_AUTH, order)
        expect(actual.status).toBe('declined')
        expect(actual.auth_code).toBeNull()
        expect(actual.amount).toBeNull()
      })

      it('never approves a 3D callback, with or without an approved provision', () => {
        const hostile = callback()
        hostile.ResponseCode = code
        for (const answer of [provision(), null]) {
          const actual: Data = realMapper().map3DPaymentData(hostile, answer, TX_TYPE.PAY_AUTH, order)
          expect(actual.status).toBe('declined')
          expect(actual.payment_model).toBeNull()
          expect(actual.proc_return_code).not.toBe('00')
          if (answer === null) {
            expect(actual.amount).toBeNull()
            expect(actual.auth_code).toBeNull()
          }
        }
        expect(realMapper().is3dAuthSuccess(realMapper().extractMdStatus(hostile))).toBe(false)
      })

      it('never approves a status, refund or cancel answer', () => {
        const status = find(statusTestDataProvider, 'success1').responseData
        status.GetMerchantOrderDetailResponse.GetMerchantOrderDetailResult.Value.OrderContract.ResponseCode = code
        expect(realMapper().mapStatusResponse(status).status).toBe('declined')

        const refund = find(refundTestDataProvider, 'success1').responseData
        refund.PartialDrawbackResponse.PartialDrawbackResult.Value.ResponseCode = code
        expect(realMapper().mapRefundResponse(refund).status).toBe('declined')

        const cancel = find(cancelTestDataProvider, 'success1').responseData
        cancel.SaleReversalResponse.SaleReversalResult.Value.ResponseCode = code
        expect(realMapper().mapCancelResponse(cancel).status).toBe('declined')
      })
    })

    // addition: a provision that approves cannot rescue a callback that was not an authentication
    it('map3DPaymentData keeps a declined callback declined even when the provision answer approves', () => {
      const declined = callback()
      declined.ResponseCode = '51'
      const actual: Data = realMapper().map3DPaymentData(declined, provision(), TX_TYPE.PAY_AUTH, order)
      expect(actual.status).toBe('declined')
      expect(actual.proc_return_code).toBe('51')
      expect(actual.error_code).toBe('51')
    })

    // deviation: the signed callback id wins over the browser-posted copy inside the message, which no signature covers
    it('prefers the top-level order id of the callback', () => {
      const data = callback()
      data.VPosMessage.MerchantOrderId = 'forged'
      const actual: Data = realMapper().map3DPaymentData(data, null, TX_TYPE.PAY_AUTH, order)
      expect(actual.order_id).toBe('2024042111A0')
    })

    // addition: non-text bank values never become "[object Object]" or "undefined" text
    it('maps non-text bank values to null', () => {
      const answer = provision()
      answer.VPosMessage.CardNumber = { a: 'b' }
      answer.VPosMessage.BatchID = ['1']
      answer.VPosMessage.Amount = { a: '1' }
      answer.VPosMessage.CurrencyCode = ['949']
      answer.OrderId = { a: '1' }
      answer.RRN = ['1']
      answer.Stan = true
      answer.ProvisionNumber = { '#': 'x' }
      const actual: Data = realMapper().mapPaymentResponse(answer, TX_TYPE.PAY_AUTH, order)
      const { all: _all, ...rest } = actual

      expect(actual.status).toBe('approved')
      expect(JSON.stringify(rest)).not.toMatch(/object Object|undefined/)
      expect(actual.masked_number).toBeNull()
      expect(actual.batch_num).toBeNull()
      expect(actual.amount).toBeNull()
      expect(actual.currency).toBeNull()
      expect(actual.remote_order_id).toBeNull()
      expect(actual.ref_ret_num).toBeNull()
      expect(actual.transaction_id).toBeNull()
      expect(actual.auth_code).toBeNull()
    })

    it('maps non-text callback and status values to null', () => {
      const hostile = callback()
      hostile.VPosMessage.CardNumber = { a: 'b' }
      hostile.VPosMessage.TransactionSecurity = ['3']
      hostile.VPosMessage.BatchID = { a: '1' }
      hostile.ResponseMessage = ['x']
      const actual: Data = realMapper().map3DPaymentData(hostile, null, TX_TYPE.PAY_AUTH, order)
      const { all: _all, '3d_all': _threeD, ...rest } = actual
      expect(JSON.stringify(rest)).not.toMatch(/object Object|undefined/)
      expect(actual.masked_number).toBeNull()
      expect(actual.payment_model).toBeNull()
      expect(actual.batch_num).toBeNull()

      const data = find(statusTestDataProvider, 'success1')
      const contract = data.responseData.GetMerchantOrderDetailResponse.GetMerchantOrderDetailResult.Value.OrderContract
      contract.MerchantOrderId = { a: 'b' }
      contract.CardNumber = ['x']
      contract.FirstAmount = { a: '1' }
      const status: Data = realMapper().mapStatusResponse(data.responseData)
      const { all: _statusAll, ...statusRest } = status
      expect(JSON.stringify(statusRest)).not.toMatch(/object Object|undefined/)
      expect(status.order_id).toBeNull()
      expect(status.masked_number).toBeNull()
      expect(status.first_amount).toBeNull()
    })

    // addition: only a positive whole batch number is reported
    it.each([
      ['12', '12'],
      ['0', null],
      ['-5', null],
      ['1.5', null],
      ['abc', null],
      ['', null],
    ])('callback BatchID %j -> %j', (batch, expected) => {
      const data = callback()
      data.VPosMessage.BatchID = batch
      expect(realMapper().map3DPaymentData(data, null, TX_TYPE.PAY_AUTH, order).batch_num).toBe(expected)
    })

    // addition: a failure list reports the first record
    it('reports the first record of a list of failures', () => {
      const data = find(cancelTestDataProvider, 'fail_already_cancelled')
      const actual: Data = realMapper().mapCancelResponse(data.responseData)
      expect(actual.error_code).toBe('21')
      expect(actual.error_message).toBe('İşlem daha önce iptal edilmiştir.')

      const status = find(statusTestDataProvider, 'tdv2_fail_hash_error').responseData
      const results = status.GetMerchantOrderDetailResponse.GetMerchantOrderDetailResult.Results
      results.Result = [results.Result, { ErrorCode: 'second', ErrorMessage: 'second' }]
      const failed: Data = realMapper().mapStatusResponse(status)
      expect(failed.error_code).toBe('HashDataError')
      expect(failed.status).toBe('declined')
    })

    // addition: the callback result code is the only md status; lists and records never are
    it.each([
      [{ ResponseCode: ['00'] }],
      [{ ResponseCode: { a: '00' } }],
      [{ ResponseCode: 0 }],
      [{ ResponseCode: '' }],
      [Object.create({ ResponseCode: '00' })],
      [null],
      [undefined],
    ])('extractMdStatus(%j) -> null', (raw) => {
      expect(mapper.extractMdStatus(raw as never)).toBeNull()
    })

    // addition: a padded code is shown as it was sent, never turned into an approval
    it('keeps a padded result code as sent for display', () => {
      const actual: Data = realMapper().mapPaymentResponse(
        { ResponseCode: ' 00', ResponseMessage: 'x' },
        TX_TYPE.PAY_AUTH,
        order,
      )
      expect(actual.proc_return_code).toBe(' 00')
      expect(actual.status).toBe('declined')
    })

    // addition: nothing sensitive reaches the logger
    it('never logs a card number or the hash password', () => {
      const lines: string[] = []
      const capture: PosLogger = {
        debug: (message, context) => lines.push(JSON.stringify([message, context])),
        info: (message, context) => lines.push(JSON.stringify([message, context])),
        warn: (message, context) => lines.push(JSON.stringify([message, context])),
        error: (message, context) => lines.push(JSON.stringify([message, context])),
      }
      const hostile = callback()
      hostile.VPosMessage.CardNumber = '5188961912342544'
      hostile.VPosMessage.HashPassword = 'secret-password-hash'
      const answer = provision()
      answer.VPosMessage.CardNumber = '5188961912342544'
      answer.VPosMessage.HashPassword = 'secret-password-hash'

      realMapper(capture).map3DPaymentData(hostile, answer, TX_TYPE.PAY_AUTH, order)
      realMapper(capture).mapPaymentResponse(answer, TX_TYPE.PAY_AUTH, order)

      expect(lines.length).toBeGreaterThan(0)
      const logged = lines.join('\n')
      expect(logged).not.toContain('5188961912342544')
      expect(logged).not.toContain('secret-password-hash')
    })
  })
})

function callbackCode(data: Data): string | undefined {
  return data.ResponseCode
}
