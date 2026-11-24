import { describe, expect, it } from 'vitest'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { KuveytPosSoapApiHttpClient } from '../../../src/client/KuveytPosSoapApiHttpClient.js'
import { KuveytPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/KuveytPosRequestValueMapper.js'
import type { RequestValueMapperInterface } from '../../../src/data-mapper/request/value-mapper/RequestValueMapperInterface.js'
import { PosHttpError } from '../../../src/errors.js'
import type { PosLogger } from '../../../src/logger.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../src/PosInterface.js'

// HTTP is replaced by a fake fetch.

const API_URL =
  'https://boatest.kuveytturk.com.tr/BOA.Integration.WCFService/BOA.Integration.VirtualPos/VirtualPosService.svc/Basic'
const ACTION_PREFIX = 'http://boa.net/BOA.Integration.VirtualPos/Service/IVirtualPosService/'
const ENVELOPE_OPEN =
  '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://boa.net/BOA.Integration.VirtualPos/Service"><soapenv:Body>'

type Sent = { url: string; init: RequestInit }

function fakeFetch(sent: Sent[], body: string, status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(status === 204 ? null : body, { status })
  }) as unknown as typeof fetch
}

const stubMapper = { mapTxType: () => 'CancelV4' } as unknown as RequestValueMapperInterface

function createClient(
  fetchImpl: typeof fetch,
  mapper: RequestValueMapperInterface = stubMapper,
  logger?: PosLogger,
): KuveytPosSoapApiHttpClient {
  return new KuveytPosSoapApiHttpClient(
    API_URL,
    new HttpTransport({ fetch: fetchImpl }),
    logger ?? { debug() {}, info() {}, warn() {}, error() {} },
    mapper,
  )
}

const fault = (inner: string, prefix = 's:'): string =>
  `<${prefix}Envelope xmlns:${prefix.slice(0, -1) || 'x'}="http://schemas.xmlsoap.org/soap/envelope/"><${prefix}Body><${prefix}Fault>${inner}</${prefix}Fault></${prefix}Body></${prefix}Envelope>`

