import { describe, expect, it, vi } from 'vitest'
import { GarantiPosCrypt } from '../../../../../src/crypt/GarantiPosCrypt.js'
import { GarantiPosQueryRequestDataMapper } from '../../../../../src/data-mapper/pos-query/request/GarantiPosQueryRequestDataMapper.js'
import { GarantiPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/GarantiPosRequestValueFormatter.js'
import { GarantiPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/GarantiPosRequestValueMapper.js'
import { PosError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { noopLogger } from '../../../../../src/logger.js'
import { CARD_CLASS } from '../../../../../src/PosInterface.js'

const account = AccountFactory.createGarantiPosAccount(
  'garanti',
  '7000679',
  'PROVAUT',
  '123qweASD/',
  '30691298',
  '12345678',
  'PROVRFN',
  '123qweASD/',
)

function create(hash = 'mocked_hash') {
  const createHash = vi.fn((_a: unknown, _d: Record<string, unknown>) => hash)
  const crypt = { createHash, generateRandomString: () => '' }
  const mapper = new GarantiPosQueryRequestDataMapper(
    new GarantiPosRequestValueMapper(),
    new GarantiPosRequestValueFormatter(),
    crypt as never,
  )
  mapper.setTestMode(true)
  return { mapper, createHash }
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

const terminal = (hash: string) => ({
  ProvUserID: 'PROVAUT',
  UserID: 'PROVAUT',
  HashData: hash,
  ID: '30691298',
  MerchantID: '7000679',
})

describe('GarantiPosQueryRequestDataMapper', () => {
  it('testSupports', () => {
    expect(GarantiPosQueryRequestDataMapper.supports('GarantiPos')).toBe(true)
    expect(GarantiPosQueryRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  it('testIsTestMode', () => {
    const { mapper } = create()
    expect(mapper.isTestMode()).toBe(true)
    mapper.setTestMode(false)
    expect(mapper.isTestMode()).toBe(false)
  })

  describe('createCustomQueryRequestData', () => {
    it('without_terminal_data', () => {
      const { mapper, createHash } = create('generated_hash')
      const actual = mapper.createCustomQueryRequestData(account, {
        Version: 'v0.00',
        Customer: { IPAddress: '1.1.111.111' },
        Order: { OrderID: 'ORDER123' },
        Transaction: { Type: 'bininq', Amount: '1' },
      })
      expect(createHash).toHaveBeenCalledTimes(1)
      expect(sorted(actual)).toEqual(
        sorted({
          Customer: { IPAddress: '1.1.111.111' },
          Mode: 'TEST',
          Order: { OrderID: 'ORDER123' },
          Terminal: terminal('generated_hash'),
          Transaction: { Type: 'bininq', Amount: '1' },
          Version: 'v0.00',
        }),
      )
    })

    it('with_terminal_and_hash_already_set', () => {
      const { mapper, createHash } = create()
      const input = {
        Mode: 'TEST',
        Version: 'v0.00',
        Customer: { IPAddress: '1.1.111.111' },
        Order: { OrderID: 'ORDER123' },
        Terminal: {
          ProvUserID: 'CUSTOM_USER',
          UserID: 'CUSTOM_USER',
          HashData: 'pre_set_hash',
          ID: 'CUSTOM_TERMINAL',
          MerchantID: 'CUSTOM_MERCHANT',
        },
        Transaction: { Type: 'bininq', Amount: '1' },
      }
      const actual = mapper.createCustomQueryRequestData(account, input)
      expect(createHash).not.toHaveBeenCalled()
      expect(sorted(actual)).toEqual(sorted(input))
    })

    // addition: the caller's objects are never mutated
    it('does not mutate the caller Terminal object', () => {
      const { mapper } = create('h')
      const callerTerminal = { ID: 'T' }
      const input = { Order: { OrderID: 'O1' }, Terminal: callerTerminal }
      const actual = mapper.createCustomQueryRequestData(account, input)
      expect(callerTerminal).toEqual({ ID: 'T' })
      expect(input.Terminal).toBe(callerTerminal)
      expect((actual.Terminal as Record<string, unknown>).HashData).toBe('h')
      expect(actual.Terminal).not.toBe(callerTerminal)
    })

    // addition: G15 a terminal without a signature gets one
    it('adds the HashData to a Terminal without one and calls createHash once', () => {
      const { mapper, createHash } = create('h')
      const actual = mapper.createCustomQueryRequestData(account, { Terminal: { ID: 'T' } })
      expect(createHash).toHaveBeenCalledTimes(1)
      expect(actual.Terminal).toEqual({ ID: 'T', HashData: 'h' })
    })

    // addition: G15 an empty signature counts as missing
    it('signs a Terminal whose HashData is empty', () => {
      const { mapper } = create('h')
      const actual = mapper.createCustomQueryRequestData(account, { Terminal: { ID: 'T', HashData: '' } })
      expect((actual.Terminal as Record<string, unknown>).HashData).toBe('h')
    })

    // addition: G15 a Terminal that is not an object
    it.each([['x'], [null], [['a']], [5]])('rejects a non-object Terminal %j', (value) => {
      const { mapper } = create()
      expect(() => mapper.createCustomQueryRequestData(account, { Terminal: value })).toThrow(PosError)
    })

    // addition: G15 an undefined value counts as not provided
    it('fills an undefined Mode', () => {
      const { mapper } = create()
      const actual = mapper.createCustomQueryRequestData(account, { Mode: undefined, Version: 'v1' })
      expect(actual.Mode).toBe('TEST')
      expect(actual.Version).toBe('v1')
    })

    // addition: Q5 caller keys come first
    it('keeps the caller keys first', () => {
      const { mapper } = create()
      const actual = mapper.createCustomQueryRequestData(account, { Order: { OrderID: 'O' }, Version: 'v1' })
      expect(Object.keys(actual)).toEqual(['Order', 'Version', 'Mode', 'Terminal'])
    })
  })

  describe('createHistoryRequestData', () => {
    const expectedOrder = (page: number) => ({
      OrderID: null,
      GroupID: null,
      Description: null,
      StartDate: '18/05/2022 00:00',
      EndDate: '18/05/2022 23:59',
      ListPageNum: page,
    })
    const expected = (page: number) => ({
      Customer: { IPAddress: '127.0.0.1' },
      Mode: 'TEST',
      Order: expectedOrder(page),
      Terminal: terminal('mocked_hash'),
      Transaction: {
        Type: 'orderlistinq',
        Amount: 100,
        CurrencyCode: '949',
        CardholderPresentCode: '0',
        MotoInd: 'N',
      },
      Version: '512',
    })
    // deviation: G9 the instants are Türkiye wall-clock times
    const base = {
      start_date: new Date('2022-05-18T00:00:00+03:00'),
      end_date: new Date('2022-05-18T23:59:59+03:00'),
      ip: '127.0.0.1',
    }

    it.each([
      ['date_range', base, 1],
      ['date_range_with_page', { ...base, page: 2 }, 2],
    ])('%s', (_name, data, page) => {
      const { mapper, createHash } = create()
      const hashInput = expected(page)
      hashInput.Terminal.HashData = ''

      const actual = mapper.createHistoryRequestData(account, data)

      expect(createHash).toHaveBeenCalledTimes(1)
      expect(createHash).toHaveBeenCalledWith(account, hashInput)
      expect(sorted(actual)).toEqual(sorted(expected(page)))
    })

    // addition: G19 required fields
    it('rejects a missing ip', () => {
      const { mapper } = create()
      expect(() => mapper.createHistoryRequestData(account, { ...base, ip: undefined })).toThrow(PosError)
    })

    it.each([['yesterday'], [undefined], [new Date('invalid')]])('rejects start_date %j', (value) => {
      const { mapper } = create()
      expect(() => mapper.createHistoryRequestData(account, { ...base, start_date: value })).toThrow(PosError)
    })

    it('rejects a missing end_date', () => {
      const { mapper } = create()
      expect(() => mapper.createHistoryRequestData(account, { ...base, end_date: undefined })).toThrow(PosError)
    })
  })

  describe('createBinListRequestData', () => {
    const expected = (card: string, bin?: string) => ({
      Customer: { IPAddress: '127.0.0.1' },
      Mode: 'TEST',
      Order: { OrderID: '' },
      Terminal: terminal('mocked_bin_hash'),
      Transaction: {
        Type: 'bininq',
        Amount: 100,
        BINInq: { Group: 'A', CardType: card, ...(bin === undefined ? {} : { BINNum: bin }) },
      },
      Version: 'v0.1',
    })

    it.each([
      ['no_bin_filter', { ip: '127.0.0.1' }, expected('A')],
      ['with_bin_filter', { ip: '127.0.0.1', bin: '415956' }, expected('A', '415956')],
      ['with_card_class_credit', { ip: '127.0.0.1', card_class: CARD_CLASS.CREDIT }, expected('C')],
      [
        'with_bin_and_card_class_debit',
        { ip: '127.0.0.1', bin: '415956', card_class: CARD_CLASS.DEBIT },
        expected('D', '415956'),
      ],
    ])('%s', (_name, params, want) => {
      const { mapper, createHash } = create('mocked_bin_hash')
      const hashInput = structuredClone(want)
      hashInput.Terminal.HashData = ''

      const actual = mapper.createBinListRequestData(account, params)

      expect(createHash).toHaveBeenCalledTimes(1)
      expect(createHash).toHaveBeenCalledWith(account, hashInput)
      expect(sorted(actual)).toEqual(sorted(want))
    })

    // addition: G19 required ip
    it('rejects a missing ip', () => {
      const { mapper } = create()
      expect(() => mapper.createBinListRequestData(account, {})).toThrow(PosError)
    })

    // addition: the real crypt generates the order id and signs
    it('uses a random 24 character order id and a 128 hex signature with the real crypt', () => {
      const mapper = new GarantiPosQueryRequestDataMapper(
        new GarantiPosRequestValueMapper(),
        new GarantiPosRequestValueFormatter(),
        new GarantiPosCrypt(noopLogger),
      )
      mapper.setTestMode(true)
      const actual = mapper.createBinListRequestData(account, { ip: '127.0.0.1' })
      expect((actual.Order as Record<string, string>).OrderID).toMatch(/^[0-9A-F]{24}$/)
      expect((actual.Terminal as Record<string, string>).HashData).toMatch(/^[0-9A-F]{128}$/)
    })
  })

  // addition: installment queries stay unsupported
  it('keeps the installment queries unsupported', () => {
    const { mapper } = create()
    expect(() => mapper.createInstallmentRatesRequestData(account, {})).toThrow(UnsupportedTransactionTypeError)
    expect(() => mapper.createInstallmentPricesRequestData(account, {})).toThrow(UnsupportedTransactionTypeError)
  })
})
