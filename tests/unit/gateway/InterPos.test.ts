import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { InterPosHttpClient } from '../../../src/client/InterPosHttpClient.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { InterPosCrypt } from '../../../src/crypt/InterPosCrypt.js'
import { InterPosRequestDataMapper } from '../../../src/data-mapper/request/mapper/InterPosRequestDataMapper.js'
import type { RequestDataMapperInterface } from '../../../src/data-mapper/request/mapper/RequestDataMapperInterface.js'
import { InterPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/InterPosRequestValueFormatter.js'
import { InterPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/InterPosRequestValueMapper.js'
import { InterPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/InterPosResponseDataMapper.js'
import type { ResponseDataMapperInterface } from '../../../src/data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { InterPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/InterPosResponseValueFormatter.js'
import { InterPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/InterPosResponseValueMapper.js'
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
import type { GatewayConfig, GatewayDeps } from '../../../src/gateway/AbstractGateway.js'
import { InterPos } from '../../../src/gateway/InterPos.js'
import type { PosLogger } from '../../../src/logger.js'
import type { InterPosAccount } from '../../../src/model/account/InterPosAccount.js'
import {
  CARD_TYPE,
  CURRENCY,
  FORM_FORMAT,
  type FormFormat,
  MODEL,
  type PaymentModel,
  TX_TYPE,
  type TxType,
} from '../../../src/PosInterface.js'
import type { GatewayResponseData, PosHooks, PosOrder, RequestDataPreparedEvent } from '../../../src/types.js'
import {
  threeDPaymentDataProvider,
  threeDPayPaymentDataProvider,
} from '../data-mapper/response/mapper/InterPosResponseDataMapper.data.js'
import { FULL_SUCCESS_RECORD, FULL_SUCCESS_RESPONSE } from '../serializer/interPosFixtures.js'

// The first section replaces the collaborators with vi.fn() fakes (except the request value mapper); the end-to-end
// sections use the real mappers, crypt and HTTP client over a fake fetch that parses every request and answers like
// the bank with `;;` bodies.

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

const PAYMENT_API = 'https://test.inter-vpos.com.tr/mpi/Default.aspx'
const GATEWAY_3D = 'https://test.inter-vpos.com.tr/mpi/Default.aspx'
const GATEWAY_3D_HOST = 'https://test.inter-vpos.com.tr/mpi/3DHost.aspx'
const MERCHANT_PASS = 'gDg1N'

// deviation: payment_api added, the TS strategy requires it
const config: GatewayConfig = {
  name: 'DenizBank-InterPos',
  class: 'InterPos',
  gateway_endpoints: { payment_api: PAYMENT_API, gateway_3d: GATEWAY_3D, gateway_3d_host: GATEWAY_3D_HOST },
}

/** `disable_3d_hash_check` is not an option; passing it must have no effect. */
const configWithHashCheckDisabled = {
  ...config,
  gateway_configs: { disable_3d_hash_check: true },
} as unknown as GatewayConfig

const D = AccountFactory.createInterPosAccount('denizbank', '3123', 'InterTestApi', '3', MERCHANT_PASS)

const S1 = (text: string): string => createHash('sha1').update(text, 'utf8').digest('base64')

const HP = 'Version:PurchAmount:Exponent:Currency:OkUrl:FailUrl:MD:OrderId:ProcReturnCode:Response:mdStatus:'
const OK = 'https://domain.com/success'
const FAIL = 'https://domain.com/fail_url'
const SIGNED_FIELDS = HP.split(':').filter((name) => name !== '')

/** The bank's callback hash over the signed values (absent or null read as empty) and the merchant password. */
const sign = (cb: Data): string =>
  S1(
    `${SIGNED_FIELDS.map((name) => (cb[name] === undefined || cb[name] === null ? '' : String(cb[name]))).join('')}${MERCHANT_PASS}`,
  )

/** The callback with `HASH` recomputed over its (changed) signed fields, as the bank would sign it. */
const resign = (cb: Data): Data => ({ ...cb, HASH: sign(cb) })

/** FV3: an approved 3D Pay callback of order 20221225B83B (3D status equal to the signed mdStatus). */
const fv3 = (over: Data = {}): Data =>
  resign({
    Version: '',
    PurchAmount: '1,01',
    Exponent: '',
    Currency: '949',
    OkUrl: OK,
    FailUrl: FAIL,
    MD: '',
    OrderId: '20221225B83B',
    ProcReturnCode: '00',
    Response: 'Approved',
    mdStatus: '1',
    '3DStatus': '1',
    HASHPARAMS: HP,
    ...over,
  })

/** FV4: a successful 3D Secure authentication of order 33554969 (provision still to come). */
const fv4 = (over: Data = {}): Data =>
  resign({
    Version: '',
    PurchAmount: '1',
    Exponent: '',
    Currency: '949',
    OkUrl: OK,
    FailUrl: FAIL,
    MD: 'MDVALUE123',
    OrderId: '33554969',
    ProcReturnCode: '',
    Response: '',
    mdStatus: '1',
    '3DStatus': '1',
    Eci: '02',
    PayerAuthenticationCode: 'AAAB',
    PayerTxnId: '',
    ShopCode: '3123',
    HASHPARAMS: HP,
    ...over,
  })

/** FP1: a genuine 3D-Secure-shaped callback of order 1200, and the same signed text re-read as an approval of 12. */
const fp1Genuine = (): Data => fv3({ MD: 'MDVALUE123', OrderId: '1200', ProcReturnCode: '', Response: '' })
const fp1ReRead = (): Data => ({ ...fp1Genuine(), OrderId: '12', ProcReturnCode: '00' })

/** FP2: a genuine decline of order 120 re-read as order 12 with return code 00 and response '5'. */
const fp2ReRead = (): Data => ({
  ...fv3({ OrderId: '120', ProcReturnCode: '05', Response: '' }),
  OrderId: '12',
  ProcReturnCode: '00',
  Response: '5',
})

/** FP4: approved by the bank although the 3D authentication failed. */
const fp4 = (): Data => fv3({ mdStatus: '0', '3DStatus': '0' })

/** FV5: a signed 3D Pay decline. */
const fv5 = (): Data => fv3({ ProcReturnCode: '81', Response: '', mdStatus: '0', '3DStatus': '0' })

const withoutNulls = (data: Data): Data => Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null))

const pick = <T>(rows: Array<[string, T]>, name: string): T => {
  const row = rows.find(([n]) => n === name)
  if (row === undefined) throw new Error(`missing fixture ${name}`)
  return row[1]
}

/** FV2 row 2: the genuine 3D Secure decline of order 20221225E1DF (null values removed, as a form never has them). */
const secureAuthFail = (): Data => withoutNulls(pick(threeDPaymentDataProvider, 'authFail1').threeDResponseData as Data)

/** FV2 row 3: the genuine 3D Pay decline of order 20221225B83B. */
const payAuthFail = (): Data => withoutNulls(pick(threeDPayPaymentDataProvider, 'authFail1').paymentData as Data)

/** FP3: the genuine decline re-sent with a field list that puts the whole signed text into `Version`. */
const fp3 = (): Data => {
  const genuine = secureAuthFail()
  return {
    ...genuine,
    HASHPARAMS: 'Version',
    Version: genuine.HASHPARAMSVAL,
    OrderId: '12',
    ProcReturnCode: '00',
    mdStatus: '1',
    '3DStatus': '1',
  }
}

const secureOrder: PosOrder = { id: '33554969', amount: 1, currency: CURRENCY.TRY }
const payOrder: PosOrder = { id: '20221225B83B', amount: 1.01, currency: CURRENCY.TRY }
const hostOrder: PosOrder = { id: '202212256D26', amount: 1.01, currency: CURRENCY.TRY }

const createLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })

const cb = (data: Data): GatewayResponseData => data as GatewayResponseData

describe('InterPos planning vectors', () => {
  // addition: the callbacks below are signed exactly as the planning vectors (PHP-verified)
  it.each([
    ['FV3 3D Pay', fv3(), 'A9+zYc4QLhaEi0jFT1mFVwQjmGA='],
    ['FV3 3D Host', fv3({ OrderId: '202212256D26' }), '2BdItiuhkEBGgfHclzZo8MYvcoo='],
    ['FV3 half 3D', fv3({ mdStatus: '2', '3DStatus': '2' }), '8Xsn4UljRdUC5t8T/4LFz6GsGQc='],
    ['FV4', fv4(), '4SLRmgQgs9TDGlbof+TVUbsk5fE='],
    ['FP1', fp1Genuine(), '3hRV0B1GwwBJCnOe73WqjmHUr1I='],
    ['FP4', fp4(), 'Htdt5+Heq3J7Er/mo/6mFT6vwbY='],
    ['FP5', fv3({ OrderId: '20221225B83C' }), 'iCBA73PzZwnJawkkBkPneTTgSwA='],
    ['FP6', fv3({ Currency: '840' }), 'm5cCvJIDVnQ+bi94Qbv7QJP0AoY='],
    ['FP7', fv3({ PurchAmount: '2,00' }), 'poGCBje6PuBUuENQRdZiaHi6sDE='],
    ['FV5', fv5(), 'leUqa3qvm7iHDfxk68WbWUOO6Do='],
    ['FV2 row 2', secureAuthFail(), '423AWRAXl0VlEbQjpmAfntT5e3E='],
    ['FV2 row 3', payAuthFail(), 'PvDXe6Puf9W2oZnBZuHVp8oWpyY='],
  ])('%s', (_name, callback, hash) => {
    expect(callback.HASH).toBe(hash)
    expect(sign(callback)).toBe(hash)
  })

  // addition: the re-reads keep the genuine hash
  it('FP1 and FP2 re-reads keep the genuine hash', () => {
    expect(sign(fp1ReRead())).toBe('3hRV0B1GwwBJCnOe73WqjmHUr1I=')
    expect(fp1ReRead().HASH).toBe('3hRV0B1GwwBJCnOe73WqjmHUr1I=')
    expect(sign(fp2ReRead())).toBe('LLJTVZ3RmdIFFEAKemghpfTQPdw=')
    expect(fp2ReRead().HASH).toBe('LLJTVZ3RmdIFFEAKemghpfTQPdw=')
  })
})

