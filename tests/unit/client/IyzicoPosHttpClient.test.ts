import { createHmac } from 'node:crypto'
import { inspect } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import type { ClientTxType } from '../../../src/client/AbstractHttpClient.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { IyzicoPosHttpClient } from '../../../src/client/IyzicoPosHttpClient.js'
import { AkbankPosCrypt } from '../../../src/crypt/AkbankPosCrypt.js'
import { IyzicoPosCrypt } from '../../../src/crypt/IyzicoPosCrypt.js'
import { PosError, PosHttpError, UnsupportedTransactionTypeError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosLogger } from '../../../src/logger.js'
import { noopLogger } from '../../../src/logger.js'
import { MODEL, type PaymentModel, TX_TYPE } from '../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../src/pos-query/PosQueryInterface.js'

const BASE_URL = 'https://sandbox-api.iyzipay.com'

const account = AccountFactory.createIyzicoPosAccount('iyzico', 'api-key', 'secret-key')
const IA = AccountFactory.createIyzicoPosAccount('iyzico', 'sandbox-apiKey', 'sandbox-secretKey')

type Sent = { url: string; init: RequestInit; body: string; headers: Record<string, string> }

function fakeFetch(sent: Sent[], body: string | (() => string), status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    sent.push({ url: String(url), init: init ?? {}, body: typeof init?.body === 'string' ? init.body : '', headers })
    return new Response(status === 204 ? null : typeof body === 'function' ? body() : body, { status })
  }) as unknown as typeof fetch
}

function stubCrypt(rnd = 'rnd-value', hash = 'hash-value'): IyzicoPosCrypt {
  const crypt = new IyzicoPosCrypt()
  vi.spyOn(crypt, 'generateRandomString').mockReturnValue(rnd)
  vi.spyOn(crypt, 'createHash').mockReturnValue(hash)
  return crypt
}

