import { createHmac } from 'node:crypto'
import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import type { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { IyzicoPosCrypt } from '../../../src/crypt/IyzicoPosCrypt.js'
import { IyzicoPosRequestDataMapper } from '../../../src/data-mapper/request/mapper/IyzicoPosRequestDataMapper.js'
import type { RequestDataMapperInterface } from '../../../src/data-mapper/request/mapper/RequestDataMapperInterface.js'
import { IyzicoPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/IyzicoPosRequestValueFormatter.js'
import { IyzicoPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/IyzicoPosRequestValueMapper.js'
import { IyzicoPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/IyzicoPosResponseDataMapper.js'
import type { ResponseDataMapperInterface } from '../../../src/data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { IyzicoPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/IyzicoPosResponseValueFormatter.js'
import { IyzicoPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/IyzicoPosResponseValueMapper.js'
import {
  HashMismatchError,
  OrderMismatchError,
  PosError,
  PosHttpError,
  UnsupportedFormFormatError,
  UnsupportedTransactionTypeError,
} from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../src/factory/CreditCardFactory.js'
import { PosFactory } from '../../../src/factory/PosFactory.js'
import { PosHttpClientStrategyFactory } from '../../../src/factory/PosHttpClientStrategyFactory.js'
import type { GatewayConfig, GatewayDeps } from '../../../src/gateway/AbstractGateway.js'
import { IyzicoPos } from '../../../src/gateway/IyzicoPos.js'
import type { PosLogger } from '../../../src/logger.js'
import type { IyzicoPosAccount } from '../../../src/model/account/IyzicoPosAccount.js'
import {
  CURRENCY,
  FORM_FORMAT,
  LANG,
  MODEL,
  type PaymentModel,
  TX_TYPE,
  type TxType,
} from '../../../src/PosInterface.js'
import type { GatewayResponseData, PosHooks, PosOrder, RequestDataPreparedEvent } from '../../../src/types.js'

// The first section replaces the collaborators with vi.fn() fakes (except the request value mapper); the end-to-end
// sections use the real crypt, mappers and HTTP clients over a fake fetch that answers like iyzico (by path), checks
// the Authorization header of every request against the exact bytes sent, and records every request.

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

const SECRET = 'sandbox-secretKey'
const IA = AccountFactory.createIyzicoPosAccount('iyzico', 'sandbox-apiKey', SECRET)

/** Lowercase hex HMAC-SHA256 with the IA secret key. */
const HX = (message: string): string => createHmac('sha256', SECRET).update(message, 'utf8').digest('hex')

/** The signed callback text and its signature. */
const callbackSignature = (cd: string, cid: string, md: string, pid: string, st: string): string =>
  HX(`${cd}:${cid}:${md}:${pid}:${st}`)

const SIGNED_FIELDS: Record<string, string[]> = {
  payment: ['paymentId', 'currency', 'basketId', 'conversationId', 'paidPrice', 'price'],
  threeDSInit: ['paymentId', 'conversationId'],
  checkoutFormInit: ['conversationId', 'token'],
  checkoutFormRetrieve: [
    'paymentStatus',
    'paymentId',
    'currency',
    'basketId',
    'conversationId',
    'paidPrice',
    'price',
    'token',
  ],
  refund: ['paymentId', 'price', 'currency', 'conversationId'],
}

/** The signature text of a price: eight decimals at most, trailing zeros removed. */
const priceText = (value: unknown): string => {
  if (typeof value === 'number') return String(Number(value.toFixed(8)))
  const text = String(value)
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}

/** The answer with a fresh signature over the documented fields of its kind. */
const signed = (kind: string, answer: Data): Data => {
  const message = (SIGNED_FIELDS[kind] ?? [])
    .map((name) => (name === 'price' || name === 'paidPrice' ? priceText(answer[name]) : String(answer[name] ?? '')))
    .join(':')
  return { ...answer, signature: HX(message) }
}

const CB3 = '45b616fbe1dc2f78d796505551d4c4bbaf7ada9cfa6fc960b668a3a000ead074'
const P4 = 'f1689a8ed87fb7dda212cffaf08d2415e8a13f7b7a8a7fc499297582febfde30'
const CF2 = '0073309e4f8c2ae874d5a805470c020753ca4b3db071fa3a558e07549158636a'
const R2 = 'd596a79b87ad1fc5bf0f3ecaf82319a67d6f1f2e22bf676b80f8abda41e33cdc'

/** The CB3 callback of order-001 (payment 1001), signed. */
const cb3 = (over: Data = {}): Data => ({
  conversationId: 'order-001',
  mdStatus: '1',
  paymentId: '1001',
  status: 'success',
  signature: CB3,
  ...over,
})

/** A callback signed over its own five fields. */
const signedCallback = (fields: Data): Data => ({
  ...fields,
  signature: callbackSignature(
    fields.conversationData ?? '',
    fields.conversationId ?? '',
    fields.mdStatus ?? '',
    fields.paymentId ?? '',
    fields.status ?? '',
  ),
})

const cb = (data: Data): GatewayResponseData => data as GatewayResponseData

const createLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })

const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64')

/** The payer and basket fields every payment body needs (iyzico requires them). */
const paymentExtras = (amount: number): PosOrder => ({
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
  basket_items: [{ id: 'BI101', name: 'Binocular', category1: 'Collectibles', item_type: 'PHYSICAL', price: amount }],
})

describe('IyzicoPos planning vectors', () => {
  // addition: CB3, P4, CF2 and R2 recomputed with node:crypto (IA)
  it.each([
    ['CB3', callbackSignature('', 'order-001', '1', '1001', 'success'), CB3],
    [
      'P4',
      signed('payment', {
        paymentId: '1001',
        currency: 'TRY',
        basketId: 'order-001',
        conversationId: 'order-001',
        paidPrice: 100,
        price: 100,
      }).signature,
      P4,
    ],
    [
      'CF2',
      signed('checkoutFormRetrieve', {
        paymentStatus: 'SUCCESS',
        paymentId: '1001',
        currency: 'TRY',
        basketId: 'order-001',
        conversationId: 'order-001',
        paidPrice: 110,
        price: 100,
        token: 'tok-123',
      }).signature,
      CF2,
    ],
    [
      'R2',
      signed('refund', { paymentId: '1001', price: 40, currency: 'TRY', conversationId: 'order-001' }).signature,
      R2,
    ],
  ])('%s', (_name, actual, expected) => {
    expect(actual).toBe(expected)
  })
})

describe('IyzicoPos (mocked collaborators)', () => {
  const config: GatewayConfig = {
    name: 'iyzico',
    class: 'IyzicoPos',
    gateway_endpoints: {
      payment_api: 'https://sandbox-api.iyzipay.com',
      query_api: 'https://sandbox-api.iyzipay.com/v2/reporting/payment',
    },
  }

  let requestValueMapper: IyzicoPosRequestValueMapper
  let requestMapper: Mocked<RequestDataMapperInterface> & {
    create3DHostPaymentStatusRequestData: ReturnType<typeof vi.fn>
  }
  let responseMapper: Mocked<ResponseDataMapperInterface>
  let crypt: Mocked<CryptInterface> & { checkResponseSignature: ReturnType<typeof vi.fn> }
  let httpClient: { supportsTx: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }
  let clientStrategy: { getClient: ReturnType<typeof vi.fn>; getAllClients: ReturnType<typeof vi.fn> }
  let requestDataPrepared: ReturnType<typeof vi.fn<(e: RequestDataPreparedEvent) => void>>
  let logger: ReturnType<typeof createLogger>
  let pos: IyzicoPos

  const createGateway = (cfg: GatewayConfig): IyzicoPos => {
    const hooks: PosHooks = { onRequestDataPrepared: [requestDataPrepared] }
    const deps: GatewayDeps<IyzicoPosAccount> = {
      requestValueMapper,
      requestValueFormatter: new IyzicoPosRequestValueFormatter(),
      requestDataMapper: requestMapper as unknown as RequestDataMapperInterface<IyzicoPosAccount>,
      responseDataMapper: responseMapper as unknown as ResponseDataMapperInterface,
      crypt: crypt as unknown as CryptInterface<IyzicoPosAccount>,
      clientStrategy: clientStrategy as unknown as HttpClientStrategy,
      logger,
      hooks,
    }
    return new IyzicoPos(cfg, IA, deps)
  }

  beforeEach(() => {
    requestValueMapper = new IyzicoPosRequestValueMapper()
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
      create3DHostPaymentStatusRequestData: vi.fn(),
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
      readProcReturnCode: vi.fn(),
    }
    crypt = {
      hashString: vi.fn(),
      check3DHash: vi.fn(),
      create3DHash: vi.fn(),
      createHash: vi.fn(),
      hashFromParams: vi.fn(),
      generateRandomString: vi.fn(),
      checkResponseSignature: vi.fn(),
    }
    httpClient = { supportsTx: vi.fn(), request: vi.fn() }
    clientStrategy = { getClient: vi.fn(), getAllClients: vi.fn() }
    requestDataPrepared = vi.fn()
    logger = createLogger()
    pos = createGateway(config)
  })

  // deviation: R4 iyzico needs the payer, the addresses and a basket that adds up to the amount
  const order = (): PosOrder => ({
    id: 'order-001',
    amount: 100.0,
    currency: CURRENCY.TRY,
    success_url: 'https://example.com/success',
    fail_url: 'https://example.com/fail',
    ...paymentExtras(100),
  })

  const card = () => CreditCardFactory.create('5555444433332222', '26', '12', '123', 'John Doe')

  const basketItem = (): Data => (paymentExtras(100).basket_items as Data[])[0] as Data

  /** A payment answer of order-001 whose signature the crypt stub accepts. */
  const paymentAnswer = (over: Data = {}): Data => ({
    status: 'success',
    paymentId: '1001',
    conversationId: 'order-001',
    basketId: 'order-001',
    price: 100,
    paidPrice: 100,
    currency: 'TRY',
    phase: 'AUTH',
    fraudStatus: 1,
    signature: 'a'.repeat(64),
    ...over,
  })

  /** One client call, one hook dispatch that adds a marker the client must receive. */
  const configureClientResponse = (
    txType: TxType,
    requestData: Data,
    decodedResponse: Data,
    sentOrder: PosOrder,
    paymentModel: PaymentModel,
  ): (() => void) => {
    clientStrategy.getClient.mockReturnValue(httpClient as unknown as AbstractHttpClient)
    httpClient.request.mockResolvedValue(decodedResponse)
    requestDataPrepared.mockImplementation((event) => {
      expect(event.gatewayClass).toBe('IyzicoPos')
      expect(event.txType).toBe(txType)
      expect(event.requestData).toStrictEqual(requestData)
      expect(event.order).toStrictEqual(sentOrder)
      expect(event.paymentModel).toBe(paymentModel)
      event.requestData['test-event-marker'] = true
    })

    return () => {
      expect(clientStrategy.getClient).toHaveBeenCalledTimes(1)
      expect(clientStrategy.getClient).toHaveBeenCalledWith(txType, paymentModel)
      expect(requestDataPrepared).toHaveBeenCalledTimes(1)
      expect(httpClient.request).toHaveBeenCalledTimes(1)
      const [tx, model, data, orderSent, url] = httpClient.request.mock.calls[0] as unknown[]
      expect([tx, model, orderSent, url]).toStrictEqual([txType, paymentModel, sentOrder, null])
      expect((data as Data)['test-event-marker']).toBe(true)
    }
  }

  const expectNoRequest = () => {
    expect(httpClient.request).not.toHaveBeenCalled()
    expect(requestDataPrepared).not.toHaveBeenCalled()
  }

  it('init', () => {
    expect(pos.getCurrencies()).toHaveLength(Object.keys(requestValueMapper.getCurrencyMappings()).length)
    expect(pos.getAccount()).toBe(IA)
    expect(pos.isTestMode()).toBe(false)
    expect(pos.getCrypt()).toBe(crypt)
  })

  // addition: G1 identifiers
  it('exposes NAME and the gateway class identifier', () => {
    expect(IyzicoPos.NAME).toBe('IyzicoPos')
    expect(IyzicoPos.GATEWAY_CLASS).toBe('IyzicoPos')
    for (const tx of [TX_TYPE.PAY_AUTH, TX_TYPE.PAY_PRE_AUTH]) {
      for (const model of [MODEL.THREE_D_SECURE, MODEL.NON_SECURE, MODEL.THREE_D_HOST]) {
        expect(IyzicoPos.isSupportedTransaction(tx, model)).toBe(true)
      }
      expect(IyzicoPos.isSupportedTransaction(tx, MODEL.THREE_D_PAY_HOSTING)).toBe(false)
    }
    for (const tx of [
      TX_TYPE.PAY_POST_AUTH,
      TX_TYPE.CANCEL,
      TX_TYPE.REFUND,
      TX_TYPE.REFUND_PARTIAL,
      TX_TYPE.STATUS,
      TX_TYPE.ORDER_HISTORY,
    ]) {
      expect(IyzicoPos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(true)
    }
    expect(IyzicoPos.isSupportedTransaction('history' as TxType, MODEL.NON_SECURE)).toBe(false)
  })

  // addition: the gateway needs a crypt that verifies answer signatures
  it('refuses a crypt without the answer signature check', () => {
    const { checkResponseSignature: _drop, ...plain } = crypt
    const deps = {
      requestValueMapper,
      requestValueFormatter: new IyzicoPosRequestValueFormatter(),
      requestDataMapper: requestMapper as unknown as RequestDataMapperInterface<IyzicoPosAccount>,
      responseDataMapper: responseMapper as unknown as ResponseDataMapperInterface,
      crypt: plain as unknown as CryptInterface<IyzicoPosAccount>,
      clientStrategy: clientStrategy as unknown as HttpClientStrategy,
      logger,
      hooks: {},
    }
    expect(() => new IyzicoPos(config, IA, deps)).toThrow(PosError)
  })

  // deviation: C8 stateless; the answers carry the signed fields of order-001 (signature stub true)
  it.each([
    ['approved', paymentAnswer(), { status: 'approved' }, 'approved'],
    ['declined', { status: 'failure' }, { status: 'declined' }, 'declined'],
  ] as Array<[string, Data, Data, string]>)('isSuccess: %s', async (_name, answer, mapped, expected) => {
    const verify = configureClientResponse(TX_TYPE.PAY_AUTH, { req: true }, answer, order(), MODEL.NON_SECURE)
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue({ req: true })
    responseMapper.mapPaymentResponse.mockReturnValue(mapped)
    crypt.checkResponseSignature.mockReturnValue(true)

    const result = await pos.payment(MODEL.NON_SECURE, order(), TX_TYPE.PAY_AUTH, card())

    verify()
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledTimes(1)
    expect(result.status).toBe(expected)
  })

  // deviation: M1 an empty answer is an unknown outcome
  it('isSuccess: no_status', async () => {
    configureClientResponse(TX_TYPE.PAY_AUTH, { req: true }, {}, order(), MODEL.NON_SECURE)
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue({ req: true })
    responseMapper.mapPaymentResponse.mockReturnValue({})

    await expect(pos.payment(MODEL.NON_SECURE, order(), TX_TYPE.PAY_AUTH, card())).rejects.toThrow(PosHttpError)
  })

  const defaultEndpoints = {
    payment_api: 'https://sandbox-api.iyzipay.com',
    gateway_3d: 'https://sandbox-api.iyzipay.com',
    query_api: 'https://sandbox-api.iyzipay.com/v2/reporting/payment',
  }
  const endpointsWithHost = { ...defaultEndpoints, gateway_3d_host: 'https://host.iyzipay.com' }
  it.each([
    ['default_no_model', defaultEndpoints, null, 'https://sandbox-api.iyzipay.com'],
    ['3d_host_with_host_endpoint', endpointsWithHost, MODEL.THREE_D_HOST, 'https://host.iyzipay.com'],
    ['3d_secure_with_host_endpoint', endpointsWithHost, MODEL.THREE_D_SECURE, 'https://sandbox-api.iyzipay.com'],
  ] as Array<[string, GatewayConfig['gateway_endpoints'], PaymentModel | null, string]>)(
    'get3DGatewayURL: %s',
    (_name, endpoints, model, expected) => {
      const gateway = createGateway({ name: 'iyzico', class: 'IyzicoPos', gateway_endpoints: endpoints })
      expect(model === null ? gateway.get3DGatewayURL() : gateway.get3DGatewayURL(model)).toBe(expected)
    },
  )

  it('getCardTypeMapping', () => {
    expect(pos.getCardTypeMapping()).toStrictEqual({})
  })

  it('getLanguages', () => {
    expect(pos.getLanguages()).toStrictEqual(['tr', 'en'])
  })

  it('isSupportedTransaction true', () => {
    expect(IyzicoPos.isSupportedTransaction(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE)).toBe(true)
    expect(IyzicoPos.isSupportedTransaction(TX_TYPE.CANCEL, MODEL.NON_SECURE)).toBe(true)
  })

  it('isSupportedTransaction false', () => {
    expect(IyzicoPos.isSupportedTransaction(TX_TYPE.PAY_AUTH, MODEL.THREE_D_PAY)).toBe(false)
    expect(IyzicoPos.isSupportedTransaction('unsupported_type' as TxType, MODEL.NON_SECURE)).toBe(false)
  })

  it('payment without a card throws', async () => {
    await expect(pos.payment(MODEL.NON_SECURE, order(), TX_TYPE.PAY_AUTH)).rejects.toThrow(PosError)
    expectNoRequest()
  })

  it('makeRegularPostPayment', async () => {
    const txType = TX_TYPE.PAY_POST_AUTH
    // deviation: R3 the payment to capture
    const postOrder: PosOrder = { ...order(), transaction_id: '1001' }
    // deviation: M3-M6 a signed capture answer of this payment
    const bankResponse = paymentAnswer({ phase: 'POST_AUTH' })
    const verify = configureClientResponse(
      txType,
      { 'post-auth-request': true },
      bankResponse,
      postOrder,
      MODEL.NON_SECURE,
    )
    requestMapper.createNonSecurePostAuthPaymentRequestData.mockReturnValue({ 'post-auth-request': true })
    responseMapper.mapPaymentResponse.mockReturnValue({ status: 'approved', mapped: 'post-auth' })
    crypt.checkResponseSignature.mockReturnValue(true)

    const result = await pos.payment(txType as unknown as PaymentModel, postOrder, txType)

    verify()
    expect(requestMapper.createNonSecurePostAuthPaymentRequestData).toHaveBeenCalledWith(IA, postOrder)
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith(bankResponse, txType, postOrder)
    expect(crypt.checkResponseSignature).toHaveBeenCalledWith(IA, bankResponse, 'payment')
    // deviation: M8 the approved result is completed from the order and the signed answer
    expect(result).toStrictEqual({
      status: 'approved',
      mapped: 'post-auth',
      order_id: 'order-001',
      currency: 'TRY',
      amount: 100,
      transaction_id: '1001',
      payment_model: MODEL.NON_SECURE,
      transaction_type: txType,
    })
  })

  it('make3DPayPayment throws', async () => {
    await expect(pos.payment(MODEL.THREE_D_PAY, {}, TX_TYPE.PAY_AUTH, null, cb({ token: 'x' }))).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    await expect(pos.make3DPayPayment(cb({ token: 'x' }), order(), TX_TYPE.PAY_AUTH)).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
  })

  it('get3DFormData with array format and 3D Secure throws', async () => {
    await expect(
      pos.get3DFormData(order(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card(), false, FORM_FORMAT.ARRAY),
    ).rejects.toThrow(UnsupportedFormFormatError)
    expectNoRequest()
  })

  // addition: T1 the gateway itself requires the card for 3D Secure (the request mapper here is a stub)
  it('get3DFormData 3D Secure with createWithoutCard and no card is a PosError before the mapper', async () => {
    requestMapper.create3DFormInitializeRequestData.mockReturnValue({ 'request-data': true })
    await expect(pos.get3DFormData(order(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, null, true)).rejects.toThrow(
      'iyzico 3D Secure needs the card',
    )
    expect(requestMapper.create3DFormInitializeRequestData).not.toHaveBeenCalled()
    expectNoRequest()
  })

  // addition: R4 the gateway itself validates the basket before an initialize request (the mapper here is a stub)
  it.each([
    [MODEL.THREE_D_SECURE, card],
    [MODEL.THREE_D_HOST, () => null],
  ] as Array<[PaymentModel, () => ReturnType<typeof card> | null]>)(
    'get3DFormData %s with a basket that does not add up is a PosError before the mapper',
    async (model, theCard) => {
      requestMapper.create3DFormInitializeRequestData.mockReturnValue({ 'request-data': true })
      const bad = { ...order(), basket_items: [{ ...basketItem(), price: 99 }] }
      await expect(pos.get3DFormData(bad, model, TX_TYPE.PAY_AUTH, theCard())).rejects.toThrow(
        'Basket item prices must add up to the order amount',
      )
      expect(requestMapper.create3DFormInitializeRequestData).not.toHaveBeenCalled()
      expectNoRequest()
    },
  )

  it('get3DFormData failed init response', async () => {
    const initResponse = { status: 'failure', errorMessage: '3D init failed', errorCode: '404' }
    const verify = configureClientResponse(
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      { 'request-data': true },
      initResponse,
      order(),
      MODEL.THREE_D_SECURE,
    )
    requestMapper.create3DFormInitializeRequestData.mockReturnValue({ 'request-data': true })

    // deviation: C7 PosError with the bounded bank text
    const err = await pos.get3DFormData(order(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card()).catch((e) => e)
    expect(err).toBeInstanceOf(PosError)
    expect((err as Error).message).toContain('3D init failed')
    verify()
  })

  it('get3DFormData 3D Secure returns the HTML', async () => {
    const htmlContent = '<html lang="tr">3D Secure Form</html>'
    const initResponse = { status: 'success', threeDSHtmlContent: b64(htmlContent) }
    const verify = configureClientResponse(
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      { 'request-data': true },
      initResponse,
      order(),
      MODEL.THREE_D_SECURE,
    )
    requestMapper.create3DFormInitializeRequestData.mockReturnValue({ 'request-data': true })
    const theCard = card()

    const result = await pos.get3DFormData(order(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, theCard)

    verify()
    expect(requestMapper.create3DFormInitializeRequestData).toHaveBeenCalledWith(
      IA,
      order(),
      MODEL.THREE_D_SECURE,
      TX_TYPE.PAY_AUTH,
      theCard,
    )
    expect(result).toBe(htmlContent)
  })

  it('get3DFormData 3D Host returns the HTML by default', async () => {
    const checkoutContent = '<script>checkout</script>'
    // deviation: T1 the answer carries its token
    const initResponse = {
      status: 'success',
      token: 'tok-123',
      checkoutFormContent: checkoutContent,
      paymentPageUrl: 'https://checkout.iyzipay.com/pay/xxx',
    }
    const verify = configureClientResponse(
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      { 'request-data': true },
      initResponse,
      order(),
      MODEL.THREE_D_HOST,
    )
    requestMapper.create3DFormInitializeRequestData.mockReturnValue({ 'request-data': true })

    const result = await pos.get3DFormData(order(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true)

    verify()
    expect(requestMapper.create3DFormInitializeRequestData).toHaveBeenCalledWith(
      IA,
      order(),
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_AUTH,
      null,
    )
    expect(result).toBe(checkoutContent)
  })

  it('get3DFormData 3D Host returns the array', async () => {
    // deviation: T1 the answer carries its token
    const initResponse = {
      status: 'success',
      token: 'tok-123',
      checkoutFormContent: '<script/>',
      paymentPageUrl: 'https://checkout.iyzipay.com/pay/xxx',
    }
    const verify = configureClientResponse(
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      { 'request-data': true },
      initResponse,
      order(),
      MODEL.THREE_D_HOST,
    )
    requestMapper.create3DFormInitializeRequestData.mockReturnValue({ 'request-data': true })

    const result = await pos.get3DFormData(order(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true, FORM_FORMAT.ARRAY)

    verify()
    expect(result).toStrictEqual({ gateway: 'https://checkout.iyzipay.com/pay/xxx', method: 'GET', inputs: {} })
  })

  it('make3DPayment with a 3D auth failure', async () => {
    const body = { mdStatus: '0', status: 'failure' }
    const mapped = { status: 'declined', transaction_type: TX_TYPE.PAY_AUTH, payment_model: MODEL.THREE_D_SECURE }
    responseMapper.map3DPaymentData.mockReturnValue(mapped)

    const result = await pos.payment(MODEL.THREE_D_SECURE, order(), TX_TYPE.PAY_AUTH, null, cb(body))

    expect(responseMapper.map3DPaymentData).toHaveBeenCalledTimes(1)
    expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(body, null, TX_TYPE.PAY_AUTH, order())
    expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
    expectNoRequest()
    // deviation: T2 the trusted decline carries the order's id and the callback's 3D status only; `3d_all` is the
    // callback as read (a copy without prototype)
    expect(result['3d_all']).toEqual(body)
    expect({ ...result, '3d_all': body }).toStrictEqual({
      order_id: 'order-001',
      transaction_id: null,
      transaction_time: null,
      transaction_type: TX_TYPE.PAY_AUTH,
      installment_count: null,
      currency: null,
      amount: null,
      payment_model: MODEL.THREE_D_SECURE,
      auth_code: null,
      ref_ret_num: null,
      batch_num: null,
      proc_return_code: 'failure',
      status: 'declined',
      error_code: null,
      error_message: null,
      all: null,
      md_status: '0',
      md_error_message: null,
      transaction_security: null,
      '3d_all': body,
    })
  })

  const signedCallbackBody = () => ({
    mdStatus: '1',
    status: 'success',
    signature: 'b'.repeat(64),
    conversationId: 'order-001',
    paymentId: '1001',
  })

  it('make3DPayment hash mismatch throws', async () => {
    const body = signedCallbackBody()
    crypt.check3DHash.mockReturnValue(false)

    await expect(pos.payment(MODEL.THREE_D_SECURE, order(), TX_TYPE.PAY_AUTH, null, cb(body))).rejects.toThrow(
      HashMismatchError,
    )
    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
    expect(crypt.check3DHash).toHaveBeenCalledWith(IA, body)
    expectNoRequest()
  })

  const run3DSuccess = async (gateway: IyzicoPos) => {
    const body = signedCallbackBody()
    const provisionResponse = paymentAnswer({ mdStatus: '1' })
    const verify = configureClientResponse(
      TX_TYPE.PAY_AUTH,
      { create3DPaymentRequestData: true },
      provisionResponse,
      order(),
      MODEL.THREE_D_SECURE,
    )
    crypt.check3DHash.mockReturnValue(true)
    crypt.checkResponseSignature.mockReturnValue(true)
    requestMapper.create3DPaymentRequestData.mockReturnValue({ create3DPaymentRequestData: true })
    responseMapper.map3DPaymentData.mockReturnValue({ status: 'approved', md_status: '1' })

    const result = await gateway.payment(MODEL.THREE_D_SECURE, order(), TX_TYPE.PAY_AUTH, null, cb(body))

    verify()
    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
    expect(crypt.check3DHash).toHaveBeenCalledWith(IA, body)
    expect(requestMapper.create3DPaymentRequestData).toHaveBeenCalledWith(IA, order(), TX_TYPE.PAY_AUTH, body)
    expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(body, provisionResponse, TX_TYPE.PAY_AUTH, order())
    expect(crypt.checkResponseSignature).toHaveBeenCalledWith(IA, provisionResponse, 'payment')
    // deviation: M8 the approved result is completed from the order and the signed answer
    expect(result).toStrictEqual({
      status: 'approved',
      md_status: '1',
      order_id: 'order-001',
      currency: 'TRY',
      amount: 100,
      transaction_id: '1001',
      payment_model: MODEL.THREE_D_SECURE,
      transaction_type: TX_TYPE.PAY_AUTH,
    })
  }

  it('make3DPayment success', async () => {
    await run3DSuccess(pos)
  })

  // deviation: T2 the check cannot be disabled: the crypt is still called and the flow is the success flow
  it('make3DPayment without hash check', async () => {
    const gateway = createGateway({ ...config, gateway_configs: { disable_3d_hash_check: true } } as GatewayConfig)
    await run3DSuccess(gateway)
  })

  it('make3DHostPayment', async () => {
    const callback = { token: 'tok-123' }
    // deviation: H1 the checkout record of this order, signed (stub), with its token
    const statusResponse = {
      ...paymentAnswer({ paidPrice: 110, mdStatus: '1' }),
      paymentStatus: 'SUCCESS',
      token: 'tok-123',
    }
    const verify = configureClientResponse(
      TX_TYPE.INTERNAL_3D_PAYMENT_STATUS,
      { 'host-status-request': true },
      statusResponse,
      order(),
      MODEL.THREE_D_HOST,
    )
    requestMapper.create3DHostPaymentStatusRequestData.mockReturnValue({ 'host-status-request': true })
    responseMapper.mapPaymentResponse.mockReturnValue({ status: 'approved' })
    responseMapper.extractMdStatus.mockReturnValue('1')
    crypt.checkResponseSignature.mockReturnValue(true)

    // deviation: H1 the reference row passes tx 'status'; a checkout completes a payment
    const result = await pos.payment(MODEL.THREE_D_HOST, order(), TX_TYPE.PAY_AUTH, null, cb(callback))

    verify()
    expect(requestMapper.create3DHostPaymentStatusRequestData).toHaveBeenCalledWith(callback, order())
    expect(crypt.checkResponseSignature).toHaveBeenCalledWith(IA, statusResponse, 'checkoutFormRetrieve')
    // deviation: H1 the approval maps the signed record as a payment; the 3D field is checked by the review rule
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith(statusResponse, TX_TYPE.PAY_AUTH, order())
    expect(responseMapper.map3DHostResponseData).not.toHaveBeenCalled()
    expect(result).toStrictEqual({
      status: 'approved',
      order_id: 'order-001',
      currency: 'TRY',
      amount: 110,
      transaction_id: '1001',
      payment_model: MODEL.THREE_D_HOST,
      transaction_type: TX_TYPE.PAY_AUTH,
      md_status: '1',
      md_error_message: null,
      transaction_security: null,
    })
  })

  it.each([
    ['order-1', 100.0, TX_TYPE.PAY_AUTH, 'AUTH'],
    ['order-2', 200.0, TX_TYPE.PAY_PRE_AUTH, 'PRE_AUTH'],
  ] as Array<[string, number, TxType, string]>)('makeRegularPayment %s', async (id, amount, txType, phase) => {
    // deviation: R4 the orders carry the payer, the addresses and the basket
    const payOrder: PosOrder = { id, amount, ...paymentExtras(amount) }
    // deviation: M3-M6 a signed answer of this order
    const decodedResponse = paymentAnswer({ conversationId: id, basketId: id, price: amount, paidPrice: amount, phase })
    const verify = configureClientResponse(
      txType,
      { 'non-secure-request': true },
      decodedResponse,
      payOrder,
      MODEL.NON_SECURE,
    )
    const theCard = card()
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue({ 'non-secure-request': true })
    responseMapper.mapPaymentResponse.mockReturnValue({ status: 'approved', result: true })
    crypt.checkResponseSignature.mockReturnValue(true)

    const result = await pos.payment(MODEL.NON_SECURE, payOrder, txType, theCard)

    verify()
    expect(requestMapper.createNonSecurePaymentRequestData).toHaveBeenCalledWith(IA, payOrder, txType, theCard)
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith(decodedResponse, txType, payOrder)
    expect(result).toStrictEqual({
      status: 'approved',
      result: true,
      order_id: id,
      currency: 'TRY',
      amount,
      transaction_id: '1001',
      payment_model: MODEL.NON_SECURE,
      transaction_type: txType,
    })
  })

  it('status', async () => {
    const bankResponse = { status: 'success' }
    const verify = configureClientResponse(
      TX_TYPE.STATUS,
      { 'status-request': true },
      bankResponse,
      order(),
      MODEL.NON_SECURE,
    )
    requestMapper.createStatusRequestData.mockReturnValue({ 'status-request': true })
    responseMapper.mapStatusResponse.mockReturnValue({ mapped: 'status' })
    // deviation: M3 a status approval must carry a valid signature
    crypt.checkResponseSignature.mockReturnValue(true)

    const result = await pos.status(order())

    verify()
    expect(requestMapper.createStatusRequestData).toHaveBeenCalledWith(IA, order())
    expect(crypt.checkResponseSignature).toHaveBeenCalledWith(IA, bankResponse, 'payment')
    expect(responseMapper.mapStatusResponse).toHaveBeenCalledWith(bankResponse)
    expect(result).toStrictEqual({ mapped: 'status' })
  })

  it('cancel', async () => {
    // deviation: R3 the payment to cancel
    const cancelOrder: PosOrder = { ...order(), transaction_id: '1001' }
    // deviation: M1/M9 an answer with a result, of this payment
    const bankResponse = { status: 'success', paymentId: '1001', conversationId: 'order-001' }
    const verify = configureClientResponse(
      TX_TYPE.CANCEL,
      { 'cancel-request': true },
      bankResponse,
      cancelOrder,
      MODEL.NON_SECURE,
    )
    requestMapper.createCancelRequestData.mockReturnValue({ 'cancel-request': true })
    responseMapper.mapCancelResponse.mockReturnValue({ status: 'approved', mapped: 'cancel' })

    const result = await pos.cancel(cancelOrder)

    verify()
    expect(requestMapper.createCancelRequestData).toHaveBeenCalledWith(IA, cancelOrder)
    expect(responseMapper.mapCancelResponse).toHaveBeenCalledWith(bankResponse)
    expect(result).toStrictEqual({ status: 'approved', mapped: 'cancel', order_id: 'order-001' })
  })

  it('refund', async () => {
    // deviation: R3 the payment to refund
    const refundOrder: PosOrder = { ...order(), transaction_id: '1001' }
    // deviation: M3-M5 a signed refund answer of this payment
    const bankResponse = {
      status: 'success',
      paymentId: '1001',
      price: 100,
      currency: 'TRY',
      conversationId: 'order-001',
      signature: 'c'.repeat(64),
    }
    const verify = configureClientResponse(
      TX_TYPE.REFUND,
      { 'refund-request': true },
      bankResponse,
      refundOrder,
      MODEL.NON_SECURE,
    )
    requestMapper.createRefundRequestData.mockReturnValue({ 'refund-request': true })
    responseMapper.mapRefundResponse.mockReturnValue({ status: 'approved', mapped: 'refund' })
    crypt.checkResponseSignature.mockReturnValue(true)

    const result = await pos.refund(refundOrder)

    verify()
    expect(requestMapper.createRefundRequestData).toHaveBeenCalledWith(IA, refundOrder, TX_TYPE.REFUND)
    expect(crypt.checkResponseSignature).toHaveBeenCalledWith(IA, bankResponse, 'refund')
    expect(responseMapper.mapRefundResponse).toHaveBeenCalledWith(bankResponse)
    expect(result).toStrictEqual({ status: 'approved', mapped: 'refund', order_id: 'order-001' })
  })

  it('orderHistory', async () => {
    const bankResponse = { items: [] }
    const verify = configureClientResponse(
      TX_TYPE.ORDER_HISTORY,
      { 'order-history-request': true },
      bankResponse,
      order(),
      MODEL.NON_SECURE,
    )
    requestMapper.createOrderHistoryRequestData.mockReturnValue({ 'order-history-request': true })
    responseMapper.mapOrderHistoryResponse.mockReturnValue({ mapped: 'order-history' })

    const result = await pos.orderHistory(order())

    verify()
    expect(requestMapper.createOrderHistoryRequestData).toHaveBeenCalledWith(IA, order())
    expect(responseMapper.mapOrderHistoryResponse).toHaveBeenCalledWith(bankResponse)
    expect(result).toStrictEqual({ mapped: 'order-history' })
  })

  // addition: R3/R4 the gateway validates the order itself before any hook or request (the request mapper here
  // is a stub that would accept anything)
  it.each([
    ['a basket that does not add up', { basket_items: [{ ...basketItem(), price: 99 }] }],
    ['amount 0', { amount: 0 }],
    ['amount -1', { amount: -1 }],
    ['amount abc', { amount: 'abc' }],
    ['amount 1e13', { amount: 1e13, basket_items: [{ ...basketItem(), price: 1e13 }] }],
    ['currency XYZ', { currency: 'XYZ' }],
    ['installment 13', { installment: 13 }],
    ['order id with a blank', { id: 'a b' }],
    ['order id of 65 characters', { id: 'a'.repeat(65) }],
    ['no buyer', { buyer: undefined }],
    ['no billing address', { billing_address: undefined }],
    ['a PHYSICAL item without shipping address', { shipping_address: undefined }],
  ] as Array<[string, Data]>)('non-secure: %s is a PosError before any hook or request', async (_name, over) => {
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue({ req: true })
    clientStrategy.getClient.mockReturnValue(httpClient as unknown as AbstractHttpClient)
    const bad: Data = { ...order(), ...over }
    for (const key of Object.keys(bad)) if (bad[key] === undefined) delete bad[key]

    await expect(pos.payment(MODEL.NON_SECURE, bad, TX_TYPE.PAY_AUTH, card())).rejects.toThrow(PosError)
    expect(requestMapper.createNonSecurePaymentRequestData).not.toHaveBeenCalled()
    expectNoRequest()
  })

  // addition: H1 (3) the gateway reads the token itself (the request mapper here is a stub)
  it.each([[{ token: 'a b' }], [{ token: '' }], [{ token: 'x'.repeat(129) }], [{ other: 'tok-123' }]])(
    '3D Host callback %j is a PosError before any hook or request',
    async (body) => {
      requestMapper.create3DHostPaymentStatusRequestData.mockReturnValue({ req: true })
      await expect(pos.make3DHostPayment(cb(body), order(), TX_TYPE.PAY_AUTH)).rejects.toThrow(PosError)
      expectNoRequest()
    },
  )

  // addition: H1 (2) a checkout only completes a payment or a pre-authorization
  it('3D Host with tx status is an UnsupportedTransactionTypeError', async () => {
    await expect(pos.make3DHostPayment(cb({ token: 'tok-123' }), order(), TX_TYPE.STATUS)).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    expectNoRequest()
  })

  // addition: R3 the payment id of a capture, cancel or refund is checked before any request
  it.each([
    ['post', (o: PosOrder) => pos.payment(MODEL.NON_SECURE, o, TX_TYPE.PAY_POST_AUTH)],
    ['cancel', (o: PosOrder) => pos.cancel(o)],
    ['refund', (o: PosOrder) => pos.refund(o)],
  ] as Array<[string, (o: PosOrder) => Promise<unknown>]>)(
    '%s with transaction_id x is a PosError before any request',
    async (_name, run) => {
      requestMapper.createNonSecurePostAuthPaymentRequestData.mockReturnValue({ req: true })
      requestMapper.createCancelRequestData.mockReturnValue({ req: true })
      requestMapper.createRefundRequestData.mockReturnValue({ req: true })
      await expect(run({ ...order(), transaction_id: 'x' })).rejects.toThrow(PosError)
      expectNoRequest()
    },
  )
})

// ---------------------------------------------------------------------------------------------------------------
// End to end: real crypt, mappers and clients over a fake iyzico.

const PAYMENT_API = 'https://sandbox-api.iyzipay.com'
const E2E_CONFIG: GatewayConfig = {
  name: 'iyzico',
  class: 'IyzicoPos',
  gateway_endpoints: {
    payment_api: PAYMENT_API,
    query_api: `${PAYMENT_API}/v2/reporting/payment`,
  },
}

type Sent = {
  method: string
  url: string
  path: string
  headers: Record<string, string>
  body: string
  json: Data
}
type Handler = (request: Data, sent: Sent) => Data | Response

/** Whether the Authorization header of a request verifies against its path and exact body. */
const authorizationVerifies = (entry: Sent): boolean => {
  const match = /^IYZWSv2 ([A-Za-z0-9+/]+=*)$/.exec(entry.headers.authorization ?? '')
  if (match === null) return false
  const parts = /^apiKey:sandbox-apiKey&randomKey:([^&]+)&signature:([0-9a-f]{64})$/.exec(
    Buffer.from(match[1] ?? '', 'base64').toString('utf8'),
  )
  return parts !== null && parts[2] === HX(`${parts[1]}${entry.path}${entry.body}`)
}

/** Requests whose Authorization did not verify against what was sent. */
const unsignedRequests: Sent[] = []

afterEach(() => {
  expect(unsignedRequests).toStrictEqual([])
  unsignedRequests.length = 0
})

const SYSTEM_TIME = 1781209771102

/** A signed payment answer echoing the request (`over` is applied before signing). */
const paymentAnswerFor = (request: Data, phase: string, over: Data = {}): Data =>
  signed('payment', {
    status: 'success',
    locale: 'tr',
    systemTime: SYSTEM_TIME,
    conversationId: request.conversationId,
    basketId: request.basketId ?? request.conversationId,
    paymentId: request.paymentId ?? '1001',
    price: request.paidPrice,
    paidPrice: request.paidPrice,
    currency: request.currency,
    installment: 1,
    phase,
    fraudStatus: 1,
    authCode: '123456',
    hostReference: 'mock00001iyzihostrfn',
    binNumber: '460345',
    lastFourDigits: '0000',
    ...over,
  })

/** A signed checkout record of the retrieve request (CF2 values by default). */
const checkoutRecordFor = (request: Data, over: Data = {}): Data =>
  signed('checkoutFormRetrieve', {
    status: 'success',
    locale: 'tr',
    systemTime: SYSTEM_TIME,
    paymentStatus: 'SUCCESS',
    paymentId: '1001',
    currency: 'TRY',
    basketId: request.conversationId,
    conversationId: request.conversationId,
    paidPrice: 110,
    price: 100,
    token: request.token,
    fraudStatus: 1,
    mdStatus: 1,
    phase: 'AUTH',
    installment: 1,
    ...over,
  })

const DEFAULT_HANDLERS: Record<string, Handler> = {
  '/payment/3dsecure/initialize': (r) =>
    signed('threeDSInit', {
      status: 'success',
      locale: 'tr',
      systemTime: SYSTEM_TIME,
      conversationId: r.conversationId,
      paymentId: '1001',
      threeDSHtmlContent: b64('<html>3D</html>'),
    }),
  '/payment/3dsecure/initialize/preauth': (r) =>
    signed('threeDSInit', {
      status: 'success',
      conversationId: r.conversationId,
      paymentId: '1001',
      threeDSHtmlContent: b64('<html>3D pre</html>'),
    }),
  '/payment/iyzipos/checkoutform/initialize/auth/ecom': (r) =>
    signed('checkoutFormInit', {
      status: 'success',
      conversationId: r.conversationId,
      token: 'tok-123',
      checkoutFormContent: '<script>checkout</script>',
      paymentPageUrl: 'https://sandbox-cpp.iyzipay.com?token=tok-123&lang=tr',
      tokenExpireTime: 1800,
    }),
  '/payment/iyzipos/checkoutform/initialize/preauth/ecom': (r) =>
    signed('checkoutFormInit', {
      status: 'success',
      conversationId: r.conversationId,
      token: 'tok-pre',
      checkoutFormContent: '<script>pre</script>',
      paymentPageUrl: 'https://sandbox-cpp.iyzipay.com?token=tok-pre&lang=tr',
    }),
  '/payment/v2/3dsecure/auth': (r) => paymentAnswerFor(r, 'AUTH', { mdStatus: 1 }),
  '/payment/iyzipos/checkoutform/auth/ecom/detail': (r) => checkoutRecordFor(r),
  '/payment/auth': (r) => paymentAnswerFor(r, 'AUTH'),
  '/payment/preauth': (r) => paymentAnswerFor(r, 'PRE_AUTH'),
  '/payment/postauth': (r) => paymentAnswerFor(r, 'POST_AUTH', { price: 100 }),
  '/payment/cancel': (r) => ({
    status: 'success',
    locale: 'tr',
    systemTime: SYSTEM_TIME,
    conversationId: r.conversationId,
    paymentId: r.paymentId,
    price: 100,
    currency: 'TRY',
    authCode: '123456',
    hostReference: 'mock00001iyzihostrfn',
    cancelHostReference: 'mock00001iyzihostrfn-02',
  }),
  '/v2/payment/refund': (r) =>
    signed('refund', {
      status: 'success',
      locale: 'tr',
      systemTime: SYSTEM_TIME,
      conversationId: r.conversationId,
      paymentId: r.paymentId,
      paymentTransactionId: '2002',
      price: r.price,
      currency: r.currency,
      hostReference: 'mock00001iyzihostrfn',
    }),
  '/payment/detail': (r) =>
    signed('payment', {
      status: 'success',
      paymentStatus: 'SUCCESS',
      conversationId: r.conversationId,
      basketId: r.conversationId,
      paymentId: '1001',
      price: 100,
      paidPrice: 100,
      currency: 'TRY',
      phase: 'AUTH',
      fraudStatus: 1,
    }),
  '/v2/reporting/payment/details': () => ({ status: 'success', payments: [] }),
}

/** A fetch that answers like iyzico by path, verifies every Authorization header and records every request. */
function bankFetch(handlers: Record<string, Handler> = {}) {
  const sent: Sent[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const u = new URL(String(url))
    const body = init?.body === undefined || init.body === null ? '' : await new Response(init.body).text()
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const entry: Sent = {
      method: init?.method ?? 'GET',
      url: String(url),
      path: u.pathname,
      headers,
      body,
      json: body === '' ? {} : (JSON.parse(body) as Data),
    }
    sent.push(entry)
    if (!authorizationVerifies(entry)) unsignedRequests.push(entry)
    const handler = handlers[u.pathname] ?? DEFAULT_HANDLERS[u.pathname]
    if (handler === undefined) throw new Error(`unexpected request ${u.pathname}`)
    const reply = handler(entry.json, entry)
    return reply instanceof Response ? reply : new Response(JSON.stringify(reply), { status: 200 })
  }) as unknown as typeof fetch

  return { sent, fetchImpl }
}

function realGateway(
  fetchImpl: typeof fetch,
  options: { cfg?: GatewayConfig; logger?: PosLogger; hooks?: PosHooks } = {},
) {
  const log = options.logger ?? createLogger()
  const cfg = options.cfg ?? E2E_CONFIG
  const cryptImpl = new IyzicoPosCrypt(log)
  const valueMapper = new IyzicoPosRequestValueMapper()
  const valueFormatter = new IyzicoPosRequestValueFormatter()
  const hooks = options.hooks ?? {}
  const requestDataMapper = new IyzicoPosRequestDataMapper(valueMapper, valueFormatter, hooks, cryptImpl, LANG.TR)
  const responseDataMapper = new IyzicoPosResponseDataMapper(
    new IyzicoPosResponseValueFormatter(),
    new IyzicoPosResponseValueMapper(),
    log,
  )
  const deps: GatewayDeps<IyzicoPosAccount> = {
    requestValueMapper: valueMapper,
    requestValueFormatter: valueFormatter,
    requestDataMapper,
    responseDataMapper,
    crypt: cryptImpl,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(
      IyzicoPos.GATEWAY_CLASS,
      cfg,
      new HttpTransport({ fetch: fetchImpl }),
      log,
      { account: IA, crypt: cryptImpl },
    ),
    logger: log,
    hooks,
  }

  return { pos: new IyzicoPos(cfg, IA, deps), crypt: cryptImpl }
}

const mismatch = async (promise: Promise<unknown>): Promise<OrderMismatchError> => {
  const err = await promise.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(OrderMismatchError)
  return err as OrderMismatchError
}

const HASH_MISMATCH = new HashMismatchError('3D callback hash mismatch')
const NO_HASH = new HashMismatchError('3D callback has no hash')
const MALFORMED = new HashMismatchError('3D callback fields are malformed')
const UNKNOWN = 'Bank answer carries no result; the payment outcome is unknown'
const UNVERIFIABLE = 'Bank answer signature could not be verified; the payment outcome is unknown'

/** The order of the Review Focus vectors. */
const vectorOrder = (over: PosOrder = {}): PosOrder => ({
  id: 'order-001',
  amount: 100,
  currency: CURRENCY.TRY,
  installment: 0,
  ...over,
})

/** A complete payment order (payer, addresses, basket) of `amount`. */
const fullOrder = (over: PosOrder = {}): PosOrder => {
  const amount = typeof over.amount === 'number' ? over.amount : 100
  return {
    ...vectorOrder(),
    success_url: 'https://example.com/iyzico/callback',
    fail_url: 'https://example.com/iyzico/fail',
    lang: LANG.TR,
    ...paymentExtras(amount),
    ...over,
  }
}

const vectorCard = () => CreditCardFactory.create('4603450000000000', '26', '12', '000', 'John Doe')

/** One 3D Secure callback through a fresh gateway over a fake bank. */
const callback3D = (
  body: Data,
  order: PosOrder = vectorOrder(),
  handlers: Record<string, Handler> = {},
  cfg: GatewayConfig = E2E_CONFIG,
  txType: TxType = TX_TYPE.PAY_AUTH,
) => {
  const { sent, fetchImpl } = bankFetch(handlers)
  const { pos, crypt } = realGateway(fetchImpl, { cfg })
  const check = vi.spyOn(crypt, 'check3DHash')
  const promise = pos.payment(MODEL.THREE_D_SECURE, order, txType, null, cb(body))
  return { sent, promise, check }
}

describe('IyzicoPos (end to end) 3D Secure callback', () => {
  // addition: Review Focus CB3: one signed auth request, approved from the signed, bound answer (P4)
  it('CB3 for order-001 sends one verified auth request and is approved', async () => {
    const { sent, promise } = callback3D(cb3())
    const res = (await promise) as Data

    expect(sent).toHaveLength(1)
    expect(sent[0]?.method).toBe('POST')
    expect(sent[0]?.url).toBe('https://sandbox-api.iyzipay.com/payment/v2/3dsecure/auth')
    expect(sent[0]?.body).toBe(
      '{"locale":"tr","conversationId":"order-001","paymentId":"1001","paidPrice":100,"basketId":"order-001","currency":"TRY"}',
    )
    expect(authorizationVerifies(sent[0] as Sent)).toBe(true)
    expect(res.status).toBe('approved')
    expect(res.amount).toBe(100)
    expect(res.transaction_id).toBe('1001')
    expect(res.order_id).toBe('order-001')
    expect(res.currency).toBe('TRY')
    expect(res.payment_model).toBe(MODEL.THREE_D_SECURE)
    expect(res.transaction_type).toBe(TX_TYPE.PAY_AUTH)
    expect(res.md_status).toBe('1')
    expect(res.masked_number).toBe('460345******0000')
    expect(res).not.toHaveProperty('requires_manual_review')
  })

  // addition: the P4 answer itself
  it('the default auth answer of CB3 carries the P4 signature', async () => {
    let answer: Data = {}
    const { promise } = callback3D(cb3(), vectorOrder(), {
      '/payment/v2/3dsecure/auth': (r) => {
        answer = paymentAnswerFor(r, 'AUTH', { mdStatus: 1 })
        return answer
      },
    })
    await promise
    expect(answer.signature).toBe(P4)
  })

  // addition: a pre-authorization completes with phase PRE_AUTH
  it('CB3 as a pre-authorization is approved with phase PRE_AUTH', async () => {
    const { sent, promise } = callback3D(
      cb3(),
      vectorOrder(),
      { '/payment/v2/3dsecure/auth': (r) => paymentAnswerFor(r, 'PRE_AUTH', { mdStatus: 1 }) },
      E2E_CONFIG,
      TX_TYPE.PAY_PRE_AUTH,
    )
    const res = (await promise) as Data
    expect(sent).toHaveLength(1)
    expect(res.status).toBe('approved')
    expect(res.transaction_type).toBe(TX_TYPE.PAY_PRE_AUTH)
  })

  // addition: T2 one changed character of a signed field or the signature is a HashMismatchError, no request
  it.each([
    ['signature', { signature: `${CB3.slice(0, 10)}0${CB3.slice(11)}` }],
    ['status', { status: 'successs' }],
    ['mdStatus', { mdStatus: '2' }],
    ['paymentId', { paymentId: '1002' }],
    ['conversationId', { conversationId: 'order-002' }],
    ['conversationData', { conversationData: 'x' }],
  ])('a changed %s is a HashMismatchError without request', async (_name, over) => {
    const { sent, promise } = callback3D(cb3(over))
    await expect(promise).rejects.toStrictEqual(HASH_MISMATCH)
    expect(sent).toHaveLength(0)
  })

  // addition: T2 a genuine callback of another order says nothing about this one
  it('CB3 for order-002 is an order_id mismatch without response and without request', async () => {
    const { sent, promise } = callback3D(cb3(), vectorOrder({ id: 'order-002' }))
    const err = await mismatch(promise)
    expect(err.field).toBe('order_id')
    expect(err.expected).toBe('order-002')
    expect(err.actual).toBe('order-001')
    expect(err.response).toBeUndefined()
    expect(err.paymentMayHaveCompleted).toBe(false)
    expect(sent).toHaveLength(0)
  })

  // addition: T2 signed declines map declined without request and without pins
  it.each([
    ['mdStatus 0', { conversationId: 'order-001', mdStatus: '0', status: 'failure' }, '0', 'failure'],
    [
      'status failure with mdStatus 1',
      { conversationId: 'order-001', mdStatus: '1', status: 'failure' },
      '1',
      'failure',
    ],
    [
      'mdStatus 0 with status success',
      { conversationId: 'order-001', mdStatus: '0', status: 'success', paymentId: '1001' },
      '0',
      'success',
    ],
    [
      'a free-form decline',
      { conversationId: 'order-001', mdStatus: '4', status: 'failure', paymentId: 'x:y', conversationData: 'a:b' },
      '4',
      'failure',
    ],
  ] as Array<[string, Data, string, string]>)('signed %s is a trusted decline', async (_name, fields, md, word) => {
    const body = signedCallback(fields)
    const { sent, promise } = callback3D(body)
    const res = (await promise) as Data
    expect(sent).toHaveLength(0)
    expect(res.status).toBe('declined')
    expect(res.order_id).toBe('order-001')
    expect(res.md_status).toBe(md)
    expect(res.proc_return_code).toBe(word)
    expect(res.transaction_id).toBeNull()
    expect(res.amount).toBeNull()
    expect(res).not.toHaveProperty('requires_manual_review')
  })

  // addition: T2 an unsigned body that reads as an approval is refused
  it.each([
    ['status success', { status: 'success', mdStatus: '1', conversationId: 'order-001', paymentId: '1001' }],
    ['status success only', { status: 'success' }],
    ['status padded', { status: ' Success ' }],
    ['mdStatus padded', { mdStatus: ' 1' }],
    ['mdStatus 01', { mdStatus: '01', status: 'failure' }],
    ['empty signature', { status: 'success', signature: '' }],
  ])('unsigned %s is a HashMismatchError without request', async (_name, body) => {
    const { sent, promise, check } = callback3D(body)
    await expect(promise).rejects.toStrictEqual(NO_HASH)
    expect(sent).toHaveLength(0)
    expect(check).not.toHaveBeenCalled()
  })

  // addition: T2 an unsigned decline is built from the order
  it('an unsigned decline of another conversation is a decline with the order id', async () => {
    const body = { status: 'failure', mdStatus: '0', conversationId: 'other', paymentId: '999' }
    const { sent, promise } = callback3D(body)
    const res = (await promise) as Data
    expect(sent).toHaveLength(0)
    expect(res.status).toBe('declined')
    expect(res.order_id).toBe('order-001')
    expect(res.md_status).toBe('0')
    expect(res.transaction_id).toBeNull()
    expect(res).not.toHaveProperty('requires_manual_review')
  })

  // addition: T2 with require_3d_hash even an unsigned decline is refused
  it('require_3d_hash refuses an unsigned decline', async () => {
    const body = { status: 'failure', mdStatus: '0', conversationId: 'order-001' }
    const { sent, promise } = callback3D(body, vectorOrder(), {}, { ...E2E_CONFIG, require_3d_hash: true })
    await expect(promise).rejects.toStrictEqual(NO_HASH)
    expect(sent).toHaveLength(0)
  })

  // addition: T2 (1) a non-flat callback is refused before the crypt
  it.each([[{ status: ['success'] }], [{ status: 'success', mdStatus: { 0: '1' } }], [{ signature: 5 }]])(
    'callback %j is a PosError before the crypt',
    async (body) => {
      const { sent, promise, check } = callback3D(body as Data)
      const err = await promise.catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PosError)
      expect(err).not.toBeInstanceOf(HashMismatchError)
      expect(check).not.toHaveBeenCalled()
      expect(sent).toHaveLength(0)
    },
  )

  // addition: T2 (2) the order is validated before the crypt
  it.each([
    ['amount 0', { amount: 0 }],
    ['currency XYZ', { currency: 'XYZ' }],
    ['installment 13', { installment: 13 }],
    ['id with a blank', { id: 'a b' }],
  ])('an order with %s is a PosError before the crypt', async (_name, over) => {
    const { sent, promise, check } = callback3D(cb3(), vectorOrder(over as PosOrder))
    await expect(promise).rejects.toThrow(PosError)
    expect(check).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  // addition: T4 a signed approval whose payment id is not plain digits is malformed
  it.each([['pay-1'], ['01001'], [' 1001'], ['1001.0']])(
    'a signed approval with paymentId %j is malformed',
    async (pid) => {
      const body = signedCallback({ conversationId: 'order-001', mdStatus: '1', paymentId: pid, status: 'success' })
      const { sent, promise } = callback3D(body)
      await expect(promise).rejects.toStrictEqual(MALFORMED)
      expect(sent).toHaveLength(0)
    },
  )

  // addition: T3 every colon regrouping of a signed text that still verifies either keeps the four pinned fields
  // (and pays the original payment id), or it is rejected or at most a decline
  it.each([
    ['CB3', '', 'order-001', '1', '1001', 'success'],
    ['CB3 with conversationData x:y', 'x:y', 'order-001', '1', '1001', 'success'],
    ['CB3 with conversationData a:b:c', 'a:b:c', 'order-001', '1', '1001', 'success'],
    ['CB2', 'x:y', 'order-001', '1', 'pay-1', 'success'],
  ])('%s: no regrouping approves another body', async (_name, cd, cid, md, pid, st) => {
    const text = `${cd}:${cid}:${md}:${pid}:${st}`
    const signature = HX(text)
    const colons = [...text].flatMap((ch, i) => (ch === ':' ? [i] : []))
    const choose = (from: number[], k: number): number[][] =>
      k === 0 ? [[]] : from.flatMap((first, i) => choose(from.slice(i + 1), k - 1).map((rest) => [first, ...rest]))
    const splits = choose(colons, 4)
    let approvals = 0
    for (const cut of splits) {
      const bounds = [-1, ...cut, text.length]
      const fields = bounds.slice(0, -1).map((start, i) => text.slice(start + 1, bounds[i + 1]))
      const [rcd, rcid, rmd, rpid, rst] = fields as [string, string, string, string, string]
      const body = {
        conversationData: rcd,
        conversationId: rcid,
        mdStatus: rmd,
        paymentId: rpid,
        status: rst,
        signature,
      }
      const { sent, promise } = callback3D(body)
      const outcome = (await promise.catch((e: unknown) => e)) as Data
      if (outcome instanceof Error) {
        expect(sent).toHaveLength(0)
        continue
      }
      if (outcome.status === 'approved') {
        approvals++
        expect([rcid, rmd, rpid, rst]).toStrictEqual([cid, md, pid, st])
        expect(outcome.transaction_id).toBe(pid)
        expect(sent).toHaveLength(1)
        expect(sent[0]?.json.paymentId).toBe(pid)
      } else {
        // a regrouped signed decline moves no money
        expect(outcome.status).toBe('declined')
        expect(sent).toHaveLength(0)
      }
    }
    expect(approvals).toBe(pid === '1001' ? 1 : 0)
  })
})

/** The auth answer handler with `over` applied before signing. */
const authAnswer =
  (over: Data = {}, phase = 'AUTH'): Handler =>
  (r) =>
    paymentAnswerFor(r, phase, { mdStatus: 1, ...over })

describe('IyzicoPos (end to end) auth answer', () => {
  // addition: M1 an answer without a result after the auth request is an unknown outcome
  it.each([
    ['{}', () => ({})],
    ['204', () => new Response(null, { status: 204 })],
    ['HTML', () => new Response('<html>WAF</html>', { status: 200 })],
    ["{ status: 'x' }", () => ({ status: 'x' })],
    ["{ status: 'Success' }", () => ({ status: 'Success' })],
    ['BOM', () => new Response(`﻿${JSON.stringify({ status: 'failure' })}`, { status: 200 })],
    ['HTTP 500', () => new Response('{"status":"failure"}', { status: 500 })],
  ] as Array<[string, Handler]>)('%s is a PosHttpError, never declined', async (_name, handler) => {
    const { sent, promise } = callback3D(cb3(), vectorOrder(), { '/payment/v2/3dsecure/auth': handler })
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).url).toBe('https://sandbox-api.iyzipay.com/payment/v2/3dsecure/auth')
    expect(sent).toHaveLength(1)
  })

  it('an answer without a status is the unknown outcome message', async () => {
    const { promise } = callback3D(cb3(), vectorOrder(), { '/payment/v2/3dsecure/auth': () => ({}) })
    await expect(promise).rejects.toThrow(UNKNOWN)
  })

  // addition: M3 an unverifiable approval is an unknown outcome
  it.each([
    [
      'without signature',
      (r: Data) => {
        const { signature: _s, ...rest } = paymentAnswerFor(r, 'AUTH', { mdStatus: 1 })
        return rest
      },
    ],
    [
      'with a wrong signature',
      (r: Data) => ({ ...paymentAnswerFor(r, 'AUTH', { mdStatus: 1 }), signature: 'f'.repeat(64) }),
    ],
    ['with a changed paidPrice', (r: Data) => ({ ...paymentAnswerFor(r, 'AUTH', { mdStatus: 1 }), paidPrice: 1 })],
  ] as Array<[string, Handler]>)('success %s is a PosHttpError', async (_name, handler) => {
    const { promise } = callback3D(cb3(), vectorOrder(), { '/payment/v2/3dsecure/auth': handler })
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as Error).message).toBe(UNVERIFIABLE)
  })

  // addition: M4/M5 a signed approval that does not fit the order: money may have moved
  it.each([
    ['basketId order-002', { basketId: 'order-002' }, 'order_id'],
    ['conversationId order-002', { conversationId: 'order-002' }, 'order_id'],
    ['paidPrice 99.99', { paidPrice: 99.99 }, 'amount'],
    ['price 99.99', { price: 99.99 }, 'amount'],
    ['paidPrice 100.01', { paidPrice: 100.01 }, 'amount'],
    ['currency USD', { currency: 'USD' }, 'currency'],
    ['phase PRE_AUTH', { phase: 'PRE_AUTH' }, 'transaction_type'],
    ['paymentId 1002', { paymentId: '1002' }, 'transaction_id'],
  ] as Array<[string, Data, string]>)(
    'a re-signed answer with %s is a %s mismatch with result',
    async (_n, over, field) => {
      const { sent, promise } = callback3D(cb3(), vectorOrder(), { '/payment/v2/3dsecure/auth': authAnswer(over) })
      const err = await mismatch(promise)
      expect(err.field).toBe(field)
      expect(err.paymentMayHaveCompleted).toBe(true)
      expect(err.response?.requires_manual_review).toBe(true)
      expect(err.response?.order_id).toBe('order-001')
      expect(sent).toHaveLength(1)
    },
  )

  // addition: M6/M7 a charged payment that is not cleared is held for review
  it.each([
    ['fraudStatus 0', { fraudStatus: 0 }],
    ['fraudStatus -1', { fraudStatus: -1 }],
    ['fraudStatus missing', { fraudStatus: undefined }],
    ["fraudStatus '0'", { fraudStatus: '0' }],
    ['mdStatus 0', { mdStatus: 0 }],
    ["mdStatus '4'", { mdStatus: '4' }],
    ['mdStatus null', { mdStatus: null }],
  ] as Array<[string, Data]>)('%s is declined with requires_manual_review', async (_name, over) => {
    const handler: Handler = (r) => {
      const answer = paymentAnswerFor(r, 'AUTH', { mdStatus: 1, ...over })
      for (const key of Object.keys(answer)) if (answer[key] === undefined) delete answer[key]
      return answer
    }
    const { promise } = callback3D(cb3(), vectorOrder(), { '/payment/v2/3dsecure/auth': handler })
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.requires_manual_review).toBe(true)
    expect(res.order_id).toBe('order-001')
    expect(res.transaction_id).toBe('1001')
    expect(res.amount).toBe(100)
  })

  it("fraudStatus '1' as text is approved", async () => {
    const { promise } = callback3D(cb3(), vectorOrder(), {
      '/payment/v2/3dsecure/auth': authAnswer({ fraudStatus: '1' }),
    })
    expect(((await promise) as Data).status).toBe('approved')
  })

  // addition: M2 a failed answer is a decline with bounded, clean bank text
  it('failure with a long dirty errorMessage is declined with at most 256 clean characters', async () => {
    const dirty = `${'x'.repeat(150)}\u0000\n‮ ${'y'.repeat(150)}`
    const { promise } = callback3D(cb3(), vectorOrder(), {
      '/payment/v2/3dsecure/auth': () => ({
        status: 'failure',
        errorCode: '10051',
        errorMessage: dirty,
        conversationId: 'order-001',
        paidPrice: 100,
      }),
    })
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.order_id).toBe('order-001')
    expect(res.error_code).toBe('10051')
    expect(res.error_message).toHaveLength(256)
    expect(res.error_message).toMatch(/^x+y+$/)
    expect(res.amount).toBeNull()
    expect(res.currency).toBeNull()
    expect(res).not.toHaveProperty('requires_manual_review')
  })

  it.each([[{ errorCode: 'bad code!' }], [{ errorCode: ['10051'] }]])(
    'failure with %j has no error_code',
    async (over) => {
      const { promise } = callback3D(cb3(), vectorOrder(), {
        '/payment/v2/3dsecure/auth': () => ({ status: 'failure', ...over }),
      })
      const res = (await promise) as Data
      expect(res.status).toBe('declined')
      expect(res.error_code).toBeNull()
    },
  )
})

/** One 3D Host callback through a fresh gateway over a fake bank. */
const hostCallback = (
  body: Data,
  order: PosOrder = vectorOrder(),
  handlers: Record<string, Handler> = {},
  cfg: GatewayConfig = E2E_CONFIG,
) => {
  const { sent, fetchImpl } = bankFetch(handlers)
  const { pos } = realGateway(fetchImpl, { cfg })
  const promise = pos.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, cb(body))
  return { sent, promise }
}

const RETRIEVE = '/payment/iyzipos/checkoutform/auth/ecom/detail'
const retrieve =
  (over: Data = {}): Handler =>
  (r) => {
    const answer = checkoutRecordFor(r, over)
    for (const key of Object.keys(answer)) if (answer[key] === undefined) delete answer[key]
    return answer
  }

describe('IyzicoPos (end to end) 3D Host', () => {
  // addition: H1 one retrieve request; the signed, bound record (CF2) approves the charged amount
  it('token tok-123 with the CF2 record is approved at 110', async () => {
    let answer: Data = {}
    const { sent, promise } = hostCallback({ token: 'tok-123' }, vectorOrder(), {
      [RETRIEVE]: (r) => {
        answer = checkoutRecordFor(r)
        return answer
      },
    })
    const res = (await promise) as Data
    expect(answer.signature).toBe(CF2)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(`${PAYMENT_API}${RETRIEVE}`)
    expect(sent[0]?.body).toBe('{"locale":"tr","conversationId":"order-001","token":"tok-123"}')
    expect(res.status).toBe('approved')
    expect(res.amount).toBe(110)
    expect(res.order_id).toBe('order-001')
    expect(res.transaction_id).toBe('1001')
    expect(res.currency).toBe('TRY')
    expect(res.payment_model).toBe(MODEL.THREE_D_HOST)
    expect(res.transaction_type).toBe(TX_TYPE.PAY_AUTH)
    expect(res.md_status).toBe('1')
    expect(res).not.toHaveProperty('requires_manual_review')
  })

  // addition: H1 the record of another checkout is no evidence for this order
  it.each([
    ['basketId order-002', { basketId: 'order-002' }],
    ['conversationId order-002', { conversationId: 'order-002' }],
    ['token tok-999', { token: 'tok-999' }],
  ])('a signed record with %s is an order_id mismatch without response', async (_name, over) => {
    const { sent, promise } = hostCallback({ token: 'tok-123' }, vectorOrder(), { [RETRIEVE]: retrieve(over) })
    const err = await mismatch(promise)
    expect(err.field).toBe('order_id')
    expect(err.response).toBeUndefined()
    expect(err.paymentMayHaveCompleted).toBe(false)
    expect(sent).toHaveLength(1)
  })

  // addition: H1/M5 the record of this order with other amounts: money moved
  it.each([
    ['price 99', { price: 99 }, 'amount'],
    ['paidPrice 99', { paidPrice: 99 }, 'amount'],
    ['currency EUR', { currency: 'EUR' }, 'currency'],
    ['phase PRE_AUTH', { phase: 'PRE_AUTH' }, 'transaction_type'],
  ] as Array<[string, Data, string]>)('a record with %s is a %s mismatch with result', async (_name, over, field) => {
    const { promise } = hostCallback({ token: 'tok-123' }, vectorOrder(), { [RETRIEVE]: retrieve(over) })
    const err = await mismatch(promise)
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.order_id).toBe('order-001')
  })

  it('paidPrice equal to the order amount is approved', async () => {
    const { promise } = hostCallback({ token: 'tok-123' }, vectorOrder(), { [RETRIEVE]: retrieve({ paidPrice: 100 }) })
    const res = (await promise) as Data
    expect(res.status).toBe('approved')
    expect(res.amount).toBe(100)
  })

  // addition: H1 a checkout that did not complete is a decline
  it.each([['INIT_THREEDS'], ['FAILURE'], ['CALLBACK_THREEDS'], ['success']])(
    'paymentStatus %s is a decline',
    async (paymentStatus) => {
      const { promise } = hostCallback({ token: 'tok-123' }, vectorOrder(), { [RETRIEVE]: retrieve({ paymentStatus }) })
      const res = (await promise) as Data
      expect(res.status).toBe('declined')
      expect(res.order_id).toBe('order-001')
      expect(res.amount).toBeNull()
      expect(res.transaction_id).toBeNull()
      expect(res.payment_model).toBe(MODEL.THREE_D_HOST)
      expect(res).not.toHaveProperty('requires_manual_review')
    },
  )

  // addition: M6/M7 (ledger ruling) an absent 3D status does not contradict; a present failed one holds for review
  it('a record without mdStatus is approved', async () => {
    const { promise } = hostCallback({ token: 'tok-123' }, vectorOrder(), {
      [RETRIEVE]: retrieve({ mdStatus: undefined }),
    })
    const res = (await promise) as Data
    expect(res.status).toBe('approved')
    expect(res.md_status).toBeNull()
  })

  it.each([
    ['mdStatus 0', { mdStatus: 0 }],
    ["mdStatus '3'", { mdStatus: '3' }],
    ['mdStatus null', { mdStatus: null }],
    ['fraudStatus 0', { fraudStatus: 0 }],
    ['fraudStatus -1', { fraudStatus: -1 }],
    ['fraudStatus missing', { fraudStatus: undefined }],
  ] as Array<[string, Data]>)('a record with %s is declined with requires_manual_review', async (_name, over) => {
    const { promise } = hostCallback({ token: 'tok-123' }, vectorOrder(), { [RETRIEVE]: retrieve(over) })
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.requires_manual_review).toBe(true)
    expect(res.amount).toBe(110)
  })

  // addition: H1 (5) an unreadable or unverifiable record is a PosHttpError
  it.each([
    ['{}', () => ({})],
    ['status x', () => ({ status: 'x' })],
    ['HTML', () => new Response('<html/>', { status: 200 })],
    [
      'unsigned success',
      (r: Data) => {
        const { signature: _s, ...rest } = checkoutRecordFor(r)
        return rest
      },
    ],
    ['wrong signature', (r: Data) => ({ ...checkoutRecordFor(r), signature: '0'.repeat(64) })],
  ] as Array<[string, Handler]>)('%s is a PosHttpError', async (_name, handler) => {
    const { promise } = hostCallback({ token: 'tok-123' }, vectorOrder(), { [RETRIEVE]: handler })
    await expect(promise).rejects.toThrow(PosHttpError)
  })

  it('failure is a decline with the order id', async () => {
    const { promise } = hostCallback({ token: 'tok-123' }, vectorOrder(), {
      [RETRIEVE]: () => ({ status: 'failure', errorCode: '5115', errorMessage: 'Token expired', conversationId: 'x' }),
    })
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.order_id).toBe('order-001')
    expect(res.error_code).toBe('5115')
    expect(res.error_message).toBe('Token expired')
  })

  // addition: H1 (1)/(3) a malformed callback sends nothing
  it.each([[{ token: 'a b' }], [{ token: ['x'] }], [{ token: '' }], [{ other: 'x' }]])(
    'callback %j is a PosError without request',
    async (body) => {
      const { sent, promise } = hostCallback(body as Data)
      const err = await promise.catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PosError)
      expect(sent).toHaveLength(0)
    },
  )

  it('an empty callback is a PosError without request', async () => {
    const { sent, promise } = hostCallback({})
    await expect(promise).rejects.toThrow(PosError)
    expect(sent).toHaveLength(0)
  })

  // addition: H1 require_3d_hash has no effect: the callback carries only a token
  it('require_3d_hash does not refuse the token callback', async () => {
    const { promise } = hostCallback({ token: 'tok-123' }, vectorOrder(), {}, { ...E2E_CONFIG, require_3d_hash: true })
    expect(((await promise) as Data).status).toBe('approved')
  })
})

