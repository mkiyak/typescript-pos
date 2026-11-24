import { describe, expect, it, vi } from 'vitest'
import { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import type { QueryRequestDataMapperInterface } from '../../../src/data-mapper/pos-query/request/QueryRequestDataMapperInterface.js'
import { PosError, PosHttpError, UnsupportedTransactionTypeError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { GatewayConfig } from '../../../src/gateway/AbstractGateway.js'
import { noopLogger, type PosLogger } from '../../../src/logger.js'
import type { AssecoPosAccount } from '../../../src/model/account/AssecoPosAccount.js'
import { AbstractPosQuery, type PosQueryDeps } from '../../../src/pos-query/AbstractPosQuery.js'
import type { PosHooks } from '../../../src/types.js'

// addition: the query base class has no reference unit test of its own for these behaviours.

class TestQuery extends AbstractPosQuery<AssecoPosAccount> {
  static override readonly GATEWAY_CLASS = 'AssecoPos'
  protected static override supportedQueries = { custom_query: true }
}

class NoClassQuery extends AbstractPosQuery<AssecoPosAccount> {}

class StubClient extends AbstractHttpClient {
  supportsTx = () => true
  override request = vi.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({ status: 'success' }))
}

const config: GatewayConfig = {
  name: 'Test',
  class: 'AssecoPos',
  gateway_endpoints: {
    payment_api: 'https://entegrasyon.asseco-see.com.tr/fim/api',
    gateway_3d: 'https://entegrasyon.asseco-see.com.tr/fim/est3Dgate',
  },
}

const account = AccountFactory.createAssecoPosAccount('akbank', '700655000200', 'ISBANKAPI', 'ISBANK07', 'TRPS0200')

function setup(
  opts: { config?: GatewayConfig; hooks?: PosHooks; logger?: PosLogger; allowedApiOrigins?: string[] } = {},
) {
  const mapper = {
    createCustomQueryRequestData: vi.fn((a: AssecoPosAccount, d: Record<string, unknown>) => ({
      ...d,
      Password: a.getPassword(),
    })),
    createHistoryRequestData: vi.fn(),
    createInstallmentRatesRequestData: vi.fn(),
    createInstallmentPricesRequestData: vi.fn(),
    createBinListRequestData: vi.fn(),
    isTestMode: vi.fn(() => false),
    setTestMode: vi.fn(),
  }
  const stub = new StubClient('https://x.test', new HttpTransport(), noopLogger)
  const deps: PosQueryDeps<AssecoPosAccount> = {
    requestDataMapper: mapper as unknown as QueryRequestDataMapperInterface<AssecoPosAccount>,
    clientStrategy: new HttpClientStrategy([stub]),
    logger: opts.logger ?? noopLogger,
    hooks: opts.hooks ?? {},
    ...(opts.allowedApiOrigins !== undefined ? { allowedApiOrigins: opts.allowedApiOrigins } : {}),
  }
  const q = new TestQuery(opts.config ?? config, account, deps)
  return { q, mapper, stub, deps }
}

describe('AbstractPosQuery', () => {
  describe('construction', () => {
    it('rejects a subclass without GATEWAY_CLASS', () => {
      const { deps } = setup()
      expect(() => new NoClassQuery(config, account, deps)).toThrow(PosError)
    })

    it('rejects a non-https allowedApiOrigins entry', () => {
      expect(() => setup({ allowedApiOrigins: ['http://x.test'] })).toThrow(PosError)
      expect(() => setup({ allowedApiOrigins: ['nonsense'] })).toThrow(PosError)
    })

    it('supports() and isSupportedQuery()', () => {
      expect(TestQuery.supports('AssecoPos')).toBe(true)
      expect(TestQuery.supports('AkbankPos')).toBe(false)
      expect(NoClassQuery.supports('')).toBe(false)
      expect(TestQuery.isSupportedQuery('custom_query')).toBe(true)
      for (const t of ['history', 'installment_rates', 'installment_prices', 'bin_list', 'unknown_query_type']) {
        expect(TestQuery.isSupportedQuery(t)).toBe(false)
      }
      expect(TestQuery.isSupportedQuery('toString')).toBe(false)
    })
  })

  describe('unsupported queries', () => {
    it.each([
      ['history', (q: TestQuery) => q.history({})],
      ['installment_rates', (q: TestQuery) => q.getInstallmentRates({})],
      ['installment_prices', (q: TestQuery) => q.getInstallmentPrices({})],
      ['bin_list', (q: TestQuery) => q.getBinList({})],
    ])('%s rejects asynchronously', async (type, call) => {
      const { q, mapper, stub } = setup()
      const p = call(q)
      await expect(p).rejects.toBeInstanceOf(UnsupportedTransactionTypeError)
      await expect(p).rejects.toThrow(type)
      expect(mapper.createHistoryRequestData).not.toHaveBeenCalled()
      expect(mapper.createInstallmentRatesRequestData).not.toHaveBeenCalled()
      expect(mapper.createInstallmentPricesRequestData).not.toHaveBeenCalled()
      expect(mapper.createBinListRequestData).not.toHaveBeenCalled()
      expect(stub.request).not.toHaveBeenCalled()
    })
  })

  describe('customQuery', () => {
    it('maps, sends through the non-secure client and returns the raw answer', async () => {
      const { q, mapper, stub } = setup()
      const input = { bin: '415956' }
      const answer = { status: 'ok-raw' }
      stub.request.mockResolvedValueOnce(answer)

      const result = await q.customQuery(input)

      expect(mapper.createCustomQueryRequestData).toHaveBeenCalledWith(account, input)
      expect(stub.request).toHaveBeenCalledWith(
        'custom_query',
        'regular',
        { bin: '415956', Password: 'ISBANK07' },
        input,
        null,
      )
      expect(result).toBe(answer)
    })

    it('passes the mapped object by reference when there are no hooks', async () => {
      const { q, mapper, stub } = setup()
      await q.customQuery({ a: 1 })
      const mapped = mapper.createCustomQueryRequestData.mock.results[0]?.value
      expect(stub.request.mock.calls[0]?.[2]).toBe(mapped)
    })

    it.each(['https://entegrasyon.asseco-see.com.tr/other/path', 'https://ENTEGRASYON.asseco-see.com.tr/fim/api'])(
      'accepts %s',
      async (url) => {
        const { q, stub } = setup()
        await q.customQuery({}, url)
        expect(stub.request.mock.calls[0]?.[4]).toBe(url)
      },
    )

    it.each([
      'http://entegrasyon.asseco-see.com.tr/fim/api',
      'https://evil.example/api',
      'https://entegrasyon.asseco-see.com.tr:8443/x',
      'https://entegrasyon.asseco-see.com.tr@evil.example/',
      'https://user:secret@entegrasyon.asseco-see.com.tr/fim/api',
      'https://entegrasyon.asseco-see.com.tr.evil.example/fim/api',
      'ftp://entegrasyon.asseco-see.com.tr/fim/api',
      '',
      'not a url',
    ])('rejects %j without echoing it and without any mapping or HTTP call', async (url) => {
      const onHook = vi.fn()
      const { q, mapper, stub } = setup({ hooks: { onPosQueryRequestDataPrepared: [onHook] } })
      let caught: unknown
      try {
        await q.customQuery({ bin: '1' }, url)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(PosError)
      const message = (caught as Error).message
      if (url !== '') expect(message).not.toContain(url)
      expect(message).toContain('https://entegrasyon.asseco-see.com.tr')
      expect(mapper.createCustomQueryRequestData).not.toHaveBeenCalled()
      expect(onHook).not.toHaveBeenCalled()
      expect(stub.request).not.toHaveBeenCalled()
    })

    // addition: a non-string URL cannot be checked once and then used with a different value
    it('rejects a non-string apiUrl whose toString changes between calls', async () => {
      const onHook = vi.fn()
      const { q, mapper, stub } = setup({ hooks: { onPosQueryRequestDataPrepared: [onHook] } })
      let calls = 0
      const sneaky = {
        toString: () => (calls++ === 0 ? 'https://entegrasyon.asseco-see.com.tr/fim/api' : 'https://evil.example/'),
      } as unknown as string
      await expect(q.customQuery({ bin: '1' }, sneaky)).rejects.toBeInstanceOf(PosError)
      expect(mapper.createCustomQueryRequestData).not.toHaveBeenCalled()
      expect(onHook).not.toHaveBeenCalled()
      expect(stub.request).not.toHaveBeenCalled()
    })

    // addition: plain-JS callers can pass anything as the request data
    it.each([null, 'text', 5, ['a']])('rejects non-object request data %j with a PosError', async (input) => {
      const { q, mapper, stub } = setup()
      const p = q.customQuery(input as unknown as Record<string, unknown>)
      await expect(p).rejects.toBeInstanceOf(PosError)
      await expect(p).rejects.toThrow('Custom query request data must be an object.')
      expect(mapper.createCustomQueryRequestData).not.toHaveBeenCalled()
      expect(stub.request).not.toHaveBeenCalled()
    })

    it('null and undefined apiUrl use the client default', async () => {
      const { q, stub } = setup()
      await q.customQuery({}, null)
      await q.customQuery({}, undefined)
      expect(stub.request.mock.calls[0]?.[4]).toBeNull()
      expect(stub.request.mock.calls[1]?.[4]).toBeNull()
    })

    it('accepts an origin from allowedApiOrigins', async () => {
      const { q, stub } = setup({ allowedApiOrigins: ['https://apipos.vakifbank.com.tr:8443'] })
      const url = 'https://apipos.vakifbank.com.tr:8443/VirtualPos/SettlementDetail'
      await q.customQuery({}, url)
      expect(stub.request.mock.calls[0]?.[4]).toBe(url)
    })

    it('an origin that is only allowed on another port stays rejected', async () => {
      const { q } = setup({ allowedApiOrigins: ['https://apipos.vakifbank.com.tr:8443'] })
      await expect(q.customQuery({}, 'https://apipos.vakifbank.com.tr/x')).rejects.toBeInstanceOf(PosError)
    })

    it('http endpoints in the config never become allowed origins', async () => {
      const { q } = setup({
        config: { ...config, gateway_endpoints: { payment_api: 'http://plain.test/api' } },
      })
      await expect(q.customQuery({}, 'http://plain.test/api')).rejects.toBeInstanceOf(PosError)
    })
  })

  describe('hooks', () => {
    it('passes a frozen shallow copy of the input and a clone of the mapped data; the change reaches the client only', async () => {
      const seen: unknown[] = []
      const hooks: PosHooks = {
        onPosQueryRequestDataPrepared: [
          (e) => {
            seen.push(e)
            expect(e.queryType).toBe('custom_query')
            expect(e.bankName).toBe('akbank')
            expect(e.gatewayClass).toBe('AssecoPos')
            expect(e.requestData).toEqual({ bin: '415956', Password: 'ISBANK07' })
            expect(e.originalData).toEqual({ bin: '415956' })
            expect(Object.isFrozen(e.originalData)).toBe(true)
            e.requestData['test-update-request-data-with-event'] = true
          },
        ],
      }
      const { q, mapper, stub } = setup({ hooks })
      const input = { bin: '415956' }
      await q.customQuery(input)

      expect(seen).toHaveLength(1)
      const mapped = mapper.createCustomQueryRequestData.mock.results[0]?.value
      expect((seen[0] as { requestData: unknown }).requestData).not.toBe(mapped)
      expect(stub.request.mock.calls[0]?.[2]).toHaveProperty('test-update-request-data-with-event', true)
      expect(input).not.toHaveProperty('test-update-request-data-with-event')
    })

    it('logs the change without leaking the password', async () => {
      const debug = vi.fn()
      const logger: PosLogger = { ...noopLogger, debug }
      const hooks: PosHooks = {
        onPosQueryRequestDataPrepared: [
          (e) => {
            e.requestData.extra = 1
          },
        ],
      }
      const { q } = setup({ hooks, logger })
      await q.customQuery({ bin: '1' })
      const call = debug.mock.calls.find((c) => c[0] === 'Request data is changed via listeners')
      expect(call).toBeDefined()
      expect(JSON.stringify(call?.[1])).not.toContain('ISBANK07')
    })
  })

  describe('test mode', () => {
    it('forwards test_mode to the mapper', () => {
      const { q, mapper } = setup({ config: { ...config, test_mode: true } })
      expect(mapper.setTestMode).toHaveBeenCalledTimes(1)
      expect(mapper.setTestMode).toHaveBeenCalledWith(true)
      expect(q.isTestMode()).toBe(true)
    })

    it('leaves the mapper alone without test_mode', () => {
      const { q, mapper } = setup()
      expect(mapper.setTestMode).not.toHaveBeenCalled()
      expect(q.isTestMode()).toBe(false)
    })
  })

  describe('statelessness and errors', () => {
    it('keeps no last-response state', () => {
      const { q } = setup()
      expect('getResponse' in q).toBe(false)
      expect('isSuccess' in q).toBe(false)
      expect('orderHistory' in AbstractPosQuery.prototype).toBe(false)
    })

    it('concurrent calls resolve to their own answers', async () => {
      const { q, stub } = setup()
      stub.request.mockImplementation(async (...args: unknown[]) => {
        const input = args[3] as { n: number }
        await new Promise((r) => setTimeout(r, input.n === 1 ? 20 : 1))
        return { echo: input.n }
      })
      const [a, b] = await Promise.all([q.customQuery({ n: 1 }), q.customQuery({ n: 2 })])
      expect(a).toEqual({ echo: 1 })
      expect(b).toEqual({ echo: 2 })
    })

    it('propagates the client error instance', async () => {
      const { q, stub } = setup()
      const err = new PosHttpError('Bank returned HTTP 500', {
        url: 'https://entegrasyon.asseco-see.com.tr/fim/api',
        status: 500,
      })
      stub.request.mockRejectedValueOnce(err)
      await expect(q.customQuery({})).rejects.toBe(err)
    })

    it('exposes the account', () => {
      expect(setup().q.getAccount()).toBe(account)
    })
  })
})
