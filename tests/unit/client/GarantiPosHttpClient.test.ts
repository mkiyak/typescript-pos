import { describe, expect, it } from 'vitest'
import { GarantiPosHttpClient } from '../../../src/client/GarantiPosHttpClient.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PosError, PosHttpError } from '../../../src/errors.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../src/pos-query/PosQueryInterface.js'

// HTTP is replaced by a fake fetch.

const API_URL = 'https://sanalposprovtest.garantibbva.com.tr/VPServlet'

type Sent = { url: string; init: RequestInit }

function fakeFetch(sent: Sent[], body: string, status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(body, { status })
  }) as unknown as typeof fetch
}

function createClient(fetchImpl: typeof fetch): GarantiPosHttpClient {
  return new GarantiPosHttpClient(API_URL, new HttpTransport({ fetch: fetchImpl }))
}

describe('GarantiPosHttpClient', () => {
  const client = createClient(fakeFetch([], ''))

  it('supports', () => {
    expect(GarantiPosHttpClient.supports('AkbankPos', GarantiPosHttpClient.API_NAME_PAYMENT_API)).toBe(false)
    expect(GarantiPosHttpClient.supports('GarantiPos', GarantiPosHttpClient.API_NAME_PAYMENT_API)).toBe(true)
  })

  it('supportsTx', () => {
    expect(client.supportsTx(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE)).toBe(true)
  })

  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, API_URL],
    [TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, API_URL],
    [TX_TYPE.REFUND, MODEL.NON_SECURE, API_URL],
    [TX_TYPE.REFUND_PARTIAL, MODEL.NON_SECURE, API_URL],
    [QUERY_TYPE.HISTORY as TxType, MODEL.NON_SECURE, API_URL],
  ] as Array<[TxType, PaymentModel, string]>)('getApiUrl(%s, %s)', (txType, paymentModel, expected) => {
    expect(client.getApiUrl(txType, paymentModel)).toBe(expected)
  })

  it('request', async () => {
    const sent: Sent[] = []
    const responseContent = `<?xml version="1.0" encoding="UTF-8"?>
<GVPSRequest><Mode>TEST</Mode><Version>v0.01</Version><Terminal><ProvUserID>PROVAUT</ProvUserID><UserID>PROVAUT</UserID><HashData>8DD74209DEEB7D333105E1C69998A827419A3B04</HashData><ID>30691298</ID><MerchantID>7000679</MerchantID></Terminal><Customer><IPAddress>127.15.15.1</IPAddress><EmailAddress>email@example.com</EmailAddress></Customer><Order><OrderID>2020110828BC</OrderID></Order><Transaction><Type>orderinq</Type><InstallmentCnt></InstallmentCnt><Amount>100</Amount><CurrencyCode>949</CurrencyCode><CardholderPresentCode>0</CardholderPresentCode><MotoInd>N</MotoInd></Transaction></GVPSRequest>
`
    const c = createClient(fakeFetch(sent, responseContent))

    const actual = await c.request(
      TX_TYPE.PAY_AUTH,
      MODEL.THREE_D_SECURE,
      {
        Mode: 'TEST',
        Version: 'v0.01',
        Transaction: {
          Type: 'sales',
          InstallmentCnt: '',
          Amount: 10025,
          CurrencyCode: '949',
          CardholderPresentCode: '0',
          MotoInd: 'N',
        },
      },
      { id: '123' },
      API_URL,
    )

    expect(actual).toStrictEqual({
      Mode: 'TEST',
      Version: 'v0.01',
      Terminal: {
        ProvUserID: 'PROVAUT',
        UserID: 'PROVAUT',
        HashData: '8DD74209DEEB7D333105E1C69998A827419A3B04',
        ID: '30691298',
        MerchantID: '7000679',
      },
      Customer: {
        IPAddress: '127.15.15.1',
        EmailAddress: 'email@example.com',
      },
      Order: {
        OrderID: '2020110828BC',
      },
      Transaction: {
        Type: 'orderinq',
        InstallmentCnt: '',
        Amount: '100',
        CurrencyCode: '949',
        CardholderPresentCode: '0',
        MotoInd: 'N',
      },
    })
    expect(sent).toHaveLength(1)
    const [request] = sent as [Sent]
    expect(request.url).toBe(API_URL)
    expect(request.init.method).toBe('POST')
    // deviation: G18 empty elements are encoded self-closing (XML-equivalent to an empty start/end tag pair)
    expect(request.init.body).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<GVPSRequest><Mode>TEST</Mode><Version>v0.01</Version><Transaction><Type>sales</Type><InstallmentCnt/>' +
        '<Amount>10025</Amount><CurrencyCode>949</CurrencyCode><CardholderPresentCode>0</CardholderPresentCode>' +
        '<MotoInd>N</MotoInd></Transaction></GVPSRequest>\n',
    )
  })

  it('request undecodable response', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, 'not-valid-xml', 400))
    // deviation: G16 a non-2xx answer is a PosHttpError
    await expect(
      c.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: 123 as unknown as string }),
    ).rejects.toThrow(PosHttpError)
    expect(sent[0]?.init.body).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<GVPSRequest><request-data>abc</request-data></GVPSRequest>\n',
    )
  })

  it('request bad request', async () => {
    const c = createClient(fakeFetch([], 'response-content', 500))
    // deviation: G16 a non-2xx answer is a PosHttpError instead of a runtime error with a fixed message
    const err = await c
      .request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).status).toBe(500)
  })

  // addition: an undecodable 2xx body rejects instead of resolving a half-parsed response
  it('request undecodable 200 response', async () => {
    const c = createClient(fakeFetch([], 'not-valid-xml', 200))
    const err = await c
      .request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: '123' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
  })

  // addition: a bank/WAF HTML page answered with 200 rejects with a PosError
  it('request HTML page with status 200', async () => {
    const c = createClient(fakeFetch([], '<html><body>Request Rejected</body></html>', 200))
    const err = await c
      .request(TX_TYPE.STATUS, MODEL.NON_SECURE, { 'request-data': 'abc' }, { id: '123' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
  })

  // addition: XML is posted with the default XML content type
  it('sends a UTF-8 XML content type', async () => {
    const sent: Sent[] = []
    const c = createClient(fakeFetch(sent, '<GVPSResponse><Mode></Mode></GVPSResponse>'))
    await c.request(TX_TYPE.STATUS, MODEL.NON_SECURE, { Mode: 'TEST' }, { id: '1' })
    expect(new Headers(sent[0]?.init.headers).get('Content-Type')).toBe('text/xml; charset=UTF-8')
  })
})

// addition: the same client serves the query API (BIN list, history, custom queries)
describe('GarantiPosHttpClient query support', () => {
  it('supportsTx(bin_list, regular) is true', () => {
    expect(createClient(fakeFetch([], '')).supportsTx(QUERY_TYPE.BIN_LIST, MODEL.NON_SECURE)).toBe(true)
  })

  it('supports only the payment API', () => {
    expect(GarantiPosHttpClient.supports('GarantiPos', 'query_api')).toBe(false)
  })
})
