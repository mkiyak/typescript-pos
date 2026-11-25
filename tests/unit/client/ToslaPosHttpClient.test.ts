import { describe, expect, it } from 'vitest'
import type { ClientTxType } from '../../../src/client/AbstractHttpClient.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { ToslaPosHttpClient } from '../../../src/client/ToslaPosHttpClient.js'
import { PosError, PosHttpError, UnsupportedTransactionTypeError } from '../../../src/errors.js'
import type { PosLogger } from '../../../src/logger.js'
import { noopLogger } from '../../../src/logger.js'
import { MODEL, type PaymentModel, TX_TYPE } from '../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../src/pos-query/PosQueryInterface.js'

// HTTP is replaced by a fake fetch.

const API_URL = 'https://ent.akodepos.com/api/Payment'

type Sent = { url: string; init: RequestInit; headers: Record<string, string>; body: string }

function fakeFetch(sent: Sent[], body: string | Uint8Array, status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sent.push({
      url: String(url),
      init: init ?? {},
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: String(init?.body),
    })
    return new Response(status === 204 ? null : (body as string), { status })
  }) as unknown as typeof fetch
}

function createClient(fetchImpl: typeof fetch, logger: PosLogger = noopLogger): ToslaPosHttpClient {
  return new ToslaPosHttpClient(API_URL, new HttpTransport({ fetch: fetchImpl }), logger)
}

function recordingLogger(): { logger: PosLogger; lines: string[] } {
  const lines: string[] = []
  const rec = (level: string) => (msg: string, ctx?: unknown) => {
    lines.push(
      `${level} ${msg} ${JSON.stringify(ctx, (_k, v) => (v instanceof Error ? { ...v, message: v.message, stack: v.stack } : v))}`,
    )
  }
  return { logger: { debug: rec('debug'), info: rec('info'), warn: rec('warn'), error: rec('error') }, lines }
}

const ORDER = { id: 'ORDER-1' } as never

