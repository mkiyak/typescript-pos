import { inspect } from 'node:util'
import iconv from 'iconv-lite'
import { describe, expect, it, vi } from 'vitest'
import { AssecoPosHttpClient } from '../../../src/client/AssecoPosHttpClient.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { InterPosHttpClient } from '../../../src/client/InterPosHttpClient.js'
import { PayFlexCPV4PosHttpClient } from '../../../src/client/PayFlexCPV4PosHttpClient.js'
import { PayFlexV4Pos3DFormHttpClient } from '../../../src/client/PayFlexV4Pos3DFormHttpClient.js'
import { PayFlexV4PosHttpClient } from '../../../src/client/PayFlexV4PosHttpClient.js'
import { PayFlexV4PosSearchApiHttpClient } from '../../../src/client/PayFlexV4PosSearchApiHttpClient.js'
import { PayForPosHttpClient } from '../../../src/client/PayForPosHttpClient.js'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import { PosHttpError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../src/factory/CreditCardFactory.js'
import { PosFactory } from '../../../src/factory/PosFactory.js'
import { PosQueryFactory } from '../../../src/factory/PosQueryFactory.js'
import type { AbstractGateway } from '../../../src/gateway/AbstractGateway.js'
import type { AbstractPosAccount } from '../../../src/model/account/AbstractPosAccount.js'
import { CARD_TYPE, MODEL, TX_TYPE } from '../../../src/PosInterface.js'
import type { PosOrder } from '../../../src/types.js'

// addition: L4 — the credentials a client puts into a request body are hidden from thrown errors and every log line,
// also when a failing bank page echoes them in free text, cut at the snippet edge or in their masked card form.

/** A distinctive password: neither the whole value nor a 3-character start of it may leak. */
const PW = 'Pw9137xZq-L4'

const ACCOUNTS: Record<string, (password: string) => AbstractPosAccount> = {
  AssecoPos: (pw) => AccountFactory.createAssecoPosAccount('asseco', '700655000200', 'ISBANKAPI', pw, 'TRPS0200'),
  PayFlexV4Pos: (pw) => AccountFactory.createPayFlexPosAccount('vakifbank', '000000000111111', pw, 'VP999999'),
  PayFlexCPV4Pos: (pw) => AccountFactory.createPayFlexPosAccount('vakifbank-cp', '000000000111111', pw, 'VP999999'),
  PayForPos: (pw) =>
    AccountFactory.createPayForPosAccount('qnbfinansbank-payfor', '085300000009704', 'QNB_API', pw, '12345678'),
  InterPos: (pw) => AccountFactory.createInterPosAccount('denizbank', '3123', 'InterTestApi', pw, 'gDg1N'),
}

const ORDER: PosOrder = {
  id: 'ORDER1',
  amount: 10.01,
  currency: 'TRY',
  installment: 0,
  ip: '127.0.0.1',
  success_url: 'https://merchant.example/ok',
  fail_url: 'https://merchant.example/fail',
  lang: 'tr',
  transaction_id: '123456',
  payment_token: 'ptkn-1',
} as PosOrder

const card = (gateway: AbstractGateway) =>
  CreditCardFactory.createForGateway(gateway, '4355084355084358', '31', '07', '719', 'John Doe', CARD_TYPE.VISA)

/** The gateway operations whose request carries the account password. */
const OPERATIONS: Array<[gateway: string, operation: string, run: (g: AbstractGateway) => Promise<unknown>]> = [
  ['AssecoPos', 'cancel', (g) => g.cancel(ORDER)],
  ['AssecoPos', 'status', (g) => g.status(ORDER)],
  ['PayFlexV4Pos', 'cancel', (g) => g.cancel(ORDER)],
  // the password sits one level down, in MerchantCriteria, and goes through the search client
  ['PayFlexV4Pos', 'status', (g) => g.status(ORDER)],
  // the enrollment client
  ['PayFlexV4Pos', '3D enrollment', (g) => g.get3DFormData(ORDER, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card(g))],
  // JSON transaction query
  ['PayFlexCPV4Pos', 'status', (g) => g.status(ORDER)],
  // form-encoded registration
  ['PayFlexCPV4Pos', '3D registration', (g) => g.get3DFormData(ORDER, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, card(g))],
  ['PayForPos', 'cancel', (g) => g.cancel(ORDER)],
  ['PayForPos', 'status', (g) => g.status(ORDER)],
  ['InterPos', 'cancel', (g) => g.cancel(ORDER)],
  ['InterPos', 'status', (g) => g.status(ORDER)],
]

/** Bank pages that echo the password in free text; the last one is cut by the 500-character snippet inside it. */
const ANSWERS: Array<[label: string, status: number, body: string]> = [
  ['HTTP 500 text', 500, `Error: credentials rejected (password ${PW}) for this merchant`],
  ['HTTP 500 HTML', 500, `<html><body><h1>Internal error</h1><p>user=x pass=${PW}</p></body></html>`],
  ['HTTP 200 HTML', 200, `<html><body><p>Invalid password ${PW}</p></body></html>`],
  ['HTTP 200 undecodable', 200, `garbage ${PW} <<< {"a": ${PW}`],
  ['HTTP 503 cut at the snippet edge', 503, `${'x'.repeat(495)}${PW} tail`],
  ['HTTP 200 HTML cut at 500 characters', 200, `<html>${'y'.repeat(489)}${PW}</html>`],
]

function recordingLogger() {
  const calls: unknown[][] = []
  const record =
    (level: string) =>
    (...args: unknown[]) => {
      calls.push([level, ...args])
    }
  return {
    calls,
    logger: { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') },
  }
}

/** Everything a caller or a log reader can see of a failure. */
function visibleText(error: unknown, logCalls: unknown[][]): string {
  const parts: string[] = [JSON.stringify(logCalls), inspect(logCalls, { depth: 10 })]
  if (error instanceof Error) {
    parts.push(error.message, inspect(error, { depth: 10, showHidden: true }))
    if (error instanceof PosHttpError) parts.push(error.url, error.bodySnippet ?? '')
    let cause: unknown = error.cause
    while (cause instanceof Error) {
      parts.push(cause.message, inspect(cause, { depth: 10 }))
      cause = cause.cause
    }
  } else {
    parts.push(inspect(error, { depth: 10 }))
  }
  return parts.join('\n')
}

function gatewayWith(gatewayClass: string, status: number, body: string | Uint8Array) {
  const { calls, logger } = recordingLogger()
  // a plain function, not a mock: a mock keeps its call arguments (the sent body) where an inspect of the gateway
  // would find them
  const sent: RequestInit[] = []
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    sent.push(init ?? {})
    return new Response(body as ConstructorParameters<typeof Response>[0], { status })
  }) as unknown as typeof fetch
  const account = (ACCOUNTS[gatewayClass] as (pw: string) => AbstractPosAccount)(PW)
  const gateway = PosFactory.createPosGateway(account, posTestConfig, { fetch: fetchImpl, logger })
  return { gateway, calls, sent }
}

