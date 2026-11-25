import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
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

  it('refuses to follow redirects (the body would be resent elsewhere)', async () => {
    let redirectedBody = ''
    const server = createServer((req, res) => {
      if (req.url === '/api') {
        res.writeHead(307, { Location: '/elsewhere' }).end()
        return
      }
      req.on('data', (c: Buffer) => {
        redirectedBody += c.toString()
      })
      req.on('end', () => res.writeHead(200).end('<ok/>'))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const { port } = server.address() as AddressInfo
      const err = await new HttpTransport()
        .post(`http://127.0.0.1:${port}/api`, 'Pan=4355084355084358', {})
        .catch((e) => e)
      expect(err).toBeInstanceOf(PosHttpError)
      expect(redirectedBody).toBe('')
    } finally {
      server.close()
    }
  })

  it('passes redirect: error to an injected fetch and rejects a 3xx it returns', async () => {
    let seen: RequestInit | undefined
    const f = (async (_url: unknown, init?: RequestInit) => {
      seen = init
      return new Response(null, { status: 308, headers: { Location: 'https://evil.test' } })
    }) as unknown as typeof fetch
    const err = await new HttpTransport({ fetch: f }).post('https://bank.test/api', '', {}).catch((e) => e)
    expect(seen?.redirect).toBe('error')
    expect(err).toBeInstanceOf(PosHttpError)
    expect(err.status).toBe(308)
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

  // addition: GET requests (signed-URL gateways)
  describe('get', () => {
    it('sends a GET without a body, with the headers and redirect: error', async () => {
      let seen: { url: unknown; init: RequestInit | undefined } | undefined
      const f = (async (url: unknown, init?: RequestInit) => {
        seen = { url, init }
        return new Response('{"ok":1}', { status: 200, headers: { 'x-a': 'b' } })
      }) as unknown as typeof fetch
      const res = await new HttpTransport({ fetch: f }).get('https://bank.test/api?a=1', { Authorization: 'x' })
      expect(res.status).toBe(200)
      expect(res.body).toBe('{"ok":1}')
      expect(res.headers.get('x-a')).toBe('b')
      expect(seen?.url).toBe('https://bank.test/api?a=1')
      expect(seen?.init?.method).toBe('GET')
      expect(seen?.init).not.toHaveProperty('body')
      expect(seen?.init?.redirect).toBe('error')
      expect(seen?.init?.headers).toEqual({ Authorization: 'x' })
    })

    it('rejects a 404 with the status and a body snippet', async () => {
      const err = await new HttpTransport({ fetch: fakeFetch(404, 'not here') })
        .get('https://bank.test/api', {})
        .catch((e) => e)
      expect(err).toBeInstanceOf(PosHttpError)
      expect(err.status).toBe(404)
      expect(err.bodySnippet).toBe('not here')
    })

    it('rejects a 3xx it is handed', async () => {
      const err = await new HttpTransport({ fetch: fakeFetch(308, '') })
        .get('https://bank.test/api', {})
        .catch((e) => e)
      expect(err).toBeInstanceOf(PosHttpError)
      expect(err.status).toBe(308)
    })

    it('wraps a fetch rejection', async () => {
      const f = (async () => {
        throw new TypeError('boom')
      }) as unknown as typeof fetch
      const err = await new HttpTransport({ fetch: f }).get('https://bank.test/api', {}).catch((e) => e)
      expect(err).toBeInstanceOf(PosHttpError)
      expect(err.message).toContain('boom')
    })

    it('times out', async () => {
      const f = ((_url: unknown, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })) as unknown as typeof fetch
      const err = await new HttpTransport({ fetch: f, timeoutMs: 20 }).get('https://bank.test/api', {}).catch((e) => e)
      expect(err).toBeInstanceOf(PosHttpError)
      expect(err.message).toContain('timed out')
    })

    it('keeps the query string out of an error url', async () => {
      const err = await new HttpTransport({ fetch: fakeFetch(500, 'x') })
        .get('https://bank.test/api?token=abc', {})
        .catch((e) => e)
      expect(err.url).toBe('https://bank.test/api')
    })
  })
})
