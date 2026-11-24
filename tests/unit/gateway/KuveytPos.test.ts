import { createHash } from 'node:crypto'
import iconv from 'iconv-lite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import type { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { boaCallbackHash, KuveytPosCrypt } from '../../../src/crypt/KuveytPosCrypt.js'
import { KuveytPosRequestDataMapper } from '../../../src/data-mapper/request/mapper/KuveytPosRequestDataMapper.js'
import type { RequestDataMapperInterface } from '../../../src/data-mapper/request/mapper/RequestDataMapperInterface.js'
import { KuveytPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/KuveytPosRequestValueFormatter.js'
import { KuveytPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/KuveytPosRequestValueMapper.js'
import { KuveytPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/KuveytPosResponseDataMapper.js'
import type { ResponseDataMapperInterface } from '../../../src/data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { BoaPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/BoaPosResponseValueFormatter.js'
import { KuveytPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/KuveytPosResponseValueMapper.js'
import {
  HashMismatchError,
  OrderMismatchError,
  PosError,
  PosHttpError,
  UnsupportedFormFormatError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../src/factory/CreditCardFactory.js'
import { PosHttpClientStrategyFactory } from '../../../src/factory/PosHttpClientStrategyFactory.js'
import type { GatewayConfig, GatewayDeps } from '../../../src/gateway/AbstractGateway.js'
import { KuveytPos } from '../../../src/gateway/KuveytPos.js'
import type { PosLogger } from '../../../src/logger.js'
import type { BoaPosAccount } from '../../../src/model/account/BoaPosAccount.js'
import {
  CARD_TYPE,
  CURRENCY,
  FORM_FORMAT,
  type FormFormat,
  LANG,
  MODEL,
  type PaymentModel,
  TX_TYPE,
  type TxType,
} from '../../../src/PosInterface.js'
import { XmlDecoder } from '../../../src/serializer/XmlDecoder.js'
import type { GatewayResponseData, PosHooks, PosOrder, RequestDataPreparedEvent } from '../../../src/types.js'
import {
  cancelTestDataProvider,
  paymentTestDataProvider,
  refundTestDataProvider,
  statusTestDataProvider,
  threeDPaymentDataProvider,
} from '../data-mapper/response/mapper/KuveytPosResponseDataMapper.data.js'
import { AUTH_FAIL_RESPONSE, AUTH_SUCCESS_PAYMENT_FAIL_RESPONSE } from '../serializer/kuveytPosCallbackFixtures.js'

// The first section replaces the collaborators with vi.fn() fakes (except the request value mapper); the end-to-end
// sections use the real crypt, mappers and HTTP clients over a fake fetch that answers like the bank (XML gateway by
// path, SOAP service by SOAPAction) and records every request.

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

const PAYMENT_API = 'https://boatest.kuveytturk.com.tr/boa.virtualpos.services/Home'
const QUERY_API =
  'https://boatest.kuveytturk.com.tr/BOA.Integration.WCFService/BOA.Integration.VirtualPos/VirtualPosService.svc/Basic'
const SOAP_ACTION_PREFIX = 'http://boa.net/BOA.Integration.VirtualPos/Service/IVirtualPosService/'

// deviation: the ported config names only gateway_3d; the clients need payment_api and query_api
const config: GatewayConfig = {
  name: 'kuveyt-pos',
  class: 'KuveytPos',
  gateway_endpoints: { payment_api: PAYMENT_API, query_api: QUERY_API },
}

const PASSWORD = 'Api123'
const KG = AccountFactory.createBoaPosAccount('kuveytpos', '496', 'apiuser1', '400235', PASSWORD)
const KM = AccountFactory.createBoaPosAccount('kuveytpos', '80', 'apiuser', '400235', PASSWORD)

const S1 = (text: string): string => createHash('sha1').update(text, 'utf8').digest('base64')
const HP = (password: string): string => S1(password)
/** The hashed password of `KG`/`KM` (the bank calls it `HashPassword`). */
const HASH_PASSWORD = HP(PASSWORD)
/** The callback signature over the three signed values. */
const CB = (m: unknown, r: unknown, o: unknown, hp = HASH_PASSWORD): string => S1(`${m}${r}${o}${hp}`)
/** The request signature. */
const RQ = (d: Data, hp = HASH_PASSWORD): string =>
  S1(`${d.MerchantId}${d.MerchantOrderId ?? ''}${d.Amount ?? ''}${d.OkUrl ?? ''}${d.FailUrl ?? ''}${d.UserName}${hp}`)

const createLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })

const cb = (data: Data): GatewayResponseData => data as GatewayResponseData

const pick = <T>(rows: Array<[string, T]>, name: string): T => {
  const row = rows.find(([n]) => n === name)
  if (row === undefined) throw new Error(`no fixture row ${name}`)
  return row[1]
}

// ---------- XML helpers ----------

const esc = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** An element: text, nested records (`@` keys are attributes, `#` the text), lists repeat the element. */
function element(name: string, value: unknown): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.map((v) => element(name, v)).join('')
  if (typeof value === 'object') {
    const record = value as Data
    const keys = Object.keys(record)
    const attributes = keys
      .filter((k) => k.startsWith('@'))
      .map((k) => ` ${k.slice(1)}="${esc(String(record[k]))}"`)
      .join('')
    const text = typeof record['#'] === 'string' ? esc(record['#']) : ''
    const children = keys
      .filter((k) => !k.startsWith('@') && k !== '#')
      .map((k) => element(k, record[k]))
      .join('')
    return `<${name}${attributes}>${text}${children}</${name}>`
  }
  return `<${name}>${esc(String(value))}</${name}>`
}

const callbackXml = (fields: Data): string => `<?xml version="1.0"?>\n${element('VPosTransaction', fields)}\n`

/** Form encoding as the browser posts it (`+` for spaces). */
const formEncode = (text: string): string => encodeURIComponent(text).replaceAll('%20', '+')

const authResponse = (fields: Data): string => formEncode(callbackXml(fields))

const provisionXml = (record: Data): string =>
  `<?xml version="1.0" encoding="utf-8"?>${element('VPosTransactionResponseContract', record)}`

const soapXml = (body: Data): string =>
  `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${Object.entries(body)
    .map(([k, v]) => element(k, v))
    .join('')}</s:Body></s:Envelope>`

// ---------- callbacks ----------

const NS = {
  '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
  '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
}
const NIL = { '@xsi:nil': 'true', '#': '' }
const MD_TDV2 = 'KdipxuB/+AncDNdIKzh5uRh4flnYqSp3drh/2yzaOQraHWjGF+NOkvSjYzbQtRQn'
const ORDER_ID = '2024042111A0'
const BANK_ORDER_ID = '155767806'

/** The `VPosMessage` of the bank's TDV2 callback (the echo of the 3D form; not signed). */
const tdv2Message = (over: Data = {}): Data => ({
  OrderId: BANK_ORDER_ID,
  OkUrl: 'http://localhost/kuveytpos/3d/response.php',
  FailUrl: 'http://localhost/kuveytpos/3d/response.php',
  MerchantId: '496',
  SubMerchantId: '0',
  CustomerId: '400235',
  UserName: '',
  HashPassword: '',
  CardNumber: '51889619****2544',
  IsTemporaryCard: NIL,
  BatchID: '545',
  InstallmentCount: '0',
  Amount: '101',
  CancelAmount: '0',
  MerchantOrderId: ORDER_ID,
  FECAmount: '0',
  CurrencyCode: '949',
  TransactionSecurity: '3',
  ...over,
})

/**
 * The bank's TDV2 callback fields for `ORDER_ID` (1.01 TRY). `HashData` is recomputed over the signed values with
 * `KG`'s password unless `over` names it (`HashData: undefined` leaves it out); `message` null sends no `VPosMessage`.
 */
const tdv2 = (over: Data = {}, message: Data | null = tdv2Message()): Data => {
  const fields: Data = {
    ...NS,
    VPosMessage: message ?? undefined,
    IsEnrolled: 'true',
    IsVirtual: 'false',
    ResponseCode: '00',
    ResponseMessage: 'Kart doğrulandı.',
    OrderId: BANK_ORDER_ID,
    TransactionTime: '0001-01-01T00:00:00',
    MerchantOrderId: ORDER_ID,
    MD: MD_TDV2,
    ReferenceId: '1d2a9d4cc853468090d915943341ad89',
    MerchantId: NIL,
    BusinessKey: '202404219999000000009059964',
    ...over,
  }
  if (!Object.hasOwn(over, 'HashData')) {
    fields.HashData = CB(fields.MerchantOrderId, fields.ResponseCode, fields.OrderId)
  }
  return fields
}

const tdv2Order = (over: PosOrder = {}): PosOrder => ({
  id: ORDER_ID,
  amount: 1.01,
  currency: CURRENCY.TRY,
  installment: 0,
  ip: '127.0.0.1',
  ...over,
})

/** The decoded `AUTH_FAIL_RESPONSE` (the bank's unsigned `HashDataError` decline). */
const AUTH_FAIL_DECODED: Data = {
  '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
  '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
  IsEnrolled: 'true',
  IsVirtual: 'false',
  ResponseCode: 'HashDataError',
  ResponseMessage: 'Şifrelenen veriler (Hashdata) uyuşmamaktadır.',
  OrderId: '0',
  TransactionTime: '0001-01-01T00:00:00',
  MerchantOrderId: '2020110828BC',
  ReferenceId: '9b8e2326a9df44c2b2aac0b98b11f0a4',
  BusinessKey: '0',
}

/** The decoded `AUTH_SUCCESS_PAYMENT_FAIL_RESPONSE` (a genuine classic callback of merchant 48544, order MP-15). */
const AUTH_SUCCESS_DECODED: Data = {
  '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
  '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
  VPosMessage: {
    OrderId: '86483278',
    OkUrl: 'https://www.example.com/testodeme',
    FailUrl: 'https://www.example.com/testodeme',
    MerchantId: '48544',
    SubMerchantId: '0',
    CustomerId: '123456',
    UserName: 'fapapi',
    HashPassword: 'Hiorgg24rNeRdHUvMCg//mOJn4U=',
    CardNumber: '5124********1609',
    BatchID: '1576',
    InstallmentCount: '0',
    Amount: '10',
    CancelAmount: '0',
    MerchantOrderId: 'MP-15',
    FECAmount: '0',
    CurrencyCode: '949',
    QeryId: '0',
    DebtId: '0',
    SurchargeAmount: '0',
    SGKDebtAmount: '0',
    TransactionSecurity: '3',
    DeferringCount: NIL,
    InstallmentMaturityCommisionFlag: '0',
    PaymentId: NIL,
    OrderPOSTransactionId: NIL,
    TranDate: NIL,
    TransactionUserId: NIL,
  },
  IsEnrolled: 'true',
  IsVirtual: 'false',
  ResponseCode: '00',
  ResponseMessage: 'Kart doğrulandı.',
  OrderId: '86483278',
  TransactionTime: '0001-01-01T00:00:00',
  MerchantOrderId: 'MP-15',
  HashData: 'mOw0JGvy1JVWqDDmFyaDTvKz9Fk=',
  MD: 'ktSVkYJHcHSYM1ibA/nM6nObr8WpWdcw34ziyRQRLv06g7UR2r5LrpLeNvwfBwPz',
  BusinessKey: '202208456498416947',
}

/**
 * The ported `success` callback (the bank's documentation sample) resigned for order `Order-123`: the top-level
 * `MerchantOrderId` and `HashData` are added, the message id changed and the bank id set.
 */
const SUCCESS_DECODED: Data = {
  VPosMessage: {
    APIVersion: '1.0.0',
    OkUrl: 'http://localhost:44785/Home/Success',
    FailUrl: 'http://localhost:44785/Home/Fail',
    HashData: 'lYJYMi/gVO9MWr32Pshaa/zAbSHY=',
    MerchantId: '80',
    SubMerchantId: '0',
    CustomerId: '400235',
    UserName: 'apiuser',
    CardNumber: '5124********1609',
    CardHolderName: 'afafa',
    CardType: 'MasterCard',
    BatchID: '0',
    TransactionType: 'Sale',
    InstallmentCount: '0',
    Amount: '100',
    DisplayAmount: '100',
    MerchantOrderId: 'Order-123',
    FECAmount: '0',
    CurrencyCode: '0949',
    QeryId: '0',
    DebtId: '0',
    SurchargeAmount: '0',
    SGKDebtAmount: '0',
    TransactionSecurity: '3',
    TransactionSide: 'Auto',
    EntryGateMethod: 'VPOS_ThreeDModelPayGate',
  },
  IsEnrolled: 'true',
  IsVirtual: 'false',
  OrderId: '86483278',
  TransactionTime: '0001-01-01T00:00:00',
  ResponseCode: '00',
  ResponseMessage: 'HATATA',
  MD: '67YtBfBRTZ0XBKnAHi8c/A==',
  AuthenticationPacket: 'WYGDgSIrSHDtYwF/WEN+nfwX63sppA=',
  ACSURL: 'https://acs.bkm.com.tr/mdpayacs/pareq',
  MerchantOrderId: 'Order-123',
  HashData: CB('Order-123', '00', '86483278'),
}

describe('KuveytPos planning vectors', () => {
  // addition: KS1-KS3, CV1, CV2 recomputed with node:crypto and the crypt helper
  it.each([
    ['KS1', CB('MP-15', '00', '86483278'), 'fKhJ/ZYX0uG42wAVd4Eiff3KDAU='],
    ['KS2', CB(ORDER_ID, '00', BANK_ORDER_ID), 'xg2w5Ag0VAzlgVi+SfQdfVhPvaQ='],
    ['KS3', CB('2020110828BC', 'HashDataError', '0'), 'aSsSPGkfWmsIyydlSiG700uT0Mk='],
    ['CV1', CB(ORDER_ID, '00', BANK_ORDER_ID, HP('api123')), 'dlO20ZLqs4W5FfgY0VmUSBUpwoM='],
    ['CV2', boaCallbackHash('Hiorgg24rNeRdHUvMCg//mOJn4U=', 'MP-15', '00', '86483278'), 'mOw0JGvy1JVWqDDmFyaDTvKz9Fk='],
    ['HashPassword of Api123', HASH_PASSWORD, 'c77dFssAnYSy6O2MJo+5tMYtGVc='],
  ])('%s', (_name, actual, expected) => {
    expect(actual).toBe(expected)
  })

  // addition: B5 the two re-splits the pins cannot close keep the genuine signature
  it('BP1 and BP2 re-reads keep the genuine signature', () => {
    expect(CB('A', '00', '1005000')).toBe(CB('A001', '00', '5000'))
    expect(CB('B1', '00', '510')).toBe(CB('B100', '51', '0'))
    // a re-read for the prefix of a real order id moves a leading zero into the bank id
    expect(CB('2024042111A', '00', '0155767806')).toBe(CB(ORDER_ID, '00', BANK_ORDER_ID))
  })
})

describe('KuveytPos (mocked collaborators)', () => {
  const account = KG
  let requestValueMapper: KuveytPosRequestValueMapper
  let requestMapper: Mocked<RequestDataMapperInterface>
  let responseMapper: Mocked<ResponseDataMapperInterface>
  let crypt: Mocked<CryptInterface>
  let httpClient: { supportsTx: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }
  let clientStrategy: { getClient: ReturnType<typeof vi.fn>; getAllClients: ReturnType<typeof vi.fn> }
  let requestDataPrepared: ReturnType<typeof vi.fn<(e: RequestDataPreparedEvent) => void>>
  let logger: ReturnType<typeof createLogger>
  let pos: KuveytPos

  const baseOrder: PosOrder = {
    id: '2020110828BC',
    amount: 10.01,
    installment: 0,
    currency: CURRENCY.TRY,
    success_url: 'http://localhost/finansbank-payfor/3d/response.php',
    fail_url: 'http://localhost/finansbank-payfor/3d/response.php',
    ip: '127.0.0.1',
    lang: LANG.TR,
  }

  const createGateway = (cfg: GatewayConfig = config, acc: BoaPosAccount = account): KuveytPos => {
    const hooks: PosHooks = { onRequestDataPrepared: [requestDataPrepared] }
    const deps: GatewayDeps<BoaPosAccount> = {
      requestValueMapper,
      requestValueFormatter: new KuveytPosRequestValueFormatter(),
      requestDataMapper: requestMapper as unknown as RequestDataMapperInterface<BoaPosAccount>,
      responseDataMapper: responseMapper as unknown as ResponseDataMapperInterface,
      crypt: crypt as unknown as CryptInterface<BoaPosAccount>,
      clientStrategy: clientStrategy as unknown as HttpClientStrategy,
      logger,
      hooks,
    }
    return new KuveytPos(cfg, acc, deps)
  }

  beforeEach(() => {
    requestValueMapper = new KuveytPosRequestValueMapper()
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
    pos = createGateway()
  })

  const card = () =>
    CreditCardFactory.createForGateway(pos, '4155650100416111', '25', '1', '123', 'John Doe', CARD_TYPE.VISA)

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
      expect(event.gatewayClass).toBe('KuveytPos')
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

  const expectNoRequest = () => {
    expect(httpClient.request).not.toHaveBeenCalled()
    expect(requestDataPrepared).not.toHaveBeenCalled()
    expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
  }

  it('init', () => {
    expect(pos.getCurrencies()).toHaveLength(Object.keys(requestValueMapper.getCurrencyMappings()).length)
    expect(pos.getCurrencies()).toHaveLength(3)
    expect(pos.getAccount()).toBe(account)
    expect(pos.isTestMode()).toBe(false)
    expect(pos.getCrypt()).toBe(crypt)
  })

  // addition: identifiers and the supported transactions table
  it('exposes NAME, the gateway class identifier and the supported transactions', () => {
    expect(KuveytPos.NAME).toBe('KuveytPos')
    expect(KuveytPos.GATEWAY_CLASS).toBe('KuveytPos')
    expect(KuveytPos.isSupportedTransaction(TX_TYPE.PAY_AUTH, MODEL.NON_SECURE)).toBe(true)
    expect(KuveytPos.isSupportedTransaction(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE)).toBe(true)
    for (const model of [MODEL.THREE_D_PAY, MODEL.THREE_D_HOST, MODEL.THREE_D_PAY_HOSTING]) {
      expect(KuveytPos.isSupportedTransaction(TX_TYPE.PAY_AUTH, model)).toBe(false)
    }
    for (const tx of [TX_TYPE.PAY_PRE_AUTH, TX_TYPE.PAY_POST_AUTH, TX_TYPE.ORDER_HISTORY]) {
      expect(KuveytPos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(false)
    }
    for (const tx of [TX_TYPE.STATUS, TX_TYPE.CANCEL, TX_TYPE.REFUND, TX_TYPE.REFUND_PARTIAL]) {
      expect(KuveytPos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(true)
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

  it('get common 3D form data success response', async () => {
    const c = card()
    const order = baseOrder
    const requestData = { request: 'form-data' }
    requestMapper.create3DFormInitializeRequestData.mockReturnValue(requestData)
    // deviation: Q6 the client answers the form build with a record holding the bank page
    const verify = configureClientResponse(
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      requestData,
      { html: 'bank-api-html-response' },
      order,
      MODEL.THREE_D_SECURE,
    )

    const result = await pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, c)

    expect(result).toBe('bank-api-html-response')
    expect(requestMapper.create3DFormInitializeRequestData).toHaveBeenCalledTimes(1)
    expect(requestMapper.create3DFormInitializeRequestData).toHaveBeenCalledWith(
      account,
      order,
      MODEL.THREE_D_SECURE,
      TX_TYPE.PAY_AUTH,
      c,
    )
    expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
    verify()
  })

  // deviation: B14 English messages and error classes of the shared 3D form input check
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
      'unsupported_payment_model',
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_AUTH,
      false,
      true,
      UnsupportedTransactionTypeError,
      'KuveytPos supports [regular, 3d] payment model(s) for transaction type [pay]. Provided payment model: [3d_host].',
      null,
    ],
    [
      'unsupported_tx',
      MODEL.THREE_D_SECURE,
      TX_TYPE.PAY_PRE_AUTH,
      false,
      true,
      UnsupportedTransactionTypeError,
      'Invalid transaction type! Supported transaction types: [pay].',
      null,
    ],
    [
      'non_payment_tx_type',
      MODEL.THREE_D_SECURE,
      TX_TYPE.STATUS,
      false,
      false,
      UnsupportedTransactionTypeError,
      'Invalid transaction type! Supported transaction types: [pay].',
      null,
    ],
    [
      'post_auth_tx_type',
      MODEL.THREE_D_PAY,
      TX_TYPE.PAY_POST_AUTH,
      true,
      false,
      UnsupportedTransactionTypeError,
      'Invalid transaction type! Supported transaction types: [pay].',
      null,
    ],
    [
      'unsupported_form_format',
      MODEL.THREE_D_SECURE,
      TX_TYPE.PAY_AUTH,
      true,
      false,
      UnsupportedFormFormatError,
      'Unsupported 3D form format!',
      FORM_FORMAT.ARRAY,
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
      expect(requestMapper.create3DFormInitializeRequestData).not.toHaveBeenCalled()
      expectNoRequest()
    },
  )

  // addition: K9 an empty page from the bank is no form
  it.each([[{ html: '' }], [{ html: '   ' }], [{ html: ['<html/>'] }], [{}]])(
    'get3DFormData refuses the client answer %j',
    async (answer) => {
      requestMapper.create3DFormInitializeRequestData.mockReturnValue({ request: 'form-data' })
      configureClientResponse(
        TX_TYPE.INTERNAL_3D_FORM_BUILD,
        { request: 'form-data' },
        answer,
        baseOrder,
        MODEL.THREE_D_SECURE,
      )
      await expect(pos.get3DFormData(baseOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card())).rejects.toThrow(
        new PosError('3D form data could not be created'),
      )
    },
  )

  // ---- 3D Secure ----

  type SecureRow = [
    name: string,
    acc: BoaPosAccount,
    order: PosOrder,
    authenticationResponse: string,
    decoded: Data,
    provision: Data,
    mapped: Data,
    expected: Data,
    is3DSuccess: boolean,
  ]

  const secureRows: SecureRow[] = [
    [
      'auth_fail',
      KG,
      baseOrder,
      AUTH_FAIL_RESPONSE,
      AUTH_FAIL_DECODED,
      {},
      { status: 'declined' },
      // deviation: B8 unsigned declines carry trusted data only
      { status: 'declined', order_id: '2020110828BC', transaction_type: 'pay', payment_model: '3d' },
      false,
    ],
    [
      '3d_auth_success_payment_fail',
      // deviation: K8 the message's merchant and customer echoes are bound to the account (merchant 48544)
      AccountFactory.createBoaPosAccount('kuveytpos', '48544', 'fapapi', '123456', PASSWORD),
      // deviation: B5/K8 the signed id and the VPosMessage echoes are bound
      { id: 'MP-15', amount: 0.1, currency: CURRENCY.TRY, installment: 0, ip: '127.0.0.1' },
      AUTH_SUCCESS_PAYMENT_FAIL_RESPONSE,
      AUTH_SUCCESS_DECODED,
      { ResponseCode: 'MetaDataNotFound' },
      { status: 'declined' },
      { status: 'declined' },
      true,
    ],
    [
      'success',
      // deviation: K8 the message's merchant echo is bound to the account (merchant 80)
      KM,
      // deviation: B4/B17 the callback is resigned for this order and the provision answer is bound to it
      { id: 'Order-123', amount: 1, currency: CURRENCY.TRY, installment: 0, ip: '127.0.0.1' },
      authResponse(SUCCESS_DECODED),
      SUCCESS_DECODED,
      {
        ResponseCode: '00',
        MerchantOrderId: 'Order-123',
        VPosMessage: { Amount: '100', CurrencyCode: '949', MerchantOrderId: 'Order-123' },
      },
      { status: 'approved' },
      // deviation: K8 an approval names the 3D model and takes the card mask from the provision answer only
      { status: 'approved', payment_model: '3d', masked_number: null },
      true,
    ],
  ]

  it.each(secureRows)(
    'make3DPayment %s',
    async (name, acc, order, authenticationResponse, decoded, provision, mapped, expected, is3DSuccess) => {
      const p = createGateway(config, acc)
      const signed = name !== 'auth_fail'
      // deviation: B4 a present HashData is always verified
      crypt.check3DHash.mockReturnValue(true)
      responseMapper.extractMdStatus.mockReturnValue('3d-status')
      responseMapper.is3dAuthSuccess.mockReturnValue(is3DSuccess)
      responseMapper.map3DPaymentData.mockReturnValue(mapped)
      const provisionRequest = { request: 'create3DPaymentRequestData' }
      let verify: (() => void) | null = null
      if (is3DSuccess) {
        requestMapper.create3DPaymentRequestData.mockReturnValue(provisionRequest)
        verify = configureClientResponse(TX_TYPE.PAY_AUTH, provisionRequest, provision, order, MODEL.THREE_D_SECURE)
      }

      // deviation: Q6 the mapped response is returned (no isSuccess state)
      const result = await p.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, {
        AuthenticationResponse: authenticationResponse,
      })

      expect(result).toStrictEqual(expected)
      if (signed) {
        expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
        expect(crypt.check3DHash).toHaveBeenCalledWith(acc, decoded)
      } else {
        expect(crypt.check3DHash).not.toHaveBeenCalled()
      }
      expect(responseMapper.extractMdStatus).toHaveBeenCalledTimes(1)
      expect(responseMapper.extractMdStatus).toHaveBeenCalledWith(decoded)
      expect(responseMapper.is3dAuthSuccess).toHaveBeenCalledTimes(1)
      expect(responseMapper.is3dAuthSuccess).toHaveBeenCalledWith('3d-status')
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledTimes(1)
      if (is3DSuccess) {
        expect(requestMapper.create3DPaymentRequestData).toHaveBeenCalledWith(acc, order, TX_TYPE.PAY_AUTH, decoded)
        expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(decoded, provision, TX_TYPE.PAY_AUTH, order)
        verify?.()
      } else {
        expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(decoded, null, TX_TYPE.PAY_AUTH, order)
        expectNoRequest()
      }
    },
  )

  it('make3DPayment exception', async () => {
    // deviation: B14 PosError; a record without AuthenticationResponse
    await expect(pos.payment(MODEL.THREE_D_SECURE, {}, TX_TYPE.PAY_AUTH, null, cb({ abc: 'x' }))).rejects.toThrow(
      new PosError('AuthenticationResponse is missing'),
    )
    expect(crypt.check3DHash).not.toHaveBeenCalled()
    expect(responseMapper.extractMdStatus).not.toHaveBeenCalled()
    expect(responseMapper.is3dAuthSuccess).not.toHaveBeenCalled()
    expect(responseMapper.map3DPaymentData).not.toHaveBeenCalled()
    expectNoRequest()
  })

  // addition: K8 step 1, only a non-empty string is decoded
  it.each([[{ AuthenticationResponse: '' }], [{ AuthenticationResponse: ['x'] }], [{ AuthenticationResponse: 1 }]])(
    'make3DPayment refuses %j',
    async (data) => {
      await expect(pos.make3DPayment(cb(data), baseOrder, TX_TYPE.PAY_AUTH)).rejects.toThrow(
        new PosError('AuthenticationResponse is missing'),
      )
      expect(crypt.check3DHash).not.toHaveBeenCalled()
    },
  )

  /** Stubs for a signed, authenticated callback whose provision is answered with `provision`. */
  const approvePath = (provision: Data | Error, mapped: Data, order: PosOrder = tdv2Order()) => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.extractMdStatus.mockReturnValue('00')
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    responseMapper.map3DPaymentData.mockReturnValue(mapped)
    const provisionRequest = { request: 'create3DPaymentRequestData' }
    requestMapper.create3DPaymentRequestData.mockReturnValue(provisionRequest)
    return configureClientResponse(TX_TYPE.PAY_AUTH, provisionRequest, provision, order, MODEL.THREE_D_SECURE)
  }

  const bankProvision = (over: Data = {}, message: Data = {}): Data => ({
    ResponseCode: '00',
    MerchantOrderId: ORDER_ID,
    VPosMessage: { Amount: '101', CurrencyCode: '949', MerchantOrderId: ORDER_ID, ...message },
    ...over,
  })

  // addition: B9 a signed callback without approval must map as declined
  it('a signed decline mapped as approved is rejected (PosError) without a request', async () => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.extractMdStatus.mockReturnValue('05')
    responseMapper.is3dAuthSuccess.mockReturnValue(false)
    responseMapper.map3DPaymentData.mockReturnValue({ status: 'approved' })

    await expect(
      pos.make3DPayment(cb({ AuthenticationResponse: authResponse(tdv2({ ResponseCode: '05' })) }), tdv2Order(), 'pay'),
    ).rejects.toThrow(new PosError('3D callback without approval was mapped as approved'))
    expectNoRequest()
  })

  // addition: Task 1 the approval needs the signed ResponseCode to be exactly 00, whatever the mapper reads
  it('a mapper success is not trusted when the signed ResponseCode is not 00', async () => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.extractMdStatus.mockReturnValue('00')
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    responseMapper.map3DPaymentData.mockReturnValue({ status: 'declined' })

    const result = await pos.make3DPayment(
      cb({ AuthenticationResponse: authResponse(tdv2({ ResponseCode: '000' })) }),
      tdv2Order(),
      TX_TYPE.PAY_AUTH,
    )

    expect(result).toStrictEqual({ status: 'declined' })
    expectNoRequest()
  })

  // addition: B16 the unsigned MD is checked before the request mapper is asked for a provision
  it.each([['a b'], ['x'.repeat(1025)], [undefined]])('MD %j is refused before any request', async (md) => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.extractMdStatus.mockReturnValue('00')
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    requestMapper.create3DPaymentRequestData.mockReturnValue({ request: 'x' })

    await expect(
      pos.make3DPayment(cb({ AuthenticationResponse: authResponse(tdv2({ MD: md })) }), tdv2Order(), 'pay'),
    ).rejects.toThrow(new PosError('3D callback authentication values are malformed'))
    expect(responseMapper.map3DPaymentData).not.toHaveBeenCalled()
    expectNoRequest()
  })

  // addition: B9 a provision answer mapped approved needs its own ResponseCode 00
  it.each([[{ ResponseCode: '05' }], [{ ResponseCode: '' }], [{ ResponseCode: NIL }]])(
    'a provision answer %j mapped as approved is rejected (PosError)',
    async (provision) => {
      approvePath(provision, { status: 'approved' })
      await expect(
        pos.make3DPayment(cb({ AuthenticationResponse: authResponse(tdv2()) }), tdv2Order(), 'pay'),
      ).rejects.toThrow(new PosError('3D provision answer without approval was mapped as approved'))
      expect(httpClient.request).toHaveBeenCalledTimes(1)
    },
  )

  // addition: ruling (final fix wave) supersedes the earlier `['00']` and `{}` rows above: once the provision was
  // sent, an answer without data or with a response code that is not one plain value is an unknown outcome
  it('a provision answer {} is PosHttpError, a list ResponseCode is OrderMismatchError order_status', async () => {
    approvePath({}, { status: 'approved' })
    await expect(
      pos.make3DPayment(cb({ AuthenticationResponse: authResponse(tdv2()) }), tdv2Order(), 'pay'),
    ).rejects.toThrow(PosHttpError)

    approvePath({ ResponseCode: ['00'] }, { status: 'declined' })
    const err = await mismatch(
      pos.make3DPayment(cb({ AuthenticationResponse: authResponse(tdv2()) }), tdv2Order(), 'pay'),
    )
    expect([err.field, err.paymentMayHaveCompleted]).toStrictEqual(['order_status', true])
  })

  // addition: Task 3 a provision answer with ResponseCode 00 is the bank's booking: it is bound to the order even
  // when the mapper declines it, and a mapper decline of a bound booking is never a plain decline
  it.each([
    ['no VPosMessage (mapped declined)', { ResponseCode: '00', MerchantOrderId: ORDER_ID }, 'declined', 'amount'],
    ['a bound booking mapped declined', bankProvision(), 'declined', 'order_status'],
    ['another order mapped declined', bankProvision({ MerchantOrderId: 'X' }), 'declined', 'order_id'],
  ])('a 00 provision answer with %s is OrderMismatchError %s', async (_n, provision, status, field) => {
    const verify = approvePath(provision, { status, proc_return_code: null, all: { raw: true } })
    const err = await pos
      .make3DPayment(cb({ AuthenticationResponse: authResponse(tdv2()) }), tdv2Order(), TX_TYPE.PAY_AUTH)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect((err as OrderMismatchError).field).toBe(field)
    expect((err as OrderMismatchError).paymentMayHaveCompleted).toBe(true)
    expect((err as OrderMismatchError).response?.requires_manual_review).toBe(true)
    verify()
  })

  // addition: Task 4 every bank value the binding reads must be text; a list or record never equals the order's
  it.each([
    ['MerchantOrderId as a list', bankProvision({ MerchantOrderId: [ORDER_ID] }), 'order_id'],
    ['Amount as a list', bankProvision({}, { Amount: ['101'] }), 'amount'],
    ['Amount as a number', bankProvision({}, { Amount: 101 }), 'amount'],
    ['Amount as a record', bankProvision({}, { Amount: { '#': '101' } }), 'amount'],
    ['CurrencyCode as a list', bankProvision({}, { CurrencyCode: ['949'] }), 'currency'],
    ['CurrencyCode as a number', bankProvision({}, { CurrencyCode: 949 }), 'currency'],
    ['the message order id as a list', bankProvision({}, { MerchantOrderId: [ORDER_ID] }), 'order_id'],
    ['the message as a list', bankProvision({ VPosMessage: [{ Amount: '101', CurrencyCode: '949' }] }), 'amount'],
  ])('a provision answer with %s is OrderMismatchError %s', async (_n, provision, field) => {
    approvePath(provision, { status: 'approved' })
    const err = await pos
      .make3DPayment(cb({ AuthenticationResponse: authResponse(tdv2()) }), tdv2Order(), TX_TYPE.PAY_AUTH)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect((err as OrderMismatchError).field).toBe(field)
    expect((err as OrderMismatchError).paymentMayHaveCompleted).toBe(true)
  })

  // addition: ruling, the hashed password a bank echoes never leaves the gateway
  it('replaces every echoed HashPassword of the returned raw data', async () => {
    approvePath(bankProvision(), {
      status: 'approved',
      all: { VPosMessage: { HashPassword: HASH_PASSWORD, Amount: '101' }, list: [{ hashpassword: 'x' }] },
      '3d_all': { VPosMessage: { HashPassword: HASH_PASSWORD, UserName: '' }, HashPassword: '' },
    })
    const result = (await pos.make3DPayment(
      cb({ AuthenticationResponse: authResponse(tdv2()) }),
      tdv2Order(),
      TX_TYPE.PAY_AUTH,
    )) as Data
    expect(result.all).toStrictEqual({
      VPosMessage: { HashPassword: '***', Amount: '101' },
      list: [{ hashpassword: '***' }],
    })
    expect(result['3d_all']).toStrictEqual({ VPosMessage: { HashPassword: '***', UserName: '' }, HashPassword: '' })
    expect(JSON.stringify(result)).not.toContain(HASH_PASSWORD)
  })

  // ---- non-3D transactions ----

  it('regular payment', async () => {
    const order = { id: '2020110828BC' }
    const c = card()
    const requestData = { request: 'createNonSecurePaymentRequestData' }
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue(requestData)
    responseMapper.mapPaymentResponse.mockReturnValue({ result: true })
    const verify = configureClientResponse(TX_TYPE.PAY_AUTH, requestData, { paymentResponse: true }, order, 'regular')

    const result = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, c)

    verify()
    expect(requestMapper.createNonSecurePaymentRequestData).toHaveBeenCalledWith(account, order, TX_TYPE.PAY_AUTH, c)
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith({ paymentResponse: true }, TX_TYPE.PAY_AUTH, order)
    expect(result).toStrictEqual({ result: true })
  })

  it('regular post-auth payment', async () => {
    // deviation: B14 the table refuses the post-auth before the gateway's own refusal
    await expect(pos.payment(MODEL.NON_SECURE, {}, TX_TYPE.PAY_POST_AUTH)).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    expect(requestMapper.createNonSecurePostAuthPaymentRequestData).not.toHaveBeenCalled()
    expectNoRequest()
  })

  // addition: K10 the direct entry points refuse the models this bank does not offer
  it('refuses post-auth, 3D Pay and 3D Host called directly', async () => {
    await expect(pos.makeRegularPostPayment({})).rejects.toThrow(UnsupportedPaymentModelError)
    await expect(pos.make3DPayPayment(cb({ abc: 'x' }), {}, TX_TYPE.PAY_AUTH)).rejects.toThrow(
      UnsupportedPaymentModelError,
    )
    await expect(pos.make3DHostPayment(cb({ abc: 'x' }), {}, TX_TYPE.PAY_AUTH)).rejects.toThrow(
      UnsupportedPaymentModelError,
    )
    expectNoRequest()
  })

  const statusRows: Array<[Data, Data]> = [
    [
      { GetMerchantOrderDetailResponse: { GetMerchantOrderDetailResult: { Success: true, Value: [] } } },
      { status: 'declined' },
    ],
    [
      {
        GetMerchantOrderDetailResponse: {
          GetMerchantOrderDetailResult: { Success: true, Value: { OrderContract: { ResponseCode: '00' } } },
        },
      },
      { status: 'approved' },
    ],
  ]

  const cancelRows: Array<[string, Data, Data]> = [
    [
      'fail_1',
      { SaleReversalResponse: { SaleReversalResult: { Success: true, Value: { OrderId: 0 } } } },
      { status: 'declined' },
    ],
    [
      'success_1',
      { SaleReversalResponse: { SaleReversalResult: { Success: true, Value: { ResponseCode: '00' } } } },
      { status: 'approved' },
    ],
  ]

  const refundRows: Array<[string, Data, Data]> = [
    [
      'fail_1',
      { PartialDrawbackResponse: { PartialDrawbackResult: { Success: null, Value: { ResponseCode: '28' } } } },
      { status: 'declined' },
    ],
    [
      'success_1',
      { PartialDrawbackResponse: { PartialDrawbackResult: { Success: null, Value: { ResponseCode: '00' } } } },
      { status: 'approved' },
    ],
  ]

  // deviation: Q6 the mapped response is returned (no isSuccess state)
  it.each(statusRows)('status %#', async (bankResponse, expected) => {
    const requestData = { request: 'createStatusRequestData' }
    requestMapper.createStatusRequestData.mockReturnValue(requestData)
    responseMapper.mapStatusResponse.mockReturnValue(expected)
    const verify = configureClientResponse(TX_TYPE.STATUS, requestData, bankResponse, baseOrder, MODEL.NON_SECURE)

    const result = await pos.status(baseOrder)

    verify()
    expect(requestMapper.createStatusRequestData).toHaveBeenCalledWith(account, baseOrder)
    expect(responseMapper.mapStatusResponse).toHaveBeenCalledWith(bankResponse)
    expect(result).toStrictEqual(expected)
  })

  it.each(cancelRows)('cancel %s', async (_name, bankResponse, expected) => {
    const requestData = { request: 'createCancelRequestData' }
    requestMapper.createCancelRequestData.mockReturnValue(requestData)
    responseMapper.mapCancelResponse.mockReturnValue(expected)
    const verify = configureClientResponse(TX_TYPE.CANCEL, requestData, bankResponse, baseOrder, MODEL.NON_SECURE)

    const result = await pos.cancel(baseOrder)

    verify()
    expect(requestMapper.createCancelRequestData).toHaveBeenCalledWith(account, baseOrder)
    expect(responseMapper.mapCancelResponse).toHaveBeenCalledWith(bankResponse)
    expect(result).toStrictEqual(expected)
  })

  it.each(refundRows)('refund %s', async (_name, bankResponse, expected) => {
    const requestData = { request: 'createRefundRequestData' }
    requestMapper.createRefundRequestData.mockReturnValue(requestData)
    responseMapper.mapRefundResponse.mockReturnValue(expected)
    const verify = configureClientResponse(TX_TYPE.REFUND, requestData, bankResponse, baseOrder, MODEL.NON_SECURE)

    const result = await pos.refund(baseOrder)

    verify()
    expect(requestMapper.createRefundRequestData).toHaveBeenCalledWith(account, baseOrder, TX_TYPE.REFUND)
    expect(responseMapper.mapRefundResponse).toHaveBeenCalledWith(bankResponse)
    expect(result).toStrictEqual(expected)
  })

  it('order history request', async () => {
    // deviation: B14 UnsupportedTransactionTypeError, nothing is mapped or sent
    await expect(pos.orderHistory({})).rejects.toThrow(UnsupportedTransactionTypeError)
    expect(requestMapper.createOrderHistoryRequestData).not.toHaveBeenCalled()
    expectNoRequest()
  })

  it('make3DHostPayment', async () => {
    // deviation: B14 the table refuses the model before the gateway's own refusal
    await expect(pos.payment(MODEL.THREE_D_HOST, {}, TX_TYPE.PAY_AUTH, null, cb({ abc: 'x' }))).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    expectNoRequest()
  })

  it('make3DPayPayment', async () => {
    // deviation: B14 the table refuses the model before the gateway's own refusal
    await expect(pos.payment(MODEL.THREE_D_PAY, {}, TX_TYPE.PAY_AUTH, null, cb({ abc: 'x' }))).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    expectNoRequest()
  })
})