describe('request credentials never leave through errors or logs', () => {
  for (const [gatewayClass, operation, run] of OPERATIONS) {
    for (const [label, status, body] of ANSWERS) {
      it(`${gatewayClass} ${operation}: ${label}`, async () => {
        const { gateway, calls, sent } = gatewayWith(gatewayClass, status, body)
        const error = await run(gateway).then(
          () => null,
          (e: unknown) => e,
        )
        expect(sent).toHaveLength(1)
        // the sent request did carry the password, so the check below is not vacuous
        const init = sent[0]
        const sentBody = Buffer.from(
          await new Request('https://x.invalid', { method: 'POST', body: init?.body ?? '' }).arrayBuffer(),
        ).toString('latin1')
        expect(decodeURIComponent(sentBody.replace(/\+/g, ' '))).toContain(PW)

        expect(error).toBeInstanceOf(PosHttpError)
        const text = visibleText(error, calls)
        expect(text).not.toContain(PW)
        expect(text).not.toContain(PW.slice(0, 3))
        expect(text).toContain('***')
        expect(calls.length).toBeGreaterThan(0)
        // nothing of the request stays behind on the gateway, its strategy or its clients
        for (const dump of [JSON.stringify(gateway), inspect(gateway, { depth: 10, showHidden: true })]) {
          expect(dump).not.toContain(PW)
        }
      })
    }
  }

  it('the query objects of the same gateways hide the password a custom query sends', async () => {
    for (const gatewayClass of Object.keys(ACCOUNTS)) {
      const { calls, logger } = recordingLogger()
      const fetchImpl = vi.fn(
        async () => new Response(`<html>bad ${PW}</html>`, { status: 500 }),
      ) as unknown as typeof fetch
      const account = (ACCOUNTS[gatewayClass] as (pw: string) => AbstractPosAccount)(PW)
      const query = PosQueryFactory.createPosQuery(account, posTestConfig, { fetch: fetchImpl, logger })
      const error = await query.customQuery({ Password: PW, UserPass: PW, Inner: { MerchantPassword: PW } }).then(
        () => null,
        (e: unknown) => e,
      )
      expect(error, gatewayClass).toBeInstanceOf(PosHttpError)
      const text = visibleText(error, calls)
      expect(text, gatewayClass).not.toContain(PW)
      expect(text, gatewayClass).not.toContain(PW.slice(0, 3))
    }
  })
})

