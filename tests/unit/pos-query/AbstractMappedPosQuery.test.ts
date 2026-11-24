import { describe, expect, it, vi } from 'vitest'
import { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import type { QueryRequestDataMapperInterface } from '../../../src/data-mapper/pos-query/request/QueryRequestDataMapperInterface.js'
import type { QueryResponseDataMapperInterface } from '../../../src/data-mapper/pos-query/response/QueryResponseDataMapperInterface.js'
import { UnsupportedTransactionTypeError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { GatewayConfig } from '../../../src/gateway/AbstractGateway.js'
import { noopLogger } from '../../../src/logger.js'
import type { AssecoPosAccount } from '../../../src/model/account/AssecoPosAccount.js'
import { AbstractMappedPosQuery } from '../../../src/pos-query/AbstractMappedPosQuery.js'

// addition: covers the mapped query base class.

class TestMappedQuery extends AbstractMappedPosQuery<AssecoPosAccount> {
  static override readonly GATEWAY_CLASS = 'AssecoPos'
  protected static override supportedQueries = { custom_query: true, history: true, bin_list: true }
}

class StubClient extends AbstractHttpClient {
  supportsTx = () => true
  override request = vi.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({ raw: true }))
}

const config: GatewayConfig = {
  name: 'Test',
  class: 'AssecoPos',
  gateway_endpoints: { payment_api: 'https://entegrasyon.asseco-see.com.tr/fim/api' },
}
const account = AccountFactory.createAssecoPosAccount('akbank', '700655000200', 'ISBANKAPI', 'ISBANK07', 'TRPS0200')

function setup() {
  const requestDataMapper = {
    createCustomQueryRequestData: vi.fn((_a: unknown, d: Record<string, unknown>) => ({ ...d })),
    createHistoryRequestData: vi.fn((_a: unknown, d: Record<string, unknown>) => ({ h: d })),
    createInstallmentRatesRequestData: vi.fn(),
    createInstallmentPricesRequestData: vi.fn(),
    createBinListRequestData: vi.fn((_a: unknown, d: Record<string, unknown>) => ({ b: d })),
    isTestMode: vi.fn(() => false),
    setTestMode: vi.fn(),
  }
  const responseDataMapper = {
    mapHistoryResponse: vi.fn(() => ({ status: 'approved', mapped: 'history' })),
    mapInstallmentRatesResponse: vi.fn(),
    mapInstallmentPricesResponse: vi.fn(),
    mapBinListResponse: vi.fn(() => ({ status: 'approved', mapped: 'bin' })),
  }
  const stub = new StubClient('https://x.test', new HttpTransport(), noopLogger)
  const hook = vi.fn()
  const q = new TestMappedQuery(config, account, {
    requestDataMapper: requestDataMapper as unknown as QueryRequestDataMapperInterface<AssecoPosAccount>,
    responseDataMapper: responseDataMapper as unknown as QueryResponseDataMapperInterface,
    clientStrategy: new HttpClientStrategy([stub]),
    logger: noopLogger,
    hooks: { onPosQueryRequestDataPrepared: [hook] },
  })
  return { q, requestDataMapper, responseDataMapper, stub, hook }
}

describe('AbstractMappedPosQuery', () => {
  it('history: maps the request, runs the hook, sends, maps the response', async () => {
    const { q, requestDataMapper, responseDataMapper, stub, hook } = setup()
    const input = { start_date: 'x' }
    const result = await q.history(input)

    expect(requestDataMapper.createHistoryRequestData).toHaveBeenCalledWith(account, input)
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook.mock.calls[0]?.[0]).toMatchObject({ queryType: 'history', originalData: input })
    expect(stub.request).toHaveBeenCalledWith('history', 'regular', { h: input }, input, null)
    expect(responseDataMapper.mapHistoryResponse).toHaveBeenCalledWith({ raw: true })
    expect(result).toEqual({ status: 'approved', mapped: 'history' })
  })

  it('getBinList behaves the same way with bin_list', async () => {
    const { q, requestDataMapper, stub, hook } = setup()
    const input = { bin: '415956' }
    const result = await q.getBinList(input)

    expect(requestDataMapper.createBinListRequestData).toHaveBeenCalledWith(account, input)
    expect(hook.mock.calls[0]?.[0]).toMatchObject({ queryType: 'bin_list' })
    expect(stub.request).toHaveBeenCalledWith('bin_list', 'regular', { b: input }, input, null)
    expect(result).toEqual({ status: 'approved', mapped: 'bin' })
  })

  it.each([
    ['getInstallmentRates', (q: TestMappedQuery) => q.getInstallmentRates({})],
    ['getInstallmentPrices', (q: TestMappedQuery) => q.getInstallmentPrices({})],
  ])('%s rejects when unsupported, before any mapper', async (_n, call) => {
    const { q, requestDataMapper, stub } = setup()
    await expect(call(q)).rejects.toBeInstanceOf(UnsupportedTransactionTypeError)
    expect(requestDataMapper.createInstallmentRatesRequestData).not.toHaveBeenCalled()
    expect(requestDataMapper.createInstallmentPricesRequestData).not.toHaveBeenCalled()
    expect(stub.request).not.toHaveBeenCalled()
  })

  it('customQuery is inherited', async () => {
    const { q, stub } = setup()
    expect(await q.customQuery({ a: 1 })).toEqual({ raw: true })
    expect(stub.request.mock.calls[0]?.[0]).toBe('custom_query')
  })
})
