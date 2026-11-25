import { describe, expect, it, vi } from 'vitest'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import { PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../src/factory/CreditCardFactory.js'
import { PosFactory } from '../../../src/factory/PosFactory.js'
import type { AbstractGateway } from '../../../src/gateway/AbstractGateway.js'
import type { AbstractPosAccount } from '../../../src/model/account/AbstractPosAccount.js'
import {
  CARD_TYPE,
  FORM_FORMAT,
  type FormFormat,
  MODEL,
  type PaymentModel,
  TX_TYPE,
  type TxType,
} from '../../../src/PosInterface.js'
import type { PosOrder, ThreeDFormData } from '../../../src/types.js'

// addition: L1/L2 library-wide rules, checked on every gateway the factory builds, so a gateway that skips the shared
// helpers fails here

const PARAM_GUID = '0c13d406-873b-403b-9c09-a5766840d98c'

/** One account per gateway class, built by the factories as a merchant would. */
const ACCOUNTS: Record<string, () => AbstractPosAccount> = {
  AssecoPos: () => AccountFactory.createAssecoPosAccount('asseco', '700655000200', 'ISBANKAPI', 'ISBANK07', 'TRPS0200'),
  GarantiPos: () =>
    AccountFactory.createGarantiPosAccount(
      'garanti',
      '7000679',
      'PROVAUT',
      '123qweASD/',
      '30691298',
      '12345678',
      'PROVRFN',
      '123qweASD/',
    ),
  AkbankPos: () =>
    AccountFactory.createAkbankPosAccount(
      'akbank-pos',
      '2023090417500272654BD9A49CF07574',
      '2023090417500284633D137A249DBBEB',
      '3230323330393034313735303032363031353172675f357637355f3273387373745f7233725f73323333383737335f323272383774767276327672323531355f',
    ),
  PosNetPos: () =>
    AccountFactory.createPosNetPosAccount('yapikredi', '6706598320', '67005551', '27426', '10,10,10,10,10,10,10,10'),
  PosNetV1Pos: () =>
    AccountFactory.createPosNetPosAccount(
      'albaraka',
      '6700950031',
      '67540050',
      '1010028724242434',
      '10,10,10,10,10,10,10,10',
    ),
  PayForPos: () =>
    AccountFactory.createPayForPosAccount(
      'qnbfinansbank-payfor',
      '085300000009704',
      'QNB_API_KULLANICI_3DPAY',
      'UcBN0',
      '12345678',
    ),
  InterPos: () => AccountFactory.createInterPosAccount('denizbank', '3123', 'InterTestApi', '3', 'gDg1N'),
  KuveytPos: () => AccountFactory.createBoaPosAccount('kuveytpos', '496', 'apiuser1', '400235', 'Api123'),
  VakifKatilimPos: () => AccountFactory.createBoaPosAccount('vakif-katilim', '1', 'APIUSER', '11111', 'Api123'),
  ToslaPos: () =>
    AccountFactory.createToslaPosAccount('tosla', '1000000494', 'POS_ENT_Test_001', 'POS_ENT_Test_001!*!*'),
  ParamPos: () => AccountFactory.createParamPosAccount('param-pos', '10738', 'Test1', 'Test2', PARAM_GUID),
  Param3DHostPos: () =>
    AccountFactory.createParamPosAccount('param-3d-host-pos', '10738', 'Test1', 'Test2', PARAM_GUID, '99001'),
  PayTrPos: () => AccountFactory.createPayTrPosAccount('paytr', '123456', 'YEUaNcdHXqyt7hjt', 'wWwU8buJp6jo1r25'),
  IyzicoPos: () => AccountFactory.createIyzicoPosAccount('iyzico', 'sandbox-apiKey', 'sandbox-secretKey'),
  PayFlexV4Pos: () => AccountFactory.createPayFlexPosAccount('vakifbank', '000000000111111', '3XTgER89as', 'VP999999'),
  PayFlexCPV4Pos: () =>
    AccountFactory.createPayFlexPosAccount('vakifbank-cp', '000000000111111', '3XTgER89as', 'VP999999'),
}
const GATEWAYS = Object.keys(ACCOUNTS)

/** A distinctive card: the PAN, its first six and last four, the CVV and the expiry are searched for. */
const PAN = '4355084355084358'
const CVV = '719'
const EXPIRY_YEAR = '31'
const EXPIRY_MONTH = '07'

type Answer = { status?: number; type?: string; body: string }

function build(gatewayClass: string, answer: (url: string) => Answer | undefined = () => undefined) {
  const sent: Array<{ url: string; body: string }> = []
  const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
    const body = await new Request('https://example.invalid', { method: 'POST', body: init?.body ?? '' }).text()
    sent.push({ url: String(url), body })
    const reply = answer(String(url))
    if (reply === undefined) {
      throw new Error('no HTTP request may be sent in this test')
    }
    return new Response(reply.body, {
      status: reply.status ?? 200,
      headers: { 'content-type': reply.type ?? 'application/json' },
    })
  })
  const onRequestDataPrepared = vi.fn()
  const onBefore3DFormHashCalculated = vi.fn()
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const account = (ACCOUNTS[gatewayClass] as () => AbstractPosAccount)()
  const gateway = PosFactory.createPosGateway(account, posTestConfig, {
    fetch: fetchImpl as unknown as typeof fetch,
    hooks: {
      onRequestDataPrepared: [onRequestDataPrepared],
      onBefore3DFormHashCalculated: [onBefore3DFormHashCalculated],
    },
    logger,
  })
  return { gateway, fetchImpl, sent, onRequestDataPrepared, onBefore3DFormHashCalculated, logger }
}
type Built = ReturnType<typeof build>

