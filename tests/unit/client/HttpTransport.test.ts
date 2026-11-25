import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PosError, PosHttpError } from '../../../src/errors.js'
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

  // addition: a caller that reads failure bodies itself gets 4xx answers back; other statuses stay errors
  it('returns an HTTP 400 answer only when asked to, and still throws on other 4xx, 5xx and 3xx', async () => {
    const opts = { returnClientErrors: true }
    const t = (status: number) => new HttpTransport({ fetch: fakeFetch(status, '{"a":1}') })
    await expect(t(400).post('https://bank.test/api', 'x', {})).rejects.toThrow(PosHttpError)
    const res = await t(400).post('https://bank.test/api', 'x', {}, opts)
    expect(res.status).toBe(400)
    expect(res.body).toBe('{"a":1}')
    expect((await t(400).get('https://bank.test/api', {}, opts)).status).toBe(400)
    for (const code of [401, 403, 404, 429]) {
      await expect(t(code).post('https://bank.test/api', 'x', {}, opts)).rejects.toThrow(PosHttpError)
    }
    await expect(t(500).post('https://bank.test/api', 'x', {}, opts)).rejects.toThrow(PosHttpError)
    await expect(t(302).post('https://bank.test/api', 'x', {}, opts)).rejects.toThrow(PosHttpError)
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

    // addition: a timed-out GET keeps its query string out of the error too
    it('keeps the query string out of a timeout error url', async () => {
      const f = ((_url: unknown, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })) as unknown as typeof fetch
      const err = await new HttpTransport({ fetch: f, timeoutMs: 20 })
        .get('https://bank.test/api?token=abc', {})
        .catch((e) => e)
      expect(err.message).toContain('timed out')
      expect(err.url).toBe('https://bank.test/api')
    })
  })
})

