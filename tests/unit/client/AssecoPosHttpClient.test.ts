import iconv from 'iconv-lite'
import { describe, expect, it, vi } from 'vitest'
import { AssecoPosHttpClient } from '../../../src/client/AssecoPosHttpClient.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PosHttpError } from '../../../src/errors.js'
import type { PosLogger } from '../../../src/logger.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../src/PosInterface.js'

// HTTP is replaced by a fake fetch.

const API_URL = 'https://entegrasyon.asseco-see.com.tr/fim/api'

type Sent = { url: string; init: RequestInit }

function fakeFetch(sent: Sent[], body: string | Uint8Array, status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(body as ConstructorParameters<typeof Response>[0], { status })
  }) as unknown as typeof fetch
}

function createClient(fetchImpl: typeof fetch, logger?: PosLogger): AssecoPosHttpClient {
  return new AssecoPosHttpClient(API_URL, new HttpTransport({ fetch: fetchImpl }), logger)
}

/** The request body as the bank receives it, decoded with the encoding the XML declaration announces. */
function sentBody(sent: Sent): string {
  const body = sent.init.body
  expect(body).toBeInstanceOf(Uint8Array)
  return iconv.decode(Buffer.from(body as Uint8Array), 'ISO-8859-9')
}

describe('AssecoPosHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, API_URL],
    [TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, API_URL],
    [TX_TYPE.REFUND, MODEL.NON_SECURE, API_URL],
    [TX_TYPE.REFUND_PARTIAL, MODEL.NON_SECURE, API_URL],
    ['history' as TxType, MODEL.NON_SECURE, API_URL], // PosQueryInterface::QUERY_TYPE_HISTORY
  ] as Array<[TxType, PaymentModel, string]>)('getApiUrl(%s, %s)', (txType, paymentModel, expected) => {
    expect(client.getApiUrl(txType, paymentModel)).toBe(expected)
  })

  it('supports', () => {
    expect(AssecoPosHttpClient.supports('AkbankPos', AssecoPosHttpClient.API_NAME_PAYMENT_API)).toBe(false)
    expect(AssecoPosHttpClient.supports('AssecoPos', AssecoPosHttpClient.API_NAME_PAYMENT_API)).toBe(true)
    expect(AssecoPosHttpClient.supports('AssecoPos', 'query_api')).toBe(false)
  })

  it('supportsTx', () => {
    expect(client.supportsTx(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE)).toBe(true)
  })

  it('request', async () => {
    const sent: Sent[] = []
    const responseContent = `<?xml version="1.0" encoding="ISO-8859-9"?>
<CC5Response>
  <OrderId>20230910AF6A</OrderId>
  <GroupId>20230910AF6A</GroupId>
  <Response>Approved</Response>
  <AuthCode>P18552</AuthCode>
  <HostRefNum>325300733333</HostRefNum>
  <ProcReturnCode>00</ProcReturnCode>
  <TransId>23253WkfD10806</TransId>
  <ErrMsg></ErrMsg>
  <Extra>
    <SETTLEID>2589</SETTLEID>
    <TRXDATE>20230910 22:36:30</TRXDATE>
    <ERRORCODE></ERRORCODE>
    <TERMINALID>00655020</TERMINALID>
    <MERCHANTID>655000200</MERCHANTID>
    <CARDBRAND>VISA</CARDBRAND>
    <CARDISSUER>Z&#x130;RAAT BANKASI</CARDISSUER>
    <AVSAPPROVE>Y</AVSAPPROVE>
    <HOSTDATE>0910-223632</HOSTDATE>
    <AVSERRORCODEDETAIL>avshatali-avshatali-avshatali-avshatali-</AVSERRORCODEDETAIL>
    <NUMCODE>00</NUMCODE>
  </Extra>
</CC5Response>`
    const c = createClient(fakeFetch(sent, responseContent))

    const actual = await c.request(
      TX_TYPE.PAY_AUTH,
      MODEL.THREE_D_SECURE,
      { Name: 'ISBANKAPI', Password: 'ISBANK07', ClientId: '700655000200' },
      { id: '123' },
      API_URL,
    )

    expect(actual).toStrictEqual({
      OrderId: '20230910AF6A',
      GroupId: '20230910AF6A',
      Response: 'Approved',
      AuthCode: 'P18552',
      HostRefNum: '325300733333',
      ProcReturnCode: '00',
      TransId: '23253WkfD10806',
      ErrMsg: '',
      Extra: {
        SETTLEID: '2589',
        TRXDATE: '20230910 22:36:30',
        ERRORCODE: '',
        TERMINALID: '00655020',
        MERCHANTID: '655000200',
        CARDBRAND: 'VISA',
        CARDISSUER: 'ZİRAAT BANKASI',
        AVSAPPROVE: 'Y',
        HOSTDATE: '0910-223632',
        AVSERRORCODEDETAIL: 'avshatali-avshatali-avshatali-avshatali-',
        NUMCODE: '00',
      },
    })
    expect(sent).toHaveLength(1)
    const [request] = sent as [Sent]
    expect(request.url).toBe(API_URL)
    expect(request.init.method).toBe('POST')
    expect(sentBody(request)).toBe(
      '<?xml version="1.0" encoding="ISO-8859-9"?>\n' +
        '<CC5Request><Name>ISBANKAPI</Name><Password>ISBANK07</Password><ClientId>700655000200</ClientId></CC5Request>\n',
    )
  })

  it('request undecodable response', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, 'not-valid-xml', 400))
    await expect(
      c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' }),
    ).rejects.toThrow(PosHttpError)
    expect(sentBody(sent[0] as Sent)).toBe(
      '<?xml version="1.0" encoding="ISO-8859-9"?>\n<CC5Request><request-data>abc</request-data></CC5Request>\n',
    )
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
    const c = createClient(fakeFetch([], 'response-content', 500))
    const err = await c
      .request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).status).toBe(500)
  })

  it('sends ISO-8859-9 bytes and no Content-Type header', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '<CC5Response><ProcReturnCode>00</ProcReturnCode></CC5Response>'))
    await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { Name: 'İşbank Ödeme ĞÜŞ çı' }, { id: '1' })

    const [request] = sent as [Sent]
    const bytes = Buffer.from(request.init.body as Uint8Array)
    // İ = 0xDD, ş = 0xFE, Ö = 0xD6, Ğ = 0xD0, Ü = 0xDC, Ş = 0xDE, ç = 0xE7, ı = 0xFD in ISO-8859-9
    expect(bytes.includes(Buffer.from([0xdd, 0xfe]))).toBe(true)
    expect(bytes.includes(Buffer.from('İ', 'utf8'))).toBe(false)
    expect(sentBody(request)).toContain('<Name>İşbank Ödeme ĞÜŞ çı</Name>')
    expect(new Headers(request.init.headers).get('Content-Type')).toBeNull()
  })

  it('sends characters ISO-8859-9 cannot represent as character references (like libxml)', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '<CC5Response><ProcReturnCode>00</ProcReturnCode></CC5Response>'))
    await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { Name: 'Ýý € 😀 İ', Note: 'a & € b' }, { id: '1' })

    expect(sentBody(sent[0] as Sent)).toBe(
      '<?xml version="1.0" encoding="ISO-8859-9"?>\n' +
        '<CC5Request><Name>&#xDD;&#xFD; &#x20AC; &#x1F600; İ</Name>' +
        '<Note><![CDATA[a & ]]>&#x20AC;<![CDATA[ b]]></Note></CC5Request>\n',
    )
  })

  it('decodes a raw ISO-8859-9 response body as declared', async () => {
    const xml =
      '<?xml version="1.0" encoding="ISO-8859-9"?><CC5Response><ErrMsg>İşlem onaylanmadı ĞÜŞ</ErrMsg></CC5Response>'
    const c = createClient(fakeFetch([], new Uint8Array(iconv.encode(xml, 'ISO-8859-9'))))
    const actual = await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, {}, { id: '1' })
    expect(actual).toStrictEqual({ ErrMsg: 'İşlem onaylanmadı ĞÜŞ' })
  })

  it('decodes a response without an encoding declaration as UTF-8', async () => {
    const c = createClient(fakeFetch([], '<CC5Response><ErrMsg>İşlem</ErrMsg></CC5Response>'))
    const actual = await c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, {}, { id: '1' })
    expect(actual).toStrictEqual({ ErrMsg: 'İşlem' })
  })

  it('masks credentials in logs', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const c = createClient(fakeFetch([], '<html><body>blocked ISBANK07</body></html>', 200), logger)
    await expect(
      c.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { Password: 'ISBANK07', Number: '4355084355084358' }, { id: '1' }),
    ).rejects.toThrow(PosHttpError)
    expect(JSON.stringify([logger.debug.mock.calls, logger.error.mock.calls])).not.toContain('4355084355084358')
  })
})