describe('IyzicoPos (end to end) 3D forms', () => {
  const build = (
    handlers: Record<string, Handler>,
    model: PaymentModel,
    options: { txType?: TxType; card?: boolean; withoutCard?: boolean; format?: 'html' | 'array' | null } = {},
  ) => {
    const { sent, fetchImpl } = bankFetch(handlers)
    const { pos } = realGateway(fetchImpl)
    const promise = pos.get3DFormData(
      fullOrder(),
      model,
      options.txType ?? TX_TYPE.PAY_AUTH,
      options.card === true ? vectorCard() : null,
      options.withoutCard ?? false,
      options.format ?? null,
    )
    return { sent, promise }
  }

  // addition: T1 the 3D Secure page is the decoded HTML of the signed initialize answer
  it('3D Secure returns the decoded page; the card goes to the initialize request', async () => {
    const { sent, promise } = build({}, MODEL.THREE_D_SECURE, { card: true })
    expect(await promise).toBe('<html>3D</html>')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(`${PAYMENT_API}/payment/3dsecure/initialize`)
    expect(sent[0]?.json.paymentCard.cardNumber).toBe('4603450000000000')
    expect(sent[0]?.json.callbackUrl).toBe('https://example.com/iyzico/callback')
  })

  it('3D Secure pre-authorization uses the pre-authorization initialize route', async () => {
    const { sent, promise } = build({}, MODEL.THREE_D_SECURE, { card: true, txType: TX_TYPE.PAY_PRE_AUTH })
    expect(await promise).toBe('<html>3D pre</html>')
    expect(sent[0]?.url).toBe(`${PAYMENT_API}/payment/3dsecure/initialize/preauth`)
  })

  it.each([
    ['not base64', { threeDSHtmlContent: '<html>3D</html>' }],
    ['bad padding', { threeDSHtmlContent: 'PGh0bWw+M0Q8L2h0bWw' }],
    ['empty', { threeDSHtmlContent: '' }],
    ['missing', { threeDSHtmlContent: undefined }],
    ['a list', { threeDSHtmlContent: ['PGh0bWw+'] }],
    ['not UTF-8', { threeDSHtmlContent: Buffer.from([0xff, 0xfe, 0xfd]).toString('base64') }],
  ] as Array<[string, Data]>)('3D Secure content %s is a PosError', async (_name, over) => {
    const { promise } = build(
      {
        '/payment/3dsecure/initialize': (r) => {
          const answer = signed('threeDSInit', {
            status: 'success',
            conversationId: r.conversationId,
            paymentId: '1001',
            threeDSHtmlContent: b64('<html>3D</html>'),
            ...over,
          })
          for (const key of Object.keys(answer)) if (answer[key] === undefined) delete answer[key]
          return answer
        },
      },
      MODEL.THREE_D_SECURE,
      { card: true },
    )
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect(err).not.toBeInstanceOf(PosHttpError)
  })

  it('an initialize answer with a wrong signature is a HashMismatchError', async () => {
    const { promise } = build(
      {
        '/payment/3dsecure/initialize': (r) => ({
          status: 'success',
          conversationId: r.conversationId,
          paymentId: '1001',
          threeDSHtmlContent: b64('<html>3D</html>'),
          signature: HX('pay-1:order-001'),
        }),
      },
      MODEL.THREE_D_SECURE,
      { card: true },
    )
    await expect(promise).rejects.toThrow(HashMismatchError)
  })

  it.each([
    [MODEL.THREE_D_SECURE, '/payment/3dsecure/initialize', 'threeDSInit'],
    [MODEL.THREE_D_HOST, '/payment/iyzipos/checkoutform/initialize/auth/ecom', 'checkoutFormInit'],
  ] as Array<[PaymentModel, string, string]>)(
    '%s: a signed initialize answer of another conversation is an order_id mismatch',
    async (model, path, kind) => {
      const { promise } = build(
        {
          [path]: () =>
            signed(kind, {
              status: 'success',
              conversationId: 'other',
              paymentId: '1001',
              token: 'tok-123',
              threeDSHtmlContent: b64('<html>3D</html>'),
              checkoutFormContent: '<script/>',
            }),
        },
        model,
        { card: model === MODEL.THREE_D_SECURE },
      )
      const err = await mismatch(promise)
      expect(err.field).toBe('order_id')
      expect(err.response).toBeUndefined()
    },
  )

  it('3D Host html returns the checkout content and never sends a card', async () => {
    const { sent, promise } = build({}, MODEL.THREE_D_HOST, { withoutCard: true })
    expect(await promise).toBe('<script>checkout</script>')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(`${PAYMENT_API}/payment/iyzipos/checkoutform/initialize/auth/ecom`)
    expect(sent[0]?.json).not.toHaveProperty('paymentCard')
    expect(sent[0]?.json.forceThreeDS).toBe(1)
  })

  it('3D Host pre-authorization uses the pre-authorization checkout route', async () => {
    const { sent, promise } = build({}, MODEL.THREE_D_HOST, { txType: TX_TYPE.PAY_PRE_AUTH })
    expect(await promise).toBe('<script>pre</script>')
    expect(sent[0]?.url).toBe(`${PAYMENT_API}/payment/iyzipos/checkoutform/initialize/preauth/ecom`)
  })

  it('3D Host array returns the https page of the token', async () => {
    const { promise } = build({}, MODEL.THREE_D_HOST, { format: 'array' })
    expect(await promise).toStrictEqual({
      gateway: 'https://sandbox-cpp.iyzipay.com?token=tok-123&lang=tr',
      method: 'GET',
      inputs: {},
    })
  })

  it('3D Host with a card is refused before any request', async () => {
    const { sent, promise } = build({}, MODEL.THREE_D_HOST, { card: true })
    await expect(promise).rejects.toThrow(PosError)
    expect(sent).toHaveLength(0)
  })

  const hostInit =
    (over: Data): Handler =>
    (r) => {
      const answer = signed('checkoutFormInit', {
        status: 'success',
        conversationId: r.conversationId,
        token: 'tok-123',
        checkoutFormContent: '<script>checkout</script>',
        paymentPageUrl: 'https://sandbox-cpp.iyzipay.com?token=tok-123',
        ...over,
      })
      for (const key of Object.keys(answer)) if (answer[key] === undefined) delete answer[key]
      return answer
    }

  it.each([
    ['http page', { paymentPageUrl: 'http://sandbox-cpp.iyzipay.com?token=tok-123' }, 'array'],
    ['javascript page', { paymentPageUrl: 'javascript:alert(1)' }, 'array'],
    ['page with a blank', { paymentPageUrl: 'https://sandbox-cpp.iyzipay.com/ x' }, 'array'],
    ['no page', { paymentPageUrl: undefined }, 'array'],
    ['no content', { checkoutFormContent: undefined }, 'html'],
    ['empty content', { checkoutFormContent: '' }, 'html'],
    ['no token', { token: undefined }, 'html'],
    ['malformed token', { token: 'tok 123' }, 'html'],
  ] as Array<[string, Data, 'html' | 'array']>)('3D Host %s is a PosError', async (_name, over, format) => {
    const { promise } = build(
      { '/payment/iyzipos/checkoutform/initialize/auth/ecom': hostInit(over) },
      MODEL.THREE_D_HOST,
      { format },
    )
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect(err).not.toBeInstanceOf(PosHttpError)
  })

  it('3D Host initialize with a wrong signature is a HashMismatchError', async () => {
    const { promise } = build(
      {
        '/payment/iyzipos/checkoutform/initialize/auth/ecom': (r) => ({
          ...hostInit({})(r, {} as Sent),
          signature: HX('order-001:tok-999'),
        }),
      },
      MODEL.THREE_D_HOST,
    )
    await expect(promise).rejects.toThrow(HashMismatchError)
  })

  it('3D Secure with array format is an UnsupportedFormFormatError', async () => {
    const { sent, promise } = build({}, MODEL.THREE_D_SECURE, { card: true, format: 'array' })
    await expect(promise).rejects.toThrow(UnsupportedFormFormatError)
    expect(sent).toHaveLength(0)
  })

  // deviation: T1 iyzico's 3D Secure initialize takes the card
  it('3D Secure without a card is a PosError even with createWithoutCard', async () => {
    const { sent, promise } = build({}, MODEL.THREE_D_SECURE, { withoutCard: true })
    await expect(promise).rejects.toThrow('iyzico 3D Secure needs the card')
    expect(sent).toHaveLength(0)
  })

  it('a failed initialize is a PosError with the bounded bank text, secrets hidden', async () => {
    const { promise } = build(
      {
        '/payment/3dsecure/initialize': () => ({
          status: 'failure',
          errorCode: '12',
          errorMessage: `Invalid card\u0000 ${SECRET} ${'z'.repeat(400)}`,
        }),
      },
      MODEL.THREE_D_SECURE,
      { card: true },
    )
    const err = (await promise.catch((e: unknown) => e)) as Error
    expect(err).toBeInstanceOf(PosError)
    expect(err.message.startsWith('iyzico 3D form could not be created: Invalid card ')).toBe(true)
    expect(err.message).not.toContain(SECRET)
    expect(err.message).not.toContain('\u0000')
    expect(err.message.length).toBeLessThan(320)
  })

  it.each([
    ['{}', () => ({})],
    ['status x', () => ({ status: 'x' })],
  ] as Array<[string, Handler]>)('an initialize answer %s is a PosError', async (_name, handler) => {
    const { promise } = build({ '/payment/3dsecure/initialize': handler }, MODEL.THREE_D_SECURE, { card: true })
    await expect(promise).rejects.toThrow('iyzico 3D form could not be created')
  })

  // addition: R4 a basket that does not add up is refused before the initialize request
  it('a basket of 0.3 + 9.70 for 10.01 is refused before any request; 0.3 + 9.71 is sent', async () => {
    const items = (second: number) => [
      { id: 'BI101', name: 'Binocular', category1: 'Collectibles', item_type: 'PHYSICAL', price: 0.3 },
      { id: 'BI102', name: 'Game code', category1: 'Game', item_type: 'VIRTUAL', price: second },
    ]
    const bad = bankFetch()
    const badPos = realGateway(bad.fetchImpl).pos
    await expect(
      badPos.get3DFormData(
        fullOrder({ amount: 10.01, basket_items: items(9.7) }),
        MODEL.THREE_D_HOST,
        TX_TYPE.PAY_AUTH,
      ),
    ).rejects.toThrow('Basket item prices must add up to the order amount')
    expect(bad.sent).toHaveLength(0)
    const good = bankFetch()
    const goodPos = realGateway(good.fetchImpl).pos
    await goodPos.get3DFormData(
      fullOrder({ amount: 10.01, basket_items: items(9.71) }),
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_AUTH,
    )
    expect(good.sent[0]?.json.price).toBe(10.01)
  })
})

