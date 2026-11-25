import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import type { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { boaCallbackHash, KuveytPosCrypt } from '../../../src/crypt/KuveytPosCrypt.js'
import type { RequestDataMapperInterface } from '../../../src/data-mapper/request/mapper/RequestDataMapperInterface.js'
import { VakifKatilimPosRequestDataMapper } from '../../../src/data-mapper/request/mapper/VakifKatilimPosRequestDataMapper.js'
import { VakifKatilimPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/VakifKatilimPosRequestValueFormatter.js'
import { VakifKatilimPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/VakifKatilimPosRequestValueMapper.js'
import type { ResponseDataMapperInterface } from '../../../src/data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { VakifKatilimPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/VakifKatilimPosResponseDataMapper.js'
import { BoaPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/BoaPosResponseValueFormatter.js'
import { VakifKatilimPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/VakifKatilimPosResponseValueMapper.js'
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
import { VakifKatilimPos } from '../../../src/gateway/VakifKatilimPos.js'
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
  orderHistoryTestDataProvider,
  paymentTestDataProvider,
  refundTestDataProvider,
  threeDPaymentDataProvider,
} from '../data-mapper/response/mapper/VakifKatilimPosResponseDataMapper.data.js'

// The first section replaces the collaborators with vi.fn() fakes (except the request value mapper); the end-to-end
// sections use the real crypt, mappers and HTTP client over a fake fetch that answers like the bank (by path) and
// records every request.

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

const PAYMENT_API = 'https://boa.vakifkatilim.com.tr/VirtualPOS.Gateway/Home'
const HOST_GATEWAY = 'https://boa.vakifkatilim.com.tr/VirtualPOS.Gateway/CommonPaymentPage/CommonPaymentPage'

// deviation: the ported config names only gateway_3d; the client needs payment_api and the host form posts to
// gateway_3d_host
const config: GatewayConfig = {
  name: 'Vakıf Katılım',
  class: 'VakifKatilimPos',
  gateway_endpoints: { payment_api: PAYMENT_API, gateway_3d_host: HOST_GATEWAY },
}

const PASSWORD = 'kdsnsksl'
const V = AccountFactory.createBoaPosAccount('vakif-katilim', '1', 'APIUSER', '11111', PASSWORD)

const S1 = (text: string): string => createHash('sha1').update(text, 'utf8').digest('base64')
const HP = (password: string): string => S1(password)
/** The hashed password of `V` (the bank calls it `HashPassword`). */
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

/** Fields with `HashData` recomputed over the signed values, unless `over` names it (`undefined` leaves it out). */
const signed = (base: Data, over: Data = {}): Data => {
  const fields: Data = { ...base, ...over }
  if (!Object.hasOwn(over, 'HashData')) {
    fields.HashData = CB(fields.MerchantOrderId, fields.ResponseCode, fields.OrderId)
  }
  for (const key of Object.keys(fields)) if (fields[key] === undefined) delete fields[key]
  return fields
}

// ---------- callbacks ----------

const VS1_ORDER_ID = '2024070152BF'
const VS1_MD = '/6auNEWM9TvyMZAuoM5Tjw=='

/** The bank's 3D Secure approval for `2024070152BF`, resigned with `V`'s password (VS1). */
const vs1 = (over: Data = {}): Data =>
  signed(
    {
      ResponseCode: '00',
      ResponseMessage: 'Kart doğrulandı.',
      ProvisionNumber: '',
      MerchantOrderId: VS1_ORDER_ID,
      OrderId: '6373034',
      RRN: '',
      Stan: '',
      MD: VS1_MD,
    },
    over,
  )

/** The bank's 3D Secure decline for `20240701F2F6`, resigned with `V`'s password (VS2). */
const vs2 = (over: Data = {}): Data =>
  signed(
    {
      ResponseCode: 'MPIAuthenticationStatusN',
      ResponseMessage: '(N)Isleminiz gerceklestirelemedi. Kullanicinin 3d islem yapmasi engellendi.',
      ProvisionNumber: '',
      MerchantOrderId: '20240701F2F6',
      OrderId: '0',
      RRN: '',
      Stan: '',
      MD: 'DpOHKpBUNVvU5Ld/FaeM6Q==',
    },
    over,
  )

const VS3_ORDER_ID = '202407019FDB'

/** A 3D Host approval for `202407019FDB` (VS3); its references are unsigned and differ from the bank record. */
const vs3 = (over: Data = {}): Data =>
  signed(
    {
      ResponseCode: '00',
      ResponseMessage: '',
      ProvisionNumber: 'x',
      MerchantOrderId: VS3_ORDER_ID,
      OrderId: '6373641',
      RRN: 'r',
      Stan: 's',
    },
    over,
  )

const vs1Order = (over: PosOrder = {}): PosOrder => ({
  id: VS1_ORDER_ID,
  amount: 10.01,
  currency: CURRENCY.TRY,
  installment: 0,
  success_url: 'https://example.com/vakif/3d/response',
  fail_url: 'https://example.com/vakif/3d/response',
  ...over,
})

const hostOrder = (over: PosOrder = {}): PosOrder => ({
  id: VS3_ORDER_ID,
  amount: 10.01,
  currency: CURRENCY.TRY,
  ...over,
})

describe('VakifKatilimPos planning vectors', () => {
  // addition: VS1-VS3, BP1, BP2 and CV3 recomputed with node:crypto and the crypt helper
  it.each([
    ['HashPassword of kdsnsksl', HASH_PASSWORD, 'h58bUB83xQz2/21SUeOemUgkF5U='],
    ['VS1', CB(VS1_ORDER_ID, '00', '6373034'), 'liWp8z35PbP2d4OYaoEDW3yY6IE='],
    ['VS2', CB('20240701F2F6', 'MPIAuthenticationStatusN', '0'), 'Tu83EVuM6lhmSlsFkIA1AbexU6M='],
    ['VS3', CB(VS3_ORDER_ID, '00', '6373641'), 'M49Yh3MBXwWPKz8slNJDPdksIhs='],
    ['BP1', CB('A001', '00', '5000'), '/WQ7tidBSATFRSQfgbHJkElx+VY='],
    ['BP2', CB('B100', '51', '0'), 'gpWj+xZY1T1Z6pCTLWtr/zNaCTA='],
    [
      'CV3 approval',
      boaCallbackHash('DoxoW84N1hKFdV09SF4/FruhHm8=', VS1_ORDER_ID, '00', '6373034'),
      'tilHwVYboCx82++WZXg0I81LW6w=',
    ],
    [
      'CV3 decline',
      boaCallbackHash('DoxoW84N1hKFdV09SF4/FruhHm8=', '20240701F2F6', 'MPIAuthenticationStatusN', '0'),
      'SVdI+hHXxg8GO0wY0hAcfRWpHyo=',
    ],
  ])('%s', (_name, actual, expected) => {
    expect(actual).toBe(expected)
  })

  // addition: B5 the two re-splits the pins cannot close keep the genuine signature
  it('BP1 and BP2 re-reads keep the genuine signature', () => {
    expect(CB('A', '00', '1005000')).toBe(CB('A001', '00', '5000'))
    expect(CB('B1', '00', '510')).toBe(CB('B100', '51', '0'))
  })
})

describe('VakifKatilimPos (mocked collaborators)', () => {
  const account = V
  let requestValueMapper: VakifKatilimPosRequestValueMapper
  let requestMapper: Mocked<RequestDataMapperInterface>
  let responseMapper: Mocked<ResponseDataMapperInterface>
  let crypt: Mocked<CryptInterface>
  let httpClient: { supportsTx: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }
  let clientStrategy: { getClient: ReturnType<typeof vi.fn>; getAllClients: ReturnType<typeof vi.fn> }
  let requestDataPrepared: ReturnType<typeof vi.fn<(e: RequestDataPreparedEvent) => void>>
  let logger: ReturnType<typeof createLogger>
  let pos: VakifKatilimPos

  const baseOrder: PosOrder = {
    id: '2020110828BC',
    amount: 10.01,
    installment: 0,
    currency: CURRENCY.TRY,
    success_url: 'http://localhost/finansbank-payfor/3d/response.php',
    fail_url: 'http://localhost/finansbank-payfor/3d/response.php',
  }

  const createGateway = (cfg: GatewayConfig = config, acc: BoaPosAccount = account): VakifKatilimPos => {
    const hooks: PosHooks = { onRequestDataPrepared: [requestDataPrepared] }
    const deps: GatewayDeps<BoaPosAccount> = {
      requestValueMapper,
      requestValueFormatter: new VakifKatilimPosRequestValueFormatter(),
      requestDataMapper: requestMapper as unknown as RequestDataMapperInterface<BoaPosAccount>,
      responseDataMapper: responseMapper as unknown as ResponseDataMapperInterface,
      crypt: crypt as unknown as CryptInterface<BoaPosAccount>,
      clientStrategy: clientStrategy as unknown as HttpClientStrategy,
      logger,
      hooks,
    }
    return new VakifKatilimPos(cfg, acc, deps)
  }

  beforeEach(() => {
    requestValueMapper = new VakifKatilimPosRequestValueMapper()
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
      expect(event.gatewayClass).toBe('VakifKatilimPos')
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
    expect(pos.getCurrencies()).toHaveLength(6)
    expect(pos.getAccount()).toBe(account)
    expect(pos.isTestMode()).toBe(false)
    expect(pos.getCrypt()).toBe(crypt)
  })

  // addition: identifiers and the supported transactions table (V3: no partial refund)
  it('exposes NAME, the gateway class identifier and the supported transactions', () => {
    expect(VakifKatilimPos.NAME).toBe('VakifKatilim')
    expect(VakifKatilimPos.GATEWAY_CLASS).toBe('VakifKatilimPos')
    for (const model of [MODEL.NON_SECURE, MODEL.THREE_D_SECURE, MODEL.THREE_D_HOST]) {
      expect(VakifKatilimPos.isSupportedTransaction(TX_TYPE.PAY_AUTH, model)).toBe(true)
    }
    for (const model of [MODEL.THREE_D_PAY, MODEL.THREE_D_PAY_HOSTING]) {
      expect(VakifKatilimPos.isSupportedTransaction(TX_TYPE.PAY_AUTH, model)).toBe(false)
    }
    expect(VakifKatilimPos.isSupportedTransaction(TX_TYPE.PAY_PRE_AUTH, MODEL.NON_SECURE)).toBe(true)
    expect(VakifKatilimPos.isSupportedTransaction(TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_SECURE)).toBe(false)
    expect(VakifKatilimPos.isSupportedTransaction(TX_TYPE.REFUND_PARTIAL, MODEL.NON_SECURE)).toBe(false)
    for (const tx of [TX_TYPE.PAY_POST_AUTH, TX_TYPE.STATUS, TX_TYPE.CANCEL, TX_TYPE.REFUND, TX_TYPE.ORDER_HISTORY]) {
      expect(VakifKatilimPos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(true)
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

  it('get 3D form data success response', async () => {
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

  it('get 3D Host form data', async () => {
    const order = { id: '124' }
    requestMapper.create3DFormData.mockResolvedValue({ formData: true })

    const actual = await pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)

    expect(actual).toStrictEqual({ formData: true })
    expect(requestMapper.create3DFormData).toHaveBeenCalledTimes(1)
    // deviation: the host form posts to gateway_3d_host
    expect(requestMapper.create3DFormData).toHaveBeenCalledWith(
      account,
      order,
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_AUTH,
      HOST_GATEWAY,
    )
    expectNoRequest()
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
      MODEL.THREE_D_PAY,
      TX_TYPE.PAY_AUTH,
      false,
      true,
      UnsupportedTransactionTypeError,
      'VakifKatilimPos supports [regular, 3d, 3d_host] payment model(s) for transaction type [pay]. Provided payment model: [3d_pay].',
      null,
    ],
    [
      'unsupported_3d_secure_tx',
      MODEL.THREE_D_SECURE,
      TX_TYPE.PAY_PRE_AUTH,
      false,
      true,
      UnsupportedTransactionTypeError,
      'Invalid transaction type! Supported transaction types: [pay].',
      null,
    ],
    [
      'unsupported_3d_host_tx',
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_PRE_AUTH,
      false,
      true,
      UnsupportedTransactionTypeError,
      'Invalid transaction type! Supported transaction types: [pay].',
      null,
    ],
    [
      'non_payment_tx_type',
      MODEL.THREE_D_PAY,
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
      'unsupported_form_format_3d_host',
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_AUTH,
      false,
      false,
      UnsupportedFormFormatError,
      'Unsupported 3D form format!',
      FORM_FORMAT.HTML,
    ],
    [
      'unsupported_form_format_3d_secure',
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
      expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
      expectNoRequest()
    },
  )

  // addition: the bank page must be non-empty text
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

  const authFail = pick(threeDPaymentDataProvider, '3d_auth_fail1')
  const authSuccess = pick(threeDPaymentDataProvider, 'success1')

  type SecureRow = [
    name: string,
    order: PosOrder,
    callback: Data,
    provision: Data,
    mapped: Data,
    expected: Data,
    is3DSuccess: boolean,
  ]

  const secureRows: SecureRow[] = [
    [
      '3d_auth_fail',
      { currency: 'TRY' },
      {
        ResponseCode: 'MPIAuthenticationStatusN',
        ResponseMessage: '(N)Isleminiz gerceklestirelemedi. Kullanicinin 3d islem yapmasi engellendi.',
        MerchantOrderId: '20240701F2F6',
        HashData: 'SVdI+hHXxg8GO0wY0hAcfRWpHyo=',
        MD: 'DpOHKpBUNVvU5Ld/FaeM6Q==',
      },
      {},
      {
        md_error_message: '(N)Isleminiz gerceklestirelemedi. Kullanicinin 3d islem yapmasi engellendi.',
        error_code: 'MPIAuthenticationStatusN',
        error_message: null,
        order_id: '20240701F2F6',
        proc_return_code: 'MPIAuthenticationStatusN',
        status: 'declined',
      },
      {
        md_error_message: '(N)Isleminiz gerceklestirelemedi. Kullanicinin 3d islem yapmasi engellendi.',
        error_code: 'MPIAuthenticationStatusN',
        error_message: null,
        order_id: '20240701F2F6',
        proc_return_code: 'MPIAuthenticationStatusN',
        status: 'declined',
      },
      false,
    ],
    [
      'auth_success',
      // deviation: B5/B17 the signed id and the provision answer are bound to the order
      {
        id: VS1_ORDER_ID,
        amount: 10.01,
        currency: 'TRY',
        installment: 0,
        success_url: 'http://localhost/finansbank-payfor/3d/response.php',
        fail_url: 'http://localhost/finansbank-payfor/3d/response.php',
      },
      {
        ResponseCode: '00',
        ResponseMessage: 'Kart doğrulandı.',
        MerchantOrderId: VS1_ORDER_ID,
        OrderId: '6373034',
        HashData: 'tilHwVYboCx82++WZXg0I81LW6w=',
        MD: VS1_MD,
      },
      // deviation: B17 the provision answer carries its response code, order id and amount in kuruş
      {
        VPosMessage: {
          HashData: '7tVy86ZXrcFCXLXL61Ayk0NkuBU=',
          MerchantId: '1',
          SubMerchantId: '0',
          CustomerId: '222222',
          MerchantOrderId: VS1_ORDER_ID,
          Amount: '1001',
        },
        HashData: 'eNscG4h7B+Fx4/k0Dmt89HDP6nU=',
        ResponseCode: '00',
        MerchantOrderId: VS1_ORDER_ID,
      },
      {
        auth_code: '271425',
        ref_ret_num: '418312081069',
        remote_order_id: '6373034',
        order_id: VS1_ORDER_ID,
        proc_return_code: '00',
        status: 'approved',
      },
      // deviation: B17 an approval names the 3D model and takes the card mask from the provision answer only
      {
        auth_code: '271425',
        ref_ret_num: '418312081069',
        remote_order_id: '6373034',
        order_id: VS1_ORDER_ID,
        proc_return_code: '00',
        status: 'approved',
        payment_model: '3d',
        masked_number: null,
      },
      true,
    ],
  ]

  it.each(secureRows)('make3DPayment %s', async (_name, order, callback, provision, mapped, expected, is3DSuccess) => {
    // deviation: B4 the present HashData is verified first (stub-verified here)
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

    const result = await pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, cb(callback))

    expect(result).toStrictEqual(expected)
    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
    expect(crypt.check3DHash).toHaveBeenCalledWith(account, callback)
    expect(responseMapper.extractMdStatus).toHaveBeenCalledWith(callback)
    expect(responseMapper.is3dAuthSuccess).toHaveBeenCalledWith('3d-status')
    expect(responseMapper.map3DPaymentData).toHaveBeenCalledTimes(1)
    if (verify !== null) {
      expect(requestMapper.create3DPaymentRequestData).toHaveBeenCalledWith(account, order, TX_TYPE.PAY_AUTH, callback)
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(callback, provision, TX_TYPE.PAY_AUTH, order)
      verify()
    } else {
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(callback, null, TX_TYPE.PAY_AUTH, order)
      expectNoRequest()
    }
  })

  it('the mapper fixtures used above stay the bank fixtures', () => {
    expect(authFail.threeDResponseData.HashData).toBe('SVdI+hHXxg8GO0wY0hAcfRWpHyo=')
    expect(authSuccess.threeDResponseData.HashData).toBe('tilHwVYboCx82++WZXg0I81LW6w=')
  })

  // addition: B9 a signed decline mapped as approved is never returned
  it('a signed decline mapped as approved is rejected (PosError) without a request', async () => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.extractMdStatus.mockReturnValue('05')
    responseMapper.is3dAuthSuccess.mockReturnValue(false)
    responseMapper.map3DPaymentData.mockReturnValue({ status: 'approved' })
    await expect(pos.make3DPayment(cb(vs2()), vs1Order(), TX_TYPE.PAY_AUTH)).rejects.toThrow(
      new PosError('3D callback without approval was mapped as approved'),
    )
    expectNoRequest()
  })

  // addition: B9 the mapper's success does not replace the signed response code
  it('a mapper success is not trusted when the signed ResponseCode is not 00', async () => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.extractMdStatus.mockReturnValue('00')
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    responseMapper.map3DPaymentData.mockReturnValue({ status: 'declined' })
    const res = await pos.make3DPayment(cb(vs1({ ResponseCode: '05' })), vs1Order(), TX_TYPE.PAY_AUTH)
    expect(res.status).toBe('declined')
    expectNoRequest()
  })

  const approvePath = (provision: Data, mapped: Data, order: PosOrder = vs1Order()) => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.extractMdStatus.mockReturnValue('00')
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    responseMapper.map3DPaymentData.mockReturnValue(mapped)
    const provisionRequest = { request: 'create3DPaymentRequestData' }
    requestMapper.create3DPaymentRequestData.mockReturnValue(provisionRequest)
    return configureClientResponse(TX_TYPE.PAY_AUTH, provisionRequest, provision, order, MODEL.THREE_D_SECURE)
  }

  const bookedProvision = (over: Data = {}): Data => ({
    ResponseCode: '00',
    MerchantOrderId: VS1_ORDER_ID,
    VPosMessage: { Amount: '1001', MerchantOrderId: VS1_ORDER_ID },
    ...over,
  })

  // addition: B16 the gateway itself refuses a malformed MD before the request mapper sees the callback
  it.each([['a b'], ['x'.repeat(1025)], [undefined]])('MD %j is refused before any request', async (md) => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.extractMdStatus.mockReturnValue('00')
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    await expect(pos.make3DPayment(cb(vs1({ MD: md })), vs1Order(), TX_TYPE.PAY_AUTH)).rejects.toThrow(
      new PosError('3D callback authentication values are malformed'),
    )
    expectNoRequest()
  })

  // addition: B9 a provision answer mapped approved needs its own ResponseCode 00
  it.each([[{ ResponseCode: '05' }], [{ ResponseCode: '' }], [{ ResponseCode: { '@xsi:nil': 'true', '#': '' } }]])(
    'a provision answer %j mapped as approved is rejected (PosError)',
    async (provision) => {
      approvePath(provision, { status: 'approved' })
      await expect(pos.make3DPayment(cb(vs1()), vs1Order(), TX_TYPE.PAY_AUTH)).rejects.toThrow(
        new PosError('3D provision answer without approval was mapped as approved'),
      )
      expect(httpClient.request).toHaveBeenCalledTimes(1)
    },
  )

  // addition: B17 a 00 provision answer is the bank's booking: bound to the order even when the mapper declines it,
  // and a mapper decline of a bound booking is never a plain decline
  it.each([
    ['a bound booking mapped declined', bookedProvision(), 'order_status'],
    ['another order mapped declined', bookedProvision({ MerchantOrderId: 'X' }), 'order_id'],
  ])('a 00 provision answer with %s is OrderMismatchError %s', async (_n, provision, field) => {
    const verify = approvePath(provision, { status: 'declined', proc_return_code: null, all: { raw: true } })
    const err = await mismatch(pos.make3DPayment(cb(vs1()), vs1Order(), TX_TYPE.PAY_AUTH))
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
    verify()
  })

  // addition: B5 an approval names the order's id, whatever the mapper read
  it('an approval reports the order id, the 3D model and the card mask of the booking only', async () => {
    approvePath(bookedProvision(), { status: 'approved', order_id: 'X', payment_model: '3d_pay', masked_number: '4*' })
    const res = await pos.make3DPayment(cb(vs1()), vs1Order(), TX_TYPE.PAY_AUTH)
    expect([res.status, res.order_id, res.payment_model, res.masked_number]).toStrictEqual([
      'approved',
      VS1_ORDER_ID,
      '3d',
      null,
    ])
  })

  // addition: B4 a present HashData that does not verify is refused before anything else
  it('a HashData that does not verify is HashMismatchError without a request', async () => {
    crypt.check3DHash.mockReturnValue(false)
    await expect(pos.make3DPayment(cb(vs1()), vs1Order(), TX_TYPE.PAY_AUTH)).rejects.toThrow(
      new HashMismatchError('3D callback hash mismatch'),
    )
    expect(responseMapper.map3DPaymentData).not.toHaveBeenCalled()
    expectNoRequest()
  })

  // ---- 3D Host ----

  const confirmingRecord = (over: Data = {}): Data => ({
    VPosOrderData: {
      OrderContract: {
        OrderId: '6373641',
        MerchantOrderId: '123',
        OrderStatus: '1',
        LastOrderStatus: '1',
        TransactionStatus: '1',
        FEC: '0949',
        FirstAmount: '10.01',
        CancelAmount: '0.00',
        DrawbackAmount: '0.00',
        ResponseCode: '00',
        ProvNumber: '520366',
        RRN: '418313081500',
        Stan: '081500',
        ...over,
      },
    },
    ResponseCode: '00',
    ResponseMessage: '',
  })

  it('make3DHostPayment', async () => {
    // deviation: B4/V8 the ported case checks nothing; here the signature is verified and the approval is confirmed
    // with one status request whose record supplies the references
    const callback = {
      ResponseCode: '00',
      MerchantOrderId: '123',
      OrderId: '6373641',
      HashData: CB('123', '00', '6373641'),
      ProvisionNumber: 'p',
      RRN: 'r',
      Stan: 's',
    }
    const order = { id: '123', amount: 10.01, currency: CURRENCY.TRY }
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.extractMdStatus.mockReturnValue('00')
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    responseMapper.map3DHostResponseData.mockReturnValue({ status: 'approved', auth_code: 'p', ref_ret_num: 'r' })
    const statusRequest = { request: 'createStatusRequestData' }
    requestMapper.createStatusRequestData.mockReturnValue(statusRequest)
    const record = confirmingRecord()
    responseMapper.mapStatusResponse.mockReturnValue({ status: 'approved' })
    const verify = configureClientResponse(TX_TYPE.STATUS, statusRequest, record, { id: '123' }, MODEL.NON_SECURE)

    const result = await pos.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, cb(callback))

    expect(result).toStrictEqual({
      status: 'approved',
      order_id: '123',
      auth_code: '520366',
      ref_ret_num: '418313081500',
      transaction_id: '081500',
      remote_order_id: '6373641',
      amount: 10.01,
      currency: 'TRY',
      installment_count: null,
    })
    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
    expect(responseMapper.map3DHostResponseData).toHaveBeenCalledWith(callback, TX_TYPE.PAY_AUTH, order)
    expect(requestMapper.createStatusRequestData).toHaveBeenCalledWith(account, { id: '123' })
    expect(responseMapper.mapStatusResponse).toHaveBeenCalledWith(record)
    verify()
  })

  // addition: V8 the mapped status must be an approval
  it('a status answer the mapper declines is OrderMismatchError order_status, flagged', async () => {
    const callback = vs3()
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.extractMdStatus.mockReturnValue('00')
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    responseMapper.map3DHostResponseData.mockReturnValue({ status: 'approved', auth_code: 'x' })
    requestMapper.createStatusRequestData.mockReturnValue({ request: 'status' })
    responseMapper.mapStatusResponse.mockReturnValue({ status: 'declined' })
    configureClientResponse(
      TX_TYPE.STATUS,
      { request: 'status' },
      confirmingRecord({ MerchantOrderId: VS3_ORDER_ID }),
      { id: VS3_ORDER_ID },
      MODEL.NON_SECURE,
    )
    const err = (await pos
      .make3DHostPayment(cb(callback), hostOrder(), TX_TYPE.PAY_AUTH)
      .catch((e: unknown) => e)) as OrderMismatchError
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect([err.field, err.paymentMayHaveCompleted]).toStrictEqual(['order_status', true])
    expect(err.response?.requires_manual_review).toBe(true)
    // the attached result carries no unsigned callback reference
    expect(err.response?.auth_code).toBeNull()
  })

  // addition: B9 a signed 00 host callback the mapper does not approve is never confirmed nor approved
  it('a signed 00 host callback mapped declined is PosError without a request', async () => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.extractMdStatus.mockReturnValue('00')
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    responseMapper.map3DHostResponseData.mockReturnValue({ status: 'declined' })
    await expect(pos.make3DHostPayment(cb(vs3()), hostOrder(), TX_TYPE.PAY_AUTH)).rejects.toThrow(PosError)
    expectNoRequest()
  })

  it('make3DPayPayment', async () => {
    // deviation: B14 through payment() the supported transactions table answers first
    await expect(pos.payment(MODEL.THREE_D_PAY, {}, TX_TYPE.PAY_AUTH, null, cb({ abc: 'x' }))).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    // addition: V11 called directly
    await expect(pos.make3DPayPayment(cb({ abc: 'x' }), {}, TX_TYPE.PAY_AUTH)).rejects.toThrow(
      UnsupportedPaymentModelError,
    )
    expectNoRequest()
  })

  // ---- non-3D and query transactions ----

  it.each([[TX_TYPE.PAY_AUTH], [TX_TYPE.PAY_PRE_AUTH]])('regular payment %s', async (txType) => {
    const order = { id: '2020110828BC' }
    const c = card()
    const requestData = { request: 'createNonSecurePaymentRequestData' }
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(txType, requestData, { decoded: 'data' }, order, MODEL.NON_SECURE)
    responseMapper.mapPaymentResponse.mockReturnValue({ result: true })

    const res = await pos.payment(MODEL.NON_SECURE, order, txType, c)

    expect(res).toStrictEqual({ result: true })
    expect(requestMapper.createNonSecurePaymentRequestData).toHaveBeenCalledWith(account, order, txType, c)
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith({ decoded: 'data' }, txType, order)
    verify()
  })

  it('regular post-auth payment', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { request: 'createNonSecurePostAuthPaymentRequestData' }
    requestMapper.createNonSecurePostAuthPaymentRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(
      TX_TYPE.PAY_POST_AUTH,
      requestData,
      { decoded: 'data' },
      order,
      MODEL.NON_SECURE,
    )
    responseMapper.mapPaymentResponse.mockReturnValue({ result: true })

    await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_POST_AUTH)

    expect(requestMapper.createNonSecurePostAuthPaymentRequestData).toHaveBeenCalledWith(account, order)
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith({ decoded: 'data' }, TX_TYPE.PAY_POST_AUTH, order)
    verify()
  })

  it('status request', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { request: 'createStatusRequestData' }
    requestMapper.createStatusRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(TX_TYPE.STATUS, requestData, { decoded: 'data' }, order, MODEL.NON_SECURE)
    responseMapper.mapStatusResponse.mockReturnValue({ result: true })

    await pos.status(order)

    expect(requestMapper.createStatusRequestData).toHaveBeenCalledWith(account, order)
    expect(responseMapper.mapStatusResponse).toHaveBeenCalledWith({ decoded: 'data' })
    verify()
  })

  it.each([
    ['pay_order', { id: '2020110828BC', transaction_type: TX_TYPE.PAY_AUTH }],
    ['pay_auth_order', { id: '2020110828BC', transaction_type: TX_TYPE.PAY_PRE_AUTH }],
  ] as Array<[string, PosOrder]>)('cancel request %s', async (_name, order) => {
    const requestData = { request: 'createCancelRequestData' }
    requestMapper.createCancelRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(TX_TYPE.CANCEL, requestData, { decoded: 'data' }, order, MODEL.NON_SECURE)
    responseMapper.mapCancelResponse.mockReturnValue({ result: true })

    await pos.cancel(order)

    expect(requestMapper.createCancelRequestData).toHaveBeenCalledWith(account, order)
    expect(responseMapper.mapCancelResponse).toHaveBeenCalledWith({ decoded: 'data' })
    verify()
  })

  it.each([
    ['pay_order', { id: '2020110828BC', transaction_type: TX_TYPE.PAY_AUTH }],
    ['pay_auth_order', { id: '2020110828BC', transaction_type: TX_TYPE.PAY_PRE_AUTH }],
  ] as Array<[string, PosOrder]>)('refund request %s', async (_name, order) => {
    const requestData = { request: 'createRefundRequestData' }
    requestMapper.createRefundRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(TX_TYPE.REFUND, requestData, { decoded: 'data' }, order, MODEL.NON_SECURE)
    responseMapper.mapRefundResponse.mockReturnValue({ result: true })

    await pos.refund(order)

    expect(requestMapper.createRefundRequestData).toHaveBeenCalledWith(account, order, TX_TYPE.REFUND)
    expect(responseMapper.mapRefundResponse).toHaveBeenCalledWith({ decoded: 'data' })
    verify()
  })

  it('refund request pay_order_partial_refund', async () => {
    // deviation: V3 the bank's refund request carries no amount, so a partial refund is refused before any request
    const order = { id: '2020110828BC', order_amount: 10, amount: 5, transaction_type: TX_TYPE.PAY_AUTH }
    const err = await pos.refund(order).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnsupportedTransactionTypeError)
    expect((err as Error).message).toBe('Partial refunds are not supported: the bank request carries no amount')
    expect(requestMapper.createRefundRequestData).not.toHaveBeenCalled()
    expectNoRequest()
  })

  it('order history request', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { request: 'createOrderHistoryRequestData' }
    requestMapper.createOrderHistoryRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(
      TX_TYPE.ORDER_HISTORY,
      requestData,
      { decoded: 'data' },
      order,
      MODEL.NON_SECURE,
    )
    responseMapper.mapOrderHistoryResponse.mockReturnValue({ result: true })

    await pos.orderHistory(order)

    expect(requestMapper.createOrderHistoryRequestData).toHaveBeenCalledWith(account, order)
    expect(responseMapper.mapOrderHistoryResponse).toHaveBeenCalledWith({ decoded: 'data' })
    verify()
  })
})

