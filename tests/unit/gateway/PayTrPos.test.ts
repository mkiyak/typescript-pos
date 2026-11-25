import { createHmac } from 'node:crypto'
import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import type { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { PayTrPosCrypt } from '../../../src/crypt/PayTrPosCrypt.js'
import { PayTrPosRequestDataMapper } from '../../../src/data-mapper/request/mapper/PayTrPosRequestDataMapper.js'
import type { RequestDataMapperInterface } from '../../../src/data-mapper/request/mapper/RequestDataMapperInterface.js'
import { PayTrPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/PayTrPosRequestValueFormatter.js'
import { PayTrPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/PayTrPosRequestValueMapper.js'
import { PayTrPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/PayTrPosResponseDataMapper.js'
import type { ResponseDataMapperInterface } from '../../../src/data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { PayTrPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/PayTrPosResponseValueFormatter.js'
import { PayTrPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PayTrPosResponseValueMapper.js'
import {
  HashMismatchError,
  NotImplementedError,
  OrderMismatchError,
  PosError,
  PosHttpError,
  UnsupportedFormFormatError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../src/factory/CreditCardFactory.js'
import { PosFactory } from '../../../src/factory/PosFactory.js'
import { PosHttpClientStrategyFactory } from '../../../src/factory/PosHttpClientStrategyFactory.js'
import type { GatewayConfig, GatewayDeps } from '../../../src/gateway/AbstractGateway.js'
import { PayTrPos } from '../../../src/gateway/PayTrPos.js'
import type { PosLogger } from '../../../src/logger.js'
import type { PayTrPosAccount } from '../../../src/model/account/PayTrPosAccount.js'
import {
  CURRENCY,
  FORM_FORMAT,
  LANG,
  MODEL,
  type PaymentModel,
  TX_TYPE,
  type TxType,
} from '../../../src/PosInterface.js'
import type {
  GatewayResponseData,
  PosHooks,
  PosOrder,
  RequestDataPreparedEvent,
  ThreeDFormData,
} from '../../../src/types.js'

// The first section replaces the collaborators with vi.fn() fakes (except the request value mapper); the end-to-end
// sections use the real crypt, mappers and HTTP client over a fake fetch that answers like the bank (by path), checks
// the token of every request and records every request.

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

/** The crypt account of the notification vectors: salt `YEUa…`, key `wWwU…`. */
const PT_SALT = 'YEUaNcdHXqyt7hjt'
const PT_KEY = 'wWwU8buJp6jo1r25'
const PT = AccountFactory.createPayTrPosAccount('paytr', '123456', PT_SALT, PT_KEY)
/** The mapper/gateway account (salt and key swapped): requests are signed with it. */
const PM_SALT = 'wWwU8buJp6jo1r25'
const PM_KEY = 'YEUaNcdHXqyt7hjt'
const PM = AccountFactory.createPayTrPosAccount('paytr', '123456', PM_SALT, PM_KEY)

/** base64 HMAC-SHA256 of the UTF-8 message. */
const H = (message: string, key: string): string => createHmac('sha256', key).update(message, 'utf8').digest('base64')
/** The notification hash (signed with PT). */
const NOTE = (oid: string, status: string, total: string): string => H(`${oid}${PT_SALT}${status}${total}`, PT_KEY)

/** A notification body signed with PT over its order id, status and total (`undefined` in `over` drops a key). */
const notification = (oid: string, status: string, total: string, over: Data = {}): Data => {
  const body: Data = {
    merchant_oid: oid,
    status,
    total_amount: total,
    hash: NOTE(oid, status, total),
    payment_type: 'card',
    currency: 'TL',
    ...over,
  }
  for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key]
  return body
}

/** NV1: the 3D Host approval fixture. */
const nv1 = (over: Data = {}): Data => notification('20260624B505', 'success', '1001', over)
/** NV2: the 3D Pay approval fixture. */
const nv2 = (over: Data = {}): Data => notification('20260623E335', 'success', '1001', over)
/** NV4: a signed decline. */
const nv4 = (over: Data = {}): Data => notification('order-host-fail', 'failed', '0', over)
/** NV5, NV6, NV7: ORDER42 approvals of 11.00, 10.50 and 10.49. */
const nv5 = (over: Data = {}): Data => notification('ORDER42', 'success', '1100', over)
const nv6 = (over: Data = {}): Data => notification('ORDER42', 'success', '1050', over)
const nv7 = (over: Data = {}): Data => notification('ORDER42', 'success', '1049', over)

const cb = (data: Data): GatewayResponseData => data as GatewayResponseData

const createLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })

const buyerFields = {
  ip: '127.0.0.1',
  buyer: { email: 'test@example.com', name: 'John Doe', gsm_number: '05001234567' },
  billing_address: { address: 'Test Sokak No:1 Istanbul' },
}

describe('PayTrPos planning vectors', () => {
  // addition: NV0-NV7 recomputed with node:crypto (PT)
  it.each([
    ['NV0', NOTE('202606234E4E', 'success', '1001'), 'ZDVOQUw4aDJhNR5dWYBC5bD95bLtSOtj9DzzSQ9sUHs='],
    ['NV1', nv1().hash, '+jxQ32k1XbdS6i7iBQecCZ7fFhRrStaZBMvbsRzRVZE='],
    ['NV2', nv2().hash, 'kwKu739W963OrNp5CSIecYlBpp8x2mql1wDWtSWZhjc='],
    ['NV4', nv4().hash, 'Gsziv4HgGOh5m6Ao8nhj8mmgaeAtUNq9erZSpJCqw1E='],
    ['NV5', nv5().hash, 'pBFm4R9p/FFX+TO4mhNrY0A9oieV+/MEXN8vUpvCp88='],
    ['NV6', nv6().hash, 'nyBkxGxY4WhyEnO/XVEQMmxTv7TXC2EQ0n9IwCkn4rA='],
    ['NV7', nv7().hash, 'Pt2OXVpV406Fe9yxREZwq13dKgdkH+CycFDaV9wzYis='],
  ])('%s', (_name, actual, expected) => {
    expect(actual).toBe(expected)
  })

  // addition: the fixtures verify with PT, not with PM
  it('the notification fixtures verify with PT only', () => {
    const crypt = new PayTrPosCrypt()
    for (const body of [nv1(), nv2(), nv4(), nv5(), nv6(), nv7()]) {
      expect(crypt.check3DHash(PT, cb(body))).toBe(true)
      expect(crypt.check3DHash(PM, cb(body))).toBe(false)
    }
  })
})

describe('PayTrPos (mocked collaborators)', () => {
  const config: GatewayConfig = {
    name: 'PayTR',
    class: 'PayTrPos',
    gateway_endpoints: {
      payment_api: 'https://www.paytr.com',
      gateway_3d: 'https://www.paytr.com/odeme',
      gateway_3d_host: 'https://www.paytr.com/odeme/guvenli',
    },
  }

  /** `disable_3d_hash_check` is not an option; passing it must have no effect. */
  const configWithHashCheckDisabled = {
    ...config,
    gateway_configs: { disable_3d_hash_check: true },
  } as unknown as GatewayConfig

  let requestValueMapper: PayTrPosRequestValueMapper
  let requestMapper: Mocked<RequestDataMapperInterface>
  let responseMapper: Mocked<ResponseDataMapperInterface>
  let crypt: Mocked<CryptInterface>
  let httpClient: { supportsTx: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }
  let clientStrategy: { getClient: ReturnType<typeof vi.fn>; getAllClients: ReturnType<typeof vi.fn> }
  let requestDataPrepared: ReturnType<typeof vi.fn<(e: RequestDataPreparedEvent) => void>>
  let logger: ReturnType<typeof createLogger>
  let pos: PayTrPos

  const createGateway = (cfg: GatewayConfig): PayTrPos => {
    const hooks: PosHooks = { onRequestDataPrepared: [requestDataPrepared] }
    const deps: GatewayDeps<PayTrPosAccount> = {
      requestValueMapper,
      requestValueFormatter: new PayTrPosRequestValueFormatter(),
      requestDataMapper: requestMapper as unknown as RequestDataMapperInterface<PayTrPosAccount>,
      responseDataMapper: responseMapper as unknown as ResponseDataMapperInterface,
      crypt: crypt as unknown as CryptInterface<PayTrPosAccount>,
      clientStrategy: clientStrategy as unknown as HttpClientStrategy,
      logger,
      hooks,
    }
    return new PayTrPos(cfg, PM, deps)
  }

  beforeEach(() => {
    requestValueMapper = new PayTrPosRequestValueMapper()
    requestMapper = {
      isTestMode: vi.fn(),
      setTestMode: vi.fn(),
      create3DFormData: vi.fn(),
      create3DPaymentRequestData: vi.fn(),
      createNonSecurePaymentRequestData: vi.fn(),
      createNonSecurePostAuthPaymentRequestData: vi.fn(),
      createStatusRequestData: vi.fn(),
      createCancelRequestData: vi.fn(),
      createRefundRequestData: vi.fn(),
      createOrderHistoryRequestData: vi.fn(),
      create3DFormInitializeRequestData: vi.fn(),
    }
    responseMapper = {
      mapPaymentResponse: vi.fn(),
      map3DPaymentData: vi.fn(),
      map3DPayResponseData: vi.fn(),
      map3DHostResponseData: vi.fn(),
      mapRefundResponse: vi.fn(),
      mapCancelResponse: vi.fn(),
      mapStatusResponse: vi.fn(),
      mapOrderHistoryResponse: vi.fn(),
      extractMdStatus: vi.fn(),
      is3dAuthSuccess: vi.fn(),
    }
    crypt = {
      hashString: vi.fn(),
      check3DHash: vi.fn(),
      create3DHash: vi.fn(),
      createHash: vi.fn(),
      hashFromParams: vi.fn(),
      generateRandomString: vi.fn(),
    }
    httpClient = { supportsTx: vi.fn(), request: vi.fn() }
    clientStrategy = { getClient: vi.fn(), getAllClients: vi.fn() }
    requestDataPrepared = vi.fn()
    logger = createLogger()
    pos = createGateway(config)
  })

  const card = () => CreditCardFactory.create('4355084355084358', '30', '12', '000', 'John Doe')

  /** One client call, one hook dispatch that adds a marker the client must receive. */
  const configureClientResponse = (
    txType: TxType,
    requestData: Data,
    decodedResponse: Data,
    order: PosOrder,
    paymentModel: PaymentModel,
  ): (() => void) => {
    clientStrategy.getClient.mockReturnValue(httpClient as unknown as AbstractHttpClient)
    httpClient.request.mockResolvedValue(decodedResponse)
    requestDataPrepared.mockImplementation((event) => {
      expect(event.gatewayClass).toBe('PayTrPos')
      expect(event.txType).toBe(txType)
      expect(event.requestData).toStrictEqual(requestData)
      expect(event.order).toStrictEqual(order)
      expect(event.paymentModel).toBe(paymentModel)
      event.requestData['test-event-marker'] = true
    })

    return () => {
      expect(clientStrategy.getClient).toHaveBeenCalledTimes(1)
      expect(clientStrategy.getClient).toHaveBeenCalledWith(txType, paymentModel)
      expect(requestDataPrepared).toHaveBeenCalledTimes(1)
      expect(httpClient.request).toHaveBeenCalledTimes(1)
      const [tx, model, data, sentOrder, url] = httpClient.request.mock.calls[0] as unknown[]
      expect([tx, model, sentOrder, url]).toStrictEqual([txType, paymentModel, order, null])
      expect((data as Data)['test-event-marker']).toBe(true)
    }
  }

  const expectNoRequest = () => {
    expect(httpClient.request).not.toHaveBeenCalled()
    expect(requestDataPrepared).not.toHaveBeenCalled()
  }

  it('init', () => {
    expect(pos.getAccount()).toBe(PM)
    expect(pos.isTestMode()).toBe(false)
    expect(pos.getCrypt()).toBe(crypt)
  })

  // addition: identifiers and the supported transactions table
  it('exposes NAME, the gateway class identifier and the supported transactions', () => {
    expect(PayTrPos.NAME).toBe('PayTrPos')
    expect(PayTrPos.GATEWAY_CLASS).toBe('PayTrPos')
    for (const model of [MODEL.THREE_D_HOST, MODEL.THREE_D_PAY, MODEL.NON_SECURE]) {
      expect(PayTrPos.isSupportedTransaction(TX_TYPE.PAY_AUTH, model)).toBe(true)
    }
    expect(PayTrPos.isSupportedTransaction(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE)).toBe(false)
    for (const tx of [TX_TYPE.STATUS, TX_TYPE.REFUND, TX_TYPE.REFUND_PARTIAL]) {
      expect(PayTrPos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(true)
    }
    for (const tx of [TX_TYPE.PAY_PRE_AUTH, TX_TYPE.PAY_POST_AUTH, TX_TYPE.CANCEL, TX_TYPE.ORDER_HISTORY]) {
      expect(PayTrPos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(false)
    }
  })

  it.each([
    [MODEL.THREE_D_PAY, 'https://www.paytr.com/odeme'],
    [MODEL.THREE_D_HOST, 'https://www.paytr.com/odeme/guvenli'],
  ] as Array<[PaymentModel, string]>)('get3DGatewayURL %s', (model, expected) => {
    expect(pos.get3DGatewayURL(model)).toBe(expected)
  })

  it('make3DPayment throws UnsupportedPaymentModelError', async () => {
    await expect(pos.make3DPayment(cb({}), {}, TX_TYPE.PAY_AUTH)).rejects.toThrow(UnsupportedPaymentModelError)
  })

  describe.each([
    ['3D Pay', MODEL.THREE_D_PAY, 'map3DPayResponseData'],
    ['3D Host', MODEL.THREE_D_HOST, 'map3DHostResponseData'],
  ] as Array<[string, PaymentModel, 'map3DPayResponseData' | 'map3DHostResponseData']>)(
    '%s notification',
    (_label, paymentModel, mapperMethod) => {
      const signedBody = (): Data => ({
        merchant_oid: '20260623E335',
        status: 'success',
        total_amount: '1001',
        hash: 'valid-hash',
        currency: 'TL',
      })
      // deviation: N8 binding needs amount and currency
      const signedOrder = (): PosOrder => ({ id: '20260623E335', amount: 10.01, currency: 'TRY', installment: 0 })

      const approvedResult = (): Data => ({
        status: 'approved',
        order_id: '20260623E335',
        currency: 'TRY',
        amount: 10.01,
        installment_count: null,
        payment_model: paymentModel,
        transaction_type: TX_TYPE.PAY_AUTH,
      })

      it('single element: no hash check', async () => {
        const body = { fail_message: '3D auth failed at payment page' }
        // deviation: N2 the order is validated
        const order: PosOrder = { id: 'order-1', amount: 10.01, currency: 'TRY' }
        responseMapper[mapperMethod].mockReturnValue({
          status: 'declined',
          error_message: '3D auth failed at payment page',
        })

        const result = await pos.payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb(body))

        expect(crypt.check3DHash).not.toHaveBeenCalled()
        expect(responseMapper[mapperMethod]).toHaveBeenCalledTimes(1)
        expect(responseMapper[mapperMethod]).toHaveBeenCalledWith(body, TX_TYPE.PAY_AUTH, order)
        // deviation: N5 the trusted browser decline: the order's id and the failure text only
        expect(result).toStrictEqual({
          order_id: 'order-1',
          transaction_id: null,
          transaction_time: null,
          transaction_type: TX_TYPE.PAY_AUTH,
          installment_count: null,
          currency: null,
          amount: null,
          payment_model: paymentModel,
          auth_code: null,
          ref_ret_num: null,
          batch_num: null,
          proc_return_code: null,
          status: 'declined',
          error_code: null,
          error_message: null,
          all: body,
          md_status: null,
          md_error_message: '3D auth failed at payment page',
          transaction_security: null,
        })
        expectNoRequest()
      })

      it('hash check passes', async () => {
        const body = signedBody()
        const order = signedOrder()
        crypt.check3DHash.mockReturnValue(true)
        responseMapper[mapperMethod].mockReturnValue({ status: 'approved', order_id: '20260623E335' })

        const result = await pos.payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb(body))

        expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
        expect(crypt.check3DHash).toHaveBeenCalledWith(PM, body)
        expect(responseMapper[mapperMethod]).toHaveBeenCalledTimes(1)
        expect(responseMapper[mapperMethod]).toHaveBeenCalledWith(body, TX_TYPE.PAY_AUTH, order)
        // deviation: N8 the approved result is completed from the order and the signed total
        expect(result).toStrictEqual(approvedResult())
        expectNoRequest()
      })

      it('hash mismatch', async () => {
        const body = {
          merchant_oid: 'order-123',
          status: 'success',
          total_amount: '1001',
          hash: 'wrong-hash',
          currency: 'TL',
        }
        crypt.check3DHash.mockReturnValue(false)

        // deviation: N2 the order is completed (it is validated first)
        await expect(pos.payment(paymentModel, signedOrder(), TX_TYPE.PAY_AUTH, null, cb(body))).rejects.toThrow(
          HashMismatchError,
        )
        expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
        expect(crypt.check3DHash).toHaveBeenCalledWith(PM, body)
        expect(responseMapper[mapperMethod]).not.toHaveBeenCalled()
        expectNoRequest()
      })

      it('hash check cannot be disabled', async () => {
        const disabled = createGateway(configWithHashCheckDisabled)
        const body = { ...signedBody(), hash: 'any-hash' }
        crypt.check3DHash.mockReturnValue(true)
        responseMapper[mapperMethod].mockReturnValue({ status: 'approved' })

        const result = await disabled.payment(paymentModel, signedOrder(), TX_TYPE.PAY_AUTH, null, cb(body))

        // deviation: N3 the check cannot be disabled
        expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
        expect(result).toStrictEqual(approvedResult())
      })

      it('3D Host success', async () => {
        const body = signedBody()
        const order = signedOrder()
        crypt.check3DHash.mockReturnValue(true)
        responseMapper[mapperMethod].mockReturnValue({ status: 'approved', order_id: '20260623E335' })

        const result = await pos.payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb(body))

        expect(crypt.check3DHash).toHaveBeenCalledWith(PM, body)
        expect(responseMapper[mapperMethod]).toHaveBeenCalledWith(body, TX_TYPE.PAY_AUTH, order)
        // deviation: N8, C7 the result is returned (no instance state) and completed from the order
        expect(result).toStrictEqual(approvedResult())
        expect(result.status).toBe('approved')
      })

      // addition: N6 the signed order id is bound before the mapper is called; nothing is attached
      it('a signed notification of another order is refused without a result', async () => {
        crypt.check3DHash.mockReturnValue(true)
        const err = (await pos
          .payment(paymentModel, { ...signedOrder(), id: '20260623E336' }, TX_TYPE.PAY_AUTH, null, cb(signedBody()))
          .catch((e: unknown) => e)) as OrderMismatchError
        expect(err).toBeInstanceOf(OrderMismatchError)
        expect(err.field).toBe('order_id')
        expect(err.response).toBeUndefined()
        expect(err.paymentMayHaveCompleted).toBe(false)
        expect(responseMapper[mapperMethod]).not.toHaveBeenCalled()
      })

      // addition: N7 fail-closed guard on the decline path
      it('a signed decline mapped as approved is refused', async () => {
        crypt.check3DHash.mockReturnValue(true)
        responseMapper[mapperMethod].mockReturnValue({ status: 'approved', order_id: '20260623E335' })
        await expect(
          pos.payment(paymentModel, signedOrder(), TX_TYPE.PAY_AUTH, null, cb({ ...signedBody(), status: 'failed' })),
        ).rejects.toThrow(PosError)
      })

      // addition: N8 a signed approval the mapper did not approve is refused
      it('a signed approval mapped as declined is refused', async () => {
        crypt.check3DHash.mockReturnValue(true)
        responseMapper[mapperMethod].mockReturnValue({ status: 'declined', order_id: '20260623E335' })
        await expect(
          pos.payment(paymentModel, signedOrder(), TX_TYPE.PAY_AUTH, null, cb(signedBody())),
        ).rejects.toThrow(PosError)
      })

      // addition: N2 a malformed order fails before the crypt
      it.each([
        ['no amount', { id: '20260623E335' }],
        ['amount 0', { id: '20260623E335', amount: 0 }],
        ['a bad id', { id: 'a b', amount: 10.01 }],
        ['a bad currency', { id: '20260623E335', amount: 10.01, currency: 'XYZ' }],
        ['installment 13', { id: '20260623E335', amount: 10.01, installment: 13 }],
      ])('%s: PosError before the crypt', async (_name, order) => {
        await expect(
          pos.payment(paymentModel, order as PosOrder, TX_TYPE.PAY_AUTH, null, cb(signedBody())),
        ).rejects.toThrow(PosError)
        expect(crypt.check3DHash).not.toHaveBeenCalled()
        expect(responseMapper[mapperMethod]).not.toHaveBeenCalled()
      })
    },
  )

  it('3D Pay form data', async () => {
    const order: PosOrder = { id: 'order-pay', amount: 10.5 }
    const formData = { gateway: 'https://www.paytr.com/odeme', method: 'POST', inputs: { a: 'b' } }
    const c = card()
    requestMapper.create3DFormData.mockResolvedValue(formData)

    const actual = await pos.get3DFormData(order, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, c)

    expect(requestMapper.create3DFormData).toHaveBeenCalledTimes(1)
    expect(requestMapper.create3DFormData).toHaveBeenCalledWith(
      PM,
      order,
      MODEL.THREE_D_PAY,
      TX_TYPE.PAY_AUTH,
      'https://www.paytr.com/odeme',
      c,
    )
    expect(actual).toBe(formData)
    expectNoRequest()
  })

  it('3D Host form data', async () => {
    const order: PosOrder = { id: 'order-host', amount: 10.5 }
    const initReqData = { merchant_id: '123456', merchant_oid: 'order-host' }
    const tokenResponse = { status: 'success', token: 'mytoken123' }
    const formData = { gateway: 'https://www.paytr.com/odeme/guvenli/mytoken123', method: 'GET', inputs: {} }
    requestMapper.create3DFormInitializeRequestData.mockReturnValue(initReqData)
    const verify = configureClientResponse(
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      initReqData,
      tokenResponse,
      order,
      MODEL.THREE_D_HOST,
    )
    requestMapper.create3DFormData.mockResolvedValue(formData)

    const actual = await pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true)

    expect(requestMapper.create3DFormInitializeRequestData).toHaveBeenCalledWith(
      PM,
      order,
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_AUTH,
    )
    verify()
    expect(requestMapper.create3DFormData).toHaveBeenCalledWith(
      PM,
      order,
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_AUTH,
      'https://www.paytr.com/odeme/guvenli',
      null,
      tokenResponse,
    )
    expect(actual).toBe(formData)
  })

  it.each([
    [{ status: 'error', reason: 'Merchant not active' }, 'Merchant not active'],
    [{ status: 'error' }, 'PayTR iFrame token request failed'],
  ])('3D Host token request failure %j', async (tokenResponse, message) => {
    const order: PosOrder = { id: 'order-fail', amount: 5 }
    const initReqData = { merchant_id: '123456' }
    requestMapper.create3DFormInitializeRequestData.mockReturnValue(initReqData)
    configureClientResponse(TX_TYPE.INTERNAL_3D_FORM_BUILD, initReqData, tokenResponse, order, MODEL.THREE_D_HOST)

    const err = await pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true).catch((e) => e)

    // deviation: C6 a PosError, never a plain runtime error
    expect(err).toBeInstanceOf(PosError)
    expect((err as Error).message).toContain(message)
    expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
  })

  it.each([
    [
      '3d_host with card',
      { id: 'order-1' },
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_AUTH,
      true,
      false,
      PosError,
      'Do not use [3d_host] payment model with card data',
    ],
    [
      '3d_pay without card',
      { id: 'order-2' },
      MODEL.THREE_D_PAY,
      TX_TYPE.PAY_AUTH,
      false,
      false,
      PosError,
      'Card data is required for this payment model',
    ],
    [
      'unsupported model',
      { id: 'order-3' },
      MODEL.THREE_D_SECURE,
      TX_TYPE.PAY_AUTH,
      true,
      false,
      UnsupportedTransactionTypeError,
      'PayTrPos supports [3d_host, 3d_pay, regular] payment model(s) for transaction type [pay]',
    ],
    [
      'non payment tx type',
      { id: 'order-4' },
      MODEL.THREE_D_HOST,
      TX_TYPE.STATUS,
      false,
      true,
      UnsupportedTransactionTypeError,
      'Invalid transaction type! Supported transaction types:',
    ],
  ] as Array<[string, PosOrder, PaymentModel, TxType, boolean, boolean, typeof Error, string]>)(
    // deviation: C6 English messages of the project's error classes
    'bad inputs: %s',
    async (_name, order, model, txType, withCard, createWithoutCard, errorClass, message) => {
      const err = await pos
        .get3DFormData(order, model, txType, withCard ? card() : null, createWithoutCard)
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(errorClass)
      expect((err as Error).message).toContain(message)
      expectNoRequest()
    },
  )

  // addition: G1/G2 the HTML form format is not offered
  it.each([MODEL.THREE_D_PAY, MODEL.THREE_D_HOST])('%s: formFormat html is refused', async (model) => {
    await expect(
      pos.get3DFormData(
        { id: 'o' },
        model,
        TX_TYPE.PAY_AUTH,
        model === MODEL.THREE_D_PAY ? card() : null,
        false,
        FORM_FORMAT.HTML,
      ),
    ).rejects.toThrow(UnsupportedFormFormatError)
    expectNoRequest()
  })

  it('non-secure payment', async () => {
    // deviation: R3 the order carries the buyer fields PayTR requires
    const order: PosOrder = { id: 'order-ns', amount: 50, currency: 'TRY', ...buyerFields }
    const requestData = { merchant_id: '123456', merchant_oid: 'order-ns' }
    const decoded = { status: 'success' }
    const c = card()
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(TX_TYPE.PAY_AUTH, requestData, decoded, order, MODEL.NON_SECURE)
    responseMapper.mapPaymentResponse.mockReturnValue({ order_id: 'order-ns', status: 'approved' })

    const result = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, c)

    expect(requestMapper.createNonSecurePaymentRequestData).toHaveBeenCalledWith(PM, order, TX_TYPE.PAY_AUTH, c)
    verify()
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith(decoded, TX_TYPE.PAY_AUTH, order)
    // deviation: G3 the approved result carries the order's id and currency
    expect(result).toStrictEqual({ order_id: 'order-ns', status: 'approved', currency: 'TRY' })
  })

  it('cancel throws NotImplementedError from the mapper', async () => {
    requestMapper.createCancelRequestData.mockImplementation(() => {
      throw new NotImplementedError()
    })
    await expect(pos.cancel({})).rejects.toThrow(NotImplementedError)
  })

  it('status', async () => {
    const order: PosOrder = { id: 'order-status' }
    const requestData = { merchant_id: '123456', merchant_oid: 'order-status' }
    const decoded = { status: 'success', payment_amount: '10.00' }
    const expected = { order_id: 'order-status', status: 'approved' }
    requestMapper.createStatusRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(TX_TYPE.STATUS, requestData, decoded, order, MODEL.NON_SECURE)
    responseMapper.mapStatusResponse.mockReturnValue(expected)

    const result = await pos.status(order)

    expect(requestMapper.createStatusRequestData).toHaveBeenCalledWith(PM, order)
    verify()
    expect(responseMapper.mapStatusResponse).toHaveBeenCalledWith(decoded)
    expect(result).toBe(expected)
  })

  it.each([
    ['full_refund', { id: 'order-ref', amount: 10.5 }, TX_TYPE.REFUND],
    ['partial_refund', { id: 'order-partial', amount: 5, order_amount: 10.5 }, TX_TYPE.REFUND_PARTIAL],
  ] as Array<[string, PosOrder, TxType]>)('refund %s', async (_name, order, txType) => {
    const requestData = { merchant_id: '123456', merchant_oid: order.id }
    const decoded = { status: 'success' }
    requestMapper.createRefundRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(txType, requestData, decoded, order, MODEL.NON_SECURE)
    responseMapper.mapRefundResponse.mockReturnValue({ status: 'approved' })

    const result = await pos.refund(order)

    expect(requestMapper.createRefundRequestData).toHaveBeenCalledWith(PM, order, txType)
    verify()
    expect(responseMapper.mapRefundResponse).toHaveBeenCalledWith(decoded)
    // deviation: G4 the approved result carries the order's id
    expect(result).toStrictEqual({ status: 'approved', order_id: order.id })
  })

  // addition: G3 unknown outcomes are raised before the mapper is called
  it.each([[{}], [{ status: 'wait_callback' }], [{ status: 'x' }], [{ status: ['success'] }]])(
    'non-secure answer %j is an unknown outcome raised before mapping',
    async (decoded) => {
      const order: PosOrder = { id: 'order-ns', amount: 50, ...buyerFields }
      requestMapper.createNonSecurePaymentRequestData.mockReturnValue({ merchant_oid: 'order-ns' })
      configureClientResponse(TX_TYPE.PAY_AUTH, { merchant_oid: 'order-ns' }, decoded, order, MODEL.NON_SECURE)
      await expect(pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card())).rejects.toThrow(PosHttpError)
      expect(responseMapper.mapPaymentResponse).not.toHaveBeenCalled()
    },
  )

  // addition: G4 unknown refund outcomes are raised before the mapper is called
  it.each([[{}], [{ status: 'wait_callback' }], [{ status: 'SUCCESS' }]])(
    'refund answer %j is an unknown outcome raised before mapping',
    async (decoded) => {
      const order: PosOrder = { id: 'order-ref', amount: 10.5 }
      requestMapper.createRefundRequestData.mockReturnValue({ merchant_oid: 'order-ref' })
      configureClientResponse(TX_TYPE.REFUND, { merchant_oid: 'order-ref' }, decoded, order, MODEL.NON_SECURE)
      await expect(pos.refund(order)).rejects.toThrow(PosHttpError)
      expect(responseMapper.mapRefundResponse).not.toHaveBeenCalled()
    },
  )

  // addition: R3 the gateway validates the order itself before the request (the mapper is not relied on)
  it.each([
    ['no buyer', { id: 'order-ns', amount: 50, ip: '127.0.0.1' }],
    ['amount 0', { id: 'order-ns', amount: 0, ...buyerFields }],
    ['a bad order id', { id: 'a b', amount: 50, ...buyerFields }],
  ])('non-secure %s: PosError before the mapper and the request', async (_name, order) => {
    await expect(pos.payment(MODEL.NON_SECURE, order as PosOrder, TX_TYPE.PAY_AUTH, card())).rejects.toThrow(PosError)
    expect(requestMapper.createNonSecurePaymentRequestData).not.toHaveBeenCalled()
    expectNoRequest()
  })

  it.each([
    ['amount 0', { id: 'order-ref', amount: 0 }],
    ['a bad order id', { id: 'a b', amount: 1 }],
  ])('refund %s: PosError before the mapper and the request', async (_name, order) => {
    await expect(pos.refund(order as PosOrder)).rejects.toThrow(PosError)
    expect(requestMapper.createRefundRequestData).not.toHaveBeenCalled()
    expectNoRequest()
  })

  // addition: G6 post-authorization and pre-authorization are not offered
  it.each([TX_TYPE.PAY_PRE_AUTH, TX_TYPE.PAY_POST_AUTH])('payment %s is unsupported', async (txType) => {
    await expect(pos.payment(MODEL.NON_SECURE, { id: 'o', amount: 1 }, txType, card())).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    await expect(pos.payment(MODEL.THREE_D_PAY, { id: 'o', amount: 1 }, txType, null, cb(nv2()))).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    expectNoRequest()
  })
})