describe('IyzicoPos (end to end) money requests', () => {
  const gateway = (handlers: Record<string, Handler> = {}) => {
    const { sent, fetchImpl } = bankFetch(handlers)
    return { sent, pos: realGateway(fetchImpl).pos }
  }

  // addition: G2 the non-secure sale is approved from the signed, bound answer
  it('non-secure sale is approved', async () => {
    const { sent, pos } = gateway()
    const res = (await pos.payment(MODEL.NON_SECURE, fullOrder(), TX_TYPE.PAY_AUTH, vectorCard())) as Data
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(`${PAYMENT_API}/payment/auth`)
    expect(sent[0]?.json.paymentCard).toStrictEqual({
      cardHolderName: 'John Doe',
      cardNumber: '4603450000000000',
      expireMonth: '12',
      expireYear: '2026',
      cvc: '000',
      registerCard: 0,
    })
    expect(res.status).toBe('approved')
    expect(res.amount).toBe(100)
    expect(res.transaction_id).toBe('1001')
    expect(res.order_id).toBe('order-001')
    expect(res.payment_model).toBe(MODEL.NON_SECURE)
    expect(res.transaction_type).toBe(TX_TYPE.PAY_AUTH)
  })

  it('non-secure pre-authorization is approved with phase PRE_AUTH', async () => {
    const { sent, pos } = gateway()
    const res = (await pos.payment(MODEL.NON_SECURE, fullOrder(), TX_TYPE.PAY_PRE_AUTH, vectorCard())) as Data
    expect(sent[0]?.url).toBe(`${PAYMENT_API}/payment/preauth`)
    expect(res.status).toBe('approved')
    expect(res.transaction_type).toBe(TX_TYPE.PAY_PRE_AUTH)
  })

  // addition: M1-M6 on the non-secure sale
  it.each([
    ['basketId other', { basketId: 'other' }, 'order_id'],
    ['paidPrice 100.01', { paidPrice: 100.01 }, 'amount'],
    ['price 99', { price: 99 }, 'amount'],
    ['currency USD', { currency: 'USD' }, 'currency'],
    ['phase PRE_AUTH', { phase: 'PRE_AUTH' }, 'transaction_type'],
    ['paymentId abc', { paymentId: 'abc' }, 'transaction_id'],
  ] as Array<[string, Data, string]>)('a sale answer with %s is a %s mismatch with result', async (_n, over, field) => {
    const { pos } = gateway({ '/payment/auth': (r) => paymentAnswerFor(r, 'AUTH', over) })
    const err = await mismatch(pos.payment(MODEL.NON_SECURE, fullOrder(), TX_TYPE.PAY_AUTH, vectorCard()))
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(true)
  })

  it.each([
    ['{}', () => ({})],
    [
      'unsigned success',
      (r: Data) => {
        const { signature: _s, ...rest } = paymentAnswerFor(r, 'AUTH')
        return rest
      },
    ],
  ] as Array<[string, Handler]>)('a sale answer %s is a PosHttpError', async (_n, handler) => {
    const { pos } = gateway({ '/payment/auth': handler })
    await expect(pos.payment(MODEL.NON_SECURE, fullOrder(), TX_TYPE.PAY_AUTH, vectorCard())).rejects.toThrow(
      PosHttpError,
    )
  })

  it('a sale with fraudStatus 0 is held for review', async () => {
    const { pos } = gateway({ '/payment/auth': (r) => paymentAnswerFor(r, 'AUTH', { fraudStatus: 0 }) })
    const res = (await pos.payment(MODEL.NON_SECURE, fullOrder(), TX_TYPE.PAY_AUTH, vectorCard())) as Data
    expect(res.status).toBe('declined')
    expect(res.requires_manual_review).toBe(true)
  })

  it('a failed sale is declined', async () => {
    const { pos } = gateway({
      '/payment/auth': () => ({ status: 'failure', errorCode: '10051', errorMessage: 'Yetersiz' }),
    })
    const res = (await pos.payment(MODEL.NON_SECURE, fullOrder(), TX_TYPE.PAY_AUTH, vectorCard())) as Data
    expect(res.status).toBe('declined')
    expect(res.error_code).toBe('10051')
    expect(res.order_id).toBe('order-001')
  })

  // addition: G3 a capture of 100.20 after a pre-authorization of 100 (the answer's price is the pre-authorized basket)
  it('post-auth of 100.2 is approved', async () => {
    const { sent, pos } = gateway()
    const res = (await pos.payment(
      MODEL.NON_SECURE,
      { id: 'order-001', amount: 100.2, currency: 'TRY', transaction_id: '1001' },
      TX_TYPE.PAY_POST_AUTH,
    )) as Data
    expect(sent[0]?.url).toBe(`${PAYMENT_API}/payment/postauth`)
    expect(sent[0]?.body).toBe(
      '{"locale":"tr","conversationId":"order-001","paymentId":"1001","paidPrice":100.2,"currency":"TRY"}',
    )
    expect(res.status).toBe('approved')
    expect(res.amount).toBe(100.2)
    expect(res.transaction_id).toBe('1001')
    expect(res.transaction_type).toBe(TX_TYPE.PAY_POST_AUTH)
  })

  it.each([
    ['paymentId 1002', { paymentId: '1002' }, 'transaction_id'],
    ['paidPrice 100', { paidPrice: 100 }, 'amount'],
    ['phase AUTH', { phase: 'AUTH' }, 'transaction_type'],
  ] as Array<[string, Data, string]>)('a capture answer with %s is a %s mismatch', async (_n, over, field) => {
    const { pos } = gateway({ '/payment/postauth': (r) => paymentAnswerFor(r, 'POST_AUTH', { price: 100, ...over }) })
    const err = await mismatch(
      pos.payment(MODEL.NON_SECURE, { id: 'order-001', amount: 100.2, transaction_id: '1001' }, TX_TYPE.PAY_POST_AUTH),
    )
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(true)
  })

  // addition: G4 refunds
  it('a partial refund of 40 is approved from the R2-signed answer', async () => {
    let answer: Data = {}
    const { sent, pos } = gateway({
      '/v2/payment/refund': (r) => {
        answer = signed('refund', {
          status: 'success',
          paymentId: r.paymentId,
          price: r.price,
          currency: r.currency,
          conversationId: r.conversationId,
        })
        return answer
      },
    })
    const res = (await pos.refund({
      id: 'order-001',
      amount: 40,
      order_amount: 100,
      currency: 'TRY',
      transaction_id: '1001',
    })) as Data
    expect(answer.signature).toBe(R2)
    expect(sent[0]?.url).toBe(`${PAYMENT_API}/v2/payment/refund`)
    expect(sent[0]?.body).toBe(
      '{"locale":"tr","conversationId":"order-001","paymentId":"1001","price":40,"currency":"TRY"}',
    )
    expect(res.status).toBe('approved')
    expect(res.order_id).toBe('order-001')
  })

  it('a refund answer of 30 for 40 is an amount mismatch with result', async () => {
    const { pos } = gateway({
      '/v2/payment/refund': (r) =>
        signed('refund', {
          status: 'success',
          paymentId: r.paymentId,
          price: 30,
          currency: 'TRY',
          conversationId: r.conversationId,
        }),
    })
    const err = await mismatch(pos.refund({ id: 'order-001', amount: 40, order_amount: 100, transaction_id: '1001' }))
    expect(err.field).toBe('amount')
    expect(err.paymentMayHaveCompleted).toBe(true)
  })

  it.each([
    ['{}', () => ({})],
    [
      'unsigned success',
      (r: Data) => ({
        status: 'success',
        paymentId: r.paymentId,
        price: r.price,
        currency: 'TRY',
        conversationId: r.conversationId,
      }),
    ],
  ] as Array<[string, Handler]>)('a refund answer %s is a PosHttpError', async (_n, handler) => {
    const { pos } = gateway({ '/v2/payment/refund': handler })
    await expect(pos.refund({ id: 'order-001', amount: 40, transaction_id: '1001' })).rejects.toThrow(PosHttpError)
  })

  it.each([
    ['paymentId 1002', { paymentId: '1002' }, 'transaction_id'],
    ['conversationId other', { conversationId: 'other' }, 'order_id'],
    ['currency USD', { currency: 'USD' }, 'currency'],
  ] as Array<[string, Data, string]>)('a refund answer with %s is a %s mismatch', async (_n, over, field) => {
    const { pos } = gateway({
      '/v2/payment/refund': (r) =>
        signed('refund', {
          status: 'success',
          paymentId: r.paymentId,
          price: r.price,
          currency: 'TRY',
          conversationId: r.conversationId,
          ...over,
        }),
    })
    const err = await mismatch(pos.refund({ id: 'order-001', amount: 40, transaction_id: '1001' }))
    expect(err.field).toBe(field)
  })

  it('a failed refund is declined', async () => {
    const { pos } = gateway({
      '/v2/payment/refund': () => ({ status: 'failure', errorCode: '5087', errorMessage: 'x' }),
    })
    const res = (await pos.refund({ id: 'order-001', amount: 40, transaction_id: '1001' })) as Data
    expect(res.status).toBe('declined')
    expect(res.order_id).toBe('order-001')
  })

  // addition: M9 cancel
  it('cancel is approved', async () => {
    const { sent, pos } = gateway()
    const res = (await pos.cancel({ id: 'order-001', transaction_id: '1001' })) as Data
    expect(sent[0]?.url).toBe(`${PAYMENT_API}/payment/cancel`)
    expect(sent[0]?.body).toBe('{"locale":"tr","conversationId":"order-001","paymentId":"1001"}')
    expect(res.status).toBe('approved')
    expect(res.order_id).toBe('order-001')
  })

  it.each([
    ['paymentId 1002', { status: 'success', paymentId: '1002' }, 'transaction_id'],
    ['conversationId other', { status: 'success', conversationId: 'other' }, 'order_id'],
  ] as Array<[string, Data, string]>)(
    'a cancel answer with %s is a %s mismatch with result',
    async (_n, answer, field) => {
      const { pos } = gateway({ '/payment/cancel': () => answer })
      const err = await mismatch(pos.cancel({ id: 'order-001', transaction_id: '1001' }))
      expect(err.field).toBe(field)
      expect(err.paymentMayHaveCompleted).toBe(true)
    },
  )

  it.each([
    ['{}', () => ({})],
    ['204', () => new Response(null, { status: 204 })],
  ] as Array<[string, Handler]>)('a cancel answer %s is a PosHttpError', async (_n, handler) => {
    const { pos } = gateway({ '/payment/cancel': handler })
    await expect(pos.cancel({ id: 'order-001', transaction_id: '1001' })).rejects.toThrow(PosHttpError)
  })

  it('a failed cancel is declined', async () => {
    const { pos } = gateway({ '/payment/cancel': () => ({ status: 'failure', errorCode: '8514', errorMessage: 'x' }) })
    const res = (await pos.cancel({ id: 'order-001', transaction_id: '1001' })) as Data
    expect(res.status).toBe('declined')
  })

  // addition: G5 status
  it('status of order-001 is mapped from the signed answer', async () => {
    const { sent, pos } = gateway()
    const res = (await pos.status({ id: 'order-001' })) as Data
    expect(sent[0]?.url).toBe(`${PAYMENT_API}/payment/detail`)
    expect(res.status).toBe('approved')
    expect(res.order_id).toBe('order-001')
  })

  it('a status approval with a bad signature is a HashMismatchError', async () => {
    const { pos } = gateway({
      '/payment/detail': (r) => ({
        ...DEFAULT_HANDLERS['/payment/detail']?.(r, {} as Sent),
        signature: '1'.repeat(64),
      }),
    })
    await expect(pos.status({ id: 'order-001' })).rejects.toStrictEqual(
      new HashMismatchError('Bank answer signature mismatch'),
    )
  })

  it('a status answer of order-002 for order-001 is an order_id mismatch without response', async () => {
    const { pos } = gateway({
      '/payment/detail': (r) =>
        DEFAULT_HANDLERS['/payment/detail']?.({ ...r, conversationId: 'order-002' }, {} as Sent) as Data,
    })
    const err = await mismatch(pos.status({ id: 'order-001' }))
    expect(err.field).toBe('order_id')
    expect(err.response).toBeUndefined()
  })

  it('a failed status is declined without a signature', async () => {
    const { pos } = gateway({
      '/payment/detail': () => ({ status: 'failure', errorCode: '5087', conversationId: 'order-001' }),
    })
    expect(((await pos.status({ id: 'order-001' })) as Data).status).toBe('declined')
  })

  // addition: G6 order history over the reporting client
  it('order history is a signed GET to the reporting API', async () => {
    const { sent, pos } = gateway()
    const res = (await pos.orderHistory({ id: 'order-001' })) as Data
    expect(sent[0]?.method).toBe('GET')
    expect(sent[0]?.url).toBe(
      `${PAYMENT_API}/v2/reporting/payment/details?locale=tr&paymentConversationId=order-001&conversationId=order-001`,
    )
    expect(sent[0]?.body).toBe('')
    expect(res.status).toBe('approved')
  })

  // addition: R3/R4 order values are refused before any money request
  it.each([
    [
      'sale amount 0',
      (p: IyzicoPos) => p.payment(MODEL.NON_SECURE, fullOrder({ amount: 0 }), TX_TYPE.PAY_AUTH, vectorCard()),
    ],
    [
      'sale item_type SERVICE',
      (p: IyzicoPos) =>
        p.payment(
          MODEL.NON_SECURE,
          fullOrder({ basket_items: [{ id: 'a', name: 'b', category1: 'c', item_type: 'SERVICE', price: 100 }] }),
          TX_TYPE.PAY_AUTH,
          vectorCard(),
        ),
    ],
    [
      'sale payment_channel TV',
      (p: IyzicoPos) =>
        p.payment(MODEL.NON_SECURE, fullOrder({ payment_channel: 'TV' }), TX_TYPE.PAY_AUTH, vectorCard()),
    ],
    [
      'sale without identity number',
      (p: IyzicoPos) =>
        p.payment(
          MODEL.NON_SECURE,
          fullOrder({ buyer: { ...(paymentExtras(100).buyer as Data), identity_number: undefined } }),
          TX_TYPE.PAY_AUTH,
          vectorCard(),
        ),
    ],
    [
      'capture transaction_id x',
      (p: IyzicoPos) =>
        p.payment(MODEL.NON_SECURE, { id: 'order-001', amount: 1, transaction_id: 'x' }, TX_TYPE.PAY_POST_AUTH),
    ],
    [
      'capture amount 1e13',
      (p: IyzicoPos) =>
        p.payment(MODEL.NON_SECURE, { id: 'order-001', amount: 1e13, transaction_id: '1001' }, TX_TYPE.PAY_POST_AUTH),
    ],
    ['refund amount -1', (p: IyzicoPos) => p.refund({ id: 'order-001', amount: -1, transaction_id: '1001' })],
    [
      'refund currency XYZ',
      (p: IyzicoPos) =>
        p.refund({ id: 'order-001', amount: 1, currency: 'XYZ', transaction_id: '1001' } as unknown as PosOrder),
    ],
    ['cancel id a b', (p: IyzicoPos) => p.cancel({ id: 'a b', transaction_id: '1001' })],
    ['status without ids', (p: IyzicoPos) => p.status({})],
  ] as Array<[string, (p: IyzicoPos) => Promise<unknown>]>)('%s is a PosError before any request', async (_n, run) => {
    const { sent, pos } = gateway()
    await expect(run(pos)).rejects.toThrow(PosError)
    expect(sent).toHaveLength(0)
  })

  it('the order is not mutated', async () => {
    const { pos } = gateway()
    const order = fullOrder()
    const copy = structuredClone(order)
    await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, vectorCard())
    expect(order).toStrictEqual(copy)
  })
})

