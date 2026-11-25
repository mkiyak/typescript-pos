import { describe, expect, it, vi } from 'vitest'
import { PayTrPosQueryResponseDataMapper } from '../../../../../src/data-mapper/pos-query/response/PayTrPosQueryResponseDataMapper.js'
import { PayTrPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/PayTrPosResponseValueFormatter.js'
import { PayTrPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/PayTrPosResponseValueMapper.js'
import { UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import type { PosLogger } from '../../../../../src/logger.js'
import { CARD_CLASS, CARD_FAMILY, CARD_TYPE } from '../../../../../src/PosInterface.js'

function create(logger?: PosLogger) {
  const log = logger ?? { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const mapper = new PayTrPosQueryResponseDataMapper(
    new PayTrPosResponseValueFormatter(),
    new PayTrPosResponseValueMapper(),
    log,
  )
  return { mapper, log: log as { warn: ReturnType<typeof vi.fn> } }
}

const RATE_ROW = {
  taksit_2: 7.28,
  taksit_3: 9.32,
  taksit_4: 11.35,
  taksit_5: 13.4,
  taksit_6: 15.43,
  taksit_7: 17.46,
  taksit_8: 19.5,
  taksit_9: 21.55,
  taksit_10: 23.57,
  taksit_11: 25.61,
  taksit_12: 27.65,
}
const RATES = Object.values(RATE_ROW).map((rate, index) => ({ installment: index + 2, rate, constant: 0 }))
const FAMILIES = ['world', 'axess', 'cardfinans', 'paraf', 'advantage', 'bonus', 'saglamkart']
const GROUP = {
  bank_code: null,
  bank_name: null,
  card_prefix: null,
  card_type: null,
  card_class: null,
}
const ratesAnswer = (oranlar: unknown, extra: Record<string, unknown> = {}) => ({
  status: 'success',
  request_id: '20260623DF4B',
  oranlar,
  ...extra,
})

describe('PayTrPosQueryResponseDataMapper', () => {
  it('testSupports', () => {
    expect(PayTrPosQueryResponseDataMapper.supports('PayTrPos')).toBe(true)
    expect(PayTrPosQueryResponseDataMapper.supports('AssecoPos')).toBe(false)
  })

  it('testMapInstallmentPricesResponseThrows', () => {
    expect(() => create().mapper.mapInstallmentPricesResponse({})).toThrow(UnsupportedTransactionTypeError)
  })

  describe('installment rates', () => {
    it('success: seven families with eleven rates each', () => {
      const raw = ratesAnswer(Object.fromEntries(FAMILIES.map((f) => [f, { ...RATE_ROW }])), { max_inst_non_bus: '12' })
      const out = create().mapper.mapInstallmentRatesResponse(raw)

      expect(out.all).toBe(raw)
      expect(out.status).toBe('approved')
      expect(out.error_message).toBeNull()
      const families = [
        CARD_FAMILY.WORLD,
        CARD_FAMILY.AXESS,
        CARD_FAMILY.CARDFINANS,
        CARD_FAMILY.PARAF,
        CARD_FAMILY.ADVANTAGE,
        CARD_FAMILY.BONUS,
        CARD_FAMILY.SAGLAMKART,
      ]
      expect(out.installment_rates).toEqual(families.map((card_family) => ({ ...GROUP, card_family, rates: RATES })))
    })

    it('success_with_taksit_1_skipped', () => {
      const { mapper, log } = create()
      const out = mapper.mapInstallmentRatesResponse(
        ratesAnswer({ world: { taksit_1: 0.0, taksit_2: 5.0, taksit_3: 7.5 } }),
      )
      expect(out.installment_rates).toEqual([
        {
          ...GROUP,
          card_family: CARD_FAMILY.WORLD,
          rates: [
            { installment: 2, rate: 5, constant: 0 },
            { installment: 3, rate: 7.5, constant: 0 },
          ],
        },
      ])
      expect(log.warn).not.toHaveBeenCalled()
    })

    it('failed', () => {
      const raw = { status: 'failed', err_msg: 'Geçersiz token' }
      const out = create().mapper.mapInstallmentRatesResponse(raw)
      expect(out).toEqual({ status: 'declined', error_message: 'Geçersiz token', installment_rates: [], all: raw })
    })

    it('sorts the rates of a family by installment count', () => {
      const out = create().mapper.mapInstallmentRatesResponse(
        ratesAnswer({ world: { taksit_6: 1, taksit_2: 2, taksit_12: 3 } }),
      )
      expect(out.installment_rates[0]?.rates.map((r) => r.installment)).toEqual([2, 6, 12])
    })

    // addition: malformed rates are dropped, the warning names the key and never the value
    it.each([
      ['taksit_13', 5],
      ['taksit_x', 5],
      ['taksit_0', 5],
      ['taksit_02', 5],
      ['taksit_2', '7,28'],
      ['taksit_2', -1],
      ['taksit_2', Number.NaN],
      ['taksit_2', Number.POSITIVE_INFINITY],
      ['taksit_2', 'x'],
      ['taksit_2', '1000'],
      ['taksit_2', ['5']],
      ['taksit_2', { a: 1 }],
      ['taksit_2', null],
      ['taksit_2', true],
      ['rate', 5],
    ])('drops %s = %j', (key, value) => {
      const { mapper, log } = create()
      const out = mapper.mapInstallmentRatesResponse(ratesAnswer({ world: { [key]: value, taksit_3: 9 } }))
      expect(out.installment_rates[0]?.rates).toEqual([{ installment: 3, rate: 9, constant: 0 }])
      const warned = JSON.stringify(log.warn.mock.calls)
      expect(warned).not.toContain('[object')
      expect(warned).not.toContain('7,28')
    })

    it('reads numeric strings with a dot', () => {
      const out = mapper().mapInstallmentRatesResponse(ratesAnswer({ world: { taksit_2: '7.28', taksit_3: '0' } }))
      expect(out.installment_rates[0]?.rates).toEqual([
        { installment: 2, rate: 7.28, constant: 0 },
        { installment: 3, rate: 0, constant: 0 },
      ])
    })

    it.each([[[]], ['x'], [null], [7], [[{ world: {} }]]])('oranlar %j yields no groups', (oranlar) => {
      const out = mapper().mapInstallmentRatesResponse(ratesAnswer(oranlar))
      expect(out.status).toBe('approved')
      expect(out.installment_rates).toEqual([])
    })

    // deviation: a family without a readable rate is skipped, so the list holds only families that have rates
    it('skips non-record families and families without a readable rate', () => {
      const out = mapper().mapInstallmentRatesResponse(
        ratesAnswer({ world: 'x', axess: [1], paraf: null, bonus: { taksit_2: 'x' }, cardfinans: { taksit_2: 3 } }),
      )
      expect(out.installment_rates.map((g) => g.card_family)).toEqual([CARD_FAMILY.CARDFINANS])
    })

    it('an unknown family name passes through; an overlong one is skipped', () => {
      const out = mapper().mapInstallmentRatesResponse(
        ratesAnswer({ maximum: { taksit_2: 3 }, ['x'.repeat(65)]: { taksit_2: 3 } }),
      )
      expect(out.installment_rates.map((g) => g.card_family)).toEqual(['maximum'])
    })

    it('a family named __proto__ is read as data', () => {
      const oranlar = JSON.parse('{"__proto__": {"taksit_2": 3}}')
      const out = mapper().mapInstallmentRatesResponse(ratesAnswer(oranlar))
      expect(out.installment_rates.map((g) => g.card_family)).toEqual(['__proto__'])
    })

    it('status must be exactly success', () => {
      for (const status of ['SUCCESS', ' success', ['success'], undefined]) {
        const out = mapper().mapInstallmentRatesResponse({ status, oranlar: { world: { taksit_2: 3 } } })
        expect(out.status).toBe('declined')
        expect(out.installment_rates).toEqual([])
      }
    })

    it('error_message is own text of at most 256 characters without control characters, else null', () => {
      expect(mapper().mapInstallmentRatesResponse({ status: 'failed', err_msg: 'a\u0000b' }).error_message).toBe('ab')
      expect(mapper().mapInstallmentRatesResponse({ status: 'failed', err_msg: 'a'.repeat(300) }).error_message).toBe(
        'a'.repeat(256),
      )
      expect(mapper().mapInstallmentRatesResponse({ status: 'failed', err_msg: { a: 1 } }).error_message).toBeNull()
      expect(mapper().mapInstallmentRatesResponse({ status: 'failed', err_msg: ['x'] }).error_message).toBeNull()
    })
  })

  describe('history', () => {
    it('failed', () => {
      const out = mapper().mapHistoryResponse({ status: 'failed', err_no: 'ERR_001', err_msg: 'Hata mesajı' })
      expect(out.transactions).toHaveLength(0)
      expect(out.trans_count).toBe(0)
      expect(out.proc_return_code).toBe('failed')
      expect(out.status).toBe('declined')
      expect(out.error_code).toBe('ERR_001')
      expect(out.error_message).toBe('Hata mesajı')
      expect(out).toHaveProperty('all')
    })

    it('failed without err_no falls back to the status word', () => {
      expect(mapper().mapHistoryResponse({ status: 'failed' }).error_code).toBe('failed')
    })

    it('success_with_transactions', () => {
      const raw = {
        status: 'success',
        list: [
          {
            siparis_no: 'ORDER001',
            islem_tipi: 'sale',
            islem_tarihi: '2024-05-01 10:00:00',
            islem_tutari: '100.00',
            odeme_tutari: '100.00',
            para_birimi: 'TRY',
            kart_no: '411111******1111',
            taksit: '1',
          },
        ],
      }
      const out = mapper().mapHistoryResponse(raw)
      expect(out.trans_count).toBe(1)
      expect(out.proc_return_code).toBe('success')
      expect(out.status).toBe('approved')
      expect(out.error_code).toBeNull()
      expect(out.all).toBe(raw)
    })

    // addition: a card number that is 13 to 19 consecutive digits is never kept
    it.each([
      ['4111111111111111', null],
      ['4111111111111', null],
      ['4111111111111111111', null],
      ['411111******1111', '411111******1111'],
      ['41111111111', '41111111111'],
    ])('history row card number %j reads as %j', (card, expected) => {
      const out = mapper().mapHistoryResponse({ status: 'success', list: [{ siparis_no: 'O1', kart_no: card }] })
      expect((out.transactions as Array<Record<string, unknown>>)[0]?.masked_number ?? null).toBe(expected)
    })

    // addition: the documented transaction type letters and a Türkiye-time date
    it('maps a sale row field by field', () => {
      const out = mapper().mapHistoryResponse({
        status: 'success',
        list: [
          {
            siparis_no: 'ORDER001',
            islem_tipi: 'S',
            islem_tarihi: '2024-05-01 10:00:00',
            islem_tutari: '10,00',
            odeme_tutari: '9.5',
            para_birimi: 'TL',
            kart_no: '411111******1111',
            taksit: '3',
          },
        ],
      })
      const tx = out.transactions as Array<Record<string, unknown>>
      expect(tx[0]).toMatchObject({
        order_id: 'ORDER001',
        transaction_type: 'pay',
        first_amount: 10,
        capture_amount: 9.5,
        currency: 'TRY',
        masked_number: '411111******1111',
        installment_count: 3,
        status: 'approved',
      })
      expect((tx[0] as { transaction_time: Date }).transaction_time.toISOString()).toBe('2024-05-01T07:00:00.000Z')
      // a report row carries nothing that could confirm a payment
      expect(tx[0]).toMatchObject({ auth_code: null, ref_ret_num: null, transaction_id: null, capture: null })
    })

    it('a failed answer never lists transactions, even when a list is present', () => {
      const out = mapper().mapHistoryResponse({ status: 'failed', list: [{ siparis_no: 'A' }] })
      expect(out.transactions).toEqual([])
    })

    it.each([[undefined], ['x'], [{ 0: { siparis_no: 'A' } }], [null], [7]])(
      'list %j gives no transactions',
      (list) => {
        const out = mapper().mapHistoryResponse({ status: 'success', list })
        expect(out.status).toBe('approved')
        expect(out.transactions).toEqual([])
      },
    )

    it('skips items that are not records', () => {
      const out = mapper().mapHistoryResponse({
        status: 'success',
        list: [null, 'x', 5, ['a'], { siparis_no: 'OK1' }],
      })
      expect((out.transactions as Array<Record<string, unknown>>).map((t) => t.order_id)).toEqual(['OK1'])
    })

    it('reads amounts exactly and drops malformed ones', () => {
      const { mapper: m, log } = create()
      const out = m.mapHistoryResponse({
        status: 'success',
        list: [
          { islem_tutari: '10,00', odeme_tutari: '1e3' },
          { islem_tutari: 10.5, odeme_tutari: '10.005' },
          { islem_tutari: { a: 1 }, odeme_tutari: ['1'] },
        ],
      })
      const tx = out.transactions as Array<Record<string, unknown>>
      expect(tx[0]).toMatchObject({ first_amount: 10, capture_amount: null })
      expect(tx[1]).toMatchObject({ first_amount: 10.5, capture_amount: null })
      expect(tx[2]).toMatchObject({ first_amount: null, capture_amount: null })
      expect(JSON.stringify(log.warn.mock.calls)).not.toContain('[object')
    })

    it('an unreadable date is null and warns without the value', () => {
      const { mapper: m, log } = create()
      const out = m.mapHistoryResponse({ status: 'success', list: [{ islem_tarihi: 'not a date' }] })
      expect((out.transactions as Array<Record<string, unknown>>)[0]?.transaction_time).toBeNull()
      expect(log.warn).toHaveBeenCalled()
      expect(JSON.stringify(log.warn.mock.calls)).not.toContain('not a date')
    })

    it('non-scalar texts become null, never "[object Object]"', () => {
      const out = mapper().mapHistoryResponse({
        status: 'success',
        list: [{ siparis_no: { a: 1 }, islem_tipi: ['S'], para_birimi: {}, kart_no: ['4'], taksit: { a: 1 } }],
      })
      expect((out.transactions as Array<Record<string, unknown>>)[0]).toMatchObject({
        order_id: null,
        transaction_type: null,
        currency: null,
        masked_number: null,
        installment_count: null,
      })
    })

    it('an unknown transaction type or currency is null, not an error', () => {
      const out = mapper().mapHistoryResponse({
        status: 'success',
        list: [{ islem_tipi: 'Q', para_birimi: 'XYZ' }],
      })
      expect((out.transactions as Array<Record<string, unknown>>)[0]).toMatchObject({
        transaction_type: null,
        currency: null,
      })
    })

    it('status must be exactly success', () => {
      for (const status of ['Success', 'success ', ['success'], undefined, 1]) {
        const out = mapper().mapHistoryResponse({ status, list: [{ siparis_no: 'A' }] })
        expect(out.status).toBe('declined')
        expect(out.transactions).toEqual([])
      }
    })

    it('a non-text status gives a null procedure code', () => {
      expect(mapper().mapHistoryResponse({ status: { a: 1 } }).proc_return_code).toBeNull()
    })
  })

  describe('BIN list', () => {
    it('success_credit_visa', () => {
      const raw = {
        status: 'success',
        cardType: 'credit',
        businessCard: 'n',
        bank: 'Garanti Bankası',
        brand: 'Bonus',
        schema: 'VISA',
        bankCode: 62,
        allow_non3d: 'Y',
      }
      const out = mapper().mapBinListResponse(raw)
      expect(out.all).toBe(raw)
      expect({ ...out, all: undefined }).toEqual({
        status: 'approved',
        error_message: null,
        bin_list: [
          {
            bin: null,
            bank_code: '62',
            bank_name: 'Garanti Bankası',
            card_type: CARD_TYPE.VISA,
            card_class: CARD_CLASS.CREDIT,
            card_family: 'Bonus',
          },
        ],
        all: undefined,
      })
    })

    it('failed_unknown_bin', () => {
      const out = mapper().mapBinListResponse({ status: 'failed' })
      expect(out).toMatchObject({ status: 'declined', error_message: 'failed', bin_list: [] })
    })

    it('error_invalid_request', () => {
      const out = mapper().mapBinListResponse({ status: 'error', err_msg: 'Invalid merchant_id' })
      expect(out).toMatchObject({ status: 'declined', error_message: 'Invalid merchant_id', bin_list: [] })
    })

    // addition: strict item reads
    it('item text longer than 64 characters is null; a leading zero in bankCode is kept', () => {
      const out = mapper().mapBinListResponse({
        status: 'success',
        bank: 'b'.repeat(65),
        brand: 'f'.repeat(65),
        schema: 'VISA',
        cardType: 'x'.repeat(65),
        bankCode: '062',
      })
      expect(out.bin_list[0]).toEqual({
        bin: null,
        bank_code: '062',
        bank_name: null,
        card_type: CARD_TYPE.VISA,
        card_class: null,
        card_family: null,
      })
    })

    it.each([[{ a: 1 }], [['62']], [-1], [1.5], [Number.NaN], ['6x'], [''], [null], [1e21]])(
      'bankCode %j reads as null',
      (bankCode) => {
        const out = mapper().mapBinListResponse({ status: 'success', bankCode })
        expect(out.bin_list[0]?.bank_code).toBeNull()
      },
    )

    it('non-text item fields are null', () => {
      const out = mapper().mapBinListResponse({
        status: 'success',
        bank: { a: 1 },
        brand: ['Bonus'],
        schema: 7,
        cardType: {},
      })
      expect(out.bin_list[0]).toEqual({
        bin: null,
        bank_code: null,
        bank_name: null,
        card_type: null,
        card_class: null,
        card_family: null,
      })
    })

    it('status must be exactly success; the message of a non-text err_msg falls back to the status word', () => {
      expect(mapper().mapBinListResponse({ status: 'SUCCESS' }).status).toBe('declined')
      expect(mapper().mapBinListResponse({ status: 'failed', err_msg: { a: 1 } }).error_message).toBe('failed')
      expect(mapper().mapBinListResponse({ status: { a: 1 } }).error_message).toBeNull()
    })
  })
})

function mapper() {
  return create().mapper
}