// ---------- end to end: real crypt, mappers and HTTP clients over a fake fetch ----------

type Sent = { url: string; path: string; headers: Headers; text: string; fields: Data }

type Answer = string | Response

type BankOptions = {
  /** The bank's 3D page. */
  form?: Answer
  /** The provision answer, from the posted provision fields. */
  provision?: (fields: Data) => Answer
  /** The non-secure sale answer, from the posted fields. */
  sale?: (fields: Data) => Answer
  /** A SOAP answer by SOAPAction name. */
  soap?: (action: string) => Answer
}

const TDV2_PROVISION: Data = pick(threeDPaymentDataProvider, 'success_tdv2').paymentData

/** The bank's TDV2 provision answer booked for the posted order id and amount, with `over` applied. */
const provisionFor = (fields: Data, over: Data = {}, message: Data = {}): Data => {
  const record = structuredClone(TDV2_PROVISION)
  record.MerchantOrderId = fields.MerchantOrderId
  record.VPosMessage.MerchantOrderId = fields.MerchantOrderId
  record.VPosMessage.Amount = fields.Amount
  Object.assign(record.VPosMessage, message)
  return { ...record, ...over }
}

const SOAP_ANSWERS: Record<string, Data> = {
  GetMerchantOrderDetail: pick(statusTestDataProvider, 'success1').responseData,
  SaleReversal: pick(cancelTestDataProvider, 'success1').responseData,
  PartialDrawback: pick(refundTestDataProvider, 'tdv2_success1').responseData,
  DrawBack: pick(refundTestDataProvider, 'tdv2_success_full_refund').responseData,
}

