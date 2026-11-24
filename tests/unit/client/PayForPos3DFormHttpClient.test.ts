import { describe, expect, it } from 'vitest'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PayForPos3DFormHttpClient } from '../../../src/client/PayForPos3DFormHttpClient.js'
import { PosHttpError } from '../../../src/errors.js'
import type { PosLogger } from '../../../src/logger.js'
import { MODEL, TX_TYPE } from '../../../src/PosInterface.js'

// HTTP is replaced by a fake fetch.

const API_URL = 'https://vpostest.qnbfinansbank.com/Gateway/Default.aspx'

type Sent = { url: string; init: RequestInit }

function fakeFetch(sent: Sent[], body: string, status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(status === 204 ? null : body, { status })
  }) as unknown as typeof fetch
}

function createClient(fetchImpl: typeof fetch, logger?: PosLogger): PayForPos3DFormHttpClient {
  return new PayForPos3DFormHttpClient(API_URL, new HttpTransport({ fetch: fetchImpl }), logger)
}

describe('PayForPos3DFormHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it('supports', () => {
    const api = PayForPos3DFormHttpClient.API_NAME_GATEWAY_3D_API
    expect(PayForPos3DFormHttpClient.supports('PayForPos', api)).toBe(true)
    expect(PayForPos3DFormHttpClient.supports('AkbankPos', api)).toBe(false)
    expect(PayForPos3DFormHttpClient.supports('PayForPos', 'payment_api')).toBe(false)
  })

  it('supportsTx', () => {
    expect(client.supportsTx(TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_SECURE)).toBe(true)
    expect(client.supportsTx(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE)).toBe(false)
  })

  it('request', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '<html>3d-form-html</html>'))
    // deviation: clients return records
    const actual = await c.request(
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      MODEL.THREE_D_SECURE,
      { foo: 'bar', baz: 'qux' },
      { id: '123' },
      API_URL,
    )

    expect(actual).toStrictEqual({ html: '<html>3d-form-html</html>' })
    const [request] = sent as [Sent]
    expect(request.url).toBe(API_URL)
    expect(request.init.method).toBe('POST')
    expect(request.init.body).toBe('foo=bar&baz=qux')
    expect(new Headers(request.init.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded')
  })

  // addition: a redirect answer is not followed (the form carries card data) and surfaces as PosHttpError
  it('does not follow a redirect', async () => {
    const sent: Sent[] = []
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      sent.push({ url: String(url), init: init ?? {} })
      if (init?.redirect === 'error') throw new TypeError('fetch failed: unexpected redirect')
      return new Response('', { status: 302, headers: { Location: 'https://evil.example/' } })
    }) as unknown as typeof fetch
    const c = createClient(fetchImpl)
    const err = await c
      .request(TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_SECURE, { Pan: '4155650100416111' }, { id: '1' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect(sent).toHaveLength(1)
  })

  // addition: a 3xx that reaches the client as a plain response is a PosHttpError as well
  it('rejects a 302 response', async () => {
    const c = createClient(fakeFetch([], '', 302))
    await expect(
      c.request(TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_SECURE, { foo: 'bar' }, { id: '1' }),
    ).rejects.toThrow(PosHttpError)
  })

  // addition: a server error is a PosHttpError and its snippet hides the card data
  it('rejects a 500 response without echoing secrets', async () => {
    const c = createClient(fakeFetch([], '<html>Error Pan=4155650100416111&Cvv2=715</html>', 500))
    const err = (await c
      .request(TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_SECURE, { Pan: '4155650100416111' }, { id: '1' })
      .catch((e: unknown) => e)) as PosHttpError
    expect(err).toBeInstanceOf(PosHttpError)
    expect(err.status).toBe(500)
    expect(`${err.message}${err.bodySnippet ?? ''}`).not.toContain('4155650100416111')
  })

  // addition: an empty 204 answer is an empty record (the gateway then rejects the missing html)
  it('returns an empty record for 204', async () => {
    const c = createClient(fakeFetch([], '', 204))
    expect(
      await c.request(TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_SECURE, { foo: 'bar' }, { id: '1' }),
    ).toStrictEqual({})
  })

  // addition: form values never reach a logger
  it('never logs the posted form', async () => {
    const calls: string[] = []
    const rec = (level: string) => (msg: string, ctx?: unknown) => {
      calls.push(`${level} ${msg} ${JSON.stringify(ctx)}`)
    }
    const logger: PosLogger = { debug: rec('debug'), info: rec('info'), warn: rec('warn'), error: rec('error') }
    const c = createClient(fakeFetch([], '<html>ok</html>'), logger)
    await c.request(
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      MODEL.THREE_D_SECURE,
      { Pan: '4155650100416111', Cvv2: '715', Expiry: '0125', MerchantPass: 'store-secret' },
      { id: '1' },
    )
    const all = calls.join('\n')
    for (const secret of ['4155650100416111', '715', '0125', 'store-secret']) expect(all).not.toContain(secret)
    expect(calls.length).toBeGreaterThan(0)
  })
})
