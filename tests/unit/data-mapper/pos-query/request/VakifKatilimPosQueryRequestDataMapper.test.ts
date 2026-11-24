import { describe, expect, it, vi } from 'vitest'
import type { CryptInterface } from '../../../../../src/crypt/CryptInterface.js'
import { KuveytPosCrypt } from '../../../../../src/crypt/KuveytPosCrypt.js'
import { VakifKatilimPosQueryRequestDataMapper } from '../../../../../src/data-mapper/pos-query/request/VakifKatilimPosQueryRequestDataMapper.js'
import { VakifKatilimPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/VakifKatilimPosRequestValueFormatter.js'
import { VakifKatilimPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/VakifKatilimPosRequestValueMapper.js'
import { PosError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { noopLogger } from '../../../../../src/logger.js'

const account = AccountFactory.createBoaPosAccount('vakif-katilim', '1', 'APIUSER', '11111', 'kdsnsksl')

function create(crypt: CryptInterface<never>) {
  return new VakifKatilimPosQueryRequestDataMapper(
    new VakifKatilimPosRequestValueMapper(),
    new VakifKatilimPosRequestValueFormatter(),
    crypt,
  )
}

function stubCrypt() {
  const createHash = vi.fn(() => 'mocked_hash')
  return { createHash, crypt: { createHash } as unknown as CryptInterface<never> }
}

const START = new Date('2024-03-30T00:00:00+03:00') // deviation: B13 explicit instants instead of server-local dates
const END = new Date('2024-03-31T00:00:00+03:00') // deviation: B13

describe('VakifKatilimPosQueryRequestDataMapper', () => {
  it('testSupports', () => {
    expect(VakifKatilimPosQueryRequestDataMapper.supports('VakifKatilimPos')).toBe(true)
    expect(VakifKatilimPosQueryRequestDataMapper.supports('AssecoPos')).toBe(false)
    expect(VakifKatilimPosQueryRequestDataMapper.supports('KuveytPos')).toBe(false)
  })

  it('testIsTestMode', () => {
    const mapper = create(stubCrypt().crypt)
    expect(mapper.isTestMode()).toBe(false)
    mapper.setTestMode(true)
    expect(mapper.isTestMode()).toBe(true)
  })

  it('testCreateCustomQueryRequestDataIsPassthrough', () => {
    const requestData = { SomeField: 'value' }
    expect(create(stubCrypt().crypt).createCustomQueryRequestData(account, requestData)).toBe(requestData)
  })

  const cases = [
    ['default_page_and_size', { page: 1, page_size: 10 }, 0, 10],
    ['page_2', { page: 2, page_size: 5 }, 5, 5],
  ] as const
  it.each(cases)('testCreateHistoryRequestData %s', (_name, paging, lower, upper) => {
    const { crypt, createHash } = stubCrypt()
    const expected = {
      MerchantId: '1',
      CustomerId: '11111',
      UserName: 'APIUSER',
      SubMerchantId: '0',
      StartDate: '2024-03-30',
      EndDate: '2024-03-31',
      LowerLimit: lower,
      UpperLimit: upper,
      ProvNumber: null,
      OrderStatus: null,
      TranResult: null,
      OrderNo: null,
      HashData: 'mocked_hash',
    }
    const actual = create(crypt).createHistoryRequestData(account, { start_date: START, end_date: END, ...paging })

    const { HashData: _hash, ...hashInput } = expected
    expect(createHash).toHaveBeenCalledTimes(1)
    expect(createHash).toHaveBeenCalledWith(account, hashInput)
    expect(actual).toEqual(expected)
    expect(Object.keys(actual)).toEqual(Object.keys(expected))
  })

  // addition: paging defaults and strict validation
  it('defaults to page 1 and a page size of 10', () => {
    const actual = create(stubCrypt().crypt).createHistoryRequestData(account, { start_date: START, end_date: END })
    expect(actual.LowerLimit).toBe(0)
    expect(actual.UpperLimit).toBe(10)
  })

  it.each([
    ['page 0', { page: 0 }],
    ['negative page', { page: -1 }],
    ['fractional page', { page: 1.5 }],
    ['text page', { page: '1' }],
    ['page_size as text', { page_size: '5' }],
    ['page_size 0', { page_size: 0 }],
    ['page_size NaN', { page_size: Number.NaN }],
  ])('rejects %s', (_name, paging) => {
    expect(() =>
      create(stubCrypt().crypt).createHistoryRequestData(account, { start_date: START, end_date: END, ...paging }),
    ).toThrow(PosError)
  })

  it.each([
    ['text start_date', { start_date: '2024-03-30', end_date: END }],
    ['missing start_date', { end_date: END }],
    ['missing end_date', { start_date: START }],
    ['invalid end_date', { start_date: START, end_date: new Date('nope') }],
  ])('rejects %s and signs nothing', (_name, data) => {
    const { crypt, createHash } = stubCrypt()
    expect(() => create(crypt).createHistoryRequestData(account, data)).toThrow(PosError)
    expect(createHash).not.toHaveBeenCalled()
  })

  // addition: the real signature covers the merchant id and the user name (RV3)
  it('signs with the real crypt: HashData equals the request signature over MerchantId and UserName', () => {
    const real = create(new KuveytPosCrypt(noopLogger) as unknown as CryptInterface<never>)
    const actual = real.createHistoryRequestData(account, { start_date: START, end_date: END })
    expect(actual.HashData).toBe('58xhdJGlgIZtsid8cvSDlr8EItk=')
  })

  // addition: the caller's data is not modified, a sub merchant id is sent when the account has one
  it('does not mutate the caller data and sends the sub merchant id', () => {
    const sub = AccountFactory.createBoaPosAccount('vakif-katilim', '1', 'APIUSER', '11111', 'kdsnsksl', '77')
    const data = { start_date: START, end_date: END }
    const actual = create(stubCrypt().crypt).createHistoryRequestData(sub, data)
    expect(Object.keys(data)).toEqual(['start_date', 'end_date'])
    expect(actual.SubMerchantId).toBe('77')
  })

  it('other queries are unsupported', () => {
    const mapper = create(stubCrypt().crypt)
    expect(() => mapper.createBinListRequestData(account, {})).toThrow()
    expect(() => mapper.createInstallmentRatesRequestData(account, {})).toThrow()
  })
})
