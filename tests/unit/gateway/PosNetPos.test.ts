import { createHash } from 'node:crypto'
import iconv from 'iconv-lite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PosNetPosHttpClient } from '../../../src/client/PosNetPosHttpClient.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { PosNetPosCrypt } from '../../../src/crypt/PosNetPosCrypt.js'
import { PosNetPosRequestDataMapper } from '../../../src/data-mapper/request/mapper/PosNetPosRequestDataMapper.js'
import type { RequestDataMapperInterface } from '../../../src/data-mapper/request/mapper/RequestDataMapperInterface.js'
import { PosNetPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/PosNetPosRequestValueFormatter.js'
import { PosNetPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/PosNetPosRequestValueMapper.js'
import { PosNetPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/PosNetPosResponseDataMapper.js'
import type { ResponseDataMapperInterface } from '../../../src/data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { PosNetPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/PosNetPosResponseValueFormatter.js'
import { PosNetPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PosNetPosResponseValueMapper.js'
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
import type { GatewayConfig, GatewayDeps } from '../../../src/gateway/AbstractGateway.js'
import { PosNetPos } from '../../../src/gateway/PosNetPos.js'
import { noopLogger, type PosLogger } from '../../../src/logger.js'
import type { PosNetPosAccount } from '../../../src/model/account/PosNetPosAccount.js'
import {
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

// Dependencies are replaced by vi.fn() fakes except the request value mapper and formatter (the binding to the
// bank-resolved data uses them); the end-to-end section at the bottom uses the real mappers, crypt and HTTP client
// over a fake fetch that speaks the bank's raw `xmldata=` ISO-8859-9 protocol.

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

const PAYMENT_API = 'https://setmpos.ykb.com/PosnetWebService/XML'
const GATEWAY_3D = 'https://setmpos.ykb.com/3DSWebService/YKBPaymentService'

const config: GatewayConfig = {
  name: 'Yapıkredi',
  class: 'PosNetPos',
  gateway_endpoints: { payment_api: PAYMENT_API, gateway_3d: GATEWAY_3D },
}

/** `disable_3d_hash_check` is not an option; passing it must have no effect. */
const configWithHashCheckDisabled = {
  ...config,
  gateway_configs: { disable_3d_hash_check: true },
} as unknown as GatewayConfig

const ENC_KEY = '10,10,10,10,10,10,10,10'

const createAccount = (): PosNetPosAccount =>
  AccountFactory.createPosNetPosAccount('yapikredi', '6706598320', '67005551', '27426', ENC_KEY)

const createLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })

/** The three opaque hex packets the bank posts to the merchant return URL. */
const packets: Record<string, string> = {
  MerchantPacket: 'E1D0C0FB6EC5203A748124F309998F61E1D0C0FB6EC5203A748124F309998F61E1D0C0FB6EC5203A748124F30',
  BankPacket: 'F61E1D0C0FB6EC5203A748124F309998F61E1D0C0FB6EC5203A748124F30',
  Sign: '9998F61E1D0C0FB6EC5203A748124F30',
}

const DATA1 =
  'AEFE78BFC852867FF57078B723E284D1BD52EED8264C6CBD110A1A9EA5EAA7533D1A82EFD614032D686C507738FDCDD2EDD00B22DEFEFE0795DC4674C16C02EBBFEC9DF0F495D5E23BE487A798BF8293C7C1D517D9600C96CBFD8816C9D8F8257442906CB9B10D8F1AABFBBD24AA6FB0E5533CDE67B0D9EA5ED621B91BF6991D5362182302B781241B56E47BAE1E86BC3D5AE7606212126A4E97AFC2'
const DATA2 = '69D04861340091B7014B15158CA3C83413031B406F08B3792A0114C9958E6F0F216966C5EE32EAEEC7158BFF59DFCB77E20CD625'
const SIGN = '9998F61E1D0C0FB6EC5203A748124F30'

const oosRequestDataResponse = { data1: DATA1, data2: DATA2, sign: SIGN }

/** The bank's resolve answer of a successful 3D authentication (MAC over the fixture order of the bank docs). */
const success1Resolve: Data = {
  approved: '1',
  respCode: '',
  respText: '',
  oosResolveMerchantDataResponse: {
    xid: 'YKB_0000080603153823',
    amount: '5696',
    currency: 'TL',
    installment: '00',
    point: '0',
    pointAmount: '0',
    txStatus: 'Y',
    mdStatus: '1',
    mdErrorMessage: '',
    mac: 'y0fU6rRA0OvqJ5GN6uMdHVu6Xra7QR1qeT9rN7R1L+o=',
  },
}

async function expectRejection(
  promise: Promise<unknown>,
  errorClass: new (...args: never[]) => Error,
  message?: string,
): Promise<Error> {
  const err = await promise.then(
    () => {
      throw new Error('expected a rejection')
    },
    (e: unknown) => e as Error,
  )
  expect(err).toBeInstanceOf(errorClass)
  if (message !== undefined) {
    expect(err.message).toBe(message)
  }
  return err
}

describe('PosNetPos (mocked collaborators)', () => {
  const account = createAccount()
  let requestValueMapper: PosNetPosRequestValueMapper
  let requestMapper: Mocked<RequestDataMapperInterface> & {
    create3DResolveMerchantRequestData: ReturnType<typeof vi.fn>
  }
  let responseMapper: Mocked<ResponseDataMapperInterface>
  let crypt: Mocked<CryptInterface>
  let httpClient: { supportsTx: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }
  let clientStrategy: { getClient: ReturnType<typeof vi.fn>; getAllClients: ReturnType<typeof vi.fn> }
  let requestDataPrepared: ReturnType<typeof vi.fn<(e: RequestDataPreparedEvent) => void>>
  let logger: ReturnType<typeof createLogger>
  let pos: PosNetPos

  const deps = (): GatewayDeps<PosNetPosAccount> => ({
    requestValueMapper,
    requestValueFormatter: new PosNetPosRequestValueFormatter(),
    requestDataMapper: requestMapper as unknown as RequestDataMapperInterface<PosNetPosAccount>,
    responseDataMapper: responseMapper as unknown as ResponseDataMapperInterface,
    crypt: crypt as unknown as CryptInterface<PosNetPosAccount>,
    clientStrategy: clientStrategy as unknown as HttpClientStrategy,
    logger,
    hooks: { onRequestDataPrepared: [requestDataPrepared] } satisfies PosHooks,
  })

  const createGateway = (cfg: GatewayConfig): PosNetPos => new PosNetPos(cfg, account, deps())

  beforeEach(() => {
    requestValueMapper = new PosNetPosRequestValueMapper()
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
      create3DResolveMerchantRequestData: vi.fn(),
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

  const card = () => CreditCardFactory.createForGateway(pos, '5555444433332222', '21', '12', '122', 'ahmet')

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
      expect(event.gatewayClass).toBe('PosNetPos')
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

  /** The resolve and the provision request, each through its own hook dispatch. */
  const configureTwoRequests = (
    txType: TxType,
    order: PosOrder,
    resolveRequest: Data,
    resolveResponse: Data,
    tranRequest: Data,
    tranResponse: Data,
  ): (() => void) => {
    const paymentModel = MODEL.THREE_D_SECURE
    clientStrategy.getClient.mockReturnValue(httpClient as unknown as AbstractHttpClient)
    httpClient.request.mockImplementation(async (_tx: TxType, _model: PaymentModel, data: Data) => {
      if (data['test-update-request-data-with-event1'] === true) return resolveResponse
      if (data['test-update-request-data-with-event2'] === true) return tranResponse
      throw new Error('unexpected request data')
    })
    let dispatchCount = 0
    requestDataPrepared.mockImplementation((event) => {
      dispatchCount++
      expect(event.gatewayClass).toBe('PosNetPos')
      expect(event.txType).toBe(txType)
      expect(event.order).toStrictEqual(order)
      expect(event.paymentModel).toBe(paymentModel)
      if (dispatchCount === 1) {
        expect(event.requestData).toStrictEqual(resolveRequest)
        event.requestData['test-update-request-data-with-event1'] = true
      } else {
        expect(event.requestData).toStrictEqual(tranRequest)
        event.requestData['test-update-request-data-with-event2'] = true
      }
    })

    return () => {
      expect(clientStrategy.getClient).toHaveBeenCalledTimes(2)
      expect(clientStrategy.getClient).toHaveBeenNthCalledWith(1, txType, paymentModel)
      expect(clientStrategy.getClient).toHaveBeenNthCalledWith(2, txType, paymentModel)
      expect(requestDataPrepared).toHaveBeenCalledTimes(2)
      expect(httpClient.request).toHaveBeenCalledTimes(2)
      expect(httpClient.request.mock.calls[0]).toStrictEqual([
        txType,
        paymentModel,
        { ...resolveRequest, 'test-update-request-data-with-event1': true },
        order,
        null,
      ])
      expect(httpClient.request.mock.calls[1]).toStrictEqual([
        txType,
        paymentModel,
        { ...tranRequest, 'test-update-request-data-with-event2': true },
        order,
        null,
      ])
    }
  }

  it('init', () => {
    // deviation: counted from the POSNET currency table (six currencies), not from another gateway's table
    expect(pos.getCurrencies()).toHaveLength(6)
    expect(pos.getCurrencies()).toHaveLength(Object.keys(requestValueMapper.getCurrencyMappings()).length)
    expect(pos.getAccount()).toBe(account)
    expect(pos.isTestMode()).toBe(false)
    expect(pos.getCrypt()).toBe(crypt)
  })

  // addition: identifiers and the supported transactions table
  it('exposes NAME, the gateway class identifier and the supported transactions', () => {
    expect(PosNetPos.NAME).toBe('PosNetPos')
    expect(PosNetPos.GATEWAY_CLASS).toBe('PosNetPos')
    for (const tx of [TX_TYPE.PAY_AUTH, TX_TYPE.PAY_PRE_AUTH]) {
      expect(PosNetPos.isSupportedTransaction(tx, MODEL.THREE_D_SECURE)).toBe(true)
      expect(PosNetPos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(true)
      expect(PosNetPos.isSupportedTransaction(tx, MODEL.THREE_D_PAY)).toBe(false)
      expect(PosNetPos.isSupportedTransaction(tx, MODEL.THREE_D_HOST)).toBe(false)
      expect(PosNetPos.isSupportedTransaction(tx, MODEL.THREE_D_PAY_HOSTING)).toBe(false)
    }
    for (const tx of [TX_TYPE.PAY_POST_AUTH, TX_TYPE.STATUS, TX_TYPE.CANCEL, TX_TYPE.REFUND, TX_TYPE.REFUND_PARTIAL]) {
      expect(PosNetPos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(true)
    }
    expect(PosNetPos.isSupportedTransaction(TX_TYPE.ORDER_HISTORY, MODEL.NON_SECURE)).toBe(false)
  })

  // addition: the 3D flow needs the resolve request and the order id formatter of the POSNET mappers
  it('rejects collaborators without the resolve request or the order id formatter', () => {
    const { create3DResolveMerchantRequestData: _omitted, ...withoutResolve } = requestMapper
    expect(
      () =>
        new PosNetPos(config, account, {
          ...deps(),
          requestDataMapper: withoutResolve as unknown as RequestDataMapperInterface<PosNetPosAccount>,
        }),
    ).toThrow(PosError)
    expect(
      () =>
        new PosNetPos(config, account, {
          ...deps(),
          requestValueFormatter: { formatInstallment: vi.fn(), formatAmount: vi.fn() } as never,
        }),
    ).toThrow(PosError)
  })

  describe('get3DFormData', () => {
    it('get3DFormData success', async () => {
      const txType = TX_TYPE.PAY_AUTH
      const paymentModel = MODEL.THREE_D_SECURE
      const requestData = { 'request-data': 'x' }
      const responseData = { approved: '1', respCode: '', respText: '', oosRequestDataResponse }
      const formData = {
        gateway: GATEWAY_3D,
        method: 'POST',
        inputs: {
          mid: '6706598320',
          posnetID: '27426',
          posnetData: DATA1,
          posnetData2: DATA2,
          digest: SIGN,
        },
      }
      const order = { id: 'TST_190620093100_024', amount: '1.75' as never, success_url: 'https://domain.com/success' }
      const c = card()
      requestMapper.create3DFormInitializeRequestData.mockReturnValue(requestData)
      const verify = configureClientResponse(txType, requestData, responseData, order, paymentModel)
      requestMapper.create3DFormData.mockResolvedValue(formData)

      const result = await pos.get3DFormData(order, MODEL.THREE_D_SECURE, txType, c)

      expect(requestMapper.create3DFormInitializeRequestData).toHaveBeenCalledWith(
        account,
        order,
        MODEL.THREE_D_SECURE,
        txType,
        c,
      )
      verify()
      expect(requestMapper.create3DFormData).toHaveBeenCalledTimes(1)
      expect(requestMapper.create3DFormData).toHaveBeenCalledWith(
        account,
        order,
        paymentModel,
        txType,
        GATEWAY_3D,
        null,
        oosRequestDataResponse,
      )
      expect(result).toBe(formData)
    })

    it('get3DFormData missing oosRequestDataResponse', async () => {
      const txType = TX_TYPE.PAY_AUTH
      const requestData = { 'request-data': 'x' }
      const order: PosOrder = {
        id: 'YKB_TST_190620093100_024',
        amount: '1.75' as never,
        installment: 0,
        currency: CURRENCY.TRY,
        success_url: 'https://domain.com/success',
        fail_url: 'https://domain.com/fail_url',
        lang: 'tr',
      }
      const c = card()
      requestMapper.create3DFormInitializeRequestData.mockReturnValue(requestData)
      const verify = configureClientResponse(
        txType,
        requestData,
        { approved: '1', respCode: '', respText: '' },
        order,
        MODEL.THREE_D_SECURE,
      )

      // deviation: P28 an English message on a PosError instead of a Turkish runtime exception
      await expectRejection(
        pos.get3DFormData(order, MODEL.THREE_D_SECURE, txType, c),
        PosError,
        'Unexpected response: oosRequestDataResponse is missing or malformed',
      )
      expect(requestMapper.create3DFormInitializeRequestData).toHaveBeenCalledWith(
        account,
        order,
        MODEL.THREE_D_SECURE,
        txType,
        c,
      )
      verify()
      expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
    })

    it('get3DFormData OOS transaction fail', async () => {
      const txType = TX_TYPE.PAY_AUTH
      const requestData = { 'request-data': 'x' }
      const order: PosOrder = {
        id: 'YKB_TST_190620093100_024',
        amount: '1.75' as never,
        installment: 0,
        currency: CURRENCY.TRY,
        success_url: 'https://domain.com/success',
        fail_url: 'https://domain.com/fail_url',
        lang: 'tr',
      }
      requestMapper.create3DFormInitializeRequestData.mockReturnValue(requestData)
      const verify = configureClientResponse(
        txType,
        requestData,
        { approved: '0', respCode: '0003', respText: '148 MID,TID,IP HATALI:89.244.149.137' },
        order,
        MODEL.THREE_D_SECURE,
      )

      // deviation: P28 the bank's text becomes the message of a PosError
      await expectRejection(
        pos.get3DFormData(order, MODEL.THREE_D_SECURE, txType, card()),
        PosError,
        '148 MID,TID,IP HATALI:89.244.149.137',
      )
      verify()
      expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
      // addition: only the response code is logged
      expect(logger.error).toHaveBeenCalledWith('3D initialization failed', { resp_code: '0003' })
    })

    // deviation: P28 messages and error classes of the shared 3D form input check
    it.each([
      [
        '3d_secure_without_card',
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
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
        UnsupportedTransactionTypeError,
        'PosNetPos supports [3d, regular] payment model(s) for transaction type [pay]. Provided payment model: [3d_pay].',
        null,
      ],
      [
        'non_payment_tx_type',
        MODEL.THREE_D_PAY,
        TX_TYPE.STATUS,
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
        UnsupportedTransactionTypeError,
        'Invalid transaction type! Supported transaction types: [pay, pre].',
        null,
      ],
      [
        'unsupported_form_format',
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        true,
        UnsupportedFormFormatError,
        'Unsupported 3D form format!',
        FORM_FORMAT.HTML,
      ],
    ] as Array<[string, PaymentModel, TxType, boolean, typeof PosError, string, FormFormat | null]>)(
      'get3DFormData with bad inputs: %s',
      async (_name, paymentModel, txType, isWithCard, errorClass, message, formFormat) => {
        const c = isWithCard ? card() : null
        await expectRejection(
          pos.get3DFormData({ id: '2020110828BC' }, paymentModel, txType, c, false, formFormat),
          errorClass,
          message,
        )
        expect(httpClient.request).not.toHaveBeenCalled()
        expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
      },
    )

    // addition: P7 the bank posts every outcome to success_url; without it no initialization request is sent
    it('requires success_url before the initialization request', async () => {
      await expectRejection(
        pos.get3DFormData({ id: '2020110828BC', amount: 1 }, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card()),
        PosError,
        'Order field "success_url" is required',
      )
      expect(requestMapper.create3DFormInitializeRequestData).not.toHaveBeenCalled()
      expect(httpClient.request).not.toHaveBeenCalled()
    })

    // addition: P7 the card always goes server to server, createWithoutCard does not skip it
    it('ignores createWithoutCard: the card is still required', async () => {
      await expectRejection(
        pos.get3DFormData(
          { id: '2020110828BC', amount: 1, success_url: 'https://domain.com/success' },
          MODEL.THREE_D_SECURE,
          TX_TYPE.PAY_AUTH,
          null,
          true,
        ),
        PosError,
        'Card data is required for this payment model',
      )
      expect(httpClient.request).not.toHaveBeenCalled()
    })
  })

  describe('make3DPayment', () => {
    /** deviation: P7 the order id and amount are required before the resolve request. */
    const failOrder: PosOrder = { id: '80603153823', amount: 56.96 }

    it.each([
      [
        'auth_fail',
        {
          oosResolveMerchantDataResponse: {
            xid: 'YKB_0000080603153823',
            amount: '5696',
            currency: 'TL',
            mdErrorMessage: 'None 3D - Secure Transaction',
            mac: 'ED7254A3ABC264QOP67MN',
          },
        },
        {
          transaction_type: 'pay',
          transaction_security: 'MPI fallback',
          remote_order_id: 'YKB_0000080603153823',
          status: 'declined',
          amount: 56.96,
          currency: 'TRY',
          payment_model: '3d',
        },
      ],
      [
        'fail2-md-empty',
        {
          oosResolveMerchantDataResponse: {
            xid: 'YKB_0000080603153823',
            amount: '5696',
            mdErrorMessage: 'None 3D - Secure Transaction',
            mac: 'ED7254A3ABC264QOP67MN',
          },
        },
        {
          transaction_id: null,
          transaction_type: 'pay',
          md_error_message: 'None 3D - Secure Transaction',
          order_id: '80603153823',
          remote_order_id: 'YKB_0000080603153823',
          proc_return_code: null,
          status: 'declined',
        },
      ],
    ] as Array<[string, Data, Data]>)('make3DPayment %s', async (_name, resolveResponse, expected) => {
      const txType = TX_TYPE.PAY_AUTH
      const resolveRequest = { resolveMerchantRequestData: true }
      responseMapper.extractMdStatus.mockReturnValue('3d-status')
      responseMapper.is3dAuthSuccess.mockReturnValue(false)
      requestMapper.create3DResolveMerchantRequestData.mockReturnValue(resolveRequest)
      const verify = configureClientResponse(txType, resolveRequest, resolveResponse, failOrder, MODEL.THREE_D_SECURE)
      responseMapper.map3DPaymentData.mockReturnValue(expected)

      // deviation: P7 the callback carries the bank's hex packets
      const result = await pos.payment(MODEL.THREE_D_SECURE, failOrder, txType, null, packets)

      expect(result).toBe(expected)
      expect(responseMapper.extractMdStatus).toHaveBeenCalledTimes(1)
      expect(responseMapper.extractMdStatus).toHaveBeenCalledWith(resolveResponse)
      expect(responseMapper.is3dAuthSuccess).toHaveBeenCalledWith('3d-status')
      expect(requestMapper.create3DResolveMerchantRequestData).toHaveBeenCalledTimes(1)
      expect(requestMapper.create3DResolveMerchantRequestData).toHaveBeenCalledWith(account, failOrder, packets)
      verify()
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledTimes(1)
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(resolveResponse, null, txType, failOrder)
      expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
      expect(crypt.check3DHash).not.toHaveBeenCalled()
      // deviation: Q6 no isSuccess() state
      expect('isSuccess' in pos).toBe(false)
    })

    /** deviation: P8 the binding needs the bank's resolved order: the order of the full success fixture. */
    const successOrder: PosOrder = { id: 'YKB_0000080603153823', amount: 56.96, currency: CURRENCY.TRY, installment: 0 }

    const runSuccess = async (gateway: PosNetPos, resolveResponse: Data, paymentResponse: Data, expected: Data) => {
      const txType = TX_TYPE.PAY_AUTH
      const resolveRequest = { resolveMerchantRequestData: true }
      const tranRequest = { create3DPaymentRequestData: true }
      crypt.check3DHash.mockReturnValue(true)
      responseMapper.extractMdStatus.mockReturnValue('3d-status')
      responseMapper.is3dAuthSuccess.mockReturnValue(true)
      requestMapper.create3DResolveMerchantRequestData.mockReturnValue(resolveRequest)
      requestMapper.create3DPaymentRequestData.mockReturnValue(tranRequest)
      const verify = configureTwoRequests(
        txType,
        successOrder,
        resolveRequest,
        resolveResponse,
        tranRequest,
        paymentResponse,
      )
      responseMapper.map3DPaymentData.mockReturnValue(expected)

      const result = await gateway.payment(MODEL.THREE_D_SECURE, successOrder, txType, null, packets)

      expect(result).toBe(expected)
      expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
      expect(crypt.check3DHash).toHaveBeenCalledWith(account, resolveResponse.oosResolveMerchantDataResponse)
      expect(responseMapper.extractMdStatus).toHaveBeenCalledTimes(1)
      expect(responseMapper.extractMdStatus).toHaveBeenCalledWith(resolveResponse)
      expect(responseMapper.is3dAuthSuccess).toHaveBeenCalledWith('3d-status')
      expect(requestMapper.create3DResolveMerchantRequestData).toHaveBeenCalledWith(account, successOrder, packets)
      expect(requestMapper.create3DPaymentRequestData).toHaveBeenCalledWith(account, successOrder, txType, packets)
      verify()
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledTimes(1)
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(
        resolveResponse,
        paymentResponse,
        txType,
        successOrder,
      )
      // deviation: Q6 no isSuccess() state
      expect('isSuccess' in gateway).toBe(false)
    }

    it('make3DPayment success', async () => {
      await runSuccess(
        pos,
        success1Resolve,
        { approved: '1', respCode: '', respText: '00' },
        { transaction_id: null, transaction_type: 'pay', status: 'approved' },
      )
    })

    it('make3DPayment without hash check', async () => {
      // deviation: P10 the check cannot be disabled, check3DHash is still called once
      // deviation: P8 the resolve fixture gains the signed mdStatus the format check requires
      const resolve = {
        approved: '1',
        respCode: '',
        respText: '',
        oosResolveMerchantDataResponse: {
          xid: 'YKB_0000080603153823',
          amount: '5696',
          currency: 'TL',
          mdStatus: '1',
          mac: 'y0fU6rRA0OvqJ5GN6uMdHVu6Xra7QR1qeT9rN7R1L+o=',
        },
      }
      await runSuccess(
        createGateway(configWithHashCheckDisabled),
        resolve,
        {
          approved: '1',
          respCode: '',
          respText: '00',
          mac: 'DF2323A3BMC782QOP42RT',
          hostlogkey: '0000000002P0806031',
          authCode: '901477',
        },
        {
          transaction_type: 'pay',
          md_status: '1',
          status: 'approved',
          amount: 56.96,
          currency: 'TRY',
          payment_model: '3d',
        },
      )
    })

    it('make3DPayment hash mismatch', async () => {
      const resolveResponse = {
        approved: '1',
        respCode: '',
        respText: '',
        oosResolveMerchantDataResponse: {
          mdStatus: '1',
          mdErrorMessage: '',
          mac: 'y0fU6rRA0OvqJ5GN6uMdHVu6Xra7QR1qeT9rN7R1L+o=',
        },
      }
      // deviation: P7 the order id and amount are required, the callback carries the hex packets
      const order: PosOrder = { id: 'YKB_0000080603153823', amount: 56.96 }
      const resolveRequest = { resolveMerchantRequestData: true }
      crypt.check3DHash.mockReturnValue(false)
      responseMapper.is3dAuthSuccess.mockReturnValue(true)
      requestMapper.create3DResolveMerchantRequestData.mockReturnValue(resolveRequest)
      const verify = configureClientResponse(
        TX_TYPE.PAY_AUTH,
        resolveRequest,
        resolveResponse,
        order,
        MODEL.THREE_D_SECURE,
      )

      await expectRejection(
        pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, packets),
        HashMismatchError,
        '3D resolve response MAC mismatch',
      )
      expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
      expect(crypt.check3DHash).toHaveBeenCalledWith(account, resolveResponse.oosResolveMerchantDataResponse)
      verify()
      expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
      expect(responseMapper.map3DPaymentData).not.toHaveBeenCalled()
    })

    // addition: P9 the fail-closed guard: a not-successful resolve must map as declined
    it('rejects a not-successful resolve that is not mapped as declined', async () => {
      const resolveRequest = { resolveMerchantRequestData: true }
      responseMapper.is3dAuthSuccess.mockReturnValue(false)
      requestMapper.create3DResolveMerchantRequestData.mockReturnValue(resolveRequest)
      configureClientResponse(TX_TYPE.PAY_AUTH, resolveRequest, { approved: '0' }, failOrder, MODEL.THREE_D_SECURE)
      responseMapper.map3DPaymentData.mockReturnValue({ status: 'approved', order_id: '80603153823' })

      await expectRejection(
        pos.payment(MODEL.THREE_D_SECURE, failOrder, TX_TYPE.PAY_AUTH, null, packets),
        PosError,
        '3D callback without 3D success was not mapped as declined',
      )
      expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
      expect(crypt.check3DHash).not.toHaveBeenCalled()
    })

    // addition: P9 a 3D-successful mdStatus without the bank's approval is declined, never provisioned
    it('declines a resolve with mdStatus success but approved "0"', async () => {
      const resolveRequest = { resolveMerchantRequestData: true }
      const resolve = { ...success1Resolve, approved: '0' }
      responseMapper.extractMdStatus.mockReturnValue('1')
      responseMapper.is3dAuthSuccess.mockReturnValue(true)
      requestMapper.create3DResolveMerchantRequestData.mockReturnValue(resolveRequest)
      configureClientResponse(TX_TYPE.PAY_AUTH, resolveRequest, resolve, successOrder, MODEL.THREE_D_SECURE)
      responseMapper.map3DPaymentData.mockReturnValue({ status: 'declined' })

      const result = await pos.payment(MODEL.THREE_D_SECURE, successOrder, TX_TYPE.PAY_AUTH, null, packets)

      expect(result.status).toBe('declined')
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(resolve, null, TX_TYPE.PAY_AUTH, successOrder)
      expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
      expect(crypt.check3DHash).not.toHaveBeenCalled()
    })

    // addition: P8 a mismatch is logged through the safe logger with field, expected, actual and order id
    it('logs a binding mismatch with field, expected, actual and order id', async () => {
      const resolveRequest = { resolveMerchantRequestData: true }
      crypt.check3DHash.mockReturnValue(true)
      responseMapper.is3dAuthSuccess.mockReturnValue(true)
      requestMapper.create3DResolveMerchantRequestData.mockReturnValue(resolveRequest)
      configureClientResponse(
        TX_TYPE.PAY_AUTH,
        resolveRequest,
        success1Resolve,
        { ...successOrder, amount: 56.97 },
        MODEL.THREE_D_SECURE,
      )

      const err = (await expectRejection(
        pos.payment(MODEL.THREE_D_SECURE, { ...successOrder, amount: 56.97 }, TX_TYPE.PAY_AUTH, null, packets),
        OrderMismatchError,
      )) as OrderMismatchError
      expect([err.field, err.expected, err.actual, err.paymentMayHaveCompleted]).toStrictEqual([
        'amount',
        '5697',
        '5696',
        false,
      ])
      expect(err.response).toBeUndefined()
      expect(logger.error).toHaveBeenCalledWith('3D resolve amount does not match the order', {
        field: 'amount',
        expected: '5697',
        actual: '5696',
        // the safe logger masks the 16-digit run of this id like a card number
        order_id: 'YKB_000008****3823',
      })
      expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
    })
  })

  it('make3DHostPayment', async () => {
    // deviation: P28 payment() checks the supported transactions table first
    await expectRejection(
      pos.payment(MODEL.THREE_D_HOST, {}, TX_TYPE.PAY_AUTH, null, { abc: '1' }),
      UnsupportedTransactionTypeError,
    )
    await expectRejection(pos.make3DHostPayment({ abc: '1' }, {}, TX_TYPE.PAY_AUTH), UnsupportedPaymentModelError)
  })

  it('make3DPayPayment', async () => {
    // deviation: P28 payment() checks the supported transactions table first
    await expectRejection(
      pos.payment(MODEL.THREE_D_PAY, {}, TX_TYPE.PAY_AUTH, null, { abc: '1' }),
      UnsupportedTransactionTypeError,
    )
    await expectRejection(pos.make3DPayPayment({ abc: '1' }, {}, TX_TYPE.PAY_AUTH), UnsupportedPaymentModelError)
  })

  it.each([[TX_TYPE.PAY_AUTH], [TX_TYPE.PAY_PRE_AUTH]] as Array<[TxType]>)(
    'makeRegularPayment (%s)',
    async (txType) => {
      const order = { id: '2020110828BC' }
      const c = card()
      const requestData = { createNonSecurePaymentRequestData: true }
      requestMapper.createNonSecurePaymentRequestData.mockReturnValue(requestData)
      const verify = configureClientResponse(txType, requestData, { decodedData: true }, order, MODEL.NON_SECURE)
      responseMapper.mapPaymentResponse.mockReturnValue({ result: true })

      const result = await pos.payment(MODEL.NON_SECURE, order, txType, c)

      expect(requestMapper.createNonSecurePaymentRequestData).toHaveBeenCalledWith(account, order, txType, c)
      verify()
      expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith({ decodedData: true }, txType, order)
      expect(result).toStrictEqual({ result: true })
    },
  )

  it('makeRegularPostAuthPayment', async () => {
    const order = { id: '2020110828BC' }
    const txType = TX_TYPE.PAY_POST_AUTH
    const requestData = { createNonSecurePostAuthPaymentRequestData: true }
    requestMapper.createNonSecurePostAuthPaymentRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(txType, requestData, { decodedData: true }, order, MODEL.NON_SECURE)
    responseMapper.mapPaymentResponse.mockReturnValue({ result: true })

    await pos.payment(MODEL.NON_SECURE, order, txType)

    expect(requestMapper.createNonSecurePostAuthPaymentRequestData).toHaveBeenCalledWith(account, order)
    verify()
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith({ decodedData: true }, txType, order)
  })

  it('status request', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { createStatusRequestData: true }
    requestMapper.createStatusRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(TX_TYPE.STATUS, requestData, { decodedData: true }, order, MODEL.NON_SECURE)
    responseMapper.mapStatusResponse.mockReturnValue({ result: true })

    await pos.status(order)

    expect(requestMapper.createStatusRequestData).toHaveBeenCalledWith(account, order)
    verify()
    expect(responseMapper.mapStatusResponse).toHaveBeenCalledWith({ decodedData: true })
  })

  it('cancel request', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { createCancelRequestData: true }
    requestMapper.createCancelRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(TX_TYPE.CANCEL, requestData, { decodedData: true }, order, MODEL.NON_SECURE)
    responseMapper.mapCancelResponse.mockReturnValue({ result: true })

    await pos.cancel(order)

    expect(requestMapper.createCancelRequestData).toHaveBeenCalledWith(account, order)
    verify()
    expect(responseMapper.mapCancelResponse).toHaveBeenCalledWith({ decodedData: true })
  })

  it('refund request', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { createRefundRequestData: true }
    requestMapper.createRefundRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(TX_TYPE.REFUND, requestData, { decodedData: true }, order, MODEL.NON_SECURE)
    responseMapper.mapRefundResponse.mockReturnValue({ result: true })

    await pos.refund(order)

    expect(requestMapper.createRefundRequestData).toHaveBeenCalledWith(account, order, TX_TYPE.REFUND)
    verify()
    expect(responseMapper.mapRefundResponse).toHaveBeenCalledWith({ decodedData: true })
  })

  it('order history request', async () => {
    await expectRejection(pos.orderHistory({}), UnsupportedTransactionTypeError)
    expect(requestMapper.createOrderHistoryRequestData).not.toHaveBeenCalled()
  })

  it('payment with missing 3D gateway response data', async () => {
    // deviation: P28 English message, PosError
    await expectRejection(
      pos.payment(MODEL.THREE_D_SECURE, {}, TX_TYPE.PAY_AUTH, null, null),
      PosError,
      '3D auth response data from the bank is required for 3D payment models.',
    )
  })

  it('payment with unsupported payment model', async () => {
    // deviation: P28 payment() checks the supported transactions table first
    await expectRejection(
      pos.payment('unknown_model' as never, {}, TX_TYPE.PAY_AUTH, null, { data: '1' }),
      UnsupportedTransactionTypeError,
    )
  })

  it('makeRegularPayment with invalid tx type', async () => {
    await expectRejection(
      pos.makeRegularPayment({}, card(), TX_TYPE.CANCEL),
      UnsupportedTransactionTypeError,
      'Invalid transaction type "cancel" provided',
    )
  })
})

// ---------- end to end: real mappers, crypt and HTTP client over a fake fetch ----------

/** base64(SHA-256(s)), the POSNET MAC primitive. */
const H = (s: string): string => createHash('sha256').update(s, 'utf8').digest('base64')
const MERCHANT_ID = '6706598320'
const F = H(`${ENC_KEY};67005551`)
/** MAC of a request: padded order id, amount in kuruş, currency, merchant, first hash. */
const requestMac = (xid: string, amount: string, currency = 'TL') =>
  H(`${xid};${amount};${currency};${MERCHANT_ID};${F}`)
/** MAC of the bank's resolve answer: mdStatus first. */
const resolveMac = (mdStatus: string, xid: string, amount: string, currency = 'TL') =>
  H(`${mdStatus};${xid};${amount};${currency};${MERCHANT_ID};${F}`)

const E1 = 'JA8+68g04zptKLqLYwOOnK/doN2YRLDqaohzBNJ956Y='
const E2 = 'sekuJgLB8LeMOFbyXJw/X4ndvBH814CC5qEIvEe0aOE='
const E3 = 'vhExq+3PtxyzDknCO+UTZAFSf0b6B2+GI7bIaum3kts='
const E4 = '62QdNAbgDrKnfmoJTASP8ocC17SaT3Hgluj77MeZprw='
const VP1 = 'qaAng0XtzvOtvxWhri36zAqfqPv6lzn2+TZTJbI8KxE='
const VP2 = 'FLwRXy94Bhr49hK4ij4zKosGkOpZMur4w+Cv6oIDsRo='
const RESOLVE_REQUEST_MAC = 'oE7zwV87uOc2DFpGPlr4jQRQ0z9LsxGw56c7vaiZkTo='

const callbackC: GatewayResponseData = {
  MerchantPacket: 'E1D0C0FB6EC5203A748124F309998F61E1D0C0FB6EC5203A748124F309998F61E1D0C0FB6EC5203A748124F30',
  BankPacket: 'F61E1D0C0FB6EC5203A748124F309998F61E1D0C0FB6EC5203A748124F30',
  Sign: '9998F61E1D0C0FB6EC5203A748124F30',
}

const orderO: PosOrder = { id: '2020110828BC', amount: 100.01, currency: CURRENCY.TRY, installment: 0 }

const resolveAnswer = (fields: Data = {}, top: Data = {}): Data => ({
  approved: '1',
  respCode: '',
  respText: '',
  ...top,
  oosResolveMerchantDataResponse: {
    xid: '000000002020110828BC',
    amount: '10001',
    currency: 'TL',
    installment: '00',
    point: '0',
    pointAmount: '0',
    txStatus: 'Y',
    mdStatus: '1',
    mdErrorMessage: '',
    mac: E1,
    ...fields,
  },
})

const tranAnswer: Data = {
  approved: '1',
  respCode: '',
  respText: '',
  mac: 'DF2323A3BMC782QOP42RT',
  hostlogkey: '0000000002P0806031',
  authCode: '901477',
  instInfo: { inst1: '00', amnt1: '000000000000' },
  pointInfo: {
    point: '00000228',
    pointAmount: '000000000114',
    totalPoint: '00000000',
    totalPointAmount: '000000000000',
  },
}

type Posted = { url: string; raw: string; data: Data }

/**
 * A fake POSNET endpoint: reads the raw `xmldata=` ISO-8859-9 body, parses the XML and answers with `answer`
 * (a record encoded as a `posnetResponse` in ISO-8859-9, or a ready Response).
 */
function fakeBank(answer: ((data: Data) => Data | Response | Promise<Data | Response>) | null = null) {
  const posted: Posted[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const raw = iconv.decode(Buffer.from(init?.body as Uint8Array), 'ISO-8859-9')
    if (!raw.startsWith('xmldata=')) {
      throw new Error('body must start with xmldata=')
    }
    const data = XmlDecoder.decode(raw.slice('xmldata='.length)) as Data
    posted.push({ url: String(url), raw, data })
    if (answer === null) {
      throw new Error('no network expected')
    }
    const out = await answer(data)
    if (out instanceof Response) return out
    const xml = XmlEncoder.encode(out, { rootName: 'posnetResponse', encoding: 'ISO-8859-9' })
    return new Response(new Uint8Array(iconv.encode(xml, 'ISO-8859-9')))
  }) as unknown as typeof fetch

  return { posted, fetchImpl }
}

/** Answers the resolve request with `resolve` and the provision request with `tran`. */
const threeDBank = (resolve: Data, tran: Data = tranAnswer) =>
  fakeBank((data) => {
    if (data.oosResolveMerchantData !== undefined) return resolve
    if (data.oosTranData !== undefined) return tran
    throw new Error('unexpected request')
  })

function realGateway(
  fetchImpl: typeof fetch,
  options: { cfg?: GatewayConfig; logger?: PosLogger; hooks?: PosHooks } = {},
): PosNetPos {
  const log = options.logger ?? createLogger()
  const cryptImpl = new PosNetPosCrypt(log)
  const valueMapper = new PosNetPosRequestValueMapper()
  const valueFormatter = new PosNetPosRequestValueFormatter()
  const hooks: PosHooks = options.hooks ?? {}
  const deps: GatewayDeps<PosNetPosAccount> = {
    requestValueMapper: valueMapper,
    requestValueFormatter: valueFormatter,
    requestDataMapper: new PosNetPosRequestDataMapper(valueMapper, valueFormatter, hooks, cryptImpl),
    responseDataMapper: new PosNetPosResponseDataMapper(
      new PosNetPosResponseValueFormatter(),
      new PosNetPosResponseValueMapper(),
      log,
    ),
    crypt: cryptImpl,
    clientStrategy: new HttpClientStrategy([
      new PosNetPosHttpClient(PAYMENT_API, new HttpTransport({ fetch: fetchImpl }), noopLogger),
    ]),
    logger: log,
    hooks,
  }

  return new PosNetPos(options.cfg ?? config, createAccount(), deps)
}

const pay3D = (gateway: PosNetPos, order: PosOrder, callback: GatewayResponseData) =>
  gateway.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, callback)

describe('PosNetPos (end to end) 3D payment', () => {
  it('has consistent planning vectors', () => {
    expect(F).toBe('c1PPl+2UcdixyhgLYnf4VfJyFGaNQNOwE0uMkci7Uag=')
    expect(requestMac('000000002020110828BC', '10001')).toBe(RESOLVE_REQUEST_MAC)
    expect(resolveMac('1', '000000002020110828BC', '10001')).toBe(E1)
    expect(resolveMac('9', '000000002020110828BC', '10001')).toBe(E2)
    expect(resolveMac('1', '000000002020110828BD', '10001')).toBe(E3)
    expect(resolveMac('1', '000000002020110828BC', '1')).toBe(E4)
    expect(requestMac('000000002020110828BC', '113')).toBe(VP1)
    expect(resolveMac('1', '000000002020110828BC', '113')).toBe(VP2)
  })

  // addition: resolve, MAC check, binding to the bank-resolved data and provision over the raw protocol
  it('resolves, verifies, binds and provisions', async () => {
    const { posted, fetchImpl } = threeDBank(resolveAnswer())

    const res = await pay3D(realGateway(fetchImpl), orderO, callbackC)

    expect(posted).toHaveLength(2)
    expect(posted.map((p) => p.url)).toStrictEqual([PAYMENT_API, PAYMENT_API])
    expect(posted[0]?.data).toStrictEqual({
      mid: MERCHANT_ID,
      tid: '67005551',
      oosResolveMerchantData: {
        bankData: callbackC.BankPacket,
        merchantData: callbackC.MerchantPacket,
        sign: callbackC.Sign,
        mac: RESOLVE_REQUEST_MAC,
      },
    })
    expect(posted[1]?.data).toStrictEqual({
      mid: MERCHANT_ID,
      tid: '67005551',
      oosTranData: {
        bankData: callbackC.BankPacket,
        merchantData: callbackC.MerchantPacket,
        sign: callbackC.Sign,
        wpAmount: '0',
        mac: RESOLVE_REQUEST_MAC,
      },
    })
    expect(res).toMatchObject({
      status: 'approved',
      auth_code: '901477',
      ref_ret_num: '0000000002P0806031',
      md_status: '1',
      transaction_security: 'Full 3D Secure',
      amount: 100.01,
      currency: 'TRY',
      order_id: '2020110828BC',
      remote_order_id: '000000002020110828BC',
    })
    expect(res.requires_manual_review).toBeUndefined()
  })

  // addition: the order id is read with the shared rule, so an array or object never turns into the id text
  it.each([[['2020110828BC']], [{}], [true], [1.5], [-1], [2 ** 53], ['_2020110828BC'], ['a'.repeat(21)]])(
    'rejects the order id %j before any request',
    async (id) => {
      const { posted, fetchImpl } = threeDBank(resolveAnswer())
      const err = await expectRejection(
        pay3D(realGateway(fetchImpl), { ...orderO, id: id as never }, callbackC),
        PosError,
      )
      expect(err.message).toMatch(/^Order field "id"/)
      expect(posted).toHaveLength(0)
    },
  )

  // addition: P8 packets of another order: the bank resolves that order, nothing is provisioned
  it('rejects a resolve for another order id (OrderMismatchError, no provision)', async () => {
    const { posted, fetchImpl } = threeDBank(resolveAnswer({ xid: '000000002020110828BD', mac: E3 }))
    const err = (await expectRejection(
      pay3D(realGateway(fetchImpl), orderO, callbackC),
      OrderMismatchError,
    )) as OrderMismatchError
    expect(err.field).toBe('order_id')
    expect(err.expected).toBe('000000002020110828BC')
    expect(err.actual).toBe('000000002020110828BD')
    expect(err.paymentMayHaveCompleted).toBe(false)
    expect(err.response).toBeUndefined()
    expect(posted).toHaveLength(1)
  })

  // addition: P8 a resolve for another amount
  it('rejects a resolve for another amount', async () => {
    const { posted, fetchImpl } = threeDBank(resolveAnswer({ amount: '1', mac: E4 }))
    const err = (await expectRejection(
      pay3D(realGateway(fetchImpl), orderO, callbackC),
      OrderMismatchError,
    )) as OrderMismatchError
    expect([err.field, err.expected, err.actual]).toStrictEqual(['amount', '10001', '1'])
    expect(err.paymentMayHaveCompleted).toBe(false)
    expect(posted).toHaveLength(1)
  })

  // addition: P8 a resolve for another currency (MAC recomputed for the test)
  it('rejects a resolve for another currency', async () => {
    const mac = resolveMac('1', '000000002020110828BC', '10001', 'US')
    const { posted, fetchImpl } = threeDBank(resolveAnswer({ currency: 'US', mac }))
    const err = (await expectRejection(
      pay3D(realGateway(fetchImpl), orderO, callbackC),
      OrderMismatchError,
    )) as OrderMismatchError
    expect([err.field, err.expected, err.actual]).toStrictEqual(['currency', 'TL', 'US'])
    expect(posted).toHaveLength(1)
  })

  // addition: P8 a resolve for another installment count (not signed, still bound)
  it('rejects a resolve for another installment count', async () => {
    const { posted, fetchImpl } = threeDBank(resolveAnswer({ installment: '03' }))
    const err = (await expectRejection(
      pay3D(realGateway(fetchImpl), orderO, callbackC),
      OrderMismatchError,
    )) as OrderMismatchError
    expect([err.field, err.expected, err.actual]).toStrictEqual(['installment', '00', '03'])
    expect(posted).toHaveLength(1)
  })

  // addition: P8 an installment the bank leaves empty is not bound
  it('accepts a resolve without an installment', async () => {
    const { posted, fetchImpl } = threeDBank(resolveAnswer({ installment: '' }))
    const res = await pay3D(realGateway(fetchImpl), orderO, callbackC)
    expect(res.status).toBe('approved')
    expect(posted).toHaveLength(2)
  })

  // addition: P7 a resolve MAC altered by one character
  it('rejects an altered resolve MAC (HashMismatchError, no provision)', async () => {
    const altered = `${E1.slice(0, 5)}${E1[5] === 'A' ? 'B' : 'A'}${E1.slice(6)}`
    const { posted, fetchImpl } = threeDBank(resolveAnswer({ mac: altered }))
    await expectRejection(
      pay3D(realGateway(fetchImpl), orderO, callbackC),
      HashMismatchError,
      '3D resolve response MAC mismatch',
    )
    expect(posted).toHaveLength(1)
  })

  // addition: P7 mdStatus is signed: a tampered mdStatus no longer verifies
  it('rejects a tampered mdStatus under the original MAC', async () => {
    const { posted, fetchImpl } = threeDBank(resolveAnswer({ mdStatus: '2' }))
    await expectRejection(pay3D(realGateway(fetchImpl), orderO, callbackC), HashMismatchError)
    expect(posted).toHaveLength(1)
  })

  // addition: P7 a resolve without a MAC on the success path
  it('rejects a successful resolve without a MAC', async () => {
    const { posted, fetchImpl } = threeDBank(resolveAnswer({ mac: '' }))
    await expectRejection(pay3D(realGateway(fetchImpl), orderO, callbackC), HashMismatchError)
    expect(posted).toHaveLength(1)
  })

  // addition: P8 signed fields with a valid MAC but an impossible format
  it.each([
    ['amount with decimals', { amount: '10001.0' }],
    ['lower-case currency', { currency: 'tl' }],
  ] as Array<[string, Data]>)('rejects a malformed signed field: %s', async (_name, fields) => {
    const f = { mdStatus: '1', xid: '000000002020110828BC', amount: '10001', currency: 'TL', ...fields }
    const mac = resolveMac(f.mdStatus, f.xid, f.amount, f.currency)
    const { posted, fetchImpl } = threeDBank(resolveAnswer({ ...fields, mac }))
    await expectRejection(
      pay3D(realGateway(fetchImpl), orderO, callbackC),
      HashMismatchError,
      '3D resolve response fields are malformed',
    )
    expect(posted).toHaveLength(1)
  })

  // addition: P9 a failed 3D authentication is declined without a provision request
  it('declines mdStatus 9 without a provision request', async () => {
    const { posted, fetchImpl } = threeDBank(resolveAnswer({ mdStatus: '9', txStatus: 'N', mac: E2 }))
    const res = await pay3D(realGateway(fetchImpl), orderO, callbackC)
    expect(res.status).toBe('declined')
    expect(res.md_status).toBe('9')
    expect(posted).toHaveLength(1)
  })

  // addition: P9 the bank's approval is required on top of a 3D-successful mdStatus
  it('declines approved "0" with mdStatus 1 and a valid MAC', async () => {
    const { posted, fetchImpl } = threeDBank(resolveAnswer({}, { approved: '0' }))
    const res = await pay3D(realGateway(fetchImpl), orderO, callbackC)
    expect(res.status).toBe('declined')
    expect(posted).toHaveLength(1)
  })

  // addition: P9 the bank rejects the resolve (wrong MAC on our side, foreign packets)
  it('declines a resolve error without oosResolveMerchantDataResponse', async () => {
    const { posted, fetchImpl } = threeDBank({ approved: '0', respCode: 'E216', respText: 'Mac Doğrulama hatalı' })
    const res = await pay3D(realGateway(fetchImpl), orderO, callbackC)
    expect(res.status).toBe('declined')
    expect(res.error_code).toBe('E216')
    expect(res.error_message).toBe('Mac Doğrulama hatalı')
    expect(posted).toHaveLength(1)
  })

  // addition: P3 amounts are rounded, never truncated (1.13 is 113 kuruş in every request and binding)
  it('signs and binds 1.13 as 113 kuruş', async () => {
    const { posted, fetchImpl } = threeDBank(resolveAnswer({ amount: '113', mac: VP2 }))
    const res = await pay3D(realGateway(fetchImpl), { ...orderO, amount: 1.13 }, callbackC)
    expect(res.status).toBe('approved')
    expect(res.amount).toBe(1.13)
    expect(posted).toHaveLength(2)
    expect(posted[0]?.data.oosResolveMerchantData.mac).toBe(VP1)
    expect(posted[1]?.data.oosTranData.mac).toBe(VP1)
  })

  // addition: P10 require_3d_hash and disable_3d_hash_check change nothing
  it('ignores require_3d_hash and disable_3d_hash_check', async () => {
    const ok = threeDBank(resolveAnswer())
    const res = await pay3D(realGateway(ok.fetchImpl, { cfg: { ...config, require_3d_hash: true } }), orderO, callbackC)
    expect(res.status).toBe('approved')
    expect(ok.posted).toHaveLength(2)

    const declined = threeDBank(resolveAnswer({ mdStatus: '9', mac: E2 }))
    const res2 = await pay3D(
      realGateway(declined.fetchImpl, { cfg: { ...config, require_3d_hash: true } }),
      orderO,
      callbackC,
    )
    expect(res2.status).toBe('declined')

    const altered = threeDBank(resolveAnswer({ mac: E2 }))
    await expectRejection(
      pay3D(realGateway(altered.fetchImpl, { cfg: configWithHashCheckDisabled }), orderO, callbackC),
      HashMismatchError,
    )
    expect(altered.posted).toHaveLength(1)
  })

  // addition: P7 echo fields in the callback are never read
  it('ignores echo fields of the callback', async () => {
    const { posted, fetchImpl } = threeDBank(resolveAnswer())
    const res = await pay3D(realGateway(fetchImpl), orderO, {
      ...callbackC,
      Xid: '000000002020110828BD',
      Amount: '1',
      MdStatus: '9',
    })
    expect(res.status).toBe('approved')
    expect(res.order_id).toBe('2020110828BC')
    expect(posted).toHaveLength(2)
  })

  // addition: P7 hooks see both requests and may change them; changes are sent
  it('sends what the hooks leave in the request data', async () => {
    const { posted, fetchImpl } = threeDBank(resolveAnswer())
    const seen: string[] = []
    const hooks: PosHooks = {
      onRequestDataPrepared: [
        (e) => {
          seen.push(Object.keys(e.requestData).join(','))
          expect(e.paymentModel).toBe(MODEL.THREE_D_SECURE)
          expect(e.txType).toBe(TX_TYPE.PAY_AUTH)
        },
      ],
    }
    await pay3D(realGateway(fetchImpl, { hooks }), orderO, callbackC)
    expect(seen).toStrictEqual(['mid,tid,oosResolveMerchantData', 'mid,tid,oosTranData'])
    expect(posted).toHaveLength(2)
  })
})

describe('PosNetPos (end to end) callback checks before any request', () => {
  const PACKETS_MALFORMED = '3D callback packets are missing or malformed'

  it.each([
    ['missing Sign', { MerchantPacket: callbackC.MerchantPacket, BankPacket: callbackC.BankPacket }, PACKETS_MALFORMED],
    ['empty Sign', { ...callbackC, Sign: '' }, PACKETS_MALFORMED],
    ['"&" in MerchantPacket', { ...callbackC, MerchantPacket: 'AB&xmldata=x' }, PACKETS_MALFORMED],
    ['non-hex BankPacket', { ...callbackC, BankPacket: 'zz' }, PACKETS_MALFORMED],
    ['too long BankPacket', { ...callbackC, BankPacket: 'A'.repeat(8193) }, PACKETS_MALFORMED],
    [
      'inherited Sign',
      // addition: 'AB' is valid hex, so only an own-property read keeps the inherited Sign from reaching the bank
      Object.assign(Object.create({ Sign: 'AB' }), {
        MerchantPacket: callbackC.MerchantPacket,
        BankPacket: callbackC.BankPacket,
      }),
      PACKETS_MALFORMED,
    ],
  ] as Array<[string, Data, string]>)('rejects %s (PosError, nothing sent)', async (_name, callback, message) => {
    const { posted, fetchImpl } = fakeBank()
    await expectRejection(pay3D(realGateway(fetchImpl), orderO, callback as GatewayResponseData), PosError, message)
    expect(posted).toHaveLength(0)
  })

  // addition: nested values cannot shadow a packet for one reader while another reads the top level
  it.each([
    ['array BankPacket', { ...callbackC, BankPacket: ['A1'] }],
    ['object MerchantPacket', { ...callbackC, MerchantPacket: { a: 'A1' } }],
    ['object echo field', { ...callbackC, Xid: { a: '1' } }],
    ['function field', { ...callbackC, x: () => 'A1' }],
  ] as Array<[string, Data]>)('rejects a non-flat callback: %s (PosError, nothing sent)', async (_name, callback) => {
    const { posted, fetchImpl } = fakeBank()
    await expectRejection(pay3D(realGateway(fetchImpl), orderO, callback as GatewayResponseData), PosError)
    expect(posted).toHaveLength(0)
  })

  it.each([
    ['order without amount', { id: '2020110828BC', currency: CURRENCY.TRY }],
    ['order without id', { amount: 100.01, currency: CURRENCY.TRY }],
    ['order id with "&"', { id: 'A&B', amount: 100.01 }],
    ['order id longer than 20 characters', { id: 'A'.repeat(21), amount: 100.01 }],
    ['amount that is not a number', { id: '2020110828BC', amount: 'abc' }],
    ['negative installment', { id: '2020110828BC', amount: 100.01, installment: -1 }],
    ['fractional installment', { id: '2020110828BC', amount: 100.01, installment: 1.5 }],
    ['exponent installment', { id: '2020110828BC', amount: 100.01, installment: '1e1' as never }],
    ['hex installment', { id: '2020110828BC', amount: 100.01, installment: '0x10' as never }],
  ] as Array<[string, Data]>)('rejects an %s (PosError, nothing sent)', async (_name, order) => {
    const { posted, fetchImpl } = fakeBank()
    await expectRejection(pay3D(realGateway(fetchImpl), order as PosOrder, callbackC), PosError)
    expect(posted).toHaveLength(0)
  })
})

describe('PosNetPos (end to end) 3D form', () => {
  const formOrder: PosOrder = {
    id: 'TST_190620093100_024',
    amount: 1.75,
    currency: CURRENCY.TRY,
    installment: 0,
    success_url: 'https://domain.com/success',
    lang: 'tr',
  }
  const formCard = () => CreditCardFactory.create('5555444433332222', '22', '01', '123', 'ahmet')
  const initBank = (response: Data) =>
    fakeBank((data) => {
      if (data.oosRequestData !== undefined) return response
      throw new Error('unexpected request')
    })

  // addition: the initialization request and the form over the raw protocol
  it('initializes and builds the form', async () => {
    const { posted, fetchImpl } = initBank({ approved: '1', respCode: '', respText: '', oosRequestDataResponse })

    const form = await realGateway(fetchImpl).get3DFormData(
      formOrder,
      MODEL.THREE_D_SECURE,
      TX_TYPE.PAY_AUTH,
      formCard(),
    )

    expect(posted).toHaveLength(1)
    expect(posted[0]?.data).toStrictEqual({
      mid: MERCHANT_ID,
      tid: '67005551',
      oosRequestData: {
        posnetid: '27426',
        ccno: '5555444433332222',
        expDate: '2201',
        cvc: '123',
        amount: '175',
        currencyCode: 'TL',
        installment: '00',
        XID: 'TST_190620093100_024',
        cardHolderName: 'ahmet',
        tranType: 'Sale',
      },
    })
    expect(posted[0]?.raw).toContain('<amount>175</amount>')
    expect(form).toStrictEqual({
      gateway: GATEWAY_3D,
      method: 'POST',
      inputs: {
        mid: MERCHANT_ID,
        posnetID: '27426',
        posnetData: DATA1,
        posnetData2: DATA2,
        digest: SIGN,
        merchantReturnURL: 'https://domain.com/success',
        url: '',
        lang: 'tr',
      },
    })
  })

  // addition: P7 the bank's packets are inserted into the merchant's page: hex only
  it.each([
    ['non-hex data1', { ...oosRequestDataResponse, data1: 'XYZ' }],
    ['empty data2', { ...oosRequestDataResponse, data2: '' }],
    ['missing sign', { data1: DATA1, data2: DATA2 }],
    ['nested sign', { ...oosRequestDataResponse, sign: { a: SIGN } }],
  ] as Array<[string, Data]>)('rejects a malformed oosRequestDataResponse: %s', async (_name, response) => {
    const { fetchImpl } = initBank({ approved: '1', respCode: '', respText: '', oosRequestDataResponse: response })
    await expectRejection(
      realGateway(fetchImpl).get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, formCard()),
      PosError,
      'Unexpected response: oosRequestDataResponse is missing or malformed',
    )
  })

  // addition: P7 a failed initialization without a text gets a generic message
  it('rejects a failed initialization without a response text', async () => {
    const { fetchImpl } = initBank({ approved: '0', respCode: '0148', respText: '' })
    await expectRejection(
      realGateway(fetchImpl).get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, formCard()),
      PosError,
      'PosNet 3D initialization failed',
    )
  })

  // addition: P11 a card holder name with "&" never reaches the bank
  it('rejects a card holder name with "&" before sending', async () => {
    const { posted, fetchImpl } = initBank({ approved: '1', oosRequestDataResponse })
    const c = CreditCardFactory.create('5555444433332222', '22', '01', '123', 'Ali & Veli')
    await expectRejection(
      realGateway(fetchImpl).get3DFormData(formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, c),
      PosError,
      'PosNet request values must not contain "&", "%" or characters outside ISO-8859-9',
    )
    expect(posted).toHaveLength(0)
  })
})

