import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PayForPos3DFormHttpClient } from '../../../src/client/PayForPos3DFormHttpClient.js'
import { PayForPosHttpClient } from '../../../src/client/PayForPosHttpClient.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { PayForPosCrypt } from '../../../src/crypt/PayForPosCrypt.js'
import { PayForPosRequestDataMapper } from '../../../src/data-mapper/request/mapper/PayForPosRequestDataMapper.js'
import type { RequestDataMapperInterface } from '../../../src/data-mapper/request/mapper/RequestDataMapperInterface.js'
import { PayForPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/PayForPosRequestValueFormatter.js'
import { PayForPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/PayForPosRequestValueMapper.js'
import { PayForPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/PayForPosResponseDataMapper.js'
import type { ResponseDataMapperInterface } from '../../../src/data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { BasicResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { PayForPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PayForPosResponseValueMapper.js'
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
import { PayForPos } from '../../../src/gateway/PayForPos.js'
import type { PosLogger } from '../../../src/logger.js'
import type { PayForPosAccount } from '../../../src/model/account/PayForPosAccount.js'
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
import { XmlDecoder } from '../../../src/serializer/XmlDecoder.js'
import { XmlEncoder } from '../../../src/serializer/XmlEncoder.js'
import type { GatewayResponseData, PosHooks, PosOrder, RequestDataPreparedEvent } from '../../../src/types.js'
import {
  statusTestDataProvider,
  threeDHostPaymentDataProvider,
  threeDPaymentDataProvider,
  threeDPayPaymentDataProvider,
} from '../data-mapper/response/mapper/PayForPosResponseDataMapper.data.js'

// Dependencies are replaced by vi.fn() fakes except the request value mapper; the end-to-end sections below use the
// real mappers, crypt and HTTP clients over a fake fetch that parses every request and answers like the bank.

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

const PAYMENT_API = 'https://vpostest.qnbfinansbank.com/Gateway/XMLGate.aspx'
const GATEWAY_3D = 'https://vpostest.qnbfinansbank.com/Gateway/Default.aspx'
const GATEWAY_3D_HOST = 'https://vpostest.qnbfinansbank.com/Gateway/3DHost.aspx'
const MERCHANT_ID = '085300000009704'
const MERCHANT_PASS = '12345678'
const USER_PASS = 'UcBN0'

// deviation: payment_api added, the TS strategy requires it
const config: GatewayConfig = {
  name: 'QNBFinansbank-PayFor',
  class: 'PayForPos',
  gateway_endpoints: { payment_api: PAYMENT_API, gateway_3d: GATEWAY_3D, gateway_3d_host: GATEWAY_3D_HOST },
}

/** `disable_3d_hash_check` is not an option; passing it must have no effect. */
const configWithHashCheckDisabled = {
  ...config,
  gateway_configs: { disable_3d_hash_check: true },
} as unknown as GatewayConfig

const Q = AccountFactory.createPayForPosAccount(
  'qnbfinansbank-payfor',
  MERCHANT_ID,
  'QNB_API_KULLANICI_3DPAY',
  USER_PASS,
  MERCHANT_PASS,
)
const Z = AccountFactory.createPayForPosAccount(
  'ziraat-katilim-payfor',
  MERCHANT_ID,
  'ZIRAATKATILIM_API_KULLANICI_3DPAY',
  USER_PASS,
  MERCHANT_PASS,
  '12',
)

/** The callback signature: merchant, 3D secret, order, auth code, return code, 3D status, random value, user code. */
const responseHash = (cb: Data, account: PayForPosAccount = Q, algorithm: 'sha1' | 'sha256' = 'sha1'): string =>
  createHash(algorithm)
    .update(
      `${MERCHANT_ID}${MERCHANT_PASS}${cb.OrderId}${cb.AuthCode ?? ''}${cb.ProcReturnCode}${cb['3DStatus']}${cb.ResponseRnd}${account.getUsername()}`,
      'utf8',
    )
    .digest('base64')

/** The callback with `ResponseHash` recomputed over its (changed) signed fields, as the bank would sign it. */
const resign = (cb: Data, account: PayForPosAccount = Q, algorithm: 'sha1' | 'sha256' = 'sha1'): Data => ({
  ...cb,
  ResponseHash: responseHash(cb, account, algorithm),
})

const pick = <T>(rows: Array<[string, T]>, name: string): T => {
  const row = rows.find(([n]) => n === name)
  if (row === undefined) throw new Error(`missing fixture ${name}`)
  return row[1]
}

const secureSuccess = (): Data => ({ ...(pick(threeDPaymentDataProvider, 'success1').threeDResponseData as Data) })
const secureAuthFail = (): Data => ({ ...(pick(threeDPaymentDataProvider, 'auth_fail1').threeDResponseData as Data) })
const provisionApproved = (): Data => ({ ...(pick(threeDPaymentDataProvider, 'success1').paymentData as Data) })
const paySuccess = (): Data => ({ ...(pick(threeDPayPaymentDataProvider, 'success1').paymentData as Data) })
const payAuthFail = (): Data => ({ ...(pick(threeDPayPaymentDataProvider, 'auth_fail1').paymentData as Data) })
const hostSuccess = (): Data => ({ ...(pick(threeDHostPaymentDataProvider, 'success1').paymentData as Data) })
const hostAuthFail = (): Data => ({ ...(pick(threeDHostPaymentDataProvider, 'auth_fail1').paymentData as Data) })
const statusSuccess = (): Data => ({ ...(pick(statusTestDataProvider, 'success1').responseData as Data) })

const secureOrder: PosOrder = { id: '20221031CFD0', amount: 1.01, currency: CURRENCY.TRY, installment: 0 }
const payOrder: PosOrder = { id: '2022103114B3', amount: 1.01, currency: CURRENCY.TRY, installment: 2 }
const hostOrder: PosOrder = { id: '2022103121CA', amount: 1.01, currency: CURRENCY.TRY, installment: 3 }

const createLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })

const cb = (data: Data): GatewayResponseData => data as GatewayResponseData

describe('PayForPos (mocked collaborators)', () => {
  const account = Q
  let requestValueMapper: PayForPosRequestValueMapper
  let requestMapper: Mocked<RequestDataMapperInterface>
  let responseMapper: Mocked<ResponseDataMapperInterface>
  let crypt: Mocked<CryptInterface>
  let httpClient: { supportsTx: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }
  let clientStrategy: { getClient: ReturnType<typeof vi.fn>; getAllClients: ReturnType<typeof vi.fn> }
  let requestDataPrepared: ReturnType<typeof vi.fn<(e: RequestDataPreparedEvent) => void>>
  let logger: ReturnType<typeof createLogger>
  let pos: PayForPos

  const createGateway = (cfg: GatewayConfig, acc: PayForPosAccount = account): PayForPos => {
    const hooks: PosHooks = { onRequestDataPrepared: [requestDataPrepared] }
    const deps: GatewayDeps<PayForPosAccount> = {
      requestValueMapper,
      requestValueFormatter: new PayForPosRequestValueFormatter(),
      requestDataMapper: requestMapper as unknown as RequestDataMapperInterface<PayForPosAccount>,
      responseDataMapper: responseMapper as unknown as ResponseDataMapperInterface,
      crypt: crypt as unknown as CryptInterface<PayForPosAccount>,
      clientStrategy: clientStrategy as unknown as HttpClientStrategy,
      logger,
      hooks,
    }
    return new PayForPos(cfg, acc, deps)
  }

  beforeEach(() => {
    requestValueMapper = new PayForPosRequestValueMapper()
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
      // deviation: L3 a money answer's result code is read before mapping; the mocked mapper reports one
      readProcReturnCode: vi.fn().mockReturnValue('00'),
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
      expect(event.gatewayClass).toBe('PayForPos')
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

  /** The status request that confirms an approved 3D result, answered with `statusResponse`. */
  const statusExchange = (order: PosOrder, statusResponse: Data): Exchange => {
    const statusRequest = { request: 'createStatusRequestData' }
    requestMapper.createStatusRequestData.mockReturnValue(statusRequest)
    responseMapper.mapStatusResponse.mockReturnValue(statusResponse)
    return {
      txType: TX_TYPE.STATUS,
      paymentModel: MODEL.NON_SECURE,
      requestData: statusRequest,
      order: { id: order.id },
      decodedResponse: { decoded: 'status' },
    }
  }

  const confirmingStatus = (order: PosOrder, txType: TxType, extra: Data = {}): Data => ({
    status: 'approved',
    order_id: order.id,
    transaction_type: txType,
    first_amount: 1.01,
    currency: 'TRY',
    installment_count: order.installment ?? 0,
    order_status: null,
    ...extra,
  })

  const expectNoRequest = () => {
    expect(httpClient.request).not.toHaveBeenCalled()
    expect(requestDataPrepared).not.toHaveBeenCalled()
    expect(requestMapper.createStatusRequestData).not.toHaveBeenCalled()
  }

  it('init', () => {
    expect(pos.getCurrencies()).toHaveLength(Object.keys(requestValueMapper.getCurrencyMappings()).length)
    expect(pos.getAccount()).toBe(account)
    expect(pos.isTestMode()).toBe(false)
    expect(pos.get3DGatewayURL(MODEL.THREE_D_HOST)).toBe(GATEWAY_3D_HOST)
    expect(pos.get3DGatewayURL()).toBe(GATEWAY_3D)
    expect(pos.getCrypt()).toBe(crypt)
  })

  // addition: identifiers and the supported transactions table
  it('exposes NAME, the gateway class identifier and the supported transactions', () => {
    expect(PayForPos.NAME).toBe('PayForPOS')
    expect(PayForPos.GATEWAY_CLASS).toBe('PayForPos')
    for (const tx of [TX_TYPE.PAY_AUTH, TX_TYPE.PAY_PRE_AUTH]) {
      for (const model of [MODEL.THREE_D_SECURE, MODEL.THREE_D_PAY, MODEL.THREE_D_HOST, MODEL.NON_SECURE]) {
        expect(PayForPos.isSupportedTransaction(tx, model)).toBe(true)
      }
      expect(PayForPos.isSupportedTransaction(tx, MODEL.THREE_D_PAY_HOSTING)).toBe(false)
    }
    for (const tx of [
      TX_TYPE.PAY_POST_AUTH,
      TX_TYPE.STATUS,
      TX_TYPE.CANCEL,
      TX_TYPE.REFUND,
      TX_TYPE.REFUND_PARTIAL,
      TX_TYPE.ORDER_HISTORY,
    ]) {
      expect(PayForPos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(true)
    }
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

  const configureHtmlForm = (paymentModel: PaymentModel, requestData: Data, answer: Data) => {
    requestMapper.create3DFormInitializeRequestData.mockResolvedValue(requestData)
    clientStrategy.getClient.mockReturnValue(httpClient as unknown as AbstractHttpClient)
    httpClient.request.mockResolvedValue(answer)

    return (order: PosOrder, txType: TxType, c: unknown, sentData: Data) => {
      expect(requestMapper.create3DFormInitializeRequestData).toHaveBeenCalledTimes(1)
      expect(requestMapper.create3DFormInitializeRequestData).toHaveBeenCalledWith(
        account,
        order,
        paymentModel,
        txType,
        c,
      )
      expect(requestDataPrepared).toHaveBeenCalledTimes(1)
      const event = requestDataPrepared.mock.calls[0]?.[0] as RequestDataPreparedEvent
      expect(event.txType).toBe(TX_TYPE.INTERNAL_3D_FORM_BUILD)
      expect(event.paymentModel).toBe(paymentModel)
      expect(event.gatewayClass).toBe('PayForPos')
      expect(clientStrategy.getClient).toHaveBeenCalledTimes(1)
      expect(clientStrategy.getClient).toHaveBeenCalledWith(TX_TYPE.INTERNAL_3D_FORM_BUILD, paymentModel)
      expect(httpClient.request).toHaveBeenCalledTimes(1)
      expect(httpClient.request).toHaveBeenCalledWith(
        TX_TYPE.INTERNAL_3D_FORM_BUILD,
        paymentModel,
        sentData,
        order,
        null,
      )
      expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
    }
  }

  it.each([
    ['3d_secure', MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH],
    ['3d_pay', MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH],
  ] as Array<[string, PaymentModel, TxType]>)('get3DFormData html format %s', async (_name, paymentModel, txType) => {
    const order = { id: '124' }
    const requestData = { MerchantId: '085300000009704', hash: 'abc' }
    const htmlResponse = '<html><body>3d-form</body></html>'
    const c = card()
    // deviation: F19 the client answers { html } (decoded responses are records)
    const verify = configureHtmlForm(paymentModel, requestData, { html: htmlResponse })

    const actual = await pos.get3DFormData(order, paymentModel, txType, c, false, FORM_FORMAT.HTML)

    expect(actual).toBe(htmlResponse)
    verify(order, txType, c, requestData)
    const event = requestDataPrepared.mock.calls[0]?.[0] as RequestDataPreparedEvent
    expect(event.requestData).toStrictEqual(requestData)
  })

  it('get3DFormData html format with hook-modified request data', async () => {
    const order = { id: '124' }
    const requestData = { MerchantId: '085300000009704', hash: 'abc' }
    const modifiedData = { MerchantId: '085300000009704', hash: 'xyz', extra: '1' }
    const htmlResponse = '<html><body>3d-form</body></html>'
    const c = card()
    const verify = configureHtmlForm(MODEL.THREE_D_SECURE, requestData, { html: htmlResponse })
    requestDataPrepared.mockImplementation((event) => {
      event.requestData = { ...modifiedData }
    })

    const actual = await pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, c, false, FORM_FORMAT.HTML)

    expect(actual).toBe(htmlResponse)
    verify(order, TX_TYPE.PAY_AUTH, c, modifiedData)
  })

  it('get3DFormData html format with an empty response', async () => {
    const order = { id: '124' }
    const requestData = { MerchantId: '085300000009704' }
    const c = card()
    const verify = configureHtmlForm(MODEL.THREE_D_SECURE, requestData, { html: '' })

    // deviation: F28 English message, PosError
    await expect(
      pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, c, false, FORM_FORMAT.HTML),
    ).rejects.toThrow(new PosError('3D form data could not be created'))
    verify(order, TX_TYPE.PAY_AUTH, c, requestData)
  })

  // addition: a blank page or a missing html value is no form either
  it.each([[{ html: ' \n ' }], [{}], [{ html: ['<html/>'] }]])(
    'get3DFormData html format with a blank or missing page %j',
    async (answer) => {
      configureHtmlForm(MODEL.THREE_D_SECURE, { MerchantId: '085300000009704' }, answer)
      await expect(
        pos.get3DFormData({ id: '124' }, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card(), false, FORM_FORMAT.HTML),
      ).rejects.toThrow(new PosError('3D form data could not be created'))
    },
  )

  // deviation: F28 English messages and error classes of the shared 3D form input check
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
      'unsupported_payment_model',
      MODEL.THREE_D_PAY_HOSTING,
      TX_TYPE.PAY_AUTH,
      false,
      false,
      UnsupportedTransactionTypeError,
      'PayForPos supports [3d, 3d_pay, 3d_host, regular] payment model(s) for transaction type [pay]. Provided payment model: [3d_pay_hosting].',
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
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_AUTH,
      false,
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
      expect(requestMapper.create3DFormInitializeRequestData).not.toHaveBeenCalled()
      expectNoRequest()
    },
  )

  // addition: 3D Host never takes card data, in either form format, and nothing is sent
  it.each([[null], [FORM_FORMAT.HTML]] as Array<[FormFormat | null]>)(
    'get3DFormData refuses 3D Host with card data (format %s)',
    async (formFormat) => {
      const err = await pos
        .get3DFormData({ id: '2020110828BC' }, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, card(), false, formFormat)
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PosError)
      expect((err as Error).message).toBe(
        'Do not use [3d_host] payment model with card data. Use [3d, 3d_pay, regular] payment model(s) instead.',
      )
      expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
      expect(requestMapper.create3DFormInitializeRequestData).not.toHaveBeenCalled()
      expectNoRequest()
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

  /** The full 3D-model success callback, echoing the transaction type of a pre-authorization. */
  // deviation: F12 binds TxnType to txType 'pre'
  const securePreAuthSuccess = (): Data => ({ ...secureSuccess(), TxnType: 'PreAuth' })

  const secureRows: SecureRow[] = [
    [
      'auth_fail',
      {},
      TX_TYPE.PAY_PRE_AUTH,
      { RequestGuid: '1000000081255934' },
      {},
      {
        order_id: '202210317565',
        proc_return_code: 'V034',
        status: 'declined',
        error_code: 'V034',
        error_message: '3D Kullanıcı Doğrulama Adımı Başarısız',
        md_error_code: 'V034',
        md_error_message: '3D Kullanıcı Doğrulama Adımı Başarısız',
      },
      false,
    ],
    [
      'order_number_already_exist',
      {},
      TX_TYPE.PAY_AUTH,
      {
        RequestGuid: '0',
        TransactionDate: '17.03.2024 17:47:28',
        MbrId: '5',
        OkUrl: 'http://localhost/finansbank-payfor/3d/response.php',
        FailUrl: 'http://localhost/finansbank-payfor/3d/response.php',
        ErrMsg: 'Verilen sipariş no önceden kullanılmıştır.',
        ProcReturnCode: '101310',
        ReturnUrl: 'http://localhost/finansbank-payfor/3d/response.php',
      },
      {},
      {
        order_id: '202403173F72',
        proc_return_code: '101310',
        status: 'declined',
        error_code: '101310',
        error_message: 'Verilen sipariş no önceden kullanılmıştır.',
        md_error_code: '101310',
        md_error_message: 'Verilen sipariş no önceden kullanılmıştır.',
      },
      false,
    ],
    [
      'success',
      // deviation: F12/F24 the order carries the id, amount, currency and installment the callback is bound to
      secureOrder,
      TX_TYPE.PAY_PRE_AUTH,
      securePreAuthSuccess(),
      {
        AuthCode: 'S37397',
        HostRefNum: '230422098249',
        ProcReturnCode: '00',
        TransId: '20221031CFD0',
        ErrMsg: 'Onaylandı',
        CardHolderName: 'John Doe',
      },
      {
        transaction_id: '20221031CFD0',
        transaction_type: 'pay',
        status: 'approved',
        error_code: null,
        error_message: null,
        payment_model: '3d',
        installment_count: 0,
      },
      true,
    ],
  ]

  const run3DPaymentRow = async (p: PayForPos, row: SecureRow) => {
    const [, order, txType, callback, paymentResponse, expected, is3DSuccess] = row
    responseMapper.extractMdStatus.mockReturnValue('3d-status')
    responseMapper.is3dAuthSuccess.mockReturnValue(is3DSuccess)
    responseMapper.map3DPaymentData.mockReturnValue(expected)
    let verify: (() => void) | null = null
    const provisionRequest = { request: 'create3DPaymentRequestData' }
    if (is3DSuccess) {
      crypt.check3DHash.mockReturnValueOnce(true)
      requestMapper.create3DPaymentRequestData.mockReturnValue(provisionRequest)
      // deviation: F14 adds the status request that confirms the approved provision
      verify = configureClientResponses([
        {
          txType,
          paymentModel: MODEL.THREE_D_SECURE,
          requestData: provisionRequest,
          order,
          decodedResponse: paymentResponse,
        },
        statusExchange(
          order,
          confirmingStatus(order, txType, {
            auth_code: 'S37397',
            ref_ret_num: '230422098249',
            masked_number: '415565******6111',
          }),
        ),
      ])
    }

    const result = await p.payment(MODEL.THREE_D_SECURE, order, txType, null, cb(callback))

    expect(responseMapper.extractMdStatus).toHaveBeenCalledTimes(1)
    expect(responseMapper.extractMdStatus).toHaveBeenCalledWith(callback)
    expect(responseMapper.is3dAuthSuccess).toHaveBeenCalledTimes(1)
    expect(responseMapper.is3dAuthSuccess).toHaveBeenCalledWith('3d-status')
    expect(responseMapper.map3DPaymentData).toHaveBeenCalledTimes(1)
    if (is3DSuccess) {
      // deviation: F14 the authorization code and the bank references of the returned result come from the
      // confirming bank record
      expect(result).toStrictEqual({
        ...expected,
        auth_code: 'S37397',
        ref_ret_num: '230422098249',
        masked_number: '415565******6111',
      })
      expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
      expect(crypt.check3DHash).toHaveBeenCalledWith(account, callback)
      expect(requestMapper.create3DPaymentRequestData).toHaveBeenCalledWith(account, order, txType, callback)
      expect(requestMapper.createStatusRequestData).toHaveBeenCalledWith(account, { id: '20221031CFD0' })
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(callback, paymentResponse, txType, order)
      expect(responseMapper.mapStatusResponse).toHaveBeenCalledWith({ decoded: 'status' })
      verify?.()
    } else {
      expect(result).toStrictEqual(expected)
      expect(crypt.check3DHash).not.toHaveBeenCalled()
      expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(callback, null, txType, order)
      expectNoRequest()
    }
  }

  it.each(secureRows)('make3DPayment %s', async (...row) => {
    await run3DPaymentRow(pos, row)
  })

  // deviation: F11 disable_3d_hash_check is ignored, the hash is still checked once
  it('make3DPayment without hash check success', async () => {
    const row: SecureRow = [
      'success',
      secureOrder,
      TX_TYPE.PAY_PRE_AUTH,
      securePreAuthSuccess(),
      {
        AuthCode: 'S37397',
        HostRefNum: '230422098249',
        ProcReturnCode: '00',
        TransId: '20221031CFD0',
        ErrMsg: 'Onaylandı',
        CardHolderName: 'John Doe',
      },
      { transaction_id: '20221031CFD0', transaction_type: 'pay', status: 'approved' },
      true,
    ]
    await run3DPaymentRow(createGateway(configWithHashCheckDisabled), row)
  })

  it('make3DPayment hash mismatch', async () => {
    // deviation: F11 the callback carries a hash (an absent hash is a different error)
    const callback = { RequestGuid: '1000000081255931', TransactionDate: '31.10.2022 22:34:18', ResponseHash: 'x' }
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    crypt.check3DHash.mockReturnValue(false)

    await expect(pos.payment(MODEL.THREE_D_SECURE, {}, TX_TYPE.PAY_AUTH, null, cb(callback))).rejects.toThrow(
      HashMismatchError,
    )
    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
    expect(crypt.check3DHash).toHaveBeenCalledWith(account, callback)
    expect(responseMapper.map3DPaymentData).not.toHaveBeenCalled()
    expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
    expectNoRequest()
  })

  // addition: fail closed when a callback without 3D success is not mapped as declined
  it('make3DPayment: a callback without 3D success mapped as approved is rejected (PosError)', async () => {
    responseMapper.is3dAuthSuccess.mockReturnValue(false)
    responseMapper.map3DPaymentData.mockReturnValue({ status: 'approved' })

    await expect(
      pos.payment(MODEL.THREE_D_SECURE, { id: 'x' }, TX_TYPE.PAY_AUTH, null, cb({ ProcReturnCode: 'V034' })),
    ).rejects.toThrow(new PosError('3D callback without 3D success was not mapped as declined'))
    expectNoRequest()
  })

  // addition: 3D success needs both the mapper's decision and the callback's own 3DStatus '1'
  it('make3DPayment: a mapper that reports success for a 3DStatus other than 1 is not trusted', async () => {
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    responseMapper.map3DPaymentData.mockReturnValue({ status: 'declined' })
    const callback: Data = { ...secureAuthFail() }
    delete callback.ResponseHash

    const result = await pos.payment(MODEL.THREE_D_SECURE, { id: 'x' }, TX_TYPE.PAY_AUTH, null, cb(callback))

    expect(result).toStrictEqual({ status: 'declined' })
    expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(callback, null, TX_TYPE.PAY_AUTH, { id: 'x' })
    expectNoRequest()
  })

  // ---- 3D Pay / 3D Host ----

  describe.each([
    ['3D Pay', MODEL.THREE_D_PAY, 'map3DPayResponseData', paySuccess, payOrder],
    ['3D Host', MODEL.THREE_D_HOST, 'map3DHostResponseData', hostSuccess, hostOrder],
  ] as Array<[string, PaymentModel, 'map3DPayResponseData' | 'map3DHostResponseData', () => Data, PosOrder]>)(
    '%s',
    (_label, paymentModel, mapperMethod, success, order) => {
      // deviation: F9/F12 the signed and echoed fields are needed (full callback, bound order); F14 confirms the
      // approved result with one status request
      it('payment', async () => {
        const callback = success()
        crypt.check3DHash.mockReturnValue(true)
        const mapped = { status: 'approved', order_id: order.id, proc_return_code: '00' }
        responseMapper[mapperMethod].mockReturnValue(mapped)
        const verify = configureClientResponses([statusExchange(order, confirmingStatus(order, TX_TYPE.PAY_AUTH))])

        const result = await pos.payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb(callback))

        // the bank references come from the confirming record, which has none here
        expect(result).toStrictEqual({ ...mapped, ref_ret_num: null, masked_number: null })
        expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
        expect(crypt.check3DHash).toHaveBeenCalledWith(account, callback)
        expect(responseMapper[mapperMethod]).toHaveBeenCalledTimes(1)
        expect(responseMapper[mapperMethod]).toHaveBeenCalledWith(callback, TX_TYPE.PAY_AUTH, order)
        expect(requestMapper.createStatusRequestData).toHaveBeenCalledWith(account, { id: order.id })
        verify()
      })

      it('payment hash mismatch', async () => {
        const callback = success()
        crypt.check3DHash.mockReturnValue(false)

        await expect(pos.payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb(callback))).rejects.toThrow(
          HashMismatchError,
        )
        expect(crypt.check3DHash).toHaveBeenCalledWith(account, callback)
        expect(responseMapper[mapperMethod]).not.toHaveBeenCalled()
        expectNoRequest()
      })

      // addition: fail closed when the mapper approves a callback whose return code is not the approval
      it('a declined callback mapped as approved is rejected (PosError) without confirmation', async () => {
        crypt.check3DHash.mockReturnValue(true)
        responseMapper[mapperMethod].mockReturnValue({ status: 'approved', order_id: order.id })

        const err = await pos
          .payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb({ ...success(), ProcReturnCode: 'MR15' }))
          .catch((e) => e)
        expect(err).toBeInstanceOf(PosError)
        expect((err as Error).message).toBe('3D callback without approval was mapped as approved')
        expectNoRequest()
      })

      // addition: the decline reasons of an unsigned declined callback are kept as plain, bounded text
      it('an unsigned decline keeps string reasons cut to 256 characters and nulls other shapes', async () => {
        const callback: Data = { ...success(), ProcReturnCode: '05' }
        delete callback.ResponseHash
        responseMapper[mapperMethod].mockReturnValue({
          status: 'declined',
          order_id: 'FORGED',
          proc_return_code: '05',
          error_code: { code: '05' },
          error_message: 'x'.repeat(1000),
          md_status: ['1'],
          md_error_message: 'Not authenticated',
          auth_code: 'S86797',
          batch_num: '4320',
        })

        const result = (await pos.payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb(callback))) as Data

        expect(result.status).toBe('declined')
        expect(result.order_id).toBe(order.id)
        expect(result.proc_return_code).toBe('05')
        expect(result.error_code).toBeNull()
        expect(result.error_message).toBe('x'.repeat(256))
        expect(result.md_status).toBeNull()
        expect(result.md_error_message).toBe('Not authenticated')
        expect(result.auth_code).toBeNull()
        expect(result.batch_num).toBeNull()
        expectNoRequest()
      })

      // addition: the status response decides; a declined status is an order_status mismatch
      it('a status answer that does not confirm the payment is OrderMismatchError', async () => {
        crypt.check3DHash.mockReturnValue(true)
        responseMapper[mapperMethod].mockReturnValue({ status: 'approved', order_id: order.id, proc_return_code: '00' })
        configureClientResponses([statusExchange(order, { status: 'declined', order_id: null })])

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
    ['orderHistory', TX_TYPE.ORDER_HISTORY, 'createOrderHistoryRequestData', 'mapOrderHistoryResponse'],
  ] as Array<
    [
      'status' | 'cancel' | 'refund' | 'orderHistory',
      TxType,
      keyof RequestDataMapperInterface,
      keyof ResponseDataMapperInterface,
    ]
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
})

// ---------- end to end: real mappers, crypt and HTTP clients over a fake fetch ----------

type Sent = { url: string; body: string; fields: Data }

/** A status record of the bank for `orderId`, answered as approved unless overridden. */
const statusRecord = (orderId: string, overrides: Data = {}): Data => ({
  ...statusSuccess(),
  OrderId: orderId,
  PurchAmount: '1.01',
  Currency: '949',
  TxnType: 'Auth',
  InstallmentCount: '0',
  AuthCode: 'S37397',
  HostRefNum: '230422098249',
  ...overrides,
})

const xml = (data: Data): string => XmlEncoder.encode(data, { rootName: 'PayforResponse', encoding: 'UTF-8' })

type BankOptions = {
  /** The provision answer of a 3D model payment. */
  provision?: Data | Response
  /** The status record for the order of the request (`OrgOrderId`). */
  status?: (orderId: string) => Data | Response
  /** The answer to the 3D form post. */
  form?: Response | string
  /** The answer to a non-secure sale, post-authorization, cancel or refund. */
  other?: Data | Response | string
}

/**
 * A fetch that parses each request (XML for the payment API, form for the 3D gateway), records it and answers like the
 * bank by `SecureType`: `3DModelPayment` → the provision, `Inquiry` → the status record. Anything else fails.
 */
function bankFetch(options: BankOptions = {}) {
  const sent: Sent[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const body = await new Request('https://example.invalid', { method: 'POST', body: init?.body ?? '' }).text()
    const target = String(url)
    const fields: Data = target === GATEWAY_3D ? Object.fromEntries(new URLSearchParams(body)) : XmlDecoder.decode(body)
    sent.push({ url: target, body, fields })
    let reply: Data | Response | string | undefined
    if (target === GATEWAY_3D) {
      reply = options.form
    } else if (fields.SecureType === '3DModelPayment') {
      reply = options.provision ?? provisionApproved()
    } else if (fields.SecureType === 'Inquiry') {
      reply = options.status ? options.status(String(fields.OrgOrderId)) : statusRecord(String(fields.OrgOrderId))
    } else if (fields.SecureType === 'NonSecure') {
      reply = options.other ?? { ProcReturnCode: '00', AuthCode: 'S11111', TransId: String(fields.OrderId) }
    }
    if (reply === undefined) {
      throw new Error(`unexpected request ${String(fields.SecureType)} to ${target}`)
    }
    if (reply instanceof Response) return reply
    return new Response(typeof reply === 'string' ? reply : xml(reply), { status: 200 })
  }) as unknown as typeof fetch

  return { sent, fetchImpl }
}

function realGateway(
  fetchImpl: typeof fetch,
  options: { cfg?: GatewayConfig; account?: PayForPosAccount; logger?: PosLogger; hooks?: PosHooks } = {},
) {
  const acc = options.account ?? Q
  const log = options.logger ?? createLogger()
  const cryptImpl = new PayForPosCrypt(log)
  const valueMapper = new PayForPosRequestValueMapper()
  const valueFormatter = new PayForPosRequestValueFormatter()
  const hooks = options.hooks ?? {}
  const transport = new HttpTransport({ fetch: fetchImpl })
  const deps: GatewayDeps<PayForPosAccount> = {
    requestValueMapper: valueMapper,
    requestValueFormatter: valueFormatter,
    requestDataMapper: new PayForPosRequestDataMapper(valueMapper, valueFormatter, hooks, cryptImpl),
    responseDataMapper: new PayForPosResponseDataMapper(
      new BasicResponseValueFormatter(),
      new PayForPosResponseValueMapper(),
      log,
    ),
    crypt: cryptImpl,
    clientStrategy: new HttpClientStrategy([
      new PayForPosHttpClient(PAYMENT_API, transport, log),
      new PayForPos3DFormHttpClient(GATEWAY_3D, transport, log),
    ]),
    logger: log,
    hooks,
  }

  return new PayForPos(options.cfg ?? config, acc, deps)
}

const mismatch = async (promise: Promise<unknown>): Promise<OrderMismatchError> => {
  const err = await promise.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(OrderMismatchError)
  return err as OrderMismatchError
}

describe('PayForPos (end to end) 3D Secure', () => {
  const run = (callback: Data, order: PosOrder = secureOrder, options: BankOptions = {}, account = Q) => {
    const { sent, fetchImpl } = bankFetch(options)
    const promise = realGateway(fetchImpl, { account }).payment(
      MODEL.THREE_D_SECURE,
      order,
      TX_TYPE.PAY_AUTH,
      null,
      cb(callback),
    )
    return { sent, promise }
  }

  // addition: F15/F14 provision of the signed callback, then one status request bound to the order
  it.each([
    ['SHA-1', secureSuccess()],
    // addition: FV2 the bank may sign with SHA-256
    ['SHA-256', { ...secureSuccess(), ResponseHash: 'L1eivLG7RoNs/YltZqO6amrMgAiks1QUE5MEEEDfusI=' }],
  ])('provisions and confirms a signed successful callback (%s)', async (_name, callback) => {
    const { sent, promise } = run(callback)
    const res = (await promise) as Data

    expect(sent).toHaveLength(2)
    expect(sent[0]?.url).toBe(PAYMENT_API)
    expect(sent[0]?.fields).toStrictEqual({
      RequestGuid: '1000000081255931',
      UserCode: 'QNB_API_KULLANICI_3DPAY',
      UserPass: 'UcBN0',
      OrderId: '20221031CFD0',
      SecureType: '3DModelPayment',
    })
    expect(sent[1]?.fields.SecureType).toBe('Inquiry')
    expect(sent[1]?.fields.OrgOrderId).toBe('20221031CFD0')
    expect(sent[1]?.fields.TxnType).toBe('OrderInquiry')
    expect(res.status).toBe('approved')
    expect(res.auth_code).toBe('S37397')
    expect(res.ref_ret_num).toBe('230422098249')
    expect(res.order_id).toBe('20221031CFD0')
  })

  // addition: FP1 a genuine hash re-split as another order id and return code is malformed
  it('FP1: a re-split callback keeping the genuine hash is rejected before any request', async () => {
    const callback: Data = { ...secureSuccess(), OrderId: '20221031CFD', ProcReturnCode: '0V033' }
    expect(callback.ResponseHash).toBe('6OWhNzqTEXUGkY6HN90QKHdP53c=')
    const { sent, promise } = run(callback, { id: '20221031CFD', amount: 1.01 })
    await expect(promise).rejects.toThrow(new HashMismatchError('3D callback fields are malformed'))
    expect(sent).toHaveLength(0)
  })

  // addition: F9 pins on a 3D model success (signed by the test like the bank would)
  it.each([
    ['an authorization code', { AuthCode: 'S12345' }],
    ['a random value with an appended letter', { ResponseRnd: 'PF638028524588902912X' }],
    ['a random value with an appended control character', { ResponseRnd: 'PF638028524588902912\u0080' }],
    ['a return code of another shape', { ProcReturnCode: 'V0333' }],
  ])('rejects a signed success callback with %s (malformed)', async (_name, change) => {
    const { sent, promise } = run(resign({ ...secureSuccess(), ...change }))
    await expect(promise).rejects.toThrow(new HashMismatchError('3D callback fields are malformed'))
    expect(sent).toHaveLength(0)
  })

  it('rejects an altered hash', async () => {
    const { sent, promise } = run({ ...secureSuccess(), ResponseHash: '7OWhNzqTEXUGkY6HN90QKHdP53c=' })
    await expect(promise).rejects.toThrow(new HashMismatchError('3D callback hash mismatch'))
    expect(sent).toHaveLength(0)
  })

  // addition: F11 QNB signs every callback; an unsigned success is never provisioned
  it('rejects a QNB success callback without ResponseHash', async () => {
    const callback = secureSuccess()
    delete callback.ResponseHash
    const { sent, promise } = run(callback)
    await expect(promise).rejects.toThrow(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  it.each([
    ['an SHA-512-length hash', `${'A'.repeat(86)}==`],
    ['a lower-cased hash', '6owhnzqtexugky6hn90qkhdp53c='],
  ])('rejects %s', async (_name, hash) => {
    const { sent, promise } = run({ ...secureSuccess(), ResponseHash: hash })
    await expect(promise).rejects.toThrow(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: F12 every unsigned echo is bound to the order before any request (FP5-style signed other order)
  it.each([
    ['order_id', resign({ ...secureSuccess(), OrderId: '20221031CFD1' })],
    ['amount', { ...secureSuccess(), PurchAmount: '100.00' }],
    ['currency', { ...secureSuccess(), Currency: '392' }],
    ['transaction_type', { ...secureSuccess(), TxnType: 'PreAuth' }],
    ['installment', { ...secureSuccess(), InstallmentCount: '3' }],
    ['payment_model', { ...secureSuccess(), SecureType: '3DPay' }],
    ['merchant_id', { ...secureSuccess(), MerchantID: '000' }],
    ['merchant_id', { ...secureSuccess(), MbrId: '12' }],
  ])('OrderMismatchError %s before any request', async (field, callback) => {
    const { sent, promise } = run(callback)
    const err = await mismatch(promise)
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(false)
    expect(err.response).toBeUndefined()
    expect(sent).toHaveLength(0)
  })

  // addition: F15 the request guid is pinned to digits before it reaches the XML
  it.each([
    ['abc', 'abc'],
    ['a hostile value', '1</RequestGuid><UserPass>x</UserPass><RequestGuid>1'],
    ['a too long value', '1'.repeat(33)],
  ])('rejects a RequestGuid that is %s (PosError, nothing sent)', async (_name, guid) => {
    const { sent, promise } = run({ ...secureSuccess(), RequestGuid: guid })
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect((err as Error).message).toBe('3D callback RequestGuid is missing or malformed')
    expect(sent).toHaveLength(0)
  })

  it('rejects a missing RequestGuid (PosError, nothing sent)', async () => {
    const callback = secureSuccess()
    delete callback.RequestGuid
    const { sent, promise } = run(callback)
    await expect(promise).rejects.toThrow(new PosError('3D callback RequestGuid is missing or malformed'))
    expect(sent).toHaveLength(0)
  })

  // addition: a callback is a flat record of strings
  it.each([
    ['ResponseHash', ['x']],
    ['ResponseHash', {}],
    ['OrderId', ['20221031CFD0']],
  ])('rejects a non-string %s before the crypt (PosError)', async (key, value) => {
    const { sent, promise } = run({ ...secureSuccess(), [key]: value })
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect(err).not.toBeInstanceOf(HashMismatchError)
    expect((err as Error).message).toBe(`3D callback field "${key}" must be a string`)
    expect(sent).toHaveLength(0)
  })

  // addition: declined callbacks are verified when signed and never sent
  it('maps the signed auth_fail callback declined without a request', async () => {
    const callback = secureAuthFail()
    const { sent, promise } = run(callback, { id: callback.OrderId as string, amount: 1.01 })
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.md_status).toBe('-1')
    expect(sent).toHaveLength(0)
  })

  it('rejects a declined callback with an altered hash', async () => {
    const { sent, promise } = run({ ...secureAuthFail(), ResponseHash: 'Kzj512Gluz+bmMD8sQYrqCuAQ30=' })
    await expect(promise).rejects.toThrow(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  it('maps an unsigned declined callback declined; require_3d_hash rejects it', async () => {
    const callback = secureAuthFail()
    delete callback.ResponseHash
    const { sent, promise } = run(callback)
    expect(((await promise) as Data).status).toBe('declined')

    const strict = bankFetch()
    await expect(
      realGateway(strict.fetchImpl, { cfg: { ...config, require_3d_hash: true } }).payment(
        MODEL.THREE_D_SECURE,
        secureOrder,
        TX_TYPE.PAY_AUTH,
        null,
        cb(callback),
      ),
    ).rejects.toThrow(new HashMismatchError('3D callback has no ResponseHash'))
    expect(sent).toHaveLength(0)
    expect(strict.sent).toHaveLength(0)
  })

  it('a declined provision is returned declined without a status request', async () => {
    const { sent, promise } = run(secureSuccess(), secureOrder, {
      provision: { ProcReturnCode: 'M041', ErrMsg: 'Kayıp kart', TransId: '20221031CFD0' },
    })
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.proc_return_code).toBe('M041')
    expect(sent).toHaveLength(1)
  })

  it.each([
    ['HTTP 500', new Response('error', { status: 500 })],
    ['a 200 HTML page', new Response('<html><body>Request Rejected</body></html>', { status: 200 })],
  ])('a provision answered with %s is PosHttpError', async (_name, provision) => {
    const { sent, promise } = run(secureSuccess(), secureOrder, { provision })
    await expect(promise).rejects.toThrow(PosHttpError)
    expect(sent).toHaveLength(1)
  })

  // addition: disable_3d_hash_check changes nothing
  it('disable_3d_hash_check does not disable the check', async () => {
    const { sent, fetchImpl } = bankFetch()
    await expect(
      realGateway(fetchImpl, { cfg: configWithHashCheckDisabled }).payment(
        MODEL.THREE_D_SECURE,
        secureOrder,
        TX_TYPE.PAY_AUTH,
        null,
        cb({ ...secureSuccess(), ResponseHash: '7OWhNzqTEXUGkY6HN90QKHdP53c=' }),
      ),
    ).rejects.toThrow(HashMismatchError)
    expect(sent).toHaveLength(0)
  })
})

describe('PayForPos (end to end) confirmation of an approved provision', () => {
  // addition: F14 the status record must hold an approved, open payment of this order, type, amount, currency and plan
  it.each([
    ['currency', { Currency: '392' }],
    ['amount', { PurchAmount: '1.00' }],
    ['transaction_type', { TxnType: 'PreAuth' }],
    ['installment', { InstallmentCount: '3' }],
    ['order_status', { ProcReturnCode: 'V013', ErrMsg: 'Kayıt bulunamadı' }],
    ['order_status', { IsVoided: 'true' }],
    ['order_status', { IsRefunded: 'true' }],
    ['order_id', { OrderId: '20221031CFD1' }],
  ])('a status record with another %s is OrderMismatchError (payment may have completed)', async (field, change) => {
    const { sent, fetchImpl } = bankFetch({ status: (id) => statusRecord(id, change) })
    const err = await mismatch(
      realGateway(fetchImpl).payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, cb(secureSuccess())),
    )
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
    expect(sent).toHaveLength(2)
  })

  // addition: a record that is cancelled or refunded in any readable or unreadable way does not confirm a payment
  const statusXml = (id: string, from: string, to: string): Response => {
    const body = xml(statusRecord(id))
    expect(body).toContain(from)
    return new Response(body.replace(from, to), { status: 200 })
  }

  it.each([
    ['a duplicated IsVoided', { IsVoided: ['false', 'true'] }],
    ['IsVoided True', { IsVoided: 'True' }],
    ['an empty IsVoided', { IsVoided: '' }],
    ['a duplicated IsRefunded', { IsRefunded: ['false', 'false'] }],
    ['a nested IsRefunded', { IsRefunded: { Value: 'false' } }],
    ['IsRefunded 1', { IsRefunded: '1' }],
    ['a VoidDate with IsVoided false', { VoidDate: '20240119', VoidTime: '213405' }],
    ['an unreadable VoidDate', { VoidDate: 'x' }],
    ['a VoidTime', { VoidTime: '213405' }],
    ['a refunded amount', { RefundedAmount: '0.50' }],
  ])('a status record with %s is closed (OrderMismatchError order_status)', async (_name, change) => {
    const { sent, fetchImpl } = bankFetch({ status: (id) => statusRecord(id, change) })
    const err = await mismatch(
      realGateway(fetchImpl).payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, cb(secureSuccess())),
    )
    expect(err.field).toBe('order_status')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(sent).toHaveLength(2)
  })

  it.each([
    ['IsVoided with an attribute', '<IsVoided>false</IsVoided>', '<IsVoided state="1">false</IsVoided>'],
    ['IsRefunded with an attribute', '<IsRefunded>false</IsRefunded>', '<IsRefunded x="y">false</IsRefunded>'],
  ])('a status record with %s is closed (OrderMismatchError order_status)', async (_name, from, to) => {
    const { fetchImpl } = bankFetch({ status: (id) => statusXml(id, from, to) })
    const err = await mismatch(
      realGateway(fetchImpl).payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, cb(secureSuccess())),
    )
    expect(err.field).toBe('order_status')
  })

  it('a status record without the void and refund fields confirms the payment', async () => {
    const record = statusRecord('20221031CFD0')
    for (const key of ['IsVoided', 'IsRefunded', 'VoidDate', 'VoidTime', 'RefundedAmount']) delete record[key]
    const { fetchImpl } = bankFetch({ status: () => record })
    const res = (await realGateway(fetchImpl).payment(
      MODEL.THREE_D_SECURE,
      secureOrder,
      TX_TYPE.PAY_AUTH,
      null,
      cb(secureSuccess()),
    )) as Data
    expect(res.status).toBe('approved')
  })

  // addition: the bank references of the result come from the confirming record, never from the callback
  it('takes the host reference and the masked card number from the confirming record', async () => {
    const { fetchImpl } = bankFetch({
      status: (id) => statusRecord(id, { HostRefNum: '999999999999', CardMask: '415565******0000' }),
    })
    const res = (await realGateway(fetchImpl).payment(
      MODEL.THREE_D_SECURE,
      secureOrder,
      TX_TYPE.PAY_AUTH,
      null,
      cb({ ...secureSuccess() }),
    )) as Data
    expect(res.ref_ret_num).toBe('999999999999')
    expect(res.masked_number).toBe('415565******0000')
  })

  it('a confirming record without host reference or masked card number leaves them null', async () => {
    const { fetchImpl } = bankFetch({
      status: (id) => statusRecord(id, { HostRefNum: '', CardMask: '', InstallmentCount: '3' }),
    })
    const callback = { ...hostSuccess() }
    expect(callback.HostRefNum).toBeTruthy()
    expect(callback.CardMask).toBeTruthy()
    const res = (await realGateway(fetchImpl).payment(
      MODEL.THREE_D_HOST,
      hostOrder,
      TX_TYPE.PAY_AUTH,
      null,
      cb(callback),
    )) as Data
    expect(res.status).toBe('approved')
    expect(res.ref_ret_num).toBeNull()
    expect(res.masked_number).toBeNull()
  })

  it('a failing status request propagates PosHttpError', async () => {
    const { sent, fetchImpl } = bankFetch({ status: () => new Response('error', { status: 500 }) })
    await expect(
      realGateway(fetchImpl).payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, cb(secureSuccess())),
    ).rejects.toThrow(PosHttpError)
    expect(sent).toHaveLength(2)
  })

  it('confirms a pre-authorization by a PreAuth status record', async () => {
    const { fetchImpl } = bankFetch({ status: (id) => statusRecord(id, { TxnType: 'PreAuth' }) })
    const res = (await realGateway(fetchImpl).payment(
      MODEL.THREE_D_SECURE,
      secureOrder,
      TX_TYPE.PAY_PRE_AUTH,
      null,
      cb({ ...secureSuccess(), TxnType: 'PreAuth' }),
    )) as Data
    expect(res.status).toBe('approved')
  })
})

describe('PayForPos (end to end) 3D Pay and 3D Host', () => {
  const hosted = [
    ['3D Pay', MODEL.THREE_D_PAY, paySuccess, payOrder, 'lzV0xMdHte/DAN7/wj8KYH2ea1z3mv6vky89umDO5+w=', payAuthFail],
    [
      '3D Host',
      MODEL.THREE_D_HOST,
      hostSuccess,
      hostOrder,
      'Rq4uKD1lNC7KcDlQPpbKQHRdFufFUVfjNi0fVo06iAI=',
      hostAuthFail,
    ],
  ] as Array<[string, PaymentModel, () => Data, PosOrder, string, () => Data]>

  const confirmedStatus = (order: PosOrder, callback: Data) => (id: string) =>
    statusRecord(id, { InstallmentCount: String(order.installment), AuthCode: callback.AuthCode })

  describe.each(hosted)('%s', (_label, paymentModel, success, order, sha256Hash, authFail) => {
    const run = (callback: Data, o: PosOrder = order, options: BankOptions = {}, account = Q) => {
      const { sent, fetchImpl } = bankFetch({ status: confirmedStatus(o, success()), ...options })
      const promise = realGateway(fetchImpl, { account }).payment(paymentModel, o, TX_TYPE.PAY_AUTH, null, cb(callback))
      return { sent, promise }
    }

    // addition: F14 one status request confirms the approved callback
    it.each([
      ['SHA-1', success()],
      ['SHA-256', { ...success(), ResponseHash: sha256Hash }],
    ])('approves a signed approved callback confirmed by the bank (%s)', async (_name, callback) => {
      const { sent, promise } = run(callback)
      const res = (await promise) as Data
      expect(res.status).toBe('approved')
      expect(res.order_id).toBe(order.id)
      expect(res.auth_code).toBe(callback.AuthCode)
      expect(sent).toHaveLength(1)
      expect(sent[0]?.fields.SecureType).toBe('Inquiry')
      expect(sent[0]?.fields.OrgOrderId).toBe(order.id)
    })

    it('takes the authorization code and time from the confirming status record', async () => {
      const { promise } = run(success(), order, {
        status: (id) =>
          statusRecord(id, {
            InstallmentCount: String(order.installment),
            AuthCode: 'B12345',
            InsertDatetime: '01.11.2022 10:00:00',
          }),
      })
      const res = (await promise) as Data
      expect(res.auth_code).toBe('B12345')
      expect(res.transaction_time).toStrictEqual(new Date('2022-11-01T10:00:00+03:00'))
    })

    it('maps the signed auth_fail callback declined without a request', async () => {
      const callback = authFail()
      const { sent, promise } = run(callback, {
        ...order,
        id: callback.OrderId,
        installment: Number(callback.InstallmentCount),
      })
      expect(((await promise) as Data).status).toBe('declined')
      expect(sent).toHaveLength(0)
    })

    // addition: a genuine unsigned decline keeps its reason (informational only), nothing else of the callback
    it('maps an unsigned QNB decline declined with its reason and no request', async () => {
      const callback = authFail()
      delete callback.ResponseHash
      const { sent, promise } = run(callback, {
        ...order,
        id: callback.OrderId,
        installment: Number(callback.InstallmentCount),
      })
      const res = (await promise) as Data
      expect(res.status).toBe('declined')
      expect(res.order_id).toBe(callback.OrderId)
      expect(res.proc_return_code).toBe(callback.ProcReturnCode)
      expect(res.error_message).toBe(callback.ErrMsg)
      expect(res.md_status).toBe(callback['3DStatus'])
      expect(res.auth_code).toBeNull()
      expect(res.ref_ret_num).toBeNull()
      expect(sent).toHaveLength(0)
    })

    it('rejects an unsigned approved callback on the QNB account', async () => {
      const callback = success()
      delete callback.ResponseHash
      const { sent, promise } = run(callback)
      await expect(promise).rejects.toThrow(HashMismatchError)
      expect(sent).toHaveLength(0)
    })

    it('rejects an altered hash', async () => {
      const { sent, promise } = run({ ...success(), ResponseHash: `AAAA${String(success().ResponseHash).slice(4)}` })
      await expect(promise).rejects.toThrow(new HashMismatchError('3D callback hash mismatch'))
      expect(sent).toHaveLength(0)
    })

    // addition: F9 approved hosted pins
    it.each([
      ['an authorization code of five characters', { AuthCode: 'S8679' }],
      ['a 3D status of two digits', { '3DStatus': '11' }],
      ['a random value with an appended letter', { ResponseRnd: `${success().ResponseRnd}X` }],
    ])('rejects a signed approved callback with %s (malformed)', async (_name, change) => {
      const { sent, promise } = run(resign({ ...success(), ...change }))
      await expect(promise).rejects.toThrow(new HashMismatchError('3D callback fields are malformed'))
      expect(sent).toHaveLength(0)
    })

    // addition: F12 the mapped response is attached, the bank may have charged
    it('binding mismatch on the amount is OrderMismatchError with the response attached, no request', async () => {
      const { sent, promise } = run({ ...success(), PurchAmount: '2.00' })
      const err = await mismatch(promise)
      expect(err.field).toBe('amount')
      expect(err.paymentMayHaveCompleted).toBe(true)
      expect(err.response?.requires_manual_review).toBe(true)
      expect(sent).toHaveLength(0)
    })

    it('a status record in another currency is OrderMismatchError', async () => {
      const { sent, promise } = run(success(), order, {
        status: (id) => statusRecord(id, { InstallmentCount: String(order.installment), Currency: '392' }),
      })
      const err = await mismatch(promise)
      expect(err.field).toBe('currency')
      expect(err.paymentMayHaveCompleted).toBe(true)
      expect(err.response?.requires_manual_review).toBe(true)
      expect(sent).toHaveLength(1)
    })
  })

  // addition: FP4 approved but 3D failed → declined + manual review, no confirmation
  it('FP4: an approved 3D Pay callback with 3DStatus 2 is declined and flagged for manual review', async () => {
    const callback: Data = { ...paySuccess(), '3DStatus': '2', ResponseHash: 'D6tNwfxFB83dTee3Q6FCqbnIsy8=' }
    expect(resign(callback).ResponseHash).toBe(callback.ResponseHash)
    const { sent, fetchImpl } = bankFetch()
    const res = (await realGateway(fetchImpl).payment(
      MODEL.THREE_D_PAY,
      payOrder,
      TX_TYPE.PAY_AUTH,
      null,
      cb(callback),
    )) as Data
    expect(res.status).toBe('declined')
    expect(res.requires_manual_review).toBe(true)
    expect(sent).toHaveLength(0)
  })

  // addition: F9 a prefix re-split keeps the genuine hash but lands on the declined path
  it('a 3D Pay callback re-split for order 2022103114B is declined without a request', async () => {
    const callback: Data = { ...paySuccess(), OrderId: '2022103114B', AuthCode: '3S8679', ProcReturnCode: '700' }
    expect(callback.ResponseHash).toBe('il/SWNG2llQkLgnCbUG6lPYtlgM=')
    const { sent, fetchImpl } = bankFetch()
    const res = (await realGateway(fetchImpl).payment(
      MODEL.THREE_D_PAY,
      { ...payOrder, id: '2022103114B' },
      TX_TYPE.PAY_AUTH,
      null,
      cb(callback),
    )) as Data
    expect(res.status).toBe('declined')
    expect(sent).toHaveLength(0)
  })

  // addition: FP5 a correctly signed callback of another order
  it('FP5: a signed callback of order 2022103114B4 is OrderMismatchError for order 2022103114B3', async () => {
    const callback: Data = { ...paySuccess(), OrderId: '2022103114B4', ResponseHash: 'GEfGUxjEgSNlJQVs1KcfEtmwFKQ=' }
    const { sent, fetchImpl } = bankFetch()
    const err = await mismatch(
      realGateway(fetchImpl).payment(MODEL.THREE_D_PAY, payOrder, TX_TYPE.PAY_AUTH, null, cb(callback)),
    )
    expect(err.field).toBe('order_id')
    expect(sent).toHaveLength(0)
  })

  // addition: concurrent completions keep their own order on one gateway instance
  it('concurrent hosted completions each confirm their own order', async () => {
    const { sent, fetchImpl } = bankFetch({
      status: (id) => statusRecord(id, { InstallmentCount: '2', AuthCode: 'S86797' }),
    })
    const p = realGateway(fetchImpl)
    const other = { ...paySuccess(), OrderId: '2022103114B4', ResponseHash: 'GEfGUxjEgSNlJQVs1KcfEtmwFKQ=' }

    const [a, b] = (await Promise.all([
      p.payment(MODEL.THREE_D_PAY, payOrder, TX_TYPE.PAY_AUTH, null, cb(paySuccess())),
      p.payment(MODEL.THREE_D_PAY, { ...payOrder, id: '2022103114B4' }, TX_TYPE.PAY_AUTH, null, cb(other)),
    ])) as [Data, Data]

    expect(a.order_id).toBe('2022103114B3')
    expect(b.order_id).toBe('2022103114B4')
    expect(a.status).toBe('approved')
    expect(b.status).toBe('approved')
    expect(sent.map((s) => s.fields.OrgOrderId).sort()).toStrictEqual(['2022103114B3', '2022103114B4'])
  })
})

describe('PayForPos (end to end) Ziraat Katılım', () => {
  const zSuccess = (): Data => ({ ...paySuccess(), MbrId: '12', ResponseHash: 'a97tUevmnGoe7vCsuQ52b8Fyo7U=' })
  const confirmed =
    (overrides: Data = {}) =>
    (id: string) =>
      statusRecord(id, { InstallmentCount: '2', AuthCode: 'S86797', ...overrides })

  const run = (callback: Data, options: BankOptions = {}, cfg: GatewayConfig = config) => {
    const { sent, fetchImpl } = bankFetch({ status: confirmed(), ...options })
    const promise = realGateway(fetchImpl, { account: Z, cfg }).payment(
      MODEL.THREE_D_PAY,
      payOrder,
      TX_TYPE.PAY_AUTH,
      null,
      cb(callback),
    )
    return { sent, promise }
  }

  // addition: F11 a signed Ziraat callback verifies (FV3) and is confirmed
  it('a signed 3D Pay callback is verified and confirmed', async () => {
    expect(resign(zSuccess(), Z).ResponseHash).toBe('a97tUevmnGoe7vCsuQ52b8Fyo7U=')
    const { sent, promise } = run(zSuccess())
    expect(((await promise) as Data).status).toBe('approved')
    expect(sent).toHaveLength(1)
  })

  it('an unsigned successful 3D Pay callback is approved only by the bank status record', async () => {
    const callback = zSuccess()
    delete callback.ResponseHash
    const { sent, promise } = run(callback)
    expect(((await promise) as Data).status).toBe('approved')
    expect(sent).toHaveLength(1)
  })

  it('an unsigned successful callback whose status record shows another amount is OrderMismatchError', async () => {
    const callback = zSuccess()
    delete callback.ResponseHash
    const { promise } = run(callback, { status: confirmed({ PurchAmount: '5.00' }) })
    const err = await mismatch(promise)
    expect(err.field).toBe('amount')
    expect(err.paymentMayHaveCompleted).toBe(true)
  })

  it('require_3d_hash rejects an unsigned callback', async () => {
    const callback = zSuccess()
    delete callback.ResponseHash
    const { sent, promise } = run(callback, {}, { ...config, require_3d_hash: true })
    await expect(promise).rejects.toThrow(new HashMismatchError('3D callback has no ResponseHash'))
    expect(sent).toHaveLength(0)
  })

  it('a garbage ResponseHash is rejected', async () => {
    const { sent, promise } = run({ ...zSuccess(), ResponseHash: 'AAAA' })
    await expect(promise).rejects.toThrow(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: an unsigned 3D Secure callback would make the merchant send a provision for a request guid nobody
  // signed, so it is refused before any request, whatever it reports
  it.each([
    ['a successful', () => ({ ...secureSuccess(), MbrId: '12' })],
    ['a declined', () => ({ ...secureAuthFail(), MbrId: '12' })],
  ])('%s unsigned 3D Secure callback is refused before any request', async (_name, make) => {
    const callback: Data = make()
    delete callback.ResponseHash
    const { sent, fetchImpl } = bankFetch()
    await expect(
      realGateway(fetchImpl, { account: Z }).payment(
        MODEL.THREE_D_SECURE,
        { ...secureOrder, id: callback.OrderId as string },
        TX_TYPE.PAY_AUTH,
        null,
        cb(callback),
      ),
    ).rejects.toThrow(new HashMismatchError('3D callback has no ResponseHash'))
    expect(sent).toHaveLength(0)
  })

  // addition: a signed Ziraat 3D Secure callback is provisioned and confirmed
  it('a signed 3D Secure success is provisioned and confirmed', async () => {
    const callback = resign({ ...secureSuccess(), MbrId: '12' }, Z)
    const { sent, fetchImpl } = bankFetch()
    const res = (await realGateway(fetchImpl, { account: Z }).payment(
      MODEL.THREE_D_SECURE,
      secureOrder,
      TX_TYPE.PAY_AUTH,
      null,
      cb(callback),
    )) as Data
    expect(res.status).toBe('approved')
    expect(sent.map((s) => s.fields.SecureType)).toStrictEqual(['3DModelPayment', 'Inquiry'])
  })

  // addition: an unsigned 3D Host success is approved only by the bank status record too
  it('an unsigned successful 3D Host callback is approved only by the bank status record', async () => {
    const callback: Data = { ...hostSuccess(), MbrId: '12' }
    delete callback.ResponseHash
    const { sent, fetchImpl } = bankFetch({
      status: (id) => statusRecord(id, { InstallmentCount: '3', AuthCode: callback.AuthCode }),
    })
    const res = (await realGateway(fetchImpl, { account: Z }).payment(
      MODEL.THREE_D_HOST,
      hostOrder,
      TX_TYPE.PAY_AUTH,
      null,
      cb(callback),
    )) as Data
    expect(res.status).toBe('approved')
    expect(sent.map((s) => s.fields.SecureType)).toStrictEqual(['Inquiry'])
  })

  // addition: an unsigned callback is not evidence that money moved; only the bank's record of the order is
  describe('manual review needs bank evidence for unsigned callbacks', () => {
    const notFound = () => statusRecord('', { ProcReturnCode: 'V013', ErrMsg: 'Kayıt bulunamadı' })
    const unsigned = (change: Data = {}): Data => {
      const callback: Data = { ...zSuccess(), ...change }
      delete callback.ResponseHash
      return callback
    }

    it('an unsigned approved callback with 3DStatus 2 is plain declined when the bank holds no payment', async () => {
      const { sent, promise } = run(unsigned({ '3DStatus': '2' }), { status: () => notFound() })
      const res = (await promise) as Data
      expect(res.status).toBe('declined')
      expect(res.requires_manual_review).toBeUndefined()
      expect(sent.map((s) => s.fields.SecureType)).toStrictEqual(['Inquiry'])
    })

    it('an unsigned approved callback with 3DStatus 2 is flagged when the bank holds an approved payment', async () => {
      const { sent, promise } = run(unsigned({ '3DStatus': '2' }))
      const res = (await promise) as Data
      expect(res.status).toBe('declined')
      expect(res.requires_manual_review).toBe(true)
      expect(sent).toHaveLength(1)
    })

    it('a signed approved callback with 3DStatus 2 is flagged without a request', async () => {
      const { sent, promise } = run(resign({ ...zSuccess(), '3DStatus': '2' }, Z))
      const res = (await promise) as Data
      expect(res.status).toBe('declined')
      expect(res.requires_manual_review).toBe(true)
      expect(sent).toHaveLength(0)
    })

    it('an unsigned approved callback the bank does not know is OrderMismatchError without the response', async () => {
      const { sent, promise } = run(unsigned(), { status: () => notFound() })
      const err = await mismatch(promise)
      expect(err.field).toBe('order_status')
      expect(err.paymentMayHaveCompleted).toBe(false)
      expect(err.response).toBeUndefined()
      expect(sent).toHaveLength(1)
    })

    it('an unsigned approved callback whose record belongs to another order is OrderMismatchError without the response', async () => {
      const { promise } = run(unsigned(), { status: () => confirmed({ OrderId: '2022103114B4' })('') })
      const err = await mismatch(promise)
      expect(err.field).toBe('order_id')
      expect(err.paymentMayHaveCompleted).toBe(false)
      expect(err.response).toBeUndefined()
    })

    it('a signed approved callback the bank does not know keeps the response attached', async () => {
      const { promise } = run(zSuccess(), { status: () => notFound() })
      const err = await mismatch(promise)
      expect(err.field).toBe('order_status')
      expect(err.paymentMayHaveCompleted).toBe(true)
      expect(err.response?.requires_manual_review).toBe(true)
    })

    it.each([
      ['amount', { PurchAmount: '2.00' }],
      ['order_id', { OrderId: '2022103114B4' }],
    ])(
      'an unsigned approved callback with another %s is OrderMismatchError without the response when the bank holds no payment',
      async (field, change) => {
        const { sent, promise } = run(unsigned(change), { status: () => notFound() })
        const err = await mismatch(promise)
        expect(err.field).toBe(field)
        expect(err.paymentMayHaveCompleted).toBe(false)
        expect(err.response).toBeUndefined()
        expect(sent.map((s) => s.fields.OrgOrderId)).toStrictEqual([payOrder.id])
      },
    )

    // addition: values of an unsigned callback never reach a result; only the order and the bank record do
    const forged: Data = {
      AuthCode: '<img src=x onerror=alert(1)>',
      HostRefNum: 'FORGED000001',
      CardMask: '999999******9999',
      BatchNo: '9999',
      Eci: 'xx',
      TransId: 'FORGED-TRANS',
      TransactionDate: '01.01.2030 00:00:00',
      ErrMsg: '<b>forged</b>',
    }
    const expectNoCallbackValues = (res: Data): void => {
      expect(res.order_id).toBe(payOrder.id)
      for (const key of ['batch_num', 'eci', 'transaction_id', 'md_status', 'tx_status', 'error_message']) {
        expect(res[key], key).toBeNull()
      }
      expect(JSON.stringify({ ...res, all: null })).not.toMatch(/FORGED|onerror|9999|forged|2030/)
    }

    it('an approved unsigned result takes its references from the bank record or leaves them null', async () => {
      const { sent, promise } = run(unsigned(forged), {
        status: confirmed({ AuthCode: '', InsertDatetime: '', HostRefNum: '', CardMask: '' }),
      })
      const res = (await promise) as Data
      expect(res.status).toBe('approved')
      expectNoCallbackValues(res)
      expect(res.auth_code).toBeNull()
      expect(res.transaction_time).toBeNull()
      expect(res.ref_ret_num).toBeNull()
      expect(res.masked_number).toBeNull()
      expect(sent).toHaveLength(1)
    })

    it('a mismatching unsigned callback attaches a response bound to the order, not to the callback', async () => {
      const { sent, promise } = run(unsigned({ ...forged, OrderId: 'VICTIM9999' }))
      const err = await mismatch(promise)
      expect(err.field).toBe('order_id')
      expect(err.paymentMayHaveCompleted).toBe(true)
      expectNoCallbackValues(err.response as Data)
      expect(err.response?.auth_code).toBe('S86797')
      expect(err.response?.ref_ret_num).toBe('230422098249')
      expect(sent).toHaveLength(1)
    })

    it('an unsigned approved-without-3D result flagged for review carries only bank data', async () => {
      const { sent, promise } = run(unsigned({ ...forged, '3DStatus': '2' }))
      const res = (await promise) as Data
      expect(res.status).toBe('declined')
      expect(res.requires_manual_review).toBe(true)
      expectNoCallbackValues(res)
      expect(res.auth_code).toBe('S86797')
      expect(res.ref_ret_num).toBe('230422098249')
      expect(res.masked_number).toBe('415565******6111')
      expect(sent).toHaveLength(1)
    })

    it('an unsigned declined result keeps only its decline reasons and sends nothing', async () => {
      const { sent, promise } = run(unsigned({ ...forged, ProcReturnCode: '05' }))
      const res = (await promise) as Data
      expect(res.status).toBe('declined')
      // the decline reasons are the callback's own text, informational only
      expect(res.proc_return_code).toBe('05')
      expect(res.error_message).toBe('<b>forged</b>')
      expect(res.md_status).toBe('1')
      const { proc_return_code: _p, error_code: _c, error_message: _m, md_status: _s, ...rest } = res
      expectNoCallbackValues({ ...rest, error_message: null, md_status: null })
      expect(res.auth_code).toBeNull()
      expect(res.ref_ret_num).toBeNull()
      expect(res.masked_number).toBeNull()
      expect(sent).toHaveLength(0)
    })

    it('an unsigned approved callback with another amount keeps the response when the bank holds a payment', async () => {
      const { promise } = run(unsigned({ PurchAmount: '2.00' }))
      const err = await mismatch(promise)
      expect(err.field).toBe('amount')
      expect(err.paymentMayHaveCompleted).toBe(true)
      expect(err.response?.requires_manual_review).toBe(true)
    })
  })
})

describe('PayForPos (end to end) 3D form', () => {
  const formOrder: PosOrder = {
    id: '2020110828BC',
    amount: 100.01,
    currency: CURRENCY.TRY,
    installment: 0,
    success_url: 'https://example.com/ok',
    fail_url: 'https://example.com/fail',
  }
  const formHash = (inputs: Data): string =>
    createHash('sha1')
      .update(
        `${inputs.MbrId}${inputs.OrderId}${inputs.PurchAmount}${inputs.OkUrl}${inputs.FailUrl}${inputs.TxnType}${inputs.InstallmentCount}${inputs.Rnd}${MERCHANT_PASS}`,
        'utf8',
      )
      .digest('base64')

  // addition: the array form is signed over the posted values
  it('builds the array form for 3D with a hash recomputed in the test', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    const c = CreditCardFactory.createForGateway(p, '5555444433332222', '21', '12', '122', 'ahmet', CARD_TYPE.VISA)
    const form = (await p.get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, c)) as Data
    expect(form.gateway).toBe(GATEWAY_3D)
    expect(form.inputs.Hash).toBe(formHash(form.inputs))
    expect(form.inputs.PurchAmount).toBe('100.01')
    expect(sent).toHaveLength(0)
  })

  // addition: F19 the html form posts the signed form fields and returns the bank page as is
  it('posts the form for the html format and returns the bank page', async () => {
    const { sent, fetchImpl } = bankFetch({ form: '<html>ok</html>' })
    const p = realGateway(fetchImpl)
    const c = CreditCardFactory.createForGateway(p, '5555444433332222', '21', '12', '122', 'ahmet', CARD_TYPE.VISA)
    const html = await p.get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, c, false, FORM_FORMAT.HTML)
    expect(html).toBe('<html>ok</html>')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(GATEWAY_3D)
    expect(sent[0]?.fields.Pan).toBe('5555444433332222')
    expect(sent[0]?.fields.Cvv2).toBe('122')
    expect(sent[0]?.fields.Hash).toBe(formHash(sent[0]?.fields as Data))
  })

  it('an empty bank page is PosError', async () => {
    const { fetchImpl } = bankFetch({ form: '' })
    const p = realGateway(fetchImpl)
    const c = CreditCardFactory.createForGateway(p, '5555444433332222', '21', '12', '122', 'ahmet', CARD_TYPE.VISA)
    await expect(
      p.get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, c, false, FORM_FORMAT.HTML),
    ).rejects.toThrow(new PosError('3D form data could not be created'))
  })

  it('an error status from the 3D gateway is PosHttpError', async () => {
    const { fetchImpl } = bankFetch({ form: new Response('Request Rejected', { status: 403 }) })
    const p = realGateway(fetchImpl)
    const c = CreditCardFactory.createForGateway(p, '5555444433332222', '21', '12', '122', 'ahmet', CARD_TYPE.VISA)
    await expect(
      p.get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, c, false, FORM_FORMAT.HTML),
    ).rejects.toThrow(PosHttpError)
  })
})

describe('PayForPos (end to end) masking', () => {
  // addition: F23 nothing secret reaches the logger
  it('never logs the 3D secret, the user password, the card number, the CVV or a generated hash', async () => {
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
    const { sent, fetchImpl } = bankFetch({
      form: '<html>ok</html>',
      status: (id) =>
        id === '2022103114B3' ? statusRecord(id, { InstallmentCount: '2', AuthCode: 'S86797' }) : statusRecord(id),
    })
    const p = realGateway(fetchImpl, { logger })
    const c = CreditCardFactory.createForGateway(p, '5555444433332222', '21', '12', '122', 'ahmet', CARD_TYPE.VISA)
    const formOrder: PosOrder = {
      id: '2020110828BC',
      amount: 1.01,
      currency: CURRENCY.TRY,
      installment: 0,
      success_url: 'https://example.com/ok',
      fail_url: 'https://example.com/fail',
    }

    const form = (await p.get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, c)) as Data
    await p.get3DFormData(formOrder, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, c, false, FORM_FORMAT.HTML)
    await p.payment(
      MODEL.NON_SECURE,
      { id: 'N1', amount: 1.01, currency: CURRENCY.TRY, installment: 0 },
      TX_TYPE.PAY_AUTH,
      c,
    )
    await p.payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, cb(secureSuccess()))
    await p.payment(MODEL.THREE_D_PAY, payOrder, TX_TYPE.PAY_AUTH, null, cb(paySuccess()))
    await p
      .payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, cb({ ...secureSuccess(), Currency: '392' }))
      .catch(() => undefined)
    await p
      .payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, cb({ ...secureSuccess(), ResponseHash: 'x' }))
      .catch(() => undefined)

    const logged = JSON.stringify(records)
    expect(records.length).toBeGreaterThan(0)
    expect(sent.length).toBe(5)
    expect(logged).not.toContain(MERCHANT_PASS)
    expect(logged).not.toContain(USER_PASS)
    expect(logged).not.toContain('5555444433332222')
    expect(logged).not.toMatch(/cvv2?\\?"\s*:\s*\\?"?122/i)
    expect(logged).not.toContain(form.inputs.Hash)
    const htmlFormHash = sent.find((s) => s.url === GATEWAY_3D)?.fields.Hash as string
    expect(htmlFormHash).toMatch(/^[A-Za-z0-9+/]{27}=$/)
    expect(logged).not.toContain(htmlFormHash)
  })
})

