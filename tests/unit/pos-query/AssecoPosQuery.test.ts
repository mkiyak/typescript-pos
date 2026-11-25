import iconv from 'iconv-lite'
import { describe, expect, it, vi } from 'vitest'
import { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { AssecoPosHttpClient } from '../../../src/client/AssecoPosHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { AssecoPosQueryRequestDataMapper } from '../../../src/data-mapper/pos-query/request/AssecoPosQueryRequestDataMapper.js'
import type { QueryRequestDataMapperInterface } from '../../../src/data-mapper/pos-query/request/QueryRequestDataMapperInterface.js'
import { AssecoPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/AssecoPosRequestValueFormatter.js'
import { AssecoPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/AssecoPosRequestValueMapper.js'
import { PosHttpError, UnsupportedTransactionTypeError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { GatewayConfig } from '../../../src/gateway/AbstractGateway.js'
import { noopLogger, type PosLogger } from '../../../src/logger.js'
import type { PosQueryDeps } from '../../../src/pos-query/AbstractPosQuery.js'
import { AssecoPosQuery } from '../../../src/pos-query/AssecoPosQuery.js'
import type { PosHooks, PosQueryRequestDataPreparedEvent } from '../../../src/types.js'

class StubClient extends AbstractHttpClient {
  supportsTx = () => true
  override request = vi.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({ status: 'success' }))
}

const config: GatewayConfig = posTestConfig.banks.asseco
const account = AccountFactory.createAssecoPosAccount('akbank', '700655000200', 'ISBANKAPI', 'ISBANK07', 'TRPS0200')
const MAPPED = { bin: '415956', clientId: '700655000200' }

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
  return { q: new AssecoPosQuery(opts.config ?? config, account, deps), mapper, stub }
}

describe('AssecoPosQuery', () => {
  it('testInit', () => {
    const { q } = setup()
    expect(q.isTestMode()).toBe(false)
    expect(q.getAccount()).toBe(account)
    // deviation: Q6 stateless API - getResponse()/isSuccess() do not exist, so the reference null/false checks become absence checks
    expect('getResponse' in q).toBe(false)
    expect('isSuccess' in q).toBe(false)
  })

  it('testSupports', () => {
    expect(AssecoPosQuery.supports('AssecoPos')).toBe(true)
    expect(AssecoPosQuery.supports('AkbankPos')).toBe(false)
  })

  it('testIsSupportedQuery', () => {
    expect(AssecoPosQuery.isSupportedQuery('custom_query')).toBe(true)
    for (const t of ['history', 'installment_rates', 'installment_prices', 'unknown_query_type']) {
      expect(AssecoPosQuery.isSupportedQuery(t)).toBe(false)
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
      expect(e.bankName).toBe('akbank')
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
    ['testHistoryThrowsWhenNotSupported', (q: AssecoPosQuery) => q.history({})],
    ['testGetInstallmentRatesThrowsWhenNotSupported', (q: AssecoPosQuery) => q.getInstallmentRates({})],
    ['testGetInstallmentPricesThrowsWhenNotSupported', (q: AssecoPosQuery) => q.getInstallmentPrices({})],
    ['testGetBinListThrowsWhenNotSupported', (q: AssecoPosQuery) => q.getBinList({})],
  ])('%s', async (_name, call) => {
    await expect(call(setup().q)).rejects.toBeInstanceOf(UnsupportedTransactionTypeError)
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
  const client = new AssecoPosHttpClient(
    posTestConfig.banks.asseco.gateway_endpoints.payment_api,
    new HttpTransport({ fetch: f.fn }),
    logger,
  )
  const q = new AssecoPosQuery(config, account, {
    requestDataMapper: new AssecoPosQueryRequestDataMapper(
      new AssecoPosRequestValueMapper(),
      new AssecoPosRequestValueFormatter(),
      crypt,
    ),
    clientStrategy: new HttpClientStrategy([client]),
    logger,
    hooks: {},
  })
  return { q, calls: f.calls }
}

describe('AssecoPosQuery end to end', () => {
  it('rejects an HTTP 500 with PosHttpError carrying the status', async () => {
    const { q } = e2e(() => new Response('boom', { status: 500 }))
    const err = await q.customQuery({ Type: 'Query' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).status).toBe(500)
  })

  it('rejects a 200 HTML page with a PosHttpError and never resolves', async () => {
    const { q } = e2e(() => new Response('<html><body>Request Rejected</body></html>', { status: 200 }))
    const err = await q.customQuery({ Type: 'Query' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).message).toBe('Bank returned an HTML page instead of XML')
  })

  it('never logs the password, also when a hook changes the request', async () => {
    const calls: unknown[] = []
    const record = (...a: unknown[]) => void calls.push(a)
    const logger: PosLogger = { debug: record, info: record, warn: record, error: record } as unknown as PosLogger
    const f = fakeFetch(
      () =>
        new Response(
          '<?xml version="1.0" encoding="ISO-8859-9"?><CC5Response><Response>Approved</Response></CC5Response>',
          { status: 200 },
        ),
    )
    const client = new AssecoPosHttpClient(
      posTestConfig.banks.asseco.gateway_endpoints.payment_api,
      new HttpTransport({ fetch: f.fn }),
      logger,
    )
    const q = new AssecoPosQuery(config, account, {
      requestDataMapper: new AssecoPosQueryRequestDataMapper(
        new AssecoPosRequestValueMapper(),
        new AssecoPosRequestValueFormatter(),
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
    await q.customQuery({ Type: 'Query' })
    expect(calls.length).toBeGreaterThan(0)
    expect(JSON.stringify(calls)).not.toContain('ISBANK07')
  })

  it('posts the credentials and non-ASCII text as ISO-8859-9 and returns the raw answer', async () => {
    const body =
      '<?xml version="1.0" encoding="ISO-8859-9"?><CC5Response><Response>Approved</Response><ProcReturnCode>00</ProcReturnCode></CC5Response>'
    const { q, calls } = e2e(() => new Response(body, { status: 200 }))
    const result = await q.customQuery({
      Type: 'Query',
      Number: '4111111111111111',
      Expires: '10.2025',
      Extra: { IMECECARDQUERY: null, NOTE: 'Ödeme ğüşİı €' },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://entegrasyon.asseco-see.com.tr/fim/api')
    const bytes = calls[0]?.init.body as Uint8Array
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.includes(0xf0)).toBe(true)
    const xml = iconv.decode(Buffer.from(bytes), 'ISO-8859-9')
    expect(xml).toContain('<CC5Request>')
    expect(xml).toContain('<Name>ISBANKAPI</Name>')
    expect(xml).toContain('<Password>ISBANK07</Password>')
    expect(xml).toContain('<ClientId>700655000200</ClientId>')
    expect(xml).toContain('<IMECECARDQUERY/>')
    expect(xml).toContain('&#x20AC;')
    expect(result).toEqual({ Response: 'Approved', ProcReturnCode: '00' })
  })
})