describe('InterPos (mocked collaborators)', () => {
  const account = D
  let requestValueMapper: InterPosRequestValueMapper
  let requestMapper: Mocked<RequestDataMapperInterface>
  let responseMapper: Mocked<ResponseDataMapperInterface>
  let crypt: Mocked<CryptInterface>
  let httpClient: { supportsTx: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }
  let clientStrategy: { getClient: ReturnType<typeof vi.fn>; getAllClients: ReturnType<typeof vi.fn> }
  let requestDataPrepared: ReturnType<typeof vi.fn<(e: RequestDataPreparedEvent) => void>>
  let logger: ReturnType<typeof createLogger>
  let pos: InterPos

  const createGateway = (cfg: GatewayConfig, acc: InterPosAccount = account): InterPos => {
    const hooks: PosHooks = { onRequestDataPrepared: [requestDataPrepared] }
    const deps: GatewayDeps<InterPosAccount> = {
      requestValueMapper,
      requestValueFormatter: new InterPosRequestValueFormatter(),
      requestDataMapper: requestMapper as unknown as RequestDataMapperInterface<InterPosAccount>,
      responseDataMapper: responseMapper as unknown as ResponseDataMapperInterface,
      crypt: crypt as unknown as CryptInterface<InterPosAccount>,
      clientStrategy: clientStrategy as unknown as HttpClientStrategy,
      logger,
      hooks,
    }
    return new InterPos(cfg, acc, deps)
  }

  beforeEach(() => {
    requestValueMapper = new InterPosRequestValueMapper()
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

  const card = () =>
    CreditCardFactory.createForGateway(pos, '5555444433332222', '21', '12', '122', 'ahmet', CARD_TYPE.VISA)

  type Exchange = {
    txType: TxType
    paymentModel: PaymentModel
    requestData: Data
    order: PosOrder
    decodedResponse: Data | Error
  }

  /** Client calls in order; every hook dispatch marks the request data, so each request must carry the mark. */
  const configureClientResponses = (exchanges: Exchange[]): (() => void) => {
    clientStrategy.getClient.mockReturnValue(httpClient as unknown as AbstractHttpClient)
    for (const exchange of exchanges) {
      if (exchange.decodedResponse instanceof Error) {
        httpClient.request.mockRejectedValueOnce(exchange.decodedResponse)
      } else {
        httpClient.request.mockResolvedValueOnce(exchange.decodedResponse)
      }
    }
    let dispatched = 0
    requestDataPrepared.mockImplementation((event) => {
      const exchange = exchanges[dispatched] as Exchange
      dispatched += 1
      expect(event.gatewayClass).toBe('InterPos')
      expect(event.txType).toBe(exchange.txType)
      expect(event.requestData).toStrictEqual(exchange.requestData)
      expect(event.order).toStrictEqual(exchange.order)
      expect(event.paymentModel).toBe(exchange.paymentModel)
      event.requestData['test-update-request-data-with-event'] = true
    })

    return () => {
      expect(requestDataPrepared).toHaveBeenCalledTimes(exchanges.length)
      expect(clientStrategy.getClient).toHaveBeenCalledTimes(exchanges.length)
      expect(httpClient.request).toHaveBeenCalledTimes(exchanges.length)
      exchanges.forEach((exchange, index) => {
        expect(clientStrategy.getClient).toHaveBeenNthCalledWith(index + 1, exchange.txType, exchange.paymentModel)
        const [tx, model, data, sentOrder, url] = httpClient.request.mock.calls[index] as unknown[]
        expect([tx, model, sentOrder, url]).toStrictEqual([
          exchange.txType,
          exchange.paymentModel,
          exchange.order,
          null,
        ])
        expect(data).toStrictEqual({ ...exchange.requestData, 'test-update-request-data-with-event': true })
      })
    }
  }

  const configureClientResponse = (
    txType: TxType,
    requestData: Data,
    decodedResponse: Data | Error,
    order: PosOrder,
    paymentModel: PaymentModel,
  ) => configureClientResponses([{ txType, paymentModel, requestData, order, decodedResponse }])

  /** The bank status record that confirms an approved 3D Pay / 3D Host payment of `orderId`. */
  const confirmingRecord = (orderId: string, over: Data = {}): Data => ({
    OrderId: orderId,
    ProcReturnCode: '00',
    PurchAmount: '1,01',
    AuthCode: 'A12345',
    TransId: 'T1',
    VoidDate: '1.1.0001 00:00:00',
    RefundedAmount: '0',
    ...over,
  })

  /** The status request that confirms an approved hosted result, answered with `mapped`. */
  const statusExchange = (orderId: string, mapped: Data): Exchange => {
    const statusRequest = { request: 'createStatusRequestData' }
    requestMapper.createStatusRequestData.mockReturnValue(statusRequest)
    responseMapper.mapStatusResponse.mockReturnValue(mapped)
    return {
      txType: TX_TYPE.STATUS,
      paymentModel: MODEL.NON_SECURE,
      requestData: statusRequest,
      order: { id: orderId },
      decodedResponse: { decoded: 'status' },
    }
  }

  const expectNoRequest = () => {
    expect(httpClient.request).not.toHaveBeenCalled()
    expect(requestDataPrepared).not.toHaveBeenCalled()
    expect(requestMapper.createStatusRequestData).not.toHaveBeenCalled()
    expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
  }

  it('init', () => {
    expect(pos.getCurrencies()).toHaveLength(Object.keys(requestValueMapper.getCurrencyMappings()).length)
    expect(pos.getAccount()).toBe(account)
    expect(pos.isTestMode()).toBe(false)
    expect(pos.getCrypt()).toBe(crypt)
  })

  // addition: identifiers and the supported transactions table
  it('exposes NAME, the gateway class identifier and the supported transactions', () => {
    expect(InterPos.NAME).toBe('InterPos')
    expect(InterPos.GATEWAY_CLASS).toBe('InterPos')
    for (const tx of [TX_TYPE.PAY_AUTH, TX_TYPE.PAY_PRE_AUTH]) {
      for (const model of [MODEL.THREE_D_SECURE, MODEL.THREE_D_PAY, MODEL.THREE_D_HOST, MODEL.NON_SECURE]) {
        expect(InterPos.isSupportedTransaction(tx, model)).toBe(true)
      }
      expect(InterPos.isSupportedTransaction(tx, MODEL.THREE_D_PAY_HOSTING)).toBe(false)
    }
    for (const tx of [TX_TYPE.PAY_POST_AUTH, TX_TYPE.STATUS, TX_TYPE.CANCEL, TX_TYPE.REFUND, TX_TYPE.REFUND_PARTIAL]) {
      expect(InterPos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(true)
    }
    expect(InterPos.isSupportedTransaction(TX_TYPE.ORDER_HISTORY, MODEL.NON_SECURE)).toBe(false)
  })

  // addition: test_mode only selects endpoints for this gateway
  it('init on test mode logs a warning', () => {
    const p = createGateway({ ...config, test_mode: true })
    expect(requestMapper.setTestMode).toHaveBeenCalledWith(true)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(p.isTestMode()).toBe(true)
  })

  // ---- 3D form ----

  it.each([
    [true, MODEL.THREE_D_SECURE, GATEWAY_3D],
    [false, MODEL.THREE_D_HOST, GATEWAY_3D_HOST],
  ] as Array<[boolean, PaymentModel, string]>)(
    'get3DFormData with card %s, model %s',
    async (isWithCard, paymentModel, gatewayUrl) => {
      const c = isWithCard ? card() : null
      const order = { id: '124' }
      requestMapper.create3DFormData.mockResolvedValue({ formData: true })

      const actual = await pos.get3DFormData(order, paymentModel, TX_TYPE.PAY_AUTH, c, !isWithCard)

      expect(requestMapper.create3DFormData).toHaveBeenCalledTimes(1)
      expect(requestMapper.create3DFormData).toHaveBeenCalledWith(account, order, paymentModel, 'pay', gatewayUrl, c)
      expect(actual).toStrictEqual({ formData: true })
      expectNoRequest()
    },
  )

  // deviation: F30 English messages and error classes of the shared 3D form input check
  it.each([
    [
      '3d_secure_without_card',
      MODEL.THREE_D_SECURE,
      TX_TYPE.PAY_AUTH,
      false,
      false,
      PosError,
      'Card data is required for this payment model',
      null,
    ],
    [
      '3d_pay_without_card',
      MODEL.THREE_D_PAY,
      TX_TYPE.PAY_AUTH,
      false,
      false,
      PosError,
      'Card data is required for this payment model',
      null,
    ],
    [
      'non_payment_tx_type',
      MODEL.THREE_D_PAY,
      TX_TYPE.STATUS,
      false,
      false,
      UnsupportedTransactionTypeError,
      'Invalid transaction type! Supported transaction types: [pay, pre].',
      null,
    ],
    [
      'post_auth_tx_type',
      MODEL.THREE_D_PAY,
      TX_TYPE.PAY_POST_AUTH,
      true,
      false,
      UnsupportedTransactionTypeError,
      'Invalid transaction type! Supported transaction types: [pay, pre].',
      null,
    ],
    [
      'unsupported_form_format',
      MODEL.THREE_D_PAY,
      TX_TYPE.PAY_AUTH,
      true,
      false,
      UnsupportedFormFormatError,
      'Unsupported 3D form format!',
      FORM_FORMAT.HTML,
    ],
  ] as Array<[string, PaymentModel, TxType, boolean, boolean, new () => Error, string, FormFormat | null]>)(
    'get3DFormData with bad inputs %s',
    async (_name, paymentModel, txType, isWithCard, createWithoutCard, errorClass, message, formFormat) => {
      const c = isWithCard ? card() : null
      const err = await pos
        .get3DFormData({ id: '2020110828BC' }, paymentModel, txType, c, createWithoutCard, formFormat)
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(errorClass)
      expect((err as Error).message).toBe(message)
      expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
      expectNoRequest()
    },
  )

  // addition: the html format is refused for every model, and an unsupported model names this gateway
  it.each([
    [MODEL.THREE_D_SECURE, true, FORM_FORMAT.HTML, UnsupportedFormFormatError, 'Unsupported 3D form format!'],
    [MODEL.THREE_D_HOST, false, FORM_FORMAT.HTML, UnsupportedFormFormatError, 'Unsupported 3D form format!'],
    [
      MODEL.THREE_D_PAY_HOSTING,
      false,
      null,
      UnsupportedTransactionTypeError,
      'InterPos supports [3d, 3d_pay, 3d_host, regular] payment model(s) for transaction type [pay]. Provided payment model: [3d_pay_hosting].',
    ],
  ] as Array<[PaymentModel, boolean, FormFormat | null, new () => Error, string]>)(
    'get3DFormData refuses %s (format %s)',
    async (paymentModel, isWithCard, formFormat, errorClass, message) => {
      const err = await pos
        .get3DFormData(
          { id: '124' },
          paymentModel,
          TX_TYPE.PAY_AUTH,
          isWithCard ? card() : null,
          !isWithCard,
          formFormat,
        )
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(errorClass)
      expect((err as Error).message).toBe(message)
      expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
    },
  )

  // ---- 3D Secure ----

  type SecureRow = [
    name: string,
    order: PosOrder,
    txType: TxType,
    callback: Data,
    paymentResponse: Data,
    expected: Data,
    is3DSuccess: boolean,
  ]

  const secureRows: SecureRow[] = [
    [
      '3d_fail',
      {},
      TX_TYPE.PAY_AUTH,
      {
        Version: null,
        OkUrl: 'http:\\/\\/localhost\\/interpos\\/3d\\/response.php',
        FailUrl: 'http:\\/\\/localhost\\/interpos\\/3d\\/response.php',
        '3DStatus': '0',
        HASH: '423AWRAXl0VlEbQjpmAfntT5e3E=',
        HASHPARAMS: HP,
        HASHPARAMSVAL:
          '1,01949http:\\/\\/localhost\\/interpos\\/3d\\/response.phphttp:\\/\\/localhost\\/interpos\\/3d\\/response.php20221225E1DF810',
      },
      {},
      {
        order_id: '20221225E1DF',
        proc_return_code: '81',
        status: 'declined',
        error_code: 'B810002',
        error_message: 'Terminal Aktif Degil',
      },
      false,
    ],
    [
      'success',
      // deviation: F9/F12 the order and callback (FV4) carry the signed fields the binding needs
      secureOrder,
      TX_TYPE.PAY_AUTH,
      fv4(),
      { OrderId: '33554969', ProcReturnCode: '00', Amount: '1,00', AuthCode: 'gizlendi', TransId: 'gizlendi' },
      { status: 'approved', order_id: '33554969' },
      true,
    ],
  ]

  const run3DPaymentRow = async (p: InterPos, row: SecureRow) => {
    const [, order, txType, callback, paymentResponse, expected, is3DSuccess] = row
    // deviation: F11 a present hash is always verified, also on the declined path
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.extractMdStatus.mockReturnValue(is3DSuccess ? '1' : '3d-status')
    responseMapper.is3dAuthSuccess.mockReturnValue(is3DSuccess)
    responseMapper.map3DPaymentData.mockReturnValue(expected)
    let verify: (() => void) | null = null
    const provisionRequest = { request: 'create3DPaymentRequestData' }
    if (is3DSuccess) {
      requestMapper.create3DPaymentRequestData.mockReturnValue(provisionRequest)
      verify = configureClientResponse(txType, provisionRequest, paymentResponse, order, MODEL.THREE_D_SECURE)
    }

    // deviation: Q6 the mapped response is returned (no isSuccess state)
    const result = await p.payment(MODEL.THREE_D_SECURE, order, txType, null, cb(callback))

    expect(result).toStrictEqual(expected)
    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
    expect(crypt.check3DHash).toHaveBeenCalledWith(account, callback)
    expect(responseMapper.extractMdStatus).toHaveBeenCalledTimes(1)
    expect(responseMapper.extractMdStatus).toHaveBeenCalledWith(callback)
    expect(responseMapper.is3dAuthSuccess).toHaveBeenCalledTimes(1)
    expect(responseMapper.is3dAuthSuccess).toHaveBeenCalledWith(is3DSuccess ? '1' : '3d-status')
    expect(responseMapper.map3DPaymentData).toHaveBeenCalledTimes(1)
    if (is3DSuccess) {
      expect(requestMapper.create3DPaymentRequestData).toHaveBeenCalledWith(account, order, txType, callback)
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(callback, paymentResponse, txType, order)
      verify?.()
    } else {
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(callback, null, txType, order)
      expectNoRequest()
    }
  }

  it.each(secureRows)('make3DPayment %s', async (...row) => {
    await run3DPaymentRow(pos, row)
  })

  // deviation: F11 disable_3d_hash_check is ignored, the hash is still checked once
  it.each(secureRows)('make3DPayment without hash check %s', async (...row) => {
    await run3DPaymentRow(createGateway(configWithHashCheckDisabled), row)
  })

  it('make3DPayment hash mismatch', async () => {
    // deviation: F11 the callback carries a hash (an absent hash is a different error)
    const callback = { HASH: 'x', HASHPARAMS: HP, mdStatus: '1', '3DStatus': '1' }
    crypt.check3DHash.mockReturnValue(false)

    await expect(pos.payment(MODEL.THREE_D_SECURE, {}, TX_TYPE.PAY_AUTH, null, cb(callback))).rejects.toThrow(
      new HashMismatchError('3D callback hash mismatch'),
    )
    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
    expect(crypt.check3DHash).toHaveBeenCalledWith(account, callback)
    expect(responseMapper.extractMdStatus).not.toHaveBeenCalled()
    expect(responseMapper.is3dAuthSuccess).not.toHaveBeenCalled()
    expect(responseMapper.map3DPaymentData).not.toHaveBeenCalled()
    expectNoRequest()
  })

  // addition: F18 fail closed when a callback without 3D success is not mapped as declined
  it('make3DPayment: a callback without 3D success mapped as approved is rejected (PosError)', async () => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.is3dAuthSuccess.mockReturnValue(false)
    responseMapper.map3DPaymentData.mockReturnValue({ status: 'approved' })

    await expect(pos.payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, cb(fv4()))).rejects.toThrow(
      new PosError('3D callback without 3D success was not mapped as declined'),
    )
    expectNoRequest()
  })

  // addition: F10 the mapper's success needs the signed mdStatus to equal the 3D status it reads
  it('make3DPayment: a mapper success is not trusted when the signed mdStatus differs from 3DStatus', async () => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.extractMdStatus.mockReturnValue('1')
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    responseMapper.map3DPaymentData.mockReturnValue({ status: 'declined' })
    const callback = fv4({ mdStatus: '0' })

    const result = await pos.payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, cb(callback))

    expect(result).toStrictEqual({ status: 'declined' })
    expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(callback, null, TX_TYPE.PAY_AUTH, secureOrder)
    expectNoRequest()
  })

  // addition: F15/Task 4 a provision answer without the approval code never approves, whatever the mapper says
  it.each([[{}], [{ OrderId: '33554969', TxnResult: 'Success', Amount: '1,00' }]])(
    'make3DPayment: a provision answer %j mapped as approved is OrderMismatchError order_status',
    async (provision) => {
      crypt.check3DHash.mockReturnValue(true)
      responseMapper.extractMdStatus.mockReturnValue('1')
      responseMapper.is3dAuthSuccess.mockReturnValue(true)
      const mapped = { status: 'approved', order_id: '33554969' }
      responseMapper.map3DPaymentData.mockReturnValue(mapped)
      const provisionRequest = { request: 'create3DPaymentRequestData' }
      requestMapper.create3DPaymentRequestData.mockReturnValue(provisionRequest)
      configureClientResponse(TX_TYPE.PAY_AUTH, provisionRequest, provision, secureOrder, MODEL.THREE_D_SECURE)

      const err = await pos
        .payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, cb(fv4()))
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(OrderMismatchError)
      expect((err as OrderMismatchError).field).toBe('order_status')
      expect((err as OrderMismatchError).paymentMayHaveCompleted).toBe(true)
      expect(httpClient.request).toHaveBeenCalledTimes(1)
    },
  )

  // ---- 3D Pay / 3D Host ----

  describe.each([
    ['3D Pay', MODEL.THREE_D_PAY, 'map3DPayResponseData', payOrder],
    ['3D Host', MODEL.THREE_D_HOST, 'map3DHostResponseData', hostOrder],
  ] as Array<[string, PaymentModel, 'map3DPayResponseData' | 'map3DHostResponseData', PosOrder]>)(
    '%s',
    (_label, paymentModel, mapperMethod, order) => {
      const orderId = order.id as string
      const success = (over: Data = {}): Data => fv3({ OrderId: orderId, ...over })

      // deviation: F11/F14 the hash is verified and the approved result is confirmed with one status request
      it('payment', async () => {
        const callback = success()
        crypt.check3DHash.mockReturnValue(true)
        responseMapper.extractMdStatus.mockReturnValue('1')
        responseMapper.is3dAuthSuccess.mockReturnValue(true)
        const mapped = { status: 'approved', order_id: orderId, proc_return_code: '00' }
        responseMapper[mapperMethod].mockReturnValue(mapped)
        const record = confirmingRecord(orderId)
        const verify = configureClientResponses([statusExchange(orderId, { status: 'approved', all: record })])

        const result = await pos.payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb(callback))

        expect(result).toStrictEqual({ ...mapped, auth_code: 'A12345', transaction_id: 'T1' })
        expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
        expect(crypt.check3DHash).toHaveBeenCalledWith(account, callback)
        expect(responseMapper[mapperMethod]).toHaveBeenCalledTimes(1)
        expect(responseMapper[mapperMethod]).toHaveBeenCalledWith(callback, TX_TYPE.PAY_AUTH, order)
        expect(requestMapper.createStatusRequestData).toHaveBeenCalledWith(account, { id: orderId })
        expect(responseMapper.mapStatusResponse).toHaveBeenCalledWith({ decoded: 'status' })
        verify()
      })

      // addition: F11 a present hash is always verified
      it('payment hash mismatch', async () => {
        const callback = success()
        crypt.check3DHash.mockReturnValue(false)

        await expect(pos.payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb(callback))).rejects.toThrow(
          new HashMismatchError('3D callback hash mismatch'),
        )
        expect(crypt.check3DHash).toHaveBeenCalledWith(account, callback)
        expect(responseMapper[mapperMethod]).not.toHaveBeenCalled()
        expectNoRequest()
      })

      // addition: F18 fail closed when the mapper approves a callback whose return code is not the approval
      it('a declined callback mapped as approved is rejected (PosError) without confirmation', async () => {
        crypt.check3DHash.mockReturnValue(true)
        responseMapper[mapperMethod].mockReturnValue({ status: 'approved', order_id: orderId })

        const err = await pos
          .payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb(success({ ProcReturnCode: '05', Response: '' })))
          .catch((e) => e)
        expect(err).toBeInstanceOf(PosError)
        expect((err as Error).message).toBe('3D callback without approval was mapped as approved')
        expectNoRequest()
      })

      // addition: F19 the decline reasons of an unsigned declined callback are kept as plain, bounded text
      it('an unsigned decline keeps string reasons cut to 256 characters and nulls everything else', async () => {
        const callback: Data = { ...success(), ProcReturnCode: '05' }
        delete callback.HASH
        responseMapper[mapperMethod].mockReturnValue({
          status: 'declined',
          order_id: 'FORGED',
          proc_return_code: '05',
          error_code: { code: '05' },
          error_message: 'x'.repeat(1000),
          md_status: ['1'],
          md_error_message: 'Not authenticated',
          auth_code: 'S86797',
          amount: 9999,
          currency: 'USD',
          masked_number: '4111********1111',
          requires_manual_review: true,
          all: { raw: true },
        })

        const result = (await pos.payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb(callback))) as Data

        expect(result).toStrictEqual({
          status: 'declined',
          order_id: orderId,
          payment_model: paymentModel,
          transaction_type: TX_TYPE.PAY_AUTH,
          proc_return_code: '05',
          error_code: null,
          error_message: 'x'.repeat(256),
          md_status: null,
          md_error_message: 'Not authenticated',
          auth_code: null,
          amount: null,
          currency: null,
          masked_number: null,
          all: { raw: true },
        })
        expect(crypt.check3DHash).not.toHaveBeenCalled()
        expectNoRequest()
      })

      // addition: F14 the status response decides; a declined status is an order_status mismatch
      it('a status answer that does not confirm the payment is OrderMismatchError', async () => {
        crypt.check3DHash.mockReturnValue(true)
        responseMapper.extractMdStatus.mockReturnValue('1')
        responseMapper.is3dAuthSuccess.mockReturnValue(true)
        responseMapper[mapperMethod].mockReturnValue({ status: 'approved', order_id: orderId, proc_return_code: '00' })
        configureClientResponses([statusExchange(orderId, { status: 'declined', all: confirmingRecord(orderId) })])

        const err = await pos.payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb(success())).catch((e) => e)
        expect(err).toBeInstanceOf(OrderMismatchError)
        expect((err as OrderMismatchError).field).toBe('order_status')
        expect((err as OrderMismatchError).paymentMayHaveCompleted).toBe(true)
        expect((err as OrderMismatchError).response?.requires_manual_review).toBe(true)
      })

      // addition: F14 anything but a plain record of the bank fails closed; so does a mapper approval of a record
      // without the approval code
      it.each([
        ['no record', { status: 'approved', all: null }],
        ['a list', { status: 'approved', all: [confirmingRecord(orderId)] }],
        ['no approval code', { status: 'approved', all: confirmingRecord(orderId, { ProcReturnCode: null }) }],
        ['an empty record', { status: 'approved', all: {} }],
      ])('a status answer with %s is OrderMismatchError order_status', async (_name, mapped) => {
        crypt.check3DHash.mockReturnValue(true)
        responseMapper.extractMdStatus.mockReturnValue('1')
        responseMapper.is3dAuthSuccess.mockReturnValue(true)
        responseMapper[mapperMethod].mockReturnValue({ status: 'approved', order_id: orderId, proc_return_code: '00' })
        configureClientResponses([statusExchange(orderId, mapped)])

        const err = await pos.payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb(success())).catch((e) => e)
        expect(err).toBeInstanceOf(OrderMismatchError)
        expect((err as OrderMismatchError).field).toBe('order_status')
        expect((err as OrderMismatchError).paymentMayHaveCompleted).toBe(true)
      })
    },
  )

  // ---- non-3D transactions ----

  it.each([[TX_TYPE.PAY_AUTH], [TX_TYPE.PAY_PRE_AUTH]] as Array<[TxType]>)('regular payment %s', async (txType) => {
    const order = { id: '2020110828BC' }
    const c = card()
    const requestData = { request: 'createNonSecurePaymentRequestData' }
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue(requestData)
    responseMapper.mapPaymentResponse.mockReturnValue({ result: true })
    const verify = configureClientResponse(txType, requestData, { decodedData: true }, order, MODEL.NON_SECURE)

    // deviation: Q6 the mapped response is returned (no isSuccess state)
    const result = await pos.payment(MODEL.NON_SECURE, order, txType, c)

    verify()
    expect(requestMapper.createNonSecurePaymentRequestData).toHaveBeenCalledWith(account, order, txType, c)
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith({ decodedData: true }, txType, order)
    expect(result).toStrictEqual({ result: true })
  })

  it('regular post-auth payment', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { request: 'createNonSecurePostAuthPaymentRequestData' }
    requestMapper.createNonSecurePostAuthPaymentRequestData.mockReturnValue(requestData)
    responseMapper.mapPaymentResponse.mockReturnValue({ result: true })
    const verify = configureClientResponse(
      TX_TYPE.PAY_POST_AUTH,
      requestData,
      { decodedData: true },
      order,
      MODEL.NON_SECURE,
    )

    const result = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_POST_AUTH)

    verify()
    expect(requestMapper.createNonSecurePostAuthPaymentRequestData).toHaveBeenCalledWith(account, order)
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith({ decodedData: true }, TX_TYPE.PAY_POST_AUTH, order)
    expect(result).toStrictEqual({ result: true })
  })

  it.each([
    ['status', TX_TYPE.STATUS, 'createStatusRequestData', 'mapStatusResponse'],
    ['cancel', TX_TYPE.CANCEL, 'createCancelRequestData', 'mapCancelResponse'],
    ['refund', TX_TYPE.REFUND, 'createRefundRequestData', 'mapRefundResponse'],
  ] as Array<
    ['status' | 'cancel' | 'refund', TxType, keyof RequestDataMapperInterface, keyof ResponseDataMapperInterface]
  >)('%s request', async (method, txType, requestMethod, responseMethod) => {
    const order = { id: '2020110828BC' }
    const requestData = { request: requestMethod }
    requestMapper[requestMethod].mockReturnValue(requestData)
    responseMapper[responseMethod].mockReturnValue({ result: true })
    const verify = configureClientResponse(txType, requestData, { decodedData: true }, order, MODEL.NON_SECURE)

    const result = await pos[method](order)

    verify()
    if (method === 'refund') {
      expect(requestMapper[requestMethod]).toHaveBeenCalledWith(account, order, txType)
    } else {
      expect(requestMapper[requestMethod]).toHaveBeenCalledWith(account, order)
    }
    expect(responseMapper[responseMethod]).toHaveBeenCalledWith({ decodedData: true })
    expect(result).toStrictEqual({ result: true })
  })

  it('order history request', async () => {
    // deviation: F33 UnsupportedTransactionTypeError, nothing is mapped or sent
    await expect(pos.orderHistory({})).rejects.toThrow(UnsupportedTransactionTypeError)
    expect(requestMapper.createOrderHistoryRequestData).not.toHaveBeenCalled()
    expectNoRequest()
  })
})

