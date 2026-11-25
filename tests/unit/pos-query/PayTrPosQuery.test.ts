import { describe, expect, it, vi } from 'vitest'
import { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import type { QueryRequestDataMapperInterface } from '../../../src/data-mapper/pos-query/request/QueryRequestDataMapperInterface.js'
import type { QueryResponseDataMapperInterface } from '../../../src/data-mapper/pos-query/response/QueryResponseDataMapperInterface.js'
import { PosError, UnsupportedTransactionTypeError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { GatewayConfig } from '../../../src/gateway/AbstractGateway.js'
import { noopLogger } from '../../../src/logger.js'
import { AbstractMappedPosQuery } from '../../../src/pos-query/AbstractMappedPosQuery.js'
import { PayTrPosQuery } from '../../../src/pos-query/PayTrPosQuery.js'
import type { PosHooks, PosQueryRequestDataPreparedEvent } from '../../../src/types.js'

class StubClient extends AbstractHttpClient {
  supportsTx = () => true
  override request = vi.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({ status: 'success' }))
}

const account = AccountFactory.createPayTrPosAccount('paytr', '123456', 'wWwU8buJp6jo1r25', 'YEUaNcdHXqyt7hjt')
// deviation: the shipped test config sets test_mode, the init case needs it unset
const config: GatewayConfig = { ...posTestConfig.banks.paytr, test_mode: undefined }
const REQUEST_DATA = { merchant_id: '123456', bin_number: '415956', paytr_token: 'tok' }

function setup(opts: { config?: GatewayConfig; hooks?: PosHooks } = {}) {
  const requestMapper = {
    createCustomQueryRequestData: vi.fn((_a: unknown, _d: Record<string, unknown>) => REQUEST_DATA),
    createHistoryRequestData: vi.fn((_a: unknown, _d: Record<string, unknown>) => REQUEST_DATA),
    createInstallmentRatesRequestData: vi.fn((_a: unknown, _d: Record<string, unknown>) => REQUEST_DATA),
    createInstallmentPricesRequestData: vi.fn(),
    createBinListRequestData: vi.fn((_a: unknown, _d: Record<string, unknown>) => REQUEST_DATA),
    isTestMode: vi.fn(() => false),
    setTestMode: vi.fn(),
  }
  const responseMapper = {
    mapHistoryResponse: vi.fn(),
    mapInstallmentRatesResponse: vi.fn(),
    mapInstallmentPricesResponse: vi.fn(),
    mapBinListResponse: vi.fn(),
  }
  const stub = new StubClient('https://x.test', new HttpTransport(), noopLogger)
  const q = new PayTrPosQuery(opts.config ?? config, account, {
    requestDataMapper: requestMapper as unknown as QueryRequestDataMapperInterface<typeof account>,
    responseDataMapper: responseMapper as unknown as QueryResponseDataMapperInterface,
    clientStrategy: new HttpClientStrategy([stub]),
    logger: noopLogger,
    hooks: opts.hooks ?? {},
  })
  return { q, requestMapper, responseMapper, stub }
}

const markHook = (expectedType: string, input: Record<string, unknown>) =>
  vi.fn((e: PosQueryRequestDataPreparedEvent) => {
    expect(e.queryType).toBe(expectedType)
    expect(e.requestData).toEqual(REQUEST_DATA)
    expect(e.originalData).toEqual(input)
    expect(e.bankName).toBe('paytr')
    e.requestData['test-update-request-data-with-event'] = true
  })

const HOOKED = { ...REQUEST_DATA, 'test-update-request-data-with-event': true }

describe('PayTrPosQuery', () => {
  it('testInit', () => {
    const { q } = setup()
    expect(q.isTestMode()).toBe(false)
    expect(q.getAccount()).toBe(account)
    expect(q).toBeInstanceOf(AbstractMappedPosQuery)
    // deviation: the API is stateless, so getResponse()/isSuccess() do not exist
    expect('getResponse' in q).toBe(false)
    expect('isSuccess' in q).toBe(false)
  })

  it('testSupports', () => {
    expect(PayTrPosQuery.supports('PayTrPos')).toBe(true)
    expect(PayTrPosQuery.supports('AkbankPos')).toBe(false)
  })

  it('testIsSupportedQuery', () => {
    for (const t of ['custom_query', 'history', 'installment_rates', 'bin_list']) {
      expect(PayTrPosQuery.isSupportedQuery(t)).toBe(true)
    }
    for (const t of ['installment_prices', 'unknown_query_type']) expect(PayTrPosQuery.isSupportedQuery(t)).toBe(false)
  })

  it('testTestModeSetViaConfig', () => {
    const { q, requestMapper } = setup({ config: { ...posTestConfig.banks.paytr, test_mode: true } })
    expect(requestMapper.setTestMode).toHaveBeenCalledTimes(1)
    expect(requestMapper.setTestMode).toHaveBeenCalledWith(true)
    expect(q.isTestMode()).toBe(true)
  })

  it('testCustomQuery', async () => {
    const input = { bin: '415956' }
    const hook = markHook('custom_query', input)
    const { q, requestMapper, stub } = setup({ hooks: { onPosQueryRequestDataPrepared: [hook] } })

    const result = await q.customQuery(input)

    expect(hook).toHaveBeenCalledTimes(1)
    expect(requestMapper.createCustomQueryRequestData).toHaveBeenCalledWith(account, input)
    expect(stub.request).toHaveBeenCalledWith('custom_query', 'regular', HOOKED, input, null)
    // deviation: the answer is returned, nothing is stored on the query object
    expect(result).toEqual({ status: 'success' })
  })

  it.each([
    ['approved', { transactions: [] }, { status: 'approved', transactions: [] }],
    ['declined', { error: 'no transactions' }, { status: 'declined', transactions: [] }],
  ])('testHistory %s', async (_name, bankResponse, mapped) => {
    const input = { start_date: new Date(), end_date: new Date() }
    const hook = markHook('history', input)
    const { q, requestMapper, responseMapper, stub } = setup({ hooks: { onPosQueryRequestDataPrepared: [hook] } })
    stub.request.mockResolvedValueOnce(bankResponse)
    responseMapper.mapHistoryResponse.mockReturnValueOnce(mapped)

    const result = await q.history(input)

    expect(requestMapper.createHistoryRequestData).toHaveBeenCalledWith(account, input)
    expect(stub.request).toHaveBeenCalledWith('history', 'regular', HOOKED, input, null)
    expect(responseMapper.mapHistoryResponse).toHaveBeenCalledWith(bankResponse)
    expect(result).toBe(mapped)
  })

  it.each([
    ['approved', { installmentRates: [] }, { status: 'approved', installment_rates: [] }],
    ['declined', { error: 'invalid bin' }, { status: 'declined', installment_rates: [] }],
  ])('testGetInstallmentRates %s', async (_name, bankResponse, mapped) => {
    const input = { bin: '415956' }
    const hook = markHook('installment_rates', input)
    const { q, requestMapper, responseMapper, stub } = setup({ hooks: { onPosQueryRequestDataPrepared: [hook] } })
    stub.request.mockResolvedValueOnce(bankResponse)
    responseMapper.mapInstallmentRatesResponse.mockReturnValueOnce(mapped)

    const result = await q.getInstallmentRates(input)

    expect(requestMapper.createInstallmentRatesRequestData).toHaveBeenCalledWith(account, input)
    expect(stub.request).toHaveBeenCalledWith('installment_rates', 'regular', HOOKED, input, null)
    expect(responseMapper.mapInstallmentRatesResponse).toHaveBeenCalledWith(bankResponse)
    expect(result).toBe(mapped)
  })

  it.each([
    [
      'approved',
      { status: 'success', cardType: 'credit', schema: 'VISA' },
      { status: 'approved', bin_list: [{ card_type: 'credit', organization: 'VISA' }] },
    ],
    ['declined', { status: 'failed' }, { status: 'declined', bin_list: [] }],
  ])('testGetBinList %s', async (_name, bankResponse, mapped) => {
    const input = { bin: '415956' }
    const hook = markHook('bin_list', input)
    const { q, requestMapper, responseMapper, stub } = setup({ hooks: { onPosQueryRequestDataPrepared: [hook] } })
    stub.request.mockResolvedValueOnce(bankResponse)
    responseMapper.mapBinListResponse.mockReturnValueOnce(mapped)

    const result = await q.getBinList(input)

    expect(requestMapper.createBinListRequestData).toHaveBeenCalledWith(account, input)
    expect(stub.request).toHaveBeenCalledWith('bin_list', 'regular', HOOKED, input, null)
    expect(responseMapper.mapBinListResponse).toHaveBeenCalledWith(bankResponse)
    expect(result).toBe(mapped)
  })

  // addition: installment prices are not offered; nothing is built or sent
  it('getInstallmentPrices rejects as unsupported without building or sending anything', async () => {
    const { q, stub, requestMapper } = setup()
    await expect(q.getInstallmentPrices({ amount: 10 })).rejects.toBeInstanceOf(UnsupportedTransactionTypeError)
    expect(requestMapper.createInstallmentPricesRequestData).not.toHaveBeenCalled()
    expect(stub.request).not.toHaveBeenCalled()
  })

  // addition: the URL guard runs before the mapper adds credentials or signs anything
  it('customQuery to a foreign origin or plain http rejects before the mapper or the client is touched', async () => {
    const { q, stub, requestMapper } = setup()
    for (const url of ['https://evil.example/odeme', 'http://www.paytr.com/odeme', 'https://user:p@www.paytr.com/x']) {
      await expect(q.customQuery({ merchant_oid: 'X' }, url)).rejects.toBeInstanceOf(PosError)
    }
    expect(requestMapper.createCustomQueryRequestData).not.toHaveBeenCalled()
    expect(stub.request).not.toHaveBeenCalled()
  })

  // addition: no credential reaches a JSON or inspect dump of the query object
  it('a JSON or inspect dump of the query contains no secret', async () => {
    const { inspect } = await import('node:util')
    const { q } = setup()
    for (const dump of [JSON.stringify(q), inspect(q, { depth: 6, showHidden: true })]) {
      expect(dump).not.toContain('wWwU8buJp6jo1r25')
      expect(dump).not.toContain('YEUaNcdHXqyt7hjt')
    }
  })
})