describe('the clients name the credentials of their requests', () => {
  const transport = new HttpTransport({ fetch: (async () => new Response('')) as unknown as typeof fetch })
  const url = 'https://bank.example/api'
  const clients = {
    AssecoPosHttpClient: new AssecoPosHttpClient(url, transport),
    PayFlexV4PosHttpClient: new PayFlexV4PosHttpClient(url, transport),
    PayFlexV4PosSearchApiHttpClient: new PayFlexV4PosSearchApiHttpClient(url, transport),
    PayFlexV4Pos3DFormHttpClient: new PayFlexV4Pos3DFormHttpClient(url, transport),
    PayFlexCPV4PosHttpClient: new PayFlexCPV4PosHttpClient(url, transport),
    PayForPosHttpClient: new PayForPosHttpClient(url, transport),
    InterPosHttpClient: new InterPosHttpClient(url, transport),
  }
  const secretsOf = (client: unknown, data: Record<string, unknown>): readonly string[] =>
    (client as { logSecrets(d: Record<string, unknown>): readonly string[] }).logSecrets(data)

  it.each(Object.entries(clients))('%s reads Password, MerchantPassword and UserPass at two levels', (_n, client) => {
    expect(
      secretsOf(client, {
        Password: 'a1',
        MerchantPassword: 'b2',
        UserPass: 'c3',
        Wrapper: { Password: 'd4', MerchantPassword: 'e5', UserPass: 'f6', Deeper: { Password: 'g7' } },
        Name: 'not-a-secret',
      }),
    ).toEqual(expect.arrayContaining(['a1', 'b2', 'c3', 'd4', 'e5', 'f6']))
  })

  it.each(Object.entries(clients))('%s ignores empty, non-string, inherited and deeper values', (_n, client) => {
    const inherited = Object.create({ Password: 'inherited' }) as Record<string, unknown>
    inherited.UserPass = ''
    inherited.MerchantPassword = 12345
    const secrets = secretsOf(client, {
      ...{ Wrapper: inherited },
      Other: { Deeper: { Password: 'g7' } },
      List: ['Password'],
      Password: null,
    })
    expect(secrets).toEqual([])
    expect(secretsOf(client, inherited)).toEqual([])
  })
})

// addition: L4 — an ISO-8859-9 bank page that echoes a Turkish password is hidden too, in both the thrown error
// (decoded by the transport as UTF-8) and the parse-failure log line (decoded with the page's own charset)
describe('Asseco ISO-8859-9 pages', () => {
  const password = 'Şifre-ğüİ-913'
  for (const status of [200, 500]) {
    it(`hides a Turkish password echoed in an ISO-8859-9 page (HTTP ${status})`, async () => {
      const page = iconv.encode(
        `<?xml version="1.0" encoding="ISO-8859-9"?><CC5Response><Bad>Geçersiz şifre ${password}</CC5Response>`,
        'ISO-8859-9',
      )
      const { calls, logger } = recordingLogger()
      const fetchImpl = vi.fn(async () => new Response(page, { status })) as unknown as typeof fetch
      const account = AccountFactory.createAssecoPosAccount('asseco', '700655000200', 'ISBANKAPI', password, 'TRPS0200')
      const gateway = PosFactory.createPosGateway(account, posTestConfig, { fetch: fetchImpl, logger })
      const error = await gateway.cancel(ORDER).then(
        () => null,
        (e: unknown) => e,
      )
      expect(error).toBeInstanceOf(PosHttpError)
      const text = visibleText(error, calls)
      expect(text).not.toContain(password)
      for (const piece of ['Şifre', 'ğüİ', '-913', 'ifre-']) expect(text).not.toContain(piece)
      // the ASCII part of the password is not visible in the mangled (UTF-8 decoded) form either
      expect(text).not.toMatch(/�ifre-/)
    })
  }

  // addition: 1.10 — the parse-failure log line shows the page decoded with its own charset
  it('logs a page that fails to parse decoded with its own charset', async () => {
    const page = iconv.encode(
      '<?xml version="1.0" encoding="ISO-8859-9"?><CC5Response><Bad>Geçersiz işlem</CC5Response>',
      'ISO-8859-9',
    )
    const { calls, logger } = recordingLogger()
    const fetchImpl = vi.fn(async () => new Response(page, { status: 200 })) as unknown as typeof fetch
    const account = AccountFactory.createAssecoPosAccount('asseco', '700655000200', 'ISBANKAPI', 'pw-1', 'TRPS0200')
    const gateway = PosFactory.createPosGateway(account, posTestConfig, { fetch: fetchImpl, logger })
    await gateway.cancel(ORDER).catch(() => null)
    const line = calls.find(([, m]) => m === 'parsing bank response failed')
    expect(line).toBeDefined()
    expect((line?.[2] as { response?: string } | undefined)?.response).toContain('Geçersiz işlem')
  })
})