const cardFor = (gateway: AbstractGateway) =>
  CreditCardFactory.createForGateway(gateway, PAN, EXPIRY_YEAR, EXPIRY_MONTH, CVV, 'John Doe', CARD_TYPE.VISA)

/** The order fields only some gateways require. */
const ORDER_EXTRAS: Record<string, Record<string, unknown>> = {
  KuveytPos: { payment_channel: '02', buyer: {}, billing_address: {} },
  ToslaPos: { transaction_date: new Date('2026-11-25T10:00:00+03:00') },
  IyzicoPos: {
    buyer: {
      id: 'BY789',
      name: 'John',
      surname: 'Doe',
      identity_number: '74300864791',
      email: 'email@email.com',
      gsm_number: '+905350000000',
      registration_address: 'Address 1',
      city: 'Istanbul',
      country: 'Turkey',
      zip_code: '34732',
      ip: '127.0.0.1',
    },
    shipping_address: { contact_name: 'John Doe', city: 'Istanbul', country: 'Turkey', address: 'Address 1' },
    billing_address: { contact_name: 'John Doe', city: 'Istanbul', country: 'Turkey', address: 'Address 1' },
    basket_items: [{ id: 'BI101', name: 'Binocular', category1: 'Collectibles', item_type: 'PHYSICAL', price: 10.01 }],
  },
}

/** Every field the gateway's requests need, so that only the order id decides. */
const order = (id: unknown, gatewayClass = ''): PosOrder => {
  const o = {
    id,
    amount: 10.01,
    currency: 'TRY',
    installment: 0,
    ip: '127.0.0.1',
    success_url: 'https://merchant.example/ok',
    fail_url: 'https://merchant.example/fail',
    lang: 'tr',
    ref_ret_num: '831803579226',
    auth_code: '123456',
    transaction_id: '123456',
    remote_order_id: '123456',
    payment_model: MODEL.NON_SECURE,
    transaction_type: TX_TYPE.PAY_AUTH,
    order_type: 'single',
    pre_auth_amount: 10.01,
    buyer: { email: 'test@example.com', name: 'John Doe', gsm_number: '05001234567' },
    billing_address: { address: 'Test Sokak No:1 Istanbul' },
    ...ORDER_EXTRAS[gatewayClass],
  } as Record<string, unknown>
  // POSNET cancels, refunds and captures by the bank reference when one is given; without it they send the order id
  if (gatewayClass === 'PosNetPos' || gatewayClass === 'PosNetV1Pos') {
    delete o.ref_ret_num
    delete o.auth_code
  }
  return o as PosOrder
}

/** The gateways whose 3D form the browser posts (with a card unless `createWithoutCard`). */
const BROWSER_FORM_GATEWAYS = new Set([
  'AssecoPos',
  'GarantiPos',
  'AkbankPos',
  'PosNetV1Pos',
  'PayForPos',
  'InterPos',
  'PayTrPos',
  'ToslaPos',
])

type Operation = [name: string, run: (built: Built, o: PosOrder) => Promise<unknown>]

const THREE_D_MODELS: readonly PaymentModel[] = [
  MODEL.THREE_D_SECURE,
  MODEL.THREE_D_PAY,
  MODEL.THREE_D_HOST,
  MODEL.THREE_D_PAY_HOSTING,
]
const HOSTED: readonly PaymentModel[] = [MODEL.THREE_D_HOST, MODEL.THREE_D_PAY_HOSTING]