// ---------- end to end: real crypt, mappers and HTTP client over a fake fetch ----------

const PAYMENT_API = 'https://www.paytr.com'
const E2E_CONFIG: GatewayConfig = {
  name: 'PayTR',
  class: 'PayTrPos',
  gateway_endpoints: {
    payment_api: PAYMENT_API,
    gateway_3d: `${PAYMENT_API}/odeme`,
    gateway_3d_host: `${PAYMENT_API}/odeme/guvenli`,
  },
}

type Sent = { url: string; path: string; form: Record<string, string> }
type Answer = Data | Response

type BankOptions = {
  token?: (form: Record<string, string>) => Answer
  sale?: (form: Record<string, string>) => Answer
  refund?: (form: Record<string, string>) => Answer
  status?: (form: Record<string, string>) => Answer
}

const IFRAME_FIELDS = [
  'merchant_id',
  'user_ip',
  'merchant_oid',
  'email',
  'payment_amount',
  'user_basket',
  'no_installment',
  'max_installment',
  'currency',
  'test_mode',
]
const DIRECT_FIELDS = [
  'merchant_id',
  'user_ip',
  'merchant_oid',
  'email',
  'payment_amount',
  'payment_type',
  'installment_count',
  'currency',
  'test_mode',
  'non_3d',
]
const SIGNED_FIELDS: Record<string, string[]> = {
  'odeme/api/get-token': IFRAME_FIELDS,
  odeme: DIRECT_FIELDS,
  'odeme/iade': ['merchant_id', 'merchant_oid', 'return_amount'],
  'odeme/durum-sorgu': ['merchant_id', 'merchant_oid'],
}