// ---------- end to end: real crypt, mappers and HTTP client over a fake fetch ----------

type Sent = { url: string; path: string; text: string; fields: Data }

type Answer = string | Response

type BankOptions = {
  /** The bank's 3D page. */
  form?: Answer
  /** The provision answer, from the posted provision fields. */
  provision?: (fields: Data) => Answer
  /** The status answer, from the posted status fields. */
  status?: (fields: Data) => Answer
  /** The answer to a sale, pre-authorization or close, from the path and the posted fields. */
  sale?: (path: string, fields: Data) => Answer
  /** The answer to a cancel. */
  reversal?: () => Answer
  /** The answer to a refund. */
  refund?: () => Answer
}

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

const NS = {
  '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
  '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
}

const answerXml = (record: Data): string =>
  `<?xml version="1.0" encoding="utf-8"?>${element('VPosTransactionResponseContract', record)}`

const PROVISION: Data = pick(threeDPaymentDataProvider, 'success1').paymentData

/** The bank's provision answer booked for the posted order id and amount, with `over` applied. */
const provisionFor = (fields: Data, over: Data = {}, message: Data = {}): Data => {
  const record = structuredClone(PROVISION)
  record.MerchantOrderId = fields.MerchantOrderId
  record.VPosMessage.MerchantOrderId = fields.MerchantOrderId
  record.VPosMessage.Amount = fields.Amount
  Object.assign(record.VPosMessage, message)
  return { ...record, ...over }
}

