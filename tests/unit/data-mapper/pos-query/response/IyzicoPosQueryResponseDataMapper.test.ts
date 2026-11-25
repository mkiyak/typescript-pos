import { describe, expect, it, vi } from 'vitest'
import { IyzicoPosQueryResponseDataMapper } from '../../../../../src/data-mapper/pos-query/response/IyzicoPosQueryResponseDataMapper.js'
import { IyzicoPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/IyzicoPosResponseValueFormatter.js'
import { IyzicoPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/IyzicoPosResponseValueMapper.js'
import { UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { CARD_CLASS, CARD_FAMILY, CARD_TYPE } from '../../../../../src/PosInterface.js'

function create() {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const mapper = new IyzicoPosQueryResponseDataMapper(
    new IyzicoPosResponseValueFormatter(),
    new IyzicoPosResponseValueMapper(),
    log,
  )
  return { mapper, log }
}

const sortedKeys = (data: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(data).sort(([a], [b]) => (a < b ? -1 : 1)))

const tx = (extra: Record<string, unknown>) => ({
  transactionType: 'PAYMENT',
  transactionId: 1001,
  transactionStatus: 2,
  threeDS: 1,
  price: 10.01,
  paidPrice: 10.01,
  transactionCurrency: 'TRY',
  installment: '1',
  transactionDate: '2024-05-06 10:00:00',
  ...extra,
})
const history = (transactions: unknown[], extra: Record<string, unknown> = {}) => ({
  status: 'success',
  currentPage: 1,
  totalPageCount: 1,
  transactions,
  ...extra,
})

const PRICES_WITH_BIN = {
  status: 'success',
  locale: 'tr',
  systemTime: 1782903507085,
  conversationId: '6E27274945B4EDF8F024EC0E',
  installmentDetails: [
    {
      binNumber: '54308100',
      price: 100.0,
      cardType: 'CREDIT_CARD',
      cardAssociation: 'MASTER_CARD',
      cardFamilyName: 'Paraf',
      force3ds: 0,
      bankCode: 12,
      bankName: 'Halkbank',
      forceCvc: 0,
      commercial: 0,
      dccEnabled: 0,
      agricultureEnabled: 0,
      installmentPrices: [
        { installmentPrice: 100.0, totalPrice: 100.0, installmentNumber: 1 },
        { installmentPrice: 51.61, totalPrice: 103.22, installmentNumber: 2 },
        { installmentPrice: 35.08, totalPrice: 105.25, installmentNumber: 3 },
        { installmentPrice: 18.7, totalPrice: 112.22, installmentNumber: 6 },
        { installmentPrice: 13.35, totalPrice: 120.19, installmentNumber: 9 },
        { installmentPrice: 10.77, totalPrice: 129.2, installmentNumber: 12 },
      ],
    },
  ],
}

const PRICES_WITHOUT_BIN = {
  status: 'success',
  locale: 'tr',
  systemTime: 1782915155905,
  conversationId: '00B074DD4AC09BD2DAB9DF78',
  installmentDetails: [
    {
      price: 100,
      cardFamilyName: 'Paraf',
      force3ds: 0,
      bankCode: 12,
      bankName: 'Halkbank',
      forceCvc: 0,
      dccEnabled: 0,
      agricultureEnabled: 0,
      installmentPrices: [
        { installmentPrice: 100.0, totalPrice: 100.0, installmentNumber: 1 },
        { installmentPrice: 51.61, totalPrice: 103.22, installmentNumber: 2 },
        { installmentPrice: 35.08, totalPrice: 105.25, installmentNumber: 3 },
      ],
    },
    {
      price: 100,
      cardFamilyName: 'Bonus',
      force3ds: 0,
      bankCode: 134,
      bankName: 'Denizbank',
      forceCvc: 0,
      dccEnabled: 0,
      agricultureEnabled: 0,
      installmentPrices: [
        { installmentPrice: 100.0, totalPrice: 100.0, installmentNumber: 1 },
        { installmentPrice: 51.61, totalPrice: 103.22, installmentNumber: 2 },
      ],
    },
  ],
}

const row = (installment: number, installmentPrice: number, totalPrice: number) => ({
  installment,
  installment_price: installmentPrice,
  total_price: totalPrice,
})

const BIN_ANSWER = {
  status: 'success',
  binNumber: '415956',
  cardType: 'CREDIT_CARD',
  cardAssociation: 'VISA',
  cardFamily: 'Garanti',
  bankName: 'Garanti Bankası',
  bankCode: 62,
}

const detail = (extra: Record<string, unknown>) => ({
  bankCode: 12,
  bankName: 'Halkbank',
  installmentPrices: [{ installmentPrice: 100, totalPrice: 100, installmentNumber: 1 }],
  ...extra,
})
const prices = (installmentDetails: unknown, extra: Record<string, unknown> = {}) => ({
  status: 'success',
  installmentDetails,
  ...extra,
})

describe('IyzicoPosQueryResponseDataMapper', () => {
  it('testSupports', () => {
    expect(IyzicoPosQueryResponseDataMapper.supports('IyzicoPos')).toBe(true)
    expect(IyzicoPosQueryResponseDataMapper.supports('AssecoPos')).toBe(false)
  })

  it('testMapInstallmentRatesResponseThrows', () => {
    expect(() => create().mapper.mapInstallmentRatesResponse({})).toThrow(UnsupportedTransactionTypeError)
  })

  describe('history', () => {
    it.each([
      [
        'failure',
        {
          status: 'failure',
          errorCode: '10000',
          errorMessage: 'System Error',
          currentPage: null,
          totalPageCount: null,
        },
        {
          proc_return_code: 'failure',
          error_code: '10000',
          error_message: 'System Error',
          status: 'declined',
          trans_count: 0,
        },
      ],
      [
        'success_single_payment',
        history([tx({})]),
        { proc_return_code: 'success', error_code: null, error_message: null, status: 'approved', trans_count: 1 },
      ],
      [
        'success_cancel',
        history([
          tx({
            transactionType: 'CANCEL',
            transactionId: 2001,
            threeDS: 0,
            installment: '0',
            transactionStatus: undefined,
          }),
        ]),
        { proc_return_code: 'success', error_code: null, error_message: null, status: 'approved', trans_count: 1 },
      ],
      [
        'declined_payment',
        history([tx({ transactionId: 3001, transactionStatus: 0, threeDS: 0 })]),
        { proc_return_code: 'success', error_code: null, error_message: null, status: 'approved', trans_count: 1 },
      ],
      [
        'success_refund',
        history([
          tx({
            transactionType: 'REFUND',
            transactionId: 4001,
            threeDS: 0,
            installment: '0',
            transactionDate: '2024-05-06 11:00:00',
          }),
        ]),
        { proc_return_code: 'success', error_code: null, error_message: null, status: 'approved', trans_count: 1 },
      ],
    ])('testMapHistoryResponse %s', (_name, raw, expected) => {
      const actual = create().mapper.mapHistoryResponse(raw)
      expect(actual.transactions).toHaveLength(expected.trans_count)
      expect(actual.proc_return_code).toBe(expected.proc_return_code)
      expect(actual.status).toBe(expected.status)
      expect(actual.error_code).toBe(expected.error_code)
      expect(actual.error_message).toBe(expected.error_message)
      expect(Object.hasOwn(actual, 'all')).toBe(true)
    })

    // addition: row details of the reference mapping (types, statuses, models, amounts, times)
    it('maps a payment row', () => {
      const [row0] = create().mapper.mapHistoryResponse(history([tx({})])).transactions as Record<string, unknown>[]
      expect(row0).toMatchObject({
        transaction_type: 'pay',
        status: 'approved',
        capture: true,
        capture_amount: 10.01,
        first_amount: 10.01,
        currency: 'TRY',
        payment_model: '3d',
        installment_count: 0,
        order_status: 'PAYMENT_COMPLETED',
      })
      expect(row0?.transaction_time).toEqual(new Date('2024-05-06T10:00:00+03:00'))
    })

    // addition: cancel, refund and declined rows
    it('maps cancel, refund and declined rows', () => {
      const rows = create().mapper.mapHistoryResponse(
        history([
          tx({ transactionType: 'CANCEL', threeDS: 0 }),
          tx({ transactionType: 'REFUND', threeDS: 0 }),
          tx({ transactionStatus: 0 }),
          tx({ transactionStatus: 1 }),
          tx({ transactionStatus: '2' }),
        ]),
      ).transactions as Record<string, unknown>[]
      expect(rows.map((r) => r.order_status)).toEqual([
        'CANCELED',
        'FULLY_REFUNDED',
        'ERROR',
        'PAYMENT_COMPLETED',
        'ERROR',
      ])
      expect(rows.map((r) => r.status)).toEqual(['approved', 'approved', 'declined', 'approved', 'declined'])
      expect(rows[2]?.capture).toBe(false)
    })

    // addition: rows keep their reference ids for display, as bounded plain text
    it('rows carry the transaction id, authorization code and reference', () => {
      const { mapper } = create()
      const [r] = mapper.mapHistoryResponse(history([tx({ authCode: 'A1', hostReference: 'H1', transactionId: 99 })]))
        .transactions as Record<string, unknown>[]
      expect(r).toMatchObject({ auth_code: 'A1', ref_ret_num: 'H1', transaction_id: '99' })
      const [bad] = mapper.mapHistoryResponse(
        history([tx({ authCode: 'x'.repeat(65), hostReference: { a: 1 }, transactionId: 1.5 })]),
      ).transactions as Record<string, unknown>[]
      expect(bad).toMatchObject({ auth_code: null, ref_ret_num: null, transaction_id: null })
      const [ctl] = mapper.mapHistoryResponse(history([tx({ authCode: 'a\u0000b\n' })])).transactions as Record<
        string,
        unknown
      >[]
      expect(ctl?.auth_code).toBe('ab')
    })

    // addition: the status word is kept exactly as sent, so a padded word is no success
    it('proc_return_code is the untrimmed status word', () => {
      const r = create().mapper.mapHistoryResponse({ status: ' success', transactions: [tx({})] })
      expect(r.proc_return_code).not.toBe('success')
      expect(r.status).toBe('declined')
      expect(create().mapper.mapHistoryResponse({ status: 5 }).proc_return_code).toBeNull()
    })

    // addition: transactions that is not an array lists nothing; non-record entries are skipped
    it('a non-array transactions list is empty and non-records are skipped', () => {
      const { mapper } = create()
      for (const transactions of ['x', { a: 1 }, null, 5]) {
        expect(mapper.mapHistoryResponse({ status: 'success', transactions }).trans_count).toBe(0)
      }
      expect(mapper.mapHistoryResponse(history([null, 'x', 5, [], tx({})])).trans_count).toBe(1)
    })

    // addition: a failure lists no transactions even when the answer carries some
    it('a failure answer lists nothing', () => {
      const r = create().mapper.mapHistoryResponse({ status: 'failure', errorCode: 1, transactions: [tx({})] })
      expect(r.trans_count).toBe(0)
      expect(r.error_code).toBe('1')
    })

    // addition: only the exact word success approves
    it.each([['SUCCESS'], [' success'], ['success '], [1], [true], [['success']], [null], [undefined]])(
      'status %j does not approve',
      (status) => {
        const r = create().mapper.mapHistoryResponse({ status, transactions: [tx({})] })
        expect(r.status).toBe('declined')
        expect(r.trans_count).toBe(0)
      },
    )

    it('an inherited status does not approve', () => {
      const raw = Object.create({ status: 'success' }) as Record<string, unknown>
      expect(create().mapper.mapHistoryResponse(raw).status).toBe('declined')
    })

    // addition: an unreadable time is null and logged by field name only
    it('an unreadable transactionDate is null and warned', () => {
      const { mapper, log } = create()
      const [r] = mapper.mapHistoryResponse(history([tx({ transactionDate: 'x' })])).transactions as Record<
        string,
        unknown
      >[]
      expect(r?.transaction_time).toBeNull()
      expect(log.warn).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(log.warn.mock.calls)).not.toContain('"x"')
    })

    // addition: pages are safe integers, never text
    it('currentPage and totalPageCount are safe integers or null', () => {
      const { mapper } = create()
      const ok = mapper.mapHistoryResponse(history([], { currentPage: 3, totalPageCount: 7 }))
      expect([ok.current_page, ok.total_pages]).toEqual([3, 7])
      for (const bad of ['1', 1.5, -1, Number.NaN, {}, [], true, 2 ** 60]) {
        const r = mapper.mapHistoryResponse(history([], { currentPage: bad, totalPageCount: bad }))
        expect([r.current_page, r.total_pages]).toEqual([null, null])
      }
    })

    // addition: non-scalar values never become "[object Object]"
    it('non-scalar values read as null', () => {
      const [r] = create().mapper.mapHistoryResponse(
        history([
          tx({
            transactionType: { a: 1 },
            price: {},
            paidPrice: [1],
            transactionCurrency: {},
            installment: [1],
            threeDS: {},
            transactionDate: {},
          }),
        ]),
      ).transactions as Record<string, unknown>[]
      expect(JSON.stringify(r)).not.toContain('object')
      expect(r).toMatchObject({
        transaction_type: null,
        first_amount: null,
        capture_amount: null,
        currency: null,
        installment_count: null,
        payment_model: null,
        transaction_time: null,
      })
    })

    // addition: error text is plain and short
    it('the error text loses control characters and is cut', () => {
      const r = create().mapper.mapHistoryResponse({ status: 'failure', errorMessage: `bad\u0000\n${'x'.repeat(400)}` })
      expect(String(r.error_message)).not.toContain('\u0000')
      expect(String(r.error_message)).not.toContain('\n')
      expect(String(r.error_message).length).toBeLessThanOrEqual(256)
    })

    it('an answer that is not an object is a declined, empty report', () => {
      for (const raw of [null, undefined, 'x', 5, []]) {
        const r = create().mapper.mapHistoryResponse(raw as never)
        expect(r.status).toBe('declined')
        expect(r.trans_count).toBe(0)
      }
    })
  })

  describe('installment prices', () => {
    it.each([
      [
        'success_with_bin',
        PRICES_WITH_BIN,
        {
          status: 'approved',
          error_message: null,
          installment_prices: [
            {
              bank_code: 12,
              bank_name: 'Halkbank',
              card_prefix: '54308100',
              card_type: CARD_TYPE.MASTERCARD,
              card_class: CARD_CLASS.CREDIT,
              card_family: CARD_FAMILY.PARAF,
              prices: [
                row(1, 100, 100),
                row(2, 51.61, 103.22),
                row(3, 35.08, 105.25),
                row(6, 18.7, 112.22),
                row(9, 13.35, 120.19),
                row(12, 10.77, 129.2),
              ],
            },
          ],
        },
      ],
      [
        'success_without_bin',
        PRICES_WITHOUT_BIN,
        {
          status: 'approved',
          error_message: null,
          installment_prices: [
            {
              bank_code: 12,
              bank_name: 'Halkbank',
              card_prefix: null,
              card_type: null,
              card_class: null,
              card_family: CARD_FAMILY.PARAF,
              prices: [row(1, 100, 100), row(2, 51.61, 103.22), row(3, 35.08, 105.25)],
            },
            {
              bank_code: 134,
              bank_name: 'Denizbank',
              card_prefix: null,
              card_type: null,
              card_class: null,
              card_family: CARD_FAMILY.BONUS,
              prices: [row(1, 100, 100), row(2, 51.61, 103.22)],
            },
          ],
        },
      ],
      [
        'failure',
        { status: 'failure', errorCode: '10000', errorMessage: 'System Error' },
        { status: 'declined', error_message: 'System Error', installment_prices: [] },
      ],
    ])('testMapInstallmentPricesResponse %s', (_name, raw, expected) => {
      const actual = create().mapper.mapInstallmentPricesResponse(raw)
      expect(actual.all).toEqual(raw)
      const { all: _all, ...rest } = actual
      expect(sortedKeys(rest)).toEqual(sortedKeys(expected))
    })

    // addition: lists that are not arrays and entries that are not records are skipped
    it('skips installmentDetails that is not an array and null entries', () => {
      const { mapper } = create()
      for (const details of ['x', { a: 1 }, null, 5, undefined]) {
        expect(mapper.mapInstallmentPricesResponse(prices(details)).installment_prices).toEqual([])
      }
      expect(
        mapper.mapInstallmentPricesResponse(prices([null, 'x', 5, [], detail({})])).installment_prices,
      ).toHaveLength(1)
    })

    // addition: bank code is a safe integer or digit text of at most four digits
    it('reads the bank code strictly', () => {
      const { mapper } = create()
      const code = (bankCode: unknown) =>
        mapper.mapInstallmentPricesResponse(prices([detail({ bankCode })])).installment_prices[0]?.bank_code
      expect(code('0012')).toBe(12)
      expect(code('x')).toBeNull()
      expect(code(12.5)).toBeNull()
      expect(code(-1)).toBeNull()
      expect(code('12345')).toBeNull()
      expect(code({})).toBeNull()
      expect(code(2 ** 60)).toBeNull()
    })

    // addition: card prefix is own 6 or 8 digit text
    it('reads the card prefix strictly', () => {
      const { mapper } = create()
      const prefix = (binNumber: unknown) =>
        mapper.mapInstallmentPricesResponse(prices([detail({ binNumber })])).installment_prices[0]?.card_prefix
      expect(prefix('415956')).toBe('415956')
      expect(prefix('41595678')).toBe('41595678')
      for (const bad of ['4159', '4159567', 415956, {}, 'abcdef', ['415956']]) expect(prefix(bad)).toBeNull()
    })

    // addition: prices are sorted by installment, text amounts are accepted, malformed entries are dropped and warned
    it('sorts, accepts decimal text and drops malformed entries', () => {
      const { mapper, log } = create()
      const result = mapper.mapInstallmentPricesResponse(
        prices([
          detail({
            installmentPrices: [
              { installmentPrice: 35.08, totalPrice: 105.25, installmentNumber: 3 },
              { installmentPrice: '51.61', totalPrice: '103.22', installmentNumber: '2' },
              { installmentPrice: 1, totalPrice: 1, installmentNumber: 13 },
              { installmentPrice: 1, totalPrice: 1, installmentNumber: 0 },
              { installmentPrice: 1, totalPrice: 1, installmentNumber: 'x' },
              { installmentPrice: -1, totalPrice: 1, installmentNumber: 4 },
              { installmentPrice: 1, totalPrice: -1, installmentNumber: 4 },
              { installmentPrice: 1, totalPrice: 'abc', installmentNumber: 4 },
              { installmentPrice: Number.NaN, totalPrice: 1, installmentNumber: 5 },
              { installmentPrice: 1e13, totalPrice: 1, installmentNumber: 5 },
              { installmentPrice: {}, totalPrice: 1, installmentNumber: 5 },
              { installmentPrice: 1, totalPrice: 1, installmentNumber: 2.5 },
              null,
              'x',
              { installmentPrice: 100, totalPrice: 100, installmentNumber: 1 },
            ],
          }),
        ]),
      )
      expect(result.installment_prices[0]?.prices).toEqual([
        row(1, 100, 100),
        row(2, 51.61, 103.22),
        row(3, 35.08, 105.25),
      ])
      expect(log.warn).toHaveBeenCalled()
      expect(JSON.stringify(log.warn.mock.calls)).not.toContain('abc')
    })

    // addition: two plans with the same installment number are both kept, in the order sent
    it('keeps duplicate installment numbers in a stable order', () => {
      const r = create().mapper.mapInstallmentPricesResponse(
        prices([
          detail({
            installmentPrices: [
              { installmentPrice: 2, totalPrice: 4, installmentNumber: 2 },
              { installmentPrice: 3, totalPrice: 6, installmentNumber: 2 },
              { installmentPrice: 1, totalPrice: 1, installmentNumber: 1 },
            ],
          }),
        ]),
      )
      expect(r.installment_prices[0]?.prices).toEqual([row(1, 1, 1), row(2, 2, 4), row(2, 3, 6)])
    })

    // addition: amounts stay exact (the text they were written with), not an eight-decimal binary expansion
    it('keeps amounts exact', () => {
      const result = create().mapper.mapInstallmentPricesResponse(
        prices([
          detail({
            installmentPrices: [
              { installmentPrice: 91184819.71, totalPrice: 10.209999999999999, installmentNumber: 1 },
            ],
          }),
        ]),
      )
      expect(result.installment_prices[0]?.prices).toEqual([row(1, 91184819.71, 10.21)])
    })

    // addition: texts are short, plain and never objects
    it('item texts are at most 64 characters', () => {
      const { mapper } = create()
      const r = mapper.mapInstallmentPricesResponse(
        prices([
          detail({ bankName: 'x'.repeat(65), cardFamilyName: {}, cardType: 'CREDIT_CARD', cardAssociation: ['VISA'] }),
        ]),
      ).installment_prices[0]
      expect(r).toMatchObject({ bank_name: null, card_family: null, card_class: CARD_CLASS.CREDIT, card_type: null })
    })

    // addition: only the exact word success approves
    it('a status other than success does not list prices', () => {
      for (const status of ['SUCCESS', ' success', 1, true, null]) {
        const r = create().mapper.mapInstallmentPricesResponse(prices([detail({})], { status }))
        expect(r.status).toBe('declined')
        expect(r.installment_prices).toEqual([])
      }
    })
  })

  describe('BIN list', () => {
    it.each([
      [
        'success_credit_visa',
        BIN_ANSWER,
        {
          status: 'approved',
          error_message: null,
          bin_list: [
            {
              bin: '415956',
              bank_code: '62',
              bank_name: 'Garanti Bankası',
              card_type: CARD_TYPE.VISA,
              card_class: CARD_CLASS.CREDIT,
              card_family: 'Garanti',
            },
          ],
        },
      ],
      [
        'success_debit_mastercard',
        {
          ...BIN_ANSWER,
          binNumber: '530596',
          cardType: 'DEBIT_CARD',
          cardAssociation: 'MASTER_CARD',
          cardFamily: 'Bonus',
        },
        {
          status: 'approved',
          error_message: null,
          bin_list: [
            {
              bin: '530596',
              bank_code: '62',
              bank_name: 'Garanti Bankası',
              card_type: CARD_TYPE.MASTERCARD,
              card_class: CARD_CLASS.DEBIT,
              card_family: CARD_FAMILY.BONUS,
            },
          ],
        },
      ],
      [
        'failure',
        { status: 'failure', errorCode: 'BIN001', errorMessage: 'BIN not found' },
        { status: 'declined', error_message: 'BIN not found', bin_list: [] },
      ],
    ])('testMapBinListResponse %s', (_name, raw, expected) => {
      const actual = create().mapper.mapBinListResponse(raw)
      expect(actual.all).toEqual(raw)
      const { all: _all, ...rest } = actual
      expect(rest).toEqual(expected)
    })

    // addition: item text longer than 64 is null; bank code is a safe integer or digit text
    it('reads item fields strictly', () => {
      const { mapper } = create()
      const item = (extra: Record<string, unknown>) =>
        mapper.mapBinListResponse({ ...BIN_ANSWER, ...extra }).bin_list[0]
      expect(item({ bankName: 'x'.repeat(65) })?.bank_name).toBeNull()
      expect(item({ bankName: 'x'.repeat(64) })?.bank_name).toBe('x'.repeat(64))
      expect(item({ bankCode: '0062' })?.bank_code).toBe('0062')
      expect(item({ bankCode: 'x' })?.bank_code).toBeNull()
      expect(item({ bankCode: 6.5 })?.bank_code).toBeNull()
      expect(item({ bankCode: -1 })?.bank_code).toBeNull()
      expect(item({ bankCode: {} })?.bank_code).toBeNull()
      expect(item({ binNumber: { a: 1 }, bankName: [1], cardFamily: {} })).toMatchObject({
        bin: null,
        bank_name: null,
        card_family: null,
      })
      expect(item({ cardAssociation: 'UNKNOWN', cardType: 'UNKNOWN' })).toMatchObject({
        card_type: null,
        card_class: null,
      })
    })

    // addition: only the exact word success approves
    it('a status other than success has no BIN record', () => {
      for (const status of ['SUCCESS', ' success', 1, true, null, undefined]) {
        const r = create().mapper.mapBinListResponse({ ...BIN_ANSWER, status })
        expect(r.status).toBe('declined')
        expect(r.bin_list).toEqual([])
      }
    })

    it('an answer that is not an object is declined', () => {
      for (const raw of [null, 'x', 5, []]) {
        expect(create().mapper.mapBinListResponse(raw as never).status).toBe('declined')
      }
    })
  })
})
