import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GarantiPosQueryResponseDataMapper } from '../../../../../src/data-mapper/pos-query/response/GarantiPosQueryResponseDataMapper.js'
import { GarantiPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/GarantiPosResponseValueFormatter.js'
import { GarantiPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/GarantiPosResponseValueMapper.js'
import { noopLogger } from '../../../../../src/logger.js'
import { CARD_CLASS, CARD_TYPE } from '../../../../../src/PosInterface.js'

const mapper = new GarantiPosQueryResponseDataMapper(
  new GarantiPosResponseValueFormatter(),
  new GarantiPosResponseValueMapper(),
  noopLogger,
)

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../test_data/garanti/history/${name}`, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >

type Timed = { date: string; timezone: string } | null

// deviation: G9 offset-less bank times are Türkiye time
const toInstant = (value: Timed): Date | null =>
  value === null ? null : new Date(`${value.date.replace(' ', 'T').slice(0, 19)}+03:00`)

/** Key order is irrelevant (the reference sorts keys recursively before comparing). */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, sorted(v)]),
    )
  }
  return value
}

function expectedHistory() {
  const raw = fixture('daily_range_history_expected.json') as { transactions: Array<Record<string, unknown>> }
  for (const tx of raw.transactions) {
    tx.transaction_time = toInstant(tx.transaction_time as Timed)
    tx.capture_time = toInstant(tx.capture_time as Timed)
  }
  return raw
}

describe('GarantiPosQueryResponseDataMapper', () => {
  it('testSupports', () => {
    expect(GarantiPosQueryResponseDataMapper.supports('GarantiPos')).toBe(true)
    expect(GarantiPosQueryResponseDataMapper.supports('AssecoPos')).toBe(false)
  })

  describe('testMapHistoryResponse', () => {
    it('date_range_history', () => {
      const actual = mapper.mapHistoryResponse(fixture('date_range_history.json'))
      const expected = expectedHistory()

      expect(actual.transactions).toHaveLength(expected.transactions.length)
      for (const [i, tx] of (actual.transactions as Array<Record<string, unknown>>).entries()) {
        const want = expected.transactions[i] as Record<string, unknown>
        expect(tx.transaction_time, `tx: ${i}`).toEqual(want.transaction_time)
        expect(tx.capture_time ?? null, `capture_time tx: ${i}`).toEqual(want.capture_time ?? null)
        tx.transaction_time = undefined
        tx.capture_time = undefined
        want.transaction_time = undefined
        want.capture_time = undefined
      }

      expect(actual).toHaveProperty('all')
      const { all: _all, ...rest } = actual
      expect(sorted(rest)).toEqual(sorted(expected))
    })

    it('single_transaction', () => {
      const actual = mapper.mapHistoryResponse({
        Mode: '',
        Terminal: { ProvUserID: 'PROVAUT', UserID: 'PROVAUT', ID: '30691298', MerchantID: '7000679' },
        Customer: { IPAddress: '172.26.0.1', EmailAddress: '' },
        Order: {
          OrderID: '',
          GroupID: '',
          OrderListInqResult: {
            OrderTxnList: {
              TotalTxnCount: '1',
              TotalPageCount: '1',
              ActPageNum: '1',
              OrderTxn: {
                Id: '1',
                LastTrxDate: null,
                TrxType: null,
                OrderID: 'ORDER123',
                CardNumberMasked: null,
                BatchNum: '576200',
                AuthCode: null,
                RetrefNum: null,
                InstallmentCnt: null,
                AuthAmount: null,
                CurrencyCode: null,
                Status: null,
                ResponseCode: 'E500',
                SysErrMsg: 'System error',
                SafeType: '',
              },
            },
          },
        },
        Transaction: { Response: { Code: 'E500', ErrorMsg: 'System error' } },
      })
      const { all: _all, ...rest } = actual
      expect(rest).toEqual({
        proc_return_code: 'E500',
        error_code: 'E500',
        error_message: 'System error',
        status: 'declined',
        trans_count: 0,
        transactions: [],
      })
    })

    // addition: a single approved transaction arrives as an object, not a list
    it('maps a single approved OrderTxn object', () => {
      const actual = mapper.mapHistoryResponse({
        Transaction: { Response: { Code: '00' } },
        Order: {
          OrderListInqResult: {
            OrderTxnList: {
              OrderTxn: {
                LastTrxDate: '2024-06-03 14:04:19',
                TrxType: 'Satis',
                OrderID: 'O1',
                CardNumberMasked: '42822090****8015',
                BatchNum: '1',
                AuthCode: '1',
                RetrefNum: '2',
                InstallmentCnt: 'Pesin',
                Status: 'Basarili',
                AuthAmount: '1001',
                CurrencyCode: 'TL',
                ResponseCode: '00',
                SafeType: '',
              },
            },
          },
        },
      })
      expect(actual.trans_count).toBe(1)
      expect((actual.transactions as Array<Record<string, unknown>>)[0]).toMatchObject({
        order_id: 'O1',
        first_amount: 10.01,
        capture_amount: 10.01,
        capture: true,
        currency: 'TRY',
        payment_model: 'regular',
        transaction_time: new Date('2024-06-03T14:04:19+03:00'),
      })
    })

    // addition: an approved answer without any order does not crash
    it('returns no transactions when the approved answer lists none', () => {
      const actual = mapper.mapHistoryResponse({ Transaction: { Response: { Code: '00' } } })
      expect(actual.status).toBe('approved')
      expect(actual.trans_count).toBe(0)
      expect(actual.transactions).toEqual([])
    })
  })

  describe('testMapBinListResponse', () => {
    const bin = (over: Record<string, string>) => ({
      BINNum: '415956',
      BankCode: '62',
      BankName: 'T. GARANTİ BANKASI A.Ş.',
      Organization: 'VISA',
      CardType: 'C',
      Group: 'Garanti',
      Product: 'GOLD',
      ...over,
    })
    const row = (b: string, type: string, cls: string) => ({
      bin: b,
      bank_code: '62',
      bank_name: 'T. GARANTİ BANKASI A.Ş.',
      card_type: type,
      card_class: cls,
      card_family: null,
    })

    it.each([
      [
        'success_single_bin',
        { Transaction: { Response: { Code: '00', ErrorMsg: null } }, BINInqResult: { BINList: { BIN: bin({}) } } },
        {
          status: 'approved',
          error_message: null,
          bin_list: [row('415956', CARD_TYPE.VISA, CARD_CLASS.CREDIT)],
        },
      ],
      [
        'success_multiple_bins',
        {
          Transaction: { Response: { Code: '00', ErrorMsg: null } },
          BINInqResult: {
            BINList: {
              BIN: [
                bin({}),
                bin({ BINNum: '530596', Organization: 'MASTERCARD', CardType: 'D', Group: 'Bonus', Product: 'DEBIT' }),
                bin({ BINNum: '900100', Organization: 'MASTERCARD', CardType: 'M', Group: 'Bonus', Product: 'STORE' }),
              ],
            },
          },
        },
        {
          status: 'approved',
          error_message: null,
          bin_list: [
            row('415956', CARD_TYPE.VISA, CARD_CLASS.CREDIT),
            row('530596', CARD_TYPE.MASTERCARD, CARD_CLASS.DEBIT),
            row('900100', CARD_TYPE.MASTERCARD, CARD_CLASS.PREPAID),
          ],
        },
      ],
      [
        'failure',
        { Transaction: { Response: { Code: 'E500', ErrorMsg: 'System error' } } },
        { status: 'declined', error_message: 'System error', bin_list: [] },
      ],
    ])('%s', (_name, raw, expected) => {
      const { all: _all, ...actual } = mapper.mapBinListResponse(raw)
      expect(actual).toEqual(expected)
    })

    // addition: an approved answer without any BIN is an empty list
    it('maps an approved answer without BINs to an empty list', () => {
      const actual = mapper.mapBinListResponse({ Transaction: { Response: { Code: '00' } } })
      expect(actual.status).toBe('approved')
      expect(actual.bin_list).toEqual([])
    })
  })
})