// addition: 5.2 — a bank answer above the size cap is refused without reading or keeping it
describe('HttpTransport response size cap', () => {
  const MiB = 1024 * 1024
  const url = 'https://bank.test/api'

  /** A streamed answer of `chunks` × `size` bytes without a Content-Length; counts the chunks actually pulled. */
  const streamed = (chunks: number, size: number, status = 200) => {
    const state = { pulled: 0, cancelled: false }
    const fetchImpl = (async () => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (state.pulled >= chunks) {
            controller.close()
            return
          }
          state.pulled++
          controller.enqueue(new Uint8Array(size).fill(0x61))
        },
        cancel() {
          state.cancelled = true
        },
      })
      return new Response(body, { status })
    }) as unknown as typeof fetch
    return { fetchImpl, state }
  }

  const expectTooLarge = (err: unknown, status: number) => {
    expect(err).toBeInstanceOf(PosHttpError)
    const e = err as PosHttpError
    expect(e.message).toBe('Bank answer is too large')
    expect(e.url).toBe(url)
    expect(e.status).toBe(status)
    expect(e.bodySnippet).toBeUndefined()
    expect(e.cause).toBeUndefined()
  }

  it('refuses an answer whose Content-Length is above the cap before reading it', async () => {
    const { fetchImpl: streamOf, state } = streamed(100, MiB)
    const fetchImpl = (async () => {
      const inner = await streamOf('')
      return new Response(inner.body, { status: 200, headers: { 'content-length': String(10 * MiB + 1) } })
    }) as unknown as typeof fetch
    const err = await new HttpTransport({ fetch: fetchImpl }).post(url, '', {}).catch((e) => e)
    expectTooLarge(err, 200)
    // a stream fills its queue once on its own; the transport reads nothing and cancels it
    expect(state.pulled).toBeLessThanOrEqual(1)
    expect(state.cancelled).toBe(true)
  })

  it('stops reading a streamed answer as soon as it passes the cap', async () => {
    const { fetchImpl, state } = streamed(100, MiB)
    const err = await new HttpTransport({ fetch: fetchImpl }).post(url, '', {}).catch((e) => e)
    expectTooLarge(err, 200)
    expect(state.pulled).toBeLessThanOrEqual(12)
    expect(state.cancelled).toBe(true)
  })

  it('refuses an oversized error page too, without its body', async () => {
    const { fetchImpl } = streamed(3, 64)
    const err = await new HttpTransport({ fetch: fetchImpl, maxResponseBytes: 100 }).post(url, '', {}).catch((e) => e)
    expectTooLarge(err, 200)
    const { fetchImpl: failing } = streamed(3, 64, 500)
    expectTooLarge(
      await new HttpTransport({ fetch: failing, maxResponseBytes: 100 }).post(url, '', {}).catch((e) => e),
      500,
    )
  })

  it('applies to GET and keeps the query string out of the error url', async () => {
    const { fetchImpl } = streamed(3, 64)
    const err = await new HttpTransport({ fetch: fetchImpl, maxResponseBytes: 100 })
      .get(`${url}?token=secret`, {})
      .catch((e) => e)
    expectTooLarge(err, 200)
  })

  it('checks the bytes read, not a Content-Length that is too small', async () => {
    const fetchImpl = (async () =>
      new Response('x'.repeat(200), { status: 200, headers: { 'content-length': '10' } })) as unknown as typeof fetch
    const err = await new HttpTransport({ fetch: fetchImpl, maxResponseBytes: 100 }).post(url, '', {}).catch((e) => e)
    // the platform may refuse the mismatched length itself; either way nothing above the cap is returned
    expect(err).toBeInstanceOf(PosHttpError)
  })

  it('accepts an answer of exactly the cap and a large legitimate answer below the default cap', async () => {
    const exact = streamed(4, 25)
    const res = await new HttpTransport({ fetch: exact.fetchImpl, maxResponseBytes: 100 }).post(url, '', {})
    expect(res.bytes.length).toBe(100)
    expect(res.body).toBe('a'.repeat(100))

    const big = streamed(9, MiB)
    const bigRes = await new HttpTransport({ fetch: big.fetchImpl }).post(url, '', {})
    expect(bigRes.bytes.length).toBe(9 * MiB)
    expect(bigRes.body.length).toBe(9 * MiB)

    const history = `{"txnDetailList":[${Array.from({ length: 20000 }, (_, i) => `{"orderId":"O${i}","amount":"10.01"}`).join(',')}]}`
    const historyRes = await new HttpTransport({ fetch: fakeFetch(200, history) }).post(url, '', {})
    expect(historyRes.body).toBe(history)
  })

  it('reads a multi-byte character split across chunks correctly', async () => {
    const bytes = new TextEncoder().encode('ağ€z')
    const fetchImpl = (async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const b of bytes) controller.enqueue(new Uint8Array([b]))
          controller.close()
        },
      })
      return new Response(body, { status: 200 })
    }) as unknown as typeof fetch
    const res = await new HttpTransport({ fetch: fetchImpl }).post(url, '', {})
    expect(res.body).toBe('ağ€z')
    expect(res.bytes).toStrictEqual(bytes)
  })

  it('reads a real chunked answer from a server and refuses one above the cap', async () => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      const count = req.url === '/big' ? 50 : 3
      let sent = 0
      const write = () => {
        while (sent < count) {
          sent++
          if (!res.write('b'.repeat(1000))) {
            res.once('drain', write)
            return
          }
        }
        res.end()
      }
      write()
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const { port } = server.address() as AddressInfo
    // the server is plain http; the transport itself does not check the scheme
    const transport = new HttpTransport({ maxResponseBytes: 10_000 })
    try {
      const small = await transport.get(`http://127.0.0.1:${port}/small`, {})
      expect(small.body).toBe('b'.repeat(3000))
      const err = await transport.get(`http://127.0.0.1:${port}/big`, {}).catch((e) => e)
      expect(err).toBeInstanceOf(PosHttpError)
      expect(err.message).toBe('Bank answer is too large')
      expect(err.bodySnippet).toBeUndefined()
    } finally {
      server.closeAllConnections()
      server.close()
    }
  })

  it('rejects a cap that is not a positive whole number', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new HttpTransport({ maxResponseBytes: bad })).toThrow(PosError)
    }
  })
})

// addition: 5.2 — a custom fetch whose body is not a web stream is still capped
describe('HttpTransport size cap with a non-stream body', () => {
  const answer = (text: string) =>
    (async () => ({
      status: 200,
      headers: new Headers(),
      body: { pipe() {} },
      arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    })) as unknown as typeof fetch

  it('reads the whole body and refuses it above the cap', async () => {
    const t = (text: string) => new HttpTransport({ fetch: answer(text), maxResponseBytes: 10 })
    expect((await t('0123456789').post('https://bank.test/api', '', {})).body).toBe('0123456789')
    const err = await t('0123456789a')
      .post('https://bank.test/api', '', {})
      .catch((e) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect(err.message).toBe('Bank answer is too large')
    expect(err.bodySnippet).toBeUndefined()
  })
})