const SALE_ANSWER: Data = pick(paymentTestDataProvider, 'success1').responseData

/**
 * A fetch that records each request and answers like the bank: the XML gateway by path (`ThreeDModelPayGate` with an
 * HTML page, `ThreeDModelProvisionGate` and `Non3DPayGate` with XML booked for the posted order), the SOAP service by
 * `SOAPAction`. Anything else fails.
 */
function bankFetch(options: BankOptions = {}) {
  const sent: Sent[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const bytes = Buffer.from(
      await new Request('https://example.invalid', { method: 'POST', body: init?.body ?? '' }).arrayBuffer(),
    )
    const u = String(url)
    const headers = new Headers(init?.headers)
    const soap = u === QUERY_API
    const text = soap ? bytes.toString('utf8') : bytes.toString('latin1')
    const fields = soap ? {} : XmlDecoder.decode(text)
    const path = soap ? '' : u.slice(PAYMENT_API.length + 1)
    sent.push({ url: u, path, headers, text, fields })
    let reply: Answer | undefined
    if (soap) {
      const action = String(headers.get('SOAPAction')).slice(SOAP_ACTION_PREFIX.length)
      reply = options.soap?.(action) ?? (SOAP_ANSWERS[action] ? soapXml(SOAP_ANSWERS[action]) : undefined)
    } else if (path === 'ThreeDModelPayGate') {
      reply = options.form ?? '<html><body>bank 3d page</body></html>'
    } else if (path === 'ThreeDModelProvisionGate') {
      reply = options.provision?.(fields) ?? provisionXml(provisionFor(fields))
    } else if (path === 'Non3DPayGate') {
      reply =
        options.sale?.(fields) ??
        provisionXml({ ...SALE_ANSWER, MerchantOrderId: fields.MerchantOrderId, ResponseCode: '00' })
    }
    if (reply === undefined) throw new Error(`unexpected request ${u}`)
    if (reply instanceof Response) return reply
    return new Response(reply, { status: 200 })
  }) as unknown as typeof fetch

  return { sent, fetchImpl }
}

