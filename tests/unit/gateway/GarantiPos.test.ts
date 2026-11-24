import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { GarantiPosHttpClient } from '../../../src/client/GarantiPosHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { GarantiPosCrypt } from '../../../src/crypt/GarantiPosCrypt.js'
import { GarantiPosRequestDataMapper } from '../../../src/data-mapper/request/mapper/GarantiPosRequestDataMapper.js'
import type { RequestDataMapperInterface } from '../../../src/data-mapper/request/mapper/RequestDataMapperInterface.js'
import { GarantiPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/GarantiPosRequestValueFormatter.js'
import { GarantiPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/GarantiPosRequestValueMapper.js'
import { GarantiPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/GarantiPosResponseDataMapper.js'
import type { ResponseDataMapperInterface } from '../../../src/data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { GarantiPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/GarantiPosResponseValueFormatter.js'
import { GarantiPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/GarantiPosResponseValueMapper.js'
import {
  HashMismatchError,
  MissingAccountInfoError,
  OrderMismatchError,
  PosError,
  PosHttpError,
  UnsupportedFormFormatError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../src/factory/CreditCardFactory.js'
import type { GatewayConfig, GatewayDeps } from '../../../src/gateway/AbstractGateway.js'
import { GarantiPos } from '../../../src/gateway/GarantiPos.js'
import type { PosLogger } from '../../../src/logger.js'
import type { GarantiPosAccount } from '../../../src/model/account/GarantiPosAccount.js'
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
import { threeDPayPaymentDataProvider } from '../data-mapper/response/mapper/GarantiPosResponseDataMapper.data.js'

// Dependencies are replaced by vi.fn() fakes except the request value mapper and formatter (the callback binding
// uses them); the end-to-end section at the bottom uses the real mappers, crypt and HTTP client over a fake fetch.

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

const PAYMENT_API = 'https://sanalposprovtest.garantibbva.com.tr/VPServlet'
const GATEWAY_3D = 'https://sanalposprovtest.garantibbva.com.tr/servlet/gt3dengine'

const config: GatewayConfig = {
  name: 'Garanti',
  class: 'GarantiPos',
  gateway_endpoints: { payment_api: PAYMENT_API, gateway_3d: GATEWAY_3D },
}

/** `disable_3d_hash_check` is not an option; passing it must have no effect. */
const configWithHashCheckDisabled = {
  ...config,
  gateway_configs: { disable_3d_hash_check: true },
} as unknown as GatewayConfig

const createAccount = (): GarantiPosAccount =>
  AccountFactory.createGarantiPosAccount(
    'garanti',
    '7000679',
    'PROVAUT',
    '123qweASD/',
    '30691298',
    '12345678',
    'PROVRFN',
    '123qweASD/',
  )

const createLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })

describe('GarantiPos (mocked collaborators)', () => {
  const account = createAccount()
  let requestValueMapper: GarantiPosRequestValueMapper
  let requestMapper: Mocked<RequestDataMapperInterface>
  let responseMapper: Mocked<ResponseDataMapperInterface>
  let crypt: Mocked<CryptInterface>
  let httpClient: { supportsTx: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }
  let clientStrategy: { getClient: ReturnType<typeof vi.fn>; getAllClients: ReturnType<typeof vi.fn> }
  let requestDataPrepared: ReturnType<typeof vi.fn<(e: RequestDataPreparedEvent) => void>>
  let logger: ReturnType<typeof createLogger>
  let pos: GarantiPos

  const createGateway = (cfg: GatewayConfig): GarantiPos => {
    const hooks: PosHooks = { onRequestDataPrepared: [requestDataPrepared] }
    const deps: GatewayDeps<GarantiPosAccount> = {
      requestValueMapper,
      requestValueFormatter: new GarantiPosRequestValueFormatter(),
      requestDataMapper: requestMapper as unknown as RequestDataMapperInterface<GarantiPosAccount>,
      responseDataMapper: responseMapper as unknown as ResponseDataMapperInterface,
      crypt: crypt as unknown as CryptInterface<GarantiPosAccount>,
      clientStrategy: clientStrategy as unknown as HttpClientStrategy,
      logger,
      hooks,
    }
    return new GarantiPos(cfg, account, deps)
  }

  beforeEach(() => {
    requestValueMapper = new GarantiPosRequestValueMapper()
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

  /** One client call, one hook dispatch that changes the request data. */
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
      expect(event.gatewayClass).toBe('GarantiPos')
      expect(event.txType).toBe(txType)
      expect(event.requestData).toStrictEqual(requestData)
      expect(event.order).toStrictEqual(order)
      expect(event.paymentModel).toBe(paymentModel)
      event.requestData['test-update-request-data-with-event'] = true
    })

    return () => {
      expect(clientStrategy.getClient).toHaveBeenCalledTimes(1)
      expect(clientStrategy.getClient).toHaveBeenCalledWith(txType, paymentModel)
      expect(requestDataPrepared).toHaveBeenCalledTimes(1)
      expect(httpClient.request).toHaveBeenCalledTimes(1)
      const [tx, model, data, sentOrder, url] = httpClient.request.mock.calls[0] as unknown[]
      expect([tx, model, sentOrder, url]).toStrictEqual([txType, paymentModel, order, null])
      expect((data as Data)['test-update-request-data-with-event']).toBe(true)
    }
  }

  it('init', () => {
    expect(pos.getCurrencies()).toHaveLength(Object.keys(requestValueMapper.getCurrencyMappings()).length)
    expect(pos.getAccount()).toBe(account)
    expect(pos.isTestMode()).toBe(false)
    expect(pos.getCrypt()).toBe(crypt)
  })

  it('init on test mode', () => {
    // deviation: G17 test_mode lives at the top level of the TS config
    const p = createGateway({ ...config, test_mode: true })

    expect(requestMapper.setTestMode).toHaveBeenCalledTimes(1)
    expect(requestMapper.setTestMode).toHaveBeenCalledWith(true)
    expect(logger.warn).not.toHaveBeenCalled()
    expect(p.isTestMode()).toBe(true)
  })

  // addition: identifiers and the supported transactions table
  it('exposes NAME, the gateway class identifier and the supported transactions', () => {
    expect(GarantiPos.NAME).toBe('GarantiPay')
    expect(GarantiPos.GATEWAY_CLASS).toBe('GarantiPos')
    for (const tx of [TX_TYPE.PAY_AUTH, TX_TYPE.PAY_PRE_AUTH]) {
      for (const model of [MODEL.THREE_D_SECURE, MODEL.THREE_D_PAY, MODEL.NON_SECURE]) {
        expect(GarantiPos.isSupportedTransaction(tx, model)).toBe(true)
      }
      expect(GarantiPos.isSupportedTransaction(tx, MODEL.THREE_D_HOST)).toBe(false)
      expect(GarantiPos.isSupportedTransaction(tx, MODEL.THREE_D_PAY_HOSTING)).toBe(false)
    }
    for (const tx of [
      TX_TYPE.PAY_POST_AUTH,
      TX_TYPE.STATUS,
      TX_TYPE.CANCEL,
      TX_TYPE.REFUND,
      TX_TYPE.REFUND_PARTIAL,
      TX_TYPE.ORDER_HISTORY,
    ]) {
      expect(GarantiPos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(true)
    }
  })

  it.each([true])('get3DFormData (with card: %s)', async (isWithCard) => {
    const c = isWithCard ? card() : null
    const paymentModel = isWithCard ? MODEL.THREE_D_SECURE : MODEL.THREE_D_HOST
    const order = { id: '124' }
    const txType = TX_TYPE.PAY_AUTH
    requestMapper.create3DFormData.mockResolvedValue({ formData: true })

    const actual = await pos.get3DFormData(order, paymentModel, txType, c, !isWithCard)

    expect(requestMapper.create3DFormData).toHaveBeenCalledTimes(1)
    expect(requestMapper.create3DFormData).toHaveBeenCalledWith(account, order, '3d', 'pay', GATEWAY_3D, c)
    expect(actual).toStrictEqual({ formData: true })
  })

  // deviation: G16 messages and error classes of the shared 3D form input check
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
      true,
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
  ] as Array<[string, PaymentModel, TxType, boolean, boolean, typeof PosError, string, FormFormat | null]>)(
    'get3DFormData with bad inputs: %s',
    async (_name, paymentModel, txType, isWithCard, createWithoutCard, errorClass, message, formFormat) => {
      const c = isWithCard ? card() : null
      const result = pos.get3DFormData({ id: '2020110828BC' }, paymentModel, txType, c, createWithoutCard, formFormat)
      await expect(result).rejects.toThrow(errorClass)
      await expect(result).rejects.toThrow(message)
      expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
    },
  )

  /**
   * Callback echo fields of a 3D Secure order (deviation: G5 binding needs the order and the echo fields; a signed
   * callback also carries the terminal as clientid).
   */
  const boundEcho = (orderId: string): Data => ({
    clientid: '30691298',
    oid: orderId,
    orderid: orderId,
    txnamount: '101',
    txncurrencycode: '949',
    txntype: 'sales',
    secure3dsecuritylevel: '3D',
    hash: 'H',
  })
  const boundOrder = (orderId: string): PosOrder => ({
    id: orderId,
    amount: 1.01,
    currency: CURRENCY.TRY,
    ip: '127.0.0.1',
  })

  const make3DPaymentCases: Array<[string, PosOrder, TxType, Data, Data, Data, boolean]> = [
    [
      '3d_auth_fail_1',
      {},
      'pay',
      {
        apiversion: '512',
        authcode: '',
        cavv: '',
        hash: 'FD9BF014BFBC3D977B123AE84247CE3F639913644429304C4EE108C0F40212853628CAECAADB798EE73D467F50C3B5D90FE0F3B921EDAA94B6E2EA888F9FE9B7',
        hashparams: 'clientid:oid:authcode:procreturncode:response:mdstatus:cavv:eci:md:rnd:',
        hashparamsval:
          '30691298202409078CF30aW5kZXg6MDIYjoYTHmZE91tOHZxS3PEkMcb8vBvm21xQz107TS6WKHVjLlrZP9AMx7KFu8jZRZA3WtZxMUuaUynWLxQGsVrw1vTKIofUQ0dw2P/jVVvPMX/RxI7Bpjvo/pZp3Nmbj2wd1W146UhNNmge7eA+hdrNSHuPp7PmjAihyZEPujAi3Q==6ga2Y3buKZ3ZcJSC7uE6',
        hostmsg: '',
        md: 'aW5kZXg6MDIYjoYTHmZE91tOHZxS3PEkMcb8vBvm21xQz107TS6WKHVjLlrZP9AMx7KFu8jZRZA3WtZxMUuaUynWLxQGsVrw1vTKIofUQ0dw2P/jVVvPMX/RxI7Bpjvo/pZp3Nmbj2wd1W146UhNNmge7eA+hdrNSHuPp7PmjAihyZEPujAi3Q==',
        mderrormessage: '',
        secure3dhash: '9F3027C22FB3485484144993',
      },
      {},
      // deviation: G7 the not 3D-successful path must map as declined (fail closed), so the stub says so
      { order_id: '202409078CF3', transaction_id: null, auth_code: null, status: 'declined' },
      false,
    ],
    [
      '3d_auth_success_payment_fail',
      boundOrder('20221101295D'),
      'pay',
      {
        xid: 'RszfrwEYe/8xb7rnrPuh6C9pZSQ=',
        md: 'G1YfkxEZ8Noemg4MRspO20vEiXaEk51ANsgVc6NOy8kHpgH0Bj2jGdc4n47VV2IxRcLSwiw3+DC4zpyj2qtCo8LA5ACL2pHmusSpDmp+kAJOIQTFpsCfJ53tob4+xTUbctQuxBd4u+Bqs1looyNEeg==',
        rnd: 'Nvx8y+0R3sR5mfDVLtVD',
        hash: 'K1eaT12s4oPbvQDfA6YIMCfH6HQ=',
        hashparams: 'clientid:oid:authcode:procreturncode:response:mdstatus:cavv:eci:md:rnd:',
        hashparamsval:
          '3069129820221101295D1jCm0m+u/0hUfAREHBAMBcfN+pSo=02G1YfkxEZ8Noemg4MRspO20vEiXaEk51ANsgVc6NOy8kHpgH0Bj2jGdc4n47VV2IxRcLSwiw3+DC4zpyj2qtCo8LA5ACL2pHmusSpDmp+kAJOIQTFpsCfJ53tob4+xTUbctQuxBd4u+Bqs1looyNEeg==Nvx8y+0R3sR5mfDVLtVD',
        ...boundEcho('20221101295D'),
      },
      { Mode: '', Terminal: { ProvUserID: 'PROVAUT', UserID: 'PROVAUT', ID: '30691298', MerchantID: '7000679' } },
      { order_id: '20221101295D', transaction_id: '20221101295D' },
      true,
    ],
    [
      'success',
      boundOrder('202312238064'),
      'pay',
      {
        xid: '748ac354-4bfe-4b40-aa12-5ea025b7399b',
        mdstatus: '1',
        mderrormessage: 'Y-status/Challenge authentication via ACS: https://gbemv3dsecure.garanti.com.tr/web/creq',
        ...boundEcho('202312238064'),
      },
      { Mode: null, Terminal: { ProvUserID: 'PROVAUT', UserID: 'PROVAUT', ID: '30691298', MerchantID: '7000679' } },
      { order_id: '202312238064', transaction_id: '202312238064', status: 'approved' },
      true,
    ],
  ]

  const make3DPaymentWithoutHashCheckCases: Array<[string, PosOrder, TxType, Data, Data, Data, boolean]> = [
    [
      '3d_auth_success_payment_fail',
      boundOrder('20221101295D'),
      'pay',
      {
        xid: 'RszfrwEYe/8xb7rnrPuh6C9pZSQ=',
        mdstatus: '1',
        mderrormessage: 'Authenticated',
        ...boundEcho('20221101295D'),
      },
      { Mode: '', Terminal: { ProvUserID: 'PROVAUT', UserID: 'PROVAUT', ID: '30691298', MerchantID: '7000679' } },
      { order_id: '20221101295D', transaction_id: '20221101295D', auth_code: null, status: 'declined' },
      true,
    ],
    [
      'success',
      boundOrder('202312238064'),
      'pay',
      {
        xid: '748ac354-4bfe-4b40-aa12-5ea025b7399b',
        mdstatus: '1',
        mderrormessage: 'Y-status/Challenge authentication via ACS: https://gbemv3dsecure.garanti.com.tr/web/creq',
        txnstatus: null,
        ...boundEcho('202312238064'),
      },
      { Mode: null, Terminal: { ProvUserID: 'PROVAUT', UserID: 'PROVAUT', ID: '30691298', MerchantID: '7000679' } },
      { order_id: '202312238064', transaction_id: '202312238064', md_status: '1', status: 'approved' },
      true,
    ],
  ]

  const runMake3DPayment = async (
    p: GarantiPos,
    order: PosOrder,
    txType: TxType,
    gatewayResponseData: GatewayResponseData,
    paymentResponse: Data,
    expectedResponse: Data,
    is3DSuccess: boolean,
  ) => {
    responseMapper.extractMdStatus.mockReturnValue('3d-status')
    responseMapper.is3dAuthSuccess.mockReturnValue(is3DSuccess)
    responseMapper.map3DPaymentData.mockReturnValue(expectedResponse)
    const create3DPaymentRequestData = { create3DPaymentRequestData: true }
    let verify = () => {}
    if (is3DSuccess) {
      crypt.check3DHash.mockReturnValue(true)
      requestMapper.create3DPaymentRequestData.mockReturnValue(create3DPaymentRequestData)
      verify = configureClientResponse(txType, create3DPaymentRequestData, paymentResponse, order, MODEL.THREE_D_SECURE)
    }

    const result = await p.payment(MODEL.THREE_D_SECURE, order, txType, null, gatewayResponseData)

    expect(responseMapper.extractMdStatus).toHaveBeenCalledTimes(1)
    expect(responseMapper.extractMdStatus).toHaveBeenCalledWith(gatewayResponseData)
    expect(responseMapper.is3dAuthSuccess).toHaveBeenCalledTimes(1)
    expect(responseMapper.is3dAuthSuccess).toHaveBeenCalledWith('3d-status')
    expect(responseMapper.map3DPaymentData).toHaveBeenCalledTimes(1)
    if (is3DSuccess) {
      expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
      expect(crypt.check3DHash).toHaveBeenCalledWith(account, gatewayResponseData)
      expect(requestMapper.create3DPaymentRequestData).toHaveBeenCalledWith(account, order, txType, gatewayResponseData)
      verify()
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(gatewayResponseData, paymentResponse, txType, order)
    } else {
      expect(crypt.check3DHash).not.toHaveBeenCalled()
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(gatewayResponseData, null, txType, order)
      expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
      expect(requestDataPrepared).not.toHaveBeenCalled()
      expect(httpClient.request).not.toHaveBeenCalled()
    }
    // deviation: G20 the result is returned, there is no isSuccess() state
    expect(result).toBe(expectedResponse)
  }

  it.each(make3DPaymentCases)('make3DPayment %s', async (_name, ...args) => {
    await runMake3DPayment(pos, ...args)
  })

  // deviation: G3 the hash check cannot be disabled; check3DHash is still called once
  it.each(make3DPaymentWithoutHashCheckCases)('make3DPayment without hash check %s', async (_name, ...args) => {
    await runMake3DPayment(createGateway(configWithHashCheckDisabled), ...args)
  })

  it('make3DPayment hash mismatch', async () => {
    const data = {
      xid: 'RszfrwEYe/8xb7rnrPuh6C9pZSQ=',
      md: 'G1YfkxEZ8Noemg4MRspO20vEiXaEk51ANsgVc6NOy8kHpgH0Bj2jGdc4n47VV2IxRcLSwiw3+DC4zpyj2qtCo8LA5ACL2pHmusSpDmp+kAJOIQTFpsCfJ53tob4+xTUbctQuxBd4u+Bqs1looyNEeg==',
      terminalid: '30691298',
      oid: '20221101295D',
      rnd: 'Nvx8y+0R3sR5mfDVLtVD',
      hash: 'K1eaT12s4oPbvQDfA6YIMCfH6HQ=',
      hashparams: 'clientid:oid:authcode:procreturncode:response:mdstatus:cavv:eci:md:rnd:',
      hashparamsval:
        '3069129820221101295D1jCm0m+u/0hUfAREHBAMBcfN+pSo=02G1YfkxEZ8Noemg4MRspO20vEiXaEk51ANsgVc6NOy8kHpgH0Bj2jGdc4n47VV2IxRcLSwiw3+DC4zpyj2qtCo8LA5ACL2pHmusSpDmp+kAJOIQTFpsCfJ53tob4+xTUbctQuxBd4u+Bqs1looyNEeg==Nvx8y+0R3sR5mfDVLtVD',
    }
    crypt.check3DHash.mockReturnValue(false)
    responseMapper.is3dAuthSuccess.mockReturnValue(true)

    await expect(pos.payment(MODEL.THREE_D_SECURE, {}, TX_TYPE.PAY_AUTH, null, data)).rejects.toThrow(HashMismatchError)
    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
    expect(crypt.check3DHash).toHaveBeenCalledWith(account, data)
    expect(responseMapper.map3DPaymentData).not.toHaveBeenCalled()
    expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
    expect(requestDataPrepared).not.toHaveBeenCalled()
  })

  it('make3DHostPayment', async () => {
    // deviation: G16 called directly: payment() rejects the unsupported model before reaching it
    await expect(pos.make3DHostPayment({ a: 'b' }, {}, TX_TYPE.PAY_AUTH)).rejects.toThrow(UnsupportedPaymentModelError)
  })

  // addition: the 3D Host model is not in the supported transactions table
  it('payment with the 3D Host model is an unsupported transaction', async () => {
    await expect(pos.payment(MODEL.THREE_D_HOST, {}, TX_TYPE.PAY_AUTH, null, { abc: 'x' })).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
  })

  const threeDPayCallback = (): Data => ({
    clientid: '30691298',
    hash: 'H',
    hashparams: 'clientid:oid:authcode:procreturncode:response:mdstatus:cavv:eci:md:rnd:',
    oid: '123',
    txnamount: '101',
    txncurrencycode: '949',
    txntype: 'sales',
    secure3dsecuritylevel: '3D_PAY',
  })

  it('make3DPayPayment', async () => {
    // deviation: G5 the callback echoes the order fields and the mapped response belongs to the order
    const responseData = threeDPayCallback()
    const order = { id: '123', amount: 1.01, currency: CURRENCY.TRY }
    const txType = TX_TYPE.PAY_AUTH
    const mapped = { status: 'approved', order_id: '123', proc_return_code: '00' }
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.map3DPayResponseData.mockReturnValue(mapped)

    const result = await pos.payment(MODEL.THREE_D_PAY, order, txType, null, responseData)

    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
    expect(crypt.check3DHash).toHaveBeenCalledWith(account, responseData)
    expect(responseMapper.map3DPayResponseData).toHaveBeenCalledWith(responseData, txType, order)
    expect(result).toStrictEqual({ status: 'approved', order_id: '123', proc_return_code: '00' })
  })

  it('make3DPayPayment hash mismatch', async () => {
    const responseData = threeDPayCallback()
    crypt.check3DHash.mockReturnValue(false)

    await expect(pos.payment(MODEL.THREE_D_PAY, { id: '123' }, TX_TYPE.PAY_AUTH, null, responseData)).rejects.toThrow(
      HashMismatchError,
    )
    expect(crypt.check3DHash).toHaveBeenCalledWith(account, responseData)
    expect(responseMapper.map3DPayResponseData).not.toHaveBeenCalled()
  })

  it.each([TX_TYPE.PAY_AUTH, TX_TYPE.PAY_PRE_AUTH])('makeRegularPayment %s', async (txType) => {
    const order = { id: '2020110828BC' }
    const c = card()
    const requestData = { createNonSecurePaymentRequestData: true }
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue(requestData)
    const decodedResponse = { paymentResponse: true }
    const verify = configureClientResponse(txType, requestData, decodedResponse, order, MODEL.NON_SECURE)
    responseMapper.mapPaymentResponse.mockReturnValue({ result: true })

    await expect(pos.payment(MODEL.NON_SECURE, order, txType, c)).resolves.toStrictEqual({ result: true })

    expect(requestMapper.createNonSecurePaymentRequestData).toHaveBeenCalledWith(account, order, txType, c)
    verify()
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith(decodedResponse, txType, order)
  })

  it('makeRegularPostAuthPayment', async () => {
    const order = { id: '2020110828BC' }
    const txType = TX_TYPE.PAY_POST_AUTH
    const requestData = { createNonSecurePostAuthPaymentRequestData: true }
    requestMapper.createNonSecurePostAuthPaymentRequestData.mockReturnValue(requestData)
    const decodedResponse = { decodedData: true }
    const verify = configureClientResponse(txType, requestData, decodedResponse, order, MODEL.NON_SECURE)
    responseMapper.mapPaymentResponse.mockReturnValue({ result: true })

    await pos.payment(MODEL.NON_SECURE, order, txType)

    expect(requestMapper.createNonSecurePostAuthPaymentRequestData).toHaveBeenCalledWith(account, order)
    verify()
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith(decodedResponse, txType, order)
  })

  it.each([
    ['status', TX_TYPE.STATUS, 'createStatusRequestData', 'mapStatusResponse'],
    ['cancel', TX_TYPE.CANCEL, 'createCancelRequestData', 'mapCancelResponse'],
    ['orderHistory', TX_TYPE.ORDER_HISTORY, 'createOrderHistoryRequestData', 'mapOrderHistoryResponse'],
  ] as const)('%s request', async (method, txType, createMethod, mapMethod) => {
    const order = { id: '2020110828BC' }
    const requestData = { [createMethod]: true }
    requestMapper[createMethod].mockReturnValue(requestData)
    const decodedResponse = { decodedData: true }
    const verify = configureClientResponse(txType, requestData, decodedResponse, order, MODEL.NON_SECURE)
    responseMapper[mapMethod].mockReturnValue({ result: true })

    await expect(pos[method](order)).resolves.toStrictEqual({ result: true })

    expect(requestMapper[createMethod]).toHaveBeenCalledWith(account, order)
    verify()
    expect(responseMapper[mapMethod]).toHaveBeenCalledWith(decodedResponse)
  })

  it('refund request', async () => {
    const order = { id: '2020110828BC' }
    const txType = TX_TYPE.REFUND
    const requestData = { createRefundRequestData: true }
    requestMapper.createRefundRequestData.mockReturnValue(requestData)
    const decodedResponse = { decodedData: true }
    const verify = configureClientResponse(txType, requestData, decodedResponse, order, MODEL.NON_SECURE)
    responseMapper.mapRefundResponse.mockReturnValue({ result: true })

    await expect(pos.refund(order)).resolves.toStrictEqual({ result: true })

    expect(requestMapper.createRefundRequestData).toHaveBeenCalledWith(account, order, txType)
    verify()
    expect(responseMapper.mapRefundResponse).toHaveBeenCalledWith(decodedResponse)
  })

  // ---- additions: callback shape and binding with mocked collaborators ----

  describe('3D Secure callback checks before provisioning', () => {
    const order = boundOrder('ORDER-1')
    const callback = (extra: Data = {}): Data => ({ mdstatus: '1', ...boundEcho('ORDER-1'), ...extra })
    const run = (cb: Data, o: PosOrder = order, txType: TxType = TX_TYPE.PAY_AUTH) => {
      responseMapper.extractMdStatus.mockReturnValue('1')
      responseMapper.is3dAuthSuccess.mockReturnValue(true)
      crypt.check3DHash.mockReturnValue(true)
      return pos.payment(MODEL.THREE_D_SECURE, o, txType, null, cb).catch((e: unknown) => e)
    }
    const expectNothingSent = () => {
      expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
      expect(requestDataPrepared).not.toHaveBeenCalled()
      expect(httpClient.request).not.toHaveBeenCalled()
      expect(responseMapper.map3DPaymentData).not.toHaveBeenCalled()
    }

    // addition: carried from the request mapper review, forged form bodies may send arrays or objects
    it.each([
      ['orderid', ['ORDER-1']],
      ['oid', { 0: 'ORDER-1' }],
      ['txnamount', ['101']],
      ['txncurrencycode', 949],
      ['txntype', ['sales']],
      ['customeripaddress', { ip: '127.0.0.1' }],
      ['cavv', ['x']],
      ['eci', { a: '02' }],
      ['xid', ['x']],
      ['md', ['x']],
      ['terminalid', ['30691298']],
      ['terminalmerchantid', ['7000679']],
      ['secure3dsecuritylevel', ['3D']],
      ['mdstatus', ['1']],
      ['response', ['Approved']],
    ])('rejects a non-string %s with PosError and sends nothing', async (field, value) => {
      const err = await run(callback({ [field]: value }))
      expect(err).toBeInstanceOf(PosError)
      expect(err).not.toBeInstanceOf(OrderMismatchError)
      expect((err as PosError).message).toContain(field)
      expectNothingSent()
    })

    // addition: a null field counts as missing (the request mapper defaults or requires it)
    it('accepts null optional fields', async () => {
      requestMapper.create3DPaymentRequestData.mockReturnValue({ r: 1 })
      clientStrategy.getClient.mockReturnValue(httpClient as unknown as AbstractHttpClient)
      httpClient.request.mockResolvedValue({})
      responseMapper.map3DPaymentData.mockReturnValue({ status: 'approved' })
      await expect(run(callback({ cavv: null, txnstatus: null }))).resolves.toStrictEqual({ status: 'approved' })
    })

    // addition: G5 the provision request takes orderid from the callback, so orderid must be present
    it('rejects an oid-only callback (no orderid) with OrderMismatchError order_id', async () => {
      const { orderid: _omitted, ...cb } = callback()
      const err = (await run(cb)) as OrderMismatchError
      expect(err).toBeInstanceOf(OrderMismatchError)
      expect(err.field).toBe('order_id')
      expect(err.actual).toBe('')
      expect(err.response).toBeUndefined()
      expect(err.paymentMayHaveCompleted).toBe(false)
      expectNothingSent()
    })

    // addition: G5 oid, when present, must also be the order id
    it('rejects an oid that differs from the order id', async () => {
      const err = (await run(callback({ oid: 'ORDER-2' }))) as OrderMismatchError
      expect(err.field).toBe('order_id')
      expect(err.actual).toBe('ORDER-2')
      expectNothingSent()
    })

    // addition: G5 an order without id or a usable amount never matches
    it.each([
      [{ ...order, id: undefined }, 'order_id'],
      [{ ...order, amount: undefined }, 'amount'],
      [{ ...order, amount: Number.NaN }, 'amount'],
      [{ ...order, amount: '1.01' as unknown as number }, 'amount'],
      [{ ...order, amount: 1e13 }, 'amount'],
    ] as Array<[PosOrder, string]>)('order %j fails closed on %s', async (o, field) => {
      const err = (await run(callback(), o)) as OrderMismatchError
      expect(err).toBeInstanceOf(OrderMismatchError)
      expect(err.field).toBe(field)
      expectNothingSent()
    })

    // addition: G5 the mismatch is logged with expected, actual and the order id
    it('logs the mismatch', async () => {
      await run(callback({ txnamount: '999' }))
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('amount'), {
        order_id: 'ORDER-1',
        expected: '101',
        actual: '999',
      })
    })

    // addition: G7 response Error is not 3D-successful even with a successful mdStatus
    it('maps a response Error callback declined without hash check or provisioning', async () => {
      responseMapper.map3DPaymentData.mockReturnValue({ status: 'declined' })
      const cb = callback({ response: 'Error' })
      await expect(run(cb)).resolves.toStrictEqual({ status: 'declined' })
      expect(crypt.check3DHash).not.toHaveBeenCalled()
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(cb, null, TX_TYPE.PAY_AUTH, order)
      expect(httpClient.request).not.toHaveBeenCalled()
    })
  })

  // addition: 3D Pay callbacks get the same shape check before mapping
  it('make3DPayPayment rejects a non-string field before mapping', async () => {
    crypt.check3DHash.mockReturnValue(true)
    const err = await pos
      .payment(MODEL.THREE_D_PAY, { id: '123', amount: 1.01 }, TX_TYPE.PAY_AUTH, null, {
        ...threeDPayCallback(),
        procreturncode: ['00'] as unknown as string,
      })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect((err as PosError).message).toContain('procreturncode')
    expect(responseMapper.map3DPayResponseData).not.toHaveBeenCalled()
  })

  // addition: a nested value anywhere at the top level is rejected before the hash check
  it.each([MODEL.THREE_D_SECURE, MODEL.THREE_D_PAY])(
    '%s rejects a nested top-level value before the hash check',
    async (model) => {
      responseMapper.is3dAuthSuccess.mockReturnValue(true)
      crypt.check3DHash.mockReturnValue(true)
      const err = await pos
        .payment(model, boundOrder('ORDER-1'), TX_TYPE.PAY_AUTH, null, {
          mdstatus: '1',
          ...boundEcho('ORDER-1'),
          extra: { oid: 'ORDER-1' } as unknown as string,
        })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PosError)
      expect((err as PosError).message).toContain('extra')
      expect(crypt.check3DHash).not.toHaveBeenCalled()
      expect(responseMapper.map3DPayResponseData).not.toHaveBeenCalled()
      expect(httpClient.request).not.toHaveBeenCalled()
    },
  )

  // addition: 3D success is decided on the trimmed mdStatus, the value the response mapper reads
  it('passes the trimmed mdStatus to the 3D success check', async () => {
    responseMapper.extractMdStatus.mockReturnValue(' 1\t')
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    crypt.check3DHash.mockReturnValue(false)
    await expect(
      pos.payment(MODEL.THREE_D_SECURE, boundOrder('ORDER-1'), TX_TYPE.PAY_AUTH, null, boundEcho('ORDER-1')),
    ).rejects.toThrow(HashMismatchError)
    expect(responseMapper.is3dAuthSuccess).toHaveBeenCalledWith('1')
  })

  // addition: the not 3D-successful path never returns anything but a declined response
  it.each([[{ status: 'approved' }], [{ order_id: 'ORDER-1' }]])(
    'the not 3D-successful path rejects a mapped %j',
    async (mapped) => {
      responseMapper.extractMdStatus.mockReturnValue('0')
      responseMapper.is3dAuthSuccess.mockReturnValue(false)
      responseMapper.map3DPaymentData.mockReturnValue(mapped)
      await expect(
        pos.payment(MODEL.THREE_D_SECURE, boundOrder('ORDER-1'), TX_TYPE.PAY_AUTH, null, boundEcho('ORDER-1')),
      ).rejects.toThrow(PosError)
      expect(crypt.check3DHash).not.toHaveBeenCalled()
      expect(httpClient.request).not.toHaveBeenCalled()
    },
  )

  // addition: the signed clientid is the account terminal
  it('3D Secure rejects a clientid of another terminal before provisioning', async () => {
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    crypt.check3DHash.mockReturnValue(true)
    const err = (await pos
      .payment(MODEL.THREE_D_SECURE, boundOrder('ORDER-1'), TX_TYPE.PAY_AUTH, null, {
        mdstatus: '1',
        ...boundEcho('ORDER-1'),
        clientid: '99999999',
      })
      .catch((e: unknown) => e)) as OrderMismatchError
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect(err.field).toBe('terminal_id')
    expect(err.expected).toBe('30691298')
    expect(err.actual).toBe('99999999')
    expect(err.response).toBeUndefined()
    expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
    expect(httpClient.request).not.toHaveBeenCalled()
  })

  // addition: the signed clientid is the account terminal (3D Pay, response attached)
  it('3D Pay rejects a clientid of another terminal', async () => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.map3DPayResponseData.mockReturnValue({ status: 'approved', order_id: '123', proc_return_code: '00' })
    const err = (await pos
      .payment(MODEL.THREE_D_PAY, { id: '123', amount: 1.01, currency: CURRENCY.TRY }, TX_TYPE.PAY_AUTH, null, {
        ...threeDPayCallback(),
        clientid: '99999999',
      })
      .catch((e: unknown) => e)) as OrderMismatchError
    expect(err.field).toBe('terminal_id')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
  })
  // addition: review finding, a signed callback must carry the terminal as clientid
  it.each([
    ['missing', undefined],
    ['empty', ''],
  ])('3D Secure rejects a signed callback with a %s clientid before provisioning', async (_name, clientid) => {
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    crypt.check3DHash.mockReturnValue(true)
    const { clientid: _c, ...echo } = boundEcho('ORDER-1')
    const cb = clientid === undefined ? { mdstatus: '1', ...echo } : { mdstatus: '1', ...echo, clientid }
    const err = (await pos
      .payment(MODEL.THREE_D_SECURE, boundOrder('ORDER-1'), TX_TYPE.PAY_AUTH, null, cb)
      .catch((e: unknown) => e)) as OrderMismatchError
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect(err.field).toBe('terminal_id')
    expect(err.actual).toBe('')
    expect(httpClient.request).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
  ])('3D Pay rejects a signed callback with a %s clientid', async (_name, clientid) => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.map3DPayResponseData.mockReturnValue({ status: 'approved', order_id: '123', proc_return_code: '00' })
    const { clientid: _c, ...cb } = threeDPayCallback()
    const err = (await pos
      .payment(
        MODEL.THREE_D_PAY,
        { id: '123', amount: 1.01, currency: CURRENCY.TRY },
        TX_TYPE.PAY_AUTH,
        null,
        clientid === undefined ? cb : { ...cb, clientid },
      )
      .catch((e: unknown) => e)) as OrderMismatchError
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect(err.field).toBe('terminal_id')
  })

  // addition: an unsigned 3D Pay decline without clientid is still an ordinary decline
  it('3D Pay accepts an unsigned decline without clientid', async () => {
    responseMapper.map3DPayResponseData.mockReturnValue({ status: 'declined', order_id: '123', proc_return_code: '99' })
    const { clientid: _c, hash: _h, ...cb } = threeDPayCallback()
    await expect(
      pos.payment(MODEL.THREE_D_PAY, { id: '123', amount: 1.01 }, TX_TYPE.PAY_AUTH, null, cb),
    ).resolves.toStrictEqual({ status: 'declined', order_id: '123', proc_return_code: '99' })
    expect(crypt.check3DHash).not.toHaveBeenCalled()
  })

  // addition: review finding, the signed authcode pins the end of the signed oid
  it.each([
    ['304919', '00', true],
    ['P18552', '00', true],
    ['ab12CD', '00', true],
    [' 304919 ', '00', true],
    ['', '92', true],
    [' ', '92', true],
    ['', '', true],
    ['', '00', false],
    [' ', '00', false],
    ['30491', '00', false],
    ['3049190', '00', false],
    ['30491-', '00', false],
    ['2', '92', false],
    ['04919', '92', false],
  ])('3D Pay signed authcode %j with procreturncode %j accepted: %s', async (authcode, procreturncode, accepted) => {
    crypt.check3DHash.mockReturnValue(true)
    const mapped = {
      status: procreturncode === '00' ? 'approved' : 'declined',
      order_id: '123',
      proc_return_code: procreturncode,
    }
    responseMapper.map3DPayResponseData.mockReturnValue(mapped)
    const result = pos
      .payment(MODEL.THREE_D_PAY, { id: '123', amount: 1.01, currency: CURRENCY.TRY }, TX_TYPE.PAY_AUTH, null, {
        ...threeDPayCallback(),
        authcode,
        procreturncode,
        // a signed 00 always comes with Approved (see the approval consistency rule)
        response: procreturncode === '00' ? 'Approved' : '',
      })
      .catch((e: unknown) => e)
    if (accepted) {
      await expect(result).resolves.toStrictEqual(mapped)
    } else {
      const err = await result
      expect(err).toBeInstanceOf(HashMismatchError)
      expect(responseMapper.map3DPayResponseData).not.toHaveBeenCalled()
    }
  })

  // addition: review finding, attacker-controlled key names are echoed only up to 64 characters
  it('caps a long nested key name in the error and the log', async () => {
    const key = `k${'x'.repeat(200)}`
    const err = (await pos
      .payment(MODEL.THREE_D_PAY, { id: '123' }, TX_TYPE.PAY_AUTH, null, {
        ...threeDPayCallback(),
        [key]: { a: 1 } as unknown as string,
      })
      .catch((e: unknown) => e)) as PosError
    expect(err).toBeInstanceOf(PosError)
    expect(err.message).toContain(key.slice(0, 64))
    expect(err.message).not.toContain(key.slice(0, 65))
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(key.slice(0, 65))
  })

  // addition: a non-enumerable nested value is found too
  it('rejects a non-enumerable nested value', async () => {
    const cb = threeDPayCallback()
    Object.defineProperty(cb, 'zz', { value: { oid: '123' }, enumerable: false })
    await expect(pos.payment(MODEL.THREE_D_PAY, { id: '123' }, TX_TYPE.PAY_AUTH, null, cb)).rejects.toThrow(
      '3D callback field "zz" must be a string',
    )
    expect(crypt.check3DHash).not.toHaveBeenCalled()
  })
  // addition: review ruling, a signed 3D Secure callback carries no provision outcome
  it.each([
    ['authcode', '304919'],
    ['authcode', 'B'],
    ['procreturncode', '00'],
    ['procreturncode', '12'],
    ['response', 'Approved'],
    ['response', 'Declined'],
  ])('3D Secure rejects a signed callback with %s %j before provisioning', async (field, value) => {
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    crypt.check3DHash.mockReturnValue(true)
    const err = await pos
      .payment(MODEL.THREE_D_SECURE, boundOrder('ORDER-1'), TX_TYPE.PAY_AUTH, null, {
        mdstatus: '1',
        ...boundEcho('ORDER-1'),
        [field]: value,
      })
      .catch((e: unknown) => e)
    // authcode 'B' and procreturncode '00' without an authcode already fail the signed format rule
    expect(err).toBeInstanceOf(HashMismatchError)
    expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
    expect(httpClient.request).not.toHaveBeenCalled()
  })

  // addition: review ruling, a signed callback must carry the order id as oid
  it.each([
    ['missing', undefined],
    ['empty', ''],
  ])('3D Secure rejects a signed callback with a %s oid before provisioning', async (_name, oid) => {
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    crypt.check3DHash.mockReturnValue(true)
    const { oid: _o, ...echo } = boundEcho('ORDER-1')
    const cb = oid === undefined ? { mdstatus: '1', ...echo } : { mdstatus: '1', ...echo, oid }
    const err = (await pos
      .payment(MODEL.THREE_D_SECURE, boundOrder('ORDER-1'), TX_TYPE.PAY_AUTH, null, cb)
      .catch((e: unknown) => e)) as OrderMismatchError
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect(err.field).toBe('order_id')
    expect(err.actual).toBe('')
    expect(err.response).toBeUndefined()
    expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
    expect(httpClient.request).not.toHaveBeenCalled()
  })

  it('3D Pay rejects a signed callback without oid (response attached)', async () => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.map3DPayResponseData.mockReturnValue({ status: 'approved', order_id: '123', proc_return_code: '00' })
    const { oid: _o, ...cb } = threeDPayCallback()
    const err = (await pos
      .payment(MODEL.THREE_D_PAY, { id: '123', amount: 1.01, currency: CURRENCY.TRY }, TX_TYPE.PAY_AUTH, null, cb)
      .catch((e: unknown) => e)) as OrderMismatchError
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect(err.field).toBe('order_id')
    expect(err.actual).toBe('')
    expect(err.paymentMayHaveCompleted).toBe(true)
  })

  // addition: review ruling, empty or blank outcome fields are what the bank sends before provisioning
  it('3D Secure accepts empty and blank outcome fields', async () => {
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    crypt.check3DHash.mockReturnValue(true)
    requestMapper.create3DPaymentRequestData.mockReturnValue({ r: 1 })
    clientStrategy.getClient.mockReturnValue(httpClient as unknown as AbstractHttpClient)
    httpClient.request.mockResolvedValue({})
    responseMapper.map3DPaymentData.mockReturnValue({ status: 'approved' })
    await expect(
      pos.payment(MODEL.THREE_D_SECURE, boundOrder('ORDER-1'), TX_TYPE.PAY_AUTH, null, {
        mdstatus: '1',
        ...boundEcho('ORDER-1'),
        authcode: ' ',
        procreturncode: '',
        response: '',
      }),
    ).resolves.toStrictEqual({ status: 'approved' })
    expect(httpClient.request).toHaveBeenCalledTimes(1)
  })
})