// ---------- end to end: real mappers, crypt and HTTP client over a fake fetch ----------

type Sent = { url: string; body: string; fields: Data }

/** A bank answer: `Key=Value` pairs joined by `;;`. */
const bankBody = (data: Data): string =>
  Object.entries(data)
    .map(([key, value]) => `${key}=${value ?? ''}`)
    .join(';;')

/** The bank's status record of an approved, open payment of `orderId` (1,01 TRY) unless overridden. */
const statusRecord = (orderId: string, over: Data = {}): Data => ({
  OrderId: orderId,
  ProcReturnCode: '00',
  BatchNo: '',
  TransId: 'T1',
  TRXDATE: '09.08.2024 10:40:34',
  TxnStat: '',
  PurchAmount: '1,01',
  VoidDate: '1.1.0001 00:00:00',
  TxnStatus: '',
  ChargeTypeCd: '',
  ErrorCode: '',
  ErrorMessage: '',
  RefundedAmount: '0',
  AuthCode: 'A12345',
  ...over,
})

type Answer = string | Response

type BankOptions = {
  /** The provision answer of a 3D Secure payment. */
  provision?: Answer
  /** The status record for the order of the request (`orgOrderId`). */
  status?: (orderId: string) => Answer
  /** The answer to a non-secure sale, post-auth, cancel or refund. */
  other?: Answer
}