function realGateway(
  fetchImpl: typeof fetch,
  options: { cfg?: GatewayConfig; account?: BoaPosAccount; logger?: PosLogger; hooks?: PosHooks } = {},
) {
  const log = options.logger ?? createLogger()
  const cfg = options.cfg ?? config
  const cryptImpl = new KuveytPosCrypt(log)
  const valueMapper = new KuveytPosRequestValueMapper()
  const valueFormatter = new KuveytPosRequestValueFormatter()
  const hooks = options.hooks ?? {}
  const deps: GatewayDeps<BoaPosAccount> = {
    requestValueMapper: valueMapper,
    requestValueFormatter: valueFormatter,
    requestDataMapper: new KuveytPosRequestDataMapper(valueMapper, valueFormatter, hooks, cryptImpl, LANG.TR),
    responseDataMapper: new KuveytPosResponseDataMapper(
      new BoaPosResponseValueFormatter(),
      new KuveytPosResponseValueMapper(),
      log,
    ),
    crypt: cryptImpl,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(
      KuveytPos.GATEWAY_CLASS,
      cfg,
      new HttpTransport({ fetch: fetchImpl }),
      log,
    ),
    logger: log,
    hooks,
  }

  return new KuveytPos(cfg, options.account ?? KG, deps)
}

