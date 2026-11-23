import { describe, expect, it } from 'vitest'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PayFlexV4PosHttpClient } from '../../../src/client/PayFlexV4PosHttpClient.js'
import { PayFlexV4PosSearchApiHttpClient } from '../../../src/client/PayFlexV4PosSearchApiHttpClient.js'
import { PosHttpError } from '../../../src/errors.js'
import { MODEL, TX_TYPE } from '../../../src/PosInterface.js'

// HTTP is replaced by a fake fetch.

const API_URL = 'https://sanalpos.vakifbank.com.tr/v4/UIWebService/Search.aspx'

type Sent = { url: string; init: RequestInit }

function fakeFetch(sent: Sent[], body: string, status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(body, { status })
  }) as unknown as typeof fetch
}

const createClient = (fetchImpl: typeof fetch): PayFlexV4PosSearchApiHttpClient =>
  new PayFlexV4PosSearchApiHttpClient(API_URL, new HttpTransport({ fetch: fetchImpl }))

const ENCODED =
  'prmstr=%3C%3Fxml+version%3D%221.0%22+encoding%3D%22UTF-8%22%3F%3E%0A%3CSearchRequest%3E%3Crequest-data%3Eabc%3C%2Frequest-data%3E%3C%2FSearchRequest%3E%0A'

describe('PayFlexV4PosSearchApiHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it('extends the payment API client', () => {
    expect(client).toBeInstanceOf(PayFlexV4PosHttpClient)
  })

  it('supports', () => {
    expect(PayFlexV4PosSearchApiHttpClient.supports('PayFlexV4Pos', 'query_api')).toBe(true)
    expect(PayFlexV4PosSearchApiHttpClient.supports('PayFlexV4Pos', 'payment_api')).toBe(false)
    expect(PayFlexV4PosSearchApiHttpClient.supports('PayFlexV4Pos', 'gateway_3d')).toBe(false)
    expect(PayFlexV4PosSearchApiHttpClient.supports('AkbankPos', 'payment_api')).toBe(false)
  })

  it('supportsTx', () => {
    expect(client.supportsTx(TX_TYPE.STATUS, MODEL.NON_SECURE)).toBe(true)
    // addition
    expect(client.supportsTx(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE)).toBe(false)
  })

  it('getApiUrl', () => {
    expect(client.getApiUrl(TX_TYPE.STATUS, MODEL.NON_SECURE)).toBe(API_URL)
  })

  it('request', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '<response><result>success</result></response>'))

    const actual = await c.request(TX_TYPE.STATUS, MODEL.NON_SECURE, { 'request-data': 'abc' }, { id: '123' }, API_URL)

    expect(actual).toStrictEqual({ result: 'success' })
    expect(sent).toHaveLength(1)
    const [request] = sent as [Sent]
    expect(request.url).toBe(API_URL)
    expect(request.init.method).toBe('POST')
    expect(request.init.body).toBe(ENCODED)
    expect(new Headers(request.init.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded')
  })

  it('request undecodable response', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, 'not-valid-xml', 400))
    await expect(c.request(TX_TYPE.STATUS, MODEL.NON_SECURE, { 'request-data': 'abc' }, { id: '123' })).rejects.toThrow(
      PosHttpError,
    )
    expect(sent[0]?.init.body).toBe(ENCODED)
  })

  it('request bad request', async () => {
    const c = createClient(fakeFetch([], 'response-content', 500))
    const err = await c
      .request(TX_TYPE.STATUS, MODEL.NON_SECURE, { 'request-data': 'abc' }, { id: '123' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).status).toBe(500)
  })

  it('an HTML response (WAF page) is a PosHttpError with the URL, not a parser crash', async () => {
    const c = createClient(
      fakeFetch(
        [],
        '<html><head><title>Request Rejected</title></head><body>The requested URL was rejected.</body></html>',
      ),
    )
    const err = await c
      .request(TX_TYPE.STATUS, MODEL.NON_SECURE, { 'request-data': 'abc' }, { id: '123' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).url).toBe(API_URL)
  })
})
