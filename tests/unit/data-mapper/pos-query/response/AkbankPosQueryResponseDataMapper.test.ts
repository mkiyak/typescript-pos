import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AkbankPosQueryResponseDataMapper } from '../../../../../src/data-mapper/pos-query/response/AkbankPosQueryResponseDataMapper.js'
import { BasicResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { AkbankPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/AkbankPosResponseValueMapper.js'
import { UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { noopLogger } from '../../../../../src/logger.js'

type Tx = Record<string, unknown>
const txs = (r: Record<string, unknown>) => r.transactions as Tx[]

const mapper = new AkbankPosQueryResponseDataMapper(
  new BasicResponseValueFormatter(),
  new AkbankPosResponseValueMapper(),
  noopLogger,
)

const fixture = JSON.parse(
  readFileSync(new URL('../../../test_data/akbankpos/history/daily_history_2.json', import.meta.url), 'utf8'),
)

describe('AkbankPosQueryResponseDataMapper', () => {
  it('testSupports', () => {
    expect(AkbankPosQueryResponseDataMapper.supports('AkbankPos')).toBe(true)
    expect(AkbankPosQueryResponseDataMapper.supports('AssecoPos')).toBe(false)
  })

  it('testMapBinListResponseThrows', () => {
    expect(() => mapper.mapBinListResponse({})).toThrow(UnsupportedTransactionTypeError)
  })

  it.each([
    [
      'failed_response',
      {
        requestId: 'VPS00020599126001999999999920240425095529000904',
        responseMessage: 'Gün aralığı 1 günden fazla girilemez',
        responseCode: 'VPS-2229',
      },
      { proc_return_code: 'VPS-2229', error_code: 'VPS-2229', status: 'declined', trans_count: 0 },
    ],
    [
      'success_daily_history',
      fixture,
      { proc_return_code: 'VPS-0000', error_code: null, status: 'approved', trans_count: 8 },
    ],
  ])('testMapHistoryResponse %s', (_name, raw, expected) => {
    const actual = mapper.mapHistoryResponse(raw)

    expect(txs(actual)).toHaveLength(expected.trans_count)
    expect(actual.proc_return_code).toBe(expected.proc_return_code)
    expect(actual.status).toBe(expected.status)
    expect(actual.error_code).toBe(expected.error_code)
    expect(actual).toHaveProperty('all')
  })

  // addition: the transaction fields of the first approved entry
  it('maps the first approved transaction with the detailed order status and a +03:00 time', () => {
    const actual = mapper.mapHistoryResponse(fixture)
    const tx = txs(actual).find((t) => t.status === 'approved')
    expect(tx).toBeDefined()
    const raw = fixture.data.txnDetailList.find((t: { responseCode: string }) => t.responseCode === 'VPS-0000')
    const expectedStatus = new AkbankPosResponseValueMapper().mapOrderStatusDetailed(
      raw.txnStatus,
      raw.preAuthStatus ?? null,
      false,
    )
    expect(tx?.order_status).toBe(expectedStatus)
    expect(tx?.order_id).toBe(raw.orderId)
    expect((tx?.transaction_time as Date | undefined)?.getTime()).toBe(new Date(`${raw.txnDateTime}+03:00`).getTime())
  })

  // addition: a missing list is an empty list and non-scalar bank values never reach the result
  it('treats a missing transaction list as empty and non-scalar values as null', () => {
    expect(txs(mapper.mapHistoryResponse({ responseCode: 'VPS-0000' }))).toEqual([])
    const result = mapper.mapHistoryResponse({
      responseCode: 'VPS-0000',
      data: { txnDetailList: [{ responseCode: 'VPS-0000', orderId: { a: 1 }, rrn: [1], txnStatus: 'S' }] },
    })
    expect(txs(result)[0]?.order_id).toBeNull()
    expect(txs(result)[0]?.ref_ret_num).toBeNull()
  })
})
