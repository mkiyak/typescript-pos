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
import { PayForPosQuery } from '../../../src/pos-query/PayForPosQuery.js'
import type { PosHooks, PosQueryRequestDataPreparedEvent } from '../../../src/types.js'

class StubClient extends AbstractHttpClient {
  supportsTx = () => true
  override request = vi.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({ status: 'success' }))
}

const account = AccountFactory.createPayForPosAccount(
  'qnbfinansbank-payfor',
  '085300000009704',
  'QNB_API_KULLANICI_3DPAY',
  'UcBN0',
  '12345678',
)
// deviation: Q6 the shipped test config sets test_mode, testInit needs it unset
const config: GatewayConfig = { ...posTestConfig.banks['qnbfinansbank-payfor'], test_mode: undefined }
const REQUEST_DATA = { bin: '415956', MbrId: '5' }

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
  const q = new PayForPosQuery(opts.config ?? config, account, {
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
    expect(e.bankName).toBe('qnbfinansbank-payfor')
    e.requestData['test-update-request-data-with-event'] = true
  })

describe('PayForPosQuery', () => {
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
    expect(PayForPosQuery.supports('PayForPos')).toBe(true)
    expect(PayForPosQuery.supports('AkbankPos')).toBe(false)
  })

  it('testIsSupportedQuery', () => {
    for (const t of ['custom_query', 'history']) expect(PayForPosQuery.isSupportedQuery(t)).toBe(true)
    for (const t of ['installment_rates', 'installment_prices', 'unknown_query_type']) {
      expect(PayForPosQuery.isSupportedQuery(t)).toBe(false)
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
    const input = { transaction_date: new Date() }
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

  // addition: the bank offers no installment or BIN queries
  it.each([
    ['getInstallmentRates', (q: PayForPosQuery) => q.getInstallmentRates({})],
    ['getInstallmentPrices', (q: PayForPosQuery) => q.getInstallmentPrices({})],
    ['getBinList', (q: PayForPosQuery) => q.getBinList({})],
  ])('%s rejects as unsupported', async (_name, call) => {
    const { q, stub } = setup()
    await expect(call(q)).rejects.toBeInstanceOf(UnsupportedTransactionTypeError)
    expect(stub.request).not.toHaveBeenCalled()
  })
})