/**
 * Operations that do not carry the merchant order id: they are keyed by a bank reference, or by a date range.
 * Each entry names what the request sends instead.
 */
const WITHOUT_ORDER_ID: Record<string, readonly string[]> = {
  // TransactionId / ReferenceTransactionId of the bank
  PayFlexV4Pos: ['post-auth', 'cancel', 'refund'],
  // the bank reference (hostLogKey / ReferenceCode)
  PosNetPos: ['post-auth'],
  PosNetV1Pos: ['post-auth'],
  // the payment token and the bank transaction id
  PayFlexCPV4Pos: ['status'],
  // a date range
  VakifKatilimPos: ['order history'],
  // the iyzico payment id
  IyzicoPos: ['order history'],
}

function operationsOf(gatewayClass: string): Operation[] {
  const { gateway } = build(gatewayClass)
  const cls = gateway.constructor as typeof AbstractGateway
  const ops: Operation[] = []
  for (const model of THREE_D_MODELS) {
    if (!cls.isSupportedTransaction(TX_TYPE.PAY_AUTH, model)) continue
    const withCard = !HOSTED.includes(model)
    ops.push([
      `3D form ${model}`,
      (b, o) => b.gateway.get3DFormData(o, model, TX_TYPE.PAY_AUTH, withCard ? cardFor(b.gateway) : null),
    ])
    if (withCard && BROWSER_FORM_GATEWAYS.has(gatewayClass)) {
      ops.push([
        `3D form ${model} without card`,
        (b, o) => b.gateway.get3DFormData(o, model, TX_TYPE.PAY_AUTH, null, true),
      ])
    }
  }
  const tx = (txType: TxType) => cls.isSupportedTransaction(txType, MODEL.NON_SECURE)
  if (tx(TX_TYPE.PAY_AUTH)) {
    ops.push(['non-secure payment', (b, o) => b.gateway.makeRegularPayment(o, cardFor(b.gateway), TX_TYPE.PAY_AUTH)])
  }
  if (tx(TX_TYPE.PAY_POST_AUTH)) ops.push(['post-auth', (b, o) => b.gateway.makeRegularPostPayment(o)])
  if (tx(TX_TYPE.STATUS)) ops.push(['status', (b, o) => b.gateway.status(o)])
  if (tx(TX_TYPE.CANCEL)) ops.push(['cancel', (b, o) => b.gateway.cancel(o)])
  if (tx(TX_TYPE.REFUND)) ops.push(['refund', (b, o) => b.gateway.refund(o)])
  if (tx(TX_TYPE.ORDER_HISTORY)) ops.push(['order history', (b, o) => b.gateway.orderHistory(o)])

  const skipped = WITHOUT_ORDER_ID[gatewayClass] ?? []
  return ops.filter(([name]) => !skipped.includes(name))
}

/** The rejections every gateway shares (Review Focus 4). */
const REJECTED: ReadonlyArray<[string, unknown]> = [
  ['leading "_"', '_a'],
  ['leading "-"', '-1'],
  ['a blank', 'a b'],
  ['non-ASCII', 'ä1'],
  ['65 characters', 'a'.repeat(65)],
  ['an array', ['a']],
  ['a boolean', true],
  ['an object', {}],
  ['a fraction', 1.5],
  ['a negative number', -1],
  ['an unsafe integer', 2 ** 53],
  ['"&"', 'a&b'],
  ['empty', ''],
]

/** Bank-specific rejections on top of the shared rule. */
const EXTRA_REJECTED: Record<string, ReadonlyArray<[string, unknown]>> = {
  PosNetPos: [['21 characters', 'a'.repeat(21)]],
  PosNetV1Pos: [['21 characters', 'a'.repeat(21)]],
  PayFlexCPV4Pos: [['"_"', 'a_b']],
}

/** Shared message, the required-field messages and the messages of the gateways that had the rule first. */
const ORDER_ID_ERROR = /^(Order field "id"|The order id)/

const ORDER_ID_CASES = GATEWAYS.flatMap((gatewayClass) =>
  operationsOf(gatewayClass).flatMap(([name, run]) =>
    [...REJECTED, ...(EXTRA_REJECTED[gatewayClass] ?? [])].map(
      ([label, id]) => [gatewayClass, name, label, id, run] as const,
    ),
  ),
)