describe('IyzicoPos (end to end) secrets', () => {
  // addition: C5 nothing secret reaches the logger or a thrown error
  it('never logs the secret key, an Authorization value, the card number, the CVC or the expiry', async () => {
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
          event.requestData.note = 'changed by a hook'
        },
      ],
    }
    const { sent, fetchImpl } = bankFetch({
      '/payment/detail': () => new Response(`<html>${SECRET} oops</html>`, { status: 200 }),
    })
    const { pos } = realGateway(fetchImpl, { logger, hooks })
    const errors: unknown[] = []
    const keep = (e: unknown) => {
      errors.push(e)
      return undefined
    }

    await pos.get3DFormData(fullOrder(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, vectorCard())
    await pos.get3DFormData(fullOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)
    await pos.payment(MODEL.THREE_D_SECURE, vectorOrder(), TX_TYPE.PAY_AUTH, null, cb(cb3()))
    await pos.payment(MODEL.THREE_D_HOST, vectorOrder(), TX_TYPE.PAY_AUTH, null, cb({ token: 'tok-123' }))
    await pos.payment(MODEL.NON_SECURE, fullOrder(), TX_TYPE.PAY_AUTH, vectorCard())
    await pos.payment(
      MODEL.NON_SECURE,
      { id: 'order-001', amount: 100.2, transaction_id: '1001' },
      TX_TYPE.PAY_POST_AUTH,
    )
    await pos.cancel({ id: 'order-001', transaction_id: '1001' })
    await pos.refund({ id: 'order-001', amount: 40, transaction_id: '1001' })
    await pos.orderHistory({ id: 'order-001' })
    await pos.status({ id: 'order-001' }).catch(keep)
    await pos
      .payment(MODEL.THREE_D_SECURE, vectorOrder(), TX_TYPE.PAY_AUTH, null, cb(cb3({ paymentId: '1002' })))
      .catch(keep)

    const logged = JSON.stringify(records)
    expect(sent).toHaveLength(10)
    expect(errors).toHaveLength(2)
    expect(logged).toContain('Request data is changed via listeners')
    expect(logged).not.toContain(SECRET)
    expect(logged).not.toContain('4603450000000000')
    expect(logged).not.toMatch(/cvc\\?"\s*:\s*\\?"?000/i)
    expect(logged).not.toMatch(/expire(?:Month|Year)\\?"\s*:\s*\\?"?\d/)
    for (const s of sent) {
      expect(logged).not.toContain(s.headers.authorization as string)
      expect(logged).not.toContain((s.headers.authorization as string).slice('IYZWSv2 '.length))
    }
    const thrown = JSON.stringify(errors.map((e) => ({ message: (e as Error).message, ...(e as object) })))
    expect(thrown).not.toContain(SECRET)
    expect(errors[0]).toBeInstanceOf(PosHttpError)
    const failures = records.filter((r) =>
      ['hash check failed', '3D callback hash mismatch'].includes((r as unknown[])[1] as string),
    )
    expect(failures).toHaveLength(2)
    for (const failure of failures) {
      expect(Object.keys((failure as unknown[])[2] as object)).toStrictEqual(['order_id'])
    }
  })

  // addition: C5 secrets of the factory-built gateway are never serialised
  it('JSON and inspect dumps of the PosFactory-built gateway hold no secret key', () => {
    const account = AccountFactory.createIyzicoPosAccount('iyzico', 'sandbox-apiKey', SECRET)
    const gateway = PosFactory.createPosGateway(account, posTestConfig)
    expect(gateway).toBeInstanceOf(IyzicoPos)
    for (const dump of [JSON.stringify(gateway), inspect(gateway, { depth: 20, showHidden: true })]) {
      expect(dump).not.toContain(SECRET)
    }
  })
})

