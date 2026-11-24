import { describe, expect, it } from 'vitest'
import {
  AbstractQueryResponseDataMapper,
  type PosQueryHistoryResponse,
} from '../../../../../src/data-mapper/pos-query/response/AbstractQueryResponseDataMapper.js'
import { BasicResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { AssecoPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/AssecoPosResponseValueMapper.js'
import { UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import type { PosLogger } from '../../../../../src/logger.js'

// addition: query mapper bases are new in this version.
const logged: unknown[] = []
const logger: PosLogger = {
  debug: (_m, ctx) => void logged.push(ctx),
  info() {},
  warn() {},
  error() {},
}

class TestResponseMapper extends AbstractQueryResponseDataMapper {
  mapHistoryResponse(raw: Record<string, unknown>): PosQueryHistoryResponse {
    return { status: 'approved', error_message: null, all: raw }
  }
  bin() {
    return this.getDefaultBinListResponse()
  }
  prices() {
    return this.getDefaultInstallmentPricesResponse()
  }
  rates() {
    return this.getDefaultInstallmentRatesResponse()
  }
  tx() {
    return this.getDefaultHistoryTxResponse()
  }
  merge(a: Record<string, unknown>, b: Record<string, unknown>) {
    return this.mergeArraysPreferNonNullValues(a, b)
  }
  empty(v: unknown) {
    return this.emptyStringsToNull(v)
  }
  log() {
    this.logger.debug('x', { Password: 'x' })
  }
}

const mapper = new TestResponseMapper(new BasicResponseValueFormatter(), new AssecoPosResponseValueMapper(), logger)

describe('AbstractQueryResponseDataMapper', () => {
  it('exposes constants', () => {
    expect(AbstractQueryResponseDataMapper.PROCEDURE_SUCCESS_CODE).toBe('00')
    expect(AbstractQueryResponseDataMapper.TX_STATUS_APPROVED).toBe('approved')
    expect(AbstractQueryResponseDataMapper.TX_STATUS_DECLINED).toBe('declined')
  })

  it('builds the default responses', () => {
    expect(mapper.bin()).toEqual({ status: 'declined', error_message: null, bin_list: [], all: {} })
    expect(mapper.prices()).toEqual({ status: 'declined', error_message: null, installment_prices: [], all: {} })
    expect(mapper.rates()).toEqual({ status: 'declined', error_message: null, installment_rates: [], all: {} })
  })

  it('builds the default history transaction in key order', () => {
    const tx = mapper.tx()
    expect(Object.keys(tx)).toEqual([
      'auth_code',
      'proc_return_code',
      'transaction_id',
      'order_id',
      'transaction_time',
      'capture_time',
      'error_message',
      'ref_ret_num',
      'order_status',
      'transaction_type',
      'first_amount',
      'capture_amount',
      'status',
      'error_code',
      'capture',
      'currency',
      'masked_number',
    ])
    expect(Object.entries(tx).filter(([, v]) => v !== null)).toEqual([['status', 'declined']])
  })

  it('merges preferring non-null values', () => {
    const r = mapper.merge({ a: 1, x: null, y: 2 }, { x: 5, y: null, b: 3 })
    expect(Object.keys(r)).toEqual(['a', 'b', 'x', 'y'])
    expect(r).toEqual({ a: 1, b: 3, x: 5, y: 2 })
  })

  it('converts empty strings to null', () => {
    expect(
      mapper.empty({
        a: ' x ',
        b: '',
        c: 0,
        d: ['', ' '],
        e: { f: '' },
        g: true,
        h: null,
        i: new Date(),
        j: undefined,
      }),
    ).toEqual({ a: 'x', b: null, c: 0, d: [null, null], e: { f: null }, g: null, h: null, i: null, j: null })
  })

  it('rejects unsupported queries', () => {
    expect(() => mapper.mapInstallmentRatesResponse({})).toThrow(UnsupportedTransactionTypeError)
    expect(() => mapper.mapInstallmentPricesResponse({})).toThrow('Query type [installment_prices] is not supported.')
    expect(() => mapper.mapBinListResponse({})).toThrow(UnsupportedTransactionTypeError)
  })

  it('masks logger context', () => {
    mapper.log()
    expect(logged).toEqual([{ Password: '***' }])
  })
})