/**
 * A fetch that parses each form request, records it and answers like the bank by `TxnType` and `SecureType`: a
 * NonSecure `Auth`/`PreAuth` with `MD` is the 3D provision, without `MD` a non-secure sale; `StatusHistory` is the
 * status request. Anything else fails.
 */
function bankFetch(options: BankOptions = {}) {
  const sent: Sent[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const body = await new Request('https://example.invalid', { method: 'POST', body: init?.body ?? '' }).text()
    const fields: Data = Object.fromEntries(new URLSearchParams(body))
    sent.push({ url: String(url), body, fields })
    let reply: Answer | undefined
    const payment = fields.TxnType === 'Auth' || fields.TxnType === 'PreAuth'
    if (fields.TxnType === 'StatusHistory') {
      const orderId = String(fields.orgOrderId)
      reply = options.status ? options.status(orderId) : bankBody(statusRecord(orderId))
    } else if (payment && fields.SecureType === 'NonSecure' && fields.MD !== undefined) {
      reply = options.provision ?? FULL_SUCCESS_RESPONSE
    } else if (payment && fields.SecureType === 'NonSecure') {
      reply =
        options.other ?? bankBody({ OrderId: fields.OrderId, ProcReturnCode: '00', AuthCode: 'S11111', TransId: 'T9' })
    } else if (['PostAuth', 'Void', 'Refund'].includes(String(fields.TxnType))) {
      reply = options.other ?? bankBody({ OrderId: fields.orgOrderId, ProcReturnCode: '00', TransId: 'T8' })
    }
    if (reply === undefined) {
      throw new Error(`unexpected request ${String(fields.TxnType)} ${String(fields.SecureType)}`)
    }
    if (reply instanceof Response) return reply
    return new Response(reply, { status: 200 })
  }) as unknown as typeof fetch

  return { sent, fetchImpl }
}

function realGateway(
  fetchImpl: typeof fetch,
  options: { cfg?: GatewayConfig; logger?: PosLogger; hooks?: PosHooks } = {},
) {
  const log = options.logger ?? createLogger()
  const cryptImpl = new InterPosCrypt(log)
  const valueMapper = new InterPosRequestValueMapper()
  const valueFormatter = new InterPosRequestValueFormatter()
  const hooks = options.hooks ?? {}
  const transport = new HttpTransport({ fetch: fetchImpl })
  const deps: GatewayDeps<InterPosAccount> = {
    requestValueMapper: valueMapper,
    requestValueFormatter: valueFormatter,
    requestDataMapper: new InterPosRequestDataMapper(valueMapper, valueFormatter, hooks, cryptImpl),
    responseDataMapper: new InterPosResponseDataMapper(
      new InterPosResponseValueFormatter(),
      new InterPosResponseValueMapper(),
      log,
    ),
    crypt: cryptImpl,
    clientStrategy: new HttpClientStrategy([new InterPosHttpClient(PAYMENT_API, transport, log)]),
    logger: log,
    hooks,
  }

  return new InterPos(options.cfg ?? config, D, deps)
}

const mismatch = async (promise: Promise<unknown>): Promise<OrderMismatchError> => {
  const err = await promise.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(OrderMismatchError)
  return err as OrderMismatchError
}

