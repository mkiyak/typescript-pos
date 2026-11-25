import { describe, expect, it } from 'vitest'
import type { ClientTxType } from '../../../src/client/AbstractHttpClient.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PayTrPosHttpClient } from '../../../src/client/PayTrPosHttpClient.js'
import { PosError, PosHttpError, UnsupportedTransactionTypeError } from '../../../src/errors.js'
import type { PosLogger } from '../../../src/logger.js'
import { noopLogger } from '../../../src/logger.js'
import { MODEL, type PaymentModel, TX_TYPE } from '../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../src/pos-query/PosQueryInterface.js'

// HTTP is replaced by a fake fetch.

const BASE = 'https://www.paytr.com'

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

function createClient(
  fetchImpl: typeof fetch,
  logger: PosLogger = noopLogger,
  secrets: readonly string[] = [],
): PayTrPosHttpClient {
  return new PayTrPosHttpClient(BASE, new HttpTransport({ fetch: fetchImpl }), logger, secrets)
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

const ORDER = { id: 'order-1' } as never

describe('PayTrPosHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it('supports', () => {
    expect(PayTrPosHttpClient.supports('PayTrPos', 'payment_api')).toBe(true)
    expect(PayTrPosHttpClient.supports('PayTrPos', 'query_api')).toBe(false)
    expect(PayTrPosHttpClient.supports('AkbankPos', 'payment_api')).toBe(false)
  })

  it('supportsTx', () => {
    expect(client.supportsTx(TX_TYPE.PAY_AUTH, MODEL.THREE_D_HOST)).toBe(true)
    expect(client.supportsTx(QUERY_TYPE.HISTORY, MODEL.NON_SECURE)).toBe(true)
    expect(client.supportsTx(TX_TYPE.REFUND, MODEL.NON_SECURE)).toBe(true)
    // addition: a transaction the bank has no endpoint for is not supported
    expect(client.supportsTx(TX_TYPE.CANCEL, MODEL.NON_SECURE)).toBe(false)
    expect(client.supportsTx('constructor' as never, MODEL.NON_SECURE)).toBe(false)
  })

  it.each([
    ['iframe_token', TX_TYPE.INTERNAL_3D_FORM_BUILD, `${BASE}/odeme/api/get-token`],
    ['refund', TX_TYPE.REFUND, `${BASE}/odeme/iade`],
    ['partial_refund', TX_TYPE.REFUND_PARTIAL, `${BASE}/odeme/iade`],
    ['status', TX_TYPE.STATUS, `${BASE}/odeme/durum-sorgu`],
    ['payment', TX_TYPE.PAY_AUTH, `${BASE}/odeme`],
    ['custom_query', QUERY_TYPE.CUSTOM_QUERY, `${BASE}/odeme`],
    ['history', QUERY_TYPE.HISTORY, `${BASE}/rapor/islem-dokumu`],
    ['installment_rates', QUERY_TYPE.INSTALLMENT_RATES, `${BASE}/odeme/taksit-oranlari`],
    ['bin_list', QUERY_TYPE.BIN_LIST, `${BASE}/odeme/api/bin-detail`],
  ] as Array<[string, ClientTxType, string]>)('getApiUrl %s', (_name, txType, expected) => {
    expect(client.getApiUrl(txType, MODEL.NON_SECURE)).toBe(expected)
  })

  it('getApiUrl without a transaction type throws', () => {
    // deviation: C6 — InvalidArgumentException becomes PosError
    expect(() => client.getApiUrl(undefined as never, MODEL.NON_SECURE)).toThrow(
      new PosError('Transaction type is required to generate PayTR API URL'),
    )
  })

  it('getApiUrl of an unsupported transaction throws', () => {
    // deviation: C6 — the message names the transaction type
    expect(() => client.getApiUrl(TX_TYPE.CANCEL, MODEL.NON_SECURE)).toThrow(UnsupportedTransactionTypeError)
    expect(() => client.getApiUrl(TX_TYPE.CANCEL, MODEL.NON_SECURE)).toThrow(/cancel/)
  })

  it.each([
    [
      'payment',
      TX_TYPE.PAY_AUTH,
      MODEL.NON_SECURE,
      { merchant_id: '123456', merchant_oid: 'order-1' },
      'order-1',
      '/odeme',
    ],
    [
      'iframe_token',
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      MODEL.THREE_D_HOST,
      { merchant_id: '123456', merchant_oid: 'order-2' },
      'order-2',
      '/odeme/api/get-token',
    ],
  ] as Array<[string, ClientTxType, PaymentModel, Record<string, unknown>, string, string]>)(
    'request %s',
    async (_name, txType, model, data, orderId, path) => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '{"status":"success","token":"abc123"}'))

      const actual = await c.request(txType, model, data, { id: orderId } as never)

      expect(actual).toStrictEqual({ status: 'success', token: 'abc123' })
      expect(sent).toHaveLength(1)
      expect(sent[0]?.url).toBe(`${BASE}${path}`)
      expect(sent[0]?.init.method).toBe('POST')
      expect(sent[0]?.body).toBe(`merchant_id=123456&merchant_oid=${orderId}`)
      expect(sent[0]?.headers['content-type']).toBe('application/x-www-form-urlencoded')
    },
  )

  // addition: values are percent-encoded like http_build_query, the basket JSON included
  it('percent-encodes values', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '{"status":"success"}'))

    await c.request(
      TX_TYPE.PAY_AUTH,
      MODEL.NON_SECURE,
      { user_basket: '[["Ürün & Co","10.50",1]]', note: 'a+b=c d', user_name: 'Çağrı Şen' },
      ORDER,
    )

    expect(sent[0]?.body).toBe(
      'user_basket=%5B%5B%22%C3%9Cr%C3%BCn+%26+Co%22%2C%2210.50%22%2C1%5D%5D&note=a%2Bb%3Dc+d&user_name=%C3%87a%C4%9Fr%C4%B1+%C5%9Een',
    )
  })

  // addition: an unrouted transaction never reaches the network
  it('an unsupported transaction never reaches the network', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '{}'))

    await expect(c.request(TX_TYPE.CANCEL, MODEL.NON_SECURE, { a: 1 }, ORDER)).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    await expect(c.request('constructor' as never, MODEL.NON_SECURE, { a: 1 }, ORDER)).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    expect(sent).toHaveLength(0)
  })

  // addition: anything that is not a JSON object is an error that names the real url
  it.each([
    ['an HTML WAF page', '<html><body>Request blocked</body></html>'],
    ['plain text', 'PAYTR ERROR'],
    ['a JSON array', '[1]'],
    ['a JSON scalar', '"ok"'],
    ['null', 'null'],
    ['an empty 200 answer', ''],
    ['truncated JSON', '{"status":"succ'],
    ['a UTF-8 byte order mark before JSON', '﻿{"status":"success"}'],
  ])('%s is a PosHttpError', async (_name, body) => {
    // the byte order mark is sent as real bytes: the text decoder of a response would otherwise drop it silently
    const bytes = new TextEncoder().encode(body)
    const c = createClient(fakeFetch([], bytes))

    const error = await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, ORDER).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PosHttpError)
    expect((error as PosHttpError).url).toBe(`${BASE}/odeme`)
  })

  // addition: 204 is an empty answer, not an error (the gateway decides what an empty answer means)
  it('a 204 answer is an empty object', async () => {
    const c = createClient(fakeFetch([], '', 204))

    expect(await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, ORDER)).toStrictEqual({})
  })

  // addition: any non-2xx answer is an error
  it.each([400, 403, 500, 302])('a %s answer is a PosHttpError', async (status) => {
    const c = createClient(fakeFetch([], '{"status":"success"}', status))

    await expect(c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, ORDER)).rejects.toThrow(PosHttpError)
  })

  // addition: a redirect is never followed (the body holds card data and the signed token)
  it('does not follow a redirect', async () => {
    const calls: Array<{ url: string; redirect?: string }> = []
    const c = createClient((async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), redirect: init?.redirect })
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/odeme' } })
    }) as unknown as typeof fetch)

    await expect(c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, ORDER)).rejects.toThrow(PosHttpError)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.redirect).toBe('error')
  })

  // addition: a prototype key stays plain data
  it('keeps __proto__ as an own key without touching the prototype', async () => {
    const c = createClient(fakeFetch([], '{"__proto__":{"x":1},"status":"success"}'))

    const actual = await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, ORDER)

    expect(Object.hasOwn(actual, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(actual)).toBe(Object.prototype)
    expect((actual as { x?: unknown }).x).toBeUndefined()
    expect(({} as { x?: unknown }).x).toBeUndefined()
  })

  // addition: the request token never reaches a log line, even when a bank text echoes it
  it('masks an echoed paytr_token when the answer cannot be decoded', async () => {
    const token = 'dG9rZW4tdmFsdWUtMTIzNDU2Nzg5MGFiY2RlZg=='
    const { logger, lines } = recordingLogger()
    const c = createClient(fakeFetch([], `<html>bad token ${token}</html>`), logger)

    await expect(
      c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { merchant_id: '1', paytr_token: token }, ORDER),
    ).rejects.toThrow(PosHttpError)

    const logged = lines.join('\n')
    expect(logged).not.toContain(token)
    expect(logged).toContain('***')
  })

  // addition: the merchant key and salt are masked in every log line, also as free text and in card-masked form
  it.each([
    ['plain secrets', 'wWwU8buJp6jo1r25', 'YEUaNcdHXqyt7hjt', (k: string, s: string) => `key ${k} salt ${s}`],
    [
      'card-shaped secrets, echoed in full',
      '4546711234567894',
      '5555444433332222',
      (k: string, s: string) => `<html>${k} ${s}</html>`,
    ],
    [
      'card-shaped secrets, echoed in masked form',
      '4546711234567894',
      '5555444433332222',
      () => '<html>454671****7894 555544****2222</html>',
    ],
  ] as Array<[string, string, string, (k: string, s: string) => string]>)(
    'masks the account secrets: %s',
    async (_name, key, salt, echo) => {
      for (const status of [200, 400, 500]) {
        const { logger, lines } = recordingLogger()
        const c = createClient(fakeFetch([], echo(key, salt), status), logger, [salt, key])

        const error = await c
          .request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { merchant_id: '1', paytr_token: 'tok' }, ORDER)
          .catch((e: unknown) => e)

        expect(error).toBeInstanceOf(PosHttpError)
        const logged = lines.join('\n')
        expect(logged).not.toContain(key)
        expect(logged).not.toContain(salt)
        expect(logged).not.toContain('454671****7894')
        expect(logged).not.toContain('555544****2222')
        expect(logged).toContain('***')
      }
    },
  )

  // addition: a transport failure message that echoes a secret is masked too
  it('masks the account secrets in a transport failure', async () => {
    const { logger, lines } = recordingLogger()
    const c = createClient(
      (async () => {
        throw new TypeError('fetch failed for key wWwU8buJp6jo1r25')
      }) as unknown as typeof fetch,
      logger,
      ['YEUaNcdHXqyt7hjt', 'wWwU8buJp6jo1r25'],
    )

    await expect(c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, ORDER)).rejects.toThrow(PosHttpError)

    expect(lines.join('\n')).not.toContain('wWwU8buJp6jo1r25')
  })

  // addition: bodies, card data and the request token never reach a logger on success either
  it('never logs bodies', async () => {
    const { logger, lines } = recordingLogger()
    const c = createClient(fakeFetch([], '{"status":"success","token":"ANSWERTOKEN"}'), logger)

    await c.request(
      TX_TYPE.PAY_AUTH,
      MODEL.NON_SECURE,
      { card_number: '4546711234567894', cvv: '987', paytr_token: 'REQTOKEN==' },
      ORDER,
    )

    const logged = lines.join('\n')
    for (const secret of ['4546711234567894', '987', 'REQTOKEN==', 'ANSWERTOKEN']) {
      expect(logged).not.toContain(secret)
    }
  })
})
