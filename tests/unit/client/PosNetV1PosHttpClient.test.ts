import { describe, expect, it, vi } from 'vitest'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PosNetV1PosHttpClient } from '../../../src/client/PosNetV1PosHttpClient.js'
import { PosNetV1PosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/PosNetV1PosRequestValueMapper.js'
import type { RequestValueMapperInterface } from '../../../src/data-mapper/request/value-mapper/RequestValueMapperInterface.js'
import { PosError, PosHttpError, UnsupportedTransactionTypeError } from '../../../src/errors.js'
import { noopLogger } from '../../../src/logger.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../src/PosInterface.js'
import { QUERY_TYPE } from '../../../src/pos-query/PosQueryInterface.js'

// HTTP is replaced by a fake fetch; where the value mapper is mocked, `mapTxType` is a vi.fn() stub.

const API_URL = 'https://epostest.albarakaturk.com.tr/ALBMerchantService/MerchantJSONAPI.svc'

type Sent = { url: string; init: RequestInit }

function fakeFetch(sent: Sent[], body: string, status = 200): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(body, { status })
  }) as unknown as typeof fetch
}

function stubMapper(mapTxType: ReturnType<typeof vi.fn>): RequestValueMapperInterface {
  return { mapTxType } as unknown as RequestValueMapperInterface
}

function createClient(
  fetchImpl: typeof fetch,
  mapper: RequestValueMapperInterface = new PosNetV1PosRequestValueMapper(),
): PosNetV1PosHttpClient {
  return new PosNetV1PosHttpClient(API_URL, new HttpTransport({ fetch: fetchImpl }), noopLogger, mapper)
}

