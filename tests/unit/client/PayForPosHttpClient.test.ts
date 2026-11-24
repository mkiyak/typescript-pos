import { describe, expect, it } from 'vitest'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PayForPosHttpClient } from '../../../src/client/PayForPosHttpClient.js'
import { PosError, PosHttpError } from '../../../src/errors.js'
import type { PosLogger } from '../../../src/logger.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../src/pos-query/PosQueryInterface.js'

// HTTP is replaced by a fake fetch.

const API_URL = 'https://vpostest.qnbfinansbank.com/Gateway/XMLGate.aspx'

type Sent = { url: string; init: RequestInit }

function fakeFetch(sent: Sent[], body: string, status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(body, { status })
  }) as unknown as typeof fetch
}

function createClient(fetchImpl: typeof fetch, logger?: PosLogger): PayForPosHttpClient {
  return new PayForPosHttpClient(API_URL, new HttpTransport({ fetch: fetchImpl }), logger)
}

const ENCODED_BODY =
  '<?xml version="1.0" encoding="UTF-8"?>\n<PayforRequest><request-data>abc</request-data></PayforRequest>\n'

describe('PayForPosHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE],
    [TX_TYPE.PAY_AUTH, MODEL.NON_SECURE],
    [TX_TYPE.REFUND, MODEL.NON_SECURE],
    [TX_TYPE.STATUS, MODEL.NON_SECURE],
    // addition: partial refunds go to the same endpoint
    [TX_TYPE.REFUND_PARTIAL, MODEL.NON_SECURE],
  ] as Array<[TxType, PaymentModel]>)('getApiUrl(%s, %s)', (txType, paymentModel) => {
    expect(client.getApiUrl(txType, paymentModel)).toBe(API_URL)
  })

  it('supports', () => {
    expect(PayForPosHttpClient.supports('PayForPos', PayForPosHttpClient.API_NAME_PAYMENT_API)).toBe(true)
    expect(PayForPosHttpClient.supports('AkbankPos', PayForPosHttpClient.API_NAME_PAYMENT_API)).toBe(false)
  })

  it('supportsTx', () => {
    expect(client.supportsTx(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE)).toBe(true)
  })

  it('request', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '<response><result>success</result></response>'))
    // deviation: the encoder takes records, so the request data is a record rather than a list
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
    expect(request.init.body).toBe(ENCODED_BODY)
    expect(new Headers(request.init.headers).get('Content-Type')).toBe('text/xml; charset=UTF-8')
  })

  it('request undecodable response', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, 'not-valid-xml', 400))
    // deviation: F28 a non-2xx answer is a PosHttpError
    await expect(
      c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: 123 as unknown as string }),
    ).rejects.toThrow(PosHttpError)
    expect(sent[0]?.init.body).toBe(ENCODED_BODY)
  })

  it('request bad request', async () => {
    const c = createClient(fakeFetch([], 'response-content', 500))
    // deviation: F28 a non-2xx answer is a PosHttpError with the status
    const err = await c
      .request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).status).toBe(500)
  })

  // addition: the 3D form build goes to the form client, everything else here (queries included)
  it('supportsTx by transaction type', () => {
    expect(client.supportsTx(TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_SECURE)).toBe(false)
    expect(client.supportsTx(QUERY_TYPE.CUSTOM_QUERY, MODEL.NON_SECURE)).toBe(true)
    expect(client.supportsTx(QUERY_TYPE.HISTORY, MODEL.NON_SECURE)).toBe(true)
  })

  // addition: an HTML page answered with 200 rejects with a PosHttpError
  it('request HTML page with status 200', async () => {
    const c = createClient(fakeFetch([], '<html><body>Request Rejected</body></html>', 200))
    const err = await c
      .request(TX_TYPE.STATUS, MODEL.NON_SECURE, { 'request-data': 'abc' }, { id: '123' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
  })

  // addition: markup characters travel inside CDATA and non-ASCII text is sent as is (UTF-8 declared)
  it('wraps markup characters in CDATA and keeps non-ASCII text', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '<r><a>1</a></r>'))
    await c.request(
      TX_TYPE.PAY_AUTH,
      MODEL.NON_SECURE,
      { CardHolderName: 'Ali & Veli <x>', Note: 'Çağrı' },
      { id: '1' },
    )
    const body = sent[0]?.init.body
    expect(body).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/)
    expect(body).toContain('<CardHolderName><![CDATA[Ali & Veli <x>]]></CardHolderName>')
    expect(body).toContain('<Note>Çağrı</Note>')
  })

  // addition: bodies are never logged, so card data and credentials stay out of every logger context
  it('never logs request values', async () => {
    const calls: string[] = []
    const rec = (level: string) => (msg: string, ctx?: unknown) => {
      calls.push(`${level} ${msg} ${JSON.stringify(ctx)}`)
    }
    const logger: PosLogger = { debug: rec('debug'), info: rec('info'), warn: rec('warn'), error: rec('error') }
    const data = {
      Pan: '4155650100416111',
      Cvv2: '715',
      Expiry: '0125',
      UserPass: 'api-secret',
      MerchantPass: 'store-secret',
    }

    const ok = createClient(fakeFetch([], '<r><a>1</a></r>'), logger)
    await ok.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, data, { id: '1' })
    // a failing answer that echoes the secrets back ends in PosHttpError; neither it nor the logs show them
    const bad = createClient(
      fakeFetch([], '<r><UserPass>api-secret</UserPass><Pan>4155650100416111</Pan></r>', 500),
      logger,
    )
    const err = (await bad
      .request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, data, { id: '1' })
      .catch((e: unknown) => e)) as PosHttpError

    expect(err).toBeInstanceOf(PosError)
    const everything = `${calls.join('\n')}\n${err.message}\n${err.bodySnippet ?? ''}`
    for (const secret of ['4155650100416111', '715', '0125', 'api-secret', 'store-secret']) {
      expect(everything).not.toContain(secret)
    }
    expect(calls.length).toBeGreaterThan(0)
  })
})