/** The documented token of a body, computed here with node:crypto (PM). */
const tokenOf = (path: string, form: Record<string, string>): string =>
  H(`${(SIGNED_FIELDS[path] ?? []).map((name) => form[name] ?? '').join('')}${PM_SALT}`, PM_KEY)

/** Requests whose `paytr_token` was not the documented token of the body that was sent. */
const unsignedRequests: Sent[] = []

afterEach(() => {
  expect(unsignedRequests).toStrictEqual([])
  unsignedRequests.length = 0
})

/** A fetch that answers like PayTR by path, checks every request token and records the requests. */
function bankFetch(options: BankOptions = {}) {
  const sent: Sent[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const body = await new Request('https://example.invalid', { method: 'POST', body: init?.body ?? '' }).text()
    const u = String(url)
    const form = Object.fromEntries(new URLSearchParams(body))
    const entry: Sent = { url: u, path: u.slice(PAYMENT_API.length + 1), form }
    sent.push(entry)
    if (form.paytr_token !== tokenOf(entry.path, form)) unsignedRequests.push(entry)
    let reply: Answer | undefined
    switch (entry.path) {
      case 'odeme/api/get-token':
        reply = options.token?.(form) ?? { status: 'success', token: `tok${form.merchant_oid}` }
        break
      case 'odeme':
        reply = options.sale?.(form) ?? { status: 'success' }
        break
      case 'odeme/iade':
        reply = options.refund?.(form) ?? {
          status: 'success',
          is_test: 1,
          merchant_oid: form.merchant_oid,
          return_amount: form.return_amount,
        }
        break
      case 'odeme/durum-sorgu':
        reply = options.status?.(form) ?? { status: 'error', err_no: '004', err_msg: 'Kayit bulunamadi' }
        break
    }
    if (reply === undefined) throw new Error(`unexpected request ${u}`)
    return reply instanceof Response ? reply : new Response(JSON.stringify(reply), { status: 200 })
  }) as unknown as typeof fetch

  return { sent, fetchImpl }
}

