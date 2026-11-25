import iconv from 'iconv-lite'
import { describe, expect, it } from 'vitest'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PARAM_EXTRA_SECRETS, ParamPosHttpClient } from '../../../src/client/ParamPosHttpClient.js'
import { PosHttpError } from '../../../src/errors.js'
import type { PosLogger } from '../../../src/logger.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../src/PosInterface.js'

// HTTP is replaced by a fake fetch.

const API_URL = 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx'
const GUID = '0c13d406-873b-403b-9c09-a5766840d98c'
const ENVELOPE =
  '<?xml version="1.0" encoding="utf-8"?>\n<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">'

type Sent = { url: string; init: RequestInit }

function fakeFetch(sent: Sent[], body: string | Uint8Array, status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(status === 204 ? null : (body as ConstructorParameters<typeof Response>[0]), { status })
  }) as unknown as typeof fetch
}

const silent: PosLogger = { debug() {}, info() {}, warn() {}, error() {} }

function createClient(
  fetchImpl: typeof fetch,
  logger: PosLogger = silent,
  txTypes?: readonly TxType[],
): ParamPosHttpClient {
  return new ParamPosHttpClient(API_URL, new HttpTransport({ fetch: fetchImpl }), logger, txTypes)
}

const fault = (inner: string, prefix = 'soap:'): string =>
  `<${prefix}Envelope xmlns:${prefix.slice(0, -1) || 'x'}="http://schemas.xmlsoap.org/soap/envelope/"><${prefix}Body><${prefix}Fault>${inner}</${prefix}Fault></${prefix}Body></${prefix}Envelope>`

const call = (c: ParamPosHttpClient, data: Record<string, unknown> = { 'request-data': 'abc' }) =>
  c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, data, { id: '123' }, API_URL)

