import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ClientTxType } from '../../../src/client/AbstractHttpClient.js'
import { AkbankPosHttpClient } from '../../../src/client/AkbankPosHttpClient.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { AkbankPosCrypt } from '../../../src/crypt/AkbankPosCrypt.js'
import { MissingAccountInfoError, PosError, PosHttpError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosLogger } from '../../../src/logger.js'
import { noopLogger } from '../../../src/logger.js'
import { MODEL, type PaymentModel, TX_TYPE } from '../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../src/pos-query/PosQueryInterface.js'

// HTTP is replaced by a fake fetch; the real crypt signs every request.

const API_URL = 'https://apipre.akbank.com/api/v1/payment/virtualpos'
const SECRET_KEY =
  '3230323330393034313735303032363031353172675f357637355f3273387373745f7233725f73323333383737335f323272383774767276327672323531355f'

const account = AccountFactory.createAkbankPosAccount(
  'akbank-pos',
  '2023090417500272654BD9A49CF07574',
  '2023090417500284633D137A249DBBEB',
  SECRET_KEY,
)

const H = (s: string): string =>
  createHmac('sha512', Buffer.from(SECRET_KEY, 'utf8')).update(s, 'utf8').digest('base64')

type Sent = { url: string; init: RequestInit; bodyBytes: Uint8Array; headers: Record<string, string> }

async function bodyBytesOf(body: RequestInit['body']): Promise<Uint8Array> {
  // the transport hands fetch the body; read it back the way fetch would put it on the wire
  return new Uint8Array(await new Request('https://example.invalid', { method: 'POST', body }).arrayBuffer())
}

function fakeFetch(sent: Sent[], body: string, status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    sent.push({ url: String(url), init: init ?? {}, bodyBytes: await bodyBytesOf(init?.body), headers })
    return new Response(body, { status })
  }) as unknown as typeof fetch
}