function realGateway(
  fetchImpl: typeof fetch,
  options: { cfg?: GatewayConfig; account?: PayTrPosAccount; logger?: PosLogger; hooks?: PosHooks } = {},
) {
  const log = options.logger ?? createLogger()
  const cfg = options.cfg ?? E2E_CONFIG
  const account = options.account ?? PM
  const cryptImpl = new PayTrPosCrypt(log)
  const valueMapper = new PayTrPosRequestValueMapper()
  const valueFormatter = new PayTrPosRequestValueFormatter()
  const hooks = options.hooks ?? {}
  const requestDataMapper = new PayTrPosRequestDataMapper(valueMapper, valueFormatter, hooks, cryptImpl, LANG.TR)
  const responseDataMapper = new PayTrPosResponseDataMapper(
    new PayTrPosResponseValueFormatter(),
    new PayTrPosResponseValueMapper(),
    log,
  )
  const deps: GatewayDeps<PayTrPosAccount> = {
    requestValueMapper: valueMapper,
    requestValueFormatter: valueFormatter,
    requestDataMapper,
    responseDataMapper,
    crypt: cryptImpl,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(
      PayTrPos.GATEWAY_CLASS,
      cfg,
      new HttpTransport({ fetch: fetchImpl }),
      log,
      { account, crypt: cryptImpl },
    ),
    logger: log,
    hooks,
  }

  return { pos: new PayTrPos(cfg, account, deps), crypt: cryptImpl, requestDataMapper, responseDataMapper }
}

const mismatch = async (promise: Promise<unknown>): Promise<OrderMismatchError> => {
  const err = await promise.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(OrderMismatchError)
  return err as OrderMismatchError
}

const HASH_MISMATCH = new HashMismatchError('3D callback hash mismatch')
const NO_HASH = new HashMismatchError('3D callback has no hash')
const MALFORMED = new HashMismatchError('3D callback fields are malformed')

const NOTIFIED = [
  ['3D Pay', MODEL.THREE_D_PAY],
  ['3D Host', MODEL.THREE_D_HOST],
] as Array<[string, PaymentModel]>

const hostedOrder = (id: string, amount: number, over: PosOrder = {}): PosOrder => ({
  id,
  amount,
  currency: CURRENCY.TRY,
  installment: 0,
  ...over,
})

/** One notification through a fresh PT gateway over a fake bank that must receive nothing. */
const notify = (
  body: Data,
  order: PosOrder,
  paymentModel: PaymentModel = MODEL.THREE_D_PAY,
  cfg: GatewayConfig = E2E_CONFIG,
) => {
  const { sent, fetchImpl } = bankFetch()
  const { pos, crypt, responseDataMapper } = realGateway(fetchImpl, { cfg, account: PT })
  const check = vi.spyOn(crypt, 'check3DHash')
  const promise = pos.payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb(body))
  return { sent, promise, check, responseDataMapper }
}

