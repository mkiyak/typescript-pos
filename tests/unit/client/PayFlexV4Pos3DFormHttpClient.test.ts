import { describe, expect, it } from 'vitest'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PayFlexV4Pos3DFormHttpClient } from '../../../src/client/PayFlexV4Pos3DFormHttpClient.js'
import { PosHttpError } from '../../../src/errors.js'
import { MODEL, TX_TYPE } from '../../../src/PosInterface.js'

// HTTP is replaced by a fake fetch.

const API_URL = 'https://3dsecuretest.vakifbank.com.tr:4443/MPIAPI/MPI_Enrollment.aspx'

type Sent = { url: string; init: RequestInit }

function fakeFetch(sent: Sent[], body: string, status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(body, { status })
  }) as unknown as typeof fetch
}

const createClient = (fetchImpl: typeof fetch): PayFlexV4Pos3DFormHttpClient =>
  new PayFlexV4Pos3DFormHttpClient(API_URL, new HttpTransport({ fetch: fetchImpl }))

describe('PayFlexV4Pos3DFormHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it('supports', () => {
    expect(PayFlexV4Pos3DFormHttpClient.supports('PayFlexV4Pos', 'gateway_3d')).toBe(true)
    expect(PayFlexV4Pos3DFormHttpClient.supports('PayFlexV4Pos', 'payment_api')).toBe(false)
    expect(PayFlexV4Pos3DFormHttpClient.supports('PayFlexV4Pos', 'query_api')).toBe(false)
    expect(PayFlexV4Pos3DFormHttpClient.supports('AkbankPos', 'payment_api')).toBe(false)
  })

  it('supportsTx', () => {
    expect(client.supportsTx(TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_SECURE)).toBe(true)
    // addition: only the enrollment request goes to the 3D gateway
    expect(client.supportsTx(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE)).toBe(false)
    expect(client.supportsTx(TX_TYPE.STATUS, MODEL.NON_SECURE)).toBe(false)
  })

  it('getApiUrl', () => {
    expect(client.getApiUrl(TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_HOST)).toBe(API_URL)
  })

  it('request', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '<response><result>success</result></response>'))

    const actual = await c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { key1: 'val1' }, { id: '123' }, API_URL)

    expect(actual).toStrictEqual({ result: 'success' })
    expect(sent).toHaveLength(1)
    const [request] = sent as [Sent]
    expect(request.url).toBe(API_URL)
    expect(request.init.method).toBe('POST')
    expect(request.init.body).toBe('key1=val1')
    expect(new Headers(request.init.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded')
  })

  // every non-2xx response is a PosHttpError
  it('request undecodable response', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, 'response-content', 400))
    await expect(c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { key1: 'val1' }, { id: '123' })).rejects.toThrow(
      PosHttpError,
    )
    expect(sent[0]?.init.body).toBe('key1=val1')
  })

  it('request bad request', async () => {
    const c = createClient(fakeFetch([], 'response-content', 500))
    const err = await c
      .request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { key1: 'val1' }, { id: '123' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).status).toBe(500)
  })

  it('a 200 HTML page (WAF) is a PosHttpError', async () => {
    const c = createClient(fakeFetch([], '<!DOCTYPE html><html><body>Request Rejected</body></html>'))
    await expect(c.request(TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_SECURE, {}, { id: '1' })).rejects.toThrow(
      PosHttpError,
    )
  })

  it('form-encodes like PHP http_build_query', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '<IPaySecure><Message/></IPaySecure>'))
    await c.request(
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      MODEL.THREE_D_SECURE,
      { SuccessUrl: 'https://domain.com/ok?a=1&b=2', Name: 'İş Ödeme' },
      { id: '1' },
    )
    expect(sent[0]?.init.body).toBe(
      'SuccessUrl=https%3A%2F%2Fdomain.com%2Fok%3Fa%3D1%26b%3D2&Name=%C4%B0%C5%9F+%C3%96deme',
    )
  })
})
