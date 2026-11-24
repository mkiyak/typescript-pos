import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PayFlexCPV4PosHttpClient } from '../../../src/client/PayFlexCPV4PosHttpClient.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { PayFlexCPV4PosCrypt } from '../../../src/crypt/PayFlexCPV4PosCrypt.js'
import { PayFlexCPV4PosRequestDataMapper } from '../../../src/data-mapper/request/mapper/PayFlexCPV4PosRequestDataMapper.js'
import type { RequestDataMapperInterface } from '../../../src/data-mapper/request/mapper/RequestDataMapperInterface.js'
import { PayFlexCPV4PosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/PayFlexCPV4PosRequestValueFormatter.js'
import { PayFlexCPV4PosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/PayFlexCPV4PosRequestValueMapper.js'
import { PayFlexCPV4PosResponseDataMapper } from '../../../src/data-mapper/response/mapper/PayFlexCPV4PosResponseDataMapper.js'
import type { ResponseDataMapperInterface } from '../../../src/data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { BasicResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { PayFlexCPV4PosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PayFlexCPV4PosResponseValueMapper.js'
import {
  OrderMismatchError,
  type OrderMismatchField,
  PosError,
  PosHttpError,
  UnsupportedFormFormatError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../src/factory/CreditCardFactory.js'
import type { GatewayConfig, GatewayDeps } from '../../../src/gateway/AbstractGateway.js'
import { PayFlexCPV4Pos } from '../../../src/gateway/PayFlexCPV4Pos.js'
import { noopLogger, type PosLogger } from '../../../src/logger.js'
import type { PayFlexPosAccount } from '../../../src/model/account/PayFlexPosAccount.js'
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

// Dependencies are replaced by vi.fn() fakes; the end-to-end section at the bottom uses the real mappers, crypt and
// HTTP client over a fake fetch.

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
type Data = Record<string, unknown>

const API_URL = 'https://inbound.apigatewaytest.vakifbank.com.tr:8443/commonPayment'

const config: GatewayConfig = {
  name: 'VakifBank-PayFlex-Common-Payment',
  class: 'PayFlexCPV4Pos',
  gateway_endpoints: { payment_api: API_URL },
}

const MERCHANT_ID = '000000000111111'
const PASSWORD = '3XTgER89as'

const account = AccountFactory.createPayFlexPosAccount('vakifbank-cp', MERCHANT_ID, PASSWORD, 'VP999999')

const defaultOrder: PosOrder = {
  id: 'order222',
  amount: 100.0,
  installment: 0,
  currency: CURRENCY.TRY,
  success_url: 'https://domain.com/success',
  fail_url: 'https://domain.com/fail_url',
  ip: '127.0.0.1',
}

const card = CreditCardFactory.create('5555444433332222', '2021', '12', '122', 'ahmet', CARD_TYPE.VISA)

/** Query answer for an approved Common Payment sale (transaction query, guide §6.5). */
const successAnswer: Data = {
  Rc: '0000',
  AuthCode: '735879',
  Rrn: '306822971283',
  Message: 'İŞLEM BAŞARILI',
  TransactionId: '3ee068d5b5a747ada65dafc0016d5887',
  PaymentToken: 'b35a56bf37334872a945afc0016d5887',
  MaskedPan: '49384601****4205',
  HostMerchantId: MERCHANT_ID,
  HostTerminalId: 'VP000579',
  AmountCode: '949',
  Amount: '1,01',
  TransactionType: 'Sale',
  OrderID: '2023030913ED',
  InstallmentCount: '',
  IsSecure: 'True',
  AllowNotEnrolledCard: 'True',
  SuccessUrl: 'http://localhost/vakifbank-cp/3d-host/response.php',
  FailUrl: 'http://localhost/vakifbank-cp/3d-host/response.php',
  RequestLanguage: 'tr-TR',
  Extract: null,
  CardHoldersName: 'Jo* Do*',
  CustomItems: null,
  ExpireMonth: '11',
  ExpireYear: '2024',
  BrandNumber: '100',
  HostDate: '20230309221037',
  HostRc: null,
  CampaignResult: { CampaignInfo: [] },
  ErrorCode: null,
  ResponseMessage: null,
}

const authFailCallback = {
  Rc: '2053',
  Message: 'VeRes status is E Message : Directory server communication error',
  PaymentToken: '68244b7e3dfd4b3ebea1afbe0185b9ed',
  TransactionId: '0cb6a57715144178a014afbe0185b9ed',
  MaskedPan: '49384601****4205',
}

type PayRow = {
  order: PosOrder
  txType: TxType
  request: Data
  paymentResponse: Data
  expected: Data
  isSuccess: boolean
}

// An earlier version of these rows passed txType "status"; deviation: tx type must be a payment type for binding.
const make3DPayPaymentRows: Array<[string, PayRow]> = [
  [
    'auth_fail',
    {
      order: {},
      txType: TX_TYPE.PAY_AUTH,
      request: authFailCallback,
      // deviation: R7 the query API decides even for failure callbacks, so the query is made and answers declined
      paymentResponse: authFailCallback,
      expected: {
        order_id: null,
        transaction_id: '0cb6a57715144178a014afbe0185b9ed',
        transaction_type: 'pay',
        status: 'declined',
        error_code: '2053',
        error_message: 'VeRes status is E Message : Directory server communication error',
      },
      isSuccess: false,
    },
  ],
  [
    'success',
    {
      // deviation: order binding needs the order and a real query answer; stateless API, result.status replaces
      // isSuccess(). The callback carries the ids the bank posts back (R7: without them nothing can be confirmed).
      order: { id: '2023030913ED', amount: 1.01, currency: CURRENCY.TRY },
      txType: TX_TYPE.PAY_AUTH,
      request: {
        SuccessUrl: 'http://localhost/vakifbank-cp/3d-host/response.php',
        FailUrl: 'http://localhost/vakifbank-cp/3d-host/response.php',
        RequestLanguage: 'tr-TR',
        Extract: null,
        CardHoldersName: 'Jo* Do*',
        TransactionId: '3ee068d5b5a747ada65dafc0016d5887',
        PaymentToken: 'b35a56bf37334872a945afc0016d5887',
      },
      paymentResponse: successAnswer,
      expected: {
        order_id: '2023030913ED',
        transaction_id: '3ee068d5b5a747ada65dafc0016d5887',
        transaction_type: 'pay',
        status: 'approved',
      },
      isSuccess: true,
    },
  ],
]

describe('PayFlexCPV4Pos (mocked collaborators)', () => {
  let requestValueMapper: PayFlexCPV4PosRequestValueMapper
  let requestMapper: Mocked<PayFlexCPV4PosRequestDataMapper>
  let responseMapper: Mocked<ResponseDataMapperInterface>
  let crypt: Mocked<CryptInterface>
  let httpClient: { supportsTx: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }
  let clientStrategy: { getClient: ReturnType<typeof vi.fn>; getAllClients: ReturnType<typeof vi.fn> }
  let requestDataPrepared: ReturnType<typeof vi.fn<(e: RequestDataPreparedEvent) => void>>
  let deps: GatewayDeps<PayFlexPosAccount>
  let pos: PayFlexCPV4Pos

  beforeEach(() => {
    requestValueMapper = new PayFlexCPV4PosRequestValueMapper()
    requestMapper = {
      isTestMode: vi.fn(),
      setTestMode: vi.fn(),
      create3DFormData: vi.fn(),
      create3DPaymentRequestData: vi.fn(),
      create3DPaymentStatusRequestData: vi.fn(),
      createNonSecurePaymentRequestData: vi.fn(),
      createNonSecurePostAuthPaymentRequestData: vi.fn(),
      createStatusRequestData: vi.fn(),
      createCancelRequestData: vi.fn(),
      createRefundRequestData: vi.fn(),
      createOrderHistoryRequestData: vi.fn(),
      create3DFormInitializeRequestData: vi.fn(),
    } as unknown as Mocked<PayFlexCPV4PosRequestDataMapper>
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
    const hooks: PosHooks = { onRequestDataPrepared: [requestDataPrepared] }
    deps = {
      requestValueMapper,
      requestValueFormatter: new PayFlexCPV4PosRequestValueFormatter(),
      requestDataMapper: requestMapper as unknown as RequestDataMapperInterface<PayFlexPosAccount>,
      responseDataMapper: responseMapper as unknown as ResponseDataMapperInterface,
      crypt: crypt as unknown as CryptInterface<PayFlexPosAccount>,
      clientStrategy: clientStrategy as unknown as HttpClientStrategy,
      logger: noopLogger,
      hooks,
    }
    pos = new PayFlexCPV4Pos(config, account, deps)
  })

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
      expect(event.gatewayClass).toBe('PayFlexCPV4Pos')
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
    expect(pos.getCurrencies()).toHaveLength(6)
    expect(pos.getAccount()).toBe(account)
    expect(pos.isTestMode()).toBe(false)
    expect(pos.getCrypt()).toBe(crypt)
  })

  // addition: identity and table
  it('exposes NAME, the gateway class identifier and the supported transactions', () => {
    expect(PayFlexCPV4Pos.NAME).toBe('PayFlex-Common-Payment-V4')
    expect(PayFlexCPV4Pos.GATEWAY_CLASS).toBe('PayFlexCPV4Pos')
    for (const tx of [TX_TYPE.PAY_AUTH, TX_TYPE.PAY_PRE_AUTH]) {
      expect(PayFlexCPV4Pos.isSupportedTransaction(tx, MODEL.THREE_D_PAY)).toBe(true)
      expect(PayFlexCPV4Pos.isSupportedTransaction(tx, MODEL.THREE_D_HOST)).toBe(true)
      expect(PayFlexCPV4Pos.isSupportedTransaction(tx, MODEL.THREE_D_SECURE)).toBe(false)
      expect(PayFlexCPV4Pos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(false)
    }
    expect(PayFlexCPV4Pos.isSupportedTransaction(TX_TYPE.STATUS, MODEL.NON_SECURE)).toBe(true)
    for (const tx of [
      TX_TYPE.PAY_POST_AUTH,
      TX_TYPE.CANCEL,
      TX_TYPE.REFUND,
      TX_TYPE.REFUND_PARTIAL,
      TX_TYPE.ORDER_HISTORY,
    ]) {
      expect(PayFlexCPV4Pos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(false)
    }
  })

  // addition: the query request builder is required
  it('rejects a request data mapper without create3DPaymentStatusRequestData', () => {
    const { create3DPaymentStatusRequestData: _omit, ...rest } = requestMapper
    expect(
      () =>
        new PayFlexCPV4Pos(config, account, {
          ...deps,
          requestDataMapper: rest as unknown as RequestDataMapperInterface<PayFlexPosAccount>,
        }),
    ).toThrow(PosError)
  })

  it('get3DFormData success', async () => {
    const enrollmentResponse = {
      CommonPaymentUrl: 'https://cptest.vakifbank.com.tr/CommonPayment/SecurePayment',
      PaymentToken: 'c5e076e7bf234a339c40afc10166c06d',
      ErrorCode: null,
      ResponseMessage: null,
    }
    const requestData = { 'request-data': 'request-data' }
    const order = defaultOrder
    requestMapper.create3DFormInitializeRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      requestData,
      enrollmentResponse,
      order,
      MODEL.THREE_D_PAY,
    )
    const formData = { gateway: 'g', method: 'GET', inputs: { Ptkn: 't' } }
    requestMapper.create3DFormData.mockResolvedValue(formData)

    const result = await pos.get3DFormData(order, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, card)

    expect(result).toBe(formData)
    expect(requestMapper.create3DFormInitializeRequestData).toHaveBeenCalledExactlyOnceWith(
      account,
      order,
      MODEL.THREE_D_PAY,
      TX_TYPE.PAY_AUTH,
      card,
    )
    expect(requestMapper.create3DFormData).toHaveBeenCalledExactlyOnceWith(
      account,
      null,
      MODEL.THREE_D_PAY,
      TX_TYPE.PAY_AUTH,
      '',
      null,
      enrollmentResponse,
    )
    verify()
  })

  it('get3DFormData enrollment fail', async () => {
    const requestData = { 'request-data': 'request-data' }
    const order = defaultOrder
    requestMapper.create3DFormInitializeRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      requestData,
      {
        CommonPaymentUrl: null,
        PaymentToken: null,
        ErrorCode: '5007',
        ResponseMessage: 'Güvenlik Numarası Hatalı',
      },
      order,
      MODEL.THREE_D_PAY,
    )

    const err = await pos.get3DFormData(order, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, card).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(PosError)
    expect((err as PosError).message).toBe('Güvenlik Numarası Hatalı')
    expect((err as PosError).cause).toStrictEqual({ code: '5007' })
    expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
    verify()
  })

  it.each([
    ['3d_pay_without_card', MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, false, false, PosError, null],
    [
      'unsupported_payment_model',
      MODEL.THREE_D_SECURE,
      TX_TYPE.PAY_AUTH,
      false,
      true,
      UnsupportedTransactionTypeError,
      null,
    ],
    [
      'unsupported_form_format',
      MODEL.THREE_D_PAY,
      TX_TYPE.PAY_AUTH,
      true,
      false,
      UnsupportedFormFormatError,
      FORM_FORMAT.HTML,
    ],
  ] as Array<[string, PaymentModel, TxType, boolean, boolean, new (...args: never[]) => Error, FormFormat | null]>)(
    'get3DFormData with bad inputs: %s',
    async (_name, paymentModel, txType, withCard, createWithoutCard, errorClass, formFormat) => {
      await expect(
        pos.get3DFormData(
          { id: '2020110828BC' },
          paymentModel,
          txType,
          withCard ? card : null,
          createWithoutCard,
          formFormat,
        ),
      ).rejects.toThrow(errorClass)
      expect(httpClient.request).not.toHaveBeenCalled()
    },
  )

  it('make3DPayment', async () => {
    await expect(pos.make3DPayment({ abc: 'abc' }, {}, TX_TYPE.PAY_AUTH)).rejects.toThrow(UnsupportedPaymentModelError)
  })

  describe.each([
    [MODEL.THREE_D_PAY, 'map3DPayResponseData'],
    [MODEL.THREE_D_HOST, 'map3DHostResponseData'],
  ] as Array<[PaymentModel, 'map3DPayResponseData' | 'map3DHostResponseData']>)(
    'payment with %s',
    (model, mapMethod) => {
      it.each(make3DPayPaymentRows)('%s', async (_name, row) => {
        const statusRequestData = { create3DPaymentStatusRequestData: 'create3DPaymentStatusRequestData' }
        requestMapper.create3DPaymentStatusRequestData.mockReturnValue(statusRequestData)
        const verify = configureClientResponse(
          TX_TYPE.INTERNAL_3D_PAYMENT_STATUS,
          statusRequestData,
          row.paymentResponse,
          row.order,
          MODEL.NON_SECURE,
        )
        responseMapper[mapMethod].mockReturnValue(row.expected)

        const result = await pos.payment(model, row.order, row.txType, null, row.request as GatewayResponseData)

        expect(result).toStrictEqual(row.expected)
        expect(result.status === 'approved').toBe(row.isSuccess)
        expect(requestMapper.create3DPaymentStatusRequestData).toHaveBeenCalledExactlyOnceWith(account, row.request)
        expect(responseMapper[mapMethod]).toHaveBeenCalledExactlyOnceWith(row.paymentResponse, row.txType, row.order)
        expect(crypt.check3DHash).not.toHaveBeenCalled()
        expect(responseMapper.extractMdStatus).not.toHaveBeenCalled()
        expect(responseMapper.is3dAuthSuccess).not.toHaveBeenCalled()
        verify()
      })
    },
  )

  it('makeRegularPayment', async () => {
    await expect(pos.makeRegularPayment(defaultOrder, card, TX_TYPE.PAY_AUTH)).rejects.toThrow(
      UnsupportedPaymentModelError,
    )
  })

  it('makeRegularPostAuthPayment', async () => {
    await expect(pos.payment(MODEL.NON_SECURE, {}, TX_TYPE.PAY_POST_AUTH)).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
  })

  // deviation: R10 the transaction query (guide §6.5) backs status()
  it('status request', async () => {
    const order = { transaction_id: 'abc' }
    const requestData = { status: 'request' }
    const decoded = { Rc: '0000' }
    requestMapper.createStatusRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(TX_TYPE.STATUS, requestData, decoded, order, MODEL.NON_SECURE)
    responseMapper.mapStatusResponse.mockReturnValue({ result: true })

    await expect(pos.status(order)).resolves.toStrictEqual({ result: true })

    expect(requestMapper.createStatusRequestData).toHaveBeenCalledExactlyOnceWith(account, order)
    expect(responseMapper.mapStatusResponse).toHaveBeenCalledExactlyOnceWith(decoded)
    verify()
  })

  it('cancel request', async () => {
    const err = await pos.cancel({}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnsupportedTransactionTypeError)
    expect((err as Error).message).toContain('PayFlexV4Pos')
  })

  it('refund request', async () => {
    const err = await pos.refund({}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnsupportedTransactionTypeError)
    expect((err as Error).message).toContain('PayFlexV4Pos')
  })

  it('orderHistory request', async () => {
    await expect(pos.orderHistory({})).rejects.toThrow(UnsupportedTransactionTypeError)
  })

  // addition: post authorization names the alternative too
  it('makeRegularPostPayment names the PayFlexV4Pos alternative', async () => {
    const err = await pos.makeRegularPostPayment({}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnsupportedTransactionTypeError)
    expect((err as Error).message).toContain('PayFlexV4Pos')
  })
})

// ---------- end to end: real mappers, crypt and HTTP client over a fake fetch ----------

type Sent = { url: string; body: string; contentType: string | null }

function recordingFetch(sent: Sent[], respond: (req: Sent) => string | Promise<string>): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    const req: Sent = {
      url: String(url),
      body: String(init?.body),
      contentType: new Headers(init?.headers).get('Content-Type'),
    }
    sent.push(req)
    return new Response(await respond(req))
  }) as unknown as typeof fetch
}