describe('PosNetPos (end to end) other transactions', () => {
  // addition: bank error pages
  it('cancel() with HTTP 500 rejects with PosHttpError', async () => {
    const { fetchImpl } = fakeBank(() => new Response('Internal Server Error', { status: 500 }))
    const err = await expectRejection(realGateway(fetchImpl).cancel({ id: 'A' }), PosHttpError)
    expect((err as PosHttpError).status).toBe(500)
  })

  it('cancel() with an HTML page (HTTP 200) rejects with PosHttpError', async () => {
    const { fetchImpl } = fakeBank(() => new Response('<html><body>Request Rejected</body></html>'))
    await expectRejection(realGateway(fetchImpl).cancel({ id: 'A' }), PosHttpError)
  })

  // addition: one instance serves concurrent 3D payments; each request and response stays with its order
  it('keeps two concurrent 3D payments apart', async () => {
    const answers: Record<string, { xid: string; mac: string; delay: number }> = {
      AAAA1111: { xid: '000000002020110828BC', mac: E1, delay: 30 },
      BBBB2222: { xid: '000000002020110828BD', mac: E3, delay: 0 },
    }
    const { posted, fetchImpl } = fakeBank(async (data) => {
      const req = (data.oosResolveMerchantData ?? data.oosTranData) as Data
      const a = answers[req.sign as string]
      if (a === undefined) throw new Error('unknown sign')
      await new Promise((r) => setTimeout(r, a.delay))
      if (data.oosResolveMerchantData !== undefined) return resolveAnswer({ xid: a.xid, mac: a.mac })
      return { ...tranAnswer, hostlogkey: `HLK${a.xid}` }
    })
    const gateway = realGateway(fetchImpl)
    const orderBD: PosOrder = { ...orderO, id: '2020110828BD' }

    const [a, b] = await Promise.all([
      pay3D(gateway, orderO, { ...callbackC, Sign: 'AAAA1111' }),
      pay3D(gateway, orderBD, { ...callbackC, Sign: 'BBBB2222' }),
    ])

    expect(a.order_id).toBe('2020110828BC')
    expect(a.ref_ret_num).toBe('HLK000000002020110828BC')
    expect(b.order_id).toBe('2020110828BD')
    expect(b.ref_ret_num).toBe('HLK000000002020110828BD')
    const tranMac = (sign: string) =>
      posted.find((p) => p.data.oosTranData?.sign === sign)?.data.oosTranData.mac as string
    expect(tranMac('AAAA1111')).toBe(requestMac('000000002020110828BC', '10001'))
    expect(tranMac('BBBB2222')).toBe(requestMac('000000002020110828BD', '10001'))
    expect(posted).toHaveLength(4)
    expect('isSuccess' in gateway).toBe(false)
  })

  // addition: P23 nothing secret reaches the logger
  it('never logs the key, the first hash, a MAC, the card number or the CVC', async () => {
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
    const { fetchImpl } = fakeBank((data) => {
      if (data.oosRequestData !== undefined)
        return { approved: '1', respCode: '', respText: '', oosRequestDataResponse }
      if (data.oosResolveMerchantData !== undefined) return resolveAnswer()
      if (data.oosTranData !== undefined) return tranAnswer
      return { approved: '1', respCode: '', respText: '', hostlogkey: '0000000002P0806031', authCode: '901477' }
    })
    const hooks: PosHooks = {
      onRequestDataPrepared: [
        (e) => {
          e.requestData.changedByHook = '1'
        },
      ],
    }
    const gateway = realGateway(fetchImpl, { logger, hooks })
    const formCard = CreditCardFactory.create('5555444433332222', '22', '01', '123', 'ahmet')

    await gateway.get3DFormData(
      { ...orderO, id: 'TST_190620093100_024', success_url: 'https://domain.com/success' },
      MODEL.THREE_D_SECURE,
      TX_TYPE.PAY_AUTH,
      formCard,
    )
    await pay3D(gateway, orderO, callbackC)
    await pay3D(gateway, orderO, callbackC).catch(() => undefined)
    await gateway.payment(MODEL.NON_SECURE, { id: '2020110828BE', amount: 1.75 }, TX_TYPE.PAY_AUTH, formCard)

    const logged = JSON.stringify(records)
    expect(records.length).toBeGreaterThan(0)
    expect(logged).not.toContain(ENC_KEY)
    expect(logged).not.toContain(F)
    expect(logged).not.toContain(RESOLVE_REQUEST_MAC)
    expect(logged).not.toContain(E1)
    expect(logged).not.toContain('5555444433332222')
    expect(logged).not.toMatch(/"cvc"\s*:\s*"?123/)
    expect(logged).not.toContain('<cvc>123</cvc>')
    expect(logged).not.toMatch(/"expDate"\s*:\s*"2201"/)
    expect(logged).not.toContain('<expDate>2201</expDate>')
    // the hook below changes every request, so the logged before/after request data was masked too
    expect(logged).toContain('Request data is changed via listeners')
  })
})

describe('PosNetPos (end to end) unknown outcome after a money request', () => {
  const UNKNOWN = 'Bank answer carries no result; the outcome is unknown'
  const resultless: Array<[string, () => Data | Response]> = [
    ['HTTP 204', () => new Response(null, { status: 204 })],
    ['an empty root', () => ({})],
    [
      'a record without approved',
      () => ({ respCode: '', respText: '', hostlogkey: '0000000002P0806031', authCode: '901477' }),
    ],
    ['an empty approved', () => ({ ...tranAnswer, approved: '' })],
    ['a blank approved', () => ({ ...tranAnswer, approved: ' ' })],
    ['approved twice', () => ({ ...tranAnswer, approved: ['1', '1'] })],
    ['a nested approved', () => ({ ...tranAnswer, approved: { value: '1' } })],
  ]
  const saleCard = (p: PosNetPos) =>
    CreditCardFactory.createForGateway(p, '5555444433332222', '21', '12', '122', 'ahmet')
  const order: PosOrder = { ...orderO, ref_ret_num: '0000000002P0806031' }

  // addition: L3 a sale, pre-/post-authorization or refund whose answer carries no result is an unknown outcome
  it.each(resultless)(
    'a sale, pre-/post-auth and full/partial refund answered with %s are PosHttpError',
    async (_n, answer) => {
      const actions: Array<(p: PosNetPos) => Promise<unknown>> = [
        (p) => p.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, saleCard(p)),
        (p) => p.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_PRE_AUTH, saleCard(p)),
        (p) => p.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_POST_AUTH),
        (p) => p.refund(order),
        (p) => p.refund({ ...order, amount: 50, order_amount: 100.01 }),
      ]
      for (const action of actions) {
        const { posted, fetchImpl } = fakeBank(answer)
        const err = await action(realGateway(fetchImpl)).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(PosHttpError)
        expect([(err as PosHttpError).message, (err as PosHttpError).url]).toStrictEqual([UNKNOWN, PAYMENT_API])
        expect(posted).toHaveLength(1)
      }
    },
  )

  // addition: L3 the provision answer of the 3D flow is checked before it is mapped
  it.each(resultless)('a 3D provision answered with %s is PosHttpError, never mapped', async (_n, answer) => {
    const { posted, fetchImpl } = fakeBank((data) =>
      data.oosResolveMerchantData !== undefined ? resolveAnswer() : answer(),
    )
    const mapped = vi.spyOn(PosNetPosResponseDataMapper.prototype, 'map3DPaymentData')
    try {
      const err = await pay3D(realGateway(fetchImpl), orderO, callbackC).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PosHttpError)
      expect([(err as PosHttpError).message, (err as PosHttpError).url]).toStrictEqual([UNKNOWN, PAYMENT_API])
      expect(posted.map((p) => Object.keys(p.data).at(-1))).toStrictEqual(['oosResolveMerchantData', 'oosTranData'])
      expect(mapped).not.toHaveBeenCalled()
    } finally {
      mapped.mockRestore()
    }
  })

  // addition: L3 a genuine decline with a result code is still a decline; a cancel moves no new money
  it('a sale and a provision declined with approved 0 are declined; a cancel answered with 204 too', async () => {
    const declined = { approved: '0', respCode: '0127', respText: 'ORDERID DAHA ONCE KULLANILMIS' }
    const sale = await realGateway(fakeBank(() => declined).fetchImpl).payment(
      MODEL.NON_SECURE,
      order,
      TX_TYPE.PAY_AUTH,
      CreditCardFactory.create('5555444433332222', '21', '12', '122', 'ahmet'),
    )
    expect([sale.status, sale.proc_return_code, sale.error_code]).toStrictEqual(['declined', '0', '0127'])

    const provision = await pay3D(realGateway(threeDBank(resolveAnswer(), declined).fetchImpl), orderO, callbackC)
    expect([provision.status, provision.error_code]).toStrictEqual(['declined', '0127'])

    const cancel = await realGateway(fakeBank(() => new Response(null, { status: 204 })).fetchImpl).cancel(order)
    expect(cancel.status).toBe('declined')
  })
})
