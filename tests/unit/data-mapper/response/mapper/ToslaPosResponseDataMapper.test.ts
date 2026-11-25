import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToslaPosResponseDataMapper } from '../../../../../src/data-mapper/response/mapper/ToslaPosResponseDataMapper.js'
import type { ResponseValueFormatterInterface } from '../../../../../src/data-mapper/response/value-formatter/ResponseValueFormatterInterface.js'
import { ToslaPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/ToslaPosResponseValueFormatter.js'
import type { ResponseValueMapperInterface } from '../../../../../src/data-mapper/response/value-mapper/ResponseValueMapperInterface.js'
import { ToslaPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/ToslaPosResponseValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import type { PosLogger } from '../../../../../src/logger.js'
import { CURRENCY, TX_TYPE } from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'
import {
  type Case,
  cancelCases,
  orderHistoryCases,
  paymentCases,
  refundCases,
  statusCases,
  threeDHostCases,
  threeDPayCases,
} from './ToslaPosResponseDataMapper.data.js'

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

/** `assertArrayHasKey` + `assertIsArray` + `assertNotEmpty`, then `unset`. */
function takeNonEmpty(actual: Data, key: string): void {
  expect(actual).toHaveProperty(key)
  const value = actual[key]
  expect(value !== null && typeof value === 'object').toBe(true)
  expect(Object.keys(value as Data).length).toBeGreaterThan(0)
  delete actual[key]
}

/** `ksort` both sides, then compare values and types. */
function sorted(data: Data): Data {
  return Object.fromEntries(Object.entries(data).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** Türkiye wall-clock time as `YYYYMMDDHHmmss`. */
function turkeyTime(date: Date): string {
  const shifted = new Date(date.getTime() + 3 * 3_600_000)
  return shifted.toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

/** A named fixture; a missing name is a broken test, not an undefined value. */
function fixture(cases: Record<string, Case>, name: string): Case {
  const found = cases[name]
  if (found === undefined) throw new Error(`Unknown fixture ${name}`)

  return found
}

const ORDER: PosOrder = { id: 'x', currency: CURRENCY.TRY, amount: 1.01 } as PosOrder

describe('ToslaPosResponseDataMapper', () => {
  let formatter: Mocked<ResponseValueFormatterInterface>
  let valueMapper: Mocked<ResponseValueMapperInterface>
  let logger: Mocked<PosLogger>
  let mapper: ToslaPosResponseDataMapper

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
    mapper = new ToslaPosResponseDataMapper(
      formatter as unknown as ResponseValueFormatterInterface,
      valueMapper as unknown as ResponseValueMapperInterface,
      logger as unknown as PosLogger,
    )
  })

  const realMapper = (log?: PosLogger) =>
    new ToslaPosResponseDataMapper(new ToslaPosResponseValueFormatter(), new ToslaPosResponseValueMapper(), log)

  it('supports', () => {
    expect(ToslaPosResponseDataMapper.supports('ToslaPos')).toBe(true)
    expect(ToslaPosResponseDataMapper.supports('AkbankPos')).toBe(false)
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

  it('exposes the bank success code', () => {
    expect(ToslaPosResponseDataMapper.PROCEDURE_SUCCESS_CODE).toBe('00')
  })

  describe('mapPaymentResponse', () => {
    it.each(Object.entries(paymentCases))('%s', (_name, { order, txType, responseData, expectedData }) => {
      if (expectedData.transaction_time !== null) {
        formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
      }

      const actual: Data = mapper.mapPaymentResponse(responseData, txType as never, order as PosOrder)

      if (expectedData.transaction_time !== null) {
        expect(formatter.formatDateTime.mock.calls).toStrictEqual([['now', txType]])
      } else {
        expect(formatter.formatDateTime).not.toHaveBeenCalled()
      }
      takeNonEmpty(actual, 'all')
      expect(sorted(actual)).toStrictEqual(sorted(expectedData))
    })

    it('an empty answer is the default declined response', () => {
      const actual = mapper.mapPaymentResponse({}, TX_TYPE.PAY_AUTH, ORDER)

      expect(actual.status).toBe('declined')
      expect(actual.order_id).toBeNull()
      expect(actual.proc_return_code).toBeNull()
    })

    // addition: the answer of a failed payment never reads as approved
    it('a non-record answer is the default declined response', () => {
      const actual = mapper.mapPaymentResponse(null as never, TX_TYPE.PAY_AUTH, ORDER)

      expect(actual.status).toBe('declined')
      expect(actual.all).toBeNull()
    })
  })

  describe('map3DPayResponseData', () => {
    it.each(Object.entries(threeDPayCases))('%s', (_name, { order, txType, responseData, expectedData }) => {
      valueMapper.mapOrderStatus.mockReturnValue(expectedData.tx_status)
      if (expectedData.transaction_time !== null) {
        formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
      }

      const actual: Data = mapper.map3DPayResponseData(responseData, txType as never, order as PosOrder)

      expect(valueMapper.mapOrderStatus.mock.calls).toStrictEqual([[responseData.RequestStatus]])
      if (expectedData.transaction_time !== null) {
        expect(formatter.formatDateTime.mock.calls).toStrictEqual([['now', txType]])
      } else {
        expect(formatter.formatDateTime).not.toHaveBeenCalled()
      }
      takeNonEmpty(actual, 'all')
      expect(sorted(actual)).toStrictEqual(sorted(expectedData))
    })
  })

  describe('map3DHostResponseData', () => {
    it.each(Object.entries(threeDHostCases))('%s', (_name, { order, txType, responseData, expectedData }) => {
      valueMapper.mapOrderStatus.mockReturnValue(expectedData.tx_status)
      if (expectedData.transaction_time !== null) {
        formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
      }

      const actual: Data = mapper.map3DHostResponseData(responseData, txType as never, order as PosOrder)

      expect(valueMapper.mapOrderStatus.mock.calls).toStrictEqual([[responseData.RequestStatus]])
      if (expectedData.transaction_time !== null) {
        expect(formatter.formatDateTime.mock.calls).toStrictEqual([['now', txType]])
      } else {
        expect(formatter.formatDateTime).not.toHaveBeenCalled()
      }
      takeNonEmpty(actual, 'all')
      expect(sorted(actual)).toStrictEqual(sorted(expectedData))
    })
  })

  describe('mapStatusResponse', () => {
    it.each(Object.entries(statusCases))('%s', (_name, { responseData, expectedData }) => {
      const txType = TX_TYPE.STATUS
      valueMapper.mapOrderStatus.mockReturnValue(expectedData.order_status)
      valueMapper.mapTxType.mockReturnValue(expectedData.transaction_type)

      const amounts: unknown[] = []
      if (responseData.Currency > 0) {
        valueMapper.mapCurrency.mockReturnValue(expectedData.currency)
        formatter.formatAmount.mockImplementation((amount: unknown, txTypeArg: unknown) => {
          expect(txTypeArg).toBe(txType)
          amounts.push(amount)
          if (amounts.length === 1) return expectedData.first_amount
          if (amounts.length === 2) return expectedData.refund_amount

          return false
        })
        formatter.formatDateTime.mockReturnValue(expectedData.transaction_time)
      }

      const actual: Data = mapper.mapStatusResponse(responseData)

      expect(valueMapper.mapOrderStatus.mock.calls).toStrictEqual([[responseData.RequestStatus]])
      expect(valueMapper.mapTxType.mock.calls).toStrictEqual([[responseData.TransactionType]])
      if (responseData.Currency > 0) {
        // call 1 is the amount, call 2 (only with a refund) is the refunded amount
        expect(amounts[0]).toBe(responseData.Amount)
        if (responseData.RefundedAmount > 0) expect(amounts[1]).toBe(responseData.RefundedAmount)
        expect(valueMapper.mapCurrency.mock.calls).toStrictEqual([[responseData.Currency, txType]])
        expect(formatter.formatDateTime.mock.calls).toStrictEqual([[responseData.CreateDate, txType]])
      } else {
        expect(valueMapper.mapCurrency).not.toHaveBeenCalled()
        expect(formatter.formatDateTime).not.toHaveBeenCalled()
      }
      takeNonEmpty(actual, 'all')
      expect(sorted(actual)).toStrictEqual(sorted(expectedData))
    })
  })

  describe.each([
    ['mapRefundResponse', refundCases],
    ['mapCancelResponse', cancelCases],
  ] as const)('%s', (method, cases) => {
    it.each(Object.entries(cases))('%s', (_name, { responseData, expectedData }) => {
      const actual: Data = mapper[method](responseData)

      takeNonEmpty(actual, 'all')
      // the keys keep the order the response is built in
      expect(Object.keys(actual)).toStrictEqual(Object.keys(expectedData))
      expect(actual).toStrictEqual(expectedData)
    })
  })

  // the iteration, sorting and conditional statements make mocks impractical: real formatter and value mapper
  describe('mapOrderHistoryResponse', () => {
    it.each(Object.entries(orderHistoryCases))('%s', (_name, { responseData, expectedData }) => {
      const actual: Data = realMapper(logger as unknown as PosLogger).mapOrderHistoryResponse(responseData)

      if (responseData.Transactions) {
        expect(actual.transactions).toHaveLength(actual.trans_count)
        const [first, second] = actual.transactions
        if (actual.transactions.length > 1 && first.transaction_time !== null && second.transaction_time !== null) {
          expect(second.transaction_time.getTime()).toBeGreaterThan(first.transaction_time.getTime())
        }

        responseData.Transactions.forEach((tx: Data, key: number) => {
          if (tx.CreateDate) {
            expect(turkeyTime(actual.transactions[key].transaction_time)).toBe(tx.CreateDate)
            expect(actual.transactions[key].capture_time).toStrictEqual(expectedData.transactions[key].capture_time)
            // (the compared times are removed so the rest is compared with sorted keys)
            delete actual.transactions[key].transaction_time
            delete expectedData.transactions[key].transaction_time
            delete actual.transactions[key].capture_time
            delete expectedData.transactions[key].capture_time
          }
          actual.transactions[key] = sorted(actual.transactions[key])
          expectedData.transactions[key] = sorted(expectedData.transactions[key])
        })
      }

      takeNonEmpty(actual, 'all')
      expect(sorted(actual)).toStrictEqual(sorted(expectedData))
    })
  })

  // deviation: T19 NotImplementedError instead of a plain not-implemented exception
  it('map3DPaymentData is not supported', () => {
    expect(() => mapper.map3DPaymentData({}, {}, TX_TYPE.PAY_AUTH, ORDER)).toThrow(NotImplementedError)
  })

  describe('additions with the real formatter and value mapper', () => {
    const real = realMapper()

    // addition: the paid status fixture, mapped end to end
    it('maps a paid order status end to end', () => {
      const actual = real.mapStatusResponse(fixture(statusCases, 'success_pay').responseData as Data)

      expect(actual.first_amount).toBe(1.01)
      expect(actual.currency).toBe('TRY')
      expect(actual.transaction_time).toStrictEqual(new Date('2024-01-20T00:50:07+03:00'))
      expect(actual.order_status).toBe('PAYMENT_COMPLETED')
      expect(actual.transaction_type).toBe('pay')
    })

    // addition: documented behaviour of the status answer for an unknown order: the query itself succeeded
    it('an unknown order is an approved query without an order id', () => {
      const actual = real.mapStatusResponse(fixture(statusCases, 'fail_order_not_found').responseData as Data)

      expect(actual.status).toBe('approved')
      expect(actual.order_id).toBeNull()
      expect(actual.first_amount).toBeNull()
    })

    // addition: empty answers map to declined results without throwing
    it.each([
      ['mapCancelResponse', (m: ToslaPosResponseDataMapper) => m.mapCancelResponse({})],
      ['mapRefundResponse', (m: ToslaPosResponseDataMapper) => m.mapRefundResponse({})],
      ['mapStatusResponse', (m: ToslaPosResponseDataMapper) => m.mapStatusResponse({})],
      ['mapOrderHistoryResponse', (m: ToslaPosResponseDataMapper) => m.mapOrderHistoryResponse({})],
    ])('%s of an empty answer is declined', (_name, run) => {
      const actual = run(real)

      expect(actual.status).toBe('declined')
      expect(actual.order_id).toBeNull()
      expect(actual.error_code).toBeNull()
    })

    // addition: only the number 0 is success; the text "0" is not
    it.each([
      ['mapCancelResponse', (m: ToslaPosResponseDataMapper, c: Data) => m.mapCancelResponse(c)],
      ['mapRefundResponse', (m: ToslaPosResponseDataMapper, c: Data) => m.mapRefundResponse(c)],
      ['mapStatusResponse', (m: ToslaPosResponseDataMapper, c: Data) => m.mapStatusResponse(c)],
      ['mapOrderHistoryResponse', (m: ToslaPosResponseDataMapper, c: Data) => m.mapOrderHistoryResponse(c)],
    ])('%s: a string, list or boolean code is declined', (_name, run) => {
      for (const code of ['0', [0], false, null, 0.5, Number.NaN]) {
        const actual = run(real, { Code: code, OrderId: 'A1', BankResponseCode: '00', Transactions: [] })
        expect(actual.status).toBe('declined')
      }
      expect(run(real, { Code: 0, OrderId: 'A1', BankResponseCode: '00', Transactions: [] }).status).toBe('approved')
    })

    // addition: a payment answer with an unusable code of its own is declined
    it('the 3D Pay result of an empty callback is declined', () => {
      const actual = real.map3DPayResponseData({}, TX_TYPE.PAY_AUTH, ORDER)

      expect(actual.status).toBe('declined')
      expect(actual.proc_return_code).toBeNull()
      expect(actual.md_status).toBeNull()
      expect(actual.transaction_security).toBeNull()
    })

    // addition: a history answer whose list is not a list lists nothing
    it('Transactions that is not a list lists nothing', () => {
      const actual = real.mapOrderHistoryResponse({ Code: 0, Transactions: 'x' })

      expect(actual.status).toBe('approved')
      expect(actual.trans_count).toBe(0)
      expect(actual.transactions).toStrictEqual([])
    })

    // addition: items that are not records are skipped
    it('non-record history items are skipped', () => {
      const good = (
        fixture(orderHistoryCases, 'success_only_payment_transaction').responseData.Transactions as Data[]
      )[0]
      const actual = real.mapOrderHistoryResponse({ Code: 0, Transactions: [null, 5, good] })

      expect(actual.trans_count).toBe(1)
      expect(actual.transactions).toHaveLength(1)
      expect(actual.order_id).toBe('20231209C3AE')
    })

    // addition: the callback text is trimmed when it is reported; the decision is taken on the text as sent, which is
    // why the gateway pins the exact text before it trusts an approval
    it('reports a padded bank code trimmed but does not approve on it', () => {
      const callback = { ...(fixture(threeDPayCases, 'success1').responseData as Data), BankResponseCode: ' 00 ' }
      const actual = real.map3DPayResponseData(callback, TX_TYPE.PAY_AUTH, ORDER)

      expect(actual.proc_return_code).toBe('00')
      expect(actual.status).toBe('declined')
    })

    // addition: the genuine approvals, mapped with the real value mapper
    it('approves the genuine 3D Pay and 3D Host callbacks', () => {
      const pay = real.map3DPayResponseData(
        fixture(threeDPayCases, 'success1').responseData as Data,
        TX_TYPE.PAY_AUTH,
        ORDER,
      )
      const host = real.map3DHostResponseData(
        fixture(threeDHostCases, 'success1').responseData as Data,
        TX_TYPE.PAY_AUTH,
        ORDER,
      )

      expect(pay.status).toBe('approved')
      expect(pay.payment_model).toBe('3d_pay')
      expect(pay.transaction_time).toBeInstanceOf(Date)
      expect(host.status).toBe('approved')
      expect(host.payment_model).toBe('3d_host')
    })

    describe('approval guards (each input would be approved without its guard)', () => {
      const genuine = (): Data => ({ ...(fixture(threeDPayCases, 'success1').responseData as Data) })
      const map = (callback: Data) => real.map3DPayResponseData(callback, TX_TYPE.PAY_AUTH, ORDER)

      it('the genuine callback is the baseline', () => {
        expect(map(genuine()).status).toBe('approved')
      })

      // addition: the guard reads the bank code exactly as sent
      it.each([' 00 ', '00 ', '\t00', '0', '000'])('bank code %j is not an approval', (code) => {
        expect(map({ ...genuine(), BankResponseCode: code }).status).toBe('declined')
      })

      // addition: the 3D result is read exactly as sent
      it.each([' 1 ', '1 ', '01', '2', '3', '4', '9', '', null])('MdStatus %j is not an approval', (md) => {
        expect(map({ ...genuine(), MdStatus: md }).status).toBe('declined')
      })

      // addition: the request status is read exactly as sent
      it.each([' 1 ', '1 ', '01', '2', '5', '', null])('RequestStatus %j is not an approval', (rs) => {
        expect(map({ ...genuine(), RequestStatus: rs }).status).toBe('declined')
      })

      // addition: values that are not text never read as text
      it.each([[['00']], [{ toString: () => '00' }], [0], [true]])(
        'bank code %j (not text) is not an approval',
        (code) => {
          const actual = map({ ...genuine(), BankResponseCode: code })

          expect(actual.status).toBe('declined')
          expect(actual.proc_return_code).toBeNull()
        },
      )

      // addition: a list or record is not a 3D result and not a request status
      it.each([[['1']], [{ a: 1 }]])('MdStatus / RequestStatus %j (not text) is not an approval', (value) => {
        const md = map({ ...genuine(), MdStatus: value })
        const rs = map({ ...genuine(), RequestStatus: value })

        expect(md.status).toBe('declined')
        expect(md.md_status).toBeNull()
        expect(rs.status).toBe('declined')
      })

      // addition: inherited members are not part of the answer
      it('values inherited from a prototype are ignored', () => {
        const callback = Object.create({ BankResponseCode: '00', MdStatus: '1', RequestStatus: '1', OrderId: 'A1' })
        const actual = map(callback)

        expect(actual.status).toBe('declined')
        expect(actual.order_id).toBeNull()
        expect(actual.proc_return_code).toBeNull()
        expect(actual.md_status).toBeNull()
      })

      // addition: the half 3D results (2-4) are signed declines
      it.each(['2', '3', '4'])('MdStatus %s with an otherwise good callback is declined', (md) => {
        const actual = map({ ...genuine(), MdStatus: md })

        expect(actual.status).toBe('declined')
        expect(actual.transaction_security).toBe('Half 3D Secure')
      })

      // addition: a payment answer is approved on the exact bank code only
      it.each([' 00 ', '0', ['00'], 0, null])('payment bank code %j is not an approval', (code) => {
        const raw = { ...(fixture(paymentCases, 'success1').responseData as Data), BankResponseCode: code }
        const actual = real.mapPaymentResponse(raw, TX_TYPE.PAY_AUTH, ORDER)

        expect(actual.status).toBe('declined')
      })
    })

    describe('bank values that are not plain scalars', () => {
      // addition: objects and lists never become "[object Object]" and never reach the result as such
      it('a payment answer keeps only text and numbers', () => {
        const raw = {
          ...(fixture(paymentCases, 'error_post_pay').responseData as Data),
          OrderId: { a: 1 },
          TransactionId: ['1'],
          HostReferenceNumber: { toString: () => 'x' },
          Message: ['bad'],
        }
        const actual = real.mapPaymentResponse(raw, TX_TYPE.PAY_AUTH, ORDER)

        expect(actual.order_id).toBeNull()
        expect(actual.transaction_id).toBeNull()
        expect(actual.ref_ret_num).toBeNull()
        expect(actual.error_message).toBeNull()
      })

      // addition: the same for the 3D callback
      it('a 3D callback keeps only text and numbers', () => {
        const raw = { OrderId: ['A1'], MdStatus: { a: 1 }, BankResponseCode: 'MD:0', BankResponseMessage: { m: 1 } }
        const actual = real.map3DPayResponseData(raw, TX_TYPE.PAY_AUTH, ORDER)

        expect(actual.order_id).toBeNull()
        expect(actual.md_status).toBeNull()
        expect(actual.error_message).toBeNull()
        expect(actual.proc_return_code).toBe('MD:0')
      })

      // addition: the same for the status, history, cancel and refund answers
      it('status, cancel, refund and history keep only text and numbers', () => {
        const odd = {
          Code: 0,
          OrderId: { a: 1 },
          AuthCode: ['x'],
          HostReferenceNumber: { a: 1 },
          TransactionId: { a: 1 },
          CardNo: ['4159'],
          BankResponseCode: ['00'],
          RequestStatus: { a: 1 },
          TransactionType: ['1'],
          Message: { a: 1 },
          Currency: ['949'],
          Amount: { a: 1 },
          CreateDate: ['20240120005007'],
        }
        for (const actual of [
          real.mapStatusResponse(odd),
          real.mapCancelResponse(odd),
          real.mapRefundResponse(odd),
          (real.mapOrderHistoryResponse({ Code: 0, Transactions: [odd] }).transactions as Data[])[0] as Data,
        ] as Data[]) {
          expect(actual.order_id ?? null).toBeNull()
          expect(actual.auth_code).toBeNull()
          expect(actual.ref_ret_num).toBeNull()
          expect(actual.transaction_id).toBeNull()
          expect(actual.proc_return_code).toBeNull()
          expect(JSON.stringify({ ...actual, all: null })).not.toContain('[object')
        }
        const status = real.mapStatusResponse(odd)
        expect(status.masked_number).toBeNull()
        expect(status.first_amount).toBeNull()
        expect(status.currency).toBeNull()
        expect(status.transaction_time).toBeNull()
      })

      // addition: a declined answer's code and message are text or numbers as sent
      it('a declined answer carries its code as text', () => {
        const actual = real.mapCancelResponse({ Code: 101, Message: 'Orjinal Kayıt Bulunamadı' })

        expect(actual.error_code).toBe('101')
        expect(actual.error_message).toBe('Orjinal Kayıt Bulunamadı')
      })
    })

    describe('amounts and times of status and history answers', () => {
      const status = (patch: Data): Data =>
        real.mapStatusResponse({ ...(fixture(statusCases, 'success_pay').responseData as Data), ...patch })

      // addition: amounts come from kuruş integers only
      it.each([
        [1.5],
        ['1.5'],
        [-5],
        ['-5'],
        [1e20],
        ['1e3'],
        ['0x10'],
        [' 101'],
        [Number.NaN],
        [{ a: 1 }],
        [['101']],
        [true],
      ])('Amount %j is not a displayed amount', (amount) => {
        const actual = status({ Amount: amount })

        expect(actual.first_amount).toBeNull()
        expect(actual.capture_amount).toBeNull()
        expect(actual.capture).toBeNull()
      })

      // addition: integers as text or number read the same
      it.each([[101], ['101']])('Amount %j is 1.01', (amount) => {
        expect(status({ Amount: amount }).first_amount).toBe(1.01)
      })

      // addition: a refunded amount of anything but a positive kuruş integer is no refund
      it.each([[0], [-1], [1.5], ['x'], [{ a: 1 }], [null]])('RefundedAmount %j is no refund', (amount) => {
        expect(status({ RefundedAmount: amount }).refund_amount).toBeNull()
      })

      // addition: a time that cannot be read never hides the answer
      it.each([['0'], ['garbage'], [''], [null], [['20240120005007']], [{ a: 1 }]])(
        'CreateDate %j reads as no time',
        (date) => {
          const actual = status({ CreateDate: date })

          expect(actual.status).toBe('approved')
          expect(actual.transaction_time).toBeNull()
          expect(actual.first_amount).toBe(1.01)
        },
      )

      // addition: nothing is captured without a known amount
      it('a payment without an amount captures nothing', () => {
        const actual = status({ Currency: 0 })

        expect(actual.first_amount).toBeNull()
        expect(actual.capture).toBeNull()
        expect(actual.capture_amount).toBeNull()
      })

      // addition: the captured amount of a history item is the commission and the net amount together
      it('history capture adds commission and net amount in kuruş', () => {
        const item = {
          ...(fixture(statusCases, 'success_pay').responseData as Data),
          NetAmount: '98',
          MerchantCommissionAmount: 3,
        }
        const actual = real.mapSingleHistoryResponse(item)

        expect(actual.first_amount).toBe(1.01)
        expect(actual.capture_amount).toBe(1.01)
        expect(actual.capture).toBe(true)
      })

      // addition: a history item with unreadable money fields captures nothing
      it.each([[{ NetAmount: 'x' }], [{ NetAmount: 1.5 }], [{ MerchantCommissionAmount: -3 }], [{ NetAmount: null }]])(
        'history item %j captures nothing',
        (patch) => {
          const item = {
            ...(fixture(statusCases, 'success_pay').responseData as Data),
            NetAmount: 98,
            MerchantCommissionAmount: 3,
            ...patch,
          }
          const actual = real.mapSingleHistoryResponse(item)

          expect(actual.capture_amount).toBeNull()
          expect(actual.capture).toBeNull()
        },
      )

      // addition: a transaction id counts only as a positive integer and keeps its type
      it.each([
        [0, null],
        ['0', null],
        [-1, null],
        ['x', null],
        [1.5, null],
        [7, 7],
        ['2000000000032596', '2000000000032596'],
      ])('TransactionId %j -> %j', (id, expected) => {
        expect(status({ TransactionId: id }).transaction_id).toBe(expected)
      })
    })

    // addition: the logged contexts never carry a card number
    it('never logs an unmasked card number', () => {
      const seen: string[] = []
      const log: PosLogger = {
        debug: (_m, ctx) => seen.push(JSON.stringify(ctx ?? null)),
        info: (_m, ctx) => seen.push(JSON.stringify(ctx ?? null)),
        warn: (_m, ctx) => seen.push(JSON.stringify(ctx ?? null)),
        error: (_m, ctx) => seen.push(JSON.stringify(ctx ?? null)),
      }
      const logged = realMapper(log)
      const pan = '4159560047417732'

      logged.mapPaymentResponse(
        { ...(fixture(paymentCases, 'success1').responseData as Data), CardNo: pan, CardHolderName: 'A B' },
        TX_TYPE.PAY_AUTH,
        ORDER,
      )
      logged.map3DPayResponseData(
        { ...(fixture(threeDPayCases, 'success1').responseData as Data), CardNo: pan },
        TX_TYPE.PAY_AUTH,
        ORDER,
      )
      logged.map3DHostResponseData(
        { ...(fixture(threeDHostCases, 'success1').responseData as Data), CardNo: pan },
        TX_TYPE.PAY_AUTH,
        ORDER,
      )

      expect(seen.length).toBeGreaterThan(0)
      for (const line of seen) expect(line).not.toContain(pan)
    })

    // addition: the mapped amounts of a status answer are display values; a payment answer carries the order's own
    it('payment and 3D results carry the order amount and currency, not the bank echo', () => {
      const raw = { ...(fixture(paymentCases, 'success1').responseData as Data), Amount: 99999, Currency: 840 }
      const actual = real.mapPaymentResponse(raw, TX_TYPE.PAY_AUTH, ORDER)

      expect(actual.amount).toBe(1.01)
      expect(actual.currency).toBe('TRY')
    })

    // addition: the transaction security reading of the 3D result
    it.each([
      ['1', 'Full 3D Secure'],
      ['2', 'Half 3D Secure'],
      ['3', 'Half 3D Secure'],
      ['4', 'Half 3D Secure'],
      ['0', 'MPI fallback'],
      ['9', 'MPI fallback'],
    ])('MdStatus %s is %s', (md, security) => {
      const actual = real.map3DPayResponseData({ MdStatus: md, BankResponseCode: 'MD:0' }, TX_TYPE.PAY_AUTH, ORDER)

      expect(actual.transaction_security).toBe(security)
    })
  })
})
