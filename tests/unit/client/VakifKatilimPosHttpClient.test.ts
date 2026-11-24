import { describe, expect, it } from 'vitest'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { VakifKatilimPosHttpClient } from '../../../src/client/VakifKatilimPosHttpClient.js'
import { PosError, PosHttpError, UnsupportedTransactionTypeError } from '../../../src/errors.js'
import type { PosLogger } from '../../../src/logger.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../src/PosInterface.js'

// HTTP is replaced by a fake fetch.

const API_URL = 'https://boa.vakifkatilim.com.tr/VirtualPOS.Gateway/Home'

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

function createClient(fetchImpl: typeof fetch, logger?: PosLogger): VakifKatilimPosHttpClient {
  return new VakifKatilimPosHttpClient(API_URL, new HttpTransport({ fetch: fetchImpl }), logger)
}

const bodyOf = (sent: Sent | undefined): Buffer => Buffer.from(sent?.init.body as Uint8Array)
const latin1 = (sent: Sent | undefined): string => bodyOf(sent).toString('latin1')
const xmlOf = (inner: string): string =>
  `<?xml version="1.0" encoding="ISO-8859-1"?>\n<VPosMessageContract>${inner}</VPosMessageContract>\n`

describe('VakifKatilimPosHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it('supports', () => {
    expect(VakifKatilimPosHttpClient.supports('VakifKatilimPos', 'payment_api')).toBe(true)
    expect(VakifKatilimPosHttpClient.supports('VakifKatilimPos', 'gateway_3d')).toBe(true)
    expect(VakifKatilimPosHttpClient.supports('AkbankPos', 'payment_api')).toBe(false)
    // addition: another gateway of the same family and an api the bank has no client for
    expect(VakifKatilimPosHttpClient.supports('KuveytPos', 'payment_api')).toBe(false)
    expect(VakifKatilimPosHttpClient.supports('VakifKatilimPos', 'query_api')).toBe(false)
  })

  it.each([
    ['pay_auth_3d_secure', TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, true],
    ['3d_form_build_3d_secure', TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.THREE_D_SECURE, true],
    ['unsupported', 'unsupported', MODEL.THREE_D_SECURE, false],
  ] as Array<[string, TxType, PaymentModel, boolean]>)('supportsTx %s', (_n, txType, model, expected) => {
    expect(client.supportsTx(txType, model)).toBe(expected)
  })

  it.each([
    [TX_TYPE.INTERNAL_3D_FORM_BUILD, TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, `${API_URL}/ThreeDModelPayGate`],
    [TX_TYPE.PAY_AUTH, null, MODEL.THREE_D_SECURE, `${API_URL}/ThreeDModelProvisionGate`],
    [TX_TYPE.PAY_PRE_AUTH, null, MODEL.NON_SECURE, `${API_URL}/PreAuthorizaten`],
    [TX_TYPE.PAY_AUTH, null, MODEL.NON_SECURE, `${API_URL}/Non3DPayGate`],
    [TX_TYPE.PAY_POST_AUTH, null, MODEL.NON_SECURE, `${API_URL}/PreAuthorizatenClose`],
    [TX_TYPE.STATUS, null, MODEL.NON_SECURE, `${API_URL}/SelectOrderByMerchantOrderId`],
    [TX_TYPE.ORDER_HISTORY, null, MODEL.NON_SECURE, `${API_URL}/SelectOrder`],
    [TX_TYPE.CANCEL, TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, `${API_URL}/SaleReversal`],
    [TX_TYPE.REFUND, TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, `${API_URL}/DrawBack`],
    [TX_TYPE.REFUND_PARTIAL, TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, `${API_URL}/PartialDrawBack`],
    [TX_TYPE.CANCEL, TX_TYPE.PAY_PRE_AUTH, MODEL.NON_SECURE, `${API_URL}/PreAuthorizationReversal`],
    [TX_TYPE.REFUND, TX_TYPE.PAY_PRE_AUTH, MODEL.NON_SECURE, `${API_URL}/PreAuthorizationDrawBack`],
  ] as Array<[TxType, TxType | null, PaymentModel, string]>)(
    'getApiUrl(%s, %s, %s)',
    (txType, orderTxType, model, expected) => {
      expect(client.getApiUrl(txType, model, orderTxType)).toBe(expected)
    },
  )

  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY, null],
    // deviation: B14, a missing value is an unsupported transaction, not an InvalidArgumentException
    [null, null, null],
    [TX_TYPE.PAY_AUTH, null, null],
    [null, MODEL.THREE_D_PAY, null],
    ['abc', MODEL.THREE_D_PAY, null],
    [TX_TYPE.CANCEL, MODEL.NON_SECURE, TX_TYPE.PAY_POST_AUTH],
  ])('getApiUrl(%s, %s, %s) fails', (txType, model, orderTxType) => {
    expect(() => client.getApiUrl(txType as never, model as never, orderTxType as never)).toThrow(
      UnsupportedTransactionTypeError,
    )
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
    expect(latin1(request)).toBe(xmlOf('<request-data>x</request-data>'))
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
    expect(latin1(sent[0])).toBe(xmlOf('<request-data>x</request-data>'))
    expect(new Headers(sent[0]?.init.headers).get('Content-Type')).toBe('text/xml; charset=UTF-8')
  })

  it('request bad request', async () => {
    const c = createClient(fakeFetch([], 'response-content', 500))
    // deviation: B14, a non-2xx answer is a PosHttpError with the status
    await expect(
      c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' }),
    ).rejects.toMatchObject({ name: 'PosHttpError', status: 500 })
  })

  it('request undecodable response', async () => {
    const c = createClient(fakeFetch([], 'not-valid-xml', 400))
    await expect(
      c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' }),
    ).rejects.toThrow(PosHttpError)
  })

  it('request api url not found', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, ''))
    await expect(
      c.request(TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'x' }, { id: '123' }),
    ).rejects.toThrow(UnsupportedTransactionTypeError)
    expect(sent).toHaveLength(0)
  })

  describe('additions', () => {
    const answer = '<r><ok>1</ok></r>'

    // addition: V6, the order's own transaction type picks the reversal path; the base client has no such parameter
    it.each([
      [TX_TYPE.CANCEL, 'pre', 'PreAuthorizationReversal'],
      [TX_TYPE.CANCEL, 'pay', 'SaleReversal'],
      [TX_TYPE.CANCEL, undefined, 'SaleReversal'],
      [TX_TYPE.CANCEL, null, 'SaleReversal'],
      [TX_TYPE.REFUND, 'pre', 'PreAuthorizationDrawBack'],
      [TX_TYPE.REFUND, 'pay', 'DrawBack'],
      [TX_TYPE.REFUND_PARTIAL, undefined, 'PartialDrawBack'],
    ] as Array<[TxType, string | null | undefined, string]>)(
      'request(%s) of an order of type %s posts to %s',
      async (txType, orderTxType, path) => {
        const sent: Sent[] = []
        const c = createClient(fakeFetch(sent, answer))
        await c.request(txType, MODEL.NON_SECURE, { a: 1 }, { id: '1', transaction_type: orderTxType })

        expect(sent.map((s) => s.url)).toStrictEqual([`${API_URL}/${path}`])
      },
    )

    it.each([
      ['post', TX_TYPE.CANCEL],
      ['abc', TX_TYPE.CANCEL],
      ['constructor', TX_TYPE.CANCEL],
      ['__proto__', TX_TYPE.REFUND],
      [5, TX_TYPE.CANCEL],
      [{ toString: () => 'pre' }, TX_TYPE.CANCEL],
      [['pre'], TX_TYPE.CANCEL],
      ['pre', TX_TYPE.REFUND_PARTIAL],
    ])('request of an order of type %j for %s is refused before anything is sent', async (orderTxType, txType) => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, answer))
      await expect(
        c.request(txType as TxType, MODEL.NON_SECURE, { a: 1 }, { id: '1', transaction_type: orderTxType }),
      ).rejects.toThrow(UnsupportedTransactionTypeError)
      expect(sent).toHaveLength(0)
    })

    it('an explicit url wins over the table', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, answer))
      await c.request(
        TX_TYPE.CANCEL,
        MODEL.NON_SECURE,
        { a: 1 },
        { id: '1', transaction_type: 'post' },
        'https://boa.vakifkatilim.com.tr/VirtualPOS.Gateway/Home/SelectOrder',
      )

      expect(sent.map((s) => s.url)).toStrictEqual([
        'https://boa.vakifkatilim.com.tr/VirtualPOS.Gateway/Home/SelectOrder',
      ])
    })

    // addition: V6, history goes to the order list; the custom query has no route of its own
    it('posts a history query to SelectOrder', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, answer))
      await c.request('history', MODEL.NON_SECURE, { a: 1 }, { id: '1' })

      expect(sent.map((s) => s.url)).toStrictEqual([`${API_URL}/SelectOrder`])
      expect(c.supportsTx('history', MODEL.NON_SECURE)).toBe(true)
    })

    it('has no route for a custom query but supports it with an explicit url', async () => {
      expect(client.supportsTx('custom_query', MODEL.NON_SECURE)).toBe(true)
      expect(() => client.getApiUrl('custom_query', MODEL.NON_SECURE)).toThrow(PosError)
      expect(() => client.getApiUrl('custom_query', MODEL.NON_SECURE)).toThrow(/need an apiUrl/)

      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, answer))
      await expect(c.request('custom_query', MODEL.NON_SECURE, { a: 1 }, { id: '1' })).rejects.toThrow(PosError)
      expect(sent).toHaveLength(0)

      await c.request('custom_query', MODEL.NON_SECURE, { a: 1 }, { id: '1' }, `${API_URL}/Anything`)
      expect(sent.map((s) => s.url)).toStrictEqual([`${API_URL}/Anything`])
    })

    it.each([
      ['constructor', MODEL.NON_SECURE],
      ['__proto__', MODEL.NON_SECURE],
      [TX_TYPE.PAY_AUTH, 'constructor'],
      [TX_TYPE.CANCEL, '__proto__'],
    ])('getApiUrl(%s, %s) does not read inherited members', (txType, model) => {
      expect(client.supportsTx(txType as never, model as never)).toBe(false)
      expect(() => client.getApiUrl(txType as never, model as never)).toThrow(UnsupportedTransactionTypeError)
    })

    // addition: B18, Latin-1 letters are single bytes, other letters numeric references
    it('posts the request as ISO-8859-1 bytes', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, answer))
      await c.request(
        TX_TYPE.PAY_AUTH,
        MODEL.NON_SECURE,
        { CardHolderName: 'Şule', City: 'İstanbul', Name: 'Ömer Çelik ş' },
        { id: '1' },
      )

      const bytes = bodyOf(sent[0])
      expect(bytes.includes(0xd6)).toBe(true)
      expect(bytes.includes(0xc7)).toBe(true)
      expect(latin1(sent[0])).toBe(
        xmlOf(
          '<CardHolderName>&#x15E;ule</CardHolderName><City>&#x130;stanbul</City><Name>\xd6mer \xc7elik &#x15F;</Name>',
        ),
      )
    })

    // addition: V5, a bank page that is not XML is an HTTP-level failure
    it.each([
      ['an HTML WAF page', '<!DOCTYPE html><html><body>Request blocked</body></html>'],
      ['an empty body', ''],
      ['plain text', 'Service Unavailable'],
      ['an entity definition', '<!DOCTYPE r [<!ENTITY x "A">]><r><a>&x;</a></r>'],
    ])('rejects %s answered with 200', async (_n, body) => {
      const c = createClient(fakeFetch([], body))
      await expect(c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, { id: '1' })).rejects.toThrow(PosHttpError)
    })

    // addition: V5, the bank announces utf-16 but sends UTF-8: the declaration is not believed
    it('reads an answer that declares utf-16 as the UTF-8 text it is', async () => {
      const xml = Buffer.from('<?xml version="1.0" encoding="utf-16"?><r><m>İşlem onaylandı</m></r>', 'utf8')
      const c = createClient(fakeFetch([], new Uint8Array(xml)))

      expect(await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, { id: '1' })).toStrictEqual({
        m: 'İşlem onaylandı',
      })
    })

    it.each(['UTF-16', 'utf-16', 'Utf-16'])('reads a %s declaration as UTF-8 too', async (declared) => {
      const xml = Buffer.from(`<?xml version="1.0" encoding="${declared}"?><r><m>İşlem</m></r>`, 'utf8')
      const c = createClient(fakeFetch([], new Uint8Array(xml)))

      expect(await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, { id: '1' })).toStrictEqual({ m: 'İşlem' })
    })

    // addition: the bank's Turkish answer in a declared single-byte charset is read correctly
    it('decodes an answer in the charset it declares', async () => {
      const xml = Buffer.concat([
        Buffer.from('<?xml version="1.0" encoding="ISO-8859-9"?><r><m>'),
        Buffer.from([0xde, 0x69, 0x66, 0x72, 0x65]),
        Buffer.from('</m></r>'),
      ])
      const c = createClient(fakeFetch([], new Uint8Array(xml)))

      expect(await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, { id: '1' })).toStrictEqual({ m: 'Şifre' })
    })

    it('removes the null character the bank puts into an answer', async () => {
      const c = createClient(fakeFetch([], '<r><ResponseCode>&#x0;00</ResponseCode></r>'))

      expect(await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 1 }, { id: '1' })).toStrictEqual({
        ResponseCode: '00',
      })
    })

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
        [echo, 400],
        ['<html><HashData>SECRET-HD=</HashData></html>', 200],
        [echo, 200],
      ] as Array<[string, number]>) {
        const c = createClient(fakeFetch([], body, status), logger)
        await c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, request, { id: '1' }).catch(() => {})
      }

      expect(logged.length).toBeGreaterThan(0)
      const all = logged.join('\n')
      for (const secret of ['4111111111111111', '987', 'SECRET-HP', 'SECRET-HD', 'VPosMessageContract']) {
        expect(all).not.toContain(secret)
      }
    })
  })
})
