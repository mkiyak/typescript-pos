import { describe, expect, it, vi } from 'vitest'
import { ParamPosQueryRequestDataMapper } from '../../../../../src/data-mapper/pos-query/request/ParamPosQueryRequestDataMapper.js'
import { ParamPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/ParamPosRequestValueFormatter.js'
import { ParamPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/ParamPosRequestValueMapper.js'
import { PosError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { TX_TYPE } from '../../../../../src/PosInterface.js'

const GUID = '0c13d406-873b-403b-9c09-a5766840d98c'
const account = AccountFactory.createParamPosAccount('param-pos', '10738', 'Test1', 'Test2', GUID)

const G = { CLIENT_CODE: '10738', CLIENT_USERNAME: 'Test1', CLIENT_PASSWORD: 'Test2' }
const XMLNS = 'https://turkpos.com.tr/'

/** The crypt must never be touched by a query: a call to any member fails the test. */
function untouchedCrypt() {
  return {
    createHash: vi.fn(),
    generateRandomString: vi.fn(),
    create3DHash: vi.fn(),
    check3DHash: vi.fn(),
  }
}

function create(crypt = untouchedCrypt()) {
  return {
    crypt,
    mapper: new ParamPosQueryRequestDataMapper(
      new ParamPosRequestValueMapper(),
      new ParamPosRequestValueFormatter(),
      crypt as never,
    ),
  }
}

/** Key order is part of what is sent on the wire: compare the serialized form as well as the value. */
function expectSame(actual: unknown, expected: unknown) {
  expect(actual).toEqual(expected)
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
}

const noCryptCalls = (crypt: ReturnType<typeof untouchedCrypt>) => {
  for (const fn of Object.values(crypt)) expect(fn).not.toHaveBeenCalled()
}

describe('ParamPosQueryRequestDataMapper', () => {
  it('testSupports', () => {
    expect(ParamPosQueryRequestDataMapper.supports('ParamPos')).toBe(true)
    expect(ParamPosQueryRequestDataMapper.supports('AssecoPos')).toBe(false)
    // addition: the hosted-page gateway has no query class
    expect(ParamPosQueryRequestDataMapper.supports('Param3DHostPos')).toBe(false)
  })

  it('testIsTestMode', () => {
    const { mapper } = create()
    expect(mapper.isTestMode()).toBe(false)
    mapper.setTestMode(true)
    expect(mapper.isTestMode()).toBe(true)
  })

  it('testCreateCustomQueryRequestData', () => {
    const { mapper } = create()
    const actual = mapper.createCustomQueryRequestData(account, { TP_Islem_Izleme: { SomeField: 'value' } })

    const body = (actual['soap:Body'] as Record<string, Record<string, unknown>>).TP_Islem_Izleme as Record<
      string,
      unknown
    >
    expect(body.SomeField).toBe('value')
    expect(body.G).toEqual(G)
    expect(body.GUID).toBe(GUID)
    expectSame(actual, { 'soap:Body': { TP_Islem_Izleme: { SomeField: 'value', G, GUID } } })
  })

  it('testCreateInstallmentRatesRequestData', () => {
    const { mapper, crypt } = create()
    const actual = mapper.createInstallmentRatesRequestData(account, {})

    expectSame(actual, { 'soap:Body': { TP_Ozel_Oran_SK_Liste: { '@xmlns': XMLNS, G, GUID } } })
    noCryptCalls(crypt)
  })

  it.each([
    ['without_bin', {}, { '@xmlns': XMLNS, G, GUID }],
    ['with_bin', { bin: '415956' }, { '@xmlns': XMLNS, G, GUID, BIN: '415956' }],
  ])('testCreateBinListRequestData %s', (_name, params, body) => {
    const { mapper, crypt } = create()

    expectSame(mapper.createBinListRequestData(account, params), { 'soap:Body': { BIN_SanalPos: body } })
    noCryptCalls(crypt)
  })

  // deviation: the inputs are Türkiye-time instants (+03:00) because the request is formatted in that zone
  // regardless of the server's own
  const START = new Date('2024-04-13T13:00:00+03:00')
  const END = new Date('2024-04-14T13:00:00+03:00')
  const historyBody = (extra: Record<string, unknown> = {}) => ({
    'soap:Body': {
      TP_Islem_Izleme: {
        G,
        GUID,
        '@xmlns': XMLNS,
        Tarih_Bas: '13.04.2024 13:00:00',
        Tarih_Bit: '14.04.2024 13:00:00',
        ...extra,
      },
    },
  })

  it.each([
    ['with_date_range', {}, {}],
    [
      'with_date_range_and_pay_auth_filter',
      { order_status: 'Başarılı', transaction_type: TX_TYPE.PAY_AUTH },
      { Islem_Durum: 'Başarılı', Islem_Tip: 'Satış' },
    ],
    ['with_cancel_filter', { transaction_type: TX_TYPE.CANCEL }, { Islem_Tip: 'İptal' }],
    ['with_refund_filter', { transaction_type: TX_TYPE.REFUND }, { Islem_Tip: 'İade' }],
  ])('testCreateHistoryRequestData %s', (_name, data, extra) => {
    const { mapper } = create()

    expectSame(
      mapper.createHistoryRequestData(account, { start_date: START, end_date: END, ...data }),
      historyBody(extra),
    )
  })

  describe('additions', () => {
    // addition: the date window is read in Türkiye time whatever the server zone is
    it('formats the window in Türkiye time from any instant', () => {
      const { mapper } = create()
      const actual = mapper.createHistoryRequestData(account, {
        start_date: new Date('2024-04-13T10:00:00Z'),
        end_date: new Date('2024-12-31T21:30:05Z'),
      })

      expectSame(actual, {
        'soap:Body': {
          TP_Islem_Izleme: {
            G,
            GUID,
            '@xmlns': XMLNS,
            Tarih_Bas: '13.04.2024 13:00:00',
            Tarih_Bit: '01.01.2025 00:30:05',
          },
        },
      })
    })

    // addition: a transaction type without a bank word is ignored
    it('ignores a transaction type the bank has no word for', () => {
      const { mapper } = create()
      const actual = mapper.createHistoryRequestData(account, {
        start_date: START,
        end_date: END,
        transaction_type: TX_TYPE.STATUS,
      })

      expectSame(actual, historyBody())
    })

    // addition: dates must be real dates, never "undefined" or an unparsed string
    it.each([
      ['a string', { start_date: 'x', end_date: END }],
      ['a missing start', { end_date: END }],
      ['a missing end', { start_date: START }],
      ['an invalid date', { start_date: new Date('nope'), end_date: END }],
      ['a number', { start_date: 1_700_000_000_000, end_date: END }],
    ])('rejects %s as a date', (_name, data) => {
      const { mapper } = create()
      expect(() => mapper.createHistoryRequestData(account, data)).toThrow(PosError)
    })

    // addition: the status filter is text of a bounded size
    it('accepts a 64 character order status and rejects 65', () => {
      const { mapper } = create()
      const data = { start_date: START, end_date: END }
      expect(
        mapper.createHistoryRequestData(account, { ...data, order_status: 'a'.repeat(64) })['soap:Body'],
      ).toBeDefined()
      expect(() => mapper.createHistoryRequestData(account, { ...data, order_status: 'a'.repeat(65) })).toThrow(
        PosError,
      )
      expect(() => mapper.createHistoryRequestData(account, { ...data, order_status: 5 })).toThrow(PosError)
      expect(() => mapper.createHistoryRequestData(account, { ...data, order_status: ['x'] })).toThrow(PosError)
    })

    // addition: an inherited field is not the caller's field
    it('does not read inherited history fields', () => {
      const { mapper } = create()
      const inherited = Object.create({ start_date: START, end_date: END }) as Record<string, unknown>
      expect(() => mapper.createHistoryRequestData(account, inherited)).toThrow(PosError)
    })

    // addition: reference docs - the BIN is optional, 6 or 8 digits
    it.each([
      ['an 8 digit number', 41595612, '41595612'],
      ['an 8 digit text', '41595612', '41595612'],
      ['a 6 digit number', 415956, '415956'],
    ])('accepts %s as the BIN', (_name, bin, sent) => {
      const { mapper } = create()
      const body = (mapper.createBinListRequestData(account, { bin })['soap:Body'] as Record<string, unknown>)
        .BIN_SanalPos as Record<string, unknown>
      expect(body.BIN).toBe(sent)
    })

    it.each(['41595', '4159561', '41595a', '', '415956789', ' 415956', '415956 ', '4159.5', 'abc123'])(
      'rejects the BIN %j',
      (bin) => {
        const { mapper } = create()
        expect(() => mapper.createBinListRequestData(account, { bin })).toThrow(PosError)
      },
    )

    it.each([
      ['a fraction', 415956.5],
      ['a float', 1e21],
      ['a list', ['415956']],
      ['a record', { bin: '415956' }],
      ['a boolean', true],
    ])('rejects %s as the BIN', (_name, bin) => {
      const { mapper } = create()
      expect(() => mapper.createBinListRequestData(account, { bin })).toThrow(PosError)
    })

    it('leaves the BIN out when it is null or undefined', () => {
      const { mapper } = create()
      for (const bin of [null, undefined]) {
        const body = (mapper.createBinListRequestData(account, { bin })['soap:Body'] as Record<string, unknown>)
          .BIN_SanalPos as Record<string, unknown>
        expect('BIN' in body).toBe(false)
      }
    })

    // addition: an inherited bin is not the caller's bin
    it('does not read an inherited BIN', () => {
      const { mapper } = create()
      const body = (
        mapper.createBinListRequestData(account, Object.create({ bin: '41595' }) as Record<string, unknown>)[
          'soap:Body'
        ] as Record<string, unknown>
      ).BIN_SanalPos as Record<string, unknown>
      expect('BIN' in body).toBe(false)
    })

    // addition: the rate query takes no parameter, so whatever is passed never reaches the body
    it('ignores parameters of the rate query', () => {
      const { mapper } = create()
      expectSame(mapper.createInstallmentRatesRequestData(account, { bin: '415956', GUID: 'x', Extra: 1 }), {
        'soap:Body': { TP_Ozel_Oran_SK_Liste: { '@xmlns': XMLNS, G, GUID } },
      })
    })

    // addition: a custom query takes exactly one SOAP action whose value is a record
    it.each([
      ['an empty request', {}],
      ['a text action body', { A: 'x' }],
      ['two actions', { A: {}, B: {} }],
      ['a list action body', { A: [{ X: 1 }] }],
      ['a null action body', { A: null }],
      ['an action name with markup', { 'A><B': {} }],
      ['an action name starting with a digit', { '1A': {} }],
      ['a prefixed action name', { 'soap:Body': {} }],
    ])('rejects a custom query with %s', (_name, request) => {
      const { mapper } = create()
      expect(() => mapper.createCustomQueryRequestData(account, request)).toThrow(PosError)
    })

    it('keeps the caller fields of a custom query and fills only the missing account fields', () => {
      const { mapper } = create()
      const actual = mapper.createCustomQueryRequestData(account, {
        TP_Islem_Sorgulama4: { '@xmlns': XMLNS, Siparis_ID: 'x', GUID: 'caller-guid', G: undefined },
      })

      expectSame(actual, {
        'soap:Body': { TP_Islem_Sorgulama4: { '@xmlns': XMLNS, Siparis_ID: 'x', GUID: 'caller-guid', G } },
      })
    })

    it('does not alter the caller object of a custom query', () => {
      const { mapper } = create()
      const request = { TP_Islem_Izleme: { SomeField: 'value' } }
      mapper.createCustomQueryRequestData(account, request)
      expect(request).toEqual({ TP_Islem_Izleme: { SomeField: 'value' } })
    })

    it('keeps a __proto__ field of a custom query as data', () => {
      const { mapper } = create()
      const body = JSON.parse('{"TP_Islem_Izleme":{"__proto__":{"polluted":true}}}') as Record<string, unknown>
      const actual = mapper.createCustomQueryRequestData(account, body)

      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
      const action = (actual['soap:Body'] as Record<string, unknown>).TP_Islem_Izleme as Record<string, unknown>
      expect(Object.getPrototypeOf(action)).toBe(Object.prototype)
      expect(Object.hasOwn(action, '__proto__')).toBe(true)
    })

    // addition: the installment prices query is not offered
    it('does not build an installment prices request', () => {
      const { mapper } = create()
      expect(() => mapper.createInstallmentPricesRequestData(account, {})).toThrow(UnsupportedTransactionTypeError)
    })
  })
})
