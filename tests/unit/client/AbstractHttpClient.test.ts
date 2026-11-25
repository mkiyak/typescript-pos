import { describe, expect, it } from 'vitest'
import { AbstractHttpClient, type ClientTxType } from '../../../src/client/AbstractHttpClient.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import type { PosLogger } from '../../../src/logger.js'
import { MODEL, type PaymentModel, TX_TYPE } from '../../../src/PosInterface.js'
import type { EncodedData } from '../../../src/serializer/EncodedData.js'

// addition: the base client sends GET requests with the data as a query string and hands the header builder the URL
// that is signed (the path, without the query string).

type Sent = { url: string; init: RequestInit }

function fakeFetch(sent: Sent[]): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response('{"status":"success"}', { status: 200 })
  }) as unknown as typeof fetch
}

function recordingLogger(): { logger: PosLogger; lines: string[] } {
  const lines: string[] = []
  const rec = (level: string) => (msg: string, ctx?: unknown) => {
    lines.push(`${level} ${msg} ${JSON.stringify(ctx)}`)
  }
  return { logger: { debug: rec('debug'), info: rec('info'), warn: rec('warn'), error: rec('error') }, lines }
}

class TestClient extends AbstractHttpClient {
  readonly headerUrls: (string | undefined)[] = []

  constructor(
    endpoint: string,
    transport: HttpTransport,
    logger: PosLogger,
    private readonly method: 'GET' | 'POST',
  ) {
    super(endpoint, transport, logger)
  }

  supportsTx(): boolean {
    return true
  }

  protected override httpMethod(): 'POST' | 'GET' {
    return this.method
  }

  protected override encode(_t: ClientTxType, _m: PaymentModel, requestData: Record<string, unknown>): EncodedData {
    return {
      data: new URLSearchParams(requestData as Record<string, string>).toString(),
      format: 'form',
    }
  }

  protected override headers(_t: ClientTxType, _m: PaymentModel, _e: EncodedData, url: string): Record<string, string> {
    this.headerUrls.push(url)
    return { 'X-Url': url }
  }
}

const ORDER = { id: 'order-1' } as never

function make(method: 'GET' | 'POST', sent: Sent[], logger: PosLogger) {
  return new TestClient('https://h/default', new HttpTransport({ fetch: fakeFetch(sent) }), logger, method)
}

describe('AbstractHttpClient GET', () => {
  it('moves the encoded data into the query string, sends no body and signs the bare URL', async () => {
    const sent: Sent[] = []
    const client = make('GET', sent, recordingLogger().logger)
    await client.request(TX_TYPE.STATUS, MODEL.NON_SECURE, { a: '1', b: 'x y' }, ORDER, 'https://h/x/y')
    expect(sent[0]?.url).toBe('https://h/x/y?a=1&b=x+y')
    expect(sent[0]?.init.method).toBe('GET')
    expect(sent[0]?.init.body).toBeUndefined()
    expect(client.headerUrls).toEqual(['https://h/x/y'])
    expect(sent[0]?.init.headers).toEqual({ 'X-Url': 'https://h/x/y' })
  })

  it('adds no question mark for empty data', async () => {
    const sent: Sent[] = []
    const client = make('GET', sent, recordingLogger().logger)
    await client.request(TX_TYPE.STATUS, MODEL.NON_SECURE, {}, ORDER, 'https://h/x/y')
    expect(sent[0]?.url).toBe('https://h/x/y')
  })

  it('joins the data to a query string the target already has', async () => {
    const sent: Sent[] = []
    const client = make('GET', sent, recordingLogger().logger)
    await client.request(TX_TYPE.STATUS, MODEL.NON_SECURE, { a: '1' }, ORDER, 'https://h/x?q=1')
    expect(sent[0]?.url).toBe('https://h/x?q=1&a=1')
    expect(client.headerUrls).toEqual(['https://h/x'])
  })

  it('keeps POST the default and hands the headers the target without its query string', async () => {
    const sent: Sent[] = []
    const client = make('POST', sent, recordingLogger().logger)
    await client.request(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE, { a: '1' }, ORDER, 'https://h/pay?q=1')
    expect(sent[0]?.url).toBe('https://h/pay?q=1')
    expect(sent[0]?.init.method).toBe('POST')
    expect(sent[0]?.init.body).toBe('a=1')
    expect(client.headerUrls).toEqual(['https://h/pay'])
  })

  it('logs the URL without the query string', async () => {
    const sent: Sent[] = []
    const { logger, lines } = recordingLogger()
    const client = make('GET', sent, logger)
    await client.request(TX_TYPE.STATUS, MODEL.NON_SECURE, { token: 'sekrit-token' }, ORDER, 'https://h/x/y')
    const sending = lines.find((l) => l.includes('sending request'))
    expect(sending).toContain('https://h/x/y')
    expect(lines.join('\n')).not.toContain('sekrit-token')
  })

  it('logs a failed GET without the query string', async () => {
    const { logger, lines } = recordingLogger()
    const failing = (async () => new Response('bad', { status: 500 })) as unknown as typeof fetch
    const client = new TestClient('https://h/d', new HttpTransport({ fetch: failing }), logger, 'GET')
    await expect(
      client.request(TX_TYPE.STATUS, MODEL.NON_SECURE, { token: 'sekrit-token' }, ORDER, 'https://h/x/y'),
    ).rejects.toMatchObject({ url: 'https://h/x/y' })
    const failed = lines.find((l) => l.includes('api request failed'))
    expect(failed).toContain('https://h/x/y')
    expect(lines.join('\n')).not.toContain('sekrit-token')
  })
})
