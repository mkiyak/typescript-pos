import { describe, expect, it } from 'vitest'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { KuveytPosHttpClient } from '../../../src/client/KuveytPosHttpClient.js'
import { PosHttpError, UnsupportedTransactionTypeError } from '../../../src/errors.js'
import type { PosLogger } from '../../../src/logger.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../src/PosInterface.js'

// HTTP is replaced by a fake fetch.

const API_URL = 'https://boatest.kuveytturk.com.tr/boa.virtualpos.services/Home'

type Sent = { url: string; init: RequestInit }

function fakeFetch(
  sent: Sent[],
  body: string | Uint8Array,
  status = 200,
  headers?: Record<string, string>,
): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(status === 204 ? null : (body as never), { status, ...(headers ? { headers } : {}) })
  }) as unknown as typeof fetch
}

function createClient(fetchImpl: typeof fetch, logger?: PosLogger): KuveytPosHttpClient {
  return new KuveytPosHttpClient(API_URL, new HttpTransport({ fetch: fetchImpl }), logger)
}

const bodyOf = (sent: Sent | undefined): Buffer => Buffer.from(sent?.init.body as Uint8Array)
const latin1 = (sent: Sent | undefined): string => bodyOf(sent).toString('latin1')

describe('KuveytPosHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it('supports', () => {
    expect(KuveytPosHttpClient.supports('AkbankPos', 'payment_api')).toBe(false)
    expect(KuveytPosHttpClient.supports('KuveytPos', 'query_api')).toBe(false)
    expect(KuveytPosHttpClient.supports('KuveytPos', 'gateway_3d')).toBe(true)
    expect(KuveytPosHttpClient.supports('KuveytPos', 'payment_api')).toBe(true)
  })

  it.each([
    ['pay_auth_3d_secure', TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, true],
    ['3d_form_build_3d_secure', TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_SECURE, true],
    ['pay_pre_auth_3d_secure', TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_SECURE, false],
    ['pay_auth_non_secure', TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, true],
  ] as Array<[string, TxType, PaymentModel, boolean]>)('supportsTx %s', (_n, txType, model, expected) => {
    expect(client.supportsTx(txType, model)).toBe(expected)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, `${API_URL}/ThreeDModelProvisionGate`],
    [TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, `${API_URL}/Non3DPayGate`],
    [TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_SECURE, `${API_URL}/ThreeDModelPayGate`],
  ] as Array<[TxType, PaymentModel, string]>)('getApiUrl(%s, %s)', (txType, model, expected) => {
    expect(client.getApiUrl(txType, model)).toBe(expected)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY],
    [TX_TYPE.PAY_PRE_AUTH, MODEL.NON_SECURE],
    // deviation: B14, a missing value is an unsupported transaction, not an InvalidArgumentException
    [null, null],
    [TX_TYPE.PAY_AUTH, null],
    [null, MODEL.THREE_D_PAY],
    // addition: B14, inherited object members are not routes
    ['constructor', MODEL.THREE_D_SECURE],
    [TX_TYPE.PAY_AUTH, 'constructor'],
  ])('getApiUrl(%s, %s) fails', (txType, model) => {
    expect(() => client.getApiUrl(txType as never, model as never)).toThrow(UnsupportedTransactionTypeError)
  })

  it('request for the 3D form build returns the page untouched', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '<html>3d-form</html>'))
    const apiUrl = `${API_URL}/ThreeDModelPayGate`
    const actual = await c.request(
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      MODEL.THREE_D_SECURE,
      { 'request-data': 'x' }, // deviation: a list input is not a request shape
      { id: '123' },
      apiUrl,
    )

    // deviation: the TS client returns a record
    expect(actual).toStrictEqual({ html: '<html>3d-form</html>' })
    const [request] = sent as [Sent]
    expect(request.url).toBe(apiUrl)
    expect(request.init.method).toBe('POST')
    expect(latin1(request)).toBe(
      '<?xml version="1.0" encoding="ISO-8859-1"?>\n<KuveytTurkVPosMessage><request-data>x</request-data></KuveytTurkVPosMessage>\n',
    )
    expect(new Headers(request.init.headers).get('Content-Type')).toBe('text/xml; charset=UTF-8')
  })

  it('request', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '<response><result>success</result></response>'))
    const actual = await c.request(
      TX_TYPE.PAY_AUTH,
      MODEL.THREE_D_SECURE,
      { 'request-data': 'x' },
      { id: '123' },
      `${API_URL}/ThreeDModelProvisionGate`,
    )

    expect(actual).toStrictEqual({ result: 'success' })
    expect(sent[0]?.url).toBe(`${API_URL}/ThreeDModelProvisionGate`)
    expect(latin1(sent[0])).toBe(
      '<?xml version="1.0" encoding="ISO-8859-1"?>\n<KuveytTurkVPosMessage><request-data>x</request-data></KuveytTurkVPosMessage>\n',
    )
  })

  it('request undecodable response', async () => {
    const c = createClient(fakeFetch([], 'not-valid-xml', 400))
    // deviation: B14, a non-2xx answer is a PosHttpError
    await expect(
      c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' }),
    ).rejects.toThrow(PosHttpError)
  })

  it('request bad request', async () => {
    const c = createClient(fakeFetch([], 'response-content', 500))
    // deviation: B14, a non-2xx answer is a PosHttpError with the status
    await expect(
      c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' }),
    ).rejects.toMatchObject({ name: 'PosHttpError', status: 500 })
  })

  it('request api url not found', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, ''))
    await expect(
      c.request(TX_TYPE.PAY_POST_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'x' }, { id: '123' }),
    ).rejects.toThrow(UnsupportedTransactionTypeError)
    expect(sent).toHaveLength(0)
  })

  // addition: B18, Latin-1 letters are single bytes, other letters numeric references
  it('posts the request as ISO-8859-1 bytes', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '<r><a>1</a></r>'))
    await c.request(
      TX_TYPE.PAY_AUTH,
      MODEL.THREE_D_SECURE,
      { CardHolderData: { BillAddrCity: 'İstanbul', Name: 'Ömer Çelik ş' } },
      { id: '1' },
    )

    const bytes = bodyOf(sent[0])
    expect(bytes.includes(0xd6)).toBe(true)
    expect(bytes.includes(0xc7)).toBe(true)
    expect(latin1(sent[0])).toBe(
      '<?xml version="1.0" encoding="ISO-8859-1"?>\n<KuveytTurkVPosMessage><CardHolderData><BillAddrCity>&#x130;stanbul</BillAddrCity><Name>\xd6mer \xc7elik &#x15F;</Name></CardHolderData></KuveytTurkVPosMessage>\n',
    )
  })

  // addition: B14, a bank page that is not XML is an HTTP-level failure
  it.each([
    ['an HTML WAF page', '<!DOCTYPE html><html><body>Request blocked</body></html>'],
    ['an empty body', ''],
    ['plain text', 'Service Unavailable'],
  ])('rejects %s answered with 200', async (_n, body) => {
    const c = createClient(fakeFetch([], body))
    await expect(c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, { id: '1' })).rejects.toThrow(PosHttpError)
  })

  // addition: the bank's Turkish answer in a declared charset is read correctly
  it('decodes an answer in the charset it declares', async () => {
    const xml = Buffer.concat([
      Buffer.from('<?xml version="1.0" encoding="ISO-8859-9"?><r><m>'),
      Buffer.from([0xde, 0x69, 0x66, 0x72, 0x65]),
      Buffer.from('</m></r>'),
    ])
    const c = createClient(fakeFetch([], new Uint8Array(xml)))
    expect(await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, { id: '1' })).toStrictEqual({ m: 'Şifre' })
  })

  // addition: 204 is an empty answer, a redirect is refused
  it('answers 204 with an empty record', async () => {
    const c = createClient(fakeFetch([], '', 204))
    expect(await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, { id: '1' })).toStrictEqual({})
  })

  it('does not follow a redirect', async () => {
    const c = createClient(fakeFetch([], '', 302, { Location: 'https://evil.example/' }))
    await expect(c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, { id: '1' })).rejects.toThrow(PosHttpError)
  })

  // addition: secrets never reach the logger, neither from the request nor from an echoed answer
  it('never logs card data, hashes or bodies', async () => {
    const logged: string[] = []
    const record = (m: string, c: unknown): number => logged.push(JSON.stringify([m, c]))
    const logger: PosLogger = { debug: record, info: record, warn: record, error: record }
    const echo =
      '<VPosMessage><CardNumber>4111111111111111</CardNumber><CardCVV2>987</CardCVV2><HashPassword>SECRET-HP=</HashPassword><HashData>SECRET-HD=</HashData></VPosMessage>'
    const request = {
      CardNumber: '4111111111111111',
      CardCVV2: '987',
      HashPassword: 'SECRET-HP=',
      HashData: 'SECRET-HD=',
    }
    for (const [body, status] of [
      [echo, 500],
      ['<html><HashData>SECRET-HD=</HashData></html>', 200],
      [echo, 200],
    ] as Array<[string, number]>) {
      const c = createClient(fakeFetch([], body, status), logger)
      await c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, request, { id: '1' }).catch(() => {})
    }

    expect(logged.length).toBeGreaterThan(0)
    const all = logged.join('\n')
    for (const secret of ['4111111111111111', '987', 'SECRET-HP', 'SECRET-HD', 'KuveytTurkVPosMessage']) {
      expect(all).not.toContain(secret)
    }
  })
})