function realGateway(fetchImpl: typeof fetch, logger: PosLogger = noopLogger): PayFlexCPV4Pos {
  const crypt = new PayFlexCPV4PosCrypt(logger)
  const valueMapper = new PayFlexCPV4PosRequestValueMapper()
  const valueFormatter = new PayFlexCPV4PosRequestValueFormatter()
  const transport = new HttpTransport({ fetch: fetchImpl })
  const deps: GatewayDeps<PayFlexPosAccount> = {
    requestValueMapper: valueMapper,
    requestValueFormatter: valueFormatter,
    requestDataMapper: new PayFlexCPV4PosRequestDataMapper(valueMapper, valueFormatter, {}, crypt),
    responseDataMapper: new PayFlexCPV4PosResponseDataMapper(
      new BasicResponseValueFormatter(),
      new PayFlexCPV4PosResponseValueMapper(),
      logger,
    ),
    crypt,
    clientStrategy: new HttpClientStrategy([new PayFlexCPV4PosHttpClient(API_URL, transport, logger)]),
    logger,
    hooks: {},
  }
  return new PayFlexCPV4Pos(
    config,
    AccountFactory.createPayFlexPosAccount('vakifbank-cp', MERCHANT_ID, PASSWORD, 'VP999999'),
    deps,
  )
}