/** Signed decline fields in shapes the approval formats would refuse; a decline is mapped as it came. */
const FREE_FORM_DECLINES: Array<[string, Data]> = [
  ['a Response with punctuation', { Response: 'Red - Limit yetersiz' }],
  ['a Turkish Response', { Response: 'İşlem reddedildi' }],
  ['a letter-and-digit return code', { ProcReturnCode: 'M041' }],
  ['a one-digit return code', { ProcReturnCode: '5' }],
  ['a Version', { Version: '1.0' }],
  ['an mdStatus of two digits', { mdStatus: '11', '3DStatus': '11' }],
]

const MALFORMED = new HashMismatchError('3D callback fields are malformed')
const NO_HASH = new HashMismatchError('3D callback has no HASH')
const HASH_MISMATCH = new HashMismatchError('3D callback hash mismatch')

describe('InterPos (end to end) 3D Secure', () => {
  const run = (callback: Data, order: PosOrder = secureOrder, options: BankOptions = {}, cfg = config) => {
    const { sent, fetchImpl } = bankFetch(options)
    const promise = realGateway(fetchImpl, { cfg }).payment(
      MODEL.THREE_D_SECURE,
      order,
      TX_TYPE.PAY_AUTH,
      null,
      cb(callback),
    )
    return { sent, promise }
  }

  // addition: F16 one provision request built from the order and the signed callback, bound by F15
  it('provisions a signed successful callback with one request', async () => {
    const { sent, promise } = run(fv4())
    const res = (await promise) as Data

    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(PAYMENT_API)
    expect(sent[0]?.fields).toStrictEqual({
      UserCode: 'InterTestApi',
      UserPass: '3',
      ShopCode: '3123',
      TxnType: 'Auth',
      SecureType: 'NonSecure',
      OrderId: '33554969',
      PurchAmount: '1',
      Currency: '949',
      InstallmentCount: '',
      MD: 'MDVALUE123',
      PayerTxnId: '',
      Eci: '02',
      PayerAuthenticationCode: 'AAAB',
      MOTO: '0',
      Lang: 'tr',
    })
    expect(res.status).toBe('approved')
    expect(res.order_id).toBe('33554969')
    expect(res.auth_code).toBe('gizlendi')
    expect(res.transaction_time).toStrictEqual(new Date('2024-08-09T10:40:34+03:00'))
    expect(res.md_status).toBe('1')
    expect(res.transaction_security).toBe('Full 3D Secure')
  })

  // addition: F7/F11 refusals before any request
  it.each([
    ['an altered hash', { ...fv4(), HASH: '5SLRmgQgs9TDGlbof+TVUbsk5fE=' }, HASH_MISMATCH],
    ['a signed field changed under the genuine hash', { ...fv4(), PurchAmount: '2' }, HASH_MISMATCH],
    ['the FP3 field-list substitution', fp3(), HASH_MISMATCH],
    ['a field list without the trailing colon', { ...fv4(), HASHPARAMS: HP.slice(0, -1) }, HASH_MISMATCH],
    ['a numeric amount', { ...fv4(), PurchAmount: 1 }, HASH_MISMATCH],
    ['no HASH', (({ HASH: _h, ...rest }) => rest)(fv4()), NO_HASH],
    ['an empty HASH', { ...fv4(), HASH: '' }, NO_HASH],
  ])('rejects %s (HashMismatchError, nothing sent)', async (_name, callback, error) => {
    const { sent, promise } = run(callback)
    await expect(promise).rejects.toThrow(error)
    expect(sent).toHaveLength(0)
  })

  // addition: F10 the unsigned 3DStatus alone never makes a callback 3D-successful
  it.each([
    ['3DStatus 0 with the signed mdStatus 1', fv4({ '3DStatus': '0' })],
    ['3DStatus 1 with the signed mdStatus 0', fv4({ mdStatus: '0' })],
    ['3DStatus 1 with the signed mdStatus 9', fv4({ mdStatus: '9' })],
    ['no 3DStatus', (({ '3DStatus': _s, ...rest }) => resign(rest))(fv4())],
  ])('%s takes the declined path without a request', async (_name, callback) => {
    const { sent, promise } = run(callback)
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(sent).toHaveLength(0)
  })

  // addition: F16 an approved 3D Pay callback posted to a 3D Secure order is a model swap; the result (and
  // paymentMayHaveCompleted) is attached only when one status request shows the payment of the order
  it('FV3 posted to make3DPayment is OrderMismatchError payment_model with the result attached', async () => {
    const { sent, promise } = run(fv3(), payOrder)
    const err = await mismatch(promise)
    expect(err.field).toBe('payment_model')
    expect(err.expected).toBe('3d')
    expect(err.actual).toBe('3d_pay')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.status).toBe('approved')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.fields.TxnType).toBe('StatusHistory')
    expect(sent[0]?.fields.orgOrderId).toBe('20221225B83B')
  })

  // addition: review fix, the model swap needs bank evidence before it reports that money may have moved
  it.each([
    ['FV3 for its order, a record that does not confirm', fv3(), payOrder, ['81', '']],
    ['FP1 re-read for order 12, a declined record', fp1ReRead(), { id: '12', amount: 1.01 }, ['81', '']],
  ] as Array<[string, Data, PosOrder, [string, string]]>)(
    '%s: payment_model without the result attached',
    async (_name, callback, order, [code, authCode]) => {
      const { sent, promise } = run(callback, order, {
        status: (id) => bankBody(statusRecord(id, { ProcReturnCode: code, AuthCode: authCode })),
      })
      const err = await mismatch(promise)
      expect(err.field).toBe('payment_model')
      expect(err.paymentMayHaveCompleted).toBe(false)
      expect(err.response).toBeUndefined()
      expect(sent).toHaveLength(1)
    },
  )

  // addition: review fix, the order binding runs before the model check: an approval of another order is an order
  // mismatch without the result attached and without any request
  it.each([
    ['FV3 for an unrelated order', fv3(), { id: 'X9', amount: 50, currency: CURRENCY.USD }, 'order_id'],
    ['FV3 for an order of another amount', fv3(), { id: '20221225B83B', amount: 50 }, 'amount'],
    [
      'FP1 re-read for order 12 of another currency',
      fp1ReRead(),
      { id: '12', amount: 1.01, currency: CURRENCY.USD },
      'currency',
    ],
    ['FP4 for an unrelated order', fp4(), { id: 'X9', amount: 1.01 }, 'order_id'],
  ] as Array<[string, Data, PosOrder, string]>)(
    '%s is an order mismatch, nothing sent',
    async (_n, callback, order, field) => {
      const { sent, promise } = run(callback, order)
      const err = await mismatch(promise)
      expect(err.field).toBe(field)
      expect(err.paymentMayHaveCompleted).toBe(false)
      expect(err.response).toBeUndefined()
      expect(sent).toHaveLength(0)
    },
  )

  // addition: review fix, a signed approval with a failed 3D status posted to a 3D Secure order (the bank charged)
  it('FP4 posted to make3DPayment: a confirming record gives declined with manual review', async () => {
    const { sent, promise } = run({ ...fp4(), AuthCode: 'FORGED', TransId: 'FORGED' }, payOrder)
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.requires_manual_review).toBe(true)
    expect(res.payment_model).toBe('3d')
    expect(res.proc_return_code).toBeNull()
    expect(res.auth_code).toBe('A12345')
    expect(res.transaction_id).toBe('T1')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.fields.TxnType).toBe('StatusHistory')
  })

  it('FP4 posted to make3DPayment: a record that does not confirm gives a plain decline', async () => {
    const { sent, promise } = run({ ...fp4(), AuthCode: 'FORGED', TransId: 'FORGED' }, payOrder, {
      status: (id) => bankBody(statusRecord(id, { ProcReturnCode: '81', AuthCode: '' })),
    })
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.requires_manual_review).toBeUndefined()
    expect(res.proc_return_code).toBeNull()
    expect(res.auth_code).toBeNull()
    expect(res.transaction_id).toBeNull()
    expect(sent).toHaveLength(1)
  })

  it.each([
    ['Version x', { Version: 'x' }],
    ['Currency 94', { Currency: '94' }],
    ['Response with a digit', { Response: 'Approved5' }],
  ])('FP4 with %s posted to make3DPayment is malformed, nothing sent', async (_name, change) => {
    const { sent, promise } = run(fv3({ mdStatus: '0', '3DStatus': '0', ...change }), payOrder)
    await expect(promise).rejects.toThrow(MALFORMED)
    expect(sent).toHaveLength(0)
  })

  // addition: F9 pins on a 3D success (each recomputed as the bank would sign it)
  it.each([
    ['ProcReturnCode 81', { ProcReturnCode: '81' }],
    ['ProcReturnCode 0', { ProcReturnCode: '0' }],
    ['Version x', { Version: 'x' }],
    ['Exponent 2', { Exponent: '2' }],
    ['OkUrl ftp://x', { OkUrl: 'ftp://x' }],
    ['FailUrl empty', { FailUrl: '' }],
    ['Currency 94', { Currency: '94' }],
    ['Currency missing', { Currency: undefined }],
    ['PurchAmount 1.01', { PurchAmount: '1.01' }],
    ['PurchAmount 1,019', { PurchAmount: '1,019' }],
    ['Response with a digit', { Response: 'A1' }],
    ['OrderId with a space', { OrderId: '3355 4969' }],
  ])('rejects a signed success callback with %s (malformed, nothing sent)', async (_name, change) => {
    const { sent, promise } = run(fv4(change))
    await expect(promise).rejects.toThrow(MALFORMED)
    expect(sent).toHaveLength(0)
  })

  // addition: F12 the signed order id, amount and currency and the shop code are bound before any request
  it.each([
    ['order_id', fv4({ OrderId: '33554970' })],
    ['amount', fv4({ PurchAmount: '2' })],
    ['currency', fv4({ Currency: '840' })],
    ['merchant_id', fv4({ ShopCode: '9999' })],
  ])('OrderMismatchError %s before any request', async (field, callback) => {
    const { sent, promise } = run(callback)
    const err = await mismatch(promise)
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(false)
    expect(err.response).toBeUndefined()
    expect(sent).toHaveLength(0)
  })

  // addition: F20 the unsigned authentication values that reach the provision are pinned
  it.each([
    ['Eci 7x', { Eci: '7x' }],
    ['Eci 123', { Eci: '123' }],
    ['PayerAuthenticationCode with a space', { PayerAuthenticationCode: 'a b' }],
    ['PayerAuthenticationCode with a form separator', { PayerAuthenticationCode: 'AAAB&UserPass=x' }],
    ['PayerTxnId with a form separator', { PayerTxnId: 'x&Currency=840' }],
    ['PayerTxnId too long', { PayerTxnId: 'A'.repeat(129) }],
    ['no Eci', { Eci: undefined }],
    ['no PayerAuthenticationCode', { PayerAuthenticationCode: undefined }],
    ['MD too long', { MD: 'M'.repeat(1025) }],
    ['MD empty', { MD: '' }],
  ])('rejects %s (PosError, nothing sent)', async (_name, change) => {
    const callback = fv4(change)
    const { sent, promise } = run(callback)
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect(err).not.toBeInstanceOf(HashMismatchError)
    expect((err as Error).message).toBe('3D callback authentication values are malformed')
    expect(sent).toHaveLength(0)
  })

  // addition: F16 a callback is a flat record of strings
  it.each([
    ['MD', ['x']],
    ['MD', { a: 1 }],
    ['HASH', ['x']],
    ['OrderId', ['33554969']],
  ])('rejects a non-string %s before the crypt (PosError)', async (key, value) => {
    const { sent, promise } = run({ ...fv4(), [key]: value })
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect(err).not.toBeInstanceOf(HashMismatchError)
    expect((err as Error).message).toBe(`3D callback field "${key}" must be a string`)
    expect(sent).toHaveLength(0)
  })

  // addition: F15 the provision answer
  it('a declined provision is returned declined', async () => {
    const { sent, promise } = run(fv4(), secureOrder, {
      provision: bankBody({ ...FULL_SUCCESS_RECORD, ProcReturnCode: '81', ErrorMessage: 'Red' }),
    })
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.proc_return_code).toBe('81')
    expect(sent).toHaveLength(1)
  })

  it.each([
    ['order_id', { OrderId: '99' }],
    ['amount', { Amount: '2,00' }],
    ['amount', { Amount: '1.00' }],
  ])('an approved provision of another %s is OrderMismatchError with the result attached', async (field, change) => {
    const { sent, promise } = run(fv4(), secureOrder, { provision: bankBody({ ...FULL_SUCCESS_RECORD, ...change }) })
    const err = await mismatch(promise)
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
    expect(sent).toHaveLength(1)
  })

  // addition: Task 4 an answer without the approval code never approves
  it.each([
    ['HTTP 204', new Response(null, { status: 204 })],
    ['a record without ProcReturnCode', bankBody({ OrderId: '33554969', TxnResult: 'Success', Amount: '1,00' })],
  ])('a provision answered with %s is declined', async (_name, provision) => {
    const { sent, promise } = run(fv4(), secureOrder, { provision })
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(sent).toHaveLength(1)
  })

  it.each([
    ['HTTP 500', new Response('error', { status: 500 })],
    ['a 200 HTML page', new Response('<html lang="tr">Request Rejected</html>', { status: 200 })],
  ])('a provision answered with %s is PosHttpError', async (_name, provision) => {
    const { sent, promise } = run(fv4(), secureOrder, { provision })
    await expect(promise).rejects.toThrow(PosHttpError)
    expect(sent).toHaveLength(1)
  })

  // addition: F11 declines
  it('maps the signed authFail1 decline declined without a request', async () => {
    const callback = secureAuthFail()
    const { sent, promise } = run(callback, { id: '20221225E1DF', amount: 1.01 })
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.md_status).toBe('0')
    expect(res.order_id).toBe('20221225E1DF')
    expect(sent).toHaveLength(0)
  })

  it('rejects the authFail1 decline with an altered hash', async () => {
    const { sent, promise } = run({ ...secureAuthFail(), HASH: '523AWRAXl0VlEbQjpmAfntT5e3E=' })
    await expect(promise).rejects.toThrow(HASH_MISMATCH)
    expect(sent).toHaveLength(0)
  })

  it('maps an unsigned decline from the order only; require_3d_hash rejects it', async () => {
    const { HASH: _removed, ...callback } = secureAuthFail()
    const order = { id: 'ORDER-1', amount: 7 }
    const { sent, promise } = run(callback, order)
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.order_id).toBe('ORDER-1')
    expect(res.payment_model).toBe('3d')
    expect(res.masked_number).toBeNull()
    expect(res.amount).toBeNull()
    expect(res.currency).toBeNull()
    expect(res.transaction_security).toBeNull()
    expect(res.error_message).toBe('Terminal Aktif Degil')
    expect(res.proc_return_code).toBe('81')
    expect(res.requires_manual_review).toBeUndefined()

    const strict = run(callback, order, {}, { ...config, require_3d_hash: true })
    await expect(strict.promise).rejects.toThrow(NO_HASH)
    expect(sent).toHaveLength(0)
    expect(strict.sent).toHaveLength(0)
  })

  // addition: Task 1 carry re-splits that the crypt accepts (a null field signs as empty): a re-split decline stays
  // a decline (nothing sent, no review flag), a re-split success is malformed
  it.each([
    ['decline: amount merged with a null currency', { ...secureAuthFail(), PurchAmount: '1,01949', Currency: null }],
    [
      'decline: order id shifted into the return code',
      { ...secureAuthFail(), OrderId: '20221225E1DF8', ProcReturnCode: '1' },
    ],
  ] as Array<[string, Data]>)('%s (declined, nothing sent, no review flag)', async (_name, callback) => {
    expect(sign(callback)).toBe(callback.HASH)
    const { sent, promise } = run(callback)
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.requires_manual_review).toBeUndefined()
    expect(sent).toHaveLength(0)
  })

  it.each([
    ['success: amount merged with a null currency', { ...fv4(), PurchAmount: '1949', Currency: null }],
    ['success: MD merged into a null order id', { ...fv4(), MD: 'MDVALUE12333554969', OrderId: null }],
  ] as Array<[string, Data]>)('%s (malformed, nothing sent)', async (_name, callback) => {
    expect(sign(callback)).toBe(callback.HASH)
    const { sent, promise } = run(callback)
    await expect(promise).rejects.toThrow(MALFORMED)
    expect(sent).toHaveLength(0)
  })

  // addition: review ruling, signed declines are mapped as they came: the bank's decline texts and codes are free form
  it.each(FREE_FORM_DECLINES)(
    'a signed decline with %s is declined (nothing sent, no review flag)',
    async (_n, change) => {
      const { sent, promise } = run(fv4({ ProcReturnCode: '05', mdStatus: '0', '3DStatus': '0', ...change }))
      const res = (await promise) as Data
      expect(res.status).toBe('declined')
      expect(res.requires_manual_review).toBeUndefined()
      expect(sent).toHaveLength(0)
    },
  )

  // addition: F11 disable_3d_hash_check changes nothing
  it('disable_3d_hash_check does not disable the check', async () => {
    const { sent, promise } = run(
      { ...fv4(), HASH: '5SLRmgQgs9TDGlbof+TVUbsk5fE=' },
      secureOrder,
      {},
      configWithHashCheckDisabled,
    )
    await expect(promise).rejects.toThrow(HASH_MISMATCH)
    expect(sent).toHaveLength(0)
  })
})

