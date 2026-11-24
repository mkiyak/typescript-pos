import { describe, expect, it, vi } from 'vitest'
import { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import type { QueryRequestDataMapperInterface } from '../../../src/data-mapper/pos-query/request/QueryRequestDataMapperInterface.js'
import { UnsupportedTransactionTypeError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { GatewayConfig } from '../../../src/gateway/AbstractGateway.js'
import { noopLogger } from '../../../src/logger.js'
import type { PosQueryDeps } from '../../../src/pos-query/AbstractPosQuery.js'
import { InterPosQuery } from '../../../src/pos-query/InterPosQuery.js'
import type { PosHooks, PosQueryRequestDataPreparedEvent } from '../../../src/types.js'

class StubClient extends AbstractHttpClient {
  supportsTx = () => true
  override request = vi.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({ status: 'success' }))
}

const config: GatewayConfig = posTestConfig.banks.denizbank
const account = AccountFactory.createInterPosAccount('denizbank', '3123', 'InterTestApi', '3', 'gDg1N')
const MAPPED = { bin: '415956', ShopCode: '3123' }

function setup(opts: { config?: GatewayConfig; hooks?: PosHooks } = {}) {
  const mapper = {
    createCustomQueryRequestData: vi.fn((_a: unknown, _d: Record<string, unknown>) => MAPPED),
    createHistoryRequestData: vi.fn(),
    createInstallmentRatesRequestData: vi.fn(),
    createInstallmentPricesRequestData: vi.fn(),
    createBinListRequestData: vi.fn(),
    isTestMode: vi.fn(() => false),
    setTestMode: vi.fn(),
  }
  const stub = new StubClient('https://x.test', new HttpTransport(), noopLogger)
  const deps = {
    requestDataMapper: mapper as unknown as QueryRequestDataMapperInterface<typeof account>,
    clientStrategy: new HttpClientStrategy([stub]),
    logger: noopLogger,
    hooks: opts.hooks ?? {},
  } satisfies PosQueryDeps<typeof account>
  return { q: new InterPosQuery(opts.config ?? config, account, deps), mapper, stub }
}

describe('InterPosQuery', () => {
  it('testInit', () => {
    const { q } = setup()
    expect(q.isTestMode()).toBe(false)
    expect(q.getAccount()).toBe(account)
    // deviation: Q6 stateless API - getResponse()/isSuccess() do not exist, so the null/false checks become absence checks
    expect('getResponse' in q).toBe(false)
    expect('isSuccess' in q).toBe(false)
  })

  it('testSupports', () => {
    expect(InterPosQuery.supports('InterPos')).toBe(true)
    expect(InterPosQuery.supports('AkbankPos')).toBe(false)
  })

  it('testIsSupportedQuery', () => {
    expect(InterPosQuery.isSupportedQuery('custom_query')).toBe(true)
    for (const t of ['history', 'installment_rates', 'installment_prices', 'unknown_query_type']) {
      expect(InterPosQuery.isSupportedQuery(t)).toBe(false)
    }
  })

  it('testTestModeSetViaConfig', () => {
    const { q, mapper } = setup({ config: { ...config, test_mode: true } })
    expect(mapper.setTestMode).toHaveBeenCalledTimes(1)
    expect(mapper.setTestMode).toHaveBeenCalledWith(true)
    expect(q.isTestMode()).toBe(true)
  })

  it('testCustomQuery', async () => {
    const input = { bin: '415956' }
    const hook = vi.fn((e: PosQueryRequestDataPreparedEvent) => {
      expect(e.queryType).toBe('custom_query')
      expect(e.requestData).toEqual(MAPPED)
      expect(e.originalData).toEqual(input)
      expect(e.bankName).toBe('denizbank')
      e.requestData['test-update-request-data-with-event'] = true
    })
    const { q, mapper, stub } = setup({ hooks: { onPosQueryRequestDataPrepared: [hook] } })

    const result = await q.customQuery(input)

    expect(hook).toHaveBeenCalledTimes(1)
    expect(mapper.createCustomQueryRequestData).toHaveBeenCalledWith(account, input)
    expect(stub.request).toHaveBeenCalledWith(
      'custom_query',
      'regular',
      { ...MAPPED, 'test-update-request-data-with-event': true },
      input,
      null,
    )
    // deviation: Q6 stateless API - the getResponse()/isSuccess() state assertions are dropped
    expect(result).toEqual({ status: 'success' })
  })

  // addition: the other query kinds reject without reaching the bank
  it.each([
    ['history', (q: InterPosQuery) => q.history({})],
    ['getInstallmentRates', (q: InterPosQuery) => q.getInstallmentRates({})],
    ['getInstallmentPrices', (q: InterPosQuery) => q.getInstallmentPrices({})],
    ['getBinList', (q: InterPosQuery) => q.getBinList({})],
  ])('%s rejects as unsupported', async (_name, call) => {
    const { q, stub } = setup()
    await expect(call(q)).rejects.toBeInstanceOf(UnsupportedTransactionTypeError)
    expect(stub.request).not.toHaveBeenCalled()
  })
})
