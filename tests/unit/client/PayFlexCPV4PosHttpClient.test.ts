import { describe, expect, it } from 'vitest'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PayFlexCPV4PosHttpClient } from '../../../src/client/PayFlexCPV4PosHttpClient.js'
import { PosHttpError } from '../../../src/errors.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../src/pos-query/PosQueryInterface.js'

// HTTP is replaced by a fake fetch.

const API_URL = 'https://inbound.apigatewaytest.vakifbank.com.tr:8443/commonPayment'

type Sent = { url: string; init: RequestInit }

function fakeFetch(sent: Sent[], body: string, status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(body, { status })
  }) as unknown as typeof fetch
}

const createClient = (fetchImpl: typeof fetch, endpoint = API_URL): PayFlexCPV4PosHttpClient =>
  new PayFlexCPV4PosHttpClient(endpoint, new HttpTransport({ fetch: fetchImpl }))

const header = (req: Sent | undefined, name: string): string | null => new Headers(req?.init.headers).get(name)

describe('PayFlexCPV4PosHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it('supports', () => {
    expect(PayFlexCPV4PosHttpClient.supports('PayFlexCPV4Pos', 'payment_api')).toBe(true)
    expect(PayFlexCPV4PosHttpClient.supports('PayFlexCPV4Pos', 'gateway_3d')).toBe(true)
    expect(PayFlexCPV4PosHttpClient.supports('PayFlexCPV4Pos', 'query_api')).toBe(false)
    expect(PayFlexCPV4PosHttpClient.supports('AkbankPos', 'payment_api')).toBe(false)
  })

  it('supportsTx', () => {
    expect(client.supportsTx(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE)).toBe(true)
  })

  // deviation: R1 v2.1 paths (CreateToken / GetVposTransaction under the 8443 commonPayment base)
  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_HOST, `${API_URL}/GetVposTransaction`],
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, `${API_URL}/GetVposTransaction`],
    [TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, `${API_URL}/GetVposTransaction`],
    [TX_TYPE.REFUND, MODEL.NON_SECURE, `${API_URL}/GetVposTransaction`],
    [TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_PAY, `${API_URL}/CreateToken`],
  ] as Array<[TxType, PaymentModel, string]>)('getApiUrl(%s, %s)', (txType, paymentModel, expected) => {
    expect(client.getApiUrl(txType, paymentModel)).toBe(expected)
  })

  // deviation: R8 JSON body, R5 Accept: application/json
  it('request', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '<response><result>success</result></response>'))
    const expectedApiUrl = `${API_URL}/GetVposTransaction`

    const actual = await c.request(
      TX_TYPE.PAY_AUTH,
      MODEL.THREE_D_SECURE,
      { 'request-data': 'abc' },
      { id: '123' },
      expectedApiUrl,
    )

    expect(actual).toStrictEqual({ result: 'success' })
    expect(sent).toHaveLength(1)
    const [request] = sent as [Sent]
    expect(request.url).toBe(expectedApiUrl)
    expect(request.init.method).toBe('POST')
    expect(request.init.body).toBe('{"request-data":"abc"}')
    expect(header(request, 'Content-Type')).toBe('application/json')
    expect(header(request, 'Accept')).toBe('application/json')
  })

  it('request undecodable response', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, 'response-content', 400))
    await expect(
      c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' }),
    ).rejects.toThrow(PosHttpError)
    expect(sent[0]?.init.body).toBe('{"request-data":"abc"}')
  })

  it('request bad request', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, 'response-content', 500))
    const err = await c
      .request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).status).toBe(500)
    expect(sent[0]?.init.body).toBe('{"request-data":"abc"}')
  })

  // addition: the registration is posted form-urlencoded to CreateToken
  it('posts the registration form-urlencoded to CreateToken', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '{"PaymentToken":"t","CommonPaymentUrl":"https://x"}'))

    const actual = await c.request(
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      MODEL.THREE_D_PAY,
      { HostMerchantId: '1', Amount: '1.00' },
      { id: '123' },
    )

    expect(actual).toStrictEqual({ PaymentToken: 't', CommonPaymentUrl: 'https://x' })
    const [request] = sent as [Sent]
    expect(request.url).toBe(`${API_URL}/CreateToken`)
    expect(request.init.body).toBe('HostMerchantId=1&Amount=1.00')
    expect(header(request, 'Content-Type')).toBe('application/x-www-form-urlencoded')
    expect(header(request, 'Accept')).toBe('application/json')
  })

  // addition: the query is posted as JSON to GetVposTransaction
  it('posts the status query as JSON to GetVposTransaction', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '{"Rc":"0000"}'))

    const actual = await c.request(TX_TYPE.STATUS, MODEL.NON_SECURE, { TransactionId: 'T1' }, { id: '123' })

    expect(actual).toStrictEqual({ Rc: '0000' })
    const [request] = sent as [Sent]
    expect(request.url).toBe(`${API_URL}/GetVposTransaction`)
    expect(request.init.body).toBe('{"TransactionId":"T1"}')
    expect(header(request, 'Content-Type')).toBe('application/json')
  })

  // addition: an HTML page (WAF block) with HTTP 200 never decodes
  it('rejects an HTML page with HTTP 200', async () => {
    const c = createClient(fakeFetch([], '<!DOCTYPE html><html><body>Request rejected</body></html>'))
    const err = await c
      .request(TX_TYPE.INTERNAL_3D_PAYMENT_STATUS, MODEL.NON_SECURE, { TransactionId: 'T1' }, { id: '1' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).url).toBe(`${API_URL}/GetVposTransaction`)
  })

  // addition: a body that is neither XML nor JSON
  it('rejects a non-JSON text body', async () => {
    const c = createClient(fakeFetch([], 'Service Unavailable'))
    await expect(
      c.request(TX_TYPE.INTERNAL_3D_PAYMENT_STATUS, MODEL.NON_SECURE, { TransactionId: 'T1' }, { id: '1' }),
    ).rejects.toThrow(PosHttpError)
  })

  // addition: XML answers (guide §4 RegisterResponse) still decode
  it('decodes an XML registration answer', async () => {
    const c = createClient(
      fakeFetch(
        [],
        '<?xml version="1.0" encoding="utf-8"?><RegisterResponse><CommonPaymentUrl>https://x</CommonPaymentUrl>' +
          '<PaymentToken>t</PaymentToken></RegisterResponse>',
      ),
    )
    const actual = await c.request(TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_HOST, { a: 'b' }, { id: '1' })
    expect(actual).toStrictEqual({ CommonPaymentUrl: 'https://x', PaymentToken: 't' })
  })

  // addition: a trailing slash in the configured endpoint does not double the separator
  it('strips one trailing slash from the endpoint', () => {
    const c = createClient(fakeFetch([], ''), `${API_URL}/`)
    expect(c.getApiUrl(TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_PAY)).toBe(`${API_URL}/CreateToken`)
    expect(c.getApiUrl(TX_TYPE.STATUS, MODEL.NON_SECURE)).toBe(`${API_URL}/GetVposTransaction`)
  })
})