describe('InterPos (end to end) 3D Pay and 3D Host', () => {
  const run = (
    model: typeof MODEL.THREE_D_PAY | typeof MODEL.THREE_D_HOST,
    callback: Data,
    order: PosOrder,
    options: BankOptions = {},
    cfg = config,
  ) => {
    const { sent, fetchImpl } = bankFetch(options)
    const promise = realGateway(fetchImpl, { cfg }).payment(model, order, TX_TYPE.PAY_AUTH, null, cb(callback))
    return { sent, promise }
  }

  describe.each([
    ['3D Pay', MODEL.THREE_D_PAY, payOrder],
    ['3D Host', MODEL.THREE_D_HOST, hostOrder],
  ] as Array<[string, typeof MODEL.THREE_D_PAY | typeof MODEL.THREE_D_HOST, PosOrder]>)(
    '%s',
    (_label, model, order) => {
      const orderId = order.id as string
      const approved = (over: Data = {}): Data => fv3({ OrderId: orderId, ...over })

      // addition: F14 one status request confirms the approval; references come from the bank record
      it('confirms an approved callback with one status request', async () => {
        const { sent, promise } = run(model, { ...approved(), AuthCode: 'FORGED', TransId: 'FORGED' }, order)
        const res = (await promise) as Data
        expect(sent).toHaveLength(1)
        expect(sent[0]?.fields.TxnType).toBe('StatusHistory')
        expect(sent[0]?.fields.SecureType).toBe('NonSecure')
        expect(sent[0]?.fields.orgOrderId).toBe(orderId)
        expect(sent[0]?.fields.UserCode).toBe('InterTestApi')
        expect(sent[0]?.fields).not.toHaveProperty('OrderId')
        expect(res.status).toBe('approved')
        expect(res.order_id).toBe(orderId)
        expect(res.payment_model).toBe(model)
        expect(res.auth_code).toBe('A12345')
        expect(res.transaction_id).toBe('T1')
      })

      it('confirms an approval whose record reports the transaction result Success', async () => {
        const { sent, promise } = run(model, approved(), order, {
          status: (id) => bankBody(statusRecord(id, { TxnResult: 'Success' })),
        })
        expect(((await promise) as Data).status).toBe('approved')
        expect(sent).toHaveLength(1)
      })

      it('confirms a half 3D approval', async () => {
        const { sent, promise } = run(model, approved({ mdStatus: '2', '3DStatus': '2' }), order)
        const res = (await promise) as Data
        expect(res.status).toBe('approved')
        expect(res.transaction_security).toBe('Half 3D Secure')
        expect(sent).toHaveLength(1)
      })

      it('maps a signed decline (FV5 shape) declined without a request', async () => {
        const { sent, promise } = run(
          model,
          approved({ ProcReturnCode: '81', Response: '', mdStatus: '0', '3DStatus': '0' }),
          order,
        )
        const res = (await promise) as Data
        expect(res.status).toBe('declined')
        expect(res.proc_return_code).toBe('81')
        expect(sent).toHaveLength(0)
      })

      // addition: F11 an approved callback without HASH is never accepted
      it('rejects an approved callback without HASH, also when 3DStatus says success', async () => {
        const { HASH: _removed, ...callback } = approved()
        const { sent, promise } = run(model, callback, order)
        await expect(promise).rejects.toThrow(NO_HASH)
        expect(sent).toHaveLength(0)
      })

      it('rejects an altered hash and a substituted field list', async () => {
        const altered = run(model, { ...approved(), HASH: 'B9+zYc4QLhaEi0jFT1mFVwQjmGA=' }, order)
        await expect(altered.promise).rejects.toThrow(HASH_MISMATCH)
        const reordered = run(
          model,
          { ...approved(), HASHPARAMS: `PurchAmount:Version:${HP.slice('Version:PurchAmount:'.length)}` },
          order,
        )
        await expect(reordered.promise).rejects.toThrow(HASH_MISMATCH)
        const duplicated = run(model, { ...approved(), HASHPARAMS: `${HP}mdStatus:` }, order)
        await expect(duplicated.promise).rejects.toThrow(HASH_MISMATCH)
        const substituted = run(model, fp3(), order)
        await expect(substituted.promise).rejects.toThrow(HASH_MISMATCH)
        expect([...altered.sent, ...reordered.sent, ...duplicated.sent, ...substituted.sent]).toHaveLength(0)
      })

      // addition: F12 the signed echoes are bound with the result attached (the bank may have charged)
      it.each([
        ['order_id', () => fv3({ OrderId: `${orderId.slice(0, -1)}X` })],
        ['currency', () => approved({ Currency: '840' })],
        ['amount', () => approved({ PurchAmount: '2,00' })],
        ['merchant_id', () => approved({ ShopCode: '9999' })],
      ])('OrderMismatchError %s with paymentMayHaveCompleted, nothing sent', async (field, build) => {
        const { sent, promise } = run(model, build(), order)
        const err = await mismatch(promise)
        expect(err.field).toBe(field)
        expect(err.paymentMayHaveCompleted).toBe(true)
        expect(err.response?.requires_manual_review).toBe(true)
        expect(sent).toHaveLength(0)
      })

      // addition: F14 the record must hold an approved, open payment of this order and amount
      it.each([
        ['amount', { PurchAmount: '2,00' }],
        ['amount', { PurchAmount: '1.01' }],
        ['amount', { PurchAmount: '' }],
        ['order_status', { VoidDate: '10.08.2024 10:00:00' }],
        ['order_status', { VoidDate: 'not a date' }],
        ['order_status', { RefundedAmount: '1,01' }],
        ['order_status', { RefundedAmount: 'x' }],
        ['order_id', { OrderId: 'x' }],
        ['order_status', { AuthCode: '' }],
        ['order_status', { AuthCode: 'A B' }],
        ['order_status', { ProcReturnCode: '81' }],
        // addition: review ruling, a transaction result other than Success is no approval
        ['order_status', { TxnResult: 'Failed' }],
        ['order_status', { TxnResult: '' }],
        ['order_status', { TxnResult: 'success' }],
      ])('a confirmation failure on %s %j is OrderMismatchError with manual review', async (field, change) => {
        const { sent, promise } = run(model, approved(), order, {
          status: (id) => bankBody(statusRecord(id, change)),
        })
        const err = await mismatch(promise)
        expect(err.field).toBe(field)
        expect(err.paymentMayHaveCompleted).toBe(true)
        expect(err.response?.requires_manual_review).toBe(true)
        expect(sent).toHaveLength(1)
      })

      // addition: Task 4 a status answer without the approval code never confirms
      it.each([
        ['HTTP 204', () => new Response(null, { status: 204 })],
        [
          'a record without ProcReturnCode',
          (id: string) => bankBody({ OrderId: id, TxnResult: 'Success', AuthCode: 'A1', PurchAmount: '1,01' }),
        ],
      ])('a status answer with %s is OrderMismatchError order_status', async (_name, status) => {
        const { sent, promise } = run(model, approved(), order, { status })
        const err = await mismatch(promise)
        expect(err.field).toBe('order_status')
        expect(err.paymentMayHaveCompleted).toBe(true)
        expect(sent).toHaveLength(1)
      })

      it.each([
        ['HTTP 500', new Response('error', { status: 500 })],
        ['a 200 HTML page', new Response('<html lang="tr">Request Rejected</html>', { status: 200 })],
      ])('a status request answered with %s is PosHttpError', async (_name, answer) => {
        const { sent, promise } = run(model, approved(), order, { status: () => answer })
        await expect(promise).rejects.toThrow(PosHttpError)
        expect(sent).toHaveLength(1)
      })

      // addition: F13 approved although the 3D authentication failed
      it.each([
        ['mdStatus 0 (FP4 shape)', { mdStatus: '0', '3DStatus': '0' }],
        ['the unsigned 3DStatus 1 with the signed mdStatus 0', { mdStatus: '0', '3DStatus': '1' }],
      ])('%s: a confirming record gives declined with manual review', async (_name, change) => {
        const { sent, promise } = run(model, { ...approved(change), AuthCode: 'FORGED', TransId: 'FORGED' }, order)
        const res = (await promise) as Data
        expect(res.status).toBe('declined')
        expect(res.requires_manual_review).toBe(true)
        // addition: review fix, no approval code and the references of the bank record, never the callback's
        expect(res.proc_return_code).toBeNull()
        expect(res.auth_code).toBe('A12345')
        expect(res.transaction_id).toBe('T1')
        expect(sent).toHaveLength(1)
      })

      it('approved without 3D success and a record that does not confirm is a plain decline', async () => {
        const callback = { ...approved({ mdStatus: '0', '3DStatus': '0' }), AuthCode: 'FORGED', TransId: 'FORGED' }
        const { sent, promise } = run(model, callback, order, {
          status: (id) => bankBody(statusRecord(id, { ProcReturnCode: '81', AuthCode: '' })),
        })
        const res = (await promise) as Data
        expect(res.status).toBe('declined')
        expect(res.requires_manual_review).toBeUndefined()
        expect(res.proc_return_code).toBeNull()
        expect(res.auth_code).toBeNull()
        expect(res.transaction_id).toBeNull()
        expect(sent).toHaveLength(1)
      })

      // addition: F16 a 3D Secure shaped callback posted to a hosted order is declined
      it('a 3D Secure shaped callback (FV4) is declined without a request', async () => {
        const { sent, promise } = run(model, fv4({ OrderId: orderId, PurchAmount: '1,01' }), order)
        const res = (await promise) as Data
        expect(res.status).toBe('declined')
        expect(sent).toHaveLength(0)
      })

      // addition: F9 pins on an approved callback
      it.each([
        ['Version x', { Version: 'x' }],
        ['Exponent 2', { Exponent: '2' }],
        ['OkUrl ftp://x', { OkUrl: 'ftp://x' }],
        ['Currency 94', { Currency: '94' }],
        ['PurchAmount 1.01', { PurchAmount: '1.01' }],
        ['Response with a digit', { Response: 'Approved5' }],
        ['mdStatus missing', { mdStatus: undefined }],
        ['mdStatus of two digits', { mdStatus: '11', '3DStatus': '11' }],
      ])('rejects an approved callback with %s (malformed, nothing sent)', async (_name, change) => {
        const { sent, promise } = run(model, approved(change), order)
        await expect(promise).rejects.toThrow(MALFORMED)
        expect(sent).toHaveLength(0)
      })
    },
  )

  // addition: FP2 a decline re-read as an approval of another order keeps the hash but breaks the Response pin
  it('FP2 is malformed without a request', async () => {
    const { sent, promise } = run(MODEL.THREE_D_PAY, fp2ReRead(), { id: '12', amount: 1.01 })
    await expect(promise).rejects.toThrow(MALFORMED)
    expect(sent).toHaveLength(0)
  })

  // addition: FP1 passes every pin; only the bank's record can tell
  it('FP1 re-read as order 12 is OrderMismatchError order_status after one status request', async () => {
    const { sent, promise } = run(
      MODEL.THREE_D_PAY,
      fp1ReRead(),
      { id: '12', amount: 1.01 },
      { status: (id) => bankBody({ ProcReturnCode: '81', OrderId: id, AuthCode: '', PurchAmount: '0' }) },
    )
    const err = await mismatch(promise)
    expect(err.field).toBe('order_status')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.fields.orgOrderId).toBe('12')
  })

  it('FP1 genuine (order 1200, no return code) is declined without a request', async () => {
    const { sent, promise } = run(MODEL.THREE_D_PAY, fp1Genuine(), { id: '1200', amount: 1.01 })
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(sent).toHaveLength(0)
  })

  // addition: FP5/FP6/FP7 genuine hashes of other orders, currencies and amounts
  it.each([
    ['order_id', fv3({ OrderId: '20221225B83C' })],
    ['currency', fv3({ Currency: '840' })],
    ['amount', fv3({ PurchAmount: '2,00' })],
  ])('FP OrderMismatchError %s for order 20221225B83B', async (field, callback) => {
    const { sent, promise } = run(MODEL.THREE_D_PAY, callback, payOrder)
    const err = await mismatch(promise)
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(sent).toHaveLength(0)
  })

  // addition: F11 declines of the reference fixtures and unsigned declines
  it('maps the signed 3D Pay authFail1 decline declined without a request', async () => {
    const { sent, promise } = run(MODEL.THREE_D_PAY, payAuthFail(), payOrder)
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.md_status).toBe('0')
    expect(sent).toHaveLength(0)
  })

  it('maps an unsigned decline from the order only, whatever the callback says; require_3d_hash rejects it', async () => {
    const { HASH: _removed, ...callback } = payAuthFail()
    const order = { id: 'ORDER-2', amount: 5, currency: CURRENCY.USD }
    const { sent, promise } = run(MODEL.THREE_D_HOST, callback, order)
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.order_id).toBe('ORDER-2')
    expect(res.payment_model).toBe('3d_host')
    expect(res.amount).toBeNull()
    expect(res.currency).toBeNull()
    expect(res.masked_number).toBeNull()
    expect(res.transaction_security).toBeNull()
    expect(res.md_status).toBe('0')
    expect(res.error_message).toBe('Terminal Aktif Degil')
    expect(res.requires_manual_review).toBeUndefined()

    const strict = run(MODEL.THREE_D_HOST, callback, order, {}, { ...config, require_3d_hash: true })
    await expect(strict.promise).rejects.toThrow(NO_HASH)
    expect(sent).toHaveLength(0)
    expect(strict.sent).toHaveLength(0)
  })

  // addition: an unsigned callback the mapper approves (whatever its return code says) is never accepted
  it('an unsigned callback with ProcReturnCode 00 and a failed 3D status is rejected', async () => {
    const { HASH: _removed, ...callback } = fp4()
    const { sent, promise } = run(MODEL.THREE_D_PAY, callback, payOrder)
    await expect(promise).rejects.toThrow(NO_HASH)
    expect(sent).toHaveLength(0)
  })

  // addition: Task 1 carry re-splits that the crypt accepts (a null field signs as empty): a re-split that no longer
  // reads as an approval is a decline (nothing sent, no review flag), a re-split approval is malformed
  it.each([
    ['approval: order id shifted into the return code', { ...fv3(), OrderId: '20221225B83B0', ProcReturnCode: '0' }],
    ['decline: amount merged with a null currency', { ...payAuthFail(), PurchAmount: '1,01949', Currency: null }],
    [
      'decline: order id shifted into the return code',
      { ...payAuthFail(), OrderId: '20221225B83B8', ProcReturnCode: '1' },
    ],
  ] as Array<[string, Data]>)('%s (declined, nothing sent, no review flag)', async (_name, callback) => {
    expect(sign(callback)).toBe(callback.HASH)
    const { sent, promise } = run(MODEL.THREE_D_PAY, callback, payOrder)
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.requires_manual_review).toBeUndefined()
    expect(sent).toHaveLength(0)
  })

  it('approval: amount merged with a null currency (malformed, nothing sent)', async () => {
    const callback: Data = { ...fv3(), PurchAmount: '1,01949', Currency: null }
    expect(sign(callback)).toBe(callback.HASH)
    const { sent, promise } = run(MODEL.THREE_D_PAY, callback, payOrder)
    await expect(promise).rejects.toThrow(MALFORMED)
    expect(sent).toHaveLength(0)
  })

  // addition: review ruling, signed declines are mapped as they came: the bank's decline texts and codes are free form
  it.each(FREE_FORM_DECLINES)(
    'a signed decline with %s is declined (nothing sent, no review flag)',
    async (_n, change) => {
      for (const model of [MODEL.THREE_D_PAY, MODEL.THREE_D_HOST] as const) {
        const { sent, promise } = run(
          model,
          fv3({ ProcReturnCode: '05', Response: '', mdStatus: '0', '3DStatus': '0', ...change }),
          payOrder,
        )
        const res = (await promise) as Data
        expect(res.status).toBe('declined')
        expect(res.requires_manual_review).toBeUndefined()
        expect(sent).toHaveLength(0)
      }
    },
  )

  // addition: F7 hostile callback shapes through the hosted flow
  it('a numeric signed value fails the hash, a nested one is refused before the crypt', async () => {
    const numeric = run(MODEL.THREE_D_PAY, { ...fv3(), PurchAmount: 101 }, payOrder)
    await expect(numeric.promise).rejects.toThrow(HASH_MISMATCH)
    const nested = run(MODEL.THREE_D_PAY, { ...fv3(), MD: { a: 1 } }, payOrder)
    await expect(nested.promise).rejects.toThrow(new PosError('3D callback field "MD" must be a string'))
    expect([...numeric.sent, ...nested.sent]).toHaveLength(0)
  })

  it('a callback key named with the empty string is never read', async () => {
    const { sent, promise } = run(MODEL.THREE_D_PAY, { ...fv3(), '': 'zzz' }, payOrder)
    expect(((await promise) as Data).status).toBe('approved')
    expect(sent).toHaveLength(1)
  })

  // addition: F11 disable_3d_hash_check changes nothing
  it('disable_3d_hash_check does not disable the check', async () => {
    const { sent, promise } = run(
      MODEL.THREE_D_PAY,
      { ...fv3(), HASH: 'B9+zYc4QLhaEi0jFT1mFVwQjmGA=' },
      payOrder,
      {},
      configWithHashCheckDisabled,
    )
    await expect(promise).rejects.toThrow(HASH_MISMATCH)
    expect(sent).toHaveLength(0)
  })

  // addition: concurrent payments on one gateway never share state
  it('two concurrent payments confirm their own orders', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    const otherOrder = { id: '20221225B83C', amount: 1.01, currency: CURRENCY.TRY }
    const [a, b] = (await Promise.all([
      p.payment(MODEL.THREE_D_PAY, payOrder, TX_TYPE.PAY_AUTH, null, cb(fv3())),
      p.payment(MODEL.THREE_D_PAY, otherOrder, TX_TYPE.PAY_AUTH, null, cb(fv3({ OrderId: '20221225B83C' }))),
    ])) as [Data, Data]
    expect(a.order_id).toBe('20221225B83B')
    expect(b.order_id).toBe('20221225B83C')
    expect(a.status).toBe('approved')
    expect(b.status).toBe('approved')
    expect(sent.map((s) => s.fields.orgOrderId).sort()).toStrictEqual(['20221225B83B', '20221225B83C'])
  })
})