describe('one order-id rule on every gateway', () => {
  it('covers every gateway and its order-id operations', () => {
    expect(new Set(ORDER_ID_CASES.map(([g]) => g)).size).toBe(16)
  })

  it.each(ORDER_ID_CASES)(
    '%s %s rejects %s before any request or hook',
    async (gatewayClass, _name, _label, id, run) => {
      const built = build(gatewayClass)
      const error = await run(built, order(id, gatewayClass)).then(
        () => undefined,
        (e: unknown) => e,
      )
      expect(error).toBeInstanceOf(PosError)
      expect((error as Error).message).toMatch(ORDER_ID_ERROR)
      expect(built.fetchImpl).not.toHaveBeenCalled()
      expect(built.onRequestDataPrepared).not.toHaveBeenCalled()
      expect(built.onBefore3DFormHashCalculated).not.toHaveBeenCalled()
    },
  )

  const ACCEPTED: ReadonlyArray<[string, unknown]> = [
    ['"A"', 'A'],
    ['"1"', '1'],
    ['a number', 7],
    ['"order_1-2"', 'order_1-2'],
    ['20 characters', 'a1'.repeat(10)],
  ]
  const ACCEPTED_CASES = GATEWAYS.flatMap((gatewayClass) =>
    operationsOf(gatewayClass).flatMap(([name, run]) =>
      ACCEPTED.filter(([, id]) => !(gatewayClass === 'PayFlexCPV4Pos' && id === 'order_1-2')).map(
        ([label, id]) => [gatewayClass, name, label, id, run] as const,
      ),
    ),
  )

  it.each(ACCEPTED_CASES)('%s %s accepts %s', async (gatewayClass, _name, _label, id, run) => {
    const built = build(gatewayClass)
    const error = await run(built, order(id, gatewayClass)).then(
      () => undefined,
      (e: unknown) => e,
    )
    // the id passed: the form was built, or the request reached the (failing) transport
    if (error !== undefined) {
      expect((error as Error).message).not.toMatch(ORDER_ID_ERROR)
      expect(built.fetchImpl).toHaveBeenCalled()
    }
  })

  it.each(
    GATEWAYS.filter((g) => !['PosNetPos', 'PosNetV1Pos'].includes(g)).flatMap((gatewayClass) =>
      operationsOf(gatewayClass).map(([name, run]) => [gatewayClass, name, run] as const),
    ),
  )('%s %s accepts 64 characters', async (_gatewayClass, _name, run) => {
    const built = build(_gatewayClass)
    const error = await run(built, order('a'.repeat(64), _gatewayClass)).then(
      () => undefined,
      (e: unknown) => e,
    )
    // the id passed: the form was built, or the request reached the (failing) transport
    if (error !== undefined) {
      expect((error as Error).message).not.toMatch(ORDER_ID_ERROR)
      expect(built.fetchImpl).toHaveBeenCalled()
    }
  })
})

// ---- L1: a card passed with createWithoutCard never reaches a browser form ----

const TOSLA_SESSION = 'PA49E341381C94587AB4CB196DAC10DC02E509578520E4471A3EEE2BB4830AE4F'
const BANK_PAGE = '<html><body><form action="https://bank.example/acs"></form></body></html>'

/** The gateways whose 3D form is posted by the browser, with the models that may carry a card. */
const BROWSER_FORMS: ReadonlyArray<[gatewayClass: string, model: PaymentModel, formFormat: FormFormat | null]> = [
  ['AssecoPos', MODEL.THREE_D_SECURE, null],
  ['AssecoPos', MODEL.THREE_D_PAY, null],
  ['GarantiPos', MODEL.THREE_D_SECURE, null],
  ['GarantiPos', MODEL.THREE_D_PAY, null],
  ['AkbankPos', MODEL.THREE_D_SECURE, null],
  ['AkbankPos', MODEL.THREE_D_PAY, null],
  ['PosNetV1Pos', MODEL.THREE_D_SECURE, null],
  ['PayForPos', MODEL.THREE_D_SECURE, null],
  ['PayForPos', MODEL.THREE_D_PAY, null],
  ['PayForPos', MODEL.THREE_D_SECURE, FORM_FORMAT.HTML],
  ['PayForPos', MODEL.THREE_D_PAY, FORM_FORMAT.HTML],
  ['InterPos', MODEL.THREE_D_SECURE, null],
  ['InterPos', MODEL.THREE_D_PAY, null],
  ['PayTrPos', MODEL.THREE_D_PAY, null],
  ['ToslaPos', MODEL.THREE_D_PAY, null],
]

const answers = (gatewayClass: string) => (): Answer | undefined => {
  if (gatewayClass === 'ToslaPos') {
    return {
      body: JSON.stringify({ Code: 0, Message: 'Başarılı', ThreeDSessionId: TOSLA_SESSION, TransactionId: '1' }),
    }
  }
  if (gatewayClass === 'PayForPos') {
    return { type: 'text/html', body: BANK_PAGE }
  }
  return undefined
}

