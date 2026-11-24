import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { VakifKatilimPosQueryResponseDataMapper } from '../../../../../src/data-mapper/pos-query/response/VakifKatilimPosQueryResponseDataMapper.js'
import { BoaPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/BoaPosResponseValueFormatter.js'
import { VakifKatilimPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/VakifKatilimPosResponseValueMapper.js'
import { UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { noopLogger } from '../../../../../src/logger.js'

const mapper = new VakifKatilimPosQueryResponseDataMapper(
  new BoaPosResponseValueFormatter(),
  new VakifKatilimPosResponseValueMapper(),
  noopLogger,
)

type Raw = Record<string, unknown>
const fixture = () =>
  JSON.parse(
    readFileSync(new URL('../../../test_data/vakifkatilimpos/history/success_history.json', import.meta.url), 'utf8'),
  ) as Raw & { VPosOrderData: { OrderContract: Raw[] } }

const record = (over: Raw = {}): Raw => ({
  OrderId: '1',
  MerchantOrderId: 'ORDER1',
  OrderStatus: '1',
  LastOrderStatus: '1',
  FEC: '0949',
  TransactionSecurity: '3',
  CardNumber: '5351********9885',
  OrderDate: '2024-07-01T15:21:28.123',
  FirstAmount: '10.01',
  TranAmount: '10.01',
  InstallmentCount: '0',
  ResponseCode: '00',
  ResponseExplain: 'Onaylandi',
  ProvNumber: '520366',
  RRN: '418315158962',
  Stan: '435438',
  ...over,
})
const answer = (contract: unknown, over: Raw = {}): Raw => ({
  ResponseCode: '00',
  ResponseMessage: '',
  VPosOrderData: { OrderContract: contract },
  ...over,
})
const txs = (r: Record<string, unknown>) => r.transactions as Raw[]

describe('VakifKatilimPosQueryResponseDataMapper', () => {
  it('testSupports', () => {
    expect(VakifKatilimPosQueryResponseDataMapper.supports('VakifKatilimPos')).toBe(true)
    expect(VakifKatilimPosQueryResponseDataMapper.supports('AssecoPos')).toBe(false)
    expect(VakifKatilimPosQueryResponseDataMapper.supports('KuveytPos')).toBe(false)
  })

  it('testMapHistoryResponse failed', () => {
    const actual = mapper.mapHistoryResponse({ ResponseCode: 'E001', ResponseMessage: 'Hata' })
    expect(txs(actual)).toHaveLength(0)
    expect(actual.proc_return_code).toBe('E001')
    expect(actual.status).toBe('declined')
    expect(actual.error_code).toBe('E001')
    expect(actual.error_message).toBe('Hata')
    expect(actual.all).toBeDefined()
  })

  it('testMapHistoryResponse success', () => {
    const data = fixture()
    const actual = mapper.mapHistoryResponse(data)
    expect(txs(actual)).toHaveLength(data.VPosOrderData.OrderContract.length)
    expect(txs(actual)).toHaveLength(31)
    expect(actual.proc_return_code).toBe('00')
    expect(actual.status).toBe('approved')
    expect(actual.trans_count).toBe(31)
    expect(actual.error_code).toBeNull()
    expect(actual.all).toBeDefined()
  })

  // addition: shapes of the contract list
  it('maps a single OrderContract record (a one-order answer decodes as a record) to one transaction', () => {
    const actual = mapper.mapHistoryResponse(answer(record()))
    expect(txs(actual)).toHaveLength(1)
    expect(actual.trans_count).toBe(1)
    expect(txs(actual)[0]?.order_id).toBe('ORDER1')
  })

  it.each([
    ['an empty VPosOrderData', { ResponseCode: '00', VPosOrderData: '' }],
    ['no VPosOrderData', { ResponseCode: '00' }],
    ['a text OrderContract', answer('x')],
    ['a list of texts', answer(['x', 1, null])],
  ])('lists no transaction for %s', (_name, raw) => {
    const actual = mapper.mapHistoryResponse(raw)
    expect(txs(actual)).toHaveLength(0)
    expect(actual.trans_count).toBe(0)
  })

  it('has no overall result when the answer carries no response code', () => {
    const actual = mapper.mapHistoryResponse({ VPosOrderData: { OrderContract: [record()] } })
    expect(actual.status).toBeNull()
    expect(actual.proc_return_code).toBeNull()
    expect(actual.error_code).toBeNull()
  })

  // addition: ordering and per-record meaning
  it('lists the records newest first (the first mapped is the last raw record)', () => {
    const data = fixture()
    const raws = data.VPosOrderData.OrderContract
    const actual = txs(mapper.mapHistoryResponse(data))
    const at = (raw: Raw | undefined) => new Date(`${String(raw?.OrderDate)}+03:00`)
    expect(actual[0]?.transaction_time).toEqual(at(raws[raws.length - 1]))
    expect(actual[actual.length - 1]?.transaction_time).toEqual(at(raws[0]))
  })

  it('maps the cancelled sale and the cancel record of the fixture', () => {
    const data = fixture()
    const actual = txs(mapper.mapHistoryResponse(data))
    // the sale (raw index 0) was cancelled later: its last status is canceled, it is still a completed sale record
    const sale = actual[actual.length - 1] as Raw
    expect(sale.order_status).toBe('CANCELED')
    expect(sale.cancel_time).toBeUndefined()
    expect(sale.capture).toBe(true)
    expect(sale.capture_amount).toBe(10.01)
    expect(sale.first_amount).toBe(10.01)
    expect(sale.status).toBe('approved')
    expect(sale.currency).toBe('TRY')
    expect(sale.payment_model).toBe('3d')
    expect(sale.installment_count).toBe(2)
    expect(sale.masked_number).toBe('5351********9885')
    expect(sale.ref_ret_num).toBe('418315158962')
    expect(sale.auth_code).toBe('520366')
    expect(sale.transaction_time).toEqual(new Date('2024-07-01T15:21:28.123+03:00'))
    // the cancel record (raw index 1)
    const cancel = actual[actual.length - 2] as Raw
    expect(cancel.cancel_time).toEqual(new Date('2024-07-01T15:22:24.463+03:00'))
    expect(cancel.capture_time).toBeNull()
    expect(cancel.order_status).toBe('CANCELED')
  })

  it('reads a decimal amount in lira (not kuruş)', () => {
    const tx = txs(mapper.mapHistoryResponse(answer([record({ FirstAmount: '10.01', TranAmount: '10.01' })])))[0] as Raw
    expect(tx.first_amount).toBe(10.01)
    expect(tx.capture_amount).toBe(10.01)
  })

  it('a record with its own non-00 code is declined with its code and message, and carries no payment details', () => {
    const tx = txs(
      mapper.mapHistoryResponse(answer([record({ ResponseCode: '58', ResponseExplain: 'Red' })])),
    )[0] as Raw
    expect(tx.status).toBe('declined')
    expect(tx.proc_return_code).toBe('58')
    expect(tx.error_code).toBe('58')
    expect(tx.error_message).toBe('Red')
    expect(tx.first_amount).toBeNull()
    expect(tx.masked_number).toBeNull()
    expect(tx.auth_code).toBeNull()
  })

  it('a record without a response code is declined, never approved', () => {
    const tx = txs(mapper.mapHistoryResponse(answer([record({ ResponseCode: '' })])))[0] as Raw
    expect(tx.status).toBe('declined')
    expect(tx.proc_return_code).toBeNull()
  })

  it('approval needs the exact code: padded, numeric or listed codes are not 00', () => {
    for (const code of [' 00', '00 ', 0, ['00'], { a: '00' }, '0', '000']) {
      const tx = txs(mapper.mapHistoryResponse(answer([record({ ResponseCode: code })])))[0] as Raw
      expect(tx.status, JSON.stringify(code)).toBe('declined')
    }
  })

  it('an overall code that is not exactly 00 is declined', () => {
    for (const code of [' 00', 0, ['00', '00'], { a: '00' }]) {
      const actual = mapper.mapHistoryResponse(answer([record()], { ResponseCode: code }))
      expect(actual.status, JSON.stringify(code)).not.toBe('approved')
    }
  })

  it('a non-scalar bank value never becomes text', () => {
    const tx = txs(
      mapper.mapHistoryResponse(
        answer([
          record({
            MerchantOrderId: { a: '1' },
            OrderId: ['1', '2'],
            RRN: { x: 1 },
            Stan: ['1'],
            CardNumber: { n: '1' },
            ProvNumber: ['1'],
            FEC: { a: 1 },
            TransactionSecurity: ['3'],
            FirstAmount: { v: '1' },
            TranAmount: ['1'],
            OrderDate: { d: 'x' },
            InstallmentCount: ['2'],
            LastOrderStatus: { s: '6' },
            LastOrderStatusDescription: ['Iptal'],
            OrderStatus: { s: '1' },
          }),
        ]),
      ),
    )[0] as Raw
    for (const key of ['order_id', 'remote_order_id', 'ref_ret_num', 'transaction_id', 'masked_number', 'auth_code']) {
      expect(tx[key], key).toBeNull()
    }
    for (const key of ['currency', 'payment_model', 'first_amount', 'transaction_time', 'order_status']) {
      expect(tx[key], key).toBeNull()
    }
    expect(JSON.stringify(tx)).not.toContain('[object')
  })

  it('an unreadable or placeholder time leaves the time empty and does not throw', () => {
    for (const date of ['not a date', '0001-01-01T00:00:00']) {
      const tx = txs(mapper.mapHistoryResponse(answer([record({ OrderDate: date })])))[0] as Raw
      expect(tx.transaction_time).toBeNull()
    }
  })

  it('unknown currency and security codes map to null; an unknown order status is kept as sent', () => {
    const tx = txs(
      mapper.mapHistoryResponse(answer([record({ FEC: '9999', TransactionSecurity: '9', LastOrderStatus: '77' })])),
    )[0] as Raw
    expect(tx.currency).toBeNull()
    expect(tx.payment_model).toBeNull()
    expect(tx.order_status).toBe('77')
  })

  it('does not throw for a hostile record (prototype keys, inherited fields)', () => {
    const hostile = JSON.parse('{"__proto__":{"ResponseCode":"00"},"ResponseCode":"x"}') as Raw
    expect(() => mapper.mapHistoryResponse(answer([hostile, 5, null]))).not.toThrow()
    expect(({} as Raw).ResponseCode).toBeUndefined()
  })

  it('the other queries are unsupported', () => {
    expect(() => mapper.mapBinListResponse({})).toThrow(UnsupportedTransactionTypeError)
    expect(() => mapper.mapInstallmentRatesResponse({})).toThrow(UnsupportedTransactionTypeError)
    expect(() => mapper.mapInstallmentPricesResponse({})).toThrow(UnsupportedTransactionTypeError)
  })
})