const mismatch = async (promise: Promise<unknown>): Promise<OrderMismatchError> => {
  const err = await promise.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(OrderMismatchError)
  return err as OrderMismatchError
}

const MALFORMED = new HashMismatchError('3D callback fields are malformed')
const NO_HASH = new HashMismatchError('3D callback has no HashData')
const HASH_MISMATCH = new HashMismatchError('3D callback hash mismatch')
const BAD_MD = new PosError('3D callback authentication values are malformed')
const BAD_XML = new PosError('3D callback AuthenticationResponse is not valid XML')

describe('KuveytPos (end to end) 3D Secure', () => {
  const run = (
    callback: Data | string,
    order: PosOrder = tdv2Order(),
    options: BankOptions = {},
    cfg: GatewayConfig = config,
  ) => {
    const { sent, fetchImpl } = bankFetch(options)
    const value = typeof callback === 'string' ? callback : authResponse(callback)
    const promise = realGateway(fetchImpl, { cfg }).payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, {
      AuthenticationResponse: value,
    })
    return { sent, promise }
  }

  // addition: K8/B17 one provision request built from the order and the signed callback, bound to the order
  it('provisions a KS2-signed callback with one request built from the order', async () => {
    const callback = tdv2()
    expect(callback.HashData).toBe('xg2w5Ag0VAzlgVi+SfQdfVhPvaQ=')
    const { sent, promise } = run(callback)
    const res = (await promise) as Data

    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(`${PAYMENT_API}/ThreeDModelProvisionGate`)
    expect(sent[0]?.text.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe(true)
    const f = sent[0]?.fields as Data
    expect(f).toStrictEqual({
      MerchantId: '496',
      CustomerId: '400235',
      UserName: 'apiuser1',
      APIVersion: 'TDV2.0.0',
      HashData: RQ({ MerchantId: '496', MerchantOrderId: ORDER_ID, Amount: '101', UserName: 'apiuser1' }),
      CustomerIPAddress: '127.0.0.1',
      KuveytTurkVPosAdditionalData: { AdditionalData: { Key: 'MD', Data: MD_TDV2 } },
      TransactionType: 'Sale',
      InstallmentCount: '0',
      Amount: '101',
      DisplayAmount: '101',
      CurrencyCode: '0949',
      MerchantOrderId: ORDER_ID,
      TransactionSecurity: '3',
    })
    expect(res.status).toBe('approved')
    expect(res.order_id).toBe(ORDER_ID)
    expect(res.auth_code).toBe('050560')
    expect(res.ref_ret_num).toBe('411219539222')
    expect(res.transaction_id).toBe('539222')
    expect(res.remote_order_id).toBe(BANK_ORDER_ID)
    expect(res.amount).toBe(1.01)
    expect(res.currency).toBe('TRY')
    expect(res.payment_model).toBe('3d')
    expect(res.masked_number).toBe('51889619****2544')
  })

  // addition: B6 1.15 is 115 kuruş in the provision, and the bank's 115 binds
  it('1.15 TRY is provisioned and bound as 115 kuruş', async () => {
    const callback = tdv2({}, tdv2Message({ Amount: '115' }))
    const { sent, promise } = run(callback, tdv2Order({ amount: 1.15 }))
    const res = (await promise) as Data
    expect(sent[0]?.fields.Amount).toBe('115')
    expect(sent[0]?.fields.DisplayAmount).toBe('115')
    expect(res.status).toBe('approved')
    expect(res.amount).toBe(1.15)
  })

  // addition: Review Focus, without VPosMessage the provision still carries the order's values
  it('a callback without VPosMessage is provisioned from the order (amount, currency, installment, model)', async () => {
    const { sent, promise } = run(tdv2({}, null), tdv2Order({ amount: 2.5, installment: 3 }))
    const res = (await promise) as Data
    // the default bank answer books the posted amount, so it binds
    expect(res.status).toBe('approved')
    expect(res.payment_model).toBe('3d')
    expect(sent).toHaveLength(1)
    const f = sent[0]?.fields as Data
    expect([f.Amount, f.DisplayAmount, f.CurrencyCode, f.InstallmentCount, f.TransactionSecurity]).toStrictEqual([
      '250',
      '250',
      '0949',
      '3',
      '3',
    ])
  })

  // addition: K8 an approval always names the 3D model and takes the card mask from the provision answer only
  it('pins payment_model and masked_number on an approval', async () => {
    const { promise } = run(tdv2({}, tdv2Message({ CardNumber: '4111********1111' })), tdv2Order(), {
      provision: (f) => {
        const record = provisionFor(f)
        delete record.VPosMessage.CardNumber
        return provisionXml(record)
      },
    })
    const res = (await promise) as Data
    expect(res.status).toBe('approved')
    expect(res.masked_number).toBeNull()
    expect(res.payment_model).toBe('3d')
  })

  // addition: B4 refusals before any request
  it.each([
    ['an altered HashData', tdv2({ HashData: 'yg2w5Ag0VAzlgVi+SfQdfVhPvaQ=' }), HASH_MISMATCH],
    [
      'the KS2 HashData over another bank id',
      tdv2({ OrderId: '155767807', HashData: 'xg2w5Ag0VAzlgVi+SfQdfVhPvaQ=' }),
      HASH_MISMATCH,
    ],
    ['a HashData of another password', tdv2({ HashData: CB(ORDER_ID, '00', BANK_ORDER_ID, HP('x')) }), HASH_MISMATCH],
    ['a HashData of 27 characters', tdv2({ HashData: 'xg2w5Ag0VAzlgVi+SfQdfVhPvaQ' }), HASH_MISMATCH],
    ['a lowercase HashData', tdv2({ HashData: 'xg2w5ag0vazlgvi+sfqdfvhpvaq=' }), HASH_MISMATCH],
    ['a HashData list', tdv2({ HashData: ['xg2w5Ag0VAzlgVi+SfQdfVhPvaQ=', 'x'] }), MALFORMED],
    ['an approval without HashData', tdv2({ HashData: undefined }), NO_HASH],
    ['an approval with an empty HashData', tdv2({ HashData: '' }), NO_HASH],
  ])('rejects %s (HashMismatchError, nothing sent)', async (_name, callback, error) => {
    const { sent, promise } = run(callback)
    await expect(promise).rejects.toThrow(error)
    expect(sent).toHaveLength(0)
  })

  // addition: B5 the signed order id belongs to the order; a callback for another order is not sent
  it('a callback signed for another order is OrderMismatchError order_id, nothing sent', async () => {
    const { sent, promise } = run(
      tdv2({ MerchantOrderId: '2024042111A1' }, tdv2Message({ MerchantOrderId: '2024042111A1' })),
    )
    const err = await mismatch(promise)
    expect(err.field).toBe('order_id')
    expect(err.expected).toBe(ORDER_ID)
    expect(err.actual).toBe('2024042111A1')
    expect(err.paymentMayHaveCompleted).toBe(false)
    expect(err.response).toBeUndefined()
    expect(sent).toHaveLength(0)
  })

  // addition: B5 the binding rests on the signed id alone (a callback whose message names no order)
  it('a callback signed for another order without a message is OrderMismatchError order_id, nothing sent', async () => {
    const { sent, promise } = run(tdv2({ MerchantOrderId: '2024042111A1' }, null))
    const err = await mismatch(promise)
    expect([err.field, err.actual, err.paymentMayHaveCompleted]).toStrictEqual(['order_id', '2024042111A1', false])
    expect(sent).toHaveLength(0)
  })

  // addition: Task 3 only the signed top-level id binds; the message copy never stands in for it
  it.each([
    [
      'no top-level MerchantOrderId',
      { MerchantOrderId: undefined, HashData: CB('', '00', BANK_ORDER_ID) },
      HASH_MISMATCH,
    ],
    ['an empty top-level MerchantOrderId', { MerchantOrderId: '' }, 'order_id'],
  ])('%s (the message names the order) is refused, nothing sent', async (_name, over, outcome) => {
    const { sent, promise } = run(tdv2(over))
    if (outcome instanceof Error) {
      await expect(promise).rejects.toThrow(outcome)
    } else {
      const err = await mismatch(promise)
      expect(err.field).toBe(outcome)
      expect(err.paymentMayHaveCompleted).toBe(false)
    }
    expect(sent).toHaveLength(0)
  })

  // addition: Task 1 re-splits that keep HashData: the bank id format is pinned on the approve path
  it.each([
    [
      'OrderId 0155767806 for order 2024042111A (re-split)',
      { MerchantOrderId: '2024042111A', OrderId: '0155767806' },
      '2024042111A',
    ],
    ['OrderId 0', { OrderId: '0' }, ORDER_ID],
    ['OrderId with a letter', { OrderId: '15576780A' }, ORDER_ID],
    ['an empty OrderId', { OrderId: '' }, ORDER_ID],
    ['a 20-digit OrderId', { OrderId: '1'.repeat(20) }, ORDER_ID],
  ] as Array<[string, Data, string]>)('%s is malformed, nothing sent', async (_name, over, orderId) => {
    const callback = tdv2(over, tdv2Message({ MerchantOrderId: orderId }))
    if (over.MerchantOrderId === '2024042111A') {
      // the genuine signature of order 2024042111A0 fits this re-split
      expect(callback.HashData).toBe(tdv2().HashData)
    }
    const { sent, promise } = run(callback, tdv2Order({ id: orderId }))
    await expect(promise).rejects.toThrow(MALFORMED)
    expect(sent).toHaveLength(0)
  })

  // addition: K8 step 8, the unsigned echoes of the 3D form must be the order's (honest mismatches only)
  it.each([
    ['Amount 1', { Amount: '1' }, 'amount'],
    ['Amount 100', { Amount: '100' }, 'amount'],
    ['Amount 1.01', { Amount: '1.01' }, 'amount'],
    ['CurrencyCode 0840', { CurrencyCode: '0840' }, 'currency'],
    ['CurrencyCode 840', { CurrencyCode: '840' }, 'currency'],
    ['CurrencyCode 9490', { CurrencyCode: '9490' }, 'currency'],
    ['InstallmentCount 3', { InstallmentCount: '3' }, 'installment'],
    ['InstallmentCount x', { InstallmentCount: 'x' }, 'installment'],
    ['TransactionSecurity 0', { TransactionSecurity: '0' }, 'payment_model'],
    ['TransactionType PreAuth', { TransactionType: 'PreAuth' }, 'transaction_type'],
    ['MerchantId 999', { MerchantId: '999' }, 'merchant_id'],
    ['CustomerId 1', { CustomerId: '1' }, 'terminal_id'],
    ['MerchantOrderId X', { MerchantOrderId: 'X' }, 'order_id'],
    ['a duplicated Amount', { Amount: ['101', '101'] }, 'amount'],
    ['an attributed Amount', { Amount: { '@a': '1', '#': '101' } }, 'amount'],
  ])('a KS2-signed callback whose message says %s is OrderMismatchError %s, nothing sent', async (_n, over, field) => {
    const callback = tdv2({}, tdv2Message(over))
    expect(callback.HashData).toBe('xg2w5Ag0VAzlgVi+SfQdfVhPvaQ=')
    const { sent, promise } = run(callback)
    const err = await mismatch(promise)
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(false)
    expect(err.response).toBeUndefined()
    expect(sent).toHaveLength(0)
  })

  // addition: K8 echoes that agree in another spelling, or say nothing, pass
  it.each([
    ['CurrencyCode 0949', { CurrencyCode: '0949' }],
    ['InstallmentCount 1 for a single payment', { InstallmentCount: '1' }],
    ['TransactionType Sale', { TransactionType: 'Sale' }],
    ['empty MerchantId and CustomerId', { MerchantId: '', CustomerId: '' }],
    ['nil MerchantId and CustomerId', { MerchantId: NIL, CustomerId: NIL }],
    [
      'no echoes at all',
      { Amount: undefined, CurrencyCode: undefined, InstallmentCount: undefined, TransactionSecurity: undefined },
    ],
  ])('a message with %s is provisioned', async (_n, over) => {
    const { sent, promise } = run(tdv2({}, tdv2Message(over)))
    expect(((await promise) as Data).status).toBe('approved')
    expect(sent).toHaveLength(1)
  })

  // addition: bind before model checks, a foreign callback never reports a model mismatch
  it('a callback for another order with a 3D Pay message is an order_id mismatch', async () => {
    const { sent, promise } = run(
      tdv2({ MerchantOrderId: 'OTHER1' }, tdv2Message({ TransactionSecurity: '0', MerchantOrderId: 'OTHER1' })),
    )
    expect((await mismatch(promise)).field).toBe('order_id')
    expect(sent).toHaveLength(0)
  })

  // addition: B16/K7 the authentication value and hostile XML
  it.each([
    ['MD a b', tdv2({ MD: 'a b' }), BAD_MD],
    ['MD with markup', tdv2({ MD: 'x<y' }), BAD_MD],
    ['no MD', tdv2({ MD: undefined }), BAD_MD],
    ['MD of 1025 characters', tdv2({ MD: 'A'.repeat(1025) }), BAD_MD],
    [
      'a DOCTYPE',
      formEncode(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "00">]>${element('VPosTransaction', tdv2())}`),
      BAD_XML,
    ],
    ['an ENTITY in lower case', formEncode(`<!entity a "x">${element('VPosTransaction', tdv2())}`), BAD_XML],
    ['65537 characters', `${authResponse(tdv2())}${'+'.repeat(65_537)}`.slice(0, 65_537), BAD_XML],
    ['plain text', 'hello', BAD_XML],
    ['an HTML page', formEncode('<html><body>Request Rejected</body></html>'), BAD_XML],
    ['broken XML', formEncode('<VPosTransaction><ResponseCode>00</VPosTransaction>'), BAD_XML],
  ])('%s is refused (PosError), nothing sent', async (_n, callback, error) => {
    const { sent, promise } = run(callback)
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect((err as Error).message).toBe(error.message)
    expect(err).not.toBeInstanceOf(OrderMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: Task 4 duplicated or nested signed fields never reach the crypt as text
  it.each([
    ['a duplicated MerchantOrderId', tdv2({ MerchantOrderId: [ORDER_ID, ORDER_ID], HashData: tdv2().HashData })],
    ['a MerchantOrderId with a child', tdv2({ MerchantOrderId: { a: '1' }, HashData: tdv2().HashData })],
    ['an attributed ResponseCode', tdv2({ ResponseCode: { '@a': '1', '#': '00' }, HashData: tdv2().HashData })],
    ['a ResponseCode with a child', tdv2({ ResponseCode: { b: '00' }, HashData: tdv2().HashData })],
    ['a duplicated OrderId', tdv2({ OrderId: [BANK_ORDER_ID, BANK_ORDER_ID], HashData: tdv2().HashData })],
    ['a duplicated MD', tdv2({ MD: [MD_TDV2, MD_TDV2] })],
    ['a VPosMessage as text', tdv2({}, 'x' as unknown as Data)],
    ['a duplicated VPosMessage', tdv2({}, [tdv2Message(), tdv2Message()] as unknown as Data)],
  ])('%s is malformed (HashMismatchError), nothing sent', async (_n, callback) => {
    const { sent, promise } = run(callback)
    await expect(promise).rejects.toThrow(MALFORMED)
    expect(sent).toHaveLength(0)
  })

  // addition: K7 a callback in the charset its declaration names
  it('decodes an ISO-8859-9 callback (KS3-signed decline) without a request', async () => {
    const xml = `<?xml version="1.0" encoding="ISO-8859-9"?><VPosTransaction><ResponseCode>HashDataError</ResponseCode><ResponseMessage>Şifrelenen veriler uyuşmamaktadır.</ResponseMessage><OrderId>0</OrderId><MerchantOrderId>2020110828BC</MerchantOrderId><HashData>aSsSPGkfWmsIyydlSiG700uT0Mk=</HashData></VPosTransaction>`
    const value = [...iconv.encode(xml, 'ISO-8859-9')].map((b) => `%${b.toString(16).padStart(2, '0')}`).join('')
    const { sent, promise } = run(value, tdv2Order({ id: '2020110828BC' }))
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.md_error_message).toBe('Şifrelenen veriler uyuşmamaktadır.')
    expect(sent).toHaveLength(0)
  })

  // addition: B4 declines
  it('maps the KS3-signed HashDataError decline declined without a request', async () => {
    const decline = { ...AUTH_FAIL_DECODED, HashData: 'aSsSPGkfWmsIyydlSiG700uT0Mk=' }
    const { sent, promise } = run(decline, tdv2Order({ id: 'ANY-ORDER' }))
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.proc_return_code).toBe('HashDataError')
    // a signed decline is not bound: its order id is the bank's echo
    expect(res.order_id).toBe('2020110828BC')
    expect(sent).toHaveLength(0)
  })

  it('rejects the KS3 decline with an altered hash', async () => {
    const { sent, promise } = run({ ...AUTH_FAIL_DECODED, HashData: 'bSsSPGkfWmsIyydlSiG700uT0Mk=' })
    await expect(promise).rejects.toThrow(HASH_MISMATCH)
    expect(sent).toHaveLength(0)
  })

  // addition: B4/B8 signed declines are mapped as they came (free-form codes, no pins)
  it.each([['51'], ['MPIAuthenticationStatusN'], ['İşlem reddedildi'], ['']])(
    'a signed decline with ResponseCode %j is declined without a request',
    async (code) => {
      const { sent, promise } = run(tdv2({ ResponseCode: code, OrderId: '0', MD: 'not base64 at all' }))
      expect(((await promise) as Data).status).toBe('declined')
      expect(sent).toHaveLength(0)
    },
  )

  // addition: B8 an unsigned decline carries the order's id and bounded reasons only; require_3d_hash rejects it
  it('maps an unsigned decline from the order only; require_3d_hash rejects it', async () => {
    const callback = tdv2(
      {
        ResponseCode: 'MPIAuthenticationStatusN',
        ResponseMessage: 'x'.repeat(300),
        HashData: undefined,
        MerchantOrderId: 'FORGED',
      },
      tdv2Message({ HashPassword: HASH_PASSWORD, Amount: '999999' }),
    )
    const order = tdv2Order({ id: 'ORDER-1', amount: 7 })
    const { sent, promise } = run(callback, order)
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.order_id).toBe('ORDER-1')
    expect(res.payment_model).toBe('3d')
    expect(res.transaction_type).toBe('pay')
    expect(res.proc_return_code).toBe('MPIAuthenticationStatusN')
    expect(res.error_code).toBe('MPIAuthenticationStatusN')
    expect(res.md_error_message).toBe('x'.repeat(256))
    for (const key of [
      'amount',
      'currency',
      'masked_number',
      'auth_code',
      'ref_ret_num',
      'transaction_id',
      'remote_order_id',
      'batch_num',
      'transaction_time',
      'transaction_security',
    ]) {
      expect(res[key] ?? null).toBeNull()
    }
    expect(res.requires_manual_review).toBeUndefined()
    expect(res['3d_all'].VPosMessage.HashPassword).toBe('***')
    expect(JSON.stringify(res)).not.toContain(HASH_PASSWORD)
    expect(sent).toHaveLength(0)

    const strict = run(callback, order, {}, { ...config, require_3d_hash: true })
    await expect(strict.promise).rejects.toThrow(NO_HASH)
    expect(strict.sent).toHaveLength(0)
  })

  // addition: B17 the provision answer is the bank's booking: it must be this order's, for this amount and currency
  it.each([
    ['MerchantOrderId X', (f: Data) => provisionFor(f, { MerchantOrderId: 'X' }), 'order_id'],
    ['no MerchantOrderId', (f: Data) => provisionFor(f, { MerchantOrderId: undefined }), 'order_id'],
    ['VPosMessage.Amount 100', (f: Data) => provisionFor(f, {}, { Amount: '100' }), 'amount'],
    ['VPosMessage.Amount 0101', (f: Data) => provisionFor(f, {}, { Amount: '0101' }), 'amount'],
    ['VPosMessage.Amount 1.01', (f: Data) => provisionFor(f, {}, { Amount: '1.01' }), 'amount'],
    ['no VPosMessage.Amount', (f: Data) => provisionFor(f, {}, { Amount: undefined }), 'amount'],
    ['CurrencyCode 840', (f: Data) => provisionFor(f, {}, { CurrencyCode: '840' }), 'currency'],
    ['no CurrencyCode', (f: Data) => provisionFor(f, {}, { CurrencyCode: undefined }), 'currency'],
    ['VPosMessage.MerchantOrderId X', (f: Data) => provisionFor(f, {}, { MerchantOrderId: 'X' }), 'order_id'],
    ['no VPosMessage (mapped declined)', (f: Data) => provisionFor(f, { VPosMessage: undefined }), 'amount'],
  ])(
    'an approved provision answer with %s is OrderMismatchError %s with the result attached',
    async (_n, answer, field) => {
      const { sent, promise } = run(tdv2(), tdv2Order(), { provision: (f) => provisionXml(answer(f)) })
      const err = await mismatch(promise)
      expect(err.field).toBe(field)
      expect(err.paymentMayHaveCompleted).toBe(true)
      expect(err.response?.requires_manual_review).toBe(true)
      expect(sent).toHaveLength(1)
    },
  )

  // addition: B6 the bank's truncated kuruş of 1.15 is not the order's
  it('a provision answer booked at 114 for 1.15 TRY is OrderMismatchError amount', async () => {
    const { promise } = run(tdv2({}, tdv2Message({ Amount: '115' })), tdv2Order({ amount: 1.15 }), {
      provision: (f) => provisionXml(provisionFor(f, {}, { Amount: '114' })),
    })
    const err = await mismatch(promise)
    expect([err.field, err.expected, err.actual]).toStrictEqual(['amount', '115', '114'])
  })

  // addition: B5 BP1/BP2, re-reads the pins cannot see are caught by the provision binding
  it('BP1: a genuine approval of A001 re-read as order A is OrderMismatchError order_id after one request', async () => {
    const genuine = tdv2(
      { MerchantOrderId: 'A001', OrderId: '5000' },
      tdv2Message({ MerchantOrderId: 'A001', OrderId: '5000' }),
    )
    const reRead = {
      ...genuine,
      MerchantOrderId: 'A',
      OrderId: '1005000',
      VPosMessage: tdv2Message({ MerchantOrderId: 'A' }),
    }
    expect(CB('A', '00', '1005000')).toBe(genuine.HashData)
    // the bank books the MD of the genuine session: order A001
    const { sent, promise } = run(reRead, tdv2Order({ id: 'A' }), {
      provision: (f) => provisionXml(provisionFor(f, { MerchantOrderId: 'A001' }, { MerchantOrderId: 'A001' })),
    })
    const err = await mismatch(promise)
    expect(err.field).toBe('order_id')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.fields.MerchantOrderId).toBe('A')
  })

  it('BP2: a genuine decline of B100 re-read as an approval of B1 is declined or bound by the provision answer', async () => {
    const reRead = tdv2(
      { MerchantOrderId: 'B1', OrderId: '510', HashData: CB('B100', '51', '0') },
      tdv2Message({ MerchantOrderId: 'B1' }),
    )
    const declined = run(reRead, tdv2Order({ id: 'B1' }), {
      provision: () => provisionXml({ ResponseCode: 'MetaDataNotFound', ResponseMessage: 'Ödeme detayı bulunamadı.' }),
    })
    expect(((await declined.promise) as Data).status).toBe('declined')
    expect(declined.sent).toHaveLength(1)

    const booked = run(reRead, tdv2Order({ id: 'B1' }), {
      provision: (f) => provisionXml(provisionFor(f, { MerchantOrderId: 'B100' }, { MerchantOrderId: 'B100' })),
    })
    expect((await mismatch(booked.promise)).field).toBe('order_id')
  })

  // addition: K8 the provision answer decides
  it('a provision answer MetaDataNotFound is declined', async () => {
    const { sent, promise } = run(tdv2(), tdv2Order(), {
      provision: () =>
        provisionXml({
          ...NS,
          IsEnrolled: 'true',
          ResponseCode: 'MetaDataNotFound',
          ResponseMessage: 'Ödeme detayı bulunamadı.',
          OrderId: '0',
        }),
    })
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.proc_return_code).toBe('MetaDataNotFound')
    expect(sent).toHaveLength(1)
  })

  it.each([
    ['HTTP 500', new Response('error', { status: 500 })],
    ['a 200 HTML page', new Response('<html lang="tr">Request Rejected</html>', { status: 200 })],
    ['an empty 200', new Response('', { status: 200 })],
  ])('a provision answered with %s is PosHttpError', async (_n, answer) => {
    const { sent, promise } = run(tdv2(), tdv2Order(), { provision: () => answer })
    await expect(promise).rejects.toThrow(PosHttpError)
    expect(sent).toHaveLength(1)
  })

  // addition: ruling (final fix wave), after the provision was sent an empty answer is an unknown outcome, not a
  // decline
  it.each([
    ['HTTP 204', () => new Response(null, { status: 204 })],
    ['a root element without fields', () => provisionXml({ ...NS })],
  ])('a provision answered with %s is PosHttpError', async (_n, answer) => {
    const { sent, promise } = run(tdv2(), tdv2Order(), { provision: answer })
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).message).toBe('Bank answered the provision without any data; its outcome is unknown')
    expect(sent).toHaveLength(1)
  })

  // addition: ruling (final fix wave), a response code that is not one plain value may hide a booking
  it.each([
    ['ResponseCode 00 twice', { ResponseCode: ['00', '00'] }],
    ['ResponseCode 00 and 05', { ResponseCode: ['05', '00'] }],
    ['ResponseCode with a child element', { ResponseCode: { a: '00' } }],
  ])('a provision answer with %s is OrderMismatchError order_status, flagged', async (_n, over) => {
    const { sent, promise } = run(tdv2(), tdv2Order(), { provision: (f) => provisionXml(provisionFor(f, over)) })
    const err = await mismatch(promise)
    expect(err.field).toBe('order_status')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
    expect(err.response?.status).toBe('declined')
    expect(sent).toHaveLength(1)
  })

  // addition: ruling, the echoed HashPassword is replaced in the result and in an attached response
  it('replaces the echoed HashPassword in 3d_all, all and the response of an OrderMismatchError', async () => {
    const callback = tdv2({}, tdv2Message({ HashPassword: HASH_PASSWORD }))
    const echo = (f: Data, over: Data = {}) => provisionXml(provisionFor(f, over, { HashPassword: HASH_PASSWORD }))
    const ok = (await run(callback, tdv2Order(), { provision: (f) => echo(f) }).promise) as Data
    expect(ok.status).toBe('approved')
    expect(ok['3d_all'].VPosMessage.HashPassword).toBe('***')
    expect(ok.all.VPosMessage.HashPassword).toBe('***')
    expect(JSON.stringify(ok)).not.toContain(HASH_PASSWORD)

    const err = await mismatch(
      run(callback, tdv2Order(), { provision: (f) => echo(f, { MerchantOrderId: 'X' }) }).promise,
    )
    expect(JSON.stringify(err.response)).not.toContain(HASH_PASSWORD)
    expect((err.response as Data)['3d_all'].VPosMessage.HashPassword).toBe('***')
  })

  // addition: concurrent payments on one gateway never share state
  it('two concurrent payments keep their own provision bodies and results', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    const other = 'B2024042111'
    const [a, b] = (await Promise.all([
      p.payment(MODEL.THREE_D_SECURE, tdv2Order(), TX_TYPE.PAY_AUTH, null, {
        AuthenticationResponse: authResponse(tdv2()),
      }),
      p.payment(MODEL.THREE_D_SECURE, tdv2Order({ id: other, amount: 2.02 }), TX_TYPE.PAY_AUTH, null, {
        AuthenticationResponse: authResponse(
          tdv2(
            { MerchantOrderId: other, OrderId: '155767807' },
            tdv2Message({ MerchantOrderId: other, Amount: '202' }),
          ),
        ),
      }),
    ])) as [Data, Data]
    expect([a.status, a.order_id, a.amount]).toStrictEqual(['approved', ORDER_ID, 1.01])
    expect([b.status, b.order_id, b.amount]).toStrictEqual(['approved', other, 2.02])
    expect(sent.map((s) => `${s.fields.MerchantOrderId}:${s.fields.Amount}`).sort()).toStrictEqual([
      `${ORDER_ID}:101`,
      `${other}:202`,
    ])
  })
})

describe('KuveytPos (end to end) 3D form', () => {
  const formOrder: PosOrder = {
    id: '2020110828BC',
    amount: 10.01,
    installment: 0,
    currency: CURRENCY.TRY,
    success_url: 'https://example.com/success',
    fail_url: 'https://example.com/fail',
    ip: '127.0.0.1',
    lang: LANG.TR,
    payment_channel: '02',
    buyer: { email: 'buyer@example.com', gsm_number_cc: '90', gsm_number: '5000000000' },
    billing_address: { city: 'İstanbul', country: '792', address: 'Örnek Sk. 1', zip_code: '34000', state: '34' },
  }
  const card = (p: KuveytPos) =>
    CreditCardFactory.createForGateway(p, '4155650100416111', '25', '1', '123', 'John Doe', CARD_TYPE.VISA)

  // addition: K9 the server posts the card to the bank once and returns the bank's page
  it('posts the signed card form to ThreeDModelPayGate and returns the page', async () => {
    const { sent, fetchImpl } = bankFetch({ form: '<html><body>3D</body></html>' })
    const p = realGateway(fetchImpl)
    const html = await p.get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card(p))

    expect(html).toBe('<html><body>3D</body></html>')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(`${PAYMENT_API}/ThreeDModelPayGate`)
    expect(sent[0]?.text).toContain('&#x130;stanbul')
    expect(sent[0]?.text).toContain('\xD6rnek')
    const f = sent[0]?.fields as Data
    expect(f.CardNumber).toBe('4155650100416111')
    expect(f.CardCVV2).toBe('123')
    expect(f.CardExpireDateYear).toBe('25')
    expect(f.CardExpireDateMonth).toBe('01')
    expect(f.CardHolderName).toBe('John Doe')
    expect(f.CardType).toBe('Visa')
    expect(f.Amount).toBe('1001')
    expect(f.CardHolderData.BillAddrCity).toBe('İstanbul')
    expect(f.HashData).toBe(
      RQ({
        MerchantId: '496',
        MerchantOrderId: '2020110828BC',
        Amount: '1001',
        OkUrl: 'https://example.com/success',
        FailUrl: 'https://example.com/fail',
        UserName: 'apiuser1',
      }),
    )
  })

  it.each([[''], ['   ']])('an empty bank page %j is PosError', async (page) => {
    const { fetchImpl } = bankFetch({ form: page })
    const p = realGateway(fetchImpl)
    await expect(p.get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card(p))).rejects.toThrow(PosError)
  })

  it('refuses the array format without a request', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    await expect(
      p.get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card(p), false, FORM_FORMAT.ARRAY),
    ).rejects.toThrow(new UnsupportedFormFormatError('Unsupported 3D form format!'))
    expect(sent).toHaveLength(0)
  })

  // addition: B6 bad amounts never reach the bank
  it.each([[0.004], [0], [-1], ['abc'], [1e13]])('amount %j is PosError before any request', async (amount) => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    await expect(
      p.get3DFormData({ ...formOrder, amount: amount as number }, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card(p)),
    ).rejects.toThrow(PosError)
    const callbackRun = realGateway(fetchImpl).payment(
      MODEL.THREE_D_SECURE,
      tdv2Order({ amount: amount as number }),
      TX_TYPE.PAY_AUTH,
      null,
      { AuthenticationResponse: authResponse(tdv2()) },
    )
    await expect(callbackRun).rejects.toThrow(PosError)
    expect(sent).toHaveLength(0)
  })
})

describe('KuveytPos (end to end) non-3D and SOAP transactions', () => {
  const c = (p: KuveytPos) =>
    CreditCardFactory.createForGateway(p, '4155650100416111', '25', '1', '123', 'John Doe', CARD_TYPE.VISA)

  // addition: a non-secure sale; the echoed HashPassword is replaced in all
  it('a non-secure sale is approved and its echoed HashPassword replaced', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    const res = (await p.payment(MODEL.NON_SECURE, { id: 'N1', amount: 1.15 }, TX_TYPE.PAY_AUTH, c(p))) as Data
    expect(res.status).toBe('approved')
    expect(res.all.VPosMessage.HashPassword).toBe('***')
    expect(JSON.stringify(res)).not.toContain(HASH_PASSWORD)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(`${PAYMENT_API}/Non3DPayGate`)
    expect(sent[0]?.fields.Amount).toBe('115')
    expect(sent[0]?.fields.TransactionSecurity).toBe('1')
    expect(sent[0]?.fields.CardNumber).toBe('4155650100416111')
  })

  // addition: K6 status over SOAP
  it('status posts GetMerchantOrderDetail and maps the record approved', async () => {
    const { sent, fetchImpl } = bankFetch()
    const res = (await realGateway(fetchImpl).status({ id: '2023070849CD' })) as Data
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(QUERY_API)
    expect(sent[0]?.headers.get('SOAPAction')).toBe(`${SOAP_ACTION_PREFIX}GetMerchantOrderDetail`)
    expect(sent[0]?.text).toContain('<ser:MerchantOrderId>2023070849CD</ser:MerchantOrderId>')
    expect(res.status).toBe('approved')
    expect(res.order_id).toBe('2023070849CD')
    expect(res.auth_code).toBe('241839')
  })

  const reversal = (over: PosOrder = {}): PosOrder => ({
    id: '202404218A62',
    remote_order_id: '155767811',
    ref_ret_num: '411220539231',
    auth_code: '050569',
    transaction_id: '539231',
    amount: 10.01,
    currency: CURRENCY.TRY,
    ...over,
  })

  it('a partial refund posts PartialDrawback', async () => {
    const { sent, fetchImpl } = bankFetch()
    const res = (await realGateway(fetchImpl).refund(reversal({ amount: 9.01, order_amount: 10.01 }))) as Data
    expect(sent[0]?.headers.get('SOAPAction')).toBe(`${SOAP_ACTION_PREFIX}PartialDrawback`)
    expect(sent[0]?.text).toContain('<ser:Amount>901</ser:Amount>')
    expect(res.status).toBe('approved')
  })

  it('a full refund posts DrawBack and a cancel SaleReversal', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    expect(((await p.refund(reversal())) as Data).status).toBe('approved')
    expect(((await p.cancel(reversal())) as Data).status).toBe('approved')
    expect(sent.map((s) => s.headers.get('SOAPAction'))).toStrictEqual([
      `${SOAP_ACTION_PREFIX}DrawBack`,
      `${SOAP_ACTION_PREFIX}SaleReversal`,
    ])
  })

  it('a SOAP fault in a 200 answer is PosHttpError with the fault text', async () => {
    const { fetchImpl } = bankFetch({
      soap: () =>
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>Invalid dates</faultstring></s:Fault></s:Body></s:Envelope>',
    })
    const err = await realGateway(fetchImpl)
      .status({ id: '2023070849CD' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as Error).message).toBe('Bank SOAP fault: Invalid dates')
  })
})

describe('KuveytPos (end to end) masking', () => {
  // addition: B11 nothing secret reaches the logger
  it('never logs the password, the hashed password, the card number, the CVV, the raw callback or a hash', async () => {
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
      provision: (f) => provisionXml(provisionFor(f, {}, { HashPassword: HASH_PASSWORD })),
    })
    const p = realGateway(fetchImpl, { logger })
    const card = CreditCardFactory.createForGateway(p, '4155650100416111', '25', '1', '123', 'John Doe', CARD_TYPE.VISA)
    const formOrder: PosOrder = {
      ...tdv2Order({ id: '2020110828BC' }),
      success_url: 'https://example.com/success',
      fail_url: 'https://example.com/fail',
      payment_channel: '02',
      buyer: {},
      billing_address: {},
    }
    const callback = authResponse(tdv2({}, tdv2Message({ HashPassword: HASH_PASSWORD })))
    const tampered = tdv2({ HashData: CB(ORDER_ID, '00', '155767807') })
    const tamperedHash = CB(ORDER_ID, '00', BANK_ORDER_ID) // what the crypt computes for the tampered callback

    await p.get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
    await p.payment(MODEL.THREE_D_SECURE, tdv2Order(), TX_TYPE.PAY_AUTH, null, { AuthenticationResponse: callback })
    await p
      .payment(MODEL.THREE_D_SECURE, tdv2Order(), TX_TYPE.PAY_AUTH, null, {
        AuthenticationResponse: authResponse(tampered),
      })
      .catch(() => undefined)
    await p
      .payment(MODEL.THREE_D_SECURE, tdv2Order(), TX_TYPE.PAY_AUTH, null, {
        AuthenticationResponse: authResponse(tdv2({}, tdv2Message({ Amount: '1', HashPassword: HASH_PASSWORD }))),
      })
      .catch(() => undefined)
    await p.payment(MODEL.NON_SECURE, { id: 'N1', amount: 1.01 }, TX_TYPE.PAY_AUTH, card)
    await p.status({ id: '2023070849CD' })
    const reversal = {
      id: 'R1',
      remote_order_id: '1',
      ref_ret_num: '2',
      auth_code: '3',
      transaction_id: '4',
      amount: 1,
    }
    await p.cancel(reversal)
    await p.refund(reversal)

    const logged = JSON.stringify(records)
    expect(records.length).toBeGreaterThan(0)
    expect(sent.length).toBe(6)
    expect(logged).not.toContain(PASSWORD)
    expect(logged).not.toContain(HASH_PASSWORD)
    expect(logged).not.toContain('4155650100416111')
    expect(logged).not.toMatch(/CardCVV2\\?"\s*:\s*\\?"?123/)
    expect(logged).not.toContain(callback)
    expect(logged).not.toContain(callback.slice(0, 80))
    expect(logged).not.toContain(tamperedHash)
    for (const s of sent) {
      if (typeof s.fields.HashData === 'string') expect(logged).not.toContain(s.fields.HashData)
    }
  })
})