describe('PayTrPos (end to end) notification forgery and binding', () => {
  // addition: N8 NV2 for its order is approved from the signed values, with no request at all
  it.each(NOTIFIED)('%s: NV2 is approved without any request', async (_label, model) => {
    const body = nv2({ payment_amount: '1001', installment_count: '0', test_mode: '0', payment_type: 'card' })
    const { sent, promise } = notify(body, hostedOrder('20260623E335', 10.01), model)
    const res = (await promise) as Data

    expect(sent).toHaveLength(0)
    expect(res.status).toBe('approved')
    expect(res.amount).toBe(10.01)
    expect(res.currency).toBe('TRY')
    expect(res.order_id).toBe('20260623E335')
    expect(res.installment_count).toBe(0)
    expect(res.payment_model).toBe(model)
    expect(res.transaction_type).toBe('pay')
    expect(res.transaction_time).toBeInstanceOf(Date)
    expect(res).not.toHaveProperty('requires_manual_review')
  })

  // addition: N1 NV1 through 3D Host, NV2 through 3D Pay
  it('NV1 through 3D Host and NV2 through 3D Pay', async () => {
    const host = (await notify(nv1(), hostedOrder('20260624B505', 10.01), MODEL.THREE_D_HOST).promise) as Data
    expect(host.status).toBe('approved')
    expect(host.payment_model).toBe('3d_host')
    const pay = (await notify(nv2(), hostedOrder('20260623E335', 10.01), MODEL.THREE_D_PAY).promise) as Data
    expect(pay.status).toBe('approved')
    expect(pay.payment_model).toBe('3d_pay')
  })

  // addition: N4 one changed character of a signed value or the hash fails the signature
  it.each([
    ['hash', { hash: `${nv2().hash.slice(0, 10)}A${nv2().hash.slice(11)}` }],
    ['status', { status: 'successs' }],
    ['status case', { status: 'Success' }],
    ['merchant_oid', { merchant_oid: '20260623E336' }],
    ['total_amount', { total_amount: '1002' }],
    ['total_amount padded', { total_amount: '01001' }],
  ])('a changed %s is a HashMismatchError', async (_name, over) => {
    const body = nv2(over)
    expect(body.hash).toMatch(/^[A-Za-z0-9+/]{43}=$/)
    const { sent, promise } = notify(body, hostedOrder('20260623E335', 10.01))
    await expect(promise).rejects.toStrictEqual(HASH_MISMATCH)
    expect(sent).toHaveLength(0)
  })

  // addition: N6 a verified notification of another order id is refused without a result
  it.each(NOTIFIED)('%s: NV2 for order 20260623E336 is an order_id mismatch without result', async (_l, model) => {
    const { sent, promise } = notify(nv2(), hostedOrder('20260623E336', 10.01), model)
    const err = await mismatch(promise)
    expect(err.field).toBe('order_id')
    expect(err.expected).toBe('20260623E336')
    expect(err.actual).toBe('20260623E335')
    expect(err.response).toBeUndefined()
    expect(err.paymentMayHaveCompleted).toBe(false)
    expect(sent).toHaveLength(0)
  })

  // addition: N6 a signed decline of another order id is refused too (binding comes first)
  it('NV4 for another order is an order_id mismatch', async () => {
    const err = await mismatch(notify(nv4(), hostedOrder('order-other', 10.01)).promise)
    expect(err.field).toBe('order_id')
    expect(err.response).toBeUndefined()
  })

  // addition: N8 (3) a higher signed total for a single payment: money moved for this order
  it('NV5 (11.00) for ORDER42 at 10.50 without installments is an amount mismatch with the result', async () => {
    const { sent, promise } = notify(nv5(), hostedOrder('ORDER42', 10.5))
    const err = await mismatch(promise)
    expect(err.field).toBe('amount')
    expect(err.expected).toBe('1050')
    expect(err.actual).toBe('1100')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
    expect(err.response?.order_id).toBe('ORDER42')
    expect(err.response?.amount).toBe(11)
    expect(sent).toHaveLength(0)
  })

  // addition: N8 (3) an installment plan may carry a fee
  it('NV5 for ORDER42 at 10.50 with 3 installments is approved at 11.00', async () => {
    const res = (await notify(nv5({ installment_count: '3' }), hostedOrder('ORDER42', 10.5, { installment: 3 }))
      .promise) as Data
    expect(res.status).toBe('approved')
    expect(res.amount).toBe(11)
    expect(res.installment_count).toBe(3)
  })

  it('NV7 (10.49) with 3 installments is an amount mismatch', async () => {
    const err = await mismatch(notify(nv7(), hostedOrder('ORDER42', 10.5, { installment: 3 })).promise)
    expect(err.field).toBe('amount')
    expect(err.paymentMayHaveCompleted).toBe(true)
  })

  it('NV7 (10.49) without installments is an amount mismatch', async () => {
    const err = await mismatch(notify(nv7(), hostedOrder('ORDER42', 10.5)).promise)
    expect(err.field).toBe('amount')
  })

  it('NV6 is approved for ORDER42 at 10.50', async () => {
    const res = (await notify(nv6({ payment_amount: '1050' }), hostedOrder('ORDER42', 10.5)).promise) as Data
    expect(res.status).toBe('approved')
    expect(res.amount).toBe(10.5)
  })

  // addition: N8 (5) the unsigned currency, when sent, must be the order's
  it.each([['USD'], ['EUR'], ['XYZ'], ['tl'], ['']])('NV6 with currency %j is a currency mismatch', async (cur) => {
    const err = await mismatch(notify(nv6({ currency: cur }), hostedOrder('ORDER42', 10.5)).promise)
    expect(err.field).toBe('currency')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
  })

  it.each([['TL'], ['TRY']])('NV6 with currency %j matches a TRY order', async (cur) => {
    const res = (await notify(nv6({ currency: cur }), hostedOrder('ORDER42', 10.5)).promise) as Data
    expect(res.status).toBe('approved')
    expect(res.currency).toBe('TRY')
  })

  it('NV6 with currency TL for a USD order is a currency mismatch', async () => {
    const err = await mismatch(notify(nv6(), hostedOrder('ORDER42', 10.5, { currency: 'USD' })).promise)
    expect(err.field).toBe('currency')
  })

  it('NV6 without a currency is approved with the order currency', async () => {
    const res = (await notify(nv6({ currency: undefined }), hostedOrder('ORDER42', 10.5)).promise) as Data
    expect(res.status).toBe('approved')
    expect(res.currency).toBe('TRY')
  })

  // addition: N8 (4) the unsigned payment amount, when sent, must be the order amount
  it.each([['1049'], ['10.50'], ['x'], ['']])('NV6 with payment_amount %j is an amount mismatch', async (amount) => {
    const err = await mismatch(notify(nv6({ payment_amount: amount }), hostedOrder('ORDER42', 10.5)).promise)
    expect(err.field).toBe('amount')
    expect(err.paymentMayHaveCompleted).toBe(true)
  })

  // addition: N8 (2) a test-mode notification never approves a live order
  it('NV6 with test_mode 1 on a live gateway is a test_mode mismatch without result', async () => {
    const { sent, promise } = notify(nv6({ test_mode: '1' }), hostedOrder('ORDER42', 10.5))
    const err = await mismatch(promise)
    expect(err.field).toBe('test_mode')
    expect(err.expected).toBe('0')
    expect(err.actual).toBe('1')
    expect(err.response).toBeUndefined()
    expect(err.paymentMayHaveCompleted).toBe(false)
    expect(sent).toHaveLength(0)
  })

  it('NV6 with test_mode 1 is accepted on a test-mode gateway', async () => {
    const res = (await notify(nv6({ test_mode: '1' }), hostedOrder('ORDER42', 10.5), MODEL.THREE_D_PAY, {
      ...E2E_CONFIG,
      test_mode: true,
    }).promise) as Data
    expect(res.status).toBe('approved')
  })

  // addition: only an absent, empty or '0' flag counts as live
  it.each([[' 1'], ['01'], ['true'], ['2'], ['1 ']])(
    'NV6 with test_mode %j on a live gateway is a mismatch',
    async (flag) => {
      const { sent, promise } = notify(nv6({ test_mode: flag }), hostedOrder('ORDER42', 10.5))
      const err = await mismatch(promise)
      expect(err.field).toBe('test_mode')
      expect(err.response).toBeUndefined()
      expect(sent).toHaveLength(0)
    },
  )

  it.each([['0'], ['']])('NV6 with test_mode %j is accepted on a live gateway', async (flag) => {
    const res = (await notify(nv6({ test_mode: flag }), hostedOrder('ORDER42', 10.5)).promise) as Data
    expect(res.status).toBe('approved')
  })

  // addition: N8 (1) a signed approval whose total is not a whole positive kuruş number
  it.each([
    ['0', '0'],
    ['padded', ' 1050'],
    ['decimal', '10.50'],
    ['empty', ''],
  ])('a signed success with total %s is malformed', async (_name, total) => {
    const err = await notify(notification('ORDER42', 'success', total), hostedOrder('ORDER42', 10.5)).promise.catch(
      (e: unknown) => e,
    )
    expect(err).toStrictEqual(MALFORMED)
  })

  // addition: N2 non-string values are refused before the crypt
  it.each([
    ['a list hash', { hash: ['x'] }],
    ['a record status', { status: { a: 1 } }],
    ['a numeric total', { total_amount: 1001 }],
  ])('%s is a PosError before the crypt', async (_name, over) => {
    const { sent, promise, check } = notify(nv2(over), hostedOrder('20260623E335', 10.01))
    await expect(promise).rejects.toThrow(PosError)
    await expect(promise).rejects.not.toThrow(HashMismatchError)
    expect(check).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  // addition: N7 a signed decline maps declined with bounded reasons and the order's id
  it('NV4 for order-host-fail is a signed decline', async () => {
    const body = nv4({ failed_reason_code: '05', failed_reason_msg: 'Do not honour' })
    const { sent, promise } = notify(body, hostedOrder('order-host-fail', 10.01), MODEL.THREE_D_HOST)
    const res = (await promise) as Data
    expect(sent).toHaveLength(0)
    expect(res.status).toBe('declined')
    expect(res.order_id).toBe('order-host-fail')
    expect(res.error_code).toBe('05')
    expect(res.error_message).toBe('Do not honour')
    expect(res.amount).toBeNull()
    expect(res.currency).toBeNull()
    expect(res.installment_count).toBeNull()
    expect(res.transaction_time).toBeNull()
    expect(res).not.toHaveProperty('requires_manual_review')
  })

  it('a signed decline keeps at most 256 characters of its reason', async () => {
    const res = (await notify(nv4({ failed_reason_msg: 'r'.repeat(300) }), hostedOrder('order-host-fail', 10.01))
      .promise) as Data
    expect(res.status).toBe('declined')
    expect((res.error_message as string).length).toBeLessThanOrEqual(256)
  })

  // addition: N7 only the exact word is an approval: a verified status in another case or with padding is a decline
  it.each([['Success'], ['SUCCESS'], [' success'], ['success ']])(
    'a verified notification with status %j is a decline',
    async (status) => {
      const res = (await notify(notification('20260623E335', status, '1001'), hostedOrder('20260623E335', 10.01))
        .promise) as Data
      expect(res.status).toBe('declined')
      expect(res.amount).toBeNull()
    },
  )

  it('a signed decline with reason code "0 5" has no error code', async () => {
    const res = (await notify(nv4({ failed_reason_code: '0 5' }), hostedOrder('order-host-fail', 10.01))
      .promise) as Data
    expect(res.error_code).toBeNull()
  })

  // addition: N9 every regrouping that still verifies is a decline, except the genuine approval
  it.each([
    ['NV1', '20260624B505', 'success1001', 'success', '1001'],
    ['NV4', 'order-host-fail', 'failed0', null, null],
  ] as Array<[string, string, string, string | null, string | null]>)(
    '%s: every verifying regrouping of the status and the total is a decline or the original',
    async (_name, oid, joined, approvedStatus, approvedTotal) => {
      const bodies: Data[] = []
      for (let i = 0; i <= joined.length; i++) {
        const status = joined.slice(0, i)
        const total = joined.slice(i)
        const hash = NOTE(oid, status, total)
        bodies.push({ merchant_oid: oid, status, total_amount: total, hash })
        bodies.push({ merchant_oid: oid, total_amount: total, hash: NOTE(oid, '', total) })
        bodies.push({ merchant_oid: oid, status, hash: NOTE(oid, status, '') })
      }
      let approvals = 0
      for (const body of bodies) {
        const res = (await notify(body, hostedOrder(oid, 10.01)).promise.catch((e: unknown) => e)) as Data
        if (res instanceof Error) {
          // a status that is exactly the approval word with a malformed total
          expect(res).toStrictEqual(MALFORMED)
          expect(body.status).toBe('success')
          continue
        }
        if (res.status === 'approved') {
          approvals++
          expect([body.status, body.total_amount]).toStrictEqual([approvedStatus, approvedTotal])
        } else {
          expect(res.status).toBe('declined')
        }
      }
      expect(approvals).toBe(approvedStatus === null ? 0 : 1)
    },
  )

  // addition: N10 a repeated notification maps to the same result each time
  it('replays of the same signed notification give the same result', async () => {
    const { fetchImpl, sent } = bankFetch()
    const { pos } = realGateway(fetchImpl, { account: PT })
    const order = hostedOrder('20260623E335', 10.01)
    const first = (await pos.payment(MODEL.THREE_D_PAY, order, TX_TYPE.PAY_AUTH, null, cb(nv2()))) as Data
    const second = (await pos.payment(MODEL.THREE_D_PAY, order, TX_TYPE.PAY_AUTH, null, cb(nv2()))) as Data
    expect({ ...second, transaction_time: null }).toStrictEqual({ ...first, transaction_time: null })
    const declineA = await pos.payment(
      MODEL.THREE_D_PAY,
      hostedOrder('order-host-fail', 1),
      TX_TYPE.PAY_AUTH,
      null,
      cb(nv4()),
    )
    const declineB = await pos.payment(
      MODEL.THREE_D_PAY,
      hostedOrder('order-host-fail', 1),
      TX_TYPE.PAY_AUTH,
      null,
      cb(nv4()),
    )
    expect(declineB).toStrictEqual(declineA)
    expect(sent).toHaveLength(0)
  })

  // addition: N1 a notification signed for another account does not verify
  it('a notification signed with another key is a HashMismatchError', async () => {
    const { fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl, { account: PM })
    await expect(
      pos.payment(MODEL.THREE_D_PAY, hostedOrder('20260623E335', 10.01), TX_TYPE.PAY_AUTH, null, cb(nv2())),
    ).rejects.toStrictEqual(HASH_MISMATCH)
  })

  // addition: N1 a direct call with another transaction type is refused before anything is read
  it.each([TX_TYPE.REFUND, TX_TYPE.PAY_PRE_AUTH, TX_TYPE.STATUS])(
    'make3DPayPayment with %s is refused',
    async (txType) => {
      const { fetchImpl } = bankFetch()
      const { pos, crypt } = realGateway(fetchImpl, { account: PT })
      const check = vi.spyOn(crypt, 'check3DHash')
      const order = hostedOrder('20260623E335', 10.01)
      await expect(pos.make3DPayPayment(cb(nv2()), order, txType)).rejects.toThrow(UnsupportedTransactionTypeError)
      await expect(pos.make3DHostPayment(cb(nv2()), order, txType)).rejects.toThrow(UnsupportedTransactionTypeError)
      expect(check).not.toHaveBeenCalled()
    },
  )

  // addition: N1 the unverified lookup key
  it('notificationOrderId', () => {
    expect(PayTrPos.notificationOrderId({ merchant_oid: 'X1' })).toBe('X1')
    for (const body of [{}, { merchant_oid: 'a b' }, { merchant_oid: ['x'] }, null]) {
      expect(() => PayTrPos.notificationOrderId(body)).toThrow(PosError)
    }
  })
})

describe('PayTrPos (end to end) browser returns', () => {
  // addition: N5 the fail page's text is a trusted decline that carries nothing else from the body
  it.each(NOTIFIED)('%s: a fail_message is a trusted decline', async (_label, model) => {
    const { sent, promise, check } = notify(
      { fail_message: 'Kart limiti yetersiz' },
      hostedOrder('order-1', 10.01),
      model,
    )
    const res = (await promise) as Data
    expect(sent).toHaveLength(0)
    expect(check).not.toHaveBeenCalled()
    expect(res.status).toBe('declined')
    expect(res.order_id).toBe('order-1')
    expect(res.md_error_message).toBe('Kart limiti yetersiz')
    expect(res.amount).toBeNull()
    expect(res.error_code).toBeNull()
    expect(res.payment_model).toBe(model)
    expect(res).not.toHaveProperty('requires_manual_review')
  })

  it('an unsigned body with foreign values keeps none of them', async () => {
    const body = { fail_message: 'x', merchant_oid: 'other', failed_reason_code: '51', currency: 'USD', hash: '' }
    const res = (await notify(body, hostedOrder('order-1', 10.01)).promise) as Data
    expect(res.status).toBe('declined')
    expect(res.order_id).toBe('order-1')
    expect(res.error_code).toBeNull()
    expect(res.currency).toBeNull()
  })

  it('with require_3d_hash a fail_message is a HashMismatchError', async () => {
    const { promise } = notify(
      { fail_message: 'Kart limiti yetersiz' },
      hostedOrder('order-1', 10.01),
      MODEL.THREE_D_PAY,
      {
        ...E2E_CONFIG,
        require_3d_hash: true,
      },
    )
    await expect(promise).rejects.toStrictEqual(NO_HASH)
  })

  // addition: N5 an unsigned body that reads as an approval is always refused
  it.each([
    ['an unsigned success', { status: 'success', merchant_oid: '20260623E335', total_amount: '1001' }],
    ['a padded upper-case success', { status: ' SUCCESS ' }],
    ['a total amount', { total_amount: '1001' }],
    ['an empty hash', { status: 'success', merchant_oid: '20260623E335', total_amount: '1001', hash: '' }],
  ])('%s is a HashMismatchError', async (_name, body) => {
    const { sent, promise, check } = notify(body, hostedOrder('20260623E335', 10.01))
    await expect(promise).rejects.toStrictEqual(NO_HASH)
    expect(check).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  it.each(NOTIFIED)('%s: an empty body is a PosError', async (_label, model) => {
    const { fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl, { account: PT })
    const order = hostedOrder('o1', 1)
    const call =
      model === MODEL.THREE_D_PAY
        ? pos.make3DPayPayment(cb({}), order, TX_TYPE.PAY_AUTH)
        : pos.make3DHostPayment(cb({}), order, TX_TYPE.PAY_AUTH)
    await expect(call).rejects.toThrow(
      new PosError('PayTR reports the payment result to the notification URL; the success page receives no data'),
    )
    await expect(pos.payment(model, order, TX_TYPE.PAY_AUTH, null, cb({}))).rejects.toThrow(PosError)
  })

  it('a 300-character fail_message with control characters is cut to 256 clean characters', async () => {
    const text = `\u0001${'Kart'.repeat(5)}\u001b[31m${'x'.repeat(300)}`
    const res = (await notify({ fail_message: text }, hostedOrder('order-1', 10.01)).promise) as Data
    const message = res.md_error_message as string
    expect(message.length).toBeLessThanOrEqual(256)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what must be absent
    expect(message).not.toMatch(/[\u0000-\u001F\u007F]/)
  })
})

/** The order of the request vectors: RV1 (iFrame row 1) and RV2 (3D Pay row). */
const vectorOrder = (over: PosOrder = {}): PosOrder => ({
  id: 'order-123',
  amount: 10.5,
  success_url: 'https://example.com/success',
  fail_url: 'https://example.com/fail',
  currency: CURRENCY.TRY,
  lang: LANG.TR,
  ...buyerFields,
  ...over,
})

const vectorCard = () => CreditCardFactory.create('4355084355084358', '30', '12', '000', 'John Doe')

describe('PayTrPos (end to end) 3D Pay form', () => {
  // addition: R6 the form is built without any request, every input a string, token RV2
  it('with a card: POST form, string inputs, token RV2', async () => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    const form = (await pos.get3DFormData(
      vectorOrder(),
      MODEL.THREE_D_PAY,
      TX_TYPE.PAY_AUTH,
      vectorCard(),
    )) as ThreeDFormData

    expect(sent).toHaveLength(0)
    expect(form.gateway).toBe('https://www.paytr.com/odeme')
    expect(form.method).toBe('POST')
    for (const value of Object.values(form.inputs)) expect(typeof value).toBe('string')
    expect(form.inputs.paytr_token).toBe('X9qZPa0RdLpsTTYr+y1NBageAScLfdhp2MNOaIN5yJQ=')
    expect(form.inputs.card_number).toBe('4355084355084358')
    expect(form.inputs.non_3d).toBe('0')
  })

  it('without a card: no card keys and the same token', async () => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    const form = (await pos.get3DFormData(
      vectorOrder(),
      MODEL.THREE_D_PAY,
      TX_TYPE.PAY_AUTH,
      null,
      true,
    )) as ThreeDFormData

    expect(sent).toHaveLength(0)
    for (const key of ['cc_owner', 'card_number', 'expiry_month', 'expiry_year', 'cvv']) {
      expect(form.inputs).not.toHaveProperty(key)
    }
    expect(form.inputs.paytr_token).toBe('X9qZPa0RdLpsTTYr+y1NBageAScLfdhp2MNOaIN5yJQ=')
  })

  // addition: R9 SP1 the 3D Pay form token allows a regrouped e-mail and amount (documents the residual) ...
  it('SP1: a regrouped e-mail and amount carry the same form token', async () => {
    const { fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    const sp1 = (email: string, amount: number): PosOrder =>
      vectorOrder({ id: 'ORDER42', amount, buyer: { email, name: 'John Doe', gsm_number: '05001234567' } })
    const a = (await pos.get3DFormData(
      sp1('a@b.co', 10.5),
      MODEL.THREE_D_PAY,
      TX_TYPE.PAY_AUTH,
      null,
      true,
    )) as ThreeDFormData
    const b = (await pos.get3DFormData(
      sp1('a@b.co1', 0.5),
      MODEL.THREE_D_PAY,
      TX_TYPE.PAY_AUTH,
      null,
      true,
    )) as ThreeDFormData
    expect(a.inputs.paytr_token).toBe('7Xj5VLDN0Fvh+CqANIguJOR+k7wuqrYjSdKUpZ3zZGg=')
    expect(b.inputs.paytr_token).toBe(a.inputs.paytr_token)
  })

  // addition: R9 SP1 ... and the signed notification of such a payment never approves the order
  it.each(NOTIFIED)('%s: SP1 a notification of 0.50 for ORDER42 at 10.50 is an amount mismatch', async (_l, model) => {
    const { sent, promise } = notify(notification('ORDER42', 'success', '50'), hostedOrder('ORDER42', 10.5), model)
    const err = await mismatch(promise)
    expect([err.field, err.expected, err.actual]).toStrictEqual(['amount', '1050', '50'])
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
    expect(sent).toHaveLength(0)
  })

  it('a 3D Pay form for a bad order id is a PosError', async () => {
    const { fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    for (const id of ['a b', 'a'.repeat(65)]) {
      await expect(
        pos.get3DFormData(vectorOrder({ id }), MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, vectorCard()),
      ).rejects.toThrow(PosError)
    }
  })
})

describe('PayTrPos (end to end) 3D Host token', () => {
  // addition: G1 the token request is posted form-encoded with token RV1, the browser gets the token URL
  it('posts the token request and returns the GET page of the token', async () => {
    const { sent, fetchImpl } = bankFetch({ token: () => ({ status: 'success', token: 'abc123' }) })
    const { pos } = realGateway(fetchImpl)
    const form = (await pos.get3DFormData(vectorOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)) as ThreeDFormData

    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe('https://www.paytr.com/odeme/api/get-token')
    expect(sent[0]?.form.paytr_token).toBe('OXyeQ9gQWRMM8dTZofjEuFCfKbNuMT6A3KA/eP3N4kk=')
    expect(form).toStrictEqual({ gateway: 'https://www.paytr.com/odeme/guvenli/abc123', method: 'GET', inputs: {} })
  })

  // addition: G1 a malformed token never reaches the form builder
  it.each([
    [{ status: 'success', token: 'abc/def' }],
    [{ status: 'success', token: 'a b' }],
    [{ status: 'success' }],
    [{ status: 'success', token: ['abc'] }],
    [{ status: 'success', token: '' }],
    [{ status: 'SUCCESS', token: 'abc' }],
    [{}],
  ])('answer %j is a PosError without a form', async (answer) => {
    const { fetchImpl } = bankFetch({ token: () => answer })
    const { pos, requestDataMapper } = realGateway(fetchImpl)
    const build = vi.spyOn(requestDataMapper, 'create3DFormData')
    const err = await pos.get3DFormData(vectorOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect((err as Error).message).toContain('PayTR iFrame token request failed')
    expect(build).not.toHaveBeenCalled()
  })

  it('a failure reason is cut to 256 characters and never shows the request token or the secrets', async () => {
    let token = ''
    const { fetchImpl } = bankFetch({
      token: (form) => {
        token = form.paytr_token ?? ''
        return { status: 'failed', reason: `bad ${token} ${PM_SALT} ${PM_KEY} ${'z'.repeat(300)}` }
      },
    })
    const { pos } = realGateway(fetchImpl)
    const err = (await pos.get3DFormData(vectorOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH).catch((e) => e)) as Error
    expect(err).toBeInstanceOf(PosError)
    expect(token).not.toBe('')
    expect(err.message.startsWith('PayTR iFrame token request failed: bad ***')).toBe(true)
    expect(err.message).not.toContain(token)
    expect(err.message).not.toContain(PM_SALT)
    expect(err.message).not.toContain(PM_KEY)
    expect(err.message.length).toBeLessThanOrEqual('PayTR iFrame token request failed: '.length + 256)
  })

  it('an HTML page is a PosHttpError', async () => {
    const { fetchImpl } = bankFetch({ token: () => new Response('<html>blocked</html>', { status: 200 }) })
    const { pos } = realGateway(fetchImpl)
    await expect(pos.get3DFormData(vectorOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)).rejects.toThrow(PosHttpError)
  })

  it.each([
    ['a bad order id', { id: 'a b' }],
    ['65 characters', { id: 'a'.repeat(65) }],
    ['no e-mail', { buyer: { name: 'John Doe', gsm_number: '05001234567' } }],
    ['no ip', { ip: undefined }],
    ['no phone', { buyer: { email: 'test@example.com', name: 'John Doe' } }],
    ['amount 0', { amount: 0 }],
  ])('%s: PosError before any request', async (_name, over) => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    await expect(pos.get3DFormData(vectorOrder(over), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)).rejects.toThrow(PosError)
    expect(sent).toHaveLength(0)
  })

  // addition: Q6-like rule for the token: a hook that edits a signed field breaks the token (the bank refuses it)
  it('a hook runs on the signed token request (tx 3d_form_build, model 3d_host)', async () => {
    const seen: RequestDataPreparedEvent[] = []
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl, { hooks: { onRequestDataPrepared: [(e) => void seen.push(e)] } })
    await pos.get3DFormData(vectorOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.txType).toBe('3d_form_build')
    expect(seen[0]?.paymentModel).toBe('3d_host')
    expect(sent).toHaveLength(1)
  })
})

/** The order of the non-secure vector RV3. */
const saleOrder = (over: PosOrder = {}): PosOrder => ({
  id: 'order-456',
  amount: 50,
  currency: CURRENCY.TRY,
  lang: LANG.TR,
  ...buyerFields,
  ...over,
})

describe('PayTrPos (end to end) money requests', () => {
  // addition: G3 the non-secure happy path
  it('a non-secure sale is posted to /odeme and approved with the order values', async () => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    const res = (await pos.payment(MODEL.NON_SECURE, saleOrder(), TX_TYPE.PAY_AUTH, vectorCard())) as Data

    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe('https://www.paytr.com/odeme')
    expect(sent[0]?.form.non_3d).toBe('1')
    expect(sent[0]?.form.sync_mode).toBe('1')
    expect(sent[0]?.form.user_basket).toBe('[["order-456",50,1]]')
    expect(sent[0]?.form.paytr_token).toBe('hu4O255FoK8oj8GBf/rW/nd37dl/Ya8Vr2rOtEF/cvc=')
    expect(res.status).toBe('approved')
    expect(res.order_id).toBe('order-456')
    expect(res.currency).toBe('TRY')
  })

  it('a failed sale is declined with the bank message', async () => {
    const { fetchImpl } = bankFetch({ sale: () => ({ status: 'failed', msg: 'Kart reddedildi' }) })
    const { pos } = realGateway(fetchImpl)
    const res = (await pos.payment(MODEL.NON_SECURE, saleOrder(), TX_TYPE.PAY_AUTH, vectorCard())) as Data
    expect(res.status).toBe('declined')
    expect(res.error_message).toBe('Kart reddedildi')
    expect(res.order_id).toBe('order-456')
  })

  it('a sale answer with another total is an amount mismatch with the result', async () => {
    const { fetchImpl } = bankFetch({ sale: () => ({ status: 'success', total_amount: '4999' }) })
    const { pos } = realGateway(fetchImpl)
    const err = await mismatch(pos.payment(MODEL.NON_SECURE, saleOrder(), TX_TYPE.PAY_AUTH, vectorCard()))
    expect(err.field).toBe('amount')
    expect(err.paymentMayHaveCompleted).toBe(true)
  })

  // addition: G3 the sale's total is compared with this order's amount
  it.each([
    ['1234', 'approved'],
    ['5000', 'mismatch'],
  ])('a sale of 12.34 answered with total %j', async (total, outcome) => {
    const { fetchImpl } = bankFetch({ sale: () => ({ status: 'success', total_amount: total }) })
    const { pos } = realGateway(fetchImpl)
    const promise = pos.payment(MODEL.NON_SECURE, saleOrder({ amount: 12.34 }), TX_TYPE.PAY_AUTH, vectorCard())
    if (outcome === 'approved') {
      expect(((await promise) as Data).status).toBe('approved')
    } else {
      expect((await mismatch(promise)).field).toBe('amount')
    }
  })

  it('a sale answer with the same total is approved', async () => {
    const { fetchImpl } = bankFetch({
      sale: () => ({ status: 'success', total_amount: '5000', merchant_oid: 'order-456' }),
    })
    const { pos } = realGateway(fetchImpl)
    const res = (await pos.payment(MODEL.NON_SECURE, saleOrder(), TX_TYPE.PAY_AUTH, vectorCard())) as Data
    expect(res.status).toBe('approved')
    expect(res.amount).toBe(50)
  })

  it('a sale answer for another order id is an order_id mismatch with the result', async () => {
    const { fetchImpl } = bankFetch({ sale: () => ({ status: 'success', merchant_oid: 'other' }) })
    const { pos } = realGateway(fetchImpl)
    const err = await mismatch(pos.payment(MODEL.NON_SECURE, saleOrder(), TX_TYPE.PAY_AUTH, vectorCard()))
    expect(err.field).toBe('order_id')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.order_id).toBe('order-456')
  })

  // addition: G3 answers that do not tell the outcome are unknown outcomes, never declines
  it.each([
    ['{}', () => ({})],
    ['an unknown status', () => ({ status: 'x' })],
    ['wait_callback', () => ({ status: 'wait_callback' })],
    ['a padded success', () => ({ status: ' success' })],
    ['HTML', () => new Response('<html>blocked</html>', { status: 200 })],
    ['204', () => new Response(null, { status: 204 })],
    ['a blank 200', () => new Response('  ', { status: 200 })],
  ] as Array<[string, () => Answer]>)('a sale answer %s is a PosHttpError', async (_name, answer) => {
    const { sent, fetchImpl } = bankFetch({ sale: answer })
    const { pos } = realGateway(fetchImpl)
    const err = await pos.payment(MODEL.NON_SECURE, saleOrder(), TX_TYPE.PAY_AUTH, vectorCard()).catch((e) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect(sent).toHaveLength(1)
  })

  it('a pending sale names the notification URL', async () => {
    const { fetchImpl } = bankFetch({ sale: () => ({ status: 'wait_callback' }) })
    const { pos } = realGateway(fetchImpl)
    const err = (await pos
      .payment(MODEL.NON_SECURE, saleOrder(), TX_TYPE.PAY_AUTH, vectorCard())
      .catch((e) => e)) as PosHttpError
    expect(err.message).toBe('Payment outcome pending: PayTR reports it to the notification URL')
    expect(err.url).toBe('https://www.paytr.com/odeme')
  })

  // addition: G4 the refund happy path
  it('a refund is approved when the bank echoes the amount', async () => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    const res = (await pos.refund({ id: 'order-789', amount: 10.5 })) as Data
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe('https://www.paytr.com/odeme/iade')
    expect(sent[0]?.form.return_amount).toBe('10.50')
    expect(sent[0]?.form.paytr_token).toBe('ByvrSgSWGMqJY96KIJep2xRDBYzrBn63swqbsPLHPHI=')
    expect(res.status).toBe('approved')
    expect(res.order_id).toBe('order-789')
    expect(res.refund_amount).toBe(10.5)
  })

  it('a partial refund is picked by order_amount and sends reference_no', async () => {
    const seen: TxType[] = []
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl, { hooks: { onRequestDataPrepared: [(e) => void seen.push(e.txType)] } })
    const res = (await pos.refund({ id: 'order-789', amount: 5, order_amount: 10.5, reference_no: 'R1' })) as Data
    expect(seen).toStrictEqual([TX_TYPE.REFUND_PARTIAL])
    expect(sent[0]?.form.return_amount).toBe('5.00')
    expect(sent[0]?.form.reference_no).toBe('R1')
    expect(res.status).toBe('approved')
  })

  it('a refund answer with another amount is an amount mismatch', async () => {
    const { fetchImpl } = bankFetch({ refund: () => ({ status: 'success', return_amount: '5.00' }) })
    const { pos } = realGateway(fetchImpl)
    const err = await mismatch(pos.refund({ id: 'order-789', amount: 10.5 }))
    expect(err.field).toBe('amount')
    expect(err.paymentMayHaveCompleted).toBe(true)
  })

  it.each([['abc'], ['10.505'], ['']])(
    'a refund answer with return_amount %j is an amount mismatch',
    async (amount) => {
      const { fetchImpl } = bankFetch({ refund: () => ({ status: 'success', return_amount: amount }) })
      const { pos } = realGateway(fetchImpl)
      expect((await mismatch(pos.refund({ id: 'order-789', amount: 10.5 }))).field).toBe('amount')
    },
  )

  it('a refund answer for another order id is an order_id mismatch', async () => {
    const { fetchImpl } = bankFetch({ refund: () => ({ status: 'success', merchant_oid: 'other' }) })
    const { pos } = realGateway(fetchImpl)
    expect((await mismatch(pos.refund({ id: 'order-789', amount: 10.5 }))).field).toBe('order_id')
  })

  it.each([
    [{ status: 'failed', err_no: '009', err_msg: 'Iade tutari fazla' }],
    [{ status: 'error', err_no: '001', err_msg: 'Hata' }],
  ])('a refund answer %j is declined', async (answer) => {
    const { fetchImpl } = bankFetch({ refund: () => answer })
    const { pos } = realGateway(fetchImpl)
    const res = (await pos.refund({ id: 'order-789', amount: 10.5 })) as Data
    expect(res.status).toBe('declined')
    expect(res.error_code).toBe(answer.err_no)
    expect(res.error_message).toBe(answer.err_msg)
    expect(res.order_id).toBe('order-789')
  })

  it.each([
    ['{}', () => ({})],
    ['an unknown status', () => ({ status: 'pending' })],
    ['HTML', () => new Response('<html>blocked</html>', { status: 200 })],
    ['204', () => new Response(null, { status: 204 })],
    ['a blank 200', () => new Response('', { status: 200 })],
  ] as Array<[string, () => Answer]>)('a refund answer %s is a PosHttpError', async (_name, answer) => {
    const { fetchImpl } = bankFetch({ refund: answer })
    const { pos } = realGateway(fetchImpl)
    await expect(pos.refund({ id: 'order-789', amount: 10.5 })).rejects.toThrow(PosHttpError)
  })

  // addition: R2/R3 bad amounts and order ids never reach the bank
  it.each([[0], [-1], [0.004], ['abc'], [1e13], [undefined]])(
    'amount %j is a PosError before any request',
    async (value) => {
      const amount = value as number
      const { sent, fetchImpl } = bankFetch()
      const { pos } = realGateway(fetchImpl)
      await expect(
        pos.payment(MODEL.NON_SECURE, saleOrder({ amount }), TX_TYPE.PAY_AUTH, vectorCard()),
      ).rejects.toThrow(PosError)
      await expect(pos.refund({ id: 'order-789', amount })).rejects.toThrow(PosError)
      await expect(pos.get3DFormData(vectorOrder({ amount }), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)).rejects.toThrow(
        PosError,
      )
      expect(sent).toHaveLength(0)
    },
  )

  it.each([['a b'], ['a'.repeat(65)], ['-a']])('order id %j is a PosError in every request', async (id) => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    await expect(pos.payment(MODEL.NON_SECURE, saleOrder({ id }), TX_TYPE.PAY_AUTH, vectorCard())).rejects.toThrow(
      PosError,
    )
    await expect(pos.refund({ id, amount: 1 })).rejects.toThrow(PosError)
    await expect(pos.status({ id })).rejects.toThrow(PosError)
    expect(sent).toHaveLength(0)
  })

  it.each([
    ['no e-mail', { buyer: { name: 'John Doe', gsm_number: '05001234567' } }],
    ['no ip', { ip: undefined }],
    ['no phone', { buyer: { email: 'test@example.com', name: 'John Doe' } }],
  ])('%s: a sale is a PosError before any request', async (_name, over) => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    await expect(pos.payment(MODEL.NON_SECURE, saleOrder(over), TX_TYPE.PAY_AUTH, vectorCard())).rejects.toThrow(
      PosError,
    )
    expect(sent).toHaveLength(0)
  })

  // addition: G5 status is read-only: an unreadable answer maps declined
  it('status posts to durum-sorgu and maps the answer', async () => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    const res = (await pos.status({ id: 'order-999' })) as Data
    expect(sent[0]?.url).toBe('https://www.paytr.com/odeme/durum-sorgu')
    expect(sent[0]?.form.paytr_token).toBe('afNe9t3Xywh1Em6wDB5RKyc6A4rbI7uVh47XyaRHOs8=')
    expect(res.status).toBe('declined')
  })
})

