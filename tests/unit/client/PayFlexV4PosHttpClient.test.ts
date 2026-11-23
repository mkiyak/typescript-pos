import { describe, expect, it, vi } from 'vitest'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PayFlexV4PosHttpClient } from '../../../src/client/PayFlexV4PosHttpClient.js'
import { PosHttpError } from '../../../src/errors.js'
import type { PosLogger } from '../../../src/logger.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../src/PosInterface.js'

// HTTP is replaced by a fake fetch.

const API_URL = 'https://onlineodemetest.vakifbank.com.tr:4443/VposService/v3/Vposreq.aspx'

type Sent = { url: string; init: RequestInit }

function fakeFetch(sent: Sent[], body: string, status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(body, { status })
  }) as unknown as typeof fetch
}

const createClient = (fetchImpl: typeof fetch, logger?: PosLogger): PayFlexV4PosHttpClient =>
  new PayFlexV4PosHttpClient(API_URL, new HttpTransport({ fetch: fetchImpl }), logger)

const ENCODED = 'prmstr=%3CVposRequest%3E%3Crequest-data%3Eabc%3C%2Frequest-data%3E%3C%2FVposRequest%3E'

describe('PayFlexV4PosHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it('supports', () => {
    expect(PayFlexV4PosHttpClient.supports('PayFlexV4Pos', 'payment_api')).toBe(true)
    expect(PayFlexV4PosHttpClient.supports('PayFlexV4Pos', 'gateway_3d')).toBe(false)
    expect(PayFlexV4PosHttpClient.supports('PayFlexV4Pos', 'query_api')).toBe(false)
    expect(PayFlexV4PosHttpClient.supports('AkbankPos', 'payment_api')).toBe(false)
  })

  it('supportsTx', () => {
    expect(client.supportsTx(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE)).toBe(true)
    // addition: enrollment and status have their own clients
    expect(client.supportsTx(TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_SECURE)).toBe(false)
    expect(client.supportsTx(TX_TYPE.STATUS, MODEL.NON_SECURE)).toBe(false)
    expect(client.supportsTx(TX_TYPE.CANCEL, MODEL.NON_SECURE)).toBe(true)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_HOST, API_URL],
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, API_URL],
    [TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, API_URL],
    [TX_TYPE.REFUND, MODEL.NON_SECURE, API_URL],
  ] as Array<[TxType, PaymentModel, string]>)('getApiUrl(%s, %s)', (txType, paymentModel, expected) => {
    expect(client.getApiUrl(txType, paymentModel)).toBe(expected)
  })

  it('request', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '<response><result>success</result></response>'))

    const actual = await c.request(
      TX_TYPE.PAY_AUTH,
      MODEL.THREE_D_SECURE,
      { 'request-data': 'abc' },
      { id: '123' },
      API_URL,
    )

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
    await expect(
      c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' }),
    ).rejects.toThrow(PosHttpError)
    expect(sent[0]?.init.body).toBe(ENCODED)
  })

  it('request undecodable 200 response', async () => {
    const c = createClient(fakeFetch([], 'not-valid-xml', 200))
    const err = await c
      .request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).url).toBe(API_URL)
  })

  it('request bad request', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, 'response-content', 500))
    const err = await c
      .request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).status).toBe(500)
    expect(sent[0]?.init.body).toBe(ENCODED)
  })

  it('decodes a VposResponse', async () => {
    const c = createClient(
      fakeFetch(
        [],
        '<?xml version="1.0" encoding="utf-8"?><VposResponse><ResultCode>0000</ResultCode>' +
          '<ResultDetail>İŞLEM BAŞARILI</ResultDetail><InstallmentTable /></VposResponse>',
      ),
    )
    const actual = await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 'b' }, { id: '1' })
    expect(actual).toStrictEqual({ ResultCode: '0000', ResultDetail: 'İŞLEM BAŞARILI', InstallmentTable: '' })
  })

  it('escapes XML special characters inside prmstr', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '<VposResponse><ResultCode>0000</ResultCode></VposResponse>'))
    await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { CardHoldersName: 'A & B <x>' }, { id: '1' })
    const prmstr = new URLSearchParams(sent[0]?.init.body as string).get('prmstr')
    expect(prmstr).toBe('<VposRequest><CardHoldersName><![CDATA[A & B <x>]]></CardHoldersName></VposRequest>')
  })

  it('masks card data and credentials in logs', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const c = createClient(fakeFetch([], '<html><body>blocked 4938410157705591 Ab123456</body></html>'), logger)
    await expect(
      c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { Password: 'Ab123456', Pan: '4938410157705591' }, { id: '1' }),
    ).rejects.toThrow(PosHttpError)
    const logged = JSON.stringify([logger.debug.mock.calls, logger.error.mock.calls])
    expect(logged).not.toContain('4938410157705591')
  })
})
