import iconv from 'iconv-lite'
import { describe, expect, it } from 'vitest'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PosNetPosHttpClient } from '../../../src/client/PosNetPosHttpClient.js'
import { PosError, PosHttpError } from '../../../src/errors.js'
import type { PosLogger } from '../../../src/logger.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../src/PosInterface.js'

// HTTP is replaced by a fake fetch.

const API_URL = 'https://setmpos.ykb.com/PosnetWebService/XML'

const ENCODED_REQUEST =
  'xmldata=<?xml version="1.0" encoding="ISO-8859-9"?>\n' +
  '<posnetRequest><request-data>abc</request-data></posnetRequest>\n'

const REJECTED = 'PosNet request values must not contain "&", "%" or characters outside ISO-8859-9'

type Sent = { url: string; init: RequestInit }

function fakeFetch(sent: Sent[], body: string | Uint8Array, status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(body as ConstructorParameters<typeof Response>[0], { status })
  }) as unknown as typeof fetch
}

function createClient(fetchImpl: typeof fetch, logger?: PosLogger): PosNetPosHttpClient {
  return new PosNetPosHttpClient(API_URL, new HttpTransport({ fetch: fetchImpl }), logger)
}

function sentBytes(sent: Sent): Uint8Array {
  const body = sent.init.body
  expect(body).toBeInstanceOf(Uint8Array)
  return body as Uint8Array
}

/** The request body as the bank reads it: ISO-8859-9 bytes. */
function sentBody(sent: Sent): string {
  return iconv.decode(Buffer.from(sentBytes(sent)), 'ISO-8859-9')
}