describe('InterPos (end to end) non-3D transactions', () => {
  const c = (p: InterPos) =>
    CreditCardFactory.createForGateway(p, '5555444433332222', '21', '12', '122', 'ahmet', CARD_TYPE.VISA)

  it('a non-secure sale is approved on ProcReturnCode 00', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    const res = (await p.payment(MODEL.NON_SECURE, { id: 'N1', amount: 1.01 }, TX_TYPE.PAY_AUTH, c(p))) as Data
    expect(res.status).toBe('approved')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.fields.Pan).toBe('5555444433332222')
  })

  // addition: Task 4 an empty or codeless answer never approves a non-secure sale, post-auth, cancel or refund
  it.each([
    ['HTTP 204', () => new Response(null, { status: 204 })],
    ['a record without ProcReturnCode', () => bankBody({ OrderId: 'N1', TxnResult: 'Success', AuthCode: 'A1' })],
  ])('%s never approves', async (_name, answer) => {
    const order = { id: 'N1', amount: 1.01 }
    const results: Data[] = []
    for (const action of [
      (p: InterPos) => p.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, c(p)),
      (p: InterPos) => p.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_PRE_AUTH, c(p)),
      (p: InterPos) => p.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_POST_AUTH),
      (p: InterPos) => p.cancel(order),
      (p: InterPos) => p.refund(order),
    ]) {
      const { fetchImpl } = bankFetch({ other: answer() })
      results.push((await action(realGateway(fetchImpl))) as Data)
    }
    expect(results.map((r) => r.status)).toStrictEqual(['declined', 'declined', 'declined', 'declined', 'declined'])
  })

  it('a status request returns the mapped record; order history is unsupported', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    const res = (await p.status({ id: '20221225B83B' })) as Data
    expect(res.status).toBe('approved')
    expect(res.order_id).toBe('20221225B83B')
    await expect(p.orderHistory({ id: '20221225B83B' })).rejects.toThrow(UnsupportedTransactionTypeError)
    expect(sent).toHaveLength(1)
  })
})

