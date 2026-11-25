import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { ParamPosQueryResponseDataMapper } from '../../../../../src/data-mapper/pos-query/response/ParamPosQueryResponseDataMapper.js'
import { ParamPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/ParamPosResponseValueFormatter.js'
import { ParamPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/ParamPosResponseValueMapper.js'
import { UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { noopLogger } from '../../../../../src/logger.js'
import { CARD_CLASS, CARD_FAMILY, CARD_TYPE } from '../../../../../src/PosInterface.js'

type Raw = Record<string, unknown>

function create(logger = noopLogger) {
  return new ParamPosQueryResponseDataMapper(
    new ParamPosResponseValueFormatter(),
    new ParamPosResponseValueMapper(),
    logger,
  )
}
const mapper = create()

const fixture = (name: string): Raw =>
  JSON.parse(readFileSync(new URL(`../../../test_data/parampos/${name}`, import.meta.url), 'utf8')) as Raw

const dataSet = (resultName: string, responseName: string, result: Raw): Raw => ({
  [responseName]: { '@xmlns': 'https://turkpos.com.tr/', [resultName]: result },
})

const ratesAnswer = (rows: unknown, over: Raw = {}): Raw =>
  dataSet('TP_Ozel_Oran_SK_ListeResult', 'TP_Ozel_Oran_SK_ListeResponse', {
    Sonuc: '1',
    Sonuc_Str: 'Başarılı',
    DT_Bilgi: { 'diffgr:diffgram': { NewDataSet: { DT_Ozel_Oranlar_SK: rows } } },
    ...over,
  })

const rateRow = (over: Raw = {}): Raw => ({
  Ozel_Oran_SK_ID: '849809',
  Kredi_Karti_Banka: 'Axess',
  MO_01: '1.1900',
  MO_02: '-2.0000',
  MO_03: '6.6200',
  MO_04: '-2.0000',
  MO_05: '-2.0000',
  MO_06: '10.5000',
  MO_07: '-2.0000',
  MO_08: '-2.0000',
  MO_09: '0.0000',
  MO_10: '-2.0000',
  MO_11: '-2.0000',
  MO_12: '0.0000',
  ...over,
})

const FOUR_RATES = [
  { installment: 3, rate: 6.62, constant: 0 },
  { installment: 6, rate: 10.5, constant: 0 },
  { installment: 9, rate: 0, constant: 0 },
  { installment: 12, rate: 0, constant: 0 },
]

const group = (family: string | null, rates: unknown[] = FOUR_RATES) => ({
  bank_code: null,
  bank_name: null,
  card_prefix: null,
  card_type: null,
  card_class: null,
  card_family: family,
  rates,
})

const binAnswer = (rows: unknown, over: Raw = {}): Raw =>
  dataSet('BIN_SanalPosResult', 'BIN_SanalPosResponse', {
    Sonuc: 1,
    Sonuc_Str: 'Basarili',
    DT_Bilgi: { 'diffgr:diffgram': { NewDataSet: { Temp: rows } } },
    ...over,
  })

const binRow = (over: Raw = {}): Raw => ({
  BIN: '415956',
  Banka_Kodu: '62',
  Kart_Banka: 'Garanti Bankası',
  Kart_Org: 'VISA',
  Kart_Tip: 'Kredi Kartı',
  ...over,
})

const bin415956 = {
  bin: '415956',
  bank_code: '62',
  bank_name: 'Garanti Bankası',
  card_type: CARD_TYPE.VISA,
  card_class: CARD_CLASS.CREDIT,
  card_family: null,
}

const historyAnswer = (rows: unknown, result: Raw = {}): Raw =>
  dataSet('TP_Islem_IzlemeResult', 'TP_Islem_IzlemeResponse', {
    Sonuc: '1',
    Sonuc_Str: 'Başarılı',
    DT_Bilgi: { 'diffgr:diffgram': { NewDataSet: { Temp: rows } } },
    ...result,
  })

const historyRow = (over: Raw = {}): Raw => ({
  Sonuc: '1',
  Sonuc_Str: 'Başarılı',
  Tip_Str: 'Satış',
  Tarih: '2025-01-20T09:10:48.8+03:00',
  Tutar: '12.5000',
  Toplam_Iade_Tutar: '0.0000',
  Islem_Guvenlik: 'NONSECURE',
  ORJ_ORDER_ID: 'order-1',
  PB: 'TRL',
  ...over,
})

describe('ParamPosQueryResponseDataMapper', () => {
  it('testSupports', () => {
    expect(ParamPosQueryResponseDataMapper.supports('ParamPos')).toBe(true)
    expect(ParamPosQueryResponseDataMapper.supports('AssecoPos')).toBe(false)
    // addition: the hosted-page gateway has no query class
    expect(ParamPosQueryResponseDataMapper.supports('Param3DHostPos')).toBe(false)
  })

  describe('testMapInstallmentRatesResponse', () => {
    it('success_multiple_card_programs', () => {
      const raw = ratesAnswer([rateRow(), rateRow({ Ozel_Oran_SK_ID: '849805', Kredi_Karti_Banka: 'World' })])
      const actual = mapper.mapInstallmentRatesResponse(raw)

      expect(actual.all).toBe(raw)
      const { all: _all, ...rest } = actual
      expect(rest).toEqual({
        status: 'approved',
        error_message: null,
        installment_rates: [group(CARD_FAMILY.AXESS), group(CARD_FAMILY.WORLD)],
      })
    })

    it('success_single_card_program', () => {
      // a single item is decoded as a record, not a list of records
      const raw = ratesAnswer(rateRow({ Ozel_Oran_SK_ID: '849808', Kredi_Karti_Banka: 'Bonus' }))
      const actual = mapper.mapInstallmentRatesResponse(raw)

      expect(actual.all).toBe(raw)
      const { all: _all, ...rest } = actual
      expect(rest).toEqual({
        status: 'approved',
        error_message: null,
        installment_rates: [group(CARD_FAMILY.BONUS)],
      })
    })

    it('failed', () => {
      const raw = dataSet('TP_Ozel_Oran_SK_ListeResult', 'TP_Ozel_Oran_SK_ListeResponse', {
        Sonuc: '-1',
        Sonuc_Str: 'Geçersiz GUID!',
      })
      const actual = mapper.mapInstallmentRatesResponse(raw)

      expect(actual.all).toBe(raw)
      const { all: _all, ...rest } = actual
      expect(rest).toEqual({ status: 'declined', error_message: 'Geçersiz GUID!', installment_rates: [] })
    })
  })

  describe('testMapHistoryResponse', () => {
    it('failed_negative_return_code', () => {
      const raw = dataSet('TP_Islem_IzlemeResult', 'TP_Islem_IzlemeResponse', { Sonuc: '-1', Sonuc_Str: 'Başarısız' })
      const actual = mapper.mapHistoryResponse(raw)

      expect(actual.transactions).toHaveLength(0)
      // deviation: C7 codes are text
      expect(actual.proc_return_code).toBe('-1')
      expect(actual.status).toBe('declined')
      expect(actual).toHaveProperty('all')
    })

    it('success', () => {
      const raw = fixture('history_response_1.json')
      const expected = fixture('history_response_1_expected.json')
      const actual = mapper.mapHistoryResponse(raw)

      expect(actual.transactions).toHaveLength(expected.trans_count as number)
      // deviation: C7 codes are text
      expect(actual.proc_return_code).toBe(String(expected.proc_return_code))
      expect(actual.status).toBe('approved')
      expect(actual).toHaveProperty('all')
    })
  })

  describe('testMapBinListResponse', () => {
    it('success_single_bin', () => {
      const raw = binAnswer({
        BIN: '415956',
        Banka_Kodu: '62',
        Kart_Banka: 'Garanti Bankası',
        Kart_Org: 'VISA',
        Kart_Tip: 'Kredi Kartı',
      })
      const { all, ...rest } = mapper.mapBinListResponse(raw)

      expect(all).toBe(raw)
      expect(rest).toEqual({ status: 'approved', error_message: null, bin_list: [bin415956] })
    })

    it('success_multiple_bins', () => {
      const raw = binAnswer([
        { BIN: '415956', Banka_Kodu: '62', Kart_Banka: 'Garanti Bankası', Kart_Org: 'VISA', Kart_Tip: 'Kredi Kartı' },
        { BIN: '530596', Banka_Kodu: '62', Kart_Banka: 'Garanti Bankası', Kart_Org: 'MASTER', Kart_Tip: 'Debit Kart' },
      ])
      const { all, ...rest } = mapper.mapBinListResponse(raw)

      expect(all).toBe(raw)
      expect(rest).toEqual({
        status: 'approved',
        error_message: null,
        bin_list: [
          bin415956,
          {
            bin: '530596',
            bank_code: '62',
            bank_name: 'Garanti Bankası',
            card_type: CARD_TYPE.MASTERCARD,
            card_class: CARD_CLASS.DEBIT,
            card_family: null,
          },
        ],
      })
    })

    it('failure', () => {
      const raw = dataSet('BIN_SanalPosResult', 'BIN_SanalPosResponse', { Sonuc: -1, Sonuc_Str: 'Hata oluştu' })
      const { all, ...rest } = mapper.mapBinListResponse(raw)

      expect(all).toBe(raw)
      expect(rest).toEqual({ status: 'declined', error_message: 'Hata oluştu', bin_list: [] })
    })
  })

  describe('additions', () => {
    describe('installment rates', () => {
      const rates = (raw: Raw) => mapper.mapInstallmentRatesResponse(raw)

      // addition: the bank prints a comma where a dot is expected; such a value is dropped, never guessed
      it.each([
        ['a comma decimal', '6,62'],
        ['a record', {}],
        ['a list', ['6.62']],
        ['padded text', ' 6.62'],
        ['an exponent', '1e2'],
        ['a plus sign', '+6.62'],
        ['too many integer digits', '1234567.00'],
        ['too many decimals', '1.1234567'],
        ['a number', 6.62],
        ['a boolean', true],
        // deviation: an empty rate text is dropped like any unreadable value (it is not read as a zero rate)
        ['empty text', ''],
      ])('drops an installment whose rate is %s', (_name, value) => {
        const result = rates(ratesAnswer(rateRow({ MO_03: value })))

        expect(result.status).toBe('approved')
        expect(result.installment_rates[0]?.rates.map((r) => r.installment)).toEqual([6, 9, 12])
      })

      it('warns with the key only when a value is dropped', () => {
        const warn = vi.fn()
        const logging = create({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() } as never)
        logging.mapInstallmentRatesResponse(ratesAnswer(rateRow({ MO_03: '6,62 secret-looking' })))

        expect(warn).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(warn.mock.calls)).toContain('MO_03')
        expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-looking')
      })

      it('skips negative rates and never reads MO_01', () => {
        const result = rates(
          ratesAnswer(rateRow({ MO_01: '9.9000', MO_02: '-0.0100', MO_03: '2.5000', MO_06: '-1', MO_09: '-5.5' })),
        )
        expect(result.installment_rates[0]?.rates.map((r) => r.installment)).toEqual([3, 12])
      })

      it('reads a negative zero as zero', () => {
        const result = rates(ratesAnswer(rateRow({ MO_03: '-0.0000', MO_06: '-0' })))
        const found = result.installment_rates[0]?.rates ?? []
        expect(found.find((r) => r.installment === 3)).toEqual({ installment: 3, rate: 0, constant: 0 })
        expect(Object.is(found.find((r) => r.installment === 3)?.rate, -0)).toBe(false)
      })

      it('ignores the keys of any other shape', () => {
        const result = rates(
          ratesAnswer(rateRow({ MO_13: '5.0000', MO_00: '5.0000', MO__3: '5.0000', mo_03: '1', MO_3: '2' })),
        )
        expect(result.installment_rates[0]?.rates.map((r) => r.installment)).toEqual([3, 6, 9, 12])
      })

      it('does not read inherited rate keys', () => {
        const row = Object.create({ MO_05: '3.0000' }) as Raw
        Object.assign(row, { Kredi_Karti_Banka: 'World', MO_03: '1.0000' })
        const result = rates(ratesAnswer(row))
        expect(result.installment_rates[0]?.rates).toEqual([{ installment: 3, rate: 1, constant: 0 }])
      })

      it('drops groups without rates', () => {
        const none = rateRow({ Kredi_Karti_Banka: 'Maximum' })
        for (const key of Object.keys(none)) if (key.startsWith('MO_')) none[key] = '-2.0000'
        const result = rates(ratesAnswer([none, rateRow({ Kredi_Karti_Banka: 'World' })]))
        expect(result.installment_rates.map((g) => g.card_family)).toEqual([CARD_FAMILY.WORLD])
      })

      it('no rates at all is an approved empty list', () => {
        const result = rates(ratesAnswer([]))
        expect(result).toMatchObject({ status: 'approved', installment_rates: [], error_message: null })
        expect(rates(ratesAnswer(undefined)).installment_rates).toEqual([])
        expect(rates(ratesAnswer('')).installment_rates).toEqual([])
      })

      it('an empty card family name is no family', () => {
        expect(rates(ratesAnswer(rateRow({ Kredi_Karti_Banka: '' }))).installment_rates[0]?.card_family).toBeNull()
        expect(rates(ratesAnswer(rateRow({ Kredi_Karti_Banka: '  ' }))).installment_rates[0]?.card_family).toBeNull()
        expect(rates(ratesAnswer(rateRow({ Kredi_Karti_Banka: {} }))).installment_rates[0]?.card_family).toBeNull()
        expect(
          rates(ratesAnswer(rateRow({ Kredi_Karti_Banka: ['World'] }))).installment_rates[0]?.card_family,
        ).toBeNull()
      })

      it('skips rows that are not records', () => {
        const result = rates(ratesAnswer([null, 5, 'x', ['MO_03'], rateRow()]))
        expect(result.installment_rates).toHaveLength(1)
      })

      it('Sonuc as a number is accepted; other kinds are no success', () => {
        expect(rates(ratesAnswer(rateRow(), { Sonuc: 1 })).status).toBe('approved')
        for (const sonuc of ['0', 0, ' 1', '1.0', '', null, undefined, ['1'], {}, true, '1e0', '+1']) {
          const result = rates(ratesAnswer(rateRow(), { Sonuc: sonuc }))
          expect(result.status).toBe('declined')
          expect(result.installment_rates).toEqual([])
        }
      })

      it('a declined answer keeps a bounded text message', () => {
        const long = 'x'.repeat(300)
        const result = rates(ratesAnswer(rateRow(), { Sonuc: '-5', Sonuc_Str: long }))
        expect(result.error_message).toBe('x'.repeat(256))
        expect(rates(ratesAnswer(rateRow(), { Sonuc: '-5', Sonuc_Str: { a: 1 } })).error_message).toBeNull()
        expect(rates(ratesAnswer(rateRow(), { Sonuc: '-5', Sonuc_Str: '' })).error_message).toBeNull()
      })

      it.each([[null], [undefined], [[]], ['text'], [{}], [{ TP_Ozel_Oran_SK_ListeResponse: [] }]])(
        'an unreadable answer %j is declined, never a throw',
        (raw) => {
          const result = rates(raw as Raw)
          expect(result.status).toBe('declined')
          expect(result.installment_rates).toEqual([])
        },
      )

      it('does not read an inherited result', () => {
        const raw = Object.create({
          TP_Ozel_Oran_SK_ListeResponse: { TP_Ozel_Oran_SK_ListeResult: { Sonuc: '1' } },
        }) as Raw
        expect(rates(raw).status).toBe('declined')
      })

      it('the installment prices query is not offered', () => {
        expect(() => mapper.mapInstallmentPricesResponse({})).toThrow(UnsupportedTransactionTypeError)
      })

      it('removes an echoed merchant key from the returned raw answer', () => {
        const raw = ratesAnswer(rateRow(), { TURKPOS_RETVAL_GUID: 'secret-guid', GUID: 'secret-guid' })
        const result = rates(raw)
        expect(JSON.stringify(result)).not.toContain('secret-guid')
        // the caller's own object is not altered
        expect(JSON.stringify(raw)).toContain('secret-guid')
      })
    })

    describe('bin list', () => {
      const bins = (raw: Raw) => mapper.mapBinListResponse(raw)

      it('Sonuc as text is accepted', () => {
        expect(bins(binAnswer(binRow(), { Sonuc: '1' })).status).toBe('approved')
        expect(bins(binAnswer(binRow(), { Sonuc: '1' })).bin_list).toEqual([bin415956])
      })

      it('an item with an object value reads that field as null', () => {
        const result = bins(binAnswer(binRow({ Kart_Banka: { x: 1 }, Banka_Kodu: ['62'], BIN: {} })))
        expect(result.bin_list).toEqual([
          {
            bin: null,
            bank_code: null,
            bank_name: null,
            card_type: CARD_TYPE.VISA,
            card_class: CARD_CLASS.CREDIT,
            card_family: null,
          },
        ])
      })

      it('item strings are own text of at most 64 characters, else null', () => {
        const result = bins(binAnswer(binRow({ Kart_Banka: 'b'.repeat(64), Banka_Kodu: 'c'.repeat(65), BIN: 415956 })))
        expect(result.bin_list[0]).toMatchObject({ bank_name: 'b'.repeat(64), bank_code: null, bin: null })
      })

      it('unknown card words read as null', () => {
        const result = bins(binAnswer(binRow({ Kart_Org: 'UNKNOWN', Kart_Tip: 'Başka' })))
        expect(result.bin_list[0]).toMatchObject({ card_type: null, card_class: null })
      })

      it('skips rows that are not records', () => {
        const result = bins(binAnswer([null, 5, 'x', ['BIN'], binRow()]))
        expect(result.bin_list).toEqual([bin415956])
      })

      it('no row is an approved empty list', () => {
        expect(bins(binAnswer([]))).toMatchObject({ status: 'approved', bin_list: [] })
        expect(bins(binAnswer(undefined))).toMatchObject({ status: 'approved', bin_list: [] })
      })

      it('a failure keeps a bounded text message and no list', () => {
        const result = bins(binAnswer(binRow(), { Sonuc: '-3', Sonuc_Str: 'y'.repeat(300) }))
        expect(result).toMatchObject({ status: 'declined', error_message: 'y'.repeat(256), bin_list: [] })
      })

      it.each([[null], [{}], ['x'], [{ BIN_SanalPosResponse: 'x' }]])('an unreadable answer %j is declined', (raw) => {
        expect(bins(raw as Raw)).toMatchObject({ status: 'declined', bin_list: [] })
      })

      it('a code that is not an integer is no success', () => {
        for (const sonuc of ['1.5', '01x', ' 1', '0', 0, -1, null, true, ['1'], '1234567890']) {
          expect(bins(binAnswer(binRow(), { Sonuc: sonuc })).status).toBe('declined')
        }
      })
    })

    describe('history', () => {
      const history = (raw: Raw) => mapper.mapHistoryResponse(raw)
      const asDate = (value: { date: string; timezone: string }) =>
        new Date(`${value.date.replace(' ', 'T').slice(0, 23)}${value.timezone}`)

      // addition: the whole expected file, codes become text (C7)
      it('maps the full fixture like the expected file', () => {
        const raw = fixture('history_response_1.json')
        const expected = fixture('history_response_1_expected.json') as {
          proc_return_code: number
          error_code: null
          error_message: null
          status: string
          trans_count: number
          transactions: Array<Record<string, unknown>>
        }
        const actual = history(raw)

        expect(actual).toMatchObject({
          proc_return_code: String(expected.proc_return_code),
          error_code: expected.error_code,
          error_message: expected.error_message,
          status: expected.status,
          trans_count: expected.trans_count,
        })
        expect(actual.all).toBe(raw)

        const wanted = expected.transactions.map((tx) => {
          const copy: Record<string, unknown> = { ...tx }
          for (const key of ['proc_return_code', 'error_code']) {
            if (copy[key] !== null) copy[key] = String(copy[key])
          }
          for (const key of ['transaction_time', 'capture_time']) {
            if (copy[key] !== null) copy[key] = asDate(copy[key] as { date: string; timezone: string })
          }
          return copy
        })
        expect(actual.transactions).toEqual(wanted)
      })

      it('lists the newest record first', () => {
        const result = history(
          historyAnswer([
            historyRow({ ORJ_ORDER_ID: 'first' }),
            historyRow({ ORJ_ORDER_ID: 'second' }),
            historyRow({ ORJ_ORDER_ID: 'third' }),
          ]),
        )
        expect((result.transactions as Raw[]).map((t) => t.order_id)).toEqual(['third', 'second', 'first'])
      })

      it('a single Temp record is one transaction', () => {
        // deviation: a single item is decoded as a record, the loop must not iterate its fields
        const result = history(historyAnswer(historyRow()))
        expect(result).toMatchObject({ status: 'approved', trans_count: 1, proc_return_code: '1' })
        expect((result.transactions as Raw[])[0]).toMatchObject({
          order_id: 'order-1',
          transaction_type: 'pay',
          first_amount: 12.5,
          capture_amount: 12.5,
          capture: true,
          currency: 'TRY',
          payment_model: 'regular',
          status: 'approved',
          proc_return_code: '1',
          error_code: null,
        })
      })

      it('skips items that are not records', () => {
        const result = history(historyAnswer([null, 5, 'x', ['a'], historyRow()]))
        expect(result.trans_count).toBe(1)
      })

      it('an approved answer without data has no transactions', () => {
        const noData = dataSet('TP_Islem_IzlemeResult', 'TP_Islem_IzlemeResponse', {
          Sonuc: '1',
          Sonuc_Str: 'Başarılı',
        })
        expect(history(noData)).toMatchObject({ status: 'approved', trans_count: 0, transactions: [] })
        expect(history(historyAnswer(undefined))).toMatchObject({ status: 'approved', trans_count: 0 })
        expect(history(historyAnswer(''))).toMatchObject({ status: 'approved', trans_count: 0 })
      })

      it('a declined answer carries the code and the bank text and no transactions', () => {
        const result = history(historyAnswer([historyRow()], { Sonuc: '-1', Sonuc_Str: 'Başarısız' }))
        expect(result).toMatchObject({
          status: 'declined',
          proc_return_code: '-1',
          error_code: '-1',
          error_message: 'Başarısız',
          trans_count: 0,
          transactions: [],
        })
      })

      it('an unreadable code is no success and keeps no code', () => {
        for (const sonuc of ['1.0', ' 1', 'x', '', null, ['1'], {}, true, '1e0', '0', '1234567890']) {
          const result = history(historyAnswer([historyRow()], { Sonuc: sonuc }))
          expect(result.status).toBe('declined')
          expect(result.transactions).toEqual([])
          if (typeof sonuc !== 'string' || sonuc !== '0') expect(result.proc_return_code).toBeNull()
        }
      })

      it.each([[null], [undefined], [[]], ['text'], [{}], [{ TP_Islem_IzlemeResponse: [] }]])(
        'an unreadable answer %j is declined, never a throw',
        (raw) => {
          expect(history(raw as Raw)).toMatchObject({ status: 'declined', trans_count: 0, transactions: [] })
        },
      )

      it('a declined record keeps its code and text and no amounts', () => {
        const result = history(
          historyAnswer([historyRow({ Sonuc: '-2', Sonuc_Str: 'Red', Tutar: '100.0000', PB: 'TRL' })]),
        )
        expect((result.transactions as Raw[])[0]).toMatchObject({
          status: 'declined',
          proc_return_code: '-2',
          error_code: '-2',
          error_message: 'Red',
          first_amount: null,
          capture_amount: null,
          capture: null,
          currency: null,
        })
      })

      it('a record with a code that is not an integer is declined', () => {
        for (const sonuc of ['1.0', ' 1', 'x', '', 1.5, true, ['1'], undefined]) {
          const result = history(historyAnswer([historyRow({ Sonuc: sonuc })]))
          expect((result.transactions as Raw[])[0]).toMatchObject({ status: 'declined', proc_return_code: null })
        }
      })

      it('cancel and refund records map their words', () => {
        const result = history(
          historyAnswer([
            historyRow({ Tip_Str: 'İptal', Tutar: '-5.0000' }),
            historyRow({ Tip_Str: 'İade', Tutar: '-2.0000', Toplam_Iade_Tutar: '2.5000' }),
            historyRow({ Tip_Str: 'Başka' }),
          ]),
        )
        const [other, refund, cancel] = result.transactions as Raw[]
        expect(cancel).toMatchObject({ transaction_type: 'cancel', first_amount: null, refund_amount: null })
        expect(refund).toMatchObject({ transaction_type: 'refund', refund_amount: 2.5 })
        expect(other).toMatchObject({ transaction_type: null, status: 'approved' })
      })

      it('an unreadable amount or time reads as null without failing the record', () => {
        const warn = vi.fn()
        const logging = create({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() } as never)
        const result = logging.mapHistoryResponse(
          historyAnswer([historyRow({ Tutar: '1,000.50', Tarih: 'yesterday', Toplam_Iade_Tutar: '-1' })]),
        )
        expect((result.transactions as Raw[])[0]).toMatchObject({
          status: 'approved',
          first_amount: null,
          capture_amount: null,
          transaction_time: null,
          capture_time: null,
        })
        expect(JSON.stringify(warn.mock.calls)).not.toContain('1,000.50')
        expect(JSON.stringify(warn.mock.calls)).not.toContain('yesterday')
      })

      it('time zone, currency and security words come from the tables', () => {
        const result = history(
          historyAnswer([
            historyRow({ Tarih: '5.01.2025 14:52:20', PB: 'USD', Islem_Guvenlik: '3D' }),
            historyRow({ PB: 'XYZ', Islem_Guvenlik: 'MAYBE' }),
            historyRow({ PB: undefined, Islem_Guvenlik: undefined }),
          ]),
        )
        const [none, unknown, usd] = result.transactions as Raw[]
        expect(usd).toMatchObject({ currency: 'USD', payment_model: '3d' })
        expect(unknown).toMatchObject({ currency: null, payment_model: null })
        expect(none).toMatchObject({ currency: null, payment_model: null })
      })

      it('non-scalar record values never become text', () => {
        const result = history(
          historyAnswer([historyRow({ ORJ_ORDER_ID: { a: 1 }, Sonuc_Str: ['x'], Tip_Str: {}, Tutar: {} })]),
        )
        const tx = (result.transactions as Raw[])[0] as Raw
        expect(tx.order_id).toBeNull()
        expect(tx.transaction_type).toBeNull()
        expect(JSON.stringify(tx)).not.toContain('[object Object]')
      })

      it('removes an echoed merchant key from the returned raw answer', () => {
        const raw = historyAnswer([historyRow()], { TURKPOS_RETVAL_GUID: 'secret-guid' })
        expect(JSON.stringify(history(raw))).not.toContain('secret-guid')
      })

      it('never reports a record as a payment confirmation field', () => {
        // history lists records only: nothing in its result is an order-bound approval
        const result = history(historyAnswer([historyRow()]))
        expect(result).not.toHaveProperty('requires_manual_review')
        expect(result).not.toHaveProperty('payment_status')
      })
    })
  })
})
