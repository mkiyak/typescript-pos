import { describe, expect, it, vi } from 'vitest'
import { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import type { QueryRequestDataMapperInterface } from '../../../src/data-mapper/pos-query/request/QueryRequestDataMapperInterface.js'
import type { QueryResponseDataMapperInterface } from '../../../src/data-mapper/pos-query/response/QueryResponseDataMapperInterface.js'
import { UnsupportedTransactionTypeError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { GatewayConfig } from '../../../src/gateway/AbstractGateway.js'
import { noopLogger } from '../../../src/logger.js'
import { AbstractMappedPosQuery } from '../../../src/pos-query/AbstractMappedPosQuery.js'
import { VakifKatilimPosQuery } from '../../../src/pos-query/VakifKatilimPosQuery.js'
import type { PosHooks, PosQueryRequestDataPreparedEvent } from '../../../src/types.js'

class StubClient extends AbstractHttpClient {
  supportsTx = () => true
  override request = vi.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({ status: 'success' }))
}

const account = AccountFactory.createBoaPosAccount('vakif-katilim', '1', 'APIUSER', '11111', 'kdsnsksl')
const config: GatewayConfig = { ...posTestConfig.banks['vakif-katilim'], test_mode: undefined }
const REQUEST_DATA = { bin: '415956', MerchantId: '1' }

function setup(opts: { config?: GatewayConfig; hooks?: PosHooks } = {}) {
  const requestMapper = {
    createCustomQueryRequestData: vi.fn((_a: unknown, _d: Record<string, unknown>) => REQUEST_DATA),
    createHistoryRequestData: vi.fn((_a: unknown, _d: Record<string, unknown>) => REQUEST_DATA),
    createInstallmentRatesRequestData: vi.fn(),
    createInstallmentPricesRequestData: vi.fn(),
    createBinListRequestData: vi.fn(),
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
  const q = new VakifKatilimPosQuery(opts.config ?? config, account, {
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
    expect(e.bankName).toBe('vakif-katilim')
    e.requestData['test-update-request-data-with-event'] = true
  })

describe('VakifKatilimPosQuery', () => {
  it('testInit', () => {
    const { q } = setup()
    expect(q.isTestMode()).toBe(false)
    expect(q.getAccount()).toBe(account)
    expect(q).toBeInstanceOf(AbstractMappedPosQuery)
    // deviation: Q6 stateless API - getResponse()/isSuccess() do not exist, so the null/false checks become absence checks
    expect('getResponse' in q).toBe(false)
    expect('isSuccess' in q).toBe(false)
  })

  it('testSupports', () => {
    expect(VakifKatilimPosQuery.supports('VakifKatilimPos')).toBe(true)
    expect(VakifKatilimPosQuery.supports('AkbankPos')).toBe(false)
  })

  it('testIsSupportedQuery', () => {
    for (const t of ['custom_query', 'history']) expect(VakifKatilimPosQuery.isSupportedQuery(t)).toBe(true)
    for (const t of ['installment_rates', 'installment_prices', 'unknown_query_type']) {
      expect(VakifKatilimPosQuery.isSupportedQuery(t)).toBe(false)
    }
  })

  it('testTestModeSetViaConfig', () => {
    const { q, requestMapper } = setup({ config: { ...config, test_mode: true } })
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
    expect(stub.request).toHaveBeenCalledWith(
      'custom_query',
      'regular',
      { ...REQUEST_DATA, 'test-update-request-data-with-event': true },
      input,
      null,
    )
    expect(result).toEqual({ status: 'success' })
  })

  it.each([
    ['approved', { transactions: [] }, { status: 'approved', transactions: [] }],
    ['declined', { error: 'no transactions' }, { status: 'declined', transactions: [] }],
  ])('testHistory %s', async (_name, bankResponse, mapped) => {
    const input = { start_date: new Date() }
    const hook = markHook('history', input)
    const { q, requestMapper, responseMapper, stub } = setup({ hooks: { onPosQueryRequestDataPrepared: [hook] } })
    stub.request.mockResolvedValueOnce(bankResponse)
    responseMapper.mapHistoryResponse.mockReturnValueOnce(mapped)

    const result = await q.history(input)

    expect(requestMapper.createHistoryRequestData).toHaveBeenCalledWith(account, input)
    expect(stub.request).toHaveBeenCalledWith(
      'history',
      'regular',
      { ...REQUEST_DATA, 'test-update-request-data-with-event': true },
      input,
      null,
    )
    expect(responseMapper.mapHistoryResponse).toHaveBeenCalledWith(bankResponse)
    expect(result).toBe(mapped)
  })

  // addition: the bank offers no installment or BIN queries (only the Vakif Katilim gateway has a query class)
  it.each([
    ['getInstallmentRates', (q: VakifKatilimPosQuery) => q.getInstallmentRates({})],
    ['getInstallmentPrices', (q: VakifKatilimPosQuery) => q.getInstallmentPrices({})],
    ['getBinList', (q: VakifKatilimPosQuery) => q.getBinList({})],
  ])('%s rejects as unsupported', async (_name, call) => {
    const { q, stub } = setup()
    await expect(call(q)).rejects.toBeInstanceOf(UnsupportedTransactionTypeError)
    expect(stub.request).not.toHaveBeenCalled()
  })
  // addition: the echoed hashed API password is the merchant's signing secret and must not reach the caller
  it('redacts an echoed HashPassword in custom query and history results', async () => {
    const { q, stub, responseMapper } = setup()
    stub.request.mockResolvedValueOnce({ HashPassword: 'secret', Nested: { hashpassword: 'secret2' }, Ok: 'x' })
    const custom = await q.customQuery({ a: 1 })
    expect(custom).toEqual({ HashPassword: '***', Nested: { hashpassword: '***' }, Ok: 'x' })

    responseMapper.mapHistoryResponse.mockReturnValueOnce({ status: 'approved', all: { HashPassword: 'secret' } })
    const history = await q.history({})
    expect(history.all).toEqual({ HashPassword: '***' })
    expect(JSON.stringify(history)).not.toContain('secret')
  })
})