describe('IyzicoPos (end to end) concurrency', () => {
  // addition: C8 one gateway serves concurrent callbacks of two orders
  it('two concurrent 3D callbacks keep their own results', async () => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    const second = signedCallback({ conversationId: 'order-002', mdStatus: '1', paymentId: '1002', status: 'success' })
    const [a, b] = (await Promise.all([
      pos.payment(MODEL.THREE_D_SECURE, vectorOrder(), TX_TYPE.PAY_AUTH, null, cb(cb3())),
      pos.payment(
        MODEL.THREE_D_SECURE,
        vectorOrder({ id: 'order-002', amount: 250 }),
        TX_TYPE.PAY_AUTH,
        null,
        cb(second),
      ),
    ])) as Data[]
    expect([a?.status, a?.order_id, a?.transaction_id, a?.amount]).toStrictEqual(['approved', 'order-001', '1001', 100])
    expect([b?.status, b?.order_id, b?.transaction_id, b?.amount]).toStrictEqual(['approved', 'order-002', '1002', 250])
    expect(sent).toHaveLength(2)
    const randomKeys = sent.map((s) => Buffer.from((s.headers.authorization as string).slice(8), 'base64').toString())
    expect(randomKeys[0]).not.toBe(randomKeys[1])
  })
})

// addition: a client error with a readable failure body takes the normal failure handling only where no money can move
describe('IyzicoPos (end to end) readable failures of client errors', () => {
  const FAILURE = '{"status":"failure","errorCode":"1","errorMessage":"Rejected by the bank"}'
  const reply =
    (status: number, body: string): Handler =>
    () =>
      new Response(body, { status })
  const gateway = (handlers: Record<string, Handler>) => {
    const { sent, fetchImpl } = bankFetch(handlers)
    return { sent, pos: realGateway(fetchImpl).pos }
  }
  const SECURE_INIT = '/payment/3dsecure/initialize'
  const HOST_INIT = '/payment/iyzipos/checkoutform/initialize/auth/ecom'

  it.each([
    ['3D Secure initialize', SECURE_INIT, MODEL.THREE_D_SECURE],
    ['3D Host initialize', HOST_INIT, MODEL.THREE_D_HOST],
  ] as Array<[string, string, PaymentModel]>)(
    '%s: HTTP 400 with a failure body is the form failure PosError',
    async (_n, path, model) => {
      const { pos } = gateway({ [path]: reply(400, FAILURE) })
      const err = await pos
        .get3DFormData(fullOrder(), model, TX_TYPE.PAY_AUTH, model === MODEL.THREE_D_SECURE ? vectorCard() : null)
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PosError)
      expect(err).not.toBeInstanceOf(PosHttpError)
      expect((err as Error).message).toBe('iyzico 3D form could not be created: Rejected by the bank')
    },
  )

  it('3D Host retrieve: HTTP 400 with a failure body is a decline of the order', async () => {
    const { promise } = hostCallback({ token: 'tok-123' }, vectorOrder(), { [RETRIEVE]: reply(400, FAILURE) })
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.order_id).toBe('order-001')
    expect(res.error_message).toBe('Rejected by the bank')
  })

  it('status: HTTP 400 with a failure body is declined', async () => {
    const { pos } = gateway({ '/payment/detail': reply(400, FAILURE) })
    const res = (await pos.status({ id: 'order-001' })) as Data
    expect(res.status).toBe('declined')
    expect(res.error_message).toBe('Rejected by the bank')
  })

  const readOnly: Array<[string, (pos: IyzicoPos) => Promise<unknown>, string]> = [
    [
      '3D Secure initialize',
      (pos) => pos.get3DFormData(fullOrder(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, vectorCard()),
      SECURE_INIT,
    ],
    ['3D Host initialize', (pos) => pos.get3DFormData(fullOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH), HOST_INIT],
    [
      '3D Host retrieve',
      (pos) => pos.payment(MODEL.THREE_D_HOST, vectorOrder(), TX_TYPE.PAY_AUTH, null, cb({ token: 'tok-123' })),
      RETRIEVE,
    ],
    ['status', (pos) => pos.status({ id: 'order-001' }), '/payment/detail'],
  ]

  it.each(readOnly)('%s: HTTP 400 that is not a readable failure is a PosHttpError', async (_n, run, path) => {
    for (const body of [
      '<html>WAF</html>',
      '',
      '{"status":"success"}',
      '{"status":"Failure"}',
      '[1]',
      '{"errorMessage":"x"}',
    ]) {
      const { pos } = gateway({ [path]: reply(400, body) })
      const err = await run(pos).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PosHttpError)
      expect((err as PosHttpError).status).toBe(400)
    }
  })

  // addition: only HTTP 400 is iyzico's documented failure code; other client errors are never read
  it.each(readOnly)('%s: HTTP 401, 403, 404 and 429 with a failure body stay a PosHttpError', async (_n, run, path) => {
    for (const code of [401, 403, 404, 429]) {
      const { pos } = gateway({ [path]: reply(code, FAILURE) })
      const err = await run(pos).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PosHttpError)
      expect((err as PosHttpError).status).toBe(code)
    }
  })

  // addition: a status answer that is neither success nor failure does not tell the outcome
  it.each([
    ['empty record', () => new Response('{}', { status: 200 })],
    ['204', () => new Response(null, { status: 204 })],
    ['another word', () => new Response('{"status":"pending"}', { status: 200 })],
    ['another case', () => new Response('{"status":"SUCCESS"}', { status: 200 })],
  ] as Array<[string, Handler]>)('status: an answer with %s is an unknown outcome PosHttpError', async (_n, h) => {
    const { pos } = gateway({ '/payment/detail': h })
    const err = await pos.status({ id: 'order-001' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
  })

  it.each(readOnly)('%s: HTTP 500 with a failure body stays a PosHttpError', async (_n, run, path) => {
    const { pos } = gateway({ [path]: reply(500, FAILURE) })
    const err = await run(pos).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).status).toBe(500)
  })

  const money: Array<[string, (pos: IyzicoPos) => Promise<unknown>, string]> = [
    [
      'non-secure sale',
      (pos) => pos.payment(MODEL.NON_SECURE, fullOrder(), TX_TYPE.PAY_AUTH, vectorCard()),
      '/payment/auth',
    ],
    [
      '3D Secure authorization',
      (pos) => pos.payment(MODEL.THREE_D_SECURE, vectorOrder(), TX_TYPE.PAY_AUTH, null, cb(cb3())),
      '/payment/v2/3dsecure/auth',
    ],
    [
      'post-authorization',
      (pos) =>
        pos.payment(
          MODEL.NON_SECURE,
          { id: 'order-001', amount: 100, currency: 'TRY', transaction_id: '1001' },
          TX_TYPE.PAY_POST_AUTH,
        ),
      '/payment/postauth',
    ],
    ['refund', (pos) => pos.refund({ id: 'order-001', amount: 40, transaction_id: '1001' }), '/v2/payment/refund'],
    ['cancel', (pos) => pos.cancel({ id: 'order-001', transaction_id: '1001' }), '/payment/cancel'],
  ]

  it.each(money)('%s: HTTP 400 with a failure body stays a PosHttpError', async (_n, run, path) => {
    const { pos } = gateway({ [path]: reply(400, FAILURE) })
    const err = await run(pos).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).status).toBe(400)
  })
})