describe('ParamPosHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it('supports', () => {
    expect(ParamPosHttpClient.supports('ParamPos', 'payment_api')).toBe(true)
    expect(ParamPosHttpClient.supports('Param3DHostPos', 'payment_api')).toBe(true)
    expect(ParamPosHttpClient.supports('AkbankPos', 'payment_api')).toBe(false)
    // addition: only the payment API belongs to this client
    expect(ParamPosHttpClient.supports('ParamPos', 'query_api')).toBe(false)
    expect(ParamPosHttpClient.supports('Param3DHostPos', 'query_api')).toBe(false)
  })

  it('supportsTx', () => {
    expect(client.supportsTx(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE)).toBe(true)
    // addition: a client limited to some types supports only those
    const limited = createClient(fakeFetch([], ''), silent, [TX_TYPE.STATUS])
    expect(limited.supportsTx(TX_TYPE.STATUS, MODEL.THREE_D_HOST)).toBe(true)
    expect(limited.supportsTx(TX_TYPE.PAY_AUTH, MODEL.THREE_D_HOST)).toBe(false)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE],
    [TX_TYPE.PAY_AUTH, MODEL.NON_SECURE],
    [TX_TYPE.REFUND, MODEL.NON_SECURE],
    [TX_TYPE.REFUND_PARTIAL, MODEL.NON_SECURE],
    [TX_TYPE.CANCEL, MODEL.NON_SECURE],
    [TX_TYPE.STATUS, MODEL.NON_SECURE],
  ] as Array<[TxType, PaymentModel]>)('getApiUrl(%s, %s)', (txType, model) => {
    expect(client.getApiUrl(txType, model)).toBe(API_URL)
  })

  it('request creates a correct SOAP request', async () => {
    const sent: Sent[] = []
    const c = createClient(
      fakeFetch(
        sent,
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><result>ok</result></soap:Body></soap:Envelope>',
      ),
    )
    const actual = await call(c)

    expect(actual).toStrictEqual({ result: 'ok' })
    const [request] = sent as [Sent]
    expect(request.url).toBe(API_URL)
    expect(request.init.method).toBe('POST')
    expect(request.init.body).toBe(`${ENVELOPE}<request-data>abc</request-data></soap:Envelope>\n`)
    // deviation: C8, the content type names its charset and there is no SOAPAction (credentials are in the body)
    const headers = new Headers(request.init.headers)
    expect(headers.get('Content-Type')).toBe('text/xml; charset=UTF-8')
    expect(headers.has('SOAPAction')).toBe(false)
  })

  it('an undecodable 400 answer is a PosHttpError', async () => {
    // deviation: C8, a PosHttpError instead of a RuntimeException
    const error = await call(createClient(fakeFetch([], 'not-valid-xml', 400))).catch((e) => e)
    expect(error).toBeInstanceOf(PosHttpError)
    expect(error.status).toBe(400)
  })

  it.each([
    [
      'with a faultstring',
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultstring>Error message</faultstring></soap:Fault></soap:Body></soap:Envelope>',
      'Error message',
    ],
    [
      'without a faultstring',
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><other_key>bla</other_key></soap:Fault></soap:Body></soap:Envelope>',
      // deviation: C8, the generic text is English
      'Bank request failed',
    ],
  ])('a bad request %s', async (_name, body, text) => {
    const error = await call(createClient(fakeFetch([], body))).catch((e) => e)
    expect(error).toBeInstanceOf(PosHttpError)
    expect(error.message).toContain(text)
    expect(error.url).toBe(API_URL)
  })

  // addition: a fault with another prefix, or none
  it.each([
    ['s:', fault('<faultstring>boom</faultstring>', 's:')],
    ['no prefix', fault('<faultstring>boom</faultstring>', '')],
  ])('a fault under %s is a PosHttpError', async (_name, body) => {
    const error = await call(createClient(fakeFetch([], body))).catch((e) => e)
    expect(error).toBeInstanceOf(PosHttpError)
    expect(error.message).toBe('Bank SOAP fault: boom')
  })

  // addition: the credentials of the request never reach an error text
  it.each([
    ['a 200 answer', 200],
    ['a 500 answer', 500],
  ])('masks the credentials a fault text echoes (%s)', async (_name, status) => {
    const data = { G: { CLIENT_CODE: '10738', CLIENT_USERNAME: 'Test1', CLIENT_PASSWORD: 'Test2' }, GUID }
    const body = fault(`<faultstring>bad Test2 for ${GUID} user Test1</faultstring>`)
    const error = await call(createClient(fakeFetch([], body, status)), data).catch((e) => e)
    expect(error).toBeInstanceOf(PosHttpError)
    expect(error.message).toBe('Bank SOAP fault: bad *** for *** user ***')
    expect(error.url).toBe(API_URL)
  })

  // addition: a non-2xx answer keeps its status and adds the fault text
  it('HTTP 500 with a fault body carries the status and the fault text', async () => {
    const error = await call(
      createClient(fakeFetch([], fault('<faultstring>Server was unable</faultstring>'), 500)),
    ).catch((e) => e)
    expect(error).toBeInstanceOf(PosHttpError)
    expect(error.status).toBe(500)
    expect(error.message).toContain('Server was unable')
  })

  // addition: what a bank edge answers instead of SOAP
  it.each([
    ['an HTML page', '<html><body>blocked</body></html>'],
    ['a WAF page', '<!DOCTYPE html><html><head><title>Request Rejected</title></head><body>support id 1</body></html>'],
    ['an empty answer', ''],
    ['an answer without a body', '<a>x</a>'],
    ['plain text', 'nope'],
  ])('rejects %s answered with 200', async (_name, body) => {
    const error = await call(createClient(fakeFetch([], body))).catch((e) => e)
    expect(error).toBeInstanceOf(PosHttpError)
    expect(error.url).toBe(API_URL)
  })

  // addition: the decoder refuses entity definitions
  it('rejects an answer that defines an entity', async () => {
    const body = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "boom">]><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><r>&e;</r></soap:Body></soap:Envelope>`
    await expect(call(createClient(fakeFetch([], body)))).rejects.toThrow(PosHttpError)
  })

  // addition: a redirect is not followed
  it('answers a 302 with a PosHttpError', async () => {
    const error = await call(createClient(fakeFetch([], '', 302))).catch((e) => e)
    expect(error).toBeInstanceOf(PosHttpError)
    expect(error.status).toBe(302)
  })

  // addition: an answer in ISO-8859-9 is read with its declared charset
  it('decodes an ISO-8859-9 declared answer', async () => {
    const xml =
      '<?xml version="1.0" encoding="ISO-8859-9"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><r>İşlem Başarılı ğüöç</r></soap:Body></soap:Envelope>'
    const actual = await call(createClient(fakeFetch([], iconv.encode(xml, 'ISO-8859-9'))))
    expect(actual).toStrictEqual({ r: 'İşlem Başarılı ğüöç' })
  })

  // addition: Turkish characters are sent as UTF-8
  it('sends Turkish characters as UTF-8', async () => {
    const sent: Sent[] = []
    const c = createClient(
      fakeFetch(sent, '<soap:Envelope xmlns:soap="x"><soap:Body><r>İşlem</r></soap:Body></soap:Envelope>'),
    )
    const actual = await call(c, { KK_Sahibi: 'İstanbul Şişli' })
    expect(String(sent[0]?.init.body)).toContain('<KK_Sahibi>İstanbul Şişli</KK_Sahibi>')
    expect(new Headers(sent[0]?.init.headers).get('Content-Type')).toContain('charset=UTF-8')
    expect(actual).toStrictEqual({ r: 'İşlem' })
  })

  // addition: a hostile value stays inside its element
  it('escapes a hostile value in the envelope', async () => {
    const sent: Sent[] = []
    const c = createClient(
      fakeFetch(sent, '<soap:Envelope xmlns:soap="x"><soap:Body><r>1</r></soap:Body></soap:Envelope>'),
    )
    await call(c, { v: 'a<b&c]]>d' })
    expect(sent[0]?.init.body).toBe(`${ENVELOPE}<v><![CDATA[a<b&c]]]]><![CDATA[>d]]></v></soap:Envelope>\n`)
  })

  // addition: a request whose names carry markup is refused before anything is sent
  it('refuses an invalid element name before sending', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, ''))
    await expect(call(c, { 'a b': 1 })).rejects.toThrow()
    expect(sent).toHaveLength(0)
  })

  // addition: secrets echoed by a failing bank never reach the logger or the error text
  it('never logs credentials, card data or bodies', async () => {
    const logged: string[] = []
    const record = (m: string, c: unknown): number => logged.push(JSON.stringify([m, c]))
    const logger: PosLogger = { debug: record, info: record, warn: record, error: record }
    const echo = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultstring>bad</faultstring><detail><G><CLIENT_USERNAME>Test1</CLIENT_USERNAME><CLIENT_PASSWORD>Test2</CLIENT_PASSWORD></G><GUID>${GUID}</GUID><KK_No>5555444433332222</KK_No><KK_CVC>123</KK_CVC></detail></soap:Fault></soap:Body></soap:Envelope>`
    const data = {
      G: { CLIENT_CODE: '10738', CLIENT_USERNAME: 'Test1', CLIENT_PASSWORD: 'Test2' },
      GUID,
      KK_No: '5555444433332222',
      KK_CVC: '123',
    }
    const errors: unknown[] = []
    for (const [body, status] of [
      [echo, 500],
      [echo, 200],
      [`<html><CLIENT_PASSWORD>Test2</CLIENT_PASSWORD><GUID>${GUID}</GUID><KK_No>5555444433332222</KK_No></html>`, 502],
      [`<html><CLIENT_PASSWORD>Test2</CLIENT_PASSWORD><GUID>${GUID}</GUID></html>`, 200],
    ] as Array<[string, number]>) {
      errors.push(await call(createClient(fakeFetch([], body, status), logger), data).catch((e) => e))
    }

    const text = [
      logged.join('\n'),
      ...errors.map((e) => {
        const err = e as PosHttpError
        const cause = err.cause as PosHttpError | undefined
        return `${err.message} ${err.bodySnippet ?? ''} ${cause?.message ?? ''} ${cause?.bodySnippet ?? ''}`
      }),
    ].join('\n')
    for (const secret of ['Test2', GUID, '5555444433332222']) {
      expect(text).not.toContain(secret)
    }
    expect(text).not.toContain('<KK_CVC>123<')
    // the masking is visible, not just a missing text
    expect(text).toContain('***')
    expect(logged.length).toBeGreaterThan(0)
  })

  // addition: a password that looks like a card number is hidden as a secret, not first cut down to a masked card number
  it('hides a card-shaped password completely in the log lines', async () => {
    const password = '12345678901234567'
    const logged: string[] = []
    const record = (m: string, c: unknown): number => logged.push(JSON.stringify([m, c]))
    const logger: PosLogger = { debug: record, info: record, warn: record, error: record }
    const data = { G: { CLIENT_CODE: '10738', CLIENT_USERNAME: 'Test1', CLIENT_PASSWORD: password }, GUID }
    await call(createClient(fakeFetch([], `<html>blocked ${password} here</html>`, 200), logger), data).catch((e) => e)
    const text = logged.join('\n')
    expect(text).toContain('parsing bank response failed')
    // the card-number mask would keep the first six and last four digits
    expect(text).not.toContain(password.slice(0, 6))
    expect(text).not.toContain(password.slice(-4))
  })

  // addition: a failing request keeps where and how it failed in the log line, with the secrets hidden
  it('logs the url and status of a failed request', async () => {
    const logged: Array<[string, Record<string, unknown>]> = []
    const record = (m: string, c?: Record<string, unknown>): number => logged.push([m, c ?? {}])
    const logger: PosLogger = { debug() {}, info() {}, warn() {}, error: record }
    const data = { G: { CLIENT_CODE: '10738', CLIENT_USERNAME: 'Test1', CLIENT_PASSWORD: 'Test2' }, GUID }
    await call(createClient(fakeFetch([], fault('<faultstring>x Test2</faultstring>'), 500), logger), data).catch(
      (e) => e,
    )
    const line = logged.find(([m]) => m === 'api request failed')
    expect(line).toBeDefined()
    const error = line?.[1].error as Record<string, unknown>
    expect(error.url).toBe(API_URL)
    expect(error.status).toBe(500)
    expect(JSON.stringify(line)).not.toContain('Test2')
  })

  // addition: the hosted page registration does not carry the merchant key, a fault echoing it is still masked
  it('masks the merchant key a fault echoes although the request did not carry it', async () => {
    const logged: string[] = []
    const record = (m: string, c: unknown): number => logged.push(JSON.stringify([m, c]))
    const logger: PosLogger = { debug: record, info: record, warn: record, error: record }
    const data = {
      'soap:Header': {
        ServiceSecuritySoapHeader: { CLIENT_CODE: '10738', CLIENT_USERNAME: 'Test1', CLIENT_PASSWORD: 'Test2' },
      },
      [PARAM_EXTRA_SECRETS]: [GUID],
    }
    const body = fault(`<faultstring>unknown key ${GUID} for Test1</faultstring>`)
    const error = await call(createClient(fakeFetch([], body, 500), logger), data).catch((e) => e)
    expect(error).toBeInstanceOf(PosHttpError)
    expect(error.message).toBe('Bank SOAP fault: unknown key *** for ***')
    expect(logged.join('\n')).not.toContain(GUID)
  })
})