/** Every form of the expiry a bank may use. */
const EXPIRY_FORMS = [
  `${EXPIRY_YEAR}${EXPIRY_MONTH}`,
  `${EXPIRY_MONTH}${EXPIRY_YEAR}`,
  `${EXPIRY_MONTH}/${EXPIRY_YEAR}`,
  `20${EXPIRY_YEAR}`,
  `20${EXPIRY_YEAR}${EXPIRY_MONTH}`,
]

/** What the browser receives (the form, or for `html` the page plus what was posted to the bank to get it). */
function browserSide(built: Built, form: ThreeDFormData | string): { text: string; values: string[] } {
  if (typeof form === 'string') {
    const posted = built.sent.map((s) => s.body)
    const values = posted.flatMap((body) => [...new URLSearchParams(body).values()])
    return { text: [form, ...posted].join('\n'), values }
  }
  return { text: JSON.stringify(form), values: Object.values(form.inputs) }
}

function expectNoCard(side: { text: string; values: string[] }): void {
  expect(side.text).not.toContain(PAN)
  expect(side.text).not.toMatch(new RegExp(`${PAN.slice(0, 6)}.{0,8}${PAN.slice(-4)}`))
  for (const value of side.values) {
    expect(value).not.toBe(CVV)
    expect(EXPIRY_FORMS).not.toContain(value)
    expect(value).not.toBe(EXPIRY_MONTH)
  }
}

describe('a card passed with createWithoutCard never reaches the browser form', () => {
  it.each(BROWSER_FORMS)('%s %s (format %s): the card is dropped', async (gatewayClass, model, formFormat) => {
    const built = build(gatewayClass, answers(gatewayClass))
    const form = await built.gateway.get3DFormData(
      order('ORDER-1'),
      model,
      TX_TYPE.PAY_AUTH,
      cardFor(built.gateway),
      true,
      formFormat,
    )

    expectNoCard(browserSide(built, form))
    const logged = JSON.stringify([
      built.logger.debug.mock.calls,
      built.logger.info.mock.calls,
      built.logger.warn.mock.calls,
      built.logger.error.mock.calls,
    ])
    expect(logged).not.toContain(PAN)
    expect(logged).not.toContain(`"${CVV}"`)
    expect(
      built.logger.debug.mock.calls.some(([message]) => message === 'card ignored: createWithoutCard is set'),
    ).toBe(true)
    // the hook sees the form without the card as well
    expect(JSON.stringify(built.onBefore3DFormHashCalculated.mock.calls)).not.toContain(PAN)
    expect(JSON.stringify(built.onRequestDataPrepared.mock.calls)).not.toContain(PAN)
  })

  it.each(BROWSER_FORMS)(
    '%s %s (format %s): without the flag the card is in the form',
    async (gatewayClass, model, formFormat) => {
      const built = build(gatewayClass, answers(gatewayClass))
      const form = await built.gateway.get3DFormData(
        order('ORDER-1'),
        model,
        TX_TYPE.PAY_AUTH,
        cardFor(built.gateway),
        false,
        formFormat,
      )

      const side = browserSide(built, form)
      expect(side.values).toContain(PAN)
      expect(side.values).toContain(CVV)
      expect(
        built.logger.debug.mock.calls.some(([message]) => message === 'card ignored: createWithoutCard is set'),
      ).toBe(false)
    },
  )

  it.each(BROWSER_FORMS)(
    '%s %s (format %s): the same form as without any card',
    async (gatewayClass, model, formFormat) => {
      const withCard = build(gatewayClass, answers(gatewayClass))
      const withoutCard = build(gatewayClass, answers(gatewayClass))
      const a = await withCard.gateway.get3DFormData(
        order('ORDER-1'),
        model,
        TX_TYPE.PAY_AUTH,
        cardFor(withCard.gateway),
        true,
        formFormat,
      )
      const b = await withoutCard.gateway.get3DFormData(
        order('ORDER-1'),
        model,
        TX_TYPE.PAY_AUTH,
        null,
        true,
        formFormat,
      )

      const keys = (form: ThreeDFormData | string, built: Built): string[] =>
        typeof form === 'string'
          ? built.sent.flatMap((s) => [...new URLSearchParams(s.body).keys()]).sort()
          : Object.keys(form.inputs).sort()
      expect(keys(a, withCard)).toStrictEqual(keys(b, withoutCard))
    },
  )
})