// ---------- end to end: real mappers, crypt and HTTP client over a fake fetch ----------

type Sent = { url: string; body: string }

/** A fetch that records requests and answers with `answer` (or fails the test when no answer is expected). */
function recordingFetch(answer: ((body: string) => Promise<Response> | Response) | null = null) {
  const sent: Sent[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const body = String(init?.body ?? '')
    sent.push({ url: String(url), body })
    if (answer === null) {
      throw new Error('no network expected')
    }
    return answer(body)
  }) as unknown as typeof fetch

  return { sent, fetchImpl }
}

function realGateway(
  fetchImpl: typeof fetch,
  options: { cfg?: GatewayConfig; account?: GarantiPosAccount; logger?: PosLogger } = {},
) {
  const acc = options.account ?? createAccount()
  const log = options.logger ?? createLogger()
  const cryptImpl = new GarantiPosCrypt(log)
  const valueMapper = new GarantiPosRequestValueMapper()
  const valueFormatter = new GarantiPosRequestValueFormatter()
  const hooks: PosHooks = {}
  const deps: GatewayDeps<GarantiPosAccount> = {
    requestValueMapper: valueMapper,
    requestValueFormatter: valueFormatter,
    requestDataMapper: new GarantiPosRequestDataMapper(valueMapper, valueFormatter, hooks, cryptImpl),
    responseDataMapper: new GarantiPosResponseDataMapper(
      new GarantiPosResponseValueFormatter(),
      new GarantiPosResponseValueMapper(),
      log,
    ),
    crypt: cryptImpl,
    clientStrategy: new HttpClientStrategy([
      new GarantiPosHttpClient(PAYMENT_API, new HttpTransport({ fetch: fetchImpl }), log),
    ]),
    logger: log,
    hooks,
  }

  return new GarantiPos(options.cfg ?? config, acc, deps)
}