describe('PosNetV1PosHttpClient', () => {
  it.each([
    [TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, 'Sale', `${API_URL}/Sale`],
    [TX_TYPE.CANCEL, MODEL.NON_SECURE, 'Reverse', `${API_URL}/Reverse`],
  ] as Array<[TxType, PaymentModel, string, string]>)('getApiUrl(%s, %s)', (txType, paymentModel, apiUri, expected) => {
    const mapTxType = vi.fn().mockReturnValue(apiUri)
    const client = createClient(fakeFetch([], ''), stubMapper(mapTxType))

    expect(client.getApiUrl(txType, paymentModel)).toBe(expected)
    expect(mapTxType).toHaveBeenCalledTimes(1)
    expect(mapTxType).toHaveBeenCalledWith(txType)
  })

  it('getApiUrl without a transaction type', () => {
    // deviation: P28 a PosError instead of an InvalidArgumentException
    const client = createClient(fakeFetch([], ''), stubMapper(vi.fn()))
    expect(() => client.getApiUrl(undefined as never, MODEL.NON_SECURE)).toThrow(
      new PosError('Transaction type is required to generate API URL'),
    )
  })

  it('supports', () => {
    expect(PosNetV1PosHttpClient.supports('PosNetV1Pos', PosNetV1PosHttpClient.API_NAME_PAYMENT_API)).toBe(true)
    expect(PosNetV1PosHttpClient.supports('PosNetPos', PosNetV1PosHttpClient.API_NAME_PAYMENT_API)).toBe(false)
  })

  it.each([
    ['supported_tx_type', TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE],
    ['unsupported_tx_type', 'unsupported', MODEL.THREE_D_SECURE],
  ] as Array<[string, TxType, PaymentModel]>)('supportsTx %s', (_name, txType, paymentModel) => {
    const mapTxType = vi.fn().mockReturnValue('Sale')
    const client = createClient(fakeFetch([], ''), stubMapper(mapTxType))

    expect(client.supportsTx(txType, paymentModel)).toBe(true)
    expect(mapTxType).toHaveBeenCalledTimes(1)
    expect(mapTxType).toHaveBeenCalledWith(txType)
  })

  it('supports custom query', () => {
    const mapTxType = vi.fn()
    const client = createClient(fakeFetch([], ''), stubMapper(mapTxType))

    expect(client.supportsTx(QUERY_TYPE.CUSTOM_QUERY, MODEL.NON_SECURE)).toBe(true)
    expect(mapTxType).not.toHaveBeenCalled()
  })

  it.each([
    ['supported_tx_type', TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE],
    ['unsupported_tx_type', 'unsupported', MODEL.THREE_D_SECURE],
  ] as Array<[string, TxType, PaymentModel]>)('supportsTx with unsupported tx %s', (_name, txType, paymentModel) => {
    const mapTxType = vi.fn().mockImplementation(() => {
      throw new UnsupportedTransactionTypeError('unsupported')
    })
    const client = createClient(fakeFetch([], ''), stubMapper(mapTxType))

    expect(client.supportsTx(txType, paymentModel)).toBe(false)
    expect(mapTxType).toHaveBeenCalledTimes(1)
    expect(mapTxType).toHaveBeenCalledWith(txType)
  })

  it('request', async () => {
    const sent: Sent[] = []
    const client = createClient(fakeFetch(sent, '{"decoded":"response"}'), stubMapper(vi.fn()))

    const actual = await client.request(
      TX_TYPE.PAY_AUTH,
      MODEL.THREE_D_SECURE,
      ['request-data'] as never,
      { id: 123 as never },
      `${API_URL}/Sale`,
    )

    expect(actual).toStrictEqual({ decoded: 'response' })
    expect(sent).toHaveLength(1)
    const [request] = sent as [Sent]
    expect(request.url).toBe(`${API_URL}/Sale`)
    expect(request.init.method).toBe('POST')
    expect(request.init.headers).toStrictEqual({ 'Content-Type': 'application/json' })
    expect(request.init.body).toBe('["request-data"]')
  })

  it('request bad request', async () => {
    // deviation: P28 a non-2xx answer is a PosHttpError carrying the status
    const sent: Sent[] = []
    const client = createClient(fakeFetch(sent, 'response-content', 500), stubMapper(vi.fn().mockReturnValue('Sale')))
    const err = await client
      .request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: 123 as never })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).status).toBe(500)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.init.body).toBe('{"request-data":"abc"}')
    expect(sent[0]?.init.headers).toStrictEqual({ 'Content-Type': 'application/json' })
  })

  it('request undecodable response', async () => {
    // deviation: P28 an undecodable answer is a PosHttpError
    const sent: Sent[] = []
    const client = createClient(fakeFetch(sent, 'not-valid-json', 400), stubMapper(vi.fn().mockReturnValue('Sale')))

    await expect(
      client.request(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE, { 'request-data': 'abc' }, { id: 123 as never }),
    ).rejects.toThrow(PosHttpError)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.init.body).toBe('{"request-data":"abc"}')
  })

  it('request API URL not found', async () => {
    const sent: Sent[] = []
    const mapTxType = vi.fn().mockImplementation(() => {
      throw new UnsupportedTransactionTypeError('unsupported')
    })
    const client = createClient(fakeFetch(sent, '{}'), stubMapper(mapTxType))

    await expect(
      client.request(TX_TYPE.PAY_POST_AUTH, MODEL.THREE_D_SECURE, ['request-data'] as never, { id: 123 as never }),
    ).rejects.toThrow(UnsupportedTransactionTypeError)
    expect(mapTxType).toHaveBeenCalledTimes(1)
    expect(mapTxType).toHaveBeenCalledWith(TX_TYPE.PAY_POST_AUTH)
    expect(sent).toHaveLength(0)
  })

  describe('with the real value mapper', () => {
    // addition: P21 a custom query has no transaction URL; without the full URL nothing is sent
    it('rejects a custom query without apiUrl before sending', async () => {
      const sent: Sent[] = []
      const client = createClient(fakeFetch(sent, '{}'))

      await expect(
        client.request(QUERY_TYPE.CUSTOM_QUERY, MODEL.NON_SECURE, { OrderId: '1' }, {}, null),
      ).rejects.toThrow(new PosError('PosNetV1 custom queries need the full API URL (apiUrl)'))
      expect(sent).toHaveLength(0)
    })

    // addition: P21 a custom query with its full URL is posted there
    it('posts a custom query to the given apiUrl', async () => {
      const sent: Sent[] = []
      const client = createClient(fakeFetch(sent, '{"ok":"1"}'))

      const actual = await client.request(
        QUERY_TYPE.CUSTOM_QUERY,
        MODEL.NON_SECURE,
        { OrderId: '1' },
        {},
        `${API_URL}/TransactionInquiry`,
      )

      expect(actual).toStrictEqual({ ok: '1' })
      expect(sent).toHaveLength(1)
      expect(sent[0]?.url).toBe(`${API_URL}/TransactionInquiry`)
      expect(sent[0]?.init.body).toBe('{"OrderId":"1"}')
    })

    // addition: a bank or WAF HTML page with HTTP 200 is not a bank answer
    it('rejects an HTML page (HTTP 200) with PosHttpError', async () => {
      const client = createClient(fakeFetch([], '<html><body>Request Rejected</body></html>'))

      await expect(client.request(TX_TYPE.CANCEL, MODEL.NON_SECURE, { OrderId: '1' }, {})).rejects.toThrow(PosHttpError)
    })

    // addition: P21 every transaction type posts to its own URL
    it.each([
      [TX_TYPE.STATUS, `${API_URL}/TransactionInquiry`],
      [TX_TYPE.REFUND_PARTIAL, `${API_URL}/Return`],
      [TX_TYPE.PAY_POST_AUTH, `${API_URL}/Capture`],
      [TX_TYPE.PAY_PRE_AUTH, `${API_URL}/Auth`],
    ] as Array<[TxType, string]>)('posts %s to its URL', async (txType, expectedUrl) => {
      const sent: Sent[] = []
      const client = createClient(fakeFetch(sent, '{}'))

      expect(client.getApiUrl(txType, MODEL.NON_SECURE)).toBe(expectedUrl)
      await client.request(txType, MODEL.NON_SECURE, { a: '1' }, {})
      expect(sent[0]?.url).toBe(expectedUrl)
    })

    // addition: an unmapped transaction type is refused before any request
    it('rejects an unmapped transaction type before sending', async () => {
      const sent: Sent[] = []
      const client = createClient(fakeFetch(sent, '{}'))

      expect(client.supportsTx(TX_TYPE.ORDER_HISTORY, MODEL.NON_SECURE)).toBe(false)
      await expect(client.request(TX_TYPE.ORDER_HISTORY, MODEL.NON_SECURE, {}, {})).rejects.toThrow(
        UnsupportedTransactionTypeError,
      )
      expect(sent).toHaveLength(0)
    })
  })
})