describe('KuveytPosSoapApiHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it('supports', () => {
    expect(KuveytPosSoapApiHttpClient.supports('AkbankPos', 'payment_api')).toBe(false)
    // addition: only the query API of KuveytPos belongs to this client
    expect(KuveytPosSoapApiHttpClient.supports('KuveytPos', 'query_api')).toBe(true)
    expect(KuveytPosSoapApiHttpClient.supports('KuveytPos', 'payment_api')).toBe(false)
  })

  it('supportsTx', () => {
    expect(client.supportsTx(TX_TYPE.STATUS, MODEL.NON_SECURE)).toBe(true)
    expect(client.supportsTx(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE)).toBe(false)
    // addition: K6
    expect(client.supportsTx(TX_TYPE.CANCEL, MODEL.NON_SECURE)).toBe(true)
    expect(client.supportsTx(TX_TYPE.REFUND, MODEL.NON_SECURE)).toBe(true)
    expect(client.supportsTx(TX_TYPE.REFUND_PARTIAL, MODEL.NON_SECURE)).toBe(true)
    expect(client.supportsTx(TX_TYPE.PAY_PRE_AUTH, MODEL.NON_SECURE)).toBe(false)
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
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><result>ok</result></s:Body></s:Envelope>',
      ),
    )
    const actual = await c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { foo: 'bar' }, { id: '123' }, API_URL)

    expect(actual).toStrictEqual({ result: 'ok' })
    const [request] = sent as [Sent]
    expect(request.url).toBe(API_URL)
    expect(request.init.body).toBe(`${ENVELOPE_OPEN}<ser:foo>bar</ser:foo></soapenv:Body></soapenv:Envelope>`)
    const headers = new Headers(request.init.headers)
    expect(headers.get('Content-Type')).toBe('text/xml; charset=UTF-8')
    expect(headers.get('SOAPAction')).toBe(`${ACTION_PREFIX}CancelV4`)
  })

  it.each([
    ['400 with faultstring', fault('<faultstring xml:lang="tr">Some SOAP Fault</faultstring>'), 400, 'Some SOAP Fault'],
    ['400 with fault without faultstring', fault('<other>bla</other>'), 400, undefined],
  ])('SOAP fault: %s', async (_n, body, status, text) => {
    const c = createClient(fakeFetch([], body, status))
    const error = await c
      .request(TX_TYPE.CANCEL, MODEL.NON_SECURE, { foo: 'bar' }, { id: '123' }, API_URL)
      .catch((e) => e)
    expect(error).toBeInstanceOf(PosHttpError)
    expect(error.status).toBe(status)
    if (text !== undefined) expect(error.message).toContain(text)
  })

  it('answers 200 with an empty body as a PosHttpError', async () => {
    const c = createClient(fakeFetch([], '', 200))
    // deviation: K6/B14, an empty answer is a PosHttpError
    await expect(c.request(TX_TYPE.CANCEL, MODEL.NON_SECURE, { foo: 'bar' }, { id: '123' }, API_URL)).rejects.toThrow(
      PosHttpError,
    )
  })

  // addition: K6, a fault inside a 2xx answer, with any prefix
  it.each([
    ['s:', fault('<faultstring xml:lang="tr">x</faultstring>')],
    ['soap:', fault('<faultstring>x</faultstring>', 'soap:')],
    ['no prefix', fault('<faultstring>x</faultstring>', '')],
    ['faultstring with attributes and text node', fault('<faultstring xml:lang="tr">x</faultstring><detail/>')],
  ])('a 200 answer with a fault (%s) is a PosHttpError carrying the text', async (_n, body) => {
    const c = createClient(fakeFetch([], body))
    const error = await c
      .request(TX_TYPE.CANCEL, MODEL.NON_SECURE, { foo: 'bar' }, { id: '1' }, API_URL)
      .catch((e) => e)
    expect(error).toBeInstanceOf(PosHttpError)
    expect(error.message).toBe('Bank SOAP fault: x')
    expect(error.status).toBe(200)
    expect(error.url).toBe(API_URL)
  })

  it('shortens a long fault text to 256 characters', async () => {
    const c = createClient(fakeFetch([], fault(`<faultstring>${'a'.repeat(300)}</faultstring>`)))
    const error = await c
      .request(TX_TYPE.CANCEL, MODEL.NON_SECURE, { foo: 'bar' }, { id: '1' }, API_URL)
      .catch((e) => e)
    expect(error.message).toBe(`Bank SOAP fault: ${'a'.repeat(256)}`)
  })

  it('uses a generic text when the fault has none', async () => {
    const c = createClient(fakeFetch([], fault('<other>bla</other>')))
    const error = await c
      .request(TX_TYPE.CANCEL, MODEL.NON_SECURE, { foo: 'bar' }, { id: '1' }, API_URL)
      .catch((e) => e)
    expect(error.message).toBe('Bank SOAP fault: Bank request failed')
  })

  it('masks card-shaped digits in a fault text', async () => {
    const c = createClient(fakeFetch([], fault('<faultstring>card 4111111111111111 refused</faultstring>')))
    const error = await c
      .request(TX_TYPE.CANCEL, MODEL.NON_SECURE, { foo: 'bar' }, { id: '1' }, API_URL)
      .catch((e) => e)
    expect(error.message).not.toContain('4111111111111111')
  })

  it('reads a fault from a non-2xx answer under another prefix', async () => {
    const c = createClient(fakeFetch([], fault('<faultstring>boom</faultstring>', 'soap:'), 500))
    const error = await c
      .request(TX_TYPE.CANCEL, MODEL.NON_SECURE, { foo: 'bar' }, { id: '1' }, API_URL)
      .catch((e) => e)
    expect(error).toBeInstanceOf(PosHttpError)
    expect(error.status).toBe(500)
    expect(error.message).toContain('boom')
  })

  it.each([
    ['a non-2xx HTML page', '<html><body>blocked</body></html>', 502],
    ['a non-2xx empty body', '', 503],
  ])('keeps the transport error for %s', async (_n, body, status) => {
    const c = createClient(fakeFetch([], body, status))
    const error = await c
      .request(TX_TYPE.CANCEL, MODEL.NON_SECURE, { foo: 'bar' }, { id: '1' }, API_URL)
      .catch((e) => e)
    expect(error).toBeInstanceOf(PosHttpError)
    expect(error.status).toBe(status)
    expect(error.message).toBe(`Bank returned HTTP ${status}`)
  })

  it.each([
    ['an HTML page', '<html><body>blocked</body></html>'],
    ['an answer without a body', '<s:Envelope xmlns:s="x"><s:Header/></s:Envelope>'],
    ['plain text', 'nope'],
  ])('rejects %s answered with 200', async (_n, body) => {
    const c = createClient(fakeFetch([], body))
    await expect(c.request(TX_TYPE.STATUS, MODEL.NON_SECURE, { foo: 'bar' }, { id: '1' }, API_URL)).rejects.toThrow(
      PosHttpError,
    )
  })

  it('does not follow a redirect and answers 204 with an empty record', async () => {
    const c204 = createClient(fakeFetch([], '', 204))
    expect(await c204.request(TX_TYPE.STATUS, MODEL.NON_SECURE, { foo: 'bar' }, { id: '1' })).toStrictEqual({})
    const c302 = createClient(fakeFetch([], '', 302))
    await expect(c302.request(TX_TYPE.STATUS, MODEL.NON_SECURE, { foo: 'bar' }, { id: '1' })).rejects.toThrow(
      PosHttpError,
    )
  })

  it('escapes a hostile value in the envelope', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '<s:Envelope xmlns:s="x"><s:Body><r>1</r></s:Body></s:Envelope>'))
    await c.request(TX_TYPE.STATUS, MODEL.NON_SECURE, { v: 'a<b&c]]>d' }, { id: '1' })
    expect(sent[0]?.init.body).toBe(
      `${ENVELOPE_OPEN}<ser:v><![CDATA[a<b&c]]]]><![CDATA[>d]]></ser:v></soapenv:Body></soapenv:Envelope>`,
    )
  })

  it('sends Turkish characters as UTF-8', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '<s:Envelope xmlns:s="x"><s:Body><r>İşlem</r></s:Body></s:Envelope>'))
    const actual = await c.request(TX_TYPE.STATUS, MODEL.NON_SECURE, { v: 'İstanbul Şişli' }, { id: '1' })
    expect(sent[0]?.init.body).toContain('<ser:v>İstanbul Şişli</ser:v>')
    expect(actual).toStrictEqual({ r: 'İşlem' })
  })

  it.each([
    [TX_TYPE.STATUS, 'GetMerchantOrderDetail'],
    [TX_TYPE.REFUND, 'DrawBack'],
    [TX_TYPE.REFUND_PARTIAL, 'PartialDrawback'],
    [TX_TYPE.CANCEL, 'SaleReversal'],
  ] as Array<[TxType, string]>)('SOAPAction follows the transaction type %s', async (txType, action) => {
    const sent: Sent[] = []
    const c = createClient(
      fakeFetch(sent, '<s:Envelope xmlns:s="x"><s:Body><r>1</r></s:Body></s:Envelope>'),
      new KuveytPosRequestValueMapper(),
    )
    await c.request(txType, MODEL.NON_SECURE, { foo: 'bar' }, { id: '1' })
    expect(new Headers(sent[0]?.init.headers).get('SOAPAction')).toBe(`${ACTION_PREFIX}${action}`)
  })

  it('refuses a transaction type the bank has no action for, before sending', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, ''), new KuveytPosRequestValueMapper())
    await expect(c.request(TX_TYPE.PAY_POST_AUTH, MODEL.NON_SECURE, { foo: 'bar' }, { id: '1' })).rejects.toThrow()
    expect(sent).toHaveLength(0)
  })

  // addition: secrets echoed by a failing bank never reach the logger or the error text
  it('never logs hashes, card data or bodies', async () => {
    const logged: string[] = []
    const record = (m: string, c: unknown): number => logged.push(JSON.stringify([m, c]))
    const logger: PosLogger = { debug: record, info: record, warn: record, error: record }
    const echo =
      '<s:Envelope xmlns:s="x"><s:Body><s:Fault><faultstring>bad</faultstring><detail><VPosMessage><CardNumber>4111111111111111</CardNumber><CardCVV2>987</CardCVV2><HashPassword>SECRET-HP=</HashPassword><HashData>SECRET-HD=</HashData></VPosMessage></detail></s:Fault></s:Body></s:Envelope>'
    const errors: unknown[] = []
    for (const [body, status] of [
      [echo, 500],
      [echo, 200],
      ['<html><HashData>SECRET-HD=</HashData></html>', 200],
    ] as Array<[string, number]>) {
      const c = createClient(fakeFetch([], body, status), stubMapper, logger)
      errors.push(
        await c
          .request(
            TX_TYPE.CANCEL,
            MODEL.NON_SECURE,
            { CardNumber: '4111111111111111', CardCVV2: '987', HashPassword: 'SECRET-HP=', HashData: 'SECRET-HD=' },
            { id: '1' },
          )
          .catch((e) => e),
      )
    }

    const text = [
      logged.join('\n'),
      ...errors.map((e) => {
        const err = e as PosHttpError
        return `${err.message} ${err.bodySnippet ?? ''} ${JSON.stringify(err.cause ?? '')} ${String((err.cause as PosHttpError | undefined)?.bodySnippet)}`
      }),
    ].join('\n')
    for (const secret of ['4111111111111111', '987', 'SECRET-HP', 'SECRET-HD', 'soapenv:Envelope']) {
      expect(text).not.toContain(secret)
    }
  })
})