/** A signed apiversion-512 3D Secure callback (store key 12345678). */
const secureCallback: Record<string, string> = {
  xid: 'f3ec4783-f48c-475c-a59c-ab25f3170ec5',
  mdstatus: '1',
  mderrormessage: 'Y-status/Challenge authentication via ACS: https://gbemv3dsecure.garanti.com.tr/web/creq',
  txnstatus: '',
  eci: '02',
  cavv: 'xgRlQDz4AAAAAAAAAAAAAAAAAAA=',
  paressyntaxok: '',
  paresverified: '',
  version: '',
  ireqcode: '',
  ireqdetail: '',
  vendorcode: '',
  cavvalgorithm: '',
  md: 'aW5kZXg6MDJ6LjAI5iAcKf/ilXjYIOnTh4t+deHrtwO8ze7tPTL1YCDcBe8KEpuq6HDLYbqQSluL7p3kGcpFzX9s9XcegNhHMsDszxqGd33+p+p5sULGrDF3J2GGfiJDwan4ku7+eiTyS8x2xS9pUy7PTgMGc6jw94aLfXLHskhvY7FYWrymzQ==',
  terminalid: '30691298',
  oid: '2023100354BB',
  authcode: '',
  response: '',
  errmsg: '',
  hostmsg: '',
  procreturncode: '',
  transid: '2023100354BB',
  hostrefnum: '',
  rnd: 'kW094tPzNEhqORzzCsLB',
  hash: '416B6253425E73184F118CC02E3BAA393622059BF6B0865D83F501E55A61339B9EC659CBCF7297EDECC1B17BF6281D90CC0AD8EDF3E1EFE94432ACCEAF79B26E',
  hashparams: 'clientid:oid:authcode:procreturncode:response:mdstatus:cavv:eci:md:rnd:',
  hashparamsval:
    '306912982023100354BB1xgRlQDz4AAAAAAAAAAAAAAAAAAA=02aW5kZXg6MDJ6LjAI5iAcKf/ilXjYIOnTh4t+deHrtwO8ze7tPTL1YCDcBe8KEpuq6HDLYbqQSluL7p3kGcpFzX9s9XcegNhHMsDszxqGd33+p+p5sULGrDF3J2GGfiJDwan4ku7+eiTyS8x2xS9pUy7PTgMGc6jw94aLfXLHskhvY7FYWrymzQ==kW094tPzNEhqORzzCsLB',
  clientid: '30691298',
  MaskedPan: '54066975****1173',
  apiversion: '512',
  orderid: '2023100354BB',
  txninstallmentcount: '',
  terminaluserid: 'PROVAUT',
  secure3dhash:
    'B0EE6F6405ABB6EF014D802880EF3DC72CEA1EFD16E7E346A4CD6F6EE6ED2148FA8DCFD703EAEA9C154C7C200CF42D00A874832D6D3F22F9447EDF241D540286',
  secure3dsecuritylevel: '3D',
  txncurrencycode: '949',
  customeremailaddress: 'mail@customer.com',
  errorurl: 'http://localhost/garanti/3d/response.php',
  terminalmerchantid: '7000679',
  mode: 'TEST',
  terminalprovuserid: 'PROVAUT',
  txnamount: '101',
  successurl: 'http://localhost/garanti/3d/response.php',
  txntype: 'sales',
  customeripaddress: '172.26.0.1',
}

