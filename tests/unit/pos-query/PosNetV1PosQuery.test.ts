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
import { PosNetV1PosQuery } from '../../../src/pos-query/PosNetV1PosQuery.js'
import type { PosHooks, PosQueryRequestDataPreparedEvent } from '../../../src/types.js'

class StubClient extends AbstractHttpClient {
  supportsTx = () => true
  override request = vi.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({ status: 'success' }))
}

const config: GatewayConfig = posTestConfig.banks.albaraka
const account = AccountFactory.createPosNetPosAccount('albaraka', '6700950031', '67005551', '27426', 'k')
// deviation: 6.11 the stubbed mapper answer uses this gateway's JSON key `MerchantNo`; the XML gateway's fixture calls it `mid`
const MAPPED = { bin: '415956', MerchantNo: '6700950031' }

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
  return { q: new PosNetV1PosQuery(opts.config ?? config, account, deps), mapper, stub }
}

describe('PosNetV1PosQuery', () => {
  it('testInit', () => {
    const { q } = setup()
    expect(q.isTestMode()).toBe(false)
    expect(q.getAccount()).toBe(account)
    // deviation: Q6 stateless API - getResponse()/isSuccess() do not exist, so the reference null/false checks become absence checks
    expect('getResponse' in q).toBe(false)
    expect('isSuccess' in q).toBe(false)
  })

  it('testSupports', () => {
    expect(PosNetV1PosQuery.supports('PosNetV1Pos')).toBe(true)
    expect(PosNetV1PosQuery.supports('AkbankPos')).toBe(false)
  })

  it('testIsSupportedQuery', () => {
    expect(PosNetV1PosQuery.isSupportedQuery('custom_query')).toBe(true)
    for (const t of ['history', 'installment_rates', 'installment_prices', 'unknown_query_type']) {
      expect(PosNetV1PosQuery.isSupportedQuery(t)).toBe(false)
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
      expect(e.bankName).toBe('albaraka')
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
    // deviation: Q6 stateless API - the reference getResponse()/isSuccess() state assertions are dropped
    expect(result).toEqual({ status: 'success' })
  })

  it.each([
    ['testHistoryThrowsWhenNotSupported', (q: PosNetV1PosQuery) => q.history({})],
    ['testGetInstallmentRatesThrowsWhenNotSupported', (q: PosNetV1PosQuery) => q.getInstallmentRates({})],
    ['testGetInstallmentPricesThrowsWhenNotSupported', (q: PosNetV1PosQuery) => q.getInstallmentPrices({})],
    ['testGetBinListThrowsWhenNotSupported', (q: PosNetV1PosQuery) => q.getBinList({})],
  ])('%s', async (_name, call) => {
    await expect(call(setup().q)).rejects.toBeInstanceOf(UnsupportedTransactionTypeError)
  })
})