describe('PayTrPos (end to end) masking', () => {
  // addition: C4 nothing secret reaches the logger
  it('never logs the salt, the key, a request token, the card number, the CVV or the expiry', async () => {
    const records: unknown[] = []
    const record =
      (level: string) =>
      (...args: unknown[]) =>
        records.push([level, ...args])
    const logger: PosLogger = {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    }
    const hooks: PosHooks = {
      onRequestDataPrepared: [
        (event) => {
          if (event.txType === TX_TYPE.STATUS) event.requestData.note = 'changed by a hook'
        },
      ],
    }
    const { sent, fetchImpl } = bankFetch({
      status: (form) => ({ status: 'error', err_no: '004', err_msg: `echo ${form.paytr_token} ${PM_SALT}` }),
    })
    const { pos } = realGateway(fetchImpl, { logger, hooks })
    const tampered: Data = { ...nv2(), total_amount: '1002' }

    await pos.get3DFormData(vectorOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)
    const form = (await pos.get3DFormData(
      vectorOrder(),
      MODEL.THREE_D_PAY,
      TX_TYPE.PAY_AUTH,
      vectorCard(),
    )) as ThreeDFormData
    await pos.payment(MODEL.NON_SECURE, saleOrder(), TX_TYPE.PAY_AUTH, vectorCard())
    await pos.refund({ id: 'order-789', amount: 10.5 })
    await pos.status({ id: 'order-999' })
    await pos
      .payment(MODEL.THREE_D_PAY, hostedOrder('20260623E335', 10.01), TX_TYPE.PAY_AUTH, null, cb(tampered))
      .catch(() => undefined)

    const logged = JSON.stringify(records)
    expect(sent).toHaveLength(4)
    expect(logged).toContain('Request data is changed via listeners')
    expect(logged).not.toContain(PM_SALT)
    expect(logged).not.toContain(PM_KEY)
    expect(logged).not.toContain('4355084355084358')
    expect(logged).not.toMatch(/cvv\\?"\s*:\s*\\?"?000/i)
    expect(logged).not.toMatch(/expiry_(?:month|year)\\?"\s*:\s*\\?"?\d/)
    expect(logged).not.toContain(form.inputs.paytr_token)
    for (const s of sent) expect(logged).not.toContain(s.form.paytr_token)
    expect(logged).not.toContain(tampered.hash)
    const failure = records.find((r) => (r as unknown[])[1] === 'hash check failed') as unknown[]
    expect(failure).toBeDefined()
    expect(Object.keys(failure[2] as object)).toStrictEqual(['order_id'])
  })

  // addition: secrets of the factory-built gateway are never serialised
  it('JSON and inspect dumps of the PosFactory-built gateway hold no secret', () => {
    const salt = 'SaltValue9f8e7d6c'
    const key = 'KeyValue1a2b3c4d5e'
    const account = AccountFactory.createPayTrPosAccount('paytr', '123456', salt, key)
    const gateway = PosFactory.createPosGateway(account, posTestConfig)
    const dumps = [JSON.stringify(gateway), inspect(gateway, { depth: 20, showHidden: true })]
    for (const dump of dumps) {
      expect(dump).not.toContain(salt)
      expect(dump).not.toContain(key)
    }
  })
})