const secureOrder: PosOrder = {
  id: '2023100354BB',
  amount: 1.01,
  currency: CURRENCY.TRY,
  ip: '172.26.0.1',
  installment: 0,
}

const provisionApproved =
  '<?xml version="1.0" encoding="UTF-8"?><GVPSResponse><Mode></Mode><Order><OrderID>2023100354BB</OrderID><GroupID></GroupID></Order><Transaction><Response><Source>HOST</Source><Code>00</Code><ReasonCode>00</ReasonCode><Message>Approved</Message><ErrorMsg></ErrorMsg><SysErrMsg></SysErrMsg></Response><RetrefNum>327614071583</RetrefNum><AuthCode>304919</AuthCode><BatchNum>004951</BatchNum><SequenceNum>000026</SequenceNum><ProvDate>20231003 15:56:43</ProvDate></Transaction></GVPSResponse>'

const payOrder: PosOrder = { id: 'order222', amount: 100.25, currency: CURRENCY.TRY }

const payCallback: Record<string, string> = {
  mdstatus: '1',
  mderrormessage: 'Authenticated',
  txnstatus: 'Y',
  eci: '02',
  cavv: 'xgRlQDz4AAAAAAAAAAAAAAAAAAA=',
  md: 'MDVALUE123',
  terminalid: '30691298',
  clientid: '30691298',
  oid: 'order222',
  orderid: 'order222',
  authcode: '304919',
  response: 'Approved',
  errmsg: '',
  procreturncode: '00',
  transid: 'order222',
  hostrefnum: '230508300426',
  rnd: 'kW094tPzNEhqORzzCsLB',
  hash: 'FC9EBD151A59FF5B092106B92A4CEF4C3057BA351A9ED2D06B3BF11CEE90D663640594CAED312544B8C1BE20814ACA7FAD8203B951DB1E5944F8380E29852979',
  hashparams: 'clientid:oid:authcode:procreturncode:response:mdstatus:cavv:eci:md:rnd:',
  MaskedPan: '428220***8015',
  apiversion: '512',
  txninstallmentcount: '',
  secure3dsecuritylevel: '3D_PAY',
  txncurrencycode: '949',
  terminalmerchantid: '7000679',
  txnamount: '10025',
  txntype: 'sales',
  mode: 'TEST',
}

