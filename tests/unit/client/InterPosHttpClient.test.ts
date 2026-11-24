import { describe, expect, it } from 'vitest'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { InterPosHttpClient } from '../../../src/client/InterPosHttpClient.js'
import { PosError, PosHttpError } from '../../../src/errors.js'
import type { PosLogger } from '../../../src/logger.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../src/pos-query/PosQueryInterface.js'
import { FULL_SUCCESS_RECORD, FULL_SUCCESS_RESPONSE } from '../serializer/interPosFixtures.js'

// HTTP is replaced by a fake fetch.

const API_URL = 'https://test.inter-vpos.com.tr/mpi/Default.aspx'

type Sent = { url: string; init: RequestInit }

function fakeFetch(sent: Sent[], body: string, status = 200, headers?: Record<string, string>): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(status === 204 ? null : body, { status, ...(headers ? { headers } : {}) })
  }) as unknown as typeof fetch
}

function createClient(fetchImpl: typeof fetch, logger?: PosLogger): InterPosHttpClient {
  return new InterPosHttpClient(API_URL, new HttpTransport({ fetch: fetchImpl }), logger)
}

describe('InterPosHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE],
    [TX_TYPE.PAY_AUTH, MODEL.NON_SECURE],
    [TX_TYPE.REFUND, MODEL.NON_SECURE],
    [TX_TYPE.REFUND_PARTIAL, MODEL.NON_SECURE],
    [QUERY_TYPE.HISTORY, MODEL.NON_SECURE],
  ] as Array<[TxType, PaymentModel]>)('getApiUrl(%s, %s)', (txType, paymentModel) => {
    expect(client.getApiUrl(txType, paymentModel)).toBe(API_URL)
  })

  it('supports', () => {
    expect(InterPosHttpClient.supports('AkbankPos', InterPosHttpClient.API_NAME_PAYMENT_API)).toBe(false)
    expect(InterPosHttpClient.supports('InterPos', InterPosHttpClient.API_NAME_PAYMENT_API)).toBe(true)
    // addition: only the payment API belongs to this client
    expect(InterPosHttpClient.supports('InterPos', 'query_api')).toBe(false)
  })

  it('supportsTx', () => {
    expect(client.supportsTx(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE)).toBe(true)
    // addition: queries and inquiries share the endpoint
    expect(client.supportsTx(QUERY_TYPE.CUSTOM_QUERY, MODEL.NON_SECURE)).toBe(true)
    expect(client.supportsTx(TX_TYPE.STATUS, MODEL.NON_SECURE)).toBe(true)
  })

  it('request', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, FULL_SUCCESS_RESPONSE))
    const actual = await c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { abc: 1, sa: 'aa' }, { id: '123' }, API_URL)

    expect(actual).toStrictEqual(FULL_SUCCESS_RECORD)
    expect(sent).toHaveLength(1)
    const [request] = sent as [Sent]
    expect(request.url).toBe(API_URL)
    expect(request.init.method).toBe('POST')
    expect(request.init.body).toBe('abc=1&sa=aa')
    expect(new Headers(request.init.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded')
  })

  it('request undecodable response', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, 'response-content', 400))
    // deviation: F30, a non-2xx answer is a PosHttpError before decoding
    await expect(
      c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' }),
    ).rejects.toThrow(PosHttpError)
    expect(sent[0]?.init.body).toBe('request-data=abc')
  })

  it('request bad request', async () => {
    const c = createClient(fakeFetch([], 'response-content', 500))
    // deviation: F30, a non-2xx answer is a PosHttpError with the status
    const err = await c
      .request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).status).toBe(500)
  })

  // addition: an HTML page answered with 200 never becomes a record
  it('request HTML page with status 200', async () => {
    const c = createClient(fakeFetch([], '<html><body>Request Rejected</body></html>', 200))
    await expect(c.request(TX_TYPE.STATUS, MODEL.NON_SECURE, { a: 'b' }, { id: '1' })).rejects.toThrow(PosHttpError)
  })

  // addition: an empty or garbage 200 body is rejected too
  it.each(['', '   ', 'garbage'])('request body %j with status 200', async (body) => {
    const c = createClient(fakeFetch([], body, 200))
    await expect(c.request(TX_TYPE.STATUS, MODEL.NON_SECURE, { a: 'b' }, { id: '1' })).rejects.toThrow(PosHttpError)
  })

  // addition: redirects are not followed
  it('request redirect', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '', 302, { Location: 'https://evil.example/' }))
    await expect(c.request(TX_TYPE.STATUS, MODEL.NON_SECURE, { a: 'b' }, { id: '1' })).rejects.toThrow(PosHttpError)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.init.redirect).toBe('error')
  })

  // addition: an empty 204 answer is an empty record
  it('request 204', async () => {
    const c = createClient(fakeFetch([], '', 204))
    expect(await c.request(TX_TYPE.STATUS, MODEL.NON_SECURE, { a: 'b' }, { id: '1' })).toStrictEqual({})
  })

  // addition: null values are left out and text values are percent-encoded
  it('encodes the form body', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, 'OrderId=1'))
    await c.request(
      TX_TYPE.PAY_AUTH,
      MODEL.NON_SECURE,
      { OrderId: null, orgOrderId: 'x', CardHolderName: 'Ali & Veli' },
      { id: '1' },
    )
    expect(sent[0]?.init.body).toBe('orgOrderId=x&CardHolderName=Ali+%26+Veli')
  })

  // addition: bodies are never logged, so card data and credentials stay out of every logger context
  it('never logs request or response values', async () => {
    const calls: string[] = []
    const rec = (level: string) => (msg: string, ctx?: unknown) => {
      calls.push(`${level} ${msg} ${JSON.stringify(ctx)}`)
    }
    const logger: PosLogger = { debug: rec('debug'), info: rec('info'), warn: rec('warn'), error: rec('error') }
    const data = {
      Pan: '5555444433332222',
      Cvv2: '715',
      Expiry: '0125',
      UserPass: 'api-secret',
      PayerAuthenticationCode: 'cavv-secret',
    }

    const ok = createClient(fakeFetch([], 'OrderId=1;;ProcReturnCode=00'), logger)
    await ok.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, data, { id: '1' })
    const echo = 'Pan=5555444433332222;;UserPass=api-secret;;Cvv2=715;;Expiry=0125;;PayerAuthenticationCode=cavv-secret'
    const bad = createClient(fakeFetch([], echo, 500), logger)
    const err1 = (await bad
      .request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, data, { id: '1' })
      .catch((e: unknown) => e)) as PosHttpError
    // a 200 that fails to parse logs a masked snippet
    const garbled = createClient(fakeFetch([], `<html>Pan=5555444433332222 UserPass=api-secret</html>`, 200), logger)
    const err2 = (await garbled
      .request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, data, { id: '1' })
      .catch((e: unknown) => e)) as PosHttpError

    for (const err of [err1, err2]) expect(err).toBeInstanceOf(PosError)
    const everything = `${calls.join('\n')}\n${err1.message}\n${err1.bodySnippet ?? ''}\n${err2.message}\n${err2.bodySnippet ?? ''}`
    for (const secret of ['5555444433332222', '715', '0125', 'api-secret', 'cavv-secret']) {
      expect(everything).not.toContain(secret)
    }
    expect(calls.length).toBeGreaterThan(0)
  })
})