// addition: custom_query support
describe('PayFlexCPV4PosHttpClient query support', () => {
  it('supportsTx(custom_query) is true', () => {
    expect(createClient(fakeFetch([], '')).supportsTx(QUERY_TYPE.CUSTOM_QUERY, MODEL.NON_SECURE)).toBe(true)
  })
})

// addition: custom_query reaches GetVposTransaction as JSON
describe('PayFlexCPV4PosHttpClient custom_query', () => {
  it('builds the GetVposTransaction URL under a trailing-slash base', () => {
    const c = createClient(fakeFetch([], ''), 'https://inbound.apigatewaytest.vakifbank.com.tr:8443/commonPayment/')
    expect((c as unknown as { getApiUrl(t: string, m: string): string }).getApiUrl('custom_query', 'regular')).toBe(
      'https://inbound.apigatewaytest.vakifbank.com.tr:8443/commonPayment/GetVposTransaction',
    )
  })

  it('posts the JSON body with JSON headers', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '{"ResultCode":"0000"}'))
    await c.request(QUERY_TYPE.CUSTOM_QUERY, MODEL.NON_SECURE, { TransactionId: 'abc' }, {})
    expect(sent[0]?.init.body).toBe('{"TransactionId":"abc"}')
    expect(header(sent[0], 'Content-Type')).toBe('application/json')
    expect(header(sent[0], 'Accept')).toBe('application/json')
  })
})