function recordingLogger(): { logger: PosLogger; records: unknown[] } {
  const records: unknown[] = []
  const record =
    (level: string) =>
    (...args: unknown[]) =>
      records.push([level, ...args])
  return {
    records,
    logger: { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') },
  }
}

describe('PosNetPosHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, API_URL],
    [TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, API_URL],
    [TX_TYPE.REFUND, MODEL.NON_SECURE, API_URL],
    [TX_TYPE.STATUS, MODEL.NON_SECURE, API_URL],
  ] as Array<[TxType, PaymentModel, string]>)('getApiUrl(%s, %s)', (txType, paymentModel, expected) => {
    expect(client.getApiUrl(txType, paymentModel)).toBe(expected)
  })

  it('supports', () => {
    expect(PosNetPosHttpClient.supports('PosNetPos', PosNetPosHttpClient.API_NAME_PAYMENT_API)).toBe(true)
    expect(PosNetPosHttpClient.supports('AkbankPos', PosNetPosHttpClient.API_NAME_PAYMENT_API)).toBe(false)
  })

  it('supportsTx', () => {
    expect(client.supportsTx(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE)).toBe(true)
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
    expect(request.init.headers).toStrictEqual({ 'Content-Type': 'application/x-www-form-urlencoded' })
    expect(sentBody(request)).toBe(ENCODED_REQUEST)
  })

  it('request bad request', async () => {
    // deviation: P28 a non-2xx answer is a PosHttpError carrying the status
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, 'response-content', 500))
    const err = await c
      .request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).status).toBe(500)
    expect(sentBody(sent[0] as Sent)).toBe(ENCODED_REQUEST)
  })

  it('request undecodable response', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, 'not-valid-xml', 400))
    await expect(
      c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' }),
    ).rejects.toThrow(PosHttpError)
    expect(sentBody(sent[0] as Sent)).toBe(ENCODED_REQUEST)
  })

  describe('raw form body', () => {
    // addition: P11 the bank reads the body raw, so "&" would end the xmldata field
    it('rejects "&" in a value before sending', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '<r/>'))
      await expect(
        c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { oosRequestData: { cardHolderName: 'Ali & Veli' } }, {}),
      ).rejects.toThrow(new PosError(REJECTED))
      expect(sent).toHaveLength(0)
    })

    // addition: P11 "%" could be read as an escape by a decoding reader
    it('rejects "%" in a value before sending', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '<r/>'))
      await expect(
        c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { oosRequestData: { cardHolderName: '%41' } }, {}),
      ).rejects.toThrow(new PosError(REJECTED))
      expect(sent).toHaveLength(0)
    })

    // addition: P11 a character reference for "€" would itself insert "&"
    it('rejects characters outside ISO-8859-9 before sending', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '<r/>'))
      await expect(
        c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { oosRequestData: { cardHolderName: 'Ali €' } }, {}),
      ).rejects.toThrow(new PosError(REJECTED))
      expect(sent).toHaveLength(0)
    })

    // addition: P11 values wrapped in CDATA by the encoder ("<" or ">") are still checked for "&"
    it('rejects "&" next to "<" (CDATA) before sending', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '<r/>'))
      await expect(
        c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { oosRequestData: { cardHolderName: '<A&B>' } }, {}),
      ).rejects.toThrow(new PosError(REJECTED))
      expect(sent).toHaveLength(0)
    })

    // addition: P11 Turkish letters are sent as ISO-8859-9 bytes, never as character references
    it('sends Turkish letters as ISO-8859-9 bytes', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '<r/>'))
      await c.request(
        TX_TYPE.PAY_AUTH,
        MODEL.THREE_D_SECURE,
        { oosRequestData: { cardHolderName: 'Çağrı Öztürk' } },
        {},
      )

      const bytes = Buffer.from(sentBytes(sent[0] as Sent))
      expect(bytes.includes(Buffer.from([0xc7, 0x61, 0xf0, 0x72, 0xfd]))).toBe(true)
      expect(bytes.includes(Buffer.from('&#x'))).toBe(false)
      expect(sentBody(sent[0] as Sent)).toContain('<cardHolderName>Çağrı Öztürk</cardHolderName>')
    })

    // addition: P11 base64 MACs are sent raw ("+" and "/" are not form-encoded)
    it('sends a base64 value with "+" and "/" raw', async () => {
      const sent: Sent[] = []
      const c = createClient(fakeFetch(sent, '<r/>'))
      const mac = 'JA8+68g04zptKLqLYwOOnK/doN2YRLDqaohzBNJ956Y='
      await c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { oosResolveMerchantData: { mac } }, {})

      expect(sentBody(sent[0] as Sent)).toBe(
        'xmldata=<?xml version="1.0" encoding="ISO-8859-9"?>\n' +
          `<posnetRequest><oosResolveMerchantData><mac>${mac}</mac></oosResolveMerchantData></posnetRequest>\n`,
      )
    })
  })

  describe('responses', () => {
    // addition: a WAF page answered with HTTP 200 is not parsed as a bank answer
    it('rejects an HTML page (HTTP 200) with PosHttpError', async () => {
      const c = createClient(fakeFetch([], '<html><body>Request Rejected</body></html>'))
      const err = await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 'b' }, {}).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PosHttpError)
      expect((err as PosHttpError).url).toBe(API_URL)
    })

    // addition: the bank answers in ISO-8859-9; the declaration decides the charset
    it('decodes an ISO-8859-9 response by its declaration', async () => {
      const body = iconv.encode(
        '<?xml version="1.0" encoding="ISO-8859-9"?><posnetResponse><approved>0</approved><respText>Hatalı</respText></posnetResponse>',
        'ISO-8859-9',
      )
      const c = createClient(fakeFetch([], new Uint8Array(body)))
      const actual = await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: 'b' }, {})
      expect(actual).toStrictEqual({ approved: '0', respText: 'Hatalı' })
    })
  })

  describe('masking', () => {
    const cardRequest = {
      mid: '6706598320',
      tid: '67005551',
      sale: { orderID: '00000000000000000001', ccno: '5555444433332222', expDate: '2201', cvc: '987' },
      oosResolveMerchantData: { mac: 'oE7zwV87uOc2DFpGPlr4jQRQ0z9LsxGw56c7vaiZkTo=' },
    }

    // addition: card data never reaches the logger
    it('never logs the card number or the CVC of a request', async () => {
      const { logger, records } = recordingLogger()
      const c = createClient(fakeFetch([], '<posnetResponse><approved>1</approved></posnetResponse>'), logger)
      await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, cardRequest, { id: '1' })

      const logged = JSON.stringify(records)
      expect(records.length).toBeGreaterThan(0)
      expect(logged).not.toContain('5555444433332222')
      expect(logged).not.toContain('987')
      expect(logged).not.toContain('oE7zwV87uOc2DFpGPlr4jQRQ0z9LsxGw56c7vaiZkTo=')
    })

    // addition: an error page that echoes the raw request body leaks nothing through logs or the error snippet
    it('masks an error page that echoes the request body', async () => {
      const { logger, records } = recordingLogger()
      const sent: Sent[] = []
      const echo = (async (url: unknown, init?: RequestInit) => {
        sent.push({ url: String(url), init: init ?? {} })
        const raw = iconv.decode(Buffer.from(init?.body as Uint8Array), 'ISO-8859-9')
        return new Response(`Bad request: ${raw}`, { status: 500 })
      }) as unknown as typeof fetch
      const c = createClient(echo, logger)

      const err = await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, cardRequest, { id: '1' }).catch((e: unknown) => e)

      expect(err).toBeInstanceOf(PosHttpError)
      const snippet = (err as PosHttpError).bodySnippet ?? ''
      expect(snippet).toContain('Bad request')
      for (const leaked of [snippet, JSON.stringify(records)]) {
        expect(leaked).not.toContain('5555444433332222')
        expect(leaked).not.toContain('>987<')
        expect(leaked).not.toContain('>2201<')
        expect(leaked).not.toContain('oE7zwV87uOc2DFpGPlr4jQRQ0z9LsxGw56c7vaiZkTo=')
      }
    })
  })
})