describe('GarantiPos (end to end) 3D Secure', () => {
  // addition: a signed 3D Secure callback is verified, bound and provisioned
  it('verifies, binds and provisions a signed callback', async () => {
    const { sent, fetchImpl } = recordingFetch(() => new Response(provisionApproved))
    const pos = realGateway(fetchImpl)

    const res = await pos.payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, secureCallback)

    expect(sent).toHaveLength(1)
    const [request] = sent as [Sent]
    expect(request.url).toBe(PAYMENT_API)
    for (const fragment of [
      '<GVPSRequest>',
      '<Mode>PROD</Mode>',
      '<Version>512</Version>',
      '<HashData>38EB11ECE83AC7D9C4B11B1D35BDADAF6266DD7C7141E37CFC5F06B957E3B40D4EB3581F6428A42678F8398C77420C948FF17F125204B68BBFD0AE74A0479C49</HashData>',
      '<IPAddress>172.26.0.1</IPAddress>',
      '<OrderID>2023100354BB</OrderID>',
      '<Amount>101</Amount>',
      '<CardholderPresentCode>13</CardholderPresentCode>',
      '<AuthenticationCode>xgRlQDz4AAAAAAAAAAAAAAAAAAA=</AuthenticationCode>',
      '<SecurityLevel>02</SecurityLevel>',
    ]) {
      expect(request.body).toContain(fragment)
    }
    expect(res.status).toBe('approved')
    expect(res.auth_code).toBe('304919')
    expect(res.md_status).toBe('1')
    expect(res.transaction_security).toBe('Full 3D Secure')
    expect(res.transaction_time).toStrictEqual(new Date('2023-10-03T15:56:43+03:00'))
  })

  // addition: G5 every echoed field is bound to the order before any HTTP call
  it.each([
    ['amount', { ...secureOrder, amount: 2 }, TX_TYPE.PAY_AUTH, {}, '200', '101'],
    ['order_id', { ...secureOrder, id: 'X' }, TX_TYPE.PAY_AUTH, {}, 'X', '2023100354BB'],
    ['currency', { ...secureOrder, currency: CURRENCY.USD }, TX_TYPE.PAY_AUTH, {}, '840', '949'],
    ['transaction_type', secureOrder, TX_TYPE.PAY_PRE_AUTH, {}, 'preauth', 'sales'],
    ['terminal_id', secureOrder, TX_TYPE.PAY_AUTH, { terminalid: '11111111' }, '30691298', '11111111'],
    ['merchant_id', secureOrder, TX_TYPE.PAY_AUTH, { terminalmerchantid: '1' }, '7000679', '1'],
  ] as Array<[string, PosOrder, TxType, Record<string, string>, string, string]>)(
    'OrderMismatchError %s, nothing sent',
    async (field, order, txType, change, expected, actual) => {
      const { sent, fetchImpl } = recordingFetch()
      const pos = realGateway(fetchImpl)

      const err = (await pos
        .payment(MODEL.THREE_D_SECURE, order, txType, null, { ...secureCallback, ...change })
        .catch((e: unknown) => e)) as OrderMismatchError

      expect(err).toBeInstanceOf(OrderMismatchError)
      expect(err.field).toBe(field)
      expect(err.expected).toBe(expected)
      expect(err.actual).toBe(actual)
      expect(err.paymentMayHaveCompleted).toBe(false)
      expect(err.response).toBeUndefined()
      expect(sent).toHaveLength(0)
    },
  )

  // addition: G5 a 3D Pay callback (security level 3D_PAY) is not completed as 3D Secure
  it('OrderMismatchError payment_model for a 3D_PAY security level', async () => {
    const { sent, fetchImpl } = recordingFetch()
    const err = (await realGateway(fetchImpl)
      .payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, {
        ...secureCallback,
        secure3dsecuritylevel: '3D_PAY',
      })
      .catch((e: unknown) => e)) as OrderMismatchError
    expect(err.field).toBe('payment_model')
    expect(sent).toHaveLength(0)
  })

  // addition: carried from the request mapper review, an oid-only callback fails closed
  it('an oid-only callback (orderid removed, hash still valid) fails closed', async () => {
    const { sent, fetchImpl } = recordingFetch()
    const { orderid: _omitted, ...cb } = secureCallback
    const err = (await realGateway(fetchImpl)
      .payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, cb)
      .catch((e: unknown) => e)) as OrderMismatchError
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect(err.field).toBe('order_id')
    expect(sent).toHaveLength(0)
  })

  // addition: carried from the request mapper review, fields outside hashparams keep the hash valid when forged as
  // arrays or objects, but must not reach the provision request
  it.each([
    ['orderid', ['2023100354BB']],
    ['customeripaddress', { a: '172.26.0.1' }],
    ['txnamount', ['101']],
    ['xid', { a: 'x' }],
  ])('a non-string %s is rejected with PosError, nothing sent', async (field, value) => {
    const { sent, fetchImpl } = recordingFetch()
    const err = await realGateway(fetchImpl)
      .payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, {
        ...secureCallback,
        [field]: value as unknown as string,
      })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect(err).not.toBeInstanceOf(HashMismatchError)
    expect((err as PosError).message).toContain(field)
    expect(sent).toHaveLength(0)
  })

  // addition: G2/G3 a tampered outcome field breaks the signature
  it('a tampered mdstatus raises HashMismatchError, nothing sent', async () => {
    const { sent, fetchImpl } = recordingFetch()
    await expect(
      realGateway(fetchImpl).payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, {
        ...secureCallback,
        mdstatus: '2',
      }),
    ).rejects.toThrow(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: G3 a 3D-successful callback must be signed
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['non-string', ['416B6253']],
  ])('a 3D-successful callback with a %s hash raises HashMismatchError', async (_name, hash) => {
    const { sent, fetchImpl } = recordingFetch()
    const { hash: _h, ...rest } = secureCallback
    const cb: GatewayResponseData = hash === undefined ? rest : { ...rest, hash: hash as string }
    await expect(
      realGateway(fetchImpl).payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, cb),
    ).rejects.toThrow(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: G2 the hash comparison ignores hex case
  it('accepts a lower-cased hash', async () => {
    const { sent, fetchImpl } = recordingFetch(() => new Response(provisionApproved))
    const res = await realGateway(fetchImpl).payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, {
      ...secureCallback,
      hash: (secureCallback.hash as string).toLowerCase(),
    })
    expect(res.status).toBe('approved')
    expect(sent).toHaveLength(1)
  })

  // addition: G7 response Error is declined without hash check or HTTP
  it('response Error is mapped declined without hash check or HTTP', async () => {
    const { sent, fetchImpl } = recordingFetch()
    const res = await realGateway(fetchImpl).payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, {
      ...secureCallback,
      response: 'Error',
    })
    expect(res.status).toBe('declined')
    expect(sent).toHaveLength(0)
  })

  // addition: G3 disable_3d_hash_check has no effect
  it('disable_3d_hash_check in the config does not disable the check', async () => {
    const { sent, fetchImpl } = recordingFetch()
    const pos = realGateway(fetchImpl, { cfg: configWithHashCheckDisabled })
    await expect(
      pos.payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, { ...secureCallback, mdstatus: '2' }),
    ).rejects.toThrow(HashMismatchError)
    await expect(
      pos.payment(MODEL.THREE_D_PAY, payOrder, TX_TYPE.PAY_AUTH, null, { ...payCallback, mdstatus: '0' }),
    ).rejects.toThrow(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: nothing secret reaches the logger
  it('never logs the passwords, the store key or an unmasked card number', async () => {
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
    const { fetchImpl } = recordingFetch(() => new Response(provisionApproved))
    const pos = realGateway(fetchImpl, { logger })

    await pos.payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, secureCallback)
    await pos
      .payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, { ...secureCallback, mdstatus: '2' })
      .catch(() => undefined)
    await pos
      .payment(MODEL.THREE_D_SECURE, { ...secureOrder, amount: 2 }, TX_TYPE.PAY_AUTH, null, secureCallback)
      .catch(() => undefined)

    const logged = JSON.stringify(records)
    expect(records.length).toBeGreaterThan(0)
    expect(logged).not.toContain('123qweASD/')
    expect(logged).not.toContain('12345678')
    expect(logged).not.toMatch(/\d{16}/)
  })
})

