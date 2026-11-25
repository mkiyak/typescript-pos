import { describe, expect, it, vi } from 'vitest'
import { AkbankPosQueryRequestDataMapper } from '../../../../../src/data-mapper/pos-query/request/AkbankPosQueryRequestDataMapper.js'
import { AkbankPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/AkbankPosRequestValueFormatter.js'
import { AkbankPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/AkbankPosRequestValueMapper.js'
import { PosError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'

const SECRET =
  '3230323330393034313735303032363031353172675f357637355f3273387373745f7233725f73323333383737335f323272383774767276327672323531355f'
const MERCHANT = '2023090417500272654BD9A49CF07574'
const TERMINAL = '2023090417500284633D137A249DBBEB'
const account = AccountFactory.createAkbankPosAccount('akbank-pos', MERCHANT, TERMINAL, SECRET)

function create(random = 'rand') {
  const generateRandomString = vi.fn(() => random)
  const mapper = new AkbankPosQueryRequestDataMapper(
    new AkbankPosRequestValueMapper(),
    new AkbankPosRequestValueFormatter(),
    { generateRandomString } as never,
  )
  return { mapper, generateRandomString }
}

/** Key order is irrelevant (the reference sorts keys before comparing). */
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

const terminal = { merchantSafeId: MERCHANT, terminalSafeId: TERMINAL }

describe('AkbankPosQueryRequestDataMapper', () => {
  it('testSupports', () => {
    expect(AkbankPosQueryRequestDataMapper.supports('AkbankPos')).toBe(true)
    expect(AkbankPosQueryRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  it('testIsTestMode', () => {
    const { mapper } = create()
    expect(mapper.isTestMode()).toBe(false)
    mapper.setTestMode(true)
    expect(mapper.isTestMode()).toBe(true)
  })

  it.each([
    [
      'link_creation_request',
      {
        txnCode: '1020',
        order: { orderTrackId: 'ae15a6c8-467e-45de-b24c-b98821a42667' },
        transaction: { amount: 1.0, currencyCode: 949, motoInd: 0, installCount: 1 },
      },
      {
        version: '1.00',
        txnCode: '1020',
        randomNumber: 'rand_134',
        terminal,
        order: { orderTrackId: 'ae15a6c8-467e-45de-b24c-b98821a42667' },
        transaction: { amount: 1.0, currencyCode: 949, motoInd: 0, installCount: 1 },
      },
    ],
    [
      'with_pre_set_request_date_time',
      { txnCode: '1020', requestDateTime: '2024-01-01T12:00:00.000' },
      {
        version: '1.00',
        txnCode: '1020',
        randomNumber: 'rand_abc',
        requestDateTime: '2024-01-01T12:00:00.000',
        terminal,
      },
    ],
  ])('testCreateCustomQueryRequestData %s', (name, requestData, expected) => {
    const { mapper, generateRandomString } = create(expected.randomNumber)
    const actual = mapper.createCustomQueryRequestData(account, requestData)

    expect(generateRandomString).toHaveBeenCalledTimes(1)
    expect(String(actual.requestDateTime)).toHaveLength(23)
    if (name === 'link_creation_request') {
      expect(String(actual.requestDateTime)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000$/)
      delete actual.requestDateTime
    }
    expect(sorted(actual)).toEqual(sorted(expected))
  })

  it('testCreateCustomQueryRequestDataWithSubMerchantAccount', () => {
    const sub = AccountFactory.createAkbankPosAccount('akbank-pos', MERCHANT, TERMINAL, SECRET, 'sub-merchant-123')
    const { mapper, generateRandomString } = create('rand_sub')
    const actual = mapper.createCustomQueryRequestData(sub, { txnCode: '1000' }) as {
      subMerchant: { subMerchantId: string }
      terminal: { merchantSafeId: string }
    }

    expect(generateRandomString).toHaveBeenCalledTimes(1)
    expect(actual.subMerchant.subMerchantId).toBe('sub-merchant-123')
    expect(actual.terminal.merchantSafeId).toBe(MERCHANT)
  })

  // addition: caller values stay as given and are never mutated
  it('keeps a caller terminal as given and does not mutate it', () => {
    const { mapper } = create()
    const callerTerminal = { merchantSafeId: 'X', terminalSafeId: 'Y' }
    const input = { txnCode: '1020', terminal: callerTerminal }
    const actual = mapper.createCustomQueryRequestData(account, input)

    expect(actual.terminal).toBe(callerTerminal)
    expect(callerTerminal).toEqual({ merchantSafeId: 'X', terminalSafeId: 'Y' })
    expect(Object.keys(input)).toEqual(['txnCode', 'terminal'])
  })

  // addition: a request time the caller supplies is kept and the current time is not even formatted
  it('does not format the request time when the caller supplies one', () => {
    const formatter = new AkbankPosRequestValueFormatter()
    const spy = vi.spyOn(formatter, 'formatDateTime')
    const mapper = new AkbankPosQueryRequestDataMapper(new AkbankPosRequestValueMapper(), formatter, {
      generateRandomString: () => 'rand',
    } as never)

    const supplied = mapper.createCustomQueryRequestData(account, {
      txnCode: '1020',
      requestDateTime: '2024-01-01T12:00:00.000',
    })
    expect(supplied.requestDateTime).toBe('2024-01-01T12:00:00.000')
    expect(spy).not.toHaveBeenCalled()

    const missing = mapper.createCustomQueryRequestData(account, { txnCode: '1020', requestDateTime: undefined })
    expect(String(missing.requestDateTime)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000$/)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  // addition: a batch number is a positive integer (number or digit text)
  it.each([
    [39, 39],
    ['39', '39'],
  ])('history accepts batch_num %j', (batch, want) => {
    const { mapper } = create()
    expect(mapper.createHistoryRequestData(account, { batch_num: batch }).report).toEqual({ batchNumber: want })
  })

  it.each([[''], ['abc'], [Number.NaN], [0], [-1], [1.5], ['0'], ['-3'], ['1.5'], [' 3'], [{}], [['1']], [true]])(
    'history rejects batch_num %j',
    (batch) => {
      const { mapper } = create()
      expect(() => mapper.createHistoryRequestData(account, { batch_num: batch })).toThrow(PosError)
    },
  )

  it.each([
    [
      'with_batch_number',
      { batch_num: 39 },
      { terminal, report: { batchNumber: 39 }, randomNumber: '128-character-random-string' },
    ],
    [
      'with_date_range',
      // deviation: A12 instants with an explicit +03:00 offset replace the reference's zone-less local times
      { start_date: new Date('2024-04-13T13:00:00+03:00'), end_date: new Date('2024-04-14T13:00:00+03:00') },
      {
        terminal,
        report: { startDateTime: '2024-04-13T13:00:00.000', endDateTime: '2024-04-14T13:00:00.000' },
        randomNumber: '128-character-random-string',
      },
    ],
  ])('testCreateHistoryRequestData %s', (_name, data, expected) => {
    const { mapper, generateRandomString } = create(expected.randomNumber)
    const actual = mapper.createHistoryRequestData(account, data)

    expect(generateRandomString).toHaveBeenCalledTimes(1)
    expect(sorted(actual)).toEqual(sorted(expected))
  })

  // addition: the reference silently sent no report; the bank would reject it
  it.each([
    ['empty', {}],
    ['only a start date', { start_date: new Date() }],
    ['a string date', { start_date: 'yesterday', end_date: new Date() }],
    ['an invalid date', { start_date: new Date('x'), end_date: new Date() }],
  ])('history rejects %s', (_name, data) => {
    const { mapper } = create()
    expect(() => mapper.createHistoryRequestData(account, data)).toThrow(PosError)
  })

  it('history adds the sub-merchant of a sub-merchant account', () => {
    const sub = AccountFactory.createAkbankPosAccount('akbank-pos', MERCHANT, TERMINAL, SECRET, 'sub-1')
    const { mapper } = create()
    expect(mapper.createHistoryRequestData(sub, { batch_num: 1 }).subMerchant).toEqual({ subMerchantId: 'sub-1' })
  })
})
