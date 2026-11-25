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
import { ParamPosQuery } from '../../../src/pos-query/ParamPosQuery.js'
import type { PosHooks, PosQueryRequestDataPreparedEvent } from '../../../src/types.js'

class StubClient extends AbstractHttpClient {
  supportsTx = () => true
  override request = vi.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({ status: 'success' }))
}

const GUID = '0c13d406-873b-403b-9c09-a5766840d98c'
const account = AccountFactory.createParamPosAccount('param-pos', '10738', 'Test1', 'Test2', GUID)
// deviation: C10 the shipped test config sets test_mode, testInit needs it unset
const config: GatewayConfig = { ...posTestConfig.banks['param-pos'], test_mode: undefined }
const REQUEST_DATA = { 'soap:Body': { TP_Ozel_Oran_SK_Liste: { '@xmlns': 'https://turkpos.com.tr/' } } }

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
  const q = new ParamPosQuery(opts.config ?? config, account, {
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
    expect(e.bankName).toBe('param-pos')
    e.requestData['test-update-request-data-with-event'] = true
  })

const HOOKED = { ...REQUEST_DATA, 'test-update-request-data-with-event': true }

describe('ParamPosQuery', () => {
  it('testInit', () => {
    const { q } = setup()
    expect(q.isTestMode()).toBe(false)
    expect(q.getAccount()).toBe(account)
    expect(q).toBeInstanceOf(AbstractMappedPosQuery)
    // deviation: C10 stateless API - getResponse()/isSuccess() do not exist, so the null/false checks become absence checks
    expect('getResponse' in q).toBe(false)
    expect('isSuccess' in q).toBe(false)
  })

  it('testSupports', () => {
    expect(ParamPosQuery.supports('ParamPos')).toBe(true)
    expect(ParamPosQuery.supports('AkbankPos')).toBe(false)
    // addition: the hosted-page gateway has no query class
    expect(ParamPosQuery.supports('Param3DHostPos')).toBe(false)
  })

  it('testIsSupportedQuery', () => {
    for (const t of ['custom_query', 'history', 'installment_rates', 'bin_list']) {
      expect(ParamPosQuery.isSupportedQuery(t)).toBe(true)
    }
    for (const t of ['installment_prices', 'unknown_query_type']) expect(ParamPosQuery.isSupportedQuery(t)).toBe(false)
  })

  it('testTestModeSetViaConfig', () => {
    const { q, requestMapper } = setup({ config: { ...posTestConfig.banks['param-pos'], test_mode: true } })
    expect(requestMapper.setTestMode).toHaveBeenCalledTimes(1)
    expect(requestMapper.setTestMode).toHaveBeenCalledWith(true)
    expect(q.isTestMode()).toBe(true)
  })

  it('testCustomQuery', async () => {
    const input = { TP_Islem_Izleme: { SomeField: 'value' } }
    const hook = markHook('custom_query', input)
    const { q, requestMapper, stub } = setup({ hooks: { onPosQueryRequestDataPrepared: [hook] } })

    const result = await q.customQuery(input)

    expect(hook).toHaveBeenCalledTimes(1)
    expect(requestMapper.createCustomQueryRequestData).toHaveBeenCalledWith(account, input)
    expect(stub.request).toHaveBeenCalledWith('custom_query', 'regular', HOOKED, input, null)
    expect(result).toEqual({ status: 'success' })
  })

  it.each([
    ['approved', { status: 'ok' }, { status: 'approved', transactions: [] }],
    ['declined', { error: 'x' }, { status: 'declined', transactions: [] }],
  ])('testHistory %s', async (_name, bankResponse, mapped) => {
    const input = { start_date: new Date('2024-04-13T13:00:00+03:00'), end_date: new Date('2024-04-14T13:00:00+03:00') }
    const hook = markHook('history', input)
    const { q, requestMapper, responseMapper, stub } = setup({ hooks: { onPosQueryRequestDataPrepared: [hook] } })
    stub.request.mockResolvedValueOnce(bankResponse)
    responseMapper.mapHistoryResponse.mockReturnValueOnce(mapped)

    const result = await q.history(input)

    expect(requestMapper.createHistoryRequestData).toHaveBeenCalledWith(account, input)
    expect(stub.request).toHaveBeenCalledWith('history', 'regular', HOOKED, input, null)
    expect(responseMapper.mapHistoryResponse).toHaveBeenCalledWith(bankResponse)
    // deviation: C10 the mapped value is returned as is; there is no stored response or isSuccess()
    expect(result).toBe(mapped)
  })

  it.each([
    ['approved', { rates: [] }, { status: 'approved', installment_rates: [] }],
    ['declined', { error: 'x' }, { status: 'declined', installment_rates: [] }],
  ])('testGetInstallmentRates %s', async (_name, bankResponse, mapped) => {
    const input = {}
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
    ['approved', { bins: [] }, { status: 'approved', bin_list: [] }],
    ['declined', { error: 'x' }, { status: 'declined', bin_list: [] }],
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
    await expect(q.getInstallmentPrices({ amount: 1 })).rejects.toBeInstanceOf(UnsupportedTransactionTypeError)
    expect(stub.request).not.toHaveBeenCalled()
    expect(requestMapper.createInstallmentPricesRequestData).not.toHaveBeenCalled()
  })

  // addition: a custom query answer is the bank's decoded body, but an echoed merchant key never reaches the caller
  it('customQuery removes the echoed merchant credentials from the answer', async () => {
    const { q, stub } = setup()
    stub.request.mockResolvedValueOnce({
      TP_Islem_Sorgulama4Response: {
        TP_Islem_Sorgulama4Result: {
          Sonuc: '1',
          GUID: GUID,
          TURKPOS_RETVAL_GUID: GUID,
          client_password: 'Test2',
          Note: `value ${GUID}`,
          Nested: [{ CLIENT_PASSWORD: 'Test2', Echo: 'Test2', Keep: 'x' }],
        },
      },
    })

    const result = await q.customQuery({ TP_Islem_Sorgulama4: { Siparis_ID: 'x' } })
    const text = JSON.stringify(result)

    expect(text).not.toContain(GUID)
    expect(text).not.toContain('Test2')
    expect(text).toContain('"Sonuc":"1"')
    expect(text).toContain('"Keep":"x"')
  })

  // addition: an answer without anything to remove is returned as it is
  it('customQuery returns an answer without credentials as the same object', async () => {
    const { q, stub } = setup()
    const answer = { A: { B: ['1'] } }
    stub.request.mockResolvedValueOnce(answer)
    await expect(q.customQuery({ A: {} })).resolves.toBe(answer)
  })
})