/** A bank order record of a completed, open 3D Host sale of 10.01 TRY. */
const orderRecord = (merchantOrderId: string, over: Data = {}): Data => ({
  OrderId: '6373641',
  MerchantOrderId: merchantOrderId,
  MerchantId: '1',
  PosTerminalId: '111111',
  OrderStatus: '1',
  OrderStatusDescription: 'Satis',
  OrderType: '1',
  OrderTypeDescription: 'Pesin',
  TransactionStatus: '1',
  TransactionStatusDescription: 'Basarili',
  LastOrderStatus: '1',
  LastOrderStatusDescription: 'Satis',
  EndOfDayStatus: '1',
  EndOfDayStatusDescription: 'Acik',
  FEC: '0949',
  FecDescription: 'TRY',
  TransactionSecurity: '3',
  TransactionSecurityDescription: '3d islem',
  CardHolderName: 'John Doe',
  CardType: 'MasterCard',
  CardNumber: '5353********7017',
  OrderDate: '2024-07-01T13:15:47.2',
  FirstAmount: '10.01',
  FECAmount: '0.00',
  CancelAmount: '0.00',
  DrawbackAmount: '0.00',
  ClosedAmount: '0.00',
  InstallmentCount: '0',
  ResponseCode: '00',
  ResponseExplain: 'Provizyon alındı.',
  ProvNumber: '520366',
  RRN: '418313081500',
  Stan: '081500',
  MerchantUserName: 'APIUSER',
  BatchId: '69',
  ...over,
})

