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
import { ToslaPosQuery } from '../../../src/pos-query/ToslaPosQuery.js'
import type { PosHooks, PosQueryRequestDataPreparedEvent } from '../../../src/types.js'

class StubClient extends AbstractHttpClient {
  supportsTx = () => true
  override request = vi.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({ status: 'success' }))
}

const account = AccountFactory.createToslaPosAccount('tosla', '1000000494', 'POS_ENT_Test_001', 'POS_ENT_Test_001!*!*')
// deviation: T20 the shipped test config sets test_mode, testInit needs it unset
const config: GatewayConfig = { ...posTestConfig.banks.tosla, test_mode: undefined }
const REQUEST_DATA = { bin: '415956', clientId: '1000000494' }

function setup(opts: { config?: GatewayConfig; hooks?: PosHooks } = {}) {
  const requestMapper = {
    createCustomQueryRequestData: vi.fn((_a: unknown, _d: Record<string, unknown>) => REQUEST_DATA),
    createHistoryRequestData: vi.fn(),
    createInstallmentRatesRequestData: vi.fn((_a: unknown, _d: Record<string, unknown>) => REQUEST_DATA),
    createInstallmentPricesRequestData: vi.fn((_a: unknown, _d: Record<string, unknown>) => REQUEST_DATA),
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
  const q = new ToslaPosQuery(opts.config ?? config, account, {
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
    expect(e.bankName).toBe('tosla')
    e.requestData['test-update-request-data-with-event'] = true
  })

const HOOKED = { ...REQUEST_DATA, 'test-update-request-data-with-event': true }

describe('ToslaPosQuery', () => {
  it('testInit', () => {
    const { q } = setup()
    expect(q.isTestMode()).toBe(false)
    expect(q.getAccount()).toBe(account)
    expect(q).toBeInstanceOf(AbstractMappedPosQuery)
    // deviation: T20 stateless API - getResponse()/isSuccess() do not exist, so the null/false checks become absence checks
    expect('getResponse' in q).toBe(false)
    expect('isSuccess' in q).toBe(false)
  })

  it('testSupports', () => {
    expect(ToslaPosQuery.supports('ToslaPos')).toBe(true)
    expect(ToslaPosQuery.supports('AkbankPos')).toBe(false)
  })

  it('testIsSupportedQuery', () => {
    for (const t of ['custom_query', 'installment_rates', 'installment_prices']) {
      expect(ToslaPosQuery.isSupportedQuery(t)).toBe(true)
    }
    for (const t of ['history', 'bin_list', 'unknown_query_type']) expect(ToslaPosQuery.isSupportedQuery(t)).toBe(false)
  })

  it('testTestModeSetViaConfig', () => {
    const { q, requestMapper } = setup({ config: { ...posTestConfig.banks.tosla, test_mode: true } })
    expect(requestMapper.setTestMode).toHaveBeenCalledTimes(1)
    expect(requestMapper.setTestMode).toHaveBeenCalledWith(true)
    expect(q.isTestMode()).toBe(true)
  })

  it('testCustomQuery', async () => {
    const input = { bin: '415956' }
    const hook = markHook('custom_query', input)
    const { q, requestMapper, stub } = setup({ hooks: { onPosQueryRequestDataPrepared: [hook] } })
    const url = 'https://prepentegrasyon.tosla.com/api/Payment/GetCommissionAndInstallmentInfo'

    const result = await q.customQuery(input, url)

    expect(hook).toHaveBeenCalledTimes(1)
    expect(requestMapper.createCustomQueryRequestData).toHaveBeenCalledWith(account, input)
    // deviation: the query passes the caller's url on, the Tosla client needs it for a custom query
    expect(stub.request).toHaveBeenCalledWith('custom_query', 'regular', HOOKED, input, url)
    expect(result).toEqual({ status: 'success' })
  })

  it.each([
    ['history', (q: ToslaPosQuery) => q.history({})],
    ['getBinList', (q: ToslaPosQuery) => q.getBinList({})],
  ])('%s rejects as unsupported', async (_name, call) => {
    const { q, stub, requestMapper } = setup()
    await expect(call(q)).rejects.toBeInstanceOf(UnsupportedTransactionTypeError)
    expect(stub.request).not.toHaveBeenCalled()
    expect(requestMapper.createHistoryRequestData).not.toHaveBeenCalled()
    expect(requestMapper.createBinListRequestData).not.toHaveBeenCalled()
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
    // deviation: T20 the mapped value is returned as is; there is no stored response or isSuccess()
    expect(result).toBe(mapped)
  })

  it.each([
    ['approved', { installmentDetails: [] }, { status: 'approved', installment_prices: [] }],
    ['declined', { error: 'not found' }, { status: 'declined', installment_prices: [] }],
  ])('testGetInstallmentPrices %s', async (_name, bankResponse, mapped) => {
    const input = { bin: '415956', amount: 1000.0 }
    const hook = markHook('installment_prices', input)
    const { q, requestMapper, responseMapper, stub } = setup({ hooks: { onPosQueryRequestDataPrepared: [hook] } })
    stub.request.mockResolvedValueOnce(bankResponse)
    responseMapper.mapInstallmentPricesResponse.mockReturnValueOnce(mapped)

    const result = await q.getInstallmentPrices(input)

    expect(requestMapper.createInstallmentPricesRequestData).toHaveBeenCalledWith(account, input)
    expect(stub.request).toHaveBeenCalledWith('installment_prices', 'regular', HOOKED, input, null)
    expect(responseMapper.mapInstallmentPricesResponse).toHaveBeenCalledWith(bankResponse)
    // deviation: T20 the mapped value is returned as is; there is no stored response or isSuccess()
    expect(result).toBe(mapped)
  })
})
