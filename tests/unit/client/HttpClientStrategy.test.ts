import { describe, expect, it, vi } from 'vitest'
import { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PayFlexV4Pos3DFormHttpClient } from '../../../src/client/PayFlexV4Pos3DFormHttpClient.js'
import { PayFlexV4PosHttpClient } from '../../../src/client/PayFlexV4PosHttpClient.js'
import { PayFlexV4PosSearchApiHttpClient } from '../../../src/client/PayFlexV4PosSearchApiHttpClient.js'
import { PosHttpError, UnsupportedTransactionTypeError } from '../../../src/errors.js'
import type { PosLogger } from '../../../src/logger.js'
import { noopLogger } from '../../../src/logger.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../src/pos-query/PosQueryInterface.js'
import type { EncodedData } from '../../../src/serializer/EncodedData.js'
import { XmlEncoder } from '../../../src/serializer/XmlEncoder.js'

class TestClient extends AbstractHttpClient {
  constructor(
    private readonly supports: (t: TxType, m: PaymentModel) => boolean,
    transport: HttpTransport = new HttpTransport(),
    logger: PosLogger = noopLogger,
  ) {
    super('https://bank.test/api', transport, logger)
  }
  supportsTx(t: TxType, m: PaymentModel): boolean {
    return this.supports(t, m)
  }
}

class XmlClient extends TestClient {
  protected override encode(_t: TxType, _m: PaymentModel, data: Record<string, unknown>): EncodedData {
    return { data: XmlEncoder.encode(data, { rootName: 'Req' }), format: 'xml' }
  }
}

describe('HttpClientStrategy', () => {
  it('getAllClients returns the clients', () => {
    const a = new TestClient(() => false)
    const b = new TestClient(() => false)
    expect(new HttpClientStrategy([a, b]).getAllClients()).toEqual([a, b])
  })

  it('returns the first client that supports the tx', () => {
    const a = new TestClient(() => false)
    const b = new TestClient((t, m) => t === TX_TYPE.PAY_AUTH && m === MODEL.NON_SECURE)
    const c = new TestClient(() => true)
    expect(new HttpClientStrategy([a, b, c]).getClient(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE)).toBe(b)
  })

  it('throws UnsupportedTransactionTypeError when none matches', () => {
    const s = new HttpClientStrategy([new TestClient(() => false)])
    expect(() => s.getClient(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE)).toThrow(UnsupportedTransactionTypeError)
    expect(() => s.getClient(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE)).toThrow(
      'No HTTP client configured for transaction type: pay',
    )
  })
})

describe('AbstractHttpClient', () => {
  const ok = (body: string, status = 200) =>
    new HttpTransport({
      fetch: (async () => new Response(status === 204 ? null : body, { status })) as unknown as typeof fetch,
    })

  it('encodes, posts and decodes (json default)', async () => {
    let init: RequestInit | undefined
    let url: unknown
    const t = new HttpTransport({
      fetch: (async (u: unknown, i?: RequestInit) => {
        url = u
        init = i
        return new Response('{"code":"00"}')
      }) as unknown as typeof fetch,
    })
    const c = new TestClient(() => true, t)
    const res = await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, {})
    expect(res).toEqual({ code: '00' })
    expect(url).toBe('https://bank.test/api')
    expect(init?.body).toBe('{"a":1}')
    expect(new Headers(init?.headers).get('Content-Type')).toContain('application/json')
  })

  it('uses the url override and overridden encode/decode', async () => {
    let url: unknown
    let body: unknown
    const t = new HttpTransport({
      fetch: (async (u: unknown, i?: RequestInit) => {
        url = u
        body = i?.body
        return new Response('<Res><Code>00</Code></Res>')
      }) as unknown as typeof fetch,
    })
    class C extends XmlClient {
      protected override decode(body: string) {
        return Promise.resolve({ raw: body })
      }
    }
    const res = await new C(() => true, t).request(
      TX_TYPE.STATUS,
      MODEL.NON_SECURE,
      { k: 'v' },
      {},
      'https://other.test/x',
    )
    expect(url).toBe('https://other.test/x')
    expect(body).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<Req><k>v</k></Req>\n')
    expect(res).toEqual({ raw: '<Res><Code>00</Code></Res>' })
  })

  it('returns {} on 204 and does not decode', async () => {
    const res = await new TestClient(() => true, ok('', 204)).request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, {}, {})
    expect(res).toEqual({})
  })

  it('propagates non-2xx PosHttpError and logs without raw card data', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const c = new TestClient(() => true, ok('fail 4355084355084358', 500), logger)
    const err = await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { pan: '4355084355084358' }, {}).catch((e) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect(err.status).toBe(500)
    expect(logger.error).toHaveBeenCalled()
    const logged = JSON.stringify([...logger.debug.mock.calls, ...logger.info.mock.calls, ...logger.error.mock.calls])
    expect(logged).not.toContain('4355084355084358')
  })

  it('wraps an HTML response in a PosHttpError carrying url and status', async () => {
    class C extends XmlClient {
      protected override decode(body: string) {
        return Promise.resolve(XmlDecoderProxy(body))
      }
    }
    const { XmlDecoder } = await import('../../../src/serializer/XmlDecoder.js')
    function XmlDecoderProxy(b: string) {
      return XmlDecoder.decode(b)
    }
    const err = await new C(() => true, ok('<html><body>rejected</body></html>'))
      .request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, {}, {})
      .catch((e) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect(err.url).toBe('https://bank.test/api')
    expect(err.status).toBe(200)
  })

  it('masks PAN and CVV in the logged body when decoding fails', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    class C extends TestClient {
      protected override decode(): Promise<Record<string, unknown>> {
        return Promise.reject(new PosHttpError('bad', { url: '' }))
      }
    }
    const body = '<html>4355084355084358 <Cvv2Val>123</Cvv2Val></html>'
    await new C(() => true, ok(body), logger).request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, {}, {}).catch(() => {})
    const logged = JSON.stringify(logger.error.mock.calls)
    expect(logged).toContain('parsing bank response failed')
    expect(logged).not.toContain('4355084355084358')
    expect(logged).not.toContain('>123<')
  })
})

// addition: query types route through the same strategy
describe('HttpClientStrategy with query types', () => {
  const t = new HttpTransport()
  const v4 = new PayFlexV4PosHttpClient('https://bank.test/pay', t)
  const form = new PayFlexV4Pos3DFormHttpClient('https://bank.test/3d', t)
  const search = new PayFlexV4PosSearchApiHttpClient('https://bank.test/search', t)
  const strategy = new HttpClientStrategy([v4, form, search])

  it('routes custom_query to the payment client and status to the search client', () => {
    expect(strategy.getClient(QUERY_TYPE.CUSTOM_QUERY, MODEL.NON_SECURE)).toBe(v4)
    expect(strategy.getClient(TX_TYPE.STATUS, MODEL.NON_SECURE)).toBe(search)
  })

  it('throws when no client handles the query type', () => {
    const s = new HttpClientStrategy([new TestClient(() => false)])
    expect(() => s.getClient(QUERY_TYPE.HISTORY, MODEL.NON_SECURE)).toThrow(UnsupportedTransactionTypeError)
    expect(() => s.getClient(QUERY_TYPE.HISTORY, MODEL.NON_SECURE)).toThrow(
      'No HTTP client configured for transaction type: history',
    )
  })
})
