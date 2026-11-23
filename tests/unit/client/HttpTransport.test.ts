import { describe, expect, it } from 'vitest'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PosHttpError } from '../../../src/errors.js'
import { XmlDecoder } from '../../../src/serializer/XmlDecoder.js'

const fakeFetch = (status: number, body: string): typeof fetch =>
  (async () => new Response(body, { status })) as unknown as typeof fetch

describe('HttpTransport', () => {
  it('returns status, body and headers on 200 and forwards request', async () => {
    let seen: { url: unknown; init: RequestInit | undefined } | undefined
    const f = (async (url: unknown, init?: RequestInit) => {
      seen = { url, init }
      return new Response('<ok/>', { status: 200, headers: { 'x-a': 'b' } })
    }) as unknown as typeof fetch
    const res = await new HttpTransport({ fetch: f }).post('https://bank.test/api', 'a=1', { 'Content-Type': 'x' })
    expect(res.status).toBe(200)
    expect(res.body).toBe('<ok/>')
    expect(res.headers.get('x-a')).toBe('b')
    expect(seen?.url).toBe('https://bank.test/api')
    expect(seen?.init?.method).toBe('POST')
    expect(seen?.init?.body).toBe('a=1')
  })

  it('throws PosHttpError with status on 500', async () => {
    const err = await new HttpTransport({ fetch: fakeFetch(500, 'boom') })
      .post('https://bank.test/api', '', {})
      .catch((e) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect(err.status).toBe(500)
    expect(err.url).toBe('https://bank.test/api')
    expect(err.bodySnippet).toBe('boom')
  })

  it('masks PANs and truncates the snippet to 500 chars', async () => {
    const err = await new HttpTransport({ fetch: fakeFetch(400, `pan 4355084355084358 ${'x'.repeat(2000)}`) })
      .post('https://bank.test/api', '', {})
      .catch((e) => e)
    expect(err.bodySnippet).not.toContain('4355084355084358')
    expect(err.bodySnippet).toContain('435508****4358')
    expect(err.bodySnippet.length).toBeLessThanOrEqual(500)
  })

  it('wraps network errors in PosHttpError', async () => {
    const f = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const err = await new HttpTransport({ fetch: f }).post('https://bank.test/api', '', {}).catch((e) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect(err.status).toBeUndefined()
    expect((err.cause as Error).message).toBe('fetch failed')
  })

  it('times out with PosHttpError even if fetch never resolves and ignores the signal', async () => {
    const f = (() => new Promise(() => {})) as unknown as typeof fetch
    const start = Date.now()
    const err = await new HttpTransport({ fetch: f, timeoutMs: 10 })
      .post('https://bank.test/api', '', {})
      .catch((e) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect(err.message).toMatch(/timed out/i)
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it('feeding an HTML WAF page to XmlDecoder raises PosHttpError', async () => {
    const res = await new HttpTransport({
      fetch: fakeFetch(200, '<html><body>The requested URL was rejected</body></html>'),
    }).post('https://bank.test/api', '', {})
    expect(() => XmlDecoder.decode(res.body)).toThrow(PosHttpError)
  })

  it('empty body decoded raises PosHttpError', async () => {
    const res = await new HttpTransport({ fetch: fakeFetch(200, '') }).post('https://bank.test/api', '', {})
    expect(() => XmlDecoder.decode(res.body)).toThrow(PosHttpError)
  })

  it('exposes the raw body bytes next to the UTF-8 text', async () => {
    const raw = new Uint8Array([0x3c, 0x61, 0x3e, 0xdd, 0x3c, 0x2f, 0x61, 0x3e]) // <a>\xDD</a> (ISO-8859-9 İ)
    const f = (async () => new Response(raw, { status: 200 })) as unknown as typeof fetch
    const res = await new HttpTransport({ fetch: f }).post('https://bank.test/api', new Uint8Array([0x61]), {})
    expect(res.bytes).toStrictEqual(raw)
    expect(res.body).toBe('<a>\uFFFD</a>')
  })
})
