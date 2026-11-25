import { describe, expect, it, vi } from 'vitest'
import { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PayFlexV4PosHttpClient } from '../../../src/client/PayFlexV4PosHttpClient.js'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { PayFlexV4PosQueryRequestDataMapper } from '../../../src/data-mapper/pos-query/request/PayFlexV4PosQueryRequestDataMapper.js'
import type { QueryRequestDataMapperInterface } from '../../../src/data-mapper/pos-query/request/QueryRequestDataMapperInterface.js'
import { PayFlexV4PosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/PayFlexV4PosRequestValueFormatter.js'
import { PayFlexV4PosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/PayFlexV4PosRequestValueMapper.js'
import { PosHttpError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { GatewayConfig } from '../../../src/gateway/AbstractGateway.js'
import { noopLogger, type PosLogger } from '../../../src/logger.js'
import type { PosQueryDeps } from '../../../src/pos-query/AbstractPosQuery.js'
import { PayFlexV4PosQuery } from '../../../src/pos-query/PayFlexV4PosQuery.js'
import type { PosHooks, PosQueryRequestDataPreparedEvent } from '../../../src/types.js'

class StubClient extends AbstractHttpClient {
  supportsTx = () => true
  override request = vi.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({ status: 'success' }))
}

const config: GatewayConfig = posTestConfig.banks.vakifbank
const account = AccountFactory.createPayFlexPosAccount('vakifbank', '000000000111111', '3XTgER89as', 'VP999999')
const MAPPED = { bin: '415956', MerchantId: '000000000111111' }

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
  return { q: new PayFlexV4PosQuery(opts.config ?? config, account, deps), mapper, stub }
}

describe('PayFlexV4PosQuery', () => {
  it('testInit', () => {
    const { q } = setup()
    expect(q.isTestMode()).toBe(false)
    expect(q.getAccount()).toBe(account)
    // deviation: Q6 stateless API - getResponse()/isSuccess() do not exist, so the reference null/false checks become absence checks
    expect('getResponse' in q).toBe(false)
    expect('isSuccess' in q).toBe(false)
  })

  it('testSupports', () => {
    expect(PayFlexV4PosQuery.supports('PayFlexV4Pos')).toBe(true)
    expect(PayFlexV4PosQuery.supports('AkbankPos')).toBe(false)
  })

  it('testIsSupportedQuery', () => {
    expect(PayFlexV4PosQuery.isSupportedQuery('custom_query')).toBe(true)
    for (const t of ['history', 'installment_rates', 'installment_prices', 'unknown_query_type']) {
      expect(PayFlexV4PosQuery.isSupportedQuery(t)).toBe(false)
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
      expect(e.bankName).toBe('vakifbank')
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
})

// addition: end to end through the real mapper and HTTP client with a fake fetch.
type Call = { url: string; init: RequestInit }

function fakeFetch(respond: () => Response) {
  const calls: Call[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init as RequestInit })
    return respond()
  }) as typeof fetch
  return { calls, fn }
}

const crypt = {} as unknown as CryptInterface<never>

function e2e(respond: () => Response, opts: { logger?: PosLogger } = {}) {
  const f = fakeFetch(respond)
  const logger = opts.logger ?? noopLogger
  const client = new PayFlexV4PosHttpClient(
    posTestConfig.banks.vakifbank.gateway_endpoints.payment_api,
    new HttpTransport({ fetch: f.fn }),
    logger,
  )
  const q = new PayFlexV4PosQuery(config, account, {
    requestDataMapper: new PayFlexV4PosQueryRequestDataMapper(
      new PayFlexV4PosRequestValueMapper(),
      new PayFlexV4PosRequestValueFormatter(),
      crypt,
    ),
    clientStrategy: new HttpClientStrategy([client]),
    logger,
    hooks: {},
  })
  return { q, calls: f.calls }
}

describe('PayFlexV4PosQuery end to end', () => {
  it('rejects an HTTP 500 with PosHttpError carrying the status', async () => {
    const { q } = e2e(() => new Response('boom', { status: 500 }))
    const err = await q.customQuery({ OrderId: 'O1' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).status).toBe(500)
  })

  it('rejects a 200 HTML page with a PosHttpError and never resolves', async () => {
    const { q } = e2e(() => new Response('<html><body>Request Rejected</body></html>', { status: 200 }))
    const err = await q.customQuery({ OrderId: 'O1' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).message).toBe('Bank returned an HTML page instead of XML')
  })

  it('never logs the password, also when a hook changes the request', async () => {
    const calls: unknown[] = []
    const record = (...a: unknown[]) => void calls.push(a)
    const logger: PosLogger = { debug: record, info: record, warn: record, error: record } as unknown as PosLogger
    const f = fakeFetch(
      () => new Response('<VposResponse><ResultCode>0000</ResultCode></VposResponse>', { status: 200 }),
    )
    const client = new PayFlexV4PosHttpClient(
      posTestConfig.banks.vakifbank.gateway_endpoints.payment_api,
      new HttpTransport({ fetch: f.fn }),
      logger,
    )
    const q = new PayFlexV4PosQuery(config, account, {
      requestDataMapper: new PayFlexV4PosQueryRequestDataMapper(
        new PayFlexV4PosRequestValueMapper(),
        new PayFlexV4PosRequestValueFormatter(),
        crypt,
      ),
      clientStrategy: new HttpClientStrategy([client]),
      logger,
      hooks: {
        onPosQueryRequestDataPrepared: [
          (e) => {
            e.requestData.Extra2 = 'x'
          },
        ],
      },
    })
    await q.customQuery({ OrderId: 'O1' })
    expect(calls.length).toBeGreaterThan(0)
    expect(JSON.stringify(calls)).not.toContain('3XTgER89as')
  })

  it('posts prmstr with the credentials after the caller keys to the payment api', async () => {
    const { q, calls } = e2e(
      () => new Response('<VposResponse><ResultCode>0000</ResultCode></VposResponse>', { status: 200 }),
    )
    const result = await q.customQuery({ OrderId: 'O1' })

    expect(calls[0]?.url).toBe(posTestConfig.banks.vakifbank.gateway_endpoints.payment_api)
    const prmstr = new URLSearchParams(calls[0]?.init.body as string).get('prmstr')
    expect(prmstr?.startsWith('<VposRequest>')).toBe(true)
    expect(prmstr).toContain(
      '<OrderId>O1</OrderId><MerchantId>000000000111111</MerchantId><Password>3XTgER89as</Password><TerminalNo>VP999999</TerminalNo>',
    )
    expect(result).toEqual({ ResultCode: '0000' })
  })
})
