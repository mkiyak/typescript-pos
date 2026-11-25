import { describe, expect, it, vi } from 'vitest'
import { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { AbstractRequestDataMapper } from '../../../src/data-mapper/request/mapper/AbstractRequestDataMapper.js'
import type { RequestValueFormatterInterface } from '../../../src/data-mapper/request/value-formatter/RequestValueFormatterInterface.js'
import { AbstractRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/AbstractRequestValueMapper.js'
import { AbstractResponseDataMapper } from '../../../src/data-mapper/response/mapper/AbstractResponseDataMapper.js'
import { BasicResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { AbstractResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/AbstractResponseValueMapper.js'
import {
  PosError,
  PosHttpError,
  UnsupportedFormFormatError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../../../src/errors.js'
import { CreditCardFactory } from '../../../src/factory/CreditCardFactory.js'
import {
  AbstractGateway,
  type GatewayConfig,
  type GatewayDeps,
  type SupportedTransactions,
} from '../../../src/gateway/AbstractGateway.js'
import type { PosLogger } from '../../../src/logger.js'
import { noopLogger } from '../../../src/logger.js'
import type { AbstractPosAccount } from '../../../src/model/account/AbstractPosAccount.js'
import { AssecoPosAccount } from '../../../src/model/account/AssecoPosAccount.js'
import type { CreditCard } from '../../../src/model/card/CreditCard.js'
import {
  CURRENCY,
  FORM_FORMAT,
  type FormFormat,
  LANG,
  MODEL,
  type PaymentModel,
  TX_TYPE,
  type TxType,
} from '../../../src/PosInterface.js'
import type { GatewayResponseData, PosHooks, PosOrder, PosResponse, ThreeDFormData } from '../../../src/types.js'

// ---------- stubs ----------

class StubValueMapper extends AbstractRequestValueMapper {
  protected override cardTypeMappings = { visa: 'V', master: 'M' }
  protected override langMappings = { [LANG.TR]: 'tr', [LANG.EN]: 'en' }
}

const stubFormatter: RequestValueFormatterInterface = {
  formatInstallment: (n) => n,
  formatAmount: (n) => n,
  formatCardExpDate: () => '',
  formatDateTime: () => '',
}

const stubCrypt: CryptInterface = {
  create3DHash: (_a, inputs) => `hash(${Object.keys(inputs).join(',')})`,
  check3DHash: () => true,
  createHash: () => '',
  generateRandomString: () => 'RND',
  hashString: (s) => s,
  hashFromParams: () => '',
}

class StubRequestDataMapper extends AbstractRequestDataMapper {
  create3DPaymentRequestData(_a: AbstractPosAccount, order: PosOrder, txType: TxType) {
    return { kind: '3d', id: order.id, txType }
  }
  createNonSecurePaymentRequestData(_a: AbstractPosAccount, order: PosOrder, txType: TxType, card: CreditCard) {
    return { kind: 'regular', id: order.id, txType, pan: card.getNumber() }
  }
  createNonSecurePostAuthPaymentRequestData(_a: AbstractPosAccount, order: PosOrder) {
    return { kind: 'post', id: order.id }
  }
  createStatusRequestData(_a: AbstractPosAccount, order: PosOrder) {
    return { kind: 'status', id: order.id }
  }
  createCancelRequestData(_a: AbstractPosAccount, order: PosOrder) {
    return { kind: 'cancel', id: order.id }
  }
  createRefundRequestData(_a: AbstractPosAccount, order: PosOrder, refundTxType: TxType) {
    return { kind: 'refund', id: order.id, txType: refundTxType }
  }
  createOrderHistoryRequestData(_a: AbstractPosAccount, order: PosOrder) {
    return { kind: 'history', id: order.id }
  }
  async create3DFormData(
    account: AbstractPosAccount,
    order: PosOrder | null,
    paymentModel: PaymentModel,
    txType: TxType,
    gatewayURL: string,
    card?: CreditCard | null,
  ): Promise<ThreeDFormData> {
    let inputs: Record<string, string> = { oid: String(order?.id), card: card ? 'yes' : 'no' }
    inputs = await this.dispatchBefore3DFormHashCalculated(
      inputs,
      account.getBankName(),
      txType,
      paymentModel,
      'StubGateway',
    )
    return {
      gateway: gatewayURL,
      method: 'POST',
      inputs: { ...inputs, hash: this.crypt.create3DHash(account, inputs) },
    }
  }
}

class StubResponseDataMapper extends AbstractResponseDataMapper {
  private map(raw: Record<string, unknown>, txType: TxType | null): PosResponse {
    return {
      ...this.getDefaultPaymentResponse(txType ?? TX_TYPE.STATUS, null),
      order_id: (raw.order_id as string | undefined) ?? null,
      status: 'approved',
      all: raw,
    }
  }
  mapPaymentResponse = (raw: Record<string, unknown>, txType: TxType): PosResponse => this.map(raw, txType)
  map3DPaymentData = (raw: Record<string, unknown>): PosResponse => this.map(raw, null)
  map3DPayResponseData = (raw: Record<string, unknown>): PosResponse => this.map(raw, null)
  map3DHostResponseData = (raw: Record<string, unknown>): PosResponse => this.map(raw, null)
  mapRefundResponse = (raw: Record<string, unknown>): PosResponse => this.map(raw, TX_TYPE.REFUND)
  mapCancelResponse = (raw: Record<string, unknown>): PosResponse => this.map(raw, TX_TYPE.CANCEL)
  mapStatusResponse = (raw: Record<string, unknown>): PosResponse => this.map(raw, TX_TYPE.STATUS)
  mapOrderHistoryResponse = (raw: Record<string, unknown>): PosResponse => this.map(raw, TX_TYPE.ORDER_HISTORY)
  extractMdStatus = (raw: Record<string, unknown>): string | null => (raw.mdStatus as string | undefined) ?? null
  is3dAuthSuccess = (md: string | null): boolean => md === '1'
  protected getProcReturnCode(raw: Record<string, unknown>): string | null {
    return Object.hasOwn(raw, 'code') && typeof raw.code === 'string' ? raw.code : null
  }
}

const routed = (route: string): PosResponse => ({
  status: 'approved',
  order_id: null,
  proc_return_code: null,
  error_code: null,
  error_message: null,
  all: null,
  route,
})

class StubGateway extends AbstractGateway {
  static override readonly GATEWAY_CLASS: string = 'StubGateway'
  protected static override supportedTransactions: SupportedTransactions = {
    [TX_TYPE.PAY_AUTH]: [
      MODEL.THREE_D_SECURE,
      MODEL.THREE_D_PAY,
      MODEL.THREE_D_HOST,
      MODEL.THREE_D_PAY_HOSTING,
      MODEL.NON_SECURE,
    ],
    [TX_TYPE.PAY_PRE_AUTH]: [MODEL.THREE_D_SECURE, MODEL.NON_SECURE],
    [TX_TYPE.PAY_POST_AUTH]: true,
    [TX_TYPE.STATUS]: true,
    [TX_TYPE.CANCEL]: true,
    [TX_TYPE.REFUND]: true,
    [TX_TYPE.REFUND_PARTIAL]: true,
    [TX_TYPE.ORDER_HISTORY]: false,
  }

  async make3DPayment(
    _data: GatewayResponseData,
    _order: PosOrder,
    _txType: TxType,
    _card?: CreditCard | null,
  ): Promise<PosResponse> {
    return routed('make3DPayment')
  }
  async make3DPayPayment(): Promise<PosResponse> {
    return routed('make3DPayPayment')
  }
  async make3DHostPayment(): Promise<PosResponse> {
    return routed('make3DHostPayment')
  }
  async get3DFormData(
    order: PosOrder,
    paymentModel: PaymentModel,
    txType: TxType,
    card: CreditCard | null = null,
    createWithoutCard = false,
    formFormat: FormFormat | null = null,
  ): Promise<ThreeDFormData | string> {
    this.check3DFormInputs(paymentModel, txType, card, createWithoutCard)
    if (formFormat === FORM_FORMAT.HTML) throw new UnsupportedFormFormatError()
    return this.requestDataMapper.create3DFormData(
      this.account,
      order,
      paymentModel,
      txType,
      this.get3DGatewayURL(paymentModel),
      card,
    )
  }
  authSuccess(data: Record<string, unknown>): boolean {
    return this.is3dAuthSuccess(data)
  }
  prepare(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.dispatchRequestDataPrepared(data, TX_TYPE.STATUS, { id: 'X' }, MODEL.NON_SECURE)
  }
}

class EchoClient extends AbstractHttpClient {
  supportsTx(): boolean {
    return true
  }
}

type Sent = { url: string; body: Record<string, unknown> }

function echoTransport(sent: Sent[], delayFor: (body: Record<string, unknown>) => number = () => 0): HttpTransport {
  const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    sent.push({ url: String(url), body })
    await new Promise((r) => setTimeout(r, delayFor(body)))
    return new Response(JSON.stringify({ order_id: body.id, code: '00', echo: body }), { status: 200 })
  }
  return new HttpTransport({ fetch: fakeFetch as typeof fetch })
}

const config: GatewayConfig = {
  name: 'Stub Bank',
  class: 'StubGateway',
  gateway_endpoints: {
    payment_api: 'https://bank.test/api',
    gateway_3d: 'https://bank.test/3d',
    gateway_3d_host: 'https://bank.test/3d-host',
  },
}

function build(
  opts: {
    hooks?: PosHooks
    logger?: PosLogger
    transport?: HttpTransport
    config?: GatewayConfig
    Gateway?: typeof StubGateway
  } = {},
) {
  const hooks = opts.hooks ?? {}
  const logger = opts.logger ?? noopLogger
  const valueMapper = new StubValueMapper()
  const requestDataMapper = new StubRequestDataMapper(valueMapper, stubFormatter, hooks, stubCrypt)
  const deps: GatewayDeps = {
    requestValueMapper: valueMapper,
    requestValueFormatter: stubFormatter,
    requestDataMapper,
    responseDataMapper: new StubResponseDataMapper(new BasicResponseValueFormatter(), new StubValueMapperResp()),
    crypt: stubCrypt,
    clientStrategy: new HttpClientStrategy([
      new EchoClient('https://bank.test/api', opts.transport ?? echoTransport([]), logger),
    ]),
    logger,
    hooks,
  }
  const account = new AssecoPosAccount('stubbank', 'M1', 'user', 'pass', 'key')
  const Gateway = opts.Gateway ?? StubGateway
  return { gateway: new Gateway(opts.config ?? config, account, deps), requestDataMapper, account }
}

class StubValueMapperResp extends AbstractResponseValueMapper {}

const spyLogger = () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return logger
}

const card = CreditCardFactory.create('4111111111111111', '30', '12', '123', 'John', 'visa')
const callback: GatewayResponseData = { mdStatus: '1', oid: 'O1' }

// ---------- tests ----------

describe('AbstractGateway', () => {
  describe('payment() routing', () => {
    it.each([
      [MODEL.THREE_D_SECURE, 'make3DPayment'],
      [MODEL.THREE_D_PAY, 'make3DPayPayment'],
      [MODEL.THREE_D_PAY_HOSTING, 'make3DPayPayment'],
      [MODEL.THREE_D_HOST, 'make3DHostPayment'],
    ] as const)('%s -> %s', async (model, route) => {
      const { gateway } = build()
      const res = await gateway.payment(model, { id: 'O1' }, TX_TYPE.PAY_AUTH, null, callback)
      expect(res.route).toBe(route)
    })

    it('passes the card to make3DPayment', async () => {
      const { gateway } = build()
      const spy = vi.spyOn(gateway, 'make3DPayment')
      const order = { id: 'O1' }
      await gateway.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, card, callback)
      expect(spy).toHaveBeenCalledWith(callback, order, TX_TYPE.PAY_AUTH, card)
    })

    it('non-secure -> makeRegularPayment (sends request, maps response)', async () => {
      const sent: Sent[] = []
      const { gateway } = build({ transport: echoTransport(sent) })
      const spy = vi.spyOn(gateway, 'makeRegularPayment')
      const res = await gateway.payment(MODEL.NON_SECURE, { id: 'O1' }, TX_TYPE.PAY_AUTH, card)
      expect(spy).toHaveBeenCalledOnce()
      expect(sent[0]?.body).toEqual({ kind: 'regular', id: 'O1', txType: 'pay', pan: '4111111111111111' })
      expect(res.order_id).toBe('O1')
      expect(res.transaction_type).toBe('pay')
    })

    it('post-auth -> makeRegularPostPayment regardless of model', async () => {
      const sent: Sent[] = []
      const { gateway } = build({ transport: echoTransport(sent) })
      const spy = vi.spyOn(gateway, 'makeRegularPostPayment')
      const res = await gateway.payment(MODEL.THREE_D_SECURE, { id: 'O2' }, TX_TYPE.PAY_POST_AUTH)
      expect(spy).toHaveBeenCalledWith({ id: 'O2' })
      expect(sent[0]?.body).toEqual({ kind: 'post', id: 'O2' })
      expect(res.transaction_type).toBe('post')
    })

    it('unsupported tx/model combination -> UnsupportedTransactionTypeError', async () => {
      const { gateway } = build()
      await expect(
        gateway.payment(MODEL.THREE_D_PAY, { id: 'O1' }, TX_TYPE.PAY_PRE_AUTH, null, callback),
      ).rejects.toThrow(UnsupportedTransactionTypeError)
      await expect(gateway.payment(MODEL.NON_SECURE, { id: 'O1' }, TX_TYPE.REFUND, card)).rejects.toThrow(
        UnsupportedTransactionTypeError,
      )
    })

    it('unknown payment model -> UnsupportedPaymentModelError', async () => {
      class AllTx extends StubGateway {
        protected static override supportedTransactions: SupportedTransactions = { [TX_TYPE.PAY_AUTH]: true }
      }
      const { gateway } = build({ Gateway: AllTx })
      await expect(
        gateway.payment('bogus' as PaymentModel, { id: 'O1' }, TX_TYPE.PAY_AUTH, null, callback),
      ).rejects.toThrow(UnsupportedPaymentModelError)
    })

    it('non-secure without card -> error', async () => {
      const { gateway } = build()
      await expect(gateway.payment(MODEL.NON_SECURE, { id: 'O1' }, TX_TYPE.PAY_AUTH)).rejects.toThrow(PosError)
    })

    it.each([[null], [{}]])('3D model without bank callback data (%j) -> error', async (data) => {
      const { gateway } = build()
      await expect(gateway.payment(MODEL.THREE_D_SECURE, { id: 'O1' }, TX_TYPE.PAY_AUTH, card, data)).rejects.toThrow(
        /3D auth response data/,
      )
    })
  })

  describe('makeRegularPayment', () => {
    it('rejects non-payment tx types', async () => {
      const { gateway } = build()
      await expect(gateway.makeRegularPayment({ id: 'O1' }, card, TX_TYPE.REFUND)).rejects.toThrow(
        UnsupportedTransactionTypeError,
      )
    })
  })

  describe('get3DFormData / check3DFormInputs', () => {
    it('3D secure without card and createWithoutCard=false -> error', async () => {
      const { gateway } = build()
      await expect(gateway.get3DFormData({ id: 'O1' }, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH)).rejects.toThrow(
        'Card data is required for this payment model',
      )
      await expect(gateway.get3DFormData({ id: 'O1' }, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, null)).rejects.toThrow(
        PosError,
      )
    })

    it('3D secure without card is allowed when createWithoutCard=true', async () => {
      const { gateway } = build()
      const form = await gateway.get3DFormData({ id: 'O1' }, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, null, true)
      expect(form).toEqual({
        gateway: 'https://bank.test/3d',
        method: 'POST',
        inputs: { oid: 'O1', card: 'no', hash: 'hash(oid,card)' },
      })
    })

    it('3D host does not need a card and uses gateway_3d_host', async () => {
      const { gateway } = build()
      const form = (await gateway.get3DFormData({ id: 'O1' }, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)) as ThreeDFormData
      expect(form.gateway).toBe('https://bank.test/3d-host')
    })

    it('3D host with a card -> error', async () => {
      const { gateway } = build()
      await expect(gateway.get3DFormData({ id: 'O1' }, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, card)).rejects.toThrow(
        /Do not use \[3d_host\] payment model with card data.*\[3d, 3d_pay, regular\]/,
      )
    })

    it('unsupported model for the tx type -> UnsupportedTransactionTypeError listing supported models', async () => {
      const { gateway } = build()
      await expect(gateway.get3DFormData({ id: 'O1' }, MODEL.THREE_D_PAY, TX_TYPE.PAY_PRE_AUTH, card)).rejects.toThrow(
        /supports \[3d, regular\] payment model\(s\) for transaction type \[pre\].*\[3d_pay\]/,
      )
    })

    it('non-3D tx type -> UnsupportedTransactionTypeError', async () => {
      const { gateway } = build()
      await expect(gateway.get3DFormData({ id: 'O1' }, MODEL.THREE_D_SECURE, TX_TYPE.REFUND, card)).rejects.toThrow(
        /Supported transaction types: \[pay, pre\]/,
      )
    })

    it('onBefore3DFormHashCalculated hooks can change the inputs before hashing', async () => {
      const { gateway } = build({
        hooks: {
          onBefore3DFormHashCalculated: [
            (e) => {
              e.formInputs.extra = 'x'
            },
          ],
        },
      })
      const form = (await gateway.get3DFormData(
        { id: 'O1' },
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        card,
      )) as ThreeDFormData
      expect(form.inputs).toEqual({ oid: 'O1', card: 'yes', extra: 'x', hash: 'hash(oid,card,extra)' })
    })
  })

  describe('onRequestDataPrepared hook', () => {
    it('replaced request data reaches the HTTP client and the change is logged at debug (masked)', async () => {
      const sent: Sent[] = []
      const logger = spyLogger()
      const events: unknown[] = []
      const { gateway } = build({
        transport: echoTransport(sent),
        logger,
        hooks: {
          onRequestDataPrepared: [
            async (e) => {
              events.push({
                bankName: e.bankName,
                txType: e.txType,
                gatewayClass: e.gatewayClass,
                paymentModel: e.paymentModel,
                order: e.order,
              })
              e.requestData = { ...e.requestData, injected: 'yes', Password: 'top-secret' }
            },
          ],
        },
      })
      const res = await gateway.refund({ id: 'R1', amount: 10 })
      expect(sent[0]?.body).toEqual({
        kind: 'refund',
        id: 'R1',
        txType: 'refund',
        injected: 'yes',
        Password: 'top-secret',
      })
      expect((res.all as Record<string, unknown>).echo).toEqual(sent[0]?.body)
      expect(events).toEqual([
        {
          bankName: 'stubbank',
          txType: 'refund',
          gatewayClass: 'StubGateway',
          paymentModel: 'regular',
          order: { id: 'R1', amount: 10 },
        },
      ])
      const call = logger.debug.mock.calls.find(([msg]) => msg === 'Request data is changed via listeners')
      expect(call).toBeDefined()
      const ctx = call?.[1] as Record<string, Record<string, unknown>>
      expect(ctx.initial_data).toEqual({ kind: 'refund', id: 'R1', txType: 'refund' })
      expect(ctx.updated_data?.injected).toBe('yes')
      expect(JSON.stringify(ctx)).not.toContain('top-secret')
    })

    it('in-place mutation is detected too', async () => {
      const sent: Sent[] = []
      const logger = spyLogger()
      const { gateway } = build({
        transport: echoTransport(sent),
        logger,
        hooks: {
          onRequestDataPrepared: [
            (e) => {
              e.requestData.mutated = true
            },
          ],
        },
      })
      await gateway.status({ id: 'S1' })
      expect(sent[0]?.body).toEqual({ kind: 'status', id: 'S1', mutated: true })
      expect(logger.debug.mock.calls.some(([msg]) => msg === 'Request data is changed via listeners')).toBe(true)
    })

    it('does not log a change when hooks leave the data untouched', async () => {
      const logger = spyLogger()
      const { gateway } = build({ logger, hooks: { onRequestDataPrepared: [() => {}] } })
      await gateway.cancel({ id: 'C1' })
      expect(logger.debug.mock.calls.some(([msg]) => msg === 'Request data is changed via listeners')).toBe(false)
    })

    it.each([
      ['makeRegularPayment', TX_TYPE.PAY_AUTH],
      ['makeRegularPostPayment', TX_TYPE.PAY_POST_AUTH],
      ['refund', TX_TYPE.REFUND],
      ['cancel', TX_TYPE.CANCEL],
      ['status', TX_TYPE.STATUS],
      ['orderHistory', TX_TYPE.ORDER_HISTORY],
    ] as const)('%s fires the hook with tx type %s', async (method, txType) => {
      const seen: TxType[] = []
      const { gateway } = build({ hooks: { onRequestDataPrepared: [(e) => void seen.push(e.txType)] } })
      const order = { id: 'X' }
      if (method === 'makeRegularPayment') await gateway.makeRegularPayment(order, card, TX_TYPE.PAY_AUTH)
      else await gateway[method](order)
      expect(seen).toEqual([txType])
    })
  })

  describe('dispatchRequestDataPrepared edge cases', () => {
    class Money {
      constructor(readonly value: number) {}
    }
    const changedLogged = (logger: ReturnType<typeof spyLogger>) =>
      logger.debug.mock.calls.some(([msg]) => msg === 'Request data is changed via listeners')

    it.each([[undefined], [[]]])(
      'without hooks (%j) returns the very same object, even if not cloneable',
      async (h) => {
        const logger = spyLogger()
        const { gateway } = build({ logger, hooks: h === undefined ? {} : { onRequestDataPrepared: h } })
        const data = { fn: () => 1, money: new Money(5) }
        await expect(gateway.prepare(data)).resolves.toBe(data)
        expect(changedLogged(logger)).toBe(false)
      },
    )

    it('with hooks, non-cloneable data -> PosError (not DataCloneError)', async () => {
      const { gateway } = build({ hooks: { onRequestDataPrepared: [() => {}] } })
      const p = gateway.prepare({ fn: () => 1 })
      await expect(p).rejects.toThrow(PosError)
      await expect(gateway.prepare({ fn: () => 1 })).rejects.toThrow(/cannot be cloned/)
    })

    it('with a no-op hook, class instances are kept and no change is logged', async () => {
      const logger = spyLogger()
      const { gateway } = build({ logger, hooks: { onRequestDataPrepared: [() => {}] } })
      const data = { money: new Money(5) }
      await expect(gateway.prepare(data)).resolves.toBe(data)
      expect(changedLogged(logger)).toBe(false)
    })

    it('hooks receive a frozen copy of the order; the caller order is untouched', async () => {
      const errors: unknown[] = []
      let frozen = false
      const { gateway } = build({
        hooks: {
          onRequestDataPrepared: [
            (e) => {
              frozen = Object.isFrozen(e.order)
              try {
                ;(e.order as Record<string, unknown>).id = 'hacked'
              } catch (err) {
                errors.push(err)
              }
            },
          ],
        },
      })
      const order = { id: 'R1', amount: 10 }
      const res = await gateway.refund(order)
      expect(frozen).toBe(true)
      expect(errors[0]).toBeInstanceOf(TypeError)
      expect(order).toEqual({ id: 'R1', amount: 10 })
      expect(Object.isFrozen(order)).toBe(false)
      expect(res.order_id).toBe('R1')
    })
  })

  describe('gateway class identifier', () => {
    it('hook gatewayClass comes from static GATEWAY_CLASS, not constructor.name', async () => {
      const Renamed = class X extends StubGateway {
        static override readonly GATEWAY_CLASS = 'RenamedGateway'
      }
      const seen: string[] = []
      const { gateway } = build({
        Gateway: Renamed,
        hooks: { onRequestDataPrepared: [(e) => void seen.push(e.gatewayClass)] },
      })
      await gateway.status({ id: 'S' })
      expect(seen).toEqual(['RenamedGateway'])
    })

    it('a gateway without GATEWAY_CLASS cannot be constructed', () => {
      class Nameless extends StubGateway {
        static override readonly GATEWAY_CLASS = ''
      }
      expect(() => build({ Gateway: Nameless })).toThrow(PosError)
      expect(() => build({ Gateway: Nameless })).toThrow(/GATEWAY_CLASS/)
    })
  })

  describe('statelessness', () => {
    it('two concurrent refund() calls resolve to their own responses', async () => {
      const sent: Sent[] = []
      // The first request answers last.
      const { gateway } = build({ transport: echoTransport(sent, (b) => (b.id === 'A' ? 30 : 1)) })
      const [a, b] = await Promise.all([gateway.refund({ id: 'A', amount: 5 }), gateway.refund({ id: 'B', amount: 7 })])
      expect(a.order_id).toBe('A')
      expect(b.order_id).toBe('B')
      expect(sent.map((s) => s.body.id)).toEqual(['A', 'B'])
    })

    it('gateway exposes no isSuccess/getResponse state', () => {
      const { gateway } = build()
      expect('isSuccess' in gateway).toBe(false)
      expect('getResponse' in gateway).toBe(false)
    })
  })

  describe('refund', () => {
    it('uses refund_partial when amount < order_amount', async () => {
      const sent: Sent[] = []
      const { gateway } = build({ transport: echoTransport(sent) })
      await gateway.refund({ id: 'P', amount: 5, order_amount: 10 })
      await gateway.refund({ id: 'F', amount: 10, order_amount: 10 })
      await gateway.refund({ id: 'N', amount: 10 })
      expect(sent.map((s) => s.body.txType)).toEqual(['refund_partial', 'refund', 'refund'])
    })
  })

  // addition: L3 a money request whose answer carries no result code is an unknown outcome, never a decline
  describe('unknown outcome after a money request', () => {
    const answering = (body: string | null, status = 200): HttpTransport =>
      new HttpTransport({ fetch: (async () => new Response(body, { status })) as unknown as typeof fetch })

    const moneyRequests: Array<[string, TxType, (g: StubGateway) => Promise<PosResponse>]> = [
      ['makeRegularPayment (pay)', TX_TYPE.PAY_AUTH, (g) => g.makeRegularPayment({ id: 'O1' }, card, TX_TYPE.PAY_AUTH)],
      [
        'makeRegularPayment (pre)',
        TX_TYPE.PAY_PRE_AUTH,
        (g) => g.makeRegularPayment({ id: 'O1' }, card, TX_TYPE.PAY_PRE_AUTH),
      ],
      ['makeRegularPostPayment', TX_TYPE.PAY_POST_AUTH, (g) => g.makeRegularPostPayment({ id: 'O1' })],
      ['refund (full)', TX_TYPE.REFUND, (g) => g.refund({ id: 'O1', amount: 10 })],
      ['refund (partial)', TX_TYPE.REFUND_PARTIAL, (g) => g.refund({ id: 'O1', amount: 5, order_amount: 10 })],
    ]
    const resultless: Array<[string, string | null, number]> = [
      ['an empty JSON object', '{}', 200],
      ['an unrelated field only', '{"unrelated":"x"}', 200],
      ['HTTP 204', null, 204],
      ['a blank code', '{"code":"   "}', 200],
      ['an empty code', '{"code":""}', 200],
      ['a null code', '{"code":null}', 200],
      ['a list code', '{"code":["00"]}', 200],
      // addition: L3 (ruling) a code with surrounding whitespace is not the bank's exact code
      ['a code with a leading blank', '{"code":" 00"}', 200],
      ['a code with a trailing newline', '{"code":"05\\n"}', 200],
    ]
    const cases = moneyRequests.flatMap(([name, txType, call]) =>
      resultless.map(([answer, body, status]) => [name, answer, txType, call, body, status] as const),
    )

    it.each(cases)('%s answered with %s -> PosHttpError', async (_name, _answer, txType, call, body, status) => {
      const logger = spyLogger()
      const { gateway } = build({ transport: answering(body, status), logger })
      const mapper = (gateway as unknown as { responseDataMapper: StubResponseDataMapper }).responseDataMapper
      const mapPayment = vi.spyOn(mapper, 'mapPaymentResponse')
      const mapRefund = vi.spyOn(mapper, 'mapRefundResponse')

      const err = (await call(gateway).catch((e: unknown) => e)) as PosHttpError

      expect(err).toBeInstanceOf(PosHttpError)
      expect(err.message).toBe('Bank answer carries no result; the outcome is unknown')
      expect(err.url).toBe(config.gateway_endpoints.payment_api)
      expect(err.status).toBeUndefined()
      expect(logger.error).toHaveBeenCalledWith('bank answer carries no result; the outcome is unknown', {
        tx_type: txType,
        gateway: 'StubGateway',
      })
      expect(mapPayment).not.toHaveBeenCalled()
      expect(mapRefund).not.toHaveBeenCalled()
    })

    it.each(moneyRequests)('%s with a result code is still mapped', async (_name, _txType, call) => {
      const { gateway } = build({ transport: answering('{"code":"05","order_id":"O1"}') })
      const res = await call(gateway)
      expect(res.order_id).toBe('O1')
      expect(res.all).toStrictEqual({ code: '05', order_id: 'O1' })
    })

    it.each([
      ['cancel', (g: StubGateway) => g.cancel({ id: 'O1' }), 'mapCancelResponse'],
      ['status', (g: StubGateway) => g.status({ id: 'O1' }), 'mapStatusResponse'],
      ['orderHistory', (g: StubGateway) => g.orderHistory({ id: 'O1' }), 'mapOrderHistoryResponse'],
    ] as const)('%s with {} still reaches the mapper (no money moves twice)', async (_name, call, method) => {
      const { gateway } = build({ transport: answering('{}') })
      const mapper = (gateway as unknown as { responseDataMapper: StubResponseDataMapper }).responseDataMapper
      const spy = vi.spyOn(mapper, method)
      const res = await call(gateway)
      expect(spy).toHaveBeenCalledWith({})
      expect(res.all).toStrictEqual({})
    })
  })

  describe('3D auth helper', () => {
    it('is3dAuthSuccess delegates to the response mapper and logs', () => {
      const logger = spyLogger()
      const { gateway } = build({ logger })
      expect(gateway.authSuccess({ mdStatus: '1' })).toBe(true)
      expect(logger.info).toHaveBeenCalledWith('3d auth success', { md_status: '1' })
      expect(gateway.authSuccess({ mdStatus: '0' })).toBe(false)
      expect(logger.error).toHaveBeenCalledWith('3d auth fail', { md_status: '0' })
    })
  })

  describe('sync accessors', () => {
    it('isSupportedTransaction reads the subclass table', () => {
      expect(StubGateway.isSupportedTransaction(TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY)).toBe(true)
      expect(StubGateway.isSupportedTransaction(TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_PAY)).toBe(false)
      expect(StubGateway.isSupportedTransaction(TX_TYPE.REFUND, MODEL.THREE_D_PAY)).toBe(true)
      expect(StubGateway.isSupportedTransaction(TX_TYPE.ORDER_HISTORY, MODEL.NON_SECURE)).toBe(false)
      expect(StubGateway.isSupportedTransaction(TX_TYPE.INTERNAL_3D_FORM_BUILD, MODEL.NON_SECURE)).toBe(false)
      expect(AbstractGateway.isSupportedTransaction(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE)).toBe(false)
    })

    it('get3DGatewayURL', () => {
      const { gateway } = build()
      expect(gateway.get3DGatewayURL()).toBe('https://bank.test/3d')
      expect(gateway.get3DGatewayURL(MODEL.THREE_D_PAY)).toBe('https://bank.test/3d')
      expect(gateway.get3DGatewayURL(MODEL.THREE_D_HOST)).toBe('https://bank.test/3d-host')
      const { gateway: noHost } = build({
        config: { ...config, gateway_endpoints: { payment_api: 'x', gateway_3d: 'https://bank.test/3d' } },
      })
      expect(noHost.get3DGatewayURL(MODEL.THREE_D_HOST)).toBe('https://bank.test/3d')
      const { gateway: no3d } = build({ config: { ...config, gateway_endpoints: { payment_api: 'x' } } })
      expect(() => no3d.get3DGatewayURL()).toThrow(/gateway_3d/)
    })

    it('test mode is off by default and forwarded to the request mapper when configured', () => {
      const off = build()
      expect(off.gateway.isTestMode()).toBe(false)
      expect(off.requestDataMapper.isTestMode()).toBe(false)

      const logger = spyLogger()
      const on = build({ config: { ...config, test_mode: true }, logger })
      expect(on.gateway.isTestMode()).toBe(true)
      expect(on.requestDataMapper.isTestMode()).toBe(true)
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('test_mode gateway setting does not affect request data'),
        expect.objectContaining({ gateway: 'StubGateway' }),
      )
    })

    it('card types, currencies, languages, account and crypt', () => {
      const { gateway, account } = build()
      expect(gateway.getCardTypeMapping()).toEqual({ visa: 'V', master: 'M' })
      expect(gateway.getCurrencies()).toEqual([
        CURRENCY.TRY,
        CURRENCY.USD,
        CURRENCY.EUR,
        CURRENCY.GBP,
        CURRENCY.JPY,
        CURRENCY.RUB,
      ])
      expect(gateway.getLanguages()).toEqual(['tr', 'en'])
      expect(gateway.getAccount()).toBe(account)
      expect(gateway.getCrypt()).toBe(stubCrypt)
    })

    it('works with CreditCardFactory.createForGateway', () => {
      const { gateway } = build()
      expect(
        CreditCardFactory.createForGateway(gateway, '4111111111111111', '30', '12', '123', null, 'visa'),
      ).toBeTruthy()
      expect(() => CreditCardFactory.createForGateway(gateway, '4111111111111111', '30', '12', '123')).toThrow()
    })
  })
})