/** The order the success query answer belongs to. */
const boundOrder: PosOrder = {
  id: '2023030913ED',
  amount: 1.01,
  currency: CURRENCY.TRY,
  success_url: 'https://domain.com/success',
  fail_url: 'https://domain.com/fail_url',
  transaction_id: 'T1',
}

/** The same order without a stored `transaction_id` / `payment_token`: the callback ids are queried. */
const { transaction_id: _boundTransactionId, ...unboundOrder } = boundOrder

/** A forged callback: says approved and points at transaction T1. */
const forgedCallback: GatewayResponseData = { Rc: '0000', TransactionId: 'T1' }

/** JSON query answer: the approved sale of `boundOrder` (TransactionId T1) with overrides; undefined drops a key. */
const answer = (overrides: Data = {}): string => JSON.stringify({ ...successAnswer, TransactionId: 'T1', ...overrides })

const unexpectedNetwork = (): never => {
  throw new Error('no network call expected')
}

const jsonBody = (req: Sent): Data => JSON.parse(req.body) as Data

describe('PayFlexCPV4Pos (end to end)', () => {
  describe('payment completion asks the transaction query API', () => {
    it.each([[MODEL.THREE_D_HOST], [MODEL.THREE_D_PAY]] as Array<[PaymentModel]>)(
      'approves a %s payment only after the query confirms it for this order',
      async (model) => {
        const sent: Sent[] = []
        const pos = realGateway(recordingFetch(sent, () => answer()))

        const res = await pos.payment(model, boundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })

        expect(res.status).toBe('approved')
        expect(res.order_id).toBe('2023030913ED')
        expect(res.transaction_id).toBe('T1')
        expect(res.amount).toBe(1.01)
        expect(res.currency).toBe(CURRENCY.TRY)
        expect(res.payment_model).toBe(model)
        expect(res.requires_manual_review).toBeUndefined()
        expect(sent).toHaveLength(1)
        const [req] = sent as [Sent]
        expect(req.url).toBe(`${API_URL}/GetVposTransaction`)
        expect(req.contentType).toBe('application/json')
        expect(jsonBody(req)).toStrictEqual({
          HostMerchantId: MERCHANT_ID,
          MerchantId: '1',
          Password: PASSWORD,
          TransactionId: 'T1',
        })
      },
    )

    // addition: forged / replayed callback bound to another payment
    it.each([
      ['order_id', { OrderID: 'other-order' }],
      ['amount', { Amount: '1,00' }],
      ['currency', { AmountCode: '840' }],
      ['merchant_id', { HostMerchantId: '999' }],
      ['transaction_type', { TransactionType: 'Auth' }],
      ['transaction_id', { TransactionId: 'T2' }],
    ] as Array<[OrderMismatchField, Data]>)(
      'rejects an approved answer with a different %s',
      async (field, overrides) => {
        const pos = realGateway(recordingFetch([], () => answer(overrides)))

        const err = await pos
          .payment(MODEL.THREE_D_HOST, boundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })
          .catch((e: unknown) => e)

        expect(err).toBeInstanceOf(OrderMismatchError)
        const mismatch = err as OrderMismatchError
        expect(mismatch.field).toBe(field)
        expect(mismatch.paymentMayHaveCompleted).toBe(true)
        expect(mismatch.response?.requires_manual_review).toBe(true)
        expect(mismatch.response?.status).toBe('approved')
      },
    )

    // addition: a pre-authorization order is not satisfied by a sale (and the other way round)
    it('rejects a Sale answer for a pre-authorization order', async () => {
      const pos = realGateway(recordingFetch([], () => answer()))
      const err = await pos
        .payment(MODEL.THREE_D_PAY, boundOrder, TX_TYPE.PAY_PRE_AUTH, null, { ...forgedCallback })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(OrderMismatchError)
      expect((err as OrderMismatchError).field).toBe('transaction_type')
    })

    // addition: the order id is compared as a string; a missing order id never matches
    it('rejects an approved answer for an order without id', async () => {
      const pos = realGateway(recordingFetch([], () => answer()))
      const { id: _id, ...noId } = boundOrder
      const err = await pos
        .payment(MODEL.THREE_D_HOST, noId, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(OrderMismatchError)
      expect((err as OrderMismatchError).field).toBe('order_id')
    })

    // addition: OrderId (guide spelling) is read when OrderID is absent
    it('reads OrderId when OrderID is absent', async () => {
      const pos = realGateway(recordingFetch([], () => answer({ OrderID: undefined, OrderId: '2023030913ED' })))
      const res = await pos.payment(MODEL.THREE_D_HOST, boundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })
      expect(res.status).toBe('approved')
    })

    // addition: amount binding reads the raw answer amount strictly (never the lossy mapped float)
    it.each([['1,01'], ['1.01']])('accepts the answer amount %s for order amount 1.01', async (amount) => {
      const pos = realGateway(recordingFetch([], () => answer({ Amount: amount })))
      const res = await pos.payment(MODEL.THREE_D_HOST, boundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })
      expect(res.status).toBe('approved')
    })

    it('accepts a string order amount', async () => {
      const pos = realGateway(recordingFetch([], () => answer()))
      const order = { ...boundOrder, amount: '1.01' as unknown as number }
      const res = await pos.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })
      expect(res.status).toBe('approved')
    })

    it.each([
      ['1,0x', '1,0x'],
      ['1.234,56', '1.234,56'],
      ['1,00', '1,00'],
      ['empty', ''],
      ['missing', undefined],
    ])('rejects the answer amount %s', async (_name, amount) => {
      const pos = realGateway(recordingFetch([], () => answer({ Amount: amount })))
      const err = await pos
        .payment(MODEL.THREE_D_HOST, boundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(OrderMismatchError)
      expect((err as OrderMismatchError).field).toBe('amount')
      expect((err as OrderMismatchError).paymentMayHaveCompleted).toBe(true)
    })

    it('the mapped amount of a malformed answer would look numeric (why the raw value is bound)', async () => {
      const mapper = new PayFlexCPV4PosResponseDataMapper(
        new BasicResponseValueFormatter(),
        new PayFlexCPV4PosResponseValueMapper(),
      )
      const raw = JSON.parse(answer({ Amount: '1,0x' })) as Data
      expect(typeof mapper.map3DHostResponseData(raw, TX_TYPE.PAY_AUTH, boundOrder).amount).toBe('number')
    })

    it.each([
      ['an invalid order amount', { amount: 'abc' as unknown as number }],
      ['a missing order amount', { amount: undefined }],
    ])('rejects %s', async (_name, overrides) => {
      const pos = realGateway(recordingFetch([], () => answer()))
      const err = await pos
        .payment(MODEL.THREE_D_HOST, { ...boundOrder, ...overrides }, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(OrderMismatchError)
      expect((err as OrderMismatchError).field).toBe('amount')
    })

    // addition: currency code spelling and the TRY default
    it('reads CurrencyCode when AmountCode is absent', async () => {
      const pos = realGateway(recordingFetch([], () => answer({ AmountCode: undefined, CurrencyCode: '949' })))
      const res = await pos.payment(MODEL.THREE_D_HOST, boundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })
      expect(res.status).toBe('approved')
    })

    it('accepts an answer without currency code only for a TRY order', async () => {
      const pos = realGateway(recordingFetch([], () => answer({ AmountCode: undefined })))
      const res = await pos.payment(MODEL.THREE_D_HOST, boundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })
      expect(res.status).toBe('approved')

      const err = await pos
        .payment(MODEL.THREE_D_HOST, { ...boundOrder, currency: CURRENCY.USD }, TX_TYPE.PAY_AUTH, null, {
          ...forgedCallback,
        })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(OrderMismatchError)
      expect((err as OrderMismatchError).field).toBe('currency')
    })

    // addition: optional fields are only compared when present
    it('accepts an answer without HostMerchantId, TransactionType and TransactionId', async () => {
      const pos = realGateway(
        recordingFetch([], () =>
          answer({ HostMerchantId: undefined, TransactionType: undefined, TransactionId: undefined }),
        ),
      )
      const res = await pos.payment(MODEL.THREE_D_HOST, boundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })
      expect(res.status).toBe('approved')
    })

    // changed by the order id binding: an order with its own transaction_id is queried by that id, so this case
    // uses an order without stored ids
    it('queries by PaymentToken alone and skips the transaction id comparison', async () => {
      const sent: Sent[] = []
      const pos = realGateway(recordingFetch(sent, () => answer({ TransactionId: 'T9' })))
      const res = await pos.payment(MODEL.THREE_D_HOST, unboundOrder, TX_TYPE.PAY_AUTH, null, {
        Rc: '0000',
        PaymentToken: 'P1',
      })
      expect(res.status).toBe('approved')
      expect(jsonBody(sent[0] as Sent)).toStrictEqual({
        HostMerchantId: MERCHANT_ID,
        MerchantId: '1',
        Password: PASSWORD,
        PaymentToken: 'P1',
      })
    })

    // addition: callback approved, query not approved
    it.each([
      ['ErrorCode 5003', { ErrorCode: '5003', ResponseMessage: 'Islem bulunamadi.' }],
      ['Rc 0057', { Rc: '0057', Message: 'RED-KARTIN İŞLEM İZNİ YOK', TransactionId: 'T1' }],
      ['an empty answer', {}],
    ])('callback Rc 0000 but the query says %s: declined and flagged for review', async (_name, body) => {
      const pos = realGateway(recordingFetch([], () => JSON.stringify(body)))
      const res = await pos.payment(MODEL.THREE_D_HOST, boundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })
      expect(res.status).toBe('declined')
      expect(res.requires_manual_review).toBe(true)
    })

    it('callback Rc 2053 and the query says not approved: declined without review flag', async () => {
      const pos = realGateway(recordingFetch([], () => JSON.stringify(authFailCallback)))
      // order without stored ids: the callback TransactionId differs from boundOrder's T1
      const res = await pos.payment(MODEL.THREE_D_PAY, unboundOrder, TX_TYPE.PAY_AUTH, null, { ...authFailCallback })
      expect(res.status).toBe('declined')
      expect(res.error_code).toBe('2053')
      expect(res.requires_manual_review).toBeUndefined()
    })

    // addition: the browser leg is untrusted in both directions; the query wins
    it('callback Rc 2053 but the query approves this order: approved', async () => {
      const pos = realGateway(recordingFetch([], () => answer()))
      const res = await pos.payment(MODEL.THREE_D_HOST, boundOrder, TX_TYPE.PAY_AUTH, null, {
        Rc: '2053',
        Message: 'failed',
        TransactionId: 'T1',
      })
      expect(res.status).toBe('approved')
      expect(res.requires_manual_review).toBeUndefined()
    })

    // addition: nothing to confirm
    it.each([
      [MODEL.THREE_D_HOST, { Rc: '0000' }],
      [MODEL.THREE_D_PAY, { ResultCode: '0000', TransactionId: '', PaymentToken: '' }],
    ] as Array<[PaymentModel, GatewayResponseData]>)(
      '%s callback saying approved without TransactionId/PaymentToken: declined + review, no HTTP',
      async (model, cb) => {
        const fetchSpy = vi.fn(unexpectedNetwork)
        const pos = realGateway(fetchSpy as unknown as typeof fetch)
        // order without stored ids: an order with a transaction_id is queried by it (see the binding tests below)
        const res = await pos.payment(model, unboundOrder, TX_TYPE.PAY_AUTH, null, cb)
        expect(res.status).toBe('declined')
        expect(res.requires_manual_review).toBe(true)
        expect(res.payment_model).toBe(model)
        expect(fetchSpy).not.toHaveBeenCalled()
      },
    )

    it('callback with a failure code and no ids: declined without review flag, no HTTP', async () => {
      const fetchSpy = vi.fn(unexpectedNetwork)
      const pos = realGateway(fetchSpy as unknown as typeof fetch)
      const res = await pos.payment(MODEL.THREE_D_HOST, unboundOrder, TX_TYPE.PAY_AUTH, null, { Rc: '2053' })
      expect(res.status).toBe('declined')
      expect(res.requires_manual_review).toBeUndefined()
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('rejects a non-payment transaction type before any HTTP', async () => {
      const fetchSpy = vi.fn(unexpectedNetwork)
      const pos = realGateway(fetchSpy as unknown as typeof fetch)
      await expect(pos.make3DHostPayment({ ...forgedCallback }, boundOrder, TX_TYPE.STATUS)).rejects.toThrow(
        UnsupportedTransactionTypeError,
      )
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    // addition: an HTML / WAF page never approves
    it('fails with PosHttpError when the query answers an HTML page', async () => {
      const pos = realGateway(
        recordingFetch([], () => '<!DOCTYPE html><html><body>The requested URL was rejected</body></html>'),
      )
      await expect(
        pos.payment(MODEL.THREE_D_HOST, boundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback }),
      ).rejects.toThrow(PosHttpError)
    })

    // addition: XML query answers are bound the same way
    it('binds an XML query answer', async () => {
      const xml =
        '<VposQueryResponse><Rc>0000</Rc><AuthCode>735879</AuthCode><TransactionId>T1</TransactionId>' +
        `<HostMerchantId>${MERCHANT_ID}</HostMerchantId><AmountCode>949</AmountCode><Amount>1,01</Amount>` +
        '<TransactionType>Sale</TransactionType><OrderID>2023030913ED</OrderID><HostDate>20230309221037</HostDate>' +
        '</VposQueryResponse>'
      const pos = realGateway(recordingFetch([], () => xml))
      const res = await pos.payment(MODEL.THREE_D_HOST, boundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })
      expect(res.status).toBe('approved')

      const other = realGateway(recordingFetch([], () => xml.replace('2023030913ED', 'other')))
      await expect(
        other.payment(MODEL.THREE_D_HOST, boundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback }),
      ).rejects.toThrow(OrderMismatchError)
    })

    // addition: concurrent completions on one instance
    it('resolves concurrent completions on one instance to their own answers', async () => {
      const pos = realGateway(
        recordingFetch([], async (req) => {
          const id = jsonBody(req).TransactionId
          if (id === 'T1') await new Promise((r) => setTimeout(r, 20))
          return answer({ TransactionId: id, OrderID: id === 'T1' ? 'o1' : 'o2' })
        }),
      )
      const [r1, r2] = await Promise.all([
        pos.make3DHostPayment(
          { Rc: '0000', TransactionId: 'T1' },
          { ...boundOrder, id: 'o1', transaction_id: 'T1' },
          TX_TYPE.PAY_AUTH,
        ),
        pos.make3DHostPayment(
          { Rc: '0000', TransactionId: 'T2' },
          { ...boundOrder, id: 'o2', transaction_id: 'T2' },
          TX_TYPE.PAY_AUTH,
        ),
      ])
      expect([r1.order_id, r1.transaction_id]).toStrictEqual(['o1', 'T1'])
      expect([r2.order_id, r2.transaction_id]).toStrictEqual(['o2', 'T2'])
    })
  })

  // addition: the order's own transaction id / payment token decide what is queried (replay protection)
  describe('binding to the order transaction id and payment token', () => {
    it('rejects a callback whose TransactionId contradicts the order before any HTTP', async () => {
      const fetchSpy = vi.fn(unexpectedNetwork)
      const pos = realGateway(fetchSpy as unknown as typeof fetch)
      const err = await pos
        .payment(MODEL.THREE_D_HOST, { ...boundOrder, transaction_id: 'T_new' }, TX_TYPE.PAY_AUTH, null, {
          Rc: '0000',
          TransactionId: 'T_old',
        })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(OrderMismatchError)
      const mismatch = err as OrderMismatchError
      expect(mismatch.field).toBe('transaction_id')
      expect(mismatch.expected).toBe('T_new')
      expect(mismatch.actual).toBe('T_old')
      expect(mismatch.paymentMayHaveCompleted).toBe(false)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('rejects a callback whose PaymentToken contradicts the order before any HTTP', async () => {
      const fetchSpy = vi.fn(unexpectedNetwork)
      const pos = realGateway(fetchSpy as unknown as typeof fetch)
      const err = await pos
        .payment(MODEL.THREE_D_PAY, { ...unboundOrder, payment_token: 'P_new' }, TX_TYPE.PAY_AUTH, null, {
          Rc: '0000',
          PaymentToken: 'P_old',
        })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(OrderMismatchError)
      const mismatch = err as OrderMismatchError
      expect(mismatch.field).toBe('transaction_id')
      expect(mismatch.expected).toBe('P_new')
      expect(mismatch.actual).toBe('P_old')
      expect(mismatch.paymentMayHaveCompleted).toBe(false)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it.each([
      ['no ids', {}],
      ['only a result code', { Rc: '0000' }],
    ] as Array<[string, GatewayResponseData]>)(
      'queries the order transaction_id when the callback carries %s and approves when bound',
      async (_name, cb) => {
        const sent: Sent[] = []
        const pos = realGateway(recordingFetch(sent, () => answer()))
        // make3DHostPayment directly: payment() rejects an empty callback before the gateway sees it
        const res = await pos.make3DHostPayment(cb, boundOrder, TX_TYPE.PAY_AUTH)
        expect(res.status).toBe('approved')
        expect(res.transaction_id).toBe('T1')
        expect(sent).toHaveLength(1)
        expect(jsonBody(sent[0] as Sent)).toStrictEqual({
          HostMerchantId: MERCHANT_ID,
          MerchantId: '1',
          Password: PASSWORD,
          TransactionId: 'T1',
        })
      },
    )

    it('queries only the order ids, never extra callback ids', async () => {
      const sent: Sent[] = []
      const pos = realGateway(recordingFetch(sent, () => answer()))
      const res = await pos.payment(MODEL.THREE_D_HOST, boundOrder, TX_TYPE.PAY_AUTH, null, {
        Rc: '0000',
        TransactionId: 'T1',
        PaymentToken: 'P_from_browser',
      })
      expect(res.status).toBe('approved')
      expect(jsonBody(sent[0] as Sent)).toStrictEqual({
        HostMerchantId: MERCHANT_ID,
        MerchantId: '1',
        Password: PASSWORD,
        TransactionId: 'T1',
      })
    })

    it('rejects an approved answer whose TransactionId differs from the order transaction_id', async () => {
      const pos = realGateway(recordingFetch([], () => answer({ TransactionId: 'T_old' })))
      const err = await pos.make3DHostPayment({}, boundOrder, TX_TYPE.PAY_AUTH).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(OrderMismatchError)
      const mismatch = err as OrderMismatchError
      expect(mismatch.field).toBe('transaction_id')
      expect(mismatch.expected).toBe('T1')
      expect(mismatch.actual).toBe('T_old')
      expect(mismatch.paymentMayHaveCompleted).toBe(true)
    })

    it('queries the order payment_token and binds the answer PaymentToken', async () => {
      const sent: Sent[] = []
      const order = { ...unboundOrder, payment_token: 'P1' }
      const pos = realGateway(recordingFetch(sent, () => answer({ PaymentToken: 'P1' })))
      const res = await pos.payment(MODEL.THREE_D_PAY, order, TX_TYPE.PAY_AUTH, null, { Rc: '0000' })
      expect(res.status).toBe('approved')
      expect(jsonBody(sent[0] as Sent)).toStrictEqual({
        HostMerchantId: MERCHANT_ID,
        MerchantId: '1',
        Password: PASSWORD,
        PaymentToken: 'P1',
      })

      const other = realGateway(recordingFetch([], () => answer({ PaymentToken: 'P_old' })))
      const err = await other
        .payment(MODEL.THREE_D_PAY, order, TX_TYPE.PAY_AUTH, null, { Rc: '0000' })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(OrderMismatchError)
      expect((err as OrderMismatchError).field).toBe('transaction_id')
      expect((err as OrderMismatchError).paymentMayHaveCompleted).toBe(true)
    })

    it('keeps querying the callback ids for an order without stored ids', async () => {
      const sent: Sent[] = []
      const pos = realGateway(recordingFetch(sent, () => answer()))
      const res = await pos.payment(MODEL.THREE_D_HOST, unboundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })
      expect(res.status).toBe('approved')
      expect(jsonBody(sent[0] as Sent).TransactionId).toBe('T1')

      const err = await realGateway(recordingFetch([], () => answer({ TransactionId: 'T2' })))
        .payment(MODEL.THREE_D_HOST, unboundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })
        .catch((e: unknown) => e)
      expect((err as OrderMismatchError).field).toBe('transaction_id')
    })
  })

  // addition: a callback without ids is reported as declined with nothing taken from the browser data
  describe('callback without ids for an order without stored ids', () => {
    it.each([
      ['a plain approved code', { Rc: '0000', AuthCode: '735879', OrderID: '2023030913ED', Amount: '1,01' }],
      ['junk fields', { Rc: '0000', Amount: { x: '1' }, HostDate: 'junk' }],
    ] as Array<[string, GatewayResponseData]>)('%s: declined, no approved-only fields, no HTTP', async (_name, cb) => {
      const fetchSpy = vi.fn(unexpectedNetwork)
      const pos = realGateway(fetchSpy as unknown as typeof fetch)
      const res = await pos.payment(MODEL.THREE_D_HOST, unboundOrder, TX_TYPE.PAY_AUTH, null, cb)
      expect(res.status).toBe('declined')
      expect(res.proc_return_code).toBeNull()
      expect(res.error_code).toBeNull()
      expect(res.error_message).toBe(
        'Callback carries no TransactionId or PaymentToken; the result cannot be confirmed with the bank.',
      )
      expect(res.auth_code).toBeNull()
      expect(res.order_id).toBeNull()
      expect(res.amount).toBeNull()
      expect(res.transaction_time).toBeNull()
      expect(res.requires_manual_review).toBe(true)
      expect(res.all).toStrictEqual(cb)
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  // addition: a cosmetic answer field never aborts or approves a payment by itself
  describe('malformed answer fields', () => {
    it('approves with transaction_time null when HostDate has an unknown format', async () => {
      const pos = realGateway(recordingFetch([], () => answer({ HostDate: '2026/02/24 10:15' })))
      const res = await pos.payment(MODEL.THREE_D_HOST, boundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })
      expect(res.status).toBe('approved')
      expect(res.transaction_time).toBeNull()
    })

    it('rejects an object Amount with OrderMismatchError, never a TypeError', async () => {
      const pos = realGateway(recordingFetch([], () => answer({ Amount: {} })))
      const err = await pos
        .payment(MODEL.THREE_D_HOST, boundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(OrderMismatchError)
      expect((err as OrderMismatchError).field).toBe('amount')
      expect((err as OrderMismatchError).paymentMayHaveCompleted).toBe(true)
    })
  })

  // addition: "callback said approved" reads RC / Rc / ResultCode, first non-empty value
  describe('callback result code spellings', () => {
    it.each([
      ['RC', { RC: '0000', TransactionId: 'T1' }],
      ['ResultCode behind an empty Rc', { Rc: '', ResultCode: '0000', TransactionId: 'T1' }],
    ] as Array<[string, GatewayResponseData]>)('%s 0000 + declined query: flagged for review', async (_name, cb) => {
      const pos = realGateway(recordingFetch([], () => JSON.stringify({ ErrorCode: '5003', ResponseMessage: 'x' })))
      const res = await pos.payment(MODEL.THREE_D_HOST, boundOrder, TX_TYPE.PAY_AUTH, null, cb)
      expect(res.status).toBe('declined')
      expect(res.requires_manual_review).toBe(true)
    })
  })

  // addition: the amount is compared in the cents actually sent to the bank
  it('accepts answer 100,01 for order amount 100.005 (sent as 100.01)', async () => {
    const pos = realGateway(recordingFetch([], () => answer({ Amount: '100,01' })))
    const res = await pos.payment(MODEL.THREE_D_HOST, { ...boundOrder, amount: 100.005 }, TX_TYPE.PAY_AUTH, null, {
      ...forgedCallback,
    })
    expect(res.status).toBe('approved')
  })

  describe('registration (get3DFormData)', () => {
    const registered = (body: Data): Promise<unknown> =>
      realGateway(recordingFetch([], () => JSON.stringify(body)))
        .get3DFormData(boundOrder, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)
        .catch((e: unknown) => e)

    it('posts the registration and returns the GET redirect form', async () => {
      const sent: Sent[] = []
      const pos = realGateway(
        recordingFetch(sent, () =>
          JSON.stringify({
            PaymentToken: 'tok',
            CommonPaymentUrl: 'https://cptest.vakifbank.com.tr/CommonPayment/SecurePayment',
          }),
        ),
      )

      const form = await pos.get3DFormData(boundOrder, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, card)

      expect(form).toStrictEqual({
        gateway: 'https://cptest.vakifbank.com.tr/CommonPayment/SecurePayment',
        method: 'GET',
        inputs: { Ptkn: 'tok' },
      })
      const [req] = sent as [Sent]
      expect(req.url).toBe(`${API_URL}/CreateToken`)
      expect(req.contentType).toBe('application/x-www-form-urlencoded')
      const params = new URLSearchParams(req.body)
      expect(params.get('OrderId')).toBe('2023030913ED')
      expect(params.get('TransactionId')).toBe('T1')
      expect(params.get('Amount')).toBe('1.01')
      expect(params.has('HashedData')).toBe(false)
    })

    it('accepts ErrorCode 0000 with a token and an https URL', async () => {
      await expect(
        registered({ ErrorCode: '0000', PaymentToken: 'tok', CommonPaymentUrl: 'https://x.example/pay' }),
      ).resolves.toStrictEqual({ gateway: 'https://x.example/pay', method: 'GET', inputs: { Ptkn: 'tok' } })
    })

    it('accepts StatusCode 0 with a token and an https URL', async () => {
      await expect(
        registered({ StatusCode: 0, PaymentToken: 'tok', CommonPaymentUrl: 'https://x.example/pay' }),
      ).resolves.toMatchObject({ inputs: { Ptkn: 'tok' } })
    })

    it('accepts an XML registration answer', async () => {
      const pos = realGateway(
        recordingFetch(
          [],
          () =>
            '<RegisterResponse xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><CommonPaymentUrl>https://x.example/pay</CommonPaymentUrl>' +
            '<PaymentToken>tok</PaymentToken></RegisterResponse>',
        ),
      )
      await expect(pos.get3DFormData(boundOrder, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)).resolves.toMatchObject({
        inputs: { Ptkn: 'tok' },
      })
    })

    it.each([
      [
        'StatusCode 1',
        { StatusCode: 1, StatusDescription: 'Hata', PaymentToken: 'tok', CommonPaymentUrl: 'https://x' },
        'Hata',
      ],
      ['an http URL', { PaymentToken: 'tok', CommonPaymentUrl: 'http://x' }, null],
      ['an invalid URL', { PaymentToken: 'tok', CommonPaymentUrl: 'not a url' }, null],
      ['an empty PaymentToken', { PaymentToken: '', CommonPaymentUrl: 'https://x' }, null],
      ['a missing CommonPaymentUrl', { PaymentToken: 'tok' }, null],
      [
        'ErrorCode 5007',
        { ErrorCode: '5007', ResponseMessage: 'Güvenlik Numarası Hatalı' },
        'Güvenlik Numarası Hatalı',
      ],
      ['ErrorCode with a token', { ErrorCode: '5002', PaymentToken: 'tok', CommonPaymentUrl: 'https://x' }, null],
      ['an ErrorMessage', { ErrorCode: '9999', ErrorMessage: 'Bad' }, 'Bad'],
      ['an empty answer', {}, 'Common payment registration failed'],
    ] as Array<[string, Data, string | null]>)(
      'rejects a registration answer with %s',
      async (_name, body, message) => {
        const err = await registered(body)
        expect(err).toBeInstanceOf(PosError)
        expect((err as Error).constructor).not.toBe(Error)
        if (message !== null) expect((err as Error).message).toBe(message)
      },
    )

    it('fails with PosHttpError on an HTML registration answer', async () => {
      const pos = realGateway(recordingFetch([], () => '<html><body>blocked</body></html>'))
      await expect(pos.get3DFormData(boundOrder, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)).rejects.toThrow(PosHttpError)
    })
  })

  // addition: status() posts the query by transaction id
  it('status queries GetVposTransaction by transaction_id', async () => {
    const sent: Sent[] = []
    const pos = realGateway(recordingFetch(sent, () => answer()))
    const res = await pos.status({ transaction_id: 'T1' })
    expect(res.status).toBe('approved')
    expect(res.order_id).toBe('2023030913ED')
    const [req] = sent as [Sent]
    expect(req.url).toBe(`${API_URL}/GetVposTransaction`)
    expect(jsonBody(req)).toStrictEqual({
      HostMerchantId: MERCHANT_ID,
      MerchantId: '1',
      Password: PASSWORD,
      TransactionId: 'T1',
    })
  })

  // addition: nothing sensitive reaches the logger
  it('never logs the card number, CVV or password', async () => {
    const logged: unknown[] = []
    const capture = (level: string) => (msg: string, ctx?: unknown) => logged.push([level, msg, ctx])
    const logger: PosLogger = {
      debug: capture('debug'),
      info: capture('info'),
      warn: capture('warn'),
      error: capture('error'),
    }
    const responses = [
      JSON.stringify({ PaymentToken: 'tok', CommonPaymentUrl: 'https://x.example/pay' }),
      answer(),
      JSON.stringify({ ErrorCode: '5007', ResponseMessage: 'Güvenlik Numarası Hatalı' }),
      answer({ OrderID: 'other' }),
    ]
    const pos = realGateway(
      recordingFetch([], () => responses.shift() ?? ''),
      logger,
    )

    await pos.get3DFormData(boundOrder, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, card)
    await pos.payment(MODEL.THREE_D_PAY, boundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback })
    await expect(pos.get3DFormData(boundOrder, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, card)).rejects.toThrow(PosError)
    await expect(
      pos.payment(MODEL.THREE_D_PAY, boundOrder, TX_TYPE.PAY_AUTH, null, { ...forgedCallback }),
    ).rejects.toThrow(OrderMismatchError)

    expect(logged.length).toBeGreaterThan(0)
    const serialized = JSON.stringify(logged)
    expect(serialized).not.toContain('5555444433332222')
    expect(serialized).not.toContain('122')
    expect(serialized).not.toContain(PASSWORD)
  })
})