describe('InterPos (end to end) 3D form', () => {
  const formOrder: PosOrder = {
    id: '2020110828BC',
    amount: 100.01,
    currency: CURRENCY.TRY,
    installment: 0,
    success_url: 'https://example.com/ok',
    fail_url: 'https://example.com/fail',
  }
  const formHash = (inputs: Data): string =>
    S1(
      `${inputs.ShopCode}${inputs.OrderId}${inputs.PurchAmount}${inputs.OkUrl}${inputs.FailUrl}${inputs.TxnType}${inputs.InstallmentCount}${inputs.Rnd}${MERCHANT_PASS}`,
    )

  // addition: F21 the array form, in order, signed over the posted values
  it('builds the array form for 3D with card data and a hash recomputed in the test', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    const card = CreditCardFactory.createForGateway(p, '5555444433332222', '21', '12', '122', 'ahmet', CARD_TYPE.VISA)
    const form = (await p.get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)) as Data
    expect(form.gateway).toBe(GATEWAY_3D)
    expect(form.method).toBe('POST')
    expect(Object.keys(form.inputs)).toStrictEqual([
      'ShopCode',
      'TxnType',
      'SecureType',
      'PurchAmount',
      'OrderId',
      'OkUrl',
      'FailUrl',
      'Rnd',
      'Lang',
      'Currency',
      'InstallmentCount',
      'CardType',
      'Pan',
      'Expiry',
      'Cvv2',
      'Hash',
    ])
    expect(form.inputs.SecureType).toBe('3DModel')
    expect(form.inputs.PurchAmount).toBe('100.01')
    expect(form.inputs.Hash).toBe(formHash(form.inputs))
    expect(sent).toHaveLength(0)
  })

  it('builds the 3D Host form without card data', async () => {
    const { fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    const form = (await p.get3DFormData(formOrder, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true)) as Data
    expect(form.gateway).toBe(GATEWAY_3D_HOST)
    expect(form.inputs.SecureType).toBe('3DHost')
    for (const key of ['CardType', 'Pan', 'Expiry', 'Cvv2']) expect(form.inputs).not.toHaveProperty(key)
    expect(form.inputs.Hash).toBe(formHash(form.inputs))
  })

  it('refuses the html format', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    const card = CreditCardFactory.createForGateway(p, '5555444433332222', '21', '12', '122', 'ahmet', CARD_TYPE.VISA)
    await expect(
      p.get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card, false, FORM_FORMAT.HTML),
    ).rejects.toThrow(new UnsupportedFormFormatError('Unsupported 3D form format!'))
    expect(sent).toHaveLength(0)
  })
})

describe('InterPos (end to end) masking', () => {
  // addition: F26 nothing secret reaches the logger
  it('never logs the merchant or user password, the card number, the CVV, the CAVV or a generated hash', async () => {
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
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl, { logger })
    const card = CreditCardFactory.createForGateway(p, '5555444433332222', '21', '12', '122', 'ahmet', CARD_TYPE.VISA)
    const formOrder: PosOrder = {
      id: '2020110828BC',
      amount: 1.01,
      currency: CURRENCY.TRY,
      success_url: 'https://example.com/ok',
      fail_url: 'https://example.com/fail',
    }

    const form = (await p.get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)) as Data
    await p.payment(MODEL.NON_SECURE, { id: 'N1', amount: 1.01 }, TX_TYPE.PAY_AUTH, card)
    await p.payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, cb(fv4()))
    await p.payment(MODEL.THREE_D_PAY, payOrder, TX_TYPE.PAY_AUTH, null, cb(fv3()))
    await p.payment(MODEL.THREE_D_HOST, hostOrder, TX_TYPE.PAY_AUTH, null, cb(fv3({ OrderId: '202212256D26' })))
    await p.payment(MODEL.THREE_D_PAY, payOrder, TX_TYPE.PAY_AUTH, null, cb(fp4()))
    const tampered = { ...fv4(), PurchAmount: '7' }
    await p.payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, cb(tampered)).catch(() => undefined)
    await p
      .payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, cb(fv4({ Currency: '840' })))
      .catch(() => undefined)

    const logged = JSON.stringify(records)
    expect(records.length).toBeGreaterThan(0)
    expect(sent.length).toBe(5)
    expect(logged).not.toContain(MERCHANT_PASS)
    expect(logged).not.toMatch(/UserPass\\?"\s*:\s*\\?"3/)
    expect(logged).not.toContain('5555444433332222')
    expect(logged).not.toMatch(/cvv2?\\?"\s*:\s*\\?"?122/i)
    expect(logged).not.toContain('AAAB')
    expect(logged).not.toContain(form.inputs.Hash)
    // the hash the crypt computed for the tampered callback
    expect(logged).not.toContain(sign(tampered))
  })
})