function createClient(
  fetchImpl: typeof fetch,
  crypt: IyzicoPosCrypt = stubCrypt(),
  logger: PosLogger = noopLogger,
  acc = account,
): IyzicoPosHttpClient {
  return new IyzicoPosHttpClient(BASE_URL, new HttpTransport({ fetch: fetchImpl }), logger, crypt, acc)
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

const HX = (s: string, key = 'sandbox-secretKey'): string => createHmac('sha256', key).update(s, 'utf8').digest('hex')

function verifyHeader(header: string | undefined, path: string, body: string, acc = 'sandbox-apiKey'): void {
  expect(header?.startsWith('IYZWSv2 ')).toBe(true)
  const decoded = Buffer.from((header ?? '').slice('IYZWSv2 '.length), 'base64').toString('utf8')
  const m = /^apiKey:([^&]*)&randomKey:([^&]*)&signature:([0-9a-f]{64})$/.exec(decoded)
  expect(m).not.toBeNull()
  expect(m?.[1]).toBe(acc)
  expect(m?.[3]).toBe(HX(`${m?.[2]}${path}${body}`))
}

describe('IyzicoPosHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it('supports', () => {
    expect(IyzicoPosHttpClient.supports('IyzicoPos', IyzicoPosHttpClient.API_NAME_PAYMENT_API)).toBe(true)
    expect(IyzicoPosHttpClient.supports('IyzicoPos', 'gateway_3d')).toBe(false)
    expect(IyzicoPosHttpClient.supports('AkbankPos', IyzicoPosHttpClient.API_NAME_PAYMENT_API)).toBe(false)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, true],
    [TX_TYPE.PAY_PRE_AUTH, true],
    [TX_TYPE.PAY_POST_AUTH, true],
    [TX_TYPE.CANCEL, true],
    [TX_TYPE.REFUND, true],
    [TX_TYPE.STATUS, true],
    [TX_TYPE.INTERNAL_3D_FORM_BUILD, true],
    [TX_TYPE.INTERNAL_3D_PAYMENT_STATUS, true],
    [TX_TYPE.ORDER_HISTORY, false],
    [QUERY_TYPE.HISTORY, false],
  ] as Array<[ClientTxType, boolean]>)('supportsTx(%s)', (txType, expected) => {
    expect(client.supportsTx(txType, MODEL.NON_SECURE)).toBe(expected)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, undefined, '/payment/auth'],
    [TX_TYPE.PAY_PRE_AUTH, MODEL.NON_SECURE, undefined, '/payment/preauth'],
    [TX_TYPE.PAY_POST_AUTH, MODEL.NON_SECURE, undefined, '/payment/postauth'],
    [TX_TYPE.CANCEL, MODEL.NON_SECURE, undefined, '/payment/cancel'],
    [TX_TYPE.STATUS, MODEL.NON_SECURE, undefined, '/payment/detail'],
    [TX_TYPE.REFUND, MODEL.NON_SECURE, undefined, '/v2/payment/refund'],
    [TX_TYPE.REFUND_PARTIAL, MODEL.NON_SECURE, undefined, '/v2/payment/refund'],
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, undefined, '/payment/v2/3dsecure/auth'],
    [TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_SECURE, undefined, '/payment/v2/3dsecure/auth'],
    [TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, '/payment/3dsecure/initialize'],
    [
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      MODEL.THREE_D_SECURE,
      TX_TYPE.PAY_PRE_AUTH,
      '/payment/3dsecure/initialize/preauth',
    ],
    [
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_AUTH,
      '/payment/iyzipos/checkoutform/initialize/auth/ecom',
    ],
    [
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_PRE_AUTH,
      '/payment/iyzipos/checkoutform/initialize/preauth/ecom',
    ],
    [
      TX_TYPE.INTERNAL_3D_PAYMENT_STATUS,
      MODEL.THREE_D_HOST,
      undefined,
      '/payment/iyzipos/checkoutform/auth/ecom/detail',
    ],
    [QUERY_TYPE.INSTALLMENT_PRICES, MODEL.NON_SECURE, undefined, '/payment/iyzipos/installment'],
    [QUERY_TYPE.BIN_LIST, MODEL.NON_SECURE, undefined, '/payment/bin/check'],
  ] as Array<[ClientTxType, PaymentModel, ClientTxType | undefined, string]>)(
    'getApiUrl(%s, %s, %s)',
    (txType, model, orderTxType, path) => {
      expect(client.getApiUrl(txType, model, orderTxType as never)).toBe(`${BASE_URL}${path}`)
    },
  )

  it('getApiUrl throws without a transaction type', () => {
    // deviation: C7 — InvalidArgumentException becomes PosError
    expect(() => client.getApiUrl(undefined as never, MODEL.NON_SECURE)).toThrow(PosError)
    expect(() => client.getApiUrl(undefined as never, MODEL.NON_SECURE)).toThrow(
      'Transaction type is required to generate API URL',
    )
  })

  it('getApiUrl throws for a 3D Host form build without an order transaction type', () => {
    // deviation: C7 — InvalidArgumentException becomes PosError
    expect(() => client.getApiUrl(TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_HOST)).toThrow(PosError)
  })

  it('getApiUrl throws for a 3D Host form build of an unsupported order transaction type', () => {
    // deviation: C7 — InvalidArgumentException becomes PosError
    expect(() => client.getApiUrl(TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_HOST, TX_TYPE.CANCEL)).toThrow(PosError)
  })

  it('getApiUrl throws for a transaction type without a route', () => {
    // deviation: C7 — InvalidArgumentException becomes UnsupportedTransactionTypeError
    expect(() => client.getApiUrl(QUERY_TYPE.HISTORY, MODEL.NON_SECURE)).toThrow(UnsupportedTransactionTypeError)
    expect(() => client.getApiUrl(QUERY_TYPE.HISTORY, MODEL.NON_SECURE)).toThrow(
      'Unsupported transaction type: history',
    )
  })

  it('constructor rejects a crypt that is not the iyzico crypt', () => {
    // deviation: C7 — LogicException becomes PosError
    expect(
      () =>
        new IyzicoPosHttpClient(
          BASE_URL,
          new HttpTransport(),
          noopLogger,
          new AkbankPosCrypt() as unknown as IyzicoPosCrypt,
          account,
        ),
    ).toThrow(PosError)
  })

  it('constructor rejects an account that is not an iyzico account', () => {
    // deviation: the account is a constructor argument
    const akbank = AccountFactory.createAkbankPosAccount('akbank-pos', 'a', 'b', 'c')
    expect(
      () =>
        new IyzicoPosHttpClient(
          BASE_URL,
          new HttpTransport(),
          noopLogger,
          new IyzicoPosCrypt(),
          akbank as unknown as typeof account,
        ),
    ).toThrow(PosError)
  })

  it('request', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '{"status":"success"}'))

    const actual = await c.request(
      TX_TYPE.PAY_AUTH,
      MODEL.NON_SECURE,
      { locale: 'tr', price: 100 },
      { id: 'order-1' } as never,
      `${BASE_URL}/payment/auth`,
    )

    expect(actual).toStrictEqual({ status: 'success' })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(`${BASE_URL}/payment/auth`)
    expect(sent[0]?.init.method).toBe('POST')
    // deviation: JSON numbers have no .0
    expect(sent[0]?.body).toBe('{"locale":"tr","price":100}')
    expect(sent[0]?.headers['content-type']).toBe('application/json')
    expect(sent[0]?.headers.authorization).toBe(
      'IYZWSv2 YXBpS2V5OmFwaS1rZXkmcmFuZG9tS2V5OnJuZC12YWx1ZSZzaWduYXR1cmU6aGFzaC12YWx1ZQ==',
    )
  })

  it('request handles a 204 answer', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '', 204))
    const actual = await c.request(
      TX_TYPE.PAY_AUTH,
      MODEL.NON_SECURE,
      { key: 'val' },
      {} as never,
      `${BASE_URL}/payment/auth`,
    )
    expect(actual).toStrictEqual({})
  })

  it('request fails with a 500', async () => {
    const c = createClient(fakeFetch([], 'Internal Server Error', 500))
    const error = await c
      .request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { key: 'val' }, {} as never, `${BASE_URL}/payment/auth`)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PosHttpError)
  })

  it('request fails with a 4xx carrying the bank message', async () => {
    const c = createClient(fakeFetch([], '{"errorMessage":"Invalid card","status":"failure"}', 400))
    // deviation: C7 — RuntimeException(errorMessage) becomes the transport's PosHttpError with the body snippet
    const error = await c
      .request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { locale: 'tr' }, {} as never, `${BASE_URL}/payment/auth`)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PosHttpError)
    expect((error as PosHttpError).bodySnippet).toContain('Invalid card')
  })

  describe('additions', () => {
    // addition: the signature of a recorded POST verifies against the recorded body (real crypt)
    it('signs the exact body and path that were sent', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '{"status":"success"}'), new IyzicoPosCrypt(), noopLogger, IA)
      await c.request(
        TX_TYPE.STATUS,
        MODEL.NON_SECURE,
        { locale: 'tr', paymentConversationId: 'order-1', conversationId: 'order-1' },
        { id: 'order-1' } as never,
        `${BASE_URL}/payment/detail`,
      )
      const body = '{"locale":"tr","paymentConversationId":"order-1","conversationId":"order-1"}'
      expect(sent[0]?.body).toBe(body)
      verifyHeader(sent[0]?.headers.authorization, '/payment/detail', body)
    })

    // addition: the body is signed after hooks changed it, as it is on the wire (non-ASCII too)
    it('signs the bytes of a body with non-ASCII text', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '{}'), new IyzicoPosCrypt(), noopLogger, IA)
      await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { name: 'Çağlar Üstün' }, {} as never)
      verifyHeader(sent[0]?.headers.authorization, '/payment/auth', sent[0]?.body ?? '')
      expect(sent[0]?.url).toBe(`${BASE_URL}/payment/auth`)
    })

    // addition: an explicit URL with a query signs only its path
    it('signs only the path of an explicit URL with a query string', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '{}'), new IyzicoPosCrypt(), noopLogger, IA)
      await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, {} as never, `${BASE_URL}/payment/auth?x=1`)
      verifyHeader(sent[0]?.headers.authorization, '/payment/auth', '{"a":1}')
    })

    // addition: a custom query has no route of its own, so it must name its URL
    it('refuses a custom query without a URL before any request', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '{}'), new IyzicoPosCrypt(), noopLogger, IA)
      await expect(c.request(QUERY_TYPE.CUSTOM_QUERY, MODEL.NON_SECURE, { a: 1 }, {} as never)).rejects.toBeInstanceOf(
        PosError,
      )
      await expect(c.request(QUERY_TYPE.CUSTOM_QUERY, MODEL.NON_SECURE, { a: 1 }, {} as never)).rejects.toThrow(
        'iyzico custom queries need an apiUrl',
      )
      expect(sent).toHaveLength(0)
      expect(client.supportsTx(QUERY_TYPE.CUSTOM_QUERY, MODEL.NON_SECURE)).toBe(true)
    })

    // addition: a transaction type that names an object member never finds a route
    it('does not route inherited names', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '{}'), new IyzicoPosCrypt(), noopLogger, IA)
      for (const name of ['constructor', '__proto__', 'toString']) {
        expect(c.supportsTx(name as never, MODEL.NON_SECURE)).toBe(false)
        await expect(c.request(name as never, MODEL.NON_SECURE, {}, {} as never)).rejects.toBeInstanceOf(PosError)
      }
      expect(sent).toHaveLength(0)
    })

    // addition: deviation from the reference — a non-payment transaction under the 3D Secure model keeps its own route
    it('does not send a status or a cancel to the 3D authorization route', () => {
      expect(client.getApiUrl(TX_TYPE.STATUS, MODEL.THREE_D_SECURE)).toBe(`${BASE_URL}/payment/detail`)
      expect(client.getApiUrl(TX_TYPE.CANCEL, MODEL.THREE_D_SECURE)).toBe(`${BASE_URL}/payment/cancel`)
      expect(client.getApiUrl(TX_TYPE.REFUND, MODEL.THREE_D_SECURE)).toBe(`${BASE_URL}/v2/payment/refund`)
    })

    it.each([
      ['an HTML page', '<html><body>Request blocked</body></html>'],
      ['plain text', 'PAYTR notification failed'],
      ['a JSON array', '[1,2]'],
      ['a JSON scalar', '"ok"'],
      ['an empty answer', ''],
      ['broken JSON', '{"status":'],
      ['a byte order mark', '﻿{"status":"success"}'],
    ])('treats %s as a failed request that names the URL', async (_name, body) => {
      const c = createClient(fakeFetch([], body), new IyzicoPosCrypt(), noopLogger, IA)
      const error = await c
        .request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, {} as never, `${BASE_URL}/payment/auth`)
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(PosHttpError)
      expect((error as PosHttpError).url).toBe(`${BASE_URL}/payment/auth`)
    })

    // addition: a key named __proto__ in the answer stays an own value
    it('keeps a __proto__ key of the answer as plain data', async () => {
      const c = createClient(fakeFetch([], '{"__proto__":{"polluted":true},"status":"success"}'))
      const actual = await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, {} as never)
      expect(Object.getPrototypeOf(actual)).toBe(Object.prototype)
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
      expect(Object.hasOwn(actual, '__proto__')).toBe(true)
    })

    // addition: a redirect is never followed
    it('sends every request with redirects refused', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '{}'))
      await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, {} as never)
      expect(sent[0]?.init.redirect).toBe('error')
    })

    // addition: an answer that echoes the secret key is hidden in the log and in the thrown error
    it('hides an echoed secret key in the log and in the error', async () => {
      const { logger, lines } = recordingLogger()
      const c = createClient(fakeFetch([], '<html>bad sandbox-secretKey here</html>'), new IyzicoPosCrypt(), logger, IA)
      const error = (await c
        .request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, {} as never, `${BASE_URL}/payment/auth`)
        .catch((e: unknown) => e)) as PosHttpError
      expect(error).toBeInstanceOf(PosHttpError)
      const all = `${error.message} ${error.url} ${error.bodySnippet ?? ''} ${lines.join('\n')}`
      expect(all).not.toContain('sandbox-secretKey')

      const failing = createClient(
        fakeFetch([], '{"errorMessage":"key sandbox-secretKey rejected"}', 400),
        new IyzicoPosCrypt(),
        logger,
        IA,
      )
      const e2 = (await failing
        .request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, {} as never, `${BASE_URL}/payment/auth`)
        .catch((e: unknown) => e)) as PosHttpError
      expect(`${e2.message} ${e2.bodySnippet ?? ''} ${lines.join('\n')}`).not.toContain('sandbox-secretKey')
      expect(e2.bodySnippet).toContain('***')
    })

    // addition: the Authorization value never reaches a log line or a thrown error
    it('never logs or throws the Authorization header', async () => {
      const { logger, lines } = recordingLogger()
      const sent: Sent[] = []
      const ok = createClient(fakeFetch(sent, '{"status":"success"}'), new IyzicoPosCrypt(), logger, IA)
      await ok.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, { id: 'o' } as never)
      const bad = createClient(fakeFetch(sent, 'oops', 500), new IyzicoPosCrypt(), logger, IA)
      const error = await bad
        .request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, { id: 'o' } as never)
        .catch((e: unknown) => e)
      const text = `${lines.join('\n')} ${String(error)} ${JSON.stringify(error)}`
      for (const s of sent) {
        const auth = s.headers.authorization ?? ''
        expect(auth).not.toBe('')
        expect(text).not.toContain(auth)
        expect(text).not.toContain(auth.slice('IYZWSv2 '.length))
      }
      expect(text).not.toContain('IYZWSv2')
    })

    // addition: the credentials are in true private fields
    it('keeps no secret in a JSON or inspect dump', () => {
      const c = createClient(fakeFetch([], '{}'), new IyzicoPosCrypt(), noopLogger, IA)
      expect(JSON.stringify(c)).not.toContain('sandbox-secretKey')
      expect(inspect(c, { depth: 6, showHidden: true })).not.toContain('sandbox-secretKey')
    })

    // addition: concurrent requests get their own random key and each verifies
    it('signs concurrent requests with different random keys', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '{}'), new IyzicoPosCrypt(), noopLogger, IA)
      await Promise.all([
        c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { n: 1 }, {} as never),
        c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { n: 2 }, {} as never),
      ])
      expect(sent).toHaveLength(2)
      const keys = sent.map(
        (s) =>
          Buffer.from((s.headers.authorization ?? '').slice(8), 'base64')
            .toString('utf8')
            .split('&')[1],
      )
      expect(keys[0]).not.toBe(keys[1])
      for (const s of sent) verifyHeader(s.headers.authorization, '/payment/auth', s.body)
    })

    // addition: a body that cannot be serialised is a library error, not a plain TypeError
    it('refuses a request body that cannot be serialised', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '{}'))
      await expect(
        c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { n: 10n } as never, {} as never),
      ).rejects.toBeInstanceOf(PosError)
      expect(sent).toHaveLength(0)
    })
  })
})