const statusAnswer = (contract: unknown, over: Data = {}): Data => ({
  ...NS,
  VPosOrderData: { OrderContract: contract },
  ResponseCode: '00',
  ResponseMessage: '',
  ...over,
})

const NON_RESULT: Data = {
  ...NS,
  VPosOrderData: '',
  ResponseCode: 'NonResult',
  ResponseMessage: 'Kriterlere uygun sonuc bulunmamaktadir.',
}

const SALE_ANSWER: Data = pick(paymentTestDataProvider, 'success1').responseData
const CANCEL_ANSWER: Data = pick(cancelTestDataProvider, 'success1').responseData
const REFUND_ANSWER: Data = pick(refundTestDataProvider, 'success1').responseData
const HISTORY_ANSWER: Data = pick(orderHistoryTestDataProvider, 'success_pay_then_cancel').input

/**
 * A fetch that records each request and answers like the bank by path: `ThreeDModelPayGate` with an HTML page,
 * `ThreeDModelProvisionGate` with XML booked for the posted order, `SelectOrderByMerchantOrderId` with a confirming
 * record of the posted order id, and fixture answers for the other operations. Anything else fails.
 */
function bankFetch(options: BankOptions = {}) {
  const sent: Sent[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const bytes = Buffer.from(
      await new Request('https://example.invalid', { method: 'POST', body: init?.body ?? '' }).arrayBuffer(),
    )
    const u = String(url)
    const text = bytes.toString('latin1')
    const fields = XmlDecoder.decode(text)
    const path = u.slice(PAYMENT_API.length + 1)
    sent.push({ url: u, path, text, fields })
    let reply: Answer | undefined
    switch (path) {
      case 'ThreeDModelPayGate':
        reply = options.form ?? '<html><body>bank 3d page</body></html>'
        break
      case 'ThreeDModelProvisionGate':
        reply = options.provision?.(fields) ?? answerXml(provisionFor(fields))
        break
      case 'SelectOrderByMerchantOrderId':
        reply = options.status?.(fields) ?? answerXml(statusAnswer(orderRecord(String(fields.MerchantOrderId))))
        break
      case 'Non3DPayGate':
      case 'PreAuthorizaten':
      case 'PreAuthorizatenClose':
        reply = options.sale?.(path, fields) ?? answerXml({ ...SALE_ANSWER, MerchantOrderId: fields.MerchantOrderId })
        break
      case 'SaleReversal':
      case 'PreAuthorizationReversal':
        reply = options.reversal?.() ?? answerXml(CANCEL_ANSWER)
        break
      case 'DrawBack':
      case 'PreAuthorizationDrawBack':
        reply = options.refund?.() ?? answerXml(REFUND_ANSWER)
        break
      case 'SelectOrder':
        reply = answerXml(HISTORY_ANSWER)
        break
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
  const valueMapper = new VakifKatilimPosRequestValueMapper()
  const valueFormatter = new VakifKatilimPosRequestValueFormatter()
  const hooks = options.hooks ?? {}
  const deps: GatewayDeps<BoaPosAccount> = {
    requestValueMapper: valueMapper,
    requestValueFormatter: valueFormatter,
    requestDataMapper: new VakifKatilimPosRequestDataMapper(valueMapper, valueFormatter, hooks, cryptImpl, LANG.TR),
    responseDataMapper: new VakifKatilimPosResponseDataMapper(
      new BoaPosResponseValueFormatter(),
      new VakifKatilimPosResponseValueMapper(),
      log,
    ),
    crypt: cryptImpl,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(
      VakifKatilimPos.GATEWAY_CLASS,
      cfg,
      new HttpTransport({ fetch: fetchImpl }),
      log,
    ),
    logger: log,
    hooks,
  }

  return new VakifKatilimPos(cfg, options.account ?? V, deps)
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
const NO_DATA = 'Bank answered the payment request without any data; its outcome is unknown'
const NO_CODE = 'Bank answered the payment request without a response code; its outcome is unknown'
const NIL = { '@xsi:nil': 'true' }
const TEXT_ROOT = '<VPosTransactionResponseContract>00</VPosTransactionResponseContract>'

describe('VakifKatilimPos (end to end) 3D Secure', () => {
  const run = (
    callback: Data,
    order: PosOrder = vs1Order(),
    options: BankOptions = {},
    cfg: GatewayConfig = config,
  ) => {
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

  // addition: V7/B17 one provision request built from the order and the signed callback, bound to the order
  it('provisions a VS1-signed callback with one request built from the order', async () => {
    const callback = vs1()
    expect(callback.HashData).toBe('liWp8z35PbP2d4OYaoEDW3yY6IE=')
    const { sent, promise } = run(callback)
    const res = (await promise) as Data

    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(`${PAYMENT_API}/ThreeDModelProvisionGate`)
    expect(sent[0]?.text.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe(true)
    const okUrl = 'https://example.com/vakif/3d/response'
    expect(sent[0]?.fields).toStrictEqual({
      MerchantId: '1',
      CustomerId: '11111',
      UserName: 'APIUSER',
      SubMerchantId: '0',
      OkUrl: okUrl,
      FailUrl: okUrl,
      HashData: RQ({
        MerchantId: '1',
        MerchantOrderId: VS1_ORDER_ID,
        Amount: '1001',
        OkUrl: okUrl,
        FailUrl: okUrl,
        UserName: 'APIUSER',
      }),
      APIVersion: '1.0.0',
      AdditionalData: { AdditionalDataList: { VPosAdditionalData: { Key: 'MD', Data: VS1_MD } } },
      InstallmentCount: '0',
      Amount: '1001',
      MerchantOrderId: VS1_ORDER_ID,
      TransactionSecurity: '3',
    })
    expect(res.status).toBe('approved')
    expect(res.order_id).toBe(VS1_ORDER_ID)
    expect(res.auth_code).toBe('271425')
    expect(res.ref_ret_num).toBe('418312081069')
    expect(res.transaction_id).toBe('434824')
    expect(res.remote_order_id).toBe('6373034')
    expect(res.amount).toBe(10.01)
    expect(res.currency).toBe('TRY')
    expect(res.payment_model).toBe('3d')
    expect(res.masked_number).toBeNull()
  })

  // addition: B6 1.15 is 115 kuruş in the provision, and the bank's 115 binds; its 114 does not
  it('1.15 TRY is provisioned and bound as 115 kuruş; a booking at 114 is OrderMismatchError amount', async () => {
    const ok = run(vs1(), vs1Order({ amount: 1.15 }))
    const res = (await ok.promise) as Data
    expect(ok.sent[0]?.fields.Amount).toBe('115')
    expect(res.status).toBe('approved')
    expect(res.amount).toBe(1.15)

    const low = run(vs1(), vs1Order({ amount: 1.15 }), {
      provision: (f) => answerXml(provisionFor(f, {}, { Amount: '114' })),
    })
    const err = await mismatch(low.promise)
    expect([err.field, err.expected, err.actual, err.paymentMayHaveCompleted]).toStrictEqual([
      'amount',
      '115',
      '114',
      true,
    ])
  })

  // addition: B17 the provision answer is the bank's booking: it must be this order's, for this amount and currency
  it.each([
    ['MerchantOrderId X', (f: Data) => provisionFor(f, { MerchantOrderId: 'X' }), 'order_id'],
    ['no MerchantOrderId', (f: Data) => provisionFor(f, { MerchantOrderId: undefined }), 'order_id'],
    ['VPosMessage.Amount 1000', (f: Data) => provisionFor(f, {}, { Amount: '1000' }), 'amount'],
    ['VPosMessage.Amount 01001', (f: Data) => provisionFor(f, {}, { Amount: '01001' }), 'amount'],
    ['VPosMessage.Amount 10.01', (f: Data) => provisionFor(f, {}, { Amount: '10.01' }), 'amount'],
    ['VPosMessage.Amount twice', (f: Data) => provisionFor(f, {}, { Amount: ['1001', '1001'] }), 'amount'],
    ['no VPosMessage (mapped declined)', (f: Data) => provisionFor(f, { VPosMessage: undefined }), 'amount'],
    ['VPosMessage.MerchantOrderId X', (f: Data) => provisionFor(f, {}, { MerchantOrderId: 'X' }), 'order_id'],
    ['CurrencyCode 0840', (f: Data) => provisionFor(f, {}, { CurrencyCode: '0840' }), 'currency'],
    ['FECCurrencyCode 840', (f: Data) => provisionFor(f, {}, { FECCurrencyCode: '840' }), 'currency'],
  ])('a 00 provision answer with %s is OrderMismatchError %s with the result attached', async (_n, answer, field) => {
    const { sent, promise } = run(vs1(), vs1Order(), { provision: (f) => answerXml(answer(f)) })
    const err = await mismatch(promise)
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
    expect(sent).toHaveLength(1)
  })

  // addition: B17 a currency the bank states in the order's code binds
  it('a provision answer with CurrencyCode 949 binds to a TRY order', async () => {
    const { promise } = run(vs1(), vs1Order(), {
      provision: (f) => answerXml(provisionFor(f, {}, { CurrencyCode: '949', FECCurrencyCode: '0949' })),
    })
    expect(((await promise) as Data).status).toBe('approved')
  })

  // addition: Task 7 carry, the decoder removes `&#x0;`, so '0&#x0;0' is the bank's 00: it is bound on the order
  it("a provision ResponseCode '0&#x0;0' reads as 00 and is still bound to the order", async () => {
    const withNull = (f: Data, over: Data = {}) =>
      answerXml(provisionFor(f, { ResponseCode: 'RC', ...over })).replace('<ResponseCode>RC<', '<ResponseCode>0&#x0;0<')
    const ok = await run(vs1(), vs1Order(), { provision: (f) => withNull(f) }).promise
    expect((ok as Data).status).toBe('approved')

    const other = run(vs1(), vs1Order(), { provision: (f) => withNull(f, { MerchantOrderId: 'X' }) })
    expect((await mismatch(other.promise)).field).toBe('order_id')
  })

  // addition: ruling (final fix wave), once the provision was sent an empty or ambiguous answer is no decline
  it.each([
    ['HTTP 204', () => new Response(null, { status: 204 }), NO_DATA],
    ['a root element without fields', () => answerXml({ ...NS }), NO_DATA],
    ['no ResponseCode', (f: Data) => answerXml(provisionFor(f, { ResponseCode: undefined })), NO_CODE],
    ['an empty ResponseCode', (f: Data) => answerXml(provisionFor(f, { ResponseCode: '' })), NO_CODE],
    ['a nil ResponseCode', (f: Data) => answerXml(provisionFor(f, { ResponseCode: NIL })), NO_CODE],
    ['a root that holds only text', () => TEXT_ROOT, NO_CODE],
  ])('a provision answered with %s is PosHttpError naming the request URL', async (_n, answer, message) => {
    const { sent, promise } = run(vs1(), vs1Order(), { provision: answer as (f: Data) => Answer })
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).message).toBe(message)
    expect((err as PosHttpError).url).toBe(`${PAYMENT_API}/ThreeDModelProvisionGate`)
    expect(sent).toHaveLength(1)
  })

  // addition: an order value the bank answer is compared with is validated before any request
  it.each([
    ['currency usd', { currency: 'usd' }],
    ['currency XYZ', { currency: 'XYZ' }],
    ['currency 840', { currency: 840 }],
    ['installment 100', { installment: 100 }],
  ])('an order with %s is PosError before the provision', async (_n, over) => {
    const { sent, promise } = run(vs1(), vs1Order(over as PosOrder))
    await expect(promise).rejects.toThrow(PosError)
    expect(sent).toHaveLength(0)
  })

  it.each([
    ['ResponseCode 00 twice', { ResponseCode: ['00', '00'] }],
    ['ResponseCode 51 and 00', { ResponseCode: ['51', '00'] }],
    ['ResponseCode with a child element', { ResponseCode: { a: '00' } }],
  ])('a provision answer with %s is OrderMismatchError order_status, flagged', async (_n, over) => {
    const { sent, promise } = run(vs1(), vs1Order(), { provision: (f) => answerXml(provisionFor(f, over)) })
    const err = await mismatch(promise)
    expect([err.field, err.paymentMayHaveCompleted]).toStrictEqual(['order_status', true])
    expect(err.response?.requires_manual_review).toBe(true)
    expect(sent).toHaveLength(1)
  })

  it.each([
    ['HTTP 500', new Response('error', { status: 500 })],
    ['a 200 HTML page', new Response('<html lang="tr">Request Rejected</html>', { status: 200 })],
    ['an empty 200', new Response('', { status: 200 })],
  ])('a provision answered with %s is PosHttpError', async (_n, answer) => {
    const { sent, promise } = run(vs1(), vs1Order(), { provision: () => answer })
    await expect(promise).rejects.toThrow(PosHttpError)
    expect(sent).toHaveLength(1)
  })

  // addition: V7 the provision answer decides
  it('a provision answer MetaDataNotFound is declined', async () => {
    const { sent, promise } = run(vs1(), vs1Order(), {
      provision: () =>
        answerXml({
          ...NS,
          ResponseCode: 'MetaDataNotFound',
          ResponseMessage: 'Ödeme detayı bulunamadı.',
          OrderId: '0',
        }),
    })
    const res = (await promise) as Data
    expect([res.status, res.proc_return_code]).toStrictEqual(['declined', 'MetaDataNotFound'])
    expect(sent).toHaveLength(1)
  })

  // addition: B5 a callback signed for another order is not this order's (nothing attached, nothing sent)
  it('a callback signed for another order is OrderMismatchError order_id, nothing sent', async () => {
    const { sent, promise } = run(vs1(), vs1Order({ id: 'OTHER1' }))
    const err = await mismatch(promise)
    expect([err.field, err.paymentMayHaveCompleted, err.response]).toStrictEqual(['order_id', false, undefined])
    expect(sent).toHaveLength(0)
  })

  // addition: B5/B16 refusals before any request
  it.each([
    ['OrderId 0', vs1({ OrderId: '0' }), MALFORMED],
    ['OrderId 06373034', vs1({ OrderId: '06373034' }), MALFORMED],
    // the crypt needs all three signed fields
    ['no OrderId', vs1({ OrderId: undefined }), HASH_MISMATCH],
    ['MD a b', vs1({ MD: 'a b' }), BAD_MD],
    ['MD too long', vs1({ MD: 'A'.repeat(1025) }), BAD_MD],
    ['no MD', vs1({ MD: undefined }), BAD_MD],
    ['an approval without HashData', vs1({ HashData: undefined }), NO_HASH],
    ['an approval with an empty HashData', vs1({ HashData: '' }), NO_HASH],
    ['an altered HashData', vs1({ HashData: CB(VS1_ORDER_ID, '00', '6373035') }), HASH_MISMATCH],
    ['a 27-character HashData', vs1({ HashData: 'liWp8z35PbP2d4OYaoEDW3yY6IE' }), HASH_MISMATCH],
    ['a lowercase HashData', vs1({ HashData: 'liwp8z35pbp2d4oyaoedw3yy6ie=' }), HASH_MISMATCH],
    ['an altered amount field is ignored but the order id is not', vs1({ MerchantOrderId: 'X' }), null],
  ])('%s is refused before any request', async (_n, callback, error) => {
    const { sent, promise } = run(callback)
    if (error === null) {
      expect((await mismatch(promise)).field).toBe('order_id')
    } else {
      await expect(promise).rejects.toThrow(error)
    }
    expect(sent).toHaveLength(0)
  })

  // addition: V7 the callback is a flat form of strings
  it.each([
    ['HashData list', { HashData: ['liWp8z35PbP2d4OYaoEDW3yY6IE='] }],
    ['MerchantOrderId record', { MerchantOrderId: { a: VS1_ORDER_ID } }],
    ['ResponseCode number', { ResponseCode: 0 }],
    ['MD null', { MD: null }],
  ])('a callback with a %s is PosError, nothing sent', async (_n, over) => {
    const { sent, promise } = run({ ...vs1(), ...over })
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect(err).not.toBeInstanceOf(OrderMismatchError)
    expect((err as Error).message).toMatch(/^3D callback field ".+" must be a string$/)
    expect(sent).toHaveLength(0)
  })

  // addition: B5 BP1, a re-read the pins cannot see is caught by the provision binding
  it('BP1: a genuine approval of A001 re-read as order A is OrderMismatchError order_id after one request', async () => {
    const reRead = vs1({ MerchantOrderId: 'A', OrderId: '1005000', HashData: CB('A001', '00', '5000') })
    const { sent, promise } = run(reRead, vs1Order({ id: 'A' }), {
      provision: (f) => answerXml(provisionFor(f, { MerchantOrderId: 'A001' }, { MerchantOrderId: 'A001' })),
    })
    const err = await mismatch(promise)
    expect([err.field, err.paymentMayHaveCompleted]).toStrictEqual(['order_id', true])
    expect(sent).toHaveLength(1)
    expect(sent[0]?.fields.MerchantOrderId).toBe('A')
  })

  // addition: B4/B9 signed declines are mapped declined without a request
  it('maps the VS2-signed decline declined without a request', async () => {
    const callback = vs2()
    expect(callback.HashData).toBe('Tu83EVuM6lhmSlsFkIA1AbexU6M=')
    const { sent, promise } = run(callback, vs1Order({ id: '20240701F2F6' }))
    const res = (await promise) as Data
    expect([res.status, res.proc_return_code, res.error_code]).toStrictEqual([
      'declined',
      'MPIAuthenticationStatusN',
      'MPIAuthenticationStatusN',
    ])
    expect(sent).toHaveLength(0)
  })

  // addition: B8 an unsigned decline carries trusted data only; require_3d_hash rejects it
  it('maps an unsigned decline from the order only; require_3d_hash rejects it', async () => {
    const callback = vs2({ HashData: undefined, MerchantOrderId: 'SOMEONE-ELSE', ProvisionNumber: '999999' })
    const order = vs1Order()
    const { sent, promise } = run(callback, order)
    const res = (await promise) as Data
    expect(res.status).toBe('declined')
    expect(res.order_id).toBe(VS1_ORDER_ID)
    expect(res.payment_model).toBe('3d')
    expect(res.transaction_type).toBe('pay')
    expect(res.proc_return_code).toBe('MPIAuthenticationStatusN')
    expect(res.amount).toBeNull()
    expect(res.auth_code).toBeNull()
    expect(res.remote_order_id ?? null).toBeNull()
    expect(res.requires_manual_review).toBeUndefined()
    expect(sent).toHaveLength(0)

    const strict = run(callback, order, {}, { ...config, require_3d_hash: true })
    await expect(strict.promise).rejects.toThrow(NO_HASH)
    expect(strict.sent).toHaveLength(0)
  })

  // addition: B8 decline reasons are bounded plain text
  it('an unsigned decline keeps at most 256 characters of its reason', async () => {
    const { promise } = run(vs2({ HashData: undefined, ResponseMessage: 'x'.repeat(400) }))
    const res = (await promise) as Data
    expect(res.md_error_message).toHaveLength(256)
  })

  // addition: ruling, an echoed HashPassword is replaced in the result
  it('replaces the echoed HashPassword in all', async () => {
    const { promise } = run(vs1(), vs1Order(), {
      provision: (f) => answerXml(provisionFor(f, {}, { HashPassword: HASH_PASSWORD })),
    })
    const res = (await promise) as Data
    expect(res.all.VPosMessage.HashPassword).toBe('***')
    expect(JSON.stringify(res)).not.toContain(HASH_PASSWORD)
  })
})

describe('VakifKatilimPos (end to end) 3D Host', () => {
  const run = (
    callback: Data,
    order: PosOrder = hostOrder(),
    options: BankOptions = {},
    cfg: GatewayConfig = config,
  ) => {
    const { sent, fetchImpl } = bankFetch(options)
    const promise = realGateway(fetchImpl, { cfg }).payment(
      MODEL.THREE_D_HOST,
      order,
      TX_TYPE.PAY_AUTH,
      null,
      cb(callback),
    )
    return { sent, promise }
  }

  const status =
    (contract: unknown, over: Data = {}) =>
    () =>
      answerXml(statusAnswer(contract, over))

  // addition: V8 one signed status request confirms the approval; the references come from the bank record
  it('confirms a VS3-signed approval with one status request and takes the references from the record', async () => {
    const callback = vs3()
    expect(callback.HashData).toBe('M49Yh3MBXwWPKz8slNJDPdksIhs=')
    const { sent, promise } = run(callback)
    const res = (await promise) as Data

    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(`${PAYMENT_API}/SelectOrderByMerchantOrderId`)
    expect(sent[0]?.fields).toStrictEqual({
      MerchantId: '1',
      CustomerId: '11111',
      UserName: 'APIUSER',
      SubMerchantId: '0',
      MerchantOrderId: VS3_ORDER_ID,
      HashData: RQ({ MerchantId: '1', MerchantOrderId: VS3_ORDER_ID, UserName: 'APIUSER' }),
    })
    expect(res.status).toBe('approved')
    expect(res.order_id).toBe(VS3_ORDER_ID)
    expect(res.payment_model).toBe('3d_host')
    expect(res.auth_code).toBe('520366')
    expect(res.ref_ret_num).toBe('418313081500')
    expect(res.transaction_id).toBe('081500')
    expect(res.remote_order_id).toBe('6373641')
    expect(res.amount).toBe(10.01)
    expect(res.currency).toBe('TRY')
    expect(res.installment_count).toBe(0)
    expect(res.requires_manual_review).toBeUndefined()
  })

  // addition: V8 every way in which the record does not confirm the payment, with the result flagged
  it.each([
    ['FirstAmount 0.01 (browser-altered amount)', status(orderRecord(VS3_ORDER_ID, { FirstAmount: '0.01' })), 'amount'],
    ['FirstAmount 10.010', status(orderRecord(VS3_ORDER_ID, { FirstAmount: '10.010' })), 'amount'],
    ['FirstAmount 1001', status(orderRecord(VS3_ORDER_ID, { FirstAmount: '1001' })), 'amount'],
    ['no FirstAmount', status(orderRecord(VS3_ORDER_ID, { FirstAmount: undefined })), 'amount'],
    ['FEC 0840', status(orderRecord(VS3_ORDER_ID, { FEC: '0840' })), 'currency'],
    ['no FEC', status(orderRecord(VS3_ORDER_ID, { FEC: undefined })), 'currency'],
    ['LastOrderStatus 6', status(orderRecord(VS3_ORDER_ID, { LastOrderStatus: '6' })), 'order_status'],
    ['OrderStatus 6', status(orderRecord(VS3_ORDER_ID, { OrderStatus: '6' })), 'order_status'],
    ['record ResponseCode 05', status(orderRecord(VS3_ORDER_ID, { ResponseCode: '05' })), 'order_status'],
    ['CancelAmount 10.01', status(orderRecord(VS3_ORDER_ID, { CancelAmount: '10.01' })), 'order_status'],
    ['DrawbackAmount 1.00', status(orderRecord(VS3_ORDER_ID, { DrawbackAmount: '1.00' })), 'order_status'],
    ['CancelAmount twice', status(orderRecord(VS3_ORDER_ID, { CancelAmount: ['0.00', '0.00'] })), 'order_status'],
    [
      'an OrderContract list (sale + cancel)',
      status([orderRecord(VS3_ORDER_ID), orderRecord(VS3_ORDER_ID, { OrderStatus: '6', LastOrderStatus: '6' })]),
      'order_status',
    ],
    ['no ProvNumber', status(orderRecord(VS3_ORDER_ID, { ProvNumber: '' })), 'order_status'],
    ['a ProvNumber with a space', status(orderRecord(VS3_ORDER_ID, { ProvNumber: '52 366' })), 'order_status'],
    ['record MerchantOrderId X', status(orderRecord('X')), 'order_id'],
    ['status ResponseCode NonResult', () => answerXml(NON_RESULT), 'order_status'],
    ['status ResponseCode twice', status(orderRecord(VS3_ORDER_ID), { ResponseCode: ['00', '00'] }), 'order_status'],
    ['no VPosOrderData', () => answerXml({ ...NS, ResponseCode: '00' }), 'order_status'],
  ])('a status record with %s is OrderMismatchError %s, flagged', async (_n, answer, field) => {
    const { sent, promise } = run(vs3(), hostOrder(), { status: answer })
    const err = await mismatch(promise)
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
    expect(err.response?.order_id).toBe(VS3_ORDER_ID)
    // the unsigned callback references never reach the attached result
    expect(err.response?.auth_code).toBeNull()
    expect(err.response?.ref_ret_num).toBeNull()
    expect(err.response?.transaction_id).toBeNull()
    expect(err.response?.remote_order_id).toBeNull()
    expect(sent).toHaveLength(1)
  })

  // addition: the attached result never carries the callback's bank order id, even a signed one
  it('a forged OrderId never reaches the result attached to a failed confirmation', async () => {
    const { promise } = run(vs3({ OrderId: '424242' }), hostOrder(), { status: () => answerXml(NON_RESULT) })
    const err = await mismatch(promise)
    expect(err.response?.remote_order_id).toBeNull()
    // only the raw callback (`all`, untrusted) still shows it
    expect(JSON.stringify({ ...err.response, all: null, '3d_all': null })).not.toContain('424242')
  })

  // addition: ruling, the record must show a successful transaction that was not a non-secure sale
  it.each([
    ['TransactionStatus 2', { TransactionStatus: '2' }],
    ['TransactionStatus 0', { TransactionStatus: '0' }],
    ['no TransactionStatus', { TransactionStatus: undefined }],
    ['TransactionSecurity 5', { TransactionSecurity: '5' }],
    ['TransactionSecurity twice', { TransactionSecurity: ['3', '5'] }],
  ])('a status record with %s is OrderMismatchError order_status', async (_n, over) => {
    const { promise } = run(vs3(), hostOrder(), { status: status(orderRecord(VS3_ORDER_ID, over)) })
    const err = await mismatch(promise)
    expect([err.field, err.paymentMayHaveCompleted]).toStrictEqual(['order_status', true])
  })

  it.each([
    ['TransactionSecurity 3', { TransactionSecurity: '3' }],
    ['no TransactionSecurity', { TransactionSecurity: undefined }],
  ])('a status record with %s confirms', async (_n, over) => {
    const res = (await run(vs3(), hostOrder(), { status: status(orderRecord(VS3_ORDER_ID, over)) }).promise) as Data
    expect(res.status).toBe('approved')
  })

  // addition: an order value the record is compared with is validated before the status request
  it.each([
    ['currency usd', { currency: 'usd' }],
    ['currency XYZ', { currency: 'XYZ' }],
    ['installment 100', { installment: 100 }],
    ['installment abc', { installment: 'abc' }],
  ])('an order with %s is PosError before the status request', async (_n, over) => {
    const { sent, promise } = run(vs3(), hostOrder(over as PosOrder))
    await expect(promise).rejects.toThrow(PosError)
    expect(sent).toHaveLength(0)
  })

  // addition: V8 a stated installment count must be the record's; one installment is a single payment
  it('binds the installment count when the order states one', async () => {
    const two = run(vs3(), hostOrder({ installment: 0 }), {
      status: status(orderRecord(VS3_ORDER_ID, { InstallmentCount: '2', OrderType: '2' })),
    })
    expect((await mismatch(two.promise)).field).toBe('installment')

    const one = await run(vs3(), hostOrder({ installment: 1 })).promise
    expect((one as Data).status).toBe('approved')

    const chosen = (await run(vs3(), hostOrder(), {
      status: status(orderRecord(VS3_ORDER_ID, { InstallmentCount: '2', OrderType: '2' })),
    }).promise) as Data
    expect([chosen.status, chosen.installment_count]).toStrictEqual(['approved', 2])
  })

  // addition: V8 1.15 is bound as 1.15
  it('binds a 1.15 TRY order to a record of 1.15', async () => {
    const res = (await run(vs3(), hostOrder({ amount: 1.15 }), {
      status: status(orderRecord(VS3_ORDER_ID, { FirstAmount: '1.15' })),
    }).promise) as Data
    expect([res.status, res.amount]).toStrictEqual(['approved', 1.15])
  })

  // addition: V8 nil or empty void amounts are no void
  it('accepts nil and empty cancel and refund amounts', async () => {
    const res = (await run(vs3(), hostOrder(), {
      status: status(orderRecord(VS3_ORDER_ID, { CancelAmount: { '@xsi:nil': 'true' }, DrawbackAmount: '' })),
    }).promise) as Data
    expect(res.status).toBe('approved')
  })

  it.each([
    ['HTTP 500', new Response('error', { status: 500 })],
    ['a 200 HTML page', new Response('<html lang="tr">Request Rejected</html>', { status: 200 })],
  ])('a status answered with %s is PosHttpError', async (_n, answer) => {
    const { sent, promise } = run(vs3(), hostOrder(), { status: () => answer })
    await expect(promise).rejects.toThrow(PosHttpError)
    expect(sent).toHaveLength(1)
  })

  // addition: V8 an empty status answer confirms nothing
  it('a status answered with HTTP 204 is OrderMismatchError order_status', async () => {
    const { sent, promise } = run(vs3(), hostOrder(), { status: () => new Response(null, { status: 204 }) })
    const err = await mismatch(promise)
    expect([err.field, err.paymentMayHaveCompleted]).toStrictEqual(['order_status', true])
    expect(sent).toHaveLength(1)
  })

  // addition: B5 a callback signed for another order is not this order's
  it('a callback signed for another order is OrderMismatchError order_id without a request', async () => {
    const { sent, promise } = run(vs3(), hostOrder({ id: 'OTHER1' }))
    const err = await mismatch(promise)
    expect([err.field, err.paymentMayHaveCompleted, err.response]).toStrictEqual(['order_id', false, undefined])
    expect(sent).toHaveLength(0)
  })

  it.each([
    ['an approval without HashData', vs3({ HashData: undefined }), NO_HASH],
    ['an altered HashData', vs3({ HashData: CB(VS3_ORDER_ID, '00', '6373642') }), HASH_MISMATCH],
    ['OrderId 0', vs3({ OrderId: '0' }), MALFORMED],
    ['no OrderId', vs3({ OrderId: undefined }), HASH_MISMATCH],
  ])('%s is refused without a request', async (_n, callback, error) => {
    const { sent, promise } = run(callback)
    await expect(promise).rejects.toThrow(error)
    expect(sent).toHaveLength(0)
  })

  it('a nested callback value is PosError without a request', async () => {
    const { sent, promise } = run({ ...vs3(), Amount: { a: '1' } })
    await expect(promise).rejects.toThrow('3D callback field "Amount" must be a string')
    expect(sent).toHaveLength(0)
  })

  // addition: B5 BP1/BP2, re-reads the pins cannot see are decided by the bank record
  it('BP1: a genuine approval of A001 re-read as order A is OrderMismatchError order_status after one request', async () => {
    const reRead = vs3({ MerchantOrderId: 'A', OrderId: '1005000', HashData: CB('A001', '00', '5000') })
    const { sent, promise } = run(reRead, hostOrder({ id: 'A' }), { status: () => answerXml(NON_RESULT) })
    const err = await mismatch(promise)
    expect([err.field, err.paymentMayHaveCompleted]).toStrictEqual(['order_status', true])
    expect(sent).toHaveLength(1)
    expect(sent[0]?.fields.MerchantOrderId).toBe('A')
  })

  it('BP2: a genuine decline of B100 re-read as an approval of B1 is OrderMismatchError order_status after one request', async () => {
    const reRead = vs3({ MerchantOrderId: 'B1', OrderId: '510', HashData: CB('B100', '51', '0') })
    const { sent, promise } = run(reRead, hostOrder({ id: 'B1' }), { status: () => answerXml(NON_RESULT) })
    const err = await mismatch(promise)
    expect(err.field).toBe('order_status')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.fields.MerchantOrderId).toBe('B1')
  })

  // addition: B4 signed declines are not confirmed
  it('maps a signed decline declined without a request', async () => {
    const callback = vs3({ ResponseCode: '05', ResponseMessage: 'error abcd', OrderId: '0' })
    const { sent, promise } = run(callback)
    const res = (await promise) as Data
    expect([res.status, res.proc_return_code, res.payment_model]).toStrictEqual(['declined', '05', '3d_host'])
    expect(sent).toHaveLength(0)
  })

  // addition: B8 an unsigned decline carries trusted data only; require_3d_hash rejects it
  it('maps an unsigned decline from the order only; require_3d_hash rejects it', async () => {
    const callback = vs3({ HashData: undefined, ResponseCode: '05', MerchantOrderId: 'X', OrderId: '77' })
    const { sent, promise } = run(callback)
    const res = (await promise) as Data
    expect([res.status, res.order_id, res.payment_model, res.remote_order_id ?? null, res.auth_code]).toStrictEqual([
      'declined',
      VS3_ORDER_ID,
      '3d_host',
      null,
      null,
    ])
    expect(res.requires_manual_review).toBeUndefined()
    expect(sent).toHaveLength(0)

    const strict = run(callback, hostOrder(), {}, { ...config, require_3d_hash: true })
    await expect(strict.promise).rejects.toThrow(NO_HASH)
    expect(strict.sent).toHaveLength(0)
  })

  // addition: ruling, a hashed password echoed by the browser or the bank never stays in the result
  it('replaces an echoed HashPassword in 3d_all and all', async () => {
    const res = (await run({ ...vs3(), HashPassword: HASH_PASSWORD }, hostOrder(), {
      status: status(orderRecord(VS3_ORDER_ID, { HashPassword: HASH_PASSWORD })),
    }).promise) as Data
    expect(res.status).toBe('approved')
    expect(JSON.stringify(res)).not.toContain(HASH_PASSWORD)
  })

  // addition: an amount the bank cannot be sent fails before the confirmation
  it.each([[0.004], [0], [-1], ['abc'], [1e13]])('order amount %j is PosError without a request', async (amount) => {
    const { sent, promise } = run(vs3(), hostOrder({ amount: amount as number }))
    await expect(promise).rejects.toThrow(PosError)
    expect(sent).toHaveLength(0)
  })

  // addition: concurrent confirmations on one gateway never share state
  it('two concurrent confirmations keep their own status requests and results', async () => {
    const other = 'B2024070199'
    const { sent, fetchImpl } = bankFetch({
      status: (f) =>
        answerXml(
          statusAnswer(
            orderRecord(String(f.MerchantOrderId), {
              FirstAmount: f.MerchantOrderId === other ? '20.02' : '10.01',
              ProvNumber: f.MerchantOrderId === other ? '111111' : '520366',
            }),
          ),
        ),
    })
    const p = realGateway(fetchImpl)
    const [a, b] = (await Promise.all([
      p.payment(MODEL.THREE_D_HOST, hostOrder(), TX_TYPE.PAY_AUTH, null, cb(vs3())),
      p.payment(
        MODEL.THREE_D_HOST,
        hostOrder({ id: other, amount: 20.02 }),
        TX_TYPE.PAY_AUTH,
        null,
        cb(vs3({ MerchantOrderId: other, OrderId: '6373642' })),
      ),
    ])) as [Data, Data]
    expect([a.status, a.order_id, a.amount, a.auth_code]).toStrictEqual(['approved', VS3_ORDER_ID, 10.01, '520366'])
    expect([b.status, b.order_id, b.amount, b.auth_code]).toStrictEqual(['approved', other, 20.02, '111111'])
    expect(sent.map((s) => s.fields.MerchantOrderId).sort()).toStrictEqual([VS3_ORDER_ID, other].sort())
  })
})

describe('VakifKatilimPos (end to end) 3D forms', () => {
  const formOrder: PosOrder = {
    id: '2020110828BC',
    amount: 10.01,
    currency: CURRENCY.TRY,
    installment: 0,
    success_url: 'https://example.com/success',
    fail_url: 'https://example.com/fail',
  }

  // addition: V3/V10 the host form is built locally, posts to gateway_3d_host and carries the hashed password
  it('builds the 3D Host form without a request', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    const form = await p.get3DFormData(formOrder, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true)
    expect(form).toStrictEqual({
      gateway: HOST_GATEWAY,
      method: 'POST',
      inputs: {
        UserName: 'APIUSER',
        HashPassword: 'h58bUB83xQz2/21SUeOemUgkF5U=',
        MerchantId: '1',
        MerchantOrderId: '2020110828BC',
        Amount: '1001',
        FECCurrencyCode: '0949',
        OkUrl: 'https://example.com/success',
        FailUrl: 'https://example.com/fail',
        PaymentType: '1',
      },
    })
    expect(sent).toHaveLength(0)
    await expect(
      p.get3DFormData(formOrder, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, false, FORM_FORMAT.HTML),
    ).rejects.toThrow(UnsupportedFormFormatError)
  })

  // addition: V10 the 3D Secure form is the bank's page after a signed enrollment request
  it('posts the signed card form to ThreeDModelPayGate and returns the page', async () => {
    const { sent, fetchImpl } = bankFetch({ form: '<html><body>3D</body></html>' })
    const p = realGateway(fetchImpl)
    const c = CreditCardFactory.createForGateway(p, '4155650100416111', '25', '1', '123', 'John Doe', CARD_TYPE.VISA)
    const html = await p.get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, c)
    expect(html).toBe('<html><body>3D</body></html>')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(`${PAYMENT_API}/ThreeDModelPayGate`)
    expect(sent[0]?.fields.Amount).toBe('1001')
    expect(sent[0]?.fields.HashPassword).toBe(HASH_PASSWORD)
    expect(sent[0]?.fields.HashData).toBe(
      RQ({
        MerchantId: '1',
        MerchantOrderId: '2020110828BC',
        Amount: '1001',
        OkUrl: 'https://example.com/success',
        FailUrl: 'https://example.com/fail',
        UserName: 'APIUSER',
      }),
    )
  })

  it.each([[''], ['   ']])('an empty bank page %j is PosError', async (page) => {
    const { fetchImpl } = bankFetch({ form: page })
    const p = realGateway(fetchImpl)
    const c = CreditCardFactory.createForGateway(p, '4155650100416111', '25', '1', '123', 'John Doe', CARD_TYPE.VISA)
    await expect(p.get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, c)).rejects.toThrow(
      new PosError('3D form data could not be created'),
    )
  })

  it.each([[0.004], [0], [-1], [1e13]])('amount %j is PosError before any request', async (amount) => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    await expect(
      p.get3DFormData({ ...formOrder, amount }, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true),
    ).rejects.toThrow(PosError)
    expect(sent).toHaveLength(0)
  })
})

