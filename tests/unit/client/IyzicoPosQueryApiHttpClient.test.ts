import { createHmac } from 'node:crypto'
import { inspect } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import type { ClientTxType } from '../../../src/client/AbstractHttpClient.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { IyzicoPosQueryApiHttpClient } from '../../../src/client/IyzicoPosQueryApiHttpClient.js'
import { AkbankPosCrypt } from '../../../src/crypt/AkbankPosCrypt.js'
import { IyzicoPosCrypt } from '../../../src/crypt/IyzicoPosCrypt.js'
import { PosError, PosHttpError, UnsupportedTransactionTypeError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosLogger } from '../../../src/logger.js'
import { noopLogger } from '../../../src/logger.js'
import { MODEL, TX_TYPE } from '../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../src/pos-query/PosQueryInterface.js'

const BASE_URL = 'https://sandbox-api.iyzipay.com/v2/reporting/payment'

const account = AccountFactory.createIyzicoPosAccount('iyzico', 'key', 'secret')
const IA = AccountFactory.createIyzicoPosAccount('iyzico', 'sandbox-apiKey', 'sandbox-secretKey')

type Sent = { url: string; init: RequestInit; headers: Record<string, string> }

function fakeFetch(sent: Sent[], body: string, status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    sent.push({ url: String(url), init: init ?? {}, headers })
    return new Response(status === 204 ? null : body, { status })
  }) as unknown as typeof fetch
}

function stubCrypt(): IyzicoPosCrypt {
  const crypt = new IyzicoPosCrypt()
  vi.spyOn(crypt, 'generateRandomString').mockReturnValue('rnd')
  vi.spyOn(crypt, 'createHash').mockReturnValue('hash')
  return crypt
}

function createClient(
  fetchImpl: typeof fetch,
  crypt: IyzicoPosCrypt = stubCrypt(),
  logger: PosLogger = noopLogger,
  acc = account,
): IyzicoPosQueryApiHttpClient {
  return new IyzicoPosQueryApiHttpClient(BASE_URL, new HttpTransport({ fetch: fetchImpl }), logger, crypt, acc)
}

const HX = (s: string): string => createHmac('sha256', 'sandbox-secretKey').update(s, 'utf8').digest('hex')

describe('IyzicoPosQueryApiHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it('supports', () => {
    expect(IyzicoPosQueryApiHttpClient.supports('IyzicoPos', IyzicoPosQueryApiHttpClient.API_NAME_QUERY_API)).toBe(true)
    expect(IyzicoPosQueryApiHttpClient.supports('IyzicoPos', 'payment_api')).toBe(false)
    expect(IyzicoPosQueryApiHttpClient.supports('AkbankPos', IyzicoPosQueryApiHttpClient.API_NAME_QUERY_API)).toBe(
      false,
    )
  })

  it.each([
    [TX_TYPE.ORDER_HISTORY, true],
    [QUERY_TYPE.HISTORY, true],
    [TX_TYPE.PAY_AUTH, false],
    [TX_TYPE.STATUS, false],
  ] as Array<[ClientTxType, boolean]>)('supportsTx(%s)', (txType, expected) => {
    expect(client.supportsTx(txType, MODEL.NON_SECURE)).toBe(expected)
  })

  it.each([
    [QUERY_TYPE.HISTORY, `${BASE_URL}/transactions`],
    [TX_TYPE.ORDER_HISTORY, `${BASE_URL}/details`],
  ] as Array<[ClientTxType, string]>)('getApiUrl(%s)', (txType, expected) => {
    expect(client.getApiUrl(txType, MODEL.NON_SECURE)).toBe(expected)
  })

  it('getApiUrl without a transaction type throws', () => {
    // deviation: C7 — InvalidArgumentException becomes PosError
    expect(() => client.getApiUrl(undefined as never, MODEL.NON_SECURE)).toThrow(PosError)
  })

  it('getApiUrl of an unsupported transaction type throws', () => {
    // deviation: C7 — InvalidArgumentException becomes UnsupportedTransactionTypeError
    expect(() => client.getApiUrl(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE)).toThrow(UnsupportedTransactionTypeError)
    expect(() => client.getApiUrl(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE)).toThrow('Unsupported transaction type: pay')
  })

  it('request sends a GET with the data as query parameters', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '{"status":"success"}'))
    const actual = await c.request(
      QUERY_TYPE.HISTORY,
      MODEL.NON_SECURE,
      { transactionDate: '2024-01-01', page: 1 },
      {} as never,
      `${BASE_URL}/transactions`,
    )
    expect(actual).toStrictEqual({ status: 'success' })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.init.method).toBe('GET')
    expect(sent[0]?.init.body).toBeUndefined()
    expect(sent[0]?.url).toBe(`${BASE_URL}/transactions?transactionDate=2024-01-01&page=1`)
    expect(sent[0]?.headers['content-type']).toBe('application/json')
    expect(sent[0]?.headers.authorization).toBe('IYZWSv2 YXBpS2V5OmtleSZyYW5kb21LZXk6cm5kJnNpZ25hdHVyZTpoYXNo')
  })

  it('request handles a 204 answer', async () => {
    const c = createClient(fakeFetch([], '', 204))
    const actual = await c.request(
      QUERY_TYPE.HISTORY,
      MODEL.NON_SECURE,
      { transactionDate: '2024-01-01' },
      {} as never,
      `${BASE_URL}/transactions`,
    )
    expect(actual).toStrictEqual({})
  })

  it('request fails with a 500', async () => {
    const c = createClient(fakeFetch([], 'Internal Server Error', 500))
    const error = await c
      .request(QUERY_TYPE.HISTORY, MODEL.NON_SECURE, { a: 1 }, {} as never, `${BASE_URL}/transactions`)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PosHttpError)
  })

  it('constructor rejects a wrong account', () => {
    // deviation: the account is a constructor argument
    const akbank = AccountFactory.createAkbankPosAccount('akbank-pos', 'a', 'b', 'c')
    expect(
      () =>
        new IyzicoPosQueryApiHttpClient(
          BASE_URL,
          new HttpTransport(),
          noopLogger,
          new IyzicoPosCrypt(),
          akbank as unknown as typeof account,
        ),
    ).toThrow(PosError)
    expect(
      () =>
        new IyzicoPosQueryApiHttpClient(
          BASE_URL,
          new HttpTransport(),
          noopLogger,
          new AkbankPosCrypt() as unknown as IyzicoPosCrypt,
          account,
        ),
    ).toThrow(PosError)
  })

  describe('additions', () => {
    // addition: the GET signature covers the path and an empty body (real crypt)
    it('signs the path of the reporting URL and an empty body', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '{}'), new IyzicoPosCrypt(), noopLogger, IA)
      await c.request(TX_TYPE.ORDER_HISTORY, MODEL.NON_SECURE, { paymentId: '123' }, {} as never)
      expect(sent[0]?.url).toBe(`${BASE_URL}/details?paymentId=123`)
      const decoded = Buffer.from((sent[0]?.headers.authorization ?? '').slice(8), 'base64').toString('utf8')
      const m = /^apiKey:sandbox-apiKey&randomKey:([^&]*)&signature:([0-9a-f]{64})$/.exec(decoded)
      expect(m).not.toBeNull()
      expect(m?.[2]).toBe(HX(`${m?.[1]}/v2/reporting/payment/details`))
    })

    // addition: values are percent-encoded and never reach a log line
    it('encodes values into the query string and does not log it', async () => {
      const lines: string[] = []
      const logger: PosLogger = {
        debug: (m, c) => lines.push(`${m} ${JSON.stringify(c)}`),
        info: (m, c) => lines.push(`${m} ${JSON.stringify(c)}`),
        warn: (m, c) => lines.push(`${m} ${JSON.stringify(c)}`),
        error: (m, c) => lines.push(`${m} ${JSON.stringify(c)}`),
      }
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '{}'), new IyzicoPosCrypt(), logger, IA)
      await c.request(QUERY_TYPE.HISTORY, MODEL.NON_SECURE, { q: 'a b&c=d#e', n: 5 }, { id: 'o' } as never)
      expect(sent[0]?.url).toBe(`${BASE_URL}/transactions?q=a+b%26c%3Dd%23e&n=5`)
      expect(lines.join('\n')).not.toContain('a+b')
      expect(lines.join('\n')).not.toContain('c%3Dd')
    })

    // addition: only plain scalar values may travel in the query string
    it('refuses a query value that is not a scalar before any request', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '{}'))
      for (const data of [{ a: { b: 1 } }, { a: [1] }, { 'a&b': '1' }, { a: () => 1 }]) {
        await expect(
          c.request(QUERY_TYPE.HISTORY, MODEL.NON_SECURE, data as never, {} as never),
        ).rejects.toBeInstanceOf(PosError)
      }
      expect(sent).toHaveLength(0)
    })

    // addition: a value that is not well-formed text is a PosError, never a URIError from the encoder
    it('refuses a lone surrogate in a query value before any request', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '{}'))
      for (const value of ['\ud800', 'a\udc00b', '\ud83d']) {
        await expect(c.request(QUERY_TYPE.HISTORY, MODEL.NON_SECURE, { q: value }, {} as never)).rejects.toBeInstanceOf(
          PosError,
        )
      }
      expect(sent).toHaveLength(0)
      // a well-formed pair is encoded
      await c.request(QUERY_TYPE.HISTORY, MODEL.NON_SECURE, { q: '\u{1F600}' }, {} as never)
      expect(sent[0]?.url).toBe(`${BASE_URL}/transactions?q=%F0%9F%98%80`)
    })

    // addition: a type without a route fails before any request
    it('refuses an unknown transaction type before any request', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '{}'))
      for (const name of ['constructor', '__proto__', 'pay']) {
        expect(c.supportsTx(name as never, MODEL.NON_SECURE)).toBe(false)
        await expect(c.request(name as never, MODEL.NON_SECURE, {}, {} as never)).rejects.toBeInstanceOf(PosError)
      }
      expect(sent).toHaveLength(0)
    })

    it.each([
      ['an HTML page', '<html>blocked</html>'],
      ['a JSON array', '[]'],
      ['an empty answer', ''],
      ['a byte order mark', '﻿{}'],
    ])('treats %s as a failed request', async (_n, body) => {
      const c = createClient(fakeFetch([], body))
      const error = await c
        .request(QUERY_TYPE.HISTORY, MODEL.NON_SECURE, { a: 1 }, {} as never, `${BASE_URL}/transactions`)
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(PosHttpError)
      expect((error as PosHttpError).url).toBe(`${BASE_URL}/transactions`)
    })

    it('hides an echoed secret key and keeps no secret in a dump', async () => {
      const c = createClient(fakeFetch([], 'x sandbox-secretKey y'), new IyzicoPosCrypt(), noopLogger, IA)
      const error = (await c
        .request(QUERY_TYPE.HISTORY, MODEL.NON_SECURE, { a: 1 }, {} as never)
        .catch((e: unknown) => e)) as PosHttpError
      expect(`${error.message} ${error.bodySnippet ?? ''}`).not.toContain('sandbox-secretKey')
      expect(JSON.stringify(c)).not.toContain('sandbox-secretKey')
      expect(inspect(c, { depth: 6, showHidden: true })).not.toContain('sandbox-secretKey')
    })
  })
})