describe('IyzicoPos (end to end) read-only hardening', () => {
  const gateway = (handlers: Record<string, Handler> = {}) => {
    const { sent, fetchImpl } = bankFetch(handlers)
    return { sent, pos: realGateway(fetchImpl).pos }
  }

  // addition: status binds the answered payment id to the order's transaction id
  it('status with transaction_id 1001 accepts the answer of payment 1001', async () => {
    const { pos } = gateway()
    const res = (await pos.status({ id: 'order-001', transaction_id: '1001' })) as Data
    expect(res.status).toBe('approved')
    expect(res.transaction_id).toBe('1001')
  })

  it('status with transaction_id 1002 and the answer of payment 1001 is a transaction_id mismatch without result', async () => {
    const { pos } = gateway()
    const err = await mismatch(pos.status({ id: 'order-001', transaction_id: '1002' }))
    expect(err.field).toBe('transaction_id')
    expect(err.expected).toBe('1002')
    expect(err.actual).toBe('1001')
    expect(err.response).toBeUndefined()
    expect(err.paymentMayHaveCompleted).toBe(false)
  })

  // addition: a failed 3D form text never carries the card number or anything shaped like one
  it('a failed 3D Secure initialize hides the card number and card-shaped digit runs in the bank text', async () => {
    const { pos } = gateway({
      '/payment/3dsecure/initialize': () => ({
        status: 'failure',
        errorMessage:
          'Card 4603450000000000 / 4603 4500 0000 0000 / 5555-4444-3333-2222 / 12345678901234567 refused, code 123456',
      }),
    })
    const err = (await pos
      .get3DFormData(fullOrder(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, vectorCard())
      .catch((e: unknown) => e)) as Error
    expect(err).toBeInstanceOf(PosError)
    expect(err.message).toBe('iyzico 3D form could not be created: Card *** / *** / *** / *** refused, code 123456')
  })
})