describe('VakifKatilimPos (end to end) non-3D transactions and routes', () => {
  const reversal = (over: PosOrder = {}): PosOrder => ({
    id: '2023070849CD',
    remote_order_id: '4480',
    amount: 1.01,
    ...over,
  })

  it('a non-secure sale is approved and its echoed HashPassword replaced', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    const c = CreditCardFactory.createForGateway(p, '4155650100416111', '25', '1', '123', 'John Doe', CARD_TYPE.VISA)
    const res = (await p.payment(MODEL.NON_SECURE, { id: '660723214', amount: 1 }, TX_TYPE.PAY_AUTH, c)) as Data
    expect(sent[0]?.path).toBe('Non3DPayGate')
    expect(res.status).toBe('approved')
    expect(res.all.VPosMessage.HashPassword).toBe('***')
  })

  it('a non-secure pre-authorization posts PreAuthorizaten and its close PreAuthorizatenClose', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    const c = CreditCardFactory.createForGateway(p, '4155650100416111', '25', '1', '123', 'John Doe', CARD_TYPE.VISA)
    await p.payment(MODEL.NON_SECURE, { id: '660723214', amount: 1 }, TX_TYPE.PAY_PRE_AUTH, c)
    await p.payment(
      MODEL.NON_SECURE,
      { id: '660723214', remote_order_id: '4480', ip: '127.0.0.1' },
      TX_TYPE.PAY_POST_AUTH,
    )
    expect(sent.map((s) => s.path)).toStrictEqual(['PreAuthorizaten', 'PreAuthorizatenClose'])
  })

  // addition: ruling (final fix wave), a money-moving answer that does not say what happened is an unknown outcome
  type MoneyCall = [name: string, path: string, call: (p: VakifKatilimPos) => Promise<unknown>]
  const card = (p: VakifKatilimPos) =>
    CreditCardFactory.createForGateway(p, '4155650100416111', '25', '1', '123', 'John Doe', CARD_TYPE.VISA)
  const moneyCalls: MoneyCall[] = [
    ['sale', 'Non3DPayGate', (p) => p.payment(MODEL.NON_SECURE, { id: 'N1', amount: 1 }, TX_TYPE.PAY_AUTH, card(p))],
    [
      'pre-auth',
      'PreAuthorizaten',
      (p) => p.payment(MODEL.NON_SECURE, { id: 'N1', amount: 1 }, TX_TYPE.PAY_PRE_AUTH, card(p)),
    ],
    [
      'post-auth',
      'PreAuthorizatenClose',
      (p) => p.payment(MODEL.NON_SECURE, { id: 'N1', remote_order_id: '4480', ip: '127.0.0.1' }, TX_TYPE.PAY_POST_AUTH),
    ],
  ]
  const unclear: Array<[string, (f: Data) => Answer, string]> = [
    ['HTTP 204', () => new Response(null, { status: 204 }), NO_DATA],
    [
      'no ResponseCode',
      (f) => answerXml({ ...SALE_ANSWER, MerchantOrderId: f.MerchantOrderId, ResponseCode: undefined }),
      NO_CODE,
    ],
    ['a root that holds only text', () => TEXT_ROOT, NO_CODE],
  ]
  for (const [kind, path, call] of moneyCalls) {
    it.each(unclear)(
      `a ${kind} answered with %s is PosHttpError naming the request URL`,
      async (_n, answer, message) => {
        const { sent, fetchImpl } = bankFetch({ sale: (_p, f) => answer(f) })
        const err = await call(realGateway(fetchImpl)).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(PosHttpError)
        expect([(err as PosHttpError).message, (err as PosHttpError).url]).toStrictEqual([
          message,
          `${PAYMENT_API}/${path}`,
        ])
        expect(sent).toHaveLength(1)
      },
    )

    it(`a ${kind} answer with ResponseCode 00 twice is OrderMismatchError order_status, flagged`, async () => {
      const { fetchImpl } = bankFetch({
        sale: (_p, f) => answerXml({ ...SALE_ANSWER, MerchantOrderId: f.MerchantOrderId, ResponseCode: ['00', '00'] }),
      })
      const err = await mismatch(call(realGateway(fetchImpl)))
      expect([err.field, err.paymentMayHaveCompleted, err.response?.requires_manual_review]).toStrictEqual([
        'order_status',
        true,
        true,
      ])
      expect((err.response as Data).all.VPosMessage.HashPassword).toBe('***')
    })
  }

  // addition: a cancel moves no new money: its unclear answer stays a decline
  it('a cancel answered with HTTP 204 is declined', async () => {
    const { fetchImpl } = bankFetch({ reversal: () => new Response(null, { status: 204 }) })
    const res = (await realGateway(fetchImpl).cancel(reversal())) as Data
    expect(res.status).toBe('declined')
  })

  // addition: L3 a refund answer that carries no response code is an unknown outcome, never a decline
  it.each([
    ['HTTP 204', () => new Response(null, { status: 204 })],
    ['an empty root', () => answerXml({})],
    ['a root with namespaces only', () => answerXml({ ...NS })],
    [
      'no ResponseCode',
      () => {
        const { ResponseCode: _code, ...rest } = REFUND_ANSWER
        return answerXml(rest)
      },
    ],
    ['a nil ResponseCode', () => answerXml({ ...REFUND_ANSWER, ResponseCode: NIL })],
    ['a blank ResponseCode', () => answerXml({ ...REFUND_ANSWER, ResponseCode: '  ' })],
  ])('a refund of a sale or a pre-authorization answered with %s is PosHttpError', async (_n, answer) => {
    const { sent, fetchImpl } = bankFetch({ refund: answer })
    const logger = createLogger()
    const p = realGateway(fetchImpl, { logger })
    for (const order of [reversal(), reversal({ transaction_type: TX_TYPE.PAY_PRE_AUTH })]) {
      const err = await p.refund(order).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PosHttpError)
      expect([(err as PosHttpError).message, (err as PosHttpError).url]).toStrictEqual([
        'Bank answer carries no result; the outcome is unknown',
        PAYMENT_API,
      ])
    }
    expect(sent.map((s) => s.path)).toStrictEqual(['DrawBack', 'PreAuthorizationDrawBack'])
    expect(logger.error).toHaveBeenCalledWith('bank answer carries no result; the outcome is unknown', {
      tx_type: TX_TYPE.REFUND,
      gateway: 'VakifKatilimPos',
    })
  })

  // addition: L3 a refund declined with a response code is still a decline
  it('a refund declined with ResponseCode OrderDataNotFound is declined', async () => {
    const declined = pick(refundTestDataProvider, 'fail_order_not_found').responseData
    const { fetchImpl } = bankFetch({ refund: () => answerXml(declined) })
    const res = (await realGateway(fetchImpl).refund(reversal())) as Data
    expect([res.status, res.proc_return_code]).toStrictEqual(['declined', 'OrderDataNotFound'])
  })

  it('cancel and refund follow the order transaction type', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    await p.cancel(reversal())
    await p.cancel(reversal({ transaction_type: TX_TYPE.PAY_PRE_AUTH }))
    await p.refund(reversal())
    const refund = (await p.refund(reversal({ transaction_type: TX_TYPE.PAY_PRE_AUTH }))) as Data
    expect(sent.map((s) => s.path)).toStrictEqual([
      'SaleReversal',
      'PreAuthorizationReversal',
      'DrawBack',
      'PreAuthorizationDrawBack',
    ])
    expect(sent[0]?.fields.Amount).toBe('101')
    expect(sent[1]?.fields).not.toHaveProperty('Amount')
    expect(sent[2]?.fields).not.toHaveProperty('Amount')
    expect(refund.status).toBe('approved')
    expect(JSON.stringify(refund)).not.toContain(HASH_PASSWORD)
  })

  it('a post-auth reversal and a partial refund are refused without a request', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    await expect(p.cancel(reversal({ transaction_type: TX_TYPE.PAY_POST_AUTH }))).rejects.toThrow(PosError)
    await expect(p.refund(reversal({ amount: 0.5, order_amount: 1.01 }))).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    expect(sent).toHaveLength(0)
  })

  it('status posts SelectOrderByMerchantOrderId and order history SelectOrder without a provision number', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    const st = (await p.status({ id: VS3_ORDER_ID })) as Data
    const history = (await p.orderHistory({
      start_date: new Date('2024-07-01T00:00:00+03:00'),
      end_date: new Date('2024-07-02T00:00:00+03:00'),
    })) as Data
    expect(sent.map((s) => s.path)).toStrictEqual(['SelectOrderByMerchantOrderId', 'SelectOrder'])
    expect(st.status).toBe('approved')
    expect(sent[1]?.fields.ProvNumber ?? '').toBe('')
    expect(sent[1]?.fields.StartDate).toBe('2024-07-01')
    expect(history.trans_count).toBe(2)
  })
})