describe('PayForPos (end to end) unknown outcome after a money request', () => {
  const UNKNOWN = 'Bank answer carries no result; the outcome is unknown'
  const resultless: Array<[string, () => Data | Response | string]> = [
    ['HTTP 204', () => new Response(null, { status: 204 })],
    ['an empty root', () => ({})],
    ['a record without ProcReturnCode', () => ({ AuthCode: 'S37397', TransId: '20221031CFD0', ErrMsg: '' })],
    ['an empty ProcReturnCode', () => ({ ProcReturnCode: '', TransId: '20221031CFD0' })],
    ['a blank ProcReturnCode', () => ({ ProcReturnCode: ' ', TransId: '20221031CFD0' })],
    ['ProcReturnCode twice', () => ({ ProcReturnCode: ['00', '00'], TransId: '20221031CFD0' })],
    ['a nested ProcReturnCode', () => ({ ProcReturnCode: { Code: '00' }, TransId: '20221031CFD0' })],
  ]
  const order: PosOrder = { ...secureOrder }

  // addition: L3 a sale, pre-/post-authorization or refund whose answer carries no result is an unknown outcome
  it.each(resultless)(
    'a sale, pre-/post-auth and full/partial refund answered with %s are PosHttpError',
    async (_n, answer) => {
      const card = (p: PayForPos) =>
        CreditCardFactory.createForGateway(p, '5555444433332222', '21', '12', '122', 'ahmet', CARD_TYPE.VISA)
      const actions: Array<(p: PayForPos) => Promise<unknown>> = [
        (p) => p.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card(p)),
        (p) => p.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_PRE_AUTH, card(p)),
        (p) => p.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_POST_AUTH),
        (p) => p.refund(order),
        (p) => p.refund({ ...order, amount: 0.5, order_amount: 1.01 }),
      ]
      for (const action of actions) {
        const { sent, fetchImpl } = bankFetch({ other: answer() })
        const err = await action(realGateway(fetchImpl)).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(PosHttpError)
        expect([(err as PosHttpError).message, (err as PosHttpError).url]).toStrictEqual([UNKNOWN, PAYMENT_API])
        expect(sent).toHaveLength(1)
      }
    },
  )

  // addition: L3 the 3D provision answer is checked before it is mapped or confirmed
  it.each(resultless)('a 3D Secure provision answered with %s is PosHttpError, never mapped', async (_n, answer) => {
    const reply = answer()
    const { sent, fetchImpl } = bankFetch({ provision: typeof reply === 'string' ? new Response(reply) : reply })
    const mapped = vi.spyOn(PayForPosResponseDataMapper.prototype, 'map3DPaymentData')
    try {
      const err = await realGateway(fetchImpl)
        .payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, cb(secureSuccess()))
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PosHttpError)
      expect([(err as PosHttpError).message, (err as PosHttpError).url]).toStrictEqual([UNKNOWN, PAYMENT_API])
      expect(sent.map((s) => s.fields.SecureType)).toStrictEqual(['3DModelPayment'])
      expect(mapped).not.toHaveBeenCalled()
    } finally {
      mapped.mockRestore()
    }
  })

  // addition: L3 a genuine decline with a result code is still a decline; a cancel moves no new money
  it('a refund declined with ProcReturnCode M041 is declined and a cancel answered with 204 too', async () => {
    const declined = { ProcReturnCode: 'M041', ErrMsg: 'Kayıp kart', TransId: '20221031CFD0' }
    const refund = await realGateway(bankFetch({ other: declined }).fetchImpl).refund(order)
    expect([refund.status, refund.proc_return_code]).toStrictEqual(['declined', 'M041'])

    const cancel = await realGateway(bankFetch({ other: new Response(null, { status: 204 }) }).fetchImpl).cancel(order)
    expect(cancel.status).toBe('declined')
  })
})