function createClient(fetchImpl: typeof fetch, logger: PosLogger = noopLogger): AkbankPosHttpClient {
  return new AkbankPosHttpClient(
    API_URL,
    new HttpTransport({ fetch: fetchImpl }),
    logger,
    new AkbankPosCrypt(),
    account,
  )
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

describe('AkbankPosHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it('supports', () => {
    expect(AkbankPosHttpClient.supports('AkbankPos', AkbankPosHttpClient.API_NAME_PAYMENT_API)).toBe(true)
    expect(AkbankPosHttpClient.supports('AkbankPos', AkbankPosHttpClient.API_NAME_PAYMENT_API)).toBe(true)
    expect(AkbankPosHttpClient.supports('AkbankPos', 'query_api')).toBe(false)
    expect(AkbankPosHttpClient.supports('AssecoPos', AkbankPosHttpClient.API_NAME_PAYMENT_API)).toBe(false)
  })

  it('supportsTx', () => {
    expect(client.supportsTx(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE)).toBe(true)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, `${API_URL}/transaction/process`],
    [TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, `${API_URL}/transaction/process`],
    [TX_TYPE.REFUND, MODEL.NON_SECURE, `${API_URL}/transaction/process`],
    [TX_TYPE.REFUND_PARTIAL, MODEL.NON_SECURE, `${API_URL}/transaction/process`],
    [QUERY_TYPE.HISTORY, MODEL.NON_SECURE, `${API_URL}/portal/report/transaction`],
  ] as Array<[ClientTxType, PaymentModel, string]>)('getApiUrl(%s, %s)', (txType, paymentModel, expected) => {
    expect(client.getApiUrl(txType, paymentModel)).toBe(expected)
  })

  it('getApiUrl without a transaction type throws', () => {
    // deviation: A22 — InvalidArgumentException becomes PosError
    expect(() => client.getApiUrl(undefined as never, MODEL.NON_SECURE)).toThrow(PosError)
  })

  it('request', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '{"decoded":"response"}'))

    const actual = await c.request(
      TX_TYPE.PAY_AUTH,
      MODEL.THREE_D_SECURE,
      { a: 'b' },
      { id: 123 as never },
      `${API_URL}/transaction/process`,
    )

    expect(actual).toStrictEqual({ decoded: 'response' })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(`${API_URL}/transaction/process`)
    expect(sent[0]?.init.method).toBe('POST')
    expect(new TextDecoder().decode(sent[0]?.bodyBytes)).toBe('{"a":"b"}')
    expect(sent[0]?.headers['content-type']).toBe('application/json')
    // deviation: real crypt instead of a stubbed hash
    expect(sent[0]?.headers['auth-hash']).toBe(H('{"a":"b"}'))
  })

  it('request bad request', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '{"message":"Error message","code":222}', 400))

    // deviation: A22 — RuntimeException(message, code) becomes the transport's PosHttpError with the masked body
    const error = await c
      .request(
        TX_TYPE.PAY_AUTH,
        MODEL.THREE_D_SECURE,
        { a: 'b' },
        { id: 123 as never },
        `${API_URL}/transaction/process`,
      )
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PosHttpError)
    expect((error as PosHttpError).status).toBe(400)
    expect((error as PosHttpError).bodySnippet).toContain('Error message')
    expect((error as PosHttpError).bodySnippet).toContain('222')
    expect(sent[0]?.headers['auth-hash']).toBe(H('{"a":"b"}'))
  })

  it('request undecodable response', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, 'not-valid-json', 400))

    // deviation: A22 — NotEncodableValueException becomes PosHttpError
    await expect(
      c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: 123 as never }, null),
    ).rejects.toThrow(PosHttpError)
    expect(sent[0]?.url).toBe(`${API_URL}/transaction/process`)
    expect(new TextDecoder().decode(sent[0]?.bodyBytes)).toBe('{"request-data":"abc"}')
  })

  it('request without account', () => {
    // deviation: the account is a constructor argument; one without a secret key cannot be built
    expect(() => AccountFactory.createAkbankPosAccount('akbank-pos', 'm', 't', '')).toThrow(MissingAccountInfoError)
  })

  // addition: the signature covers exactly the bytes fetch sends, including non-ASCII text
  it('signs the exact body bytes it sends', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '{"responseCode":"VPS-0000"}'))
    const data = {
      customer: { ipAddress: '127.0.0.1' },
      order: { orderId: 'sipariş-ğü-1' },
      note: 'Çağrı Öztürk',
    }

    await c.request(TX_TYPE.CANCEL, MODEL.NON_SECURE, data, { id: 'sipariş-ğü-1' })

    const received = new TextDecoder('utf-8', { fatal: true }).decode(sent[0]?.bodyBytes)
    expect(received).toBe(JSON.stringify(data))
    expect(sent[0]?.headers['auth-hash']).toBe(H(received))
    expect(sent[0]?.headers['auth-hash']).toBe(
      'n+vx1zewaPLRa2AOLdP3XO295yqNm4uEDN7wLrXqjqmkSD4F/7T8BPfm2id8LV29HfJnvysnnfujchFHfKm3UA==',
    )
  })

  // addition: query history goes to the report URL and is signed the same way
  it('signs a history request posted to the report URL', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '{"responseCode":"VPS-0000"}'))

    await c.request(QUERY_TYPE.HISTORY, MODEL.NON_SECURE, { report: { batchNumber: 1 } }, {})

    const received = new TextDecoder().decode(sent[0]?.bodyBytes)
    expect(sent[0]?.url).toBe(`${API_URL}/portal/report/transaction`)
    expect(sent[0]?.headers['auth-hash']).toBe(H(received))
  })

  // addition: a 2xx body that is not JSON (or a WAF page) is a PosHttpError, never a crash
  it.each([['not-valid-json'], ['<html><body>Request Rejected</body></html>']])(
    'rejects the 200 body %j',
    async (body) => {
      const c = createClient(fakeFetch([], body, 200))

      const error = await c
        .request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 'b' }, { id: '1' })
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(PosHttpError)
      expect((error as PosHttpError).status).toBe(200)
      expect((error as PosHttpError).url).toBe(`${API_URL}/transaction/process`)
    },
  )

  // addition: neither the secret key nor the auth-hash value nor card data reaches the logger or an error snippet
  describe('keeps secrets out of logs and errors', () => {
    const cardData = {
      card: { cardNumber: '4355084355084358', cvv2: '000', expireDate: '1230' },
      order: { orderId: 'A1' },
    }
    const signature = H(JSON.stringify(cardData))
    const forbidden = [SECRET_KEY, signature, '4355084355084358']

    const bankEcho = JSON.stringify({
      message: 'Error message',
      code: 222,
      request: cardData,
      secretKey: SECRET_KEY,
    })

    it.each([
      ['success', '{"responseCode":"VPS-0000"}', 200],
      ['bank error echoing the request', bankEcho, 400],
      ['undecodable 200 echoing the request', `<html>${bankEcho}</html>`, 200],
      ['WAF page', '<html><body>Request Rejected</body></html>', 403],
    ] as Array<[string, string, number]>)('%s', async (_name, body, status) => {
      const sent: Sent[] = []
      const { logger, lines } = recordingLogger()
      const c = createClient(fakeFetch(sent, body, status), logger)

      const error = await c
        .request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, cardData, { id: 'A1' })
        .then(() => null)
        .catch((e: unknown) => e)

      expect(sent[0]?.headers['auth-hash']).toBe(signature)
      expect(lines.length).toBeGreaterThan(0)
      const errorText =
        error instanceof PosHttpError ? `${error.message} ${error.bodySnippet ?? ''} ${String(error.cause ?? '')}` : ''
      for (const value of forbidden) {
        for (const line of lines) expect(line).not.toContain(value)
        expect(errorText).not.toContain(value)
      }
    })
  })
})