describe('VakifKatilimPos (end to end) masking', () => {
  // addition: B11 nothing secret reaches the logger
  it('never logs the password, the hashed password, the card number, the CVV or a hash', async () => {
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
      provision: (f) => answerXml(provisionFor(f, {}, { HashPassword: HASH_PASSWORD })),
    })
    const p = realGateway(fetchImpl, { logger })
    const c = CreditCardFactory.createForGateway(p, '4155650100416111', '25', '1', '123', 'John Doe', CARD_TYPE.VISA)
    const formOrder: PosOrder = { ...vs1Order({ id: '2020110828BC' }) }
    const tampered = vs1({ HashData: CB(VS1_ORDER_ID, '00', '6373035') })
    const tamperedHash = CB(VS1_ORDER_ID, '00', '6373034') // what the crypt computes for the tampered callback

    const hostForm = await p.get3DFormData(formOrder, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true)
    await p.get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, c)
    await p.payment(MODEL.THREE_D_SECURE, vs1Order(), TX_TYPE.PAY_AUTH, null, cb(vs1()))
    await p.payment(MODEL.THREE_D_SECURE, vs1Order(), TX_TYPE.PAY_AUTH, null, cb(tampered)).catch(() => undefined)
    await p.payment(
      MODEL.THREE_D_HOST,
      hostOrder(),
      TX_TYPE.PAY_AUTH,
      null,
      cb({ ...vs3(), HashPassword: HASH_PASSWORD }),
    )
    await p.payment(MODEL.NON_SECURE, { id: 'N1', amount: 1.01 }, TX_TYPE.PAY_AUTH, c)
    await p.status({ id: '2023070849CD' })
    await p.cancel({ id: 'R1', remote_order_id: '1', amount: 1 })
    await p.refund({ id: 'R1', remote_order_id: '1', amount: 1 })
    await p.orderHistory({ start_date: new Date('2024-07-01'), end_date: new Date('2024-07-02') })

    expect((hostForm as Data).inputs.HashPassword).toBe(HASH_PASSWORD)
    const logged = JSON.stringify(records)
    expect(records.length).toBeGreaterThan(0)
    expect(sent.length).toBe(8)
    expect(logged).not.toContain(PASSWORD)
    expect(logged).not.toContain(HASH_PASSWORD)
    expect(logged).not.toContain('4155650100416111')
    expect(logged).not.toMatch(/CardCVV2\\?"\s*:\s*\\?"?123/)
    expect(logged).not.toContain(tamperedHash)
    for (const s of sent) {
      if (typeof s.fields.HashData === 'string') expect(logged).not.toContain(s.fields.HashData)
    }
  })
})