describe('PayTrPos (end to end) concurrency', () => {
  // addition: C7 one gateway serves concurrent notifications and form builds
  it('two concurrent notifications keep their own results', async () => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl, { account: PT })
    const [a, b] = (await Promise.all([
      pos.payment(MODEL.THREE_D_PAY, hostedOrder('20260623E335', 10.01), TX_TYPE.PAY_AUTH, null, cb(nv2())),
      pos.payment(MODEL.THREE_D_HOST, hostedOrder('ORDER42', 10.5), TX_TYPE.PAY_AUTH, null, cb(nv6())),
    ])) as Data[]
    expect([a?.order_id, a?.amount, a?.payment_model]).toStrictEqual(['20260623E335', 10.01, '3d_pay'])
    expect([b?.order_id, b?.amount, b?.payment_model]).toStrictEqual(['ORDER42', 10.5, '3d_host'])
    expect(sent).toHaveLength(0)
  })

  it('two concurrent 3D Host form builds keep their own tokens', async () => {
    const { fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    const [a, b] = (await Promise.all([
      pos.get3DFormData(vectorOrder({ id: 'A1' }), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH),
      pos.get3DFormData(vectorOrder({ id: 'B2' }), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH),
    ])) as ThreeDFormData[]
    expect(a?.gateway).toBe('https://www.paytr.com/odeme/guvenli/tokA1')
    expect(b?.gateway).toBe('https://www.paytr.com/odeme/guvenli/tokB2')
  })
})