describe('GarantiPos (end to end) 3D Pay', () => {
  const run = (cb: GatewayResponseData, order: PosOrder = payOrder, cfg: GatewayConfig = config) => {
    const { sent, fetchImpl } = recordingFetch()
    const pos = realGateway(fetchImpl, { cfg })
    return {
      sent,
      result: pos.payment(MODEL.THREE_D_PAY, order, TX_TYPE.PAY_AUTH, null, cb).catch((e: unknown) => e),
    }
  }

  // addition: a signed approved 3D Pay callback is mapped without HTTP
  it('approves a signed callback without HTTP', async () => {
    const { sent, result } = run(payCallback)
    const res = (await result) as Data
    expect(res.status).toBe('approved')
    expect(res.amount).toBe(100.25)
    expect(res.requires_manual_review).toBe(false)
    expect(sent).toHaveLength(0)
  })

  // addition: G6 bank approved but 3D failed
  it('approved by the bank but 3D failed is declined and flagged for manual review', async () => {
    const logger = createLogger()
    const pos = realGateway(recordingFetch().fetchImpl, { logger })
    const res = await pos.payment(MODEL.THREE_D_PAY, payOrder, TX_TYPE.PAY_AUTH, null, {
      ...payCallback,
      mdstatus: '0',
      hash: 'CD9397BB77CA4D9C672FF18082BB0B41A8999F39E5336D008D27218ED9F981448D66AA91A5FC79E703669256BEF9F0F8BB536FFBF8D6649C1F78BD18513D38D1',
    })
    expect(res.status).toBe('declined')
    expect(res.requires_manual_review).toBe(true)
    expect(logger.warn).toHaveBeenCalled()
  })

  // addition: G5 a declined callback echoing txnamount 0 is not bound on amount
  it('a signed declined callback (txnamount 0) maps without a mismatch', async () => {
    const { result } = run({
      ...payCallback,
      authcode: '',
      procreturncode: '92',
      response: 'Declined',
      txnamount: '0',
      hash: '0EE1ADB31B9B03AE933917495356E35A4310609FE0F64727534A14FDCD98BE6596358F994B6AAE6DA81D359EE6CF494943C3A1DF85648CE549212FDB31AB67E8',
    })
    const res = (await result) as Data
    expect(res).not.toBeInstanceOf(Error)
    expect(res.status).toBe('declined')
    expect(res.requires_manual_review).toBe(false)
  })

  // addition: G5 an approved callback must belong to the order
  it.each([
    ['order_id', payCallback, { ...payOrder, id: 'other' }, 'other', 'order222'],
    ['amount', payCallback, { ...payOrder, amount: 100.26 }, '10026', '10025'],
    ['payment_model', { ...payCallback, secure3dsecuritylevel: '3D' }, payOrder, '3D_PAY', '3D'],
  ] as Array<[string, Record<string, string>, PosOrder, string, string]>)(
    'OrderMismatchError %s with the response attached',
    async (field, cb, order, expected, actual) => {
      const err = (await run(cb, order).result) as OrderMismatchError
      expect(err).toBeInstanceOf(OrderMismatchError)
      expect(err.field).toBe(field)
      expect(err.expected).toBe(expected)
      expect(err.actual).toBe(actual)
      expect(err.paymentMayHaveCompleted).toBe(true)
      expect(err.response?.requires_manual_review).toBe(true)
    },
  )

  // addition: G3 unsigned declined callbacks are ordinary declines
  it('an unsigned declined callback is mapped declined', async () => {
    const authFail = (threeDPayPaymentDataProvider.find(([name]) => name === 'authFail') as [string, Data])[1]
      .paymentData as GatewayResponseData
    const res = (await run(authFail, { id: '2022110159A0', amount: 1, currency: CURRENCY.TRY }).result) as Data
    expect(res.status).toBe('declined')
    expect(res.proc_return_code).toBe('99')
  })

  // addition: G3 an unsigned callback reporting a completed payment fails closed
  it('an unsigned approved callback raises HashMismatchError', async () => {
    const { hash: _h, hashparams: _p, ...unsigned } = payCallback
    const err = await run(unsigned).result
    expect(err).toBeInstanceOf(HashMismatchError)
    expect((err as Error).message).toBe('Unsigned 3D callback reports a completed payment')
  })

  // addition: G3 an unsigned callback with procreturncode 00 fails closed even when the 3D status failed
  it('an unsigned callback with procreturncode 00 raises HashMismatchError', async () => {
    const { hash: _h, hashparams: _p, ...unsigned } = payCallback
    await expect(run({ ...unsigned, mdstatus: '0' }).result).resolves.toBeInstanceOf(HashMismatchError)
  })

  // addition: G3 require_3d_hash rejects unsigned callbacks
  it('require_3d_hash rejects an unsigned declined callback', async () => {
    const authFail = (threeDPayPaymentDataProvider.find(([name]) => name === 'authFail') as [string, Data])[1]
      .paymentData as GatewayResponseData
    const err = await run(
      authFail,
      { id: '2022110159A0', amount: 1, currency: CURRENCY.TRY },
      {
        ...config,
        require_3d_hash: true,
      },
    ).result
    expect(err).toBeInstanceOf(HashMismatchError)
  })

  // addition: G3 a present hash must verify
  it('a signed callback with a wrong hash raises HashMismatchError', async () => {
    await expect(run({ ...payCallback, mdstatus: '0' }).result).resolves.toBeInstanceOf(HashMismatchError)
  })
})