describe('ToslaPosHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it('supports', () => {
    expect(ToslaPosHttpClient.supports('ToslaPos', 'payment_api')).toBe(true)
    expect(ToslaPosHttpClient.supports('PosNetPos', 'payment_api')).toBe(false)
  })

  it('supportsTx', () => {
    expect(client.supportsTx(QUERY_TYPE.CUSTOM_QUERY, MODEL.NON_SECURE)).toBe(true)
    expect(client.supportsTx(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE)).toBe(true)
    expect(client.supportsTx(QUERY_TYPE.HISTORY, MODEL.NON_SECURE)).toBe(false)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY, `${API_URL}/threeDPayment`],
    [TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_PAY, `${API_URL}/threeDPreAuth`],
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_HOST, `${API_URL}/threeDPayment`],
    [TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_HOST, `${API_URL}/threeDPreAuth`],
    [TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, `${API_URL}/Payment`],
    [TX_TYPE.PAY_POST_AUTH, MODEL.NON_SECURE, `${API_URL}/postAuth`],
    [TX_TYPE.STATUS, MODEL.NON_SECURE, `${API_URL}/inquiry`],
    [TX_TYPE.CANCEL, MODEL.NON_SECURE, `${API_URL}/void`],
    [TX_TYPE.REFUND, MODEL.NON_SECURE, `${API_URL}/refund`],
    [TX_TYPE.REFUND_PARTIAL, MODEL.NON_SECURE, `${API_URL}/refund`],
    [TX_TYPE.ORDER_HISTORY, MODEL.NON_SECURE, `${API_URL}/history`],
    // addition: the installment queries have their own paths whatever the payment model is
    [QUERY_TYPE.INSTALLMENT_RATES, MODEL.NON_SECURE, `${API_URL}/GetCommissionAndInstallmentInfo`],
    [QUERY_TYPE.INSTALLMENT_PRICES, MODEL.NON_SECURE, `${API_URL}/GetInstallmentOptions`],
  ] as Array<[ClientTxType, PaymentModel, string]>)('getApiUrl(%s, %s)', (txType, paymentModel, expected) => {
    expect(client.getApiUrl(txType, paymentModel)).toBe(expected)
  })

  it.each([
    [QUERY_TYPE.HISTORY, MODEL.NON_SECURE],
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE],
    // addition: a pre-authorisation needs a 3D model of its own, and a query has no route for a made-up type
    [TX_TYPE.PAY_PRE_AUTH, MODEL.NON_SECURE],
    ['nope', MODEL.NON_SECURE],
    ['constructor', MODEL.NON_SECURE],
    [TX_TYPE.PAY_AUTH, 'constructor'],
  ] as Array<[ClientTxType, PaymentModel]>)('getApiUrl(%s, %s) is unsupported', (txType, paymentModel) => {
    expect(() => client.getApiUrl(txType, paymentModel)).toThrow(UnsupportedTransactionTypeError)
  })

  it.each([
    [null, null],
    [TX_TYPE.PAY_AUTH, null],
    [null, MODEL.THREE_D_PAY],
  ])('getApiUrl(%s, %s) without both arguments throws', (txType, paymentModel) => {
    // deviation: T19 — InvalidArgumentException becomes PosError
    expect(() => client.getApiUrl(txType as never, paymentModel as never)).toThrow(PosError)
  })

  it('request', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '{"decoded":"response"}'))

    // deviation: list input is not a request shape, an object is posted
    const actual = await c.request(
      TX_TYPE.PAY_AUTH,
      MODEL.THREE_D_PAY,
      { 'request-data': 'x' },
      ORDER,
      `${API_URL}/threeDPayment`,
    )

    expect(actual).toStrictEqual({ decoded: 'response' })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(`${API_URL}/threeDPayment`)
    expect(sent[0]?.init.method).toBe('POST')
    expect(sent[0]?.body).toBe('{"request-data":"x"}')
    expect(sent[0]?.headers['content-type']).toBe('application/json')
  })

  it('request without a url posts to the path of the transaction', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '{"Code":0}'))

    await c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY, { a: 1 }, ORDER)

    expect(sent[0]?.url).toBe(`${API_URL}/threeDPayment`)
  })

  it('request with an empty answer', async () => {
    const c = createClient(fakeFetch([], '', 204))

    expect(await c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY, { a: 1 }, ORDER)).toStrictEqual({})
  })

  it('request with a server error', async () => {
    // deviation: T19 — RuntimeException becomes the transport's PosHttpError
    const c = createClient(fakeFetch([], '{"Code":500}', 500))

    await expect(c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY, { a: 1 }, ORDER)).rejects.toThrow(PosHttpError)
  })

  it('request with an undecodable bad request', async () => {
    const c = createClient(fakeFetch([], 'Bad Request', 400))

    await expect(c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY, { a: 1 }, ORDER)).rejects.toThrow(PosHttpError)
  })

  it('an unsupported transaction never reaches the network', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '{}'))

    await expect(c.request(QUERY_TYPE.HISTORY, MODEL.NON_SECURE, { a: 1 }, ORDER)).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    expect(sent).toHaveLength(0)
  })

  // addition: a custom query is posted to the url the caller gives
  it('posts a custom query to its own url', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '{"Code":0}'))

    await c.request(QUERY_TYPE.CUSTOM_QUERY, MODEL.NON_SECURE, { a: 1 }, ORDER, `${API_URL}/x`)

    expect(sent[0]?.url).toBe(`${API_URL}/x`)
  })

  // addition: the custom query has no route of its own
  it.each([undefined, null, ''])('a custom query without a url (%s) is refused before any request', async (url) => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '{"Code":0}'))

    await expect(c.request(QUERY_TYPE.CUSTOM_QUERY, MODEL.NON_SECURE, { a: 1 }, ORDER, url)).rejects.toThrow(
      new PosError('Tosla custom queries need an apiUrl'),
    )
    expect(sent).toHaveLength(0)
  })

  // addition: anything that is not a JSON object is an error that names the real url
  it.each([
    ['an HTML WAF page', '<html><body>Request blocked</body></html>'],
    ['a JSON array', '[1]'],
    ['a JSON scalar', '"ok"'],
    ['null', 'null'],
    ['truncated JSON', '{"Code":0'],
    ['a UTF-8 byte order mark before JSON', '﻿{"Code":0}'],
  ])('%s is a PosHttpError', async (_name, body) => {
    // the byte order mark is sent as real bytes: the text decoder of a response would otherwise drop it silently
    const bytes = new TextEncoder().encode(body)
    const c = createClient(fakeFetch([], bytes))

    const error = await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, ORDER).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PosHttpError)
    expect((error as PosHttpError).url).toBe(`${API_URL}/Payment`)
  })

  // addition: a redirect is never followed (the body holds card data and credentials)
  it('a redirect is a PosHttpError', async () => {
    const c = createClient((async () => {
      throw new TypeError('fetch failed: unexpected redirect')
    }) as unknown as typeof fetch)

    await expect(c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, ORDER)).rejects.toThrow(PosHttpError)
  })

  // addition: a 302 answer is an error, not a decoded body
  it('a 302 answer is a PosHttpError', async () => {
    const c = createClient(fakeFetch([], '{"Code":0}', 302))

    await expect(c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, ORDER)).rejects.toThrow(PosHttpError)
  })

  // addition: a prototype key stays plain data
  it('keeps __proto__ as an own key without touching the prototype', async () => {
    const c = createClient(fakeFetch([], '{"__proto__":{"x":1},"Code":0}'))

    const actual = await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, ORDER)

    expect(Object.hasOwn(actual, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(actual)).toBe(Object.prototype)
    expect((actual as { x?: unknown }).x).toBeUndefined()
    expect(({} as { x?: unknown }).x).toBeUndefined()
    expect(actual.Code).toBe(0)
  })

  // addition: bodies, card data and the request hash never reach a logger, not even from an error answer
  it('never logs bodies', async () => {
    const secrets = ['4546711234567894', '987', 'SECRETHASHVALUE==', 'APIPASS-SECRET']
    for (const [body, status] of [
      ['{"Code":0}', 200],
      [`{"cardNo":"${secrets[0]}","cvv":"${secrets[1]}","hash":"${secrets[2]}","apiPass":"${secrets[3]}"}`, 400],
      // free text cannot be masked by field name; a card number in it still is
      [`<html>${secrets[0]}</html>`, 200],
    ] as Array<[string, number]>) {
      const { logger, lines } = recordingLogger()
      const c = createClient(fakeFetch([], body, status), logger)

      await c
        .request(
          TX_TYPE.PAY_AUTH,
          MODEL.NON_SECURE,
          { cardNo: secrets[0], cvv: secrets[1], hash: secrets[2], apiPass: secrets[3] },
          ORDER,
        )
        .catch(() => undefined)

      const logged = lines.join('\n')
      expect(logged).not.toContain(secrets[0] as string)
      if (!body.startsWith('<')) for (const secret of secrets) expect(logged).not.toContain(secret)
      // the masked forms show the masking ran, rather than the lines being empty
      if (status === 400) expect(logged).toContain('***')
      if (body.startsWith('<')) expect(logged).toContain('454671****7894')
    }
  })
})