describe('GarantiPos (end to end) forged callbacks', () => {
  const resign = (cb: Record<string, string>): Record<string, string> => {
    const values = ['clientid', 'oid', 'authcode', 'procreturncode', 'response', 'mdstatus', 'cavv', 'eci', 'md', 'rnd']
      .map((k) => cb[k] ?? '')
      .join('')
    return { ...cb, hash: new GarantiPosCrypt().hashString(`${values}12345678`) }
  }

  // addition: review finding, a nested duplicate oid must not let a signed callback complete another order
  it('3D Pay: a nested shadow oid is rejected (PosError), nothing mapped or sent', async () => {
    const { sent, fetchImpl } = recordingFetch()
    const forged = {
      x: { oid: 'order222' },
      ...payCallback,
      oid: 'BIG-ORDER',
      orderid: 'BIG-ORDER',
      transid: 'BIG-ORDER',
      txnamount: '500000',
    } as unknown as GatewayResponseData
    const err = await realGateway(fetchImpl)
      .payment(
        MODEL.THREE_D_PAY,
        { id: 'BIG-ORDER', amount: 5000, currency: CURRENCY.TRY },
        TX_TYPE.PAY_AUTH,
        null,
        forged,
      )
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect((err as PosError).message).toContain('"x"')
    expect(sent).toHaveLength(0)
  })

  it('3D Secure: a nested shadow oid is rejected (PosError) before the provision request', async () => {
    const { sent, fetchImpl } = recordingFetch()
    const forged = {
      x: { oid: '2023100354BB' },
      ...secureCallback,
      oid: 'OTHER',
      orderid: 'OTHER',
      customeripaddress: '1.2.3.4',
      txnamount: '999999',
    } as unknown as GatewayResponseData
    const err = await realGateway(fetchImpl)
      .payment(
        MODEL.THREE_D_SECURE,
        { id: 'OTHER', amount: 9999.99, currency: CURRENCY.TRY, ip: '1.2.3.4' },
        TX_TYPE.PAY_AUTH,
        null,
        forged,
      )
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect(err).not.toBeInstanceOf(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: review finding, whitespace around mdStatus must not skip the hash check
  it.each([' 1', '1 ', '\t1', '1\n'])(
    '3D Secure: an unsigned mdstatus %j is hash-checked (HashMismatchError), never approved',
    async (mdstatus) => {
      const { sent, fetchImpl } = recordingFetch()
      const { hash: _h, ...unsigned } = secureCallback
      await expect(
        realGateway(fetchImpl).payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, {
          ...unsigned,
          mdstatus,
          response: 'Approved',
          procreturncode: '00',
        }),
      ).rejects.toThrow(HashMismatchError)
      expect(sent).toHaveLength(0)
    },
  )

  it('3D Secure: a minimal unsigned callback with mdstatus " 1" is never approved', async () => {
    const { sent, fetchImpl } = recordingFetch()
    const cb = {
      mdstatus: ' 1',
      response: 'Approved',
      oid: 'X1',
      orderid: 'X1',
      txnamount: '100',
      txncurrencycode: '949',
      txntype: 'sales',
      procreturncode: '00',
    }
    await expect(
      realGateway(fetchImpl).payment(
        MODEL.THREE_D_SECURE,
        { id: 'X1', amount: 1, currency: CURRENCY.TRY, ip: '1.1.1.1' },
        TX_TYPE.PAY_AUTH,
        null,
        cb,
      ),
    ).rejects.toThrow(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  it.each([' 1', '1 ', '\t1'])(
    '3D Secure: a signed mdstatus %j goes through the hash check and is rejected as malformed',
    async (mdstatus) => {
      const { sent, fetchImpl } = recordingFetch()
      const cb = resign({ ...secureCallback, mdstatus })
      expect(new GarantiPosCrypt().check3DHash(createAccount(), cb)).toBe(true)
      const err = await realGateway(fetchImpl)
        .payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, cb)
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(HashMismatchError)
      expect((err as Error).message).toBe('3D callback outcome fields are malformed')
      expect(sent).toHaveLength(0)
    },
  )

  // addition: review finding, whitespace procreturncode on the not 3D-successful path stays declined
  it.each([
    ['0', ' 00'],
    ['0', '00 '],
    ['', '00'],
    [' ', '00'],
    ['5', '\t00'],
  ])('3D Secure: unsigned mdstatus %j with procreturncode %j is declined without HTTP', async (mdstatus, prc) => {
    const { sent, fetchImpl } = recordingFetch()
    const { hash: _h, ...unsigned } = secureCallback
    const res = await realGateway(fetchImpl).payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, {
      ...unsigned,
      mdstatus,
      procreturncode: prc,
      response: 'Approved',
    })
    expect(res.status).toBe('declined')
    expect(sent).toHaveLength(0)
  })

  // addition: review finding, an untrimmed response Error is declined without HTTP
  it.each([' Error', 'Error\n'])('3D Secure: response %j is declined without HTTP', async (response) => {
    const { sent, fetchImpl } = recordingFetch()
    const res = await realGateway(fetchImpl).payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, {
      ...secureCallback,
      response,
    })
    expect(res.status).toBe('declined')
    expect(sent).toHaveLength(0)
  })

  // addition: review finding, regrouped hashparams (G6 vector upgraded to approved) are rejected
  it('3D Pay: a regrouping hashparams list raises HashMismatchError', async () => {
    const signed: Record<string, string> = {
      ...payCallback,
      mdstatus: '0',
      hash: 'CD9397BB77CA4D9C672FF18082BB0B41A8999F39E5336D008D27218ED9F981448D66AA91A5FC79E703669256BEF9F0F8BB536FFBF8D6649C1F78BD18513D38D1',
    }
    const forged = {
      ...signed,
      f1: `0${signed.cavv}02MDVALUE`,
      mdstatus: '1',
      f2: `23${signed.rnd}`,
      hashparams: 'clientid:oid:authcode:procreturncode:response:f1:mdstatus:f2:',
    }
    const { sent, fetchImpl } = recordingFetch()
    await expect(
      realGateway(fetchImpl).payment(MODEL.THREE_D_PAY, payOrder, TX_TYPE.PAY_AUTH, null, forged),
    ).rejects.toThrow(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  it('3D Pay: a regrouped signed decline raises HashMismatchError', async () => {
    const signed = {
      ...payCallback,
      authcode: '',
      procreturncode: '92',
      response: 'Declined',
      txnamount: '0',
      hash: '0EE1ADB31B9B03AE933917495356E35A4310609FE0F64727534A14FDCD98BE6596358F994B6AAE6DA81D359EE6CF494943C3A1DF85648CE549212FDB31AB67E8',
    }
    const forged = {
      ...signed,
      procreturncode: '',
      response: '',
      f1: '92Declined',
      hashparams: 'clientid:oid:authcode:procreturncode:response:f1:mdstatus:cavv:eci:md:rnd:',
    }
    await expect(
      realGateway(recordingFetch().fetchImpl).payment(MODEL.THREE_D_PAY, payOrder, TX_TYPE.PAY_AUTH, null, forged),
    ).rejects.toThrow(HashMismatchError)
  })

  it('3D Secure: the signed string under a list without the trailing separator raises HashMismatchError', async () => {
    const { sent, fetchImpl } = recordingFetch()
    await expect(
      realGateway(fetchImpl).payment(MODEL.THREE_D_SECURE, secureOrder, TX_TYPE.PAY_AUTH, null, {
        ...secureCallback,
        hashparams: 'clientid:oid:authcode:procreturncode:response:mdstatus:cavv:eci:md:rnd',
      }),
    ).rejects.toThrow(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: review finding, characters shifted across field boundaries keep the hash but break the formats
  it.each([
    ['authcode/procreturncode', { authcode: '3049190', procreturncode: '0' }],
    ['response/mdstatus', { response: 'Approved1', mdstatus: '' }],
    ['mdstatus/cavv', { mdstatus: '1x', cavv: 'gRlQDz4AAAAAAAAAAAAAAAAAAA=' }],
    ['procreturncode/response', { procreturncode: '00A', response: 'pproved' }],
  ] as Array<[string, Record<string, string>]>)(
    '3D Pay: a %s boundary shift (hash still valid) raises HashMismatchError',
    async (_name, shift) => {
      const cb = { ...payCallback, ...shift }
      expect(new GarantiPosCrypt().check3DHash(createAccount(), cb)).toBe(true)
      const err = await realGateway(recordingFetch().fetchImpl)
        .payment(MODEL.THREE_D_PAY, payOrder, TX_TYPE.PAY_AUTH, null, cb)
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(HashMismatchError)
      expect((err as Error).message).toBe('3D callback outcome fields are malformed')
    },
  )
  // addition: review finding, the signed oid cannot borrow from or lend to the signed authcode, and clientid
  // cannot be dropped to lengthen it (original hash FC9EBD15... still verifies for every vector)
  it.each([
    [
      'SHIFT-A oid -> authcode',
      { oid: 'order22', orderid: 'order22', transid: 'order22', authcode: '2304919', txnamount: '999900' },
      { id: 'order22', amount: 9999, currency: CURRENCY.TRY },
      HashMismatchError,
    ],
    [
      'SHIFT-B authcode -> oid',
      { oid: 'order2223', orderid: 'order2223', transid: 'order2223', authcode: '04919', txnamount: '999900' },
      { id: 'order2223', amount: 9999, currency: CURRENCY.TRY },
      HashMismatchError,
    ],
    [
      'SHIFT-C clientid dropped, terminal id moved into oid',
      { clientid: undefined, oid: '30691298order222', orderid: '30691298order222' },
      { id: '30691298order222', amount: 100.25, currency: CURRENCY.TRY },
      OrderMismatchError,
    ],
  ] as Array<[string, Record<string, string | undefined>, PosOrder, typeof PosError]>)(
    '3D Pay: %s fails closed, never approved',
    async (_name, shift, order, errorClass) => {
      const cb: Record<string, string> = { ...payCallback }
      for (const [k, v] of Object.entries(shift)) {
        if (v === undefined) delete cb[k]
        else cb[k] = v
      }
      expect(new GarantiPosCrypt().check3DHash(createAccount(), cb)).toBe(true)
      const { sent, fetchImpl } = recordingFetch()
      const err = await realGateway(fetchImpl)
        .payment(MODEL.THREE_D_PAY, order, TX_TYPE.PAY_AUTH, null, cb)
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(errorClass)
      if (err instanceof OrderMismatchError) {
        expect(err.field).toBe('terminal_id')
      }
      expect(sent).toHaveLength(0)
    },
  )

  // addition: review finding, the same boundary shifts on a signed 3D Secure callback never reach the bank
  it.each([
    [
      'oid -> authcode',
      { oid: '2023100354B', orderid: '2023100354B', authcode: 'B' },
      { ...secureOrder, id: '2023100354B' },
      HashMismatchError,
    ],
    [
      'clientid dropped, terminal id moved into oid',
      { clientid: undefined, oid: '306912982023100354BB', orderid: '306912982023100354BB' },
      { ...secureOrder, id: '306912982023100354BB' },
      OrderMismatchError,
    ],
  ] as Array<[string, Record<string, string | undefined>, PosOrder, typeof PosError]>)(
    '3D Secure: %s fails closed, nothing sent',
    async (_name, shift, order, errorClass) => {
      const cb: Record<string, string> = { ...secureCallback }
      for (const [k, v] of Object.entries(shift)) {
        if (v === undefined) delete cb[k]
        else cb[k] = v
      }
      expect(new GarantiPosCrypt().check3DHash(createAccount(), cb)).toBe(true)
      const { sent, fetchImpl } = recordingFetch()
      const err = await realGateway(fetchImpl)
        .payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, cb)
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(errorClass)
      expect(sent).toHaveLength(0)
    },
  )
  // addition: review ruling, the tail of the signed oid cannot move into the empty 3D Secure authcode
  it('3D Secure: oid "202310" + authcode "0354BB" (hash still valid) raises HashMismatchError, nothing sent', async () => {
    const cb = { ...secureCallback, oid: '202310', orderid: '202310', authcode: '0354BB' }
    expect(new GarantiPosCrypt().check3DHash(createAccount(), cb)).toBe(true)
    const { sent, fetchImpl } = recordingFetch()
    const err = await realGateway(fetchImpl)
      .payment(MODEL.THREE_D_SECURE, { ...secureOrder, id: '202310', amount: 9999 }, TX_TYPE.PAY_AUTH, null, cb)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HashMismatchError)
    expect((err as Error).message).toBe('3D Secure callback carries a provision outcome')
    expect(sent).toHaveLength(0)
  })

  /** A signed 3D Secure callback for order ORDER12 (hash computed with PHP built-ins and the store key). */
  const order12Callback: Record<string, string> = {
    ...secureCallback,
    oid: 'ORDER12',
    orderid: 'ORDER12',
    transid: 'ORDER12',
    hash: 'A72F77E7E4EE97C544889DEA6CEFD975D27ED247E520F83E7193DC856033B805BC86BE6D57B52F1429CF7BF035C4CFAF7E437AA958A88265D56483DF4A79733C',
  }

  // addition: review ruling, two trailing digits of the signed oid cannot move into procreturncode
  it('3D Secure: oid "ORDER" + procreturncode "12" (hash still valid) raises HashMismatchError, nothing sent', async () => {
    const cb = { ...order12Callback, oid: 'ORDER', orderid: 'ORDER', transid: 'ORDER', procreturncode: '12' }
    expect(new GarantiPosCrypt().check3DHash(createAccount(), cb)).toBe(true)
    const { sent, fetchImpl } = recordingFetch()
    const err = await realGateway(fetchImpl)
      .payment(MODEL.THREE_D_SECURE, { ...secureOrder, id: 'ORDER' }, TX_TYPE.PAY_AUTH, null, cb)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: review ruling, the legitimate 3D Secure vectors still provision
  it.each([
    ['fixture 2023100354BB', secureCallback, secureOrder],
    ['ORDER12', order12Callback, { ...secureOrder, id: 'ORDER12' }],
  ] as Array<[string, Record<string, string>, PosOrder]>)(
    '3D Secure: the signed %s callback is provisioned',
    async (_name, cb, order) => {
      expect(new GarantiPosCrypt().check3DHash(createAccount(), cb)).toBe(true)
      const { sent, fetchImpl } = recordingFetch(() => new Response(provisionApproved))
      const res = await realGateway(fetchImpl).payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, cb)
      expect(res.status).toBe('approved')
      expect(sent).toHaveLength(1)
      expect(sent[0]?.body).toContain(`<OrderID>${order.id}</OrderID>`)
    },
  )
})

describe('GarantiPos (end to end) signed order id, cavv and eci formats', () => {
  const resign = (cb: Record<string, string>): Record<string, string> => {
    const values = ['clientid', 'oid', 'authcode', 'procreturncode', 'response', 'mdstatus', 'cavv', 'eci', 'md', 'rnd']
      .map((k) => cb[k] ?? '')
      .join('')
    return { ...cb, hash: new GarantiPosCrypt().hashString(`${values}12345678`) }
  }
  /** A signed 3D Secure callback for order ORDER12 (hash computed with PHP built-ins and the store key). */
  const order12Callback: Record<string, string> = {
    ...secureCallback,
    oid: 'ORDER12',
    orderid: 'ORDER12',
    transid: 'ORDER12',
    hash: 'A72F77E7E4EE97C544889DEA6CEFD975D27ED247E520F83E7193DC856033B805BC86BE6D57B52F1429CF7BF035C4CFAF7E437AA958A88265D56483DF4A79733C',
  }

  // addition: review finding, dropping oid and moving its signed characters into mdstatus/cavv keeps the hash
  // valid; the unsigned orderid could then name any order and amount
  it('3D Secure: oid dropped, its characters moved into mdstatus and cavv raises OrderMismatchError, nothing sent', async () => {
    const { oid: _o, ...rest } = secureCallback
    const forged = {
      ...rest,
      mdstatus: '2',
      cavv: `023100354BB1${secureCallback.cavv}`,
      orderid: 'VICTIM9',
      transid: 'VICTIM9',
      txnamount: '999900',
    }
    expect(new GarantiPosCrypt().check3DHash(createAccount(), forged)).toBe(true)
    const { sent, fetchImpl } = recordingFetch(() => new Response(provisionApproved))
    const err = (await realGateway(fetchImpl)
      .payment(
        MODEL.THREE_D_SECURE,
        { id: 'VICTIM9', amount: 9999, currency: CURRENCY.TRY, ip: '1.2.3.4' },
        TX_TYPE.PAY_AUTH,
        null,
        forged,
      )
      .catch((e: unknown) => e)) as OrderMismatchError
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect(err.field).toBe('order_id')
    expect(err.expected).toBe('VICTIM9')
    expect(err.actual).toBe('')
    expect(err.response).toBeUndefined()
    expect(sent).toHaveLength(0)
  })

  // addition: review finding, the last oid character moved into mdstatus pushes the old mdstatus into cavv
  it('3D Secure: oid "ORDER1" + mdstatus "2" + cavv "1…" (hash still valid) raises HashMismatchError, nothing sent', async () => {
    const cb = {
      ...order12Callback,
      oid: 'ORDER1',
      orderid: 'ORDER1',
      transid: 'ORDER1',
      mdstatus: '2',
      cavv: `1${order12Callback.cavv}`,
    }
    expect(new GarantiPosCrypt().check3DHash(createAccount(), cb)).toBe(true)
    const { sent, fetchImpl } = recordingFetch(() => new Response(provisionApproved))
    const err = await realGateway(fetchImpl)
      .payment(MODEL.THREE_D_SECURE, { ...secureOrder, id: 'ORDER1' }, TX_TYPE.PAY_AUTH, null, cb)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HashMismatchError)
    expect((err as Error).message).toBe('3D callback outcome fields are malformed')
    expect(sent).toHaveLength(0)
  })

  // addition: review ruling, cavv is empty or 28 base64 characters ending in "=", eci empty or two digits
  it.each([
    ['cavv of 27 characters', { cavv: 'xgRlQDz4AAAAAAAAAAAAAAAAAA=' }],
    ['cavv of 29 characters', { cavv: 'xgRlQDz4AAAAAAAAAAAAAAAAAAAA=' }],
    ['cavv without the trailing "="', { cavv: 'xgRlQDz4AAAAAAAAAAAAAAAAAAAA' }],
    ['eci "2"', { eci: '2' }],
    ['eci "002"', { eci: '002' }],
  ] as Array<[string, Record<string, string>]>)('signed %s raises HashMismatchError', async (_name, change) => {
    const secure = resign({ ...secureCallback, ...change })
    const pay = resign({ ...payCallback, ...change })
    for (const [model, cb, order] of [
      [MODEL.THREE_D_SECURE, secure, secureOrder],
      [MODEL.THREE_D_PAY, pay, payOrder],
    ] as Array<[PaymentModel, Record<string, string>, PosOrder]>) {
      expect(new GarantiPosCrypt().check3DHash(createAccount(), cb)).toBe(true)
      const { sent, fetchImpl } = recordingFetch(() => new Response(provisionApproved))
      const err = await realGateway(fetchImpl)
        .payment(model, order, TX_TYPE.PAY_AUTH, null, cb)
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(HashMismatchError)
      expect((err as Error).message).toBe('3D callback outcome fields are malformed')
      expect(sent).toHaveLength(0)
    }
  })

  // addition: review ruling, the legitimate formats still pass (empty and blank cavv/eci, 28-character cavv)
  it.each([
    ['empty cavv and eci', { cavv: '', eci: '' }],
    ['blank cavv and eci', { cavv: ' ', eci: ' ' }],
    ['another 28-character cavv', { cavv: 'jCm0m+u/0hUfAREHBAMBcfN+pSo=' }],
  ] as Array<[string, Record<string, string>]>)('signed %s is accepted', async (_name, change) => {
    const { sent, fetchImpl } = recordingFetch(() => new Response(provisionApproved))
    const secure = await realGateway(fetchImpl).payment(
      MODEL.THREE_D_SECURE,
      secureOrder,
      TX_TYPE.PAY_AUTH,
      null,
      resign({ ...secureCallback, ...change }),
    )
    expect(secure.status).toBe('approved')
    expect(sent).toHaveLength(1)
    const pay = await realGateway(recordingFetch().fetchImpl).payment(
      MODEL.THREE_D_PAY,
      payOrder,
      TX_TYPE.PAY_AUTH,
      null,
      resign({ ...payCallback, ...change }),
    )
    expect(pay.status).toBe('approved')
  })

  // addition: review finding, characters moved from oid into an empty eci keep the hash valid (md and rnd intact);
  // a signed eci always comes with a cavv
  it('3D Secure: oid "ORDER34" re-split as "ORDER" + mdstatus "3" + eci "42" (hash still valid) raises HashMismatchError, nothing sent', async () => {
    const legit = resign({
      ...secureCallback,
      oid: 'ORDER34',
      orderid: 'ORDER34',
      transid: 'ORDER34',
      mdstatus: '2',
      cavv: '',
      eci: '',
    })
    const forged: Record<string, string> = {
      ...legit,
      oid: 'ORDER',
      orderid: 'ORDER',
      transid: 'ORDER',
      mdstatus: '3',
      eci: '42',
      txnamount: '999900',
    }
    expect(forged.md).toBe(secureCallback.md)
    expect(new GarantiPosCrypt().check3DHash(createAccount(), forged)).toBe(true)
    const { sent, fetchImpl } = recordingFetch(() => new Response(provisionApproved))
    const err = await realGateway(fetchImpl)
      .payment(
        MODEL.THREE_D_SECURE,
        { id: 'ORDER', amount: 9999, currency: CURRENCY.TRY, ip: '1.2.3.4' },
        TX_TYPE.PAY_AUTH,
        null,
        forged,
      )
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HashMismatchError)
    expect((err as Error).message).toBe('3D callback outcome fields are malformed')
    expect(sent).toHaveLength(0)
  })

  /**
   * A signed 3D Secure callback for order ORDER10 with mdstatus 2 and empty cavv/eci (hash computed with PHP
   * built-ins: `strtoupper(hash("sha512", "30691298" . "ORDER10" . "" . "" . "" . "2" . "" . "" . md . rnd .
   * "12345678"))`).
   */
  const order10Callback: Record<string, string> = {
    ...secureCallback,
    oid: 'ORDER10',
    orderid: 'ORDER10',
    transid: 'ORDER10',
    mdstatus: '2',
    cavv: '',
    eci: '',
    hash: '5A37D13F49E244DA0E72DB4AAAAE4E87589A82C04E9129B76F851648FE00401ED6839D9B788915E38B4696A66BECD1ED3C5A1628C6509E0E7E8FBF1FB36418A1',
  }

  // addition: review ruling, the same re-split on a PHP-built vector: ORDER10/2 read as ORDER/1/eci 02
  it('3D Secure: oid "ORDER10" re-split as "ORDER" + mdstatus "1" + eci "02" (hash still valid) raises HashMismatchError, nothing sent', async () => {
    expect(new GarantiPosCrypt().check3DHash(createAccount(), order10Callback)).toBe(true)
    const forged = { ...order10Callback, oid: 'ORDER', orderid: 'ORDER', transid: 'ORDER', mdstatus: '1', eci: '02' }
    expect(new GarantiPosCrypt().check3DHash(createAccount(), forged)).toBe(true)
    const { sent, fetchImpl } = recordingFetch(() => new Response(provisionApproved))
    const err = await realGateway(fetchImpl)
      .payment(MODEL.THREE_D_SECURE, { ...secureOrder, id: 'ORDER' }, TX_TYPE.PAY_AUTH, null, forged)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: review ruling, the unshifted ORDER10 callback (empty cavv and eci) still provisions
  it('3D Secure: the signed ORDER10 callback with empty cavv and eci is provisioned', async () => {
    const { sent, fetchImpl } = recordingFetch(() => new Response(provisionApproved))
    const res = await realGateway(fetchImpl).payment(
      MODEL.THREE_D_SECURE,
      { ...secureOrder, id: 'ORDER10' },
      TX_TYPE.PAY_AUTH,
      null,
      order10Callback,
    )
    expect(res.status).toBe('approved')
    expect(sent).toHaveLength(1)
  })

  // addition: review ruling, a signed eci requires a cavv (both flows); a cavv without an eci is still accepted
  it.each([
    ['eci "02" with an empty cavv', false, { cavv: '', eci: '02' }],
    ['eci "02" with a blank cavv', false, { cavv: ' ', eci: '02' }],
    ['a cavv with an empty eci', true, { eci: '' }],
  ] as Array<[string, boolean, Record<string, string>]>)('signed %s accepted: %s', async (_name, accepted, change) => {
    const secure = resign({ ...secureCallback, ...change })
    const pay = resign({ ...payCallback, ...change })
    for (const [model, cb, order] of [
      [MODEL.THREE_D_SECURE, secure, secureOrder],
      [MODEL.THREE_D_PAY, pay, payOrder],
    ] as Array<[PaymentModel, Record<string, string>, PosOrder]>) {
      expect(new GarantiPosCrypt().check3DHash(createAccount(), cb)).toBe(true)
      const { sent, fetchImpl } = recordingFetch(() => new Response(provisionApproved))
      const result = await realGateway(fetchImpl)
        .payment(model, order, TX_TYPE.PAY_AUTH, null, cb)
        .catch((e: unknown) => e)
      if (accepted) {
        expect((result as Data).status).toBe('approved')
      } else {
        expect(result).toBeInstanceOf(HashMismatchError)
        expect((result as Error).message).toBe('3D callback outcome fields are malformed')
        expect(sent).toHaveLength(0)
      }
    }
  })

  // addition: review ruling, on a signed 3D Pay callback procreturncode 00 comes exactly with response Approved
  it.each([
    ['00', ''],
    ['00', 'Declined'],
    ['00', 'Error'],
    ['92', 'Approved'],
    ['', 'Approved'],
  ])('3D Pay: signed procreturncode %j with response %j raises HashMismatchError', async (procreturncode, response) => {
    const cb = resign({ ...payCallback, procreturncode, response })
    expect(new GarantiPosCrypt().check3DHash(createAccount(), cb)).toBe(true)
    const err = await realGateway(recordingFetch().fetchImpl)
      .payment(MODEL.THREE_D_PAY, payOrder, TX_TYPE.PAY_AUTH, null, cb)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HashMismatchError)
    expect((err as Error).message).toBe('3D callback outcome fields are malformed')
  })

  /**
   * A signed 3D Pay callback for order ORDERX0012300 without a provision outcome (hash computed with PHP built-ins:
   * `strtoupper(hash("sha512", "30691298" . "ORDERX0012300" . "" . "" . "" . "1" . cavv . "02" . "MDVALUE123" . rnd
   * . "12345678"))`).
   */
  const prefixCallback: Record<string, string> = {
    ...payCallback,
    oid: 'ORDERX0012300',
    orderid: 'ORDERX0012300',
    transid: 'ORDERX0012300',
    authcode: '',
    procreturncode: '',
    response: '',
    hash: 'C7E681AF31543CB0AF78BE85B66B893598EB826B4573C3CE90012D06A70102E2C6CC8C2B4A97BC93EBE82CF9388AF5F387C425EFD363A953A00690723EB2DA1F',
  }

  // addition: review finding, the tail of the signed oid read as authcode "X00123" plus procreturncode "00" would
  // manufacture an approval for the shorter order id ORDER
  it('3D Pay: oid "ORDER" + authcode "X00123" + procreturncode "00" (hash still valid) raises HashMismatchError', async () => {
    expect(new GarantiPosCrypt().check3DHash(createAccount(), prefixCallback)).toBe(true)
    const forged = {
      ...prefixCallback,
      oid: 'ORDER',
      orderid: 'ORDER',
      transid: 'ORDER',
      authcode: 'X00123',
      procreturncode: '00',
    }
    expect(new GarantiPosCrypt().check3DHash(createAccount(), forged)).toBe(true)
    const err = await realGateway(recordingFetch().fetchImpl)
      .payment(MODEL.THREE_D_PAY, { ...payOrder, id: 'ORDER' }, TX_TYPE.PAY_AUTH, null, forged)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HashMismatchError)
    expect((err as Error).message).toBe('3D callback outcome fields are malformed')
  })

  // addition: the unshifted ORDERX0012300 callback is a legitimate, non-approved outcome
  it('3D Pay: the signed ORDERX0012300 callback without an outcome is not approved', async () => {
    const res = await realGateway(recordingFetch().fetchImpl).payment(
      MODEL.THREE_D_PAY,
      { ...payOrder, id: 'ORDERX0012300' },
      TX_TYPE.PAY_AUTH,
      null,
      prefixCallback,
    )
    expect(res.status).toBe('declined')
  })
})

describe('GarantiPos (end to end) other transactions', () => {
  // addition: bank error pages
  it('status() with HTTP 500 rejects with PosHttpError', async () => {
    const { fetchImpl } = recordingFetch(() => new Response('Internal Server Error', { status: 500 }))
    const err = await realGateway(fetchImpl)
      .status({ id: 'o' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).status).toBe(500)
  })

  it('status() with an HTML page (HTTP 200) rejects with PosError', async () => {
    const { fetchImpl } = recordingFetch(() => new Response('<html><body>Request Rejected</body></html>'))
    await expect(realGateway(fetchImpl).status({ id: 'o' })).rejects.toThrow(PosError)
  })

  // addition: G11 refund credentials are required before any HTTP call
  it('cancel without a refund username rejects MissingAccountInfoError, nothing sent', async () => {
    const { sent, fetchImpl } = recordingFetch()
    const acc = AccountFactory.createGarantiPosAccount(
      'garanti',
      '7000679',
      'PROVAUT',
      '123qweASD/',
      '30691298',
      '12345678',
    )
    await expect(realGateway(fetchImpl, { account: acc }).cancel({ id: 'o', ref_ret_num: 'r' })).rejects.toThrow(
      MissingAccountInfoError,
    )
    expect(sent).toHaveLength(0)
  })

  // addition: one instance serves concurrent requests
  it('two concurrent status() calls get their own responses', async () => {
    const { fetchImpl } = recordingFetch(async (body) => {
      const orderId = /<OrderID>([^<]*)<\/OrderID>/.exec(body)?.[1] ?? ''
      // the first request is answered last
      await new Promise((r) => setTimeout(r, orderId === 'A' ? 30 : 0))
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><GVPSResponse><Mode></Mode><Order><OrderID>${orderId}</OrderID></Order>` +
          '<Transaction><Response><Source>GVPS</Source><Code>00</Code><ReasonCode>00</ReasonCode><Message>Approved</Message>' +
          '<ErrorMsg></ErrorMsg><SysErrMsg></SysErrMsg></Response></Transaction></GVPSResponse>',
      )
    })
    const pos = realGateway(fetchImpl)

    const [a, b] = await Promise.all([pos.status({ id: 'A' }), pos.status({ id: 'B' })])

    expect(a.order_id).toBe('A')
    expect(b.order_id).toBe('B')
    expect('isSuccess' in pos).toBe(false)
  })
})
