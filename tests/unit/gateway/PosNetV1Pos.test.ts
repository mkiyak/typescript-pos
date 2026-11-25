import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PosNetV1PosHttpClient } from '../../../src/client/PosNetV1PosHttpClient.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { PosNetV1PosCrypt } from '../../../src/crypt/PosNetV1PosCrypt.js'
import { PosNetV1PosRequestDataMapper } from '../../../src/data-mapper/request/mapper/PosNetV1PosRequestDataMapper.js'
import type { RequestDataMapperInterface } from '../../../src/data-mapper/request/mapper/RequestDataMapperInterface.js'
import { PosNetV1PosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/PosNetV1PosRequestValueFormatter.js'
import { PosNetV1PosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/PosNetV1PosRequestValueMapper.js'
import { PosNetV1PosResponseDataMapper } from '../../../src/data-mapper/response/mapper/PosNetV1PosResponseDataMapper.js'
import type { ResponseDataMapperInterface } from '../../../src/data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { PosNetPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/PosNetPosResponseValueFormatter.js'
import { PosNetV1PosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PosNetV1PosResponseValueMapper.js'
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
import { PosNetV1Pos } from '../../../src/gateway/PosNetV1Pos.js'
import type { PosLogger } from '../../../src/logger.js'
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
import type { GatewayResponseData, PosHooks, PosOrder, RequestDataPreparedEvent } from '../../../src/types.js'
import {
  SUCCESS_3D_CALLBACK,
  threeDPaymentDataProvider,
} from '../data-mapper/response/mapper/PosNetV1PosResponseDataMapper.data.js'

// Dependencies are replaced by vi.fn() fakes except the request value mapper and formatter (the order binding uses
// them); the end-to-end sections at the bottom use the real mappers, crypt and HTTP client over a fake fetch that
// speaks the bank's JSON protocol.

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

const PAYMENT_API = 'https://epostest.albarakaturk.com.tr/ALBMerchantService/MerchantJSONAPI.svc'
const GATEWAY_3D = 'https://epostest.albarakaturk.com.tr/ALBSecurePaymentUI/SecureProcess/SecureVerification.aspx'

const config: GatewayConfig = {
  name: 'Albaraka',
  class: 'PosNetV1Pos',
  gateway_endpoints: { payment_api: PAYMENT_API, gateway_3d: GATEWAY_3D },
}

/** `disable_3d_hash_check` is not an option; passing it must have no effect. */
const configWithHashCheckDisabled = {
  ...config,
  gateway_configs: { disable_3d_hash_check: true },
} as unknown as GatewayConfig

const ENC_KEY = '10,10,10,10,10,10,10,10'
const MERCHANT_ID = '6700950031'
const TERMINAL_ID = '67540050'

const createAccount = (merchantId = MERCHANT_ID): PosNetPosAccount =>
  AccountFactory.createPosNetPosAccount('albaraka', merchantId, TERMINAL_ID, '1010028724242434', ENC_KEY)

const createLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })

/** base64(SHA-256(text)), the bank's MAC primitive. */
const H = (text: string): string => createHash('sha256').update(text, 'utf8').digest('base64')

function fixture(name: string): Data {
  const found = threeDPaymentDataProvider.find(([n]) => n === name)
  if (found === undefined) throw new Error(`missing fixture ${name}`)
  return { ...found[1].threeDResponseData }
}

/** The declined bank callback (3D authentication failed), signed with the public test key. */
const AUTH_FAIL_CALLBACK: Data = fixture('3d_auth_fail_1')
/** A successful 3D authentication of merchant 6702640212 whose provision the bank refused. */
const PAYMENT_FAIL_CALLBACK: Data = fixture('3d_auth_success_payment_fail')
/** Synthetic: the success callback with `MdStatus '2'` under the success MAC. */
const HALF_3D_CALLBACK: Data = fixture('half_3d_secure')
const SUCCESS_CALLBACK: Data = { ...SUCCESS_3D_CALLBACK }

/** The bank's answer to the provision of the success callback. */
const SUCCESS_PAYMENT_RESPONSE: Data = {
  ServiceResponseData: { ResponseCode: '00', ResponseDescription: 'Onaylandı' },
  AuthCode: '449324',
  ReferenceCode: '159044932490000231',
  PointDataList: [{ PointType: 'EarnedPoint', Point: 1000, PointTLAmount: 500 }],
}

const FAIL_PAYMENT_RESPONSE: Data = {
  ServiceResponseData: { ResponseCode: '0148', ResponseDescription: 'INVALID MID TID IP. Hatalı IP:92.38.180.61' },
}

const SUCCESS_ORDER: PosOrder = { id: 'ALA_0000080603153823', amount: 1.75, currency: CURRENCY.TRY }
const AUTH_FAIL_ORDER: PosOrder = { id: '20230622A1C9', amount: 1.01 }
const PAYMENT_FAIL_ORDER: PosOrder = { id: '202306226A90', amount: 1.01 }

/** The callback MAC over the fixed field list, recomputed for test data. */
const signCallback = (cb: Data, fields = ['ECI', 'CAVV', 'MdStatus', 'MdErrorMessage', 'MD', 'SecureTransactionId']) =>
  H(fields.map((f) => (cb[f] === null || cb[f] === undefined ? '' : String(cb[f]))).join('') + ENC_KEY)

/**
 * PoC VP4: the declined callback re-split so that `MdStatus` reads 1. The joined signed string is unchanged, so
 * the bank's genuine MAC still verifies.
 */
const VP4_CALLBACK: Data = {
  ...AUTH_FAIL_CALLBACK,
  ECI: '07',
  CAVV: '0Not authenticated0',
  MdStatus: '1',
  MdErrorMessage: '',
  MD: '61010063138198543',
  SecureTransactionId: '1010063138198543',
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

describe('PosNetV1Pos (mocked collaborators)', () => {
  const account = createAccount()
  let requestValueMapper: PosNetV1PosRequestValueMapper
  let requestMapper: Mocked<RequestDataMapperInterface>
  let responseMapper: Mocked<ResponseDataMapperInterface>
  let crypt: Mocked<CryptInterface>
  let httpClient: { supportsTx: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }
  let clientStrategy: { getClient: ReturnType<typeof vi.fn>; getAllClients: ReturnType<typeof vi.fn> }
  let requestDataPrepared: ReturnType<typeof vi.fn<(e: RequestDataPreparedEvent) => void>>
  let logger: ReturnType<typeof createLogger>
  let pos: PosNetV1Pos

  const deps = (): GatewayDeps<PosNetPosAccount> => ({
    requestValueMapper,
    requestValueFormatter: new PosNetV1PosRequestValueFormatter(),
    requestDataMapper: requestMapper as unknown as RequestDataMapperInterface<PosNetPosAccount>,
    responseDataMapper: responseMapper as unknown as ResponseDataMapperInterface,
    crypt: crypt as unknown as CryptInterface<PosNetPosAccount>,
    clientStrategy: clientStrategy as unknown as HttpClientStrategy,
    logger,
    hooks: { onRequestDataPrepared: [requestDataPrepared] } satisfies PosHooks,
  })

  const createGateway = (cfg: GatewayConfig, acc: PosNetPosAccount = account): PosNetV1Pos =>
    new PosNetV1Pos(cfg, acc, deps())

  beforeEach(() => {
    requestValueMapper = new PosNetV1PosRequestValueMapper()
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
      expect(event.gatewayClass).toBe('PosNetV1Pos')
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

  // addition: identifiers and the supported transactions table
  it('exposes NAME, the gateway class identifier and the supported transactions', () => {
    expect(PosNetV1Pos.NAME).toBe('PosNetV1')
    expect(PosNetV1Pos.GATEWAY_CLASS).toBe('PosNetV1Pos')
    for (const tx of [TX_TYPE.PAY_AUTH, TX_TYPE.PAY_PRE_AUTH]) {
      expect(PosNetV1Pos.isSupportedTransaction(tx, MODEL.THREE_D_SECURE)).toBe(true)
      expect(PosNetV1Pos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(true)
      expect(PosNetV1Pos.isSupportedTransaction(tx, MODEL.THREE_D_PAY)).toBe(false)
      expect(PosNetV1Pos.isSupportedTransaction(tx, MODEL.THREE_D_HOST)).toBe(false)
      expect(PosNetV1Pos.isSupportedTransaction(tx, MODEL.THREE_D_PAY_HOSTING)).toBe(false)
    }
    for (const tx of [TX_TYPE.PAY_POST_AUTH, TX_TYPE.STATUS, TX_TYPE.CANCEL, TX_TYPE.REFUND, TX_TYPE.REFUND_PARTIAL]) {
      expect(PosNetV1Pos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(true)
    }
    expect(PosNetV1Pos.isSupportedTransaction(TX_TYPE.ORDER_HISTORY, MODEL.NON_SECURE)).toBe(false)
  })

  // addition: the order binding needs the padded order number of the POSNET formatter
  it('rejects a request value formatter without formatOrderId', () => {
    expect(
      () =>
        new PosNetV1Pos(config, account, {
          ...deps(),
          requestValueFormatter: { formatInstallment: vi.fn(), formatAmount: vi.fn() } as never,
        }),
    ).toThrow(new PosError('PosNetV1Pos needs a request value formatter with formatOrderId'))
  })

  describe('get3DFormData', () => {
    it('get3DFormData with card', async () => {
      const order = { id: '124' }
      const c = card()
      requestMapper.create3DFormData.mockResolvedValue({ formData: true })

      const actual = await pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, c, false)

      expect(requestMapper.create3DFormData).toHaveBeenCalledTimes(1)
      expect(requestMapper.create3DFormData).toHaveBeenCalledWith(
        account,
        order,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        GATEWAY_3D,
        c,
      )
      expect(actual).toStrictEqual({ formData: true })
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
        'PosNetV1Pos supports [3d, regular] payment model(s) for transaction type [pay]. Provided payment model: [3d_pay].',
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
        expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
      },
    )

    // addition: the bank-page variant builds the form without a card
    it('builds the form without a card when createWithoutCard is set', async () => {
      const order = { id: '124' }
      requestMapper.create3DFormData.mockResolvedValue({ formData: true })

      await pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, null, true)

      expect(requestMapper.create3DFormData).toHaveBeenCalledWith(
        account,
        order,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        GATEWAY_3D,
        null,
      )
    })
  })

  describe('make3DPayment', () => {
    // deviation: P14/P16 the callbacks are the full bank fixtures (the signed fields and the echoes the binding
    // needs) and the orders match their echoes; P15 a declined callback carrying a Mac is verified too
    const rows: Array<[string, PosOrder, Data, Data, Data, boolean, PosNetPosAccount]> = [
      [
        'auth_fail',
        AUTH_FAIL_ORDER,
        AUTH_FAIL_CALLBACK,
        {},
        {
          masked_number: '450634',
          md_status: '0',
          md_error_message: 'Not authenticated',
          order_id: '20230622A1C9',
          remote_order_id: '0000000020230622A1C9',
          status: 'declined',
        },
        false,
        account,
      ],
      [
        '3d_auth_success_payment_fail',
        PAYMENT_FAIL_ORDER,
        PAYMENT_FAIL_CALLBACK,
        FAIL_PAYMENT_RESPONSE,
        {
          error_code: '0148',
          error_message: 'INVALID MID TID IP. Hatalı IP:92.38.180.61',
          order_id: '202306226A90',
          remote_order_id: '00000000202306226A90',
          proc_return_code: '0148',
          status: 'declined',
        },
        true,
        createAccount('6702640212'),
      ],
      [
        'success',
        SUCCESS_ORDER,
        SUCCESS_CALLBACK,
        SUCCESS_PAYMENT_RESPONSE,
        { proc_return_code: '00', status: 'approved' },
        true,
        account,
      ],
    ]

    const run3DPayment = async (
      cfg: GatewayConfig,
      order: PosOrder,
      callback: Data,
      paymentResponse: Data,
      expected: Data,
      is3DSuccess: boolean,
      acc: PosNetPosAccount,
    ) => {
      const gateway = createGateway(cfg, acc)
      const txType = TX_TYPE.PAY_AUTH
      crypt.check3DHash.mockReturnValue(true)
      responseMapper.extractMdStatus.mockReturnValue('3d-status')
      responseMapper.is3dAuthSuccess.mockReturnValue(is3DSuccess)
      responseMapper.map3DPaymentData.mockReturnValue(expected)
      const requestData = { create3DPaymentRequestData: true }
      let verify = () => {}
      if (is3DSuccess) {
        requestMapper.create3DPaymentRequestData.mockReturnValue(requestData)
        verify = configureClientResponse(txType, requestData, paymentResponse, order, MODEL.THREE_D_SECURE)
      }

      const result = await gateway.payment(MODEL.THREE_D_SECURE, order, txType, null, callback as GatewayResponseData)

      expect(result).toBe(expected)
      expect(responseMapper.extractMdStatus).toHaveBeenCalledTimes(1)
      expect(responseMapper.extractMdStatus).toHaveBeenCalledWith(callback)
      expect(responseMapper.is3dAuthSuccess).toHaveBeenCalledTimes(1)
      expect(responseMapper.is3dAuthSuccess).toHaveBeenCalledWith('3d-status')
      expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
      expect(crypt.check3DHash).toHaveBeenCalledWith(acc, callback)
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledTimes(1)
      if (is3DSuccess) {
        expect(requestMapper.create3DPaymentRequestData).toHaveBeenCalledTimes(1)
        expect(requestMapper.create3DPaymentRequestData).toHaveBeenCalledWith(acc, order, txType, callback)
        verify()
        expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(callback, paymentResponse, txType, order)
      } else {
        expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(callback, null, txType, order)
        expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
        expect(requestDataPrepared).not.toHaveBeenCalled()
        expect(httpClient.request).not.toHaveBeenCalled()
      }
      // deviation: Q6 no isSuccess() state
      expect('isSuccess' in gateway).toBe(false)
    }

    it.each(rows)('make3DPayment %s', async (_name, order, callback, paymentResponse, expected, success, acc) => {
      await run3DPayment(config, order, callback, paymentResponse, expected, success, acc)
    })

    // deviation: P15 disable_3d_hash_check is ignored: the MAC is still checked once
    it.each(rows.slice(1))(
      'make3DPayment without hash check %s',
      async (_name, order, callback, paymentResponse, expected, success, acc) => {
        await run3DPayment(configWithHashCheckDisabled, order, callback, paymentResponse, expected, success, acc)
      },
    )

    it('make3DPayment hash mismatch', async () => {
      const callback = {
        SecureTransactionId: '1010028947569644',
        Mac: 'r21kMm4nMqvJakjq47Jl+3fk2xrFPrDoTJFQGxkgkfk=',
        MacParams: 'ECI:CAVV:MdStatus:MdErrorMessage:MD:SecureTransactionId',
        CurrencyCode: '949',
        InstalmentCode: '0',
        VtfCode: '',
        PointAmount: '',
      }
      crypt.check3DHash.mockReturnValue(false)
      responseMapper.is3dAuthSuccess.mockReturnValue(true)

      await expectRejection(
        pos.payment(MODEL.THREE_D_SECURE, {}, TX_TYPE.PAY_AUTH, null, callback),
        HashMismatchError,
        '3D callback hash mismatch',
      )
      expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
      expect(crypt.check3DHash).toHaveBeenCalledWith(account, callback)
      expect(responseMapper.map3DPaymentData).not.toHaveBeenCalled()
      expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
      expect(requestDataPrepared).not.toHaveBeenCalled()
    })

    // addition: P15 fail-closed guard: a not-successful callback never comes back approved
    it('rejects a not-successful callback the mapper does not map as declined', async () => {
      responseMapper.is3dAuthSuccess.mockReturnValue(false)
      crypt.check3DHash.mockReturnValue(true)
      responseMapper.map3DPaymentData.mockReturnValue({ status: 'approved', order_id: '20230622A1C9' })

      await expectRejection(
        pos.payment(MODEL.THREE_D_SECURE, AUTH_FAIL_ORDER, TX_TYPE.PAY_AUTH, null, AUTH_FAIL_CALLBACK),
        PosError,
        '3D callback without 3D success was not mapped as declined',
      )
      expect(httpClient.request).not.toHaveBeenCalled()
    })

    // addition: P16 the binding runs before the provision request and the hook
    it('binds the callback echoes before any provision request', async () => {
      crypt.check3DHash.mockReturnValue(true)
      responseMapper.is3dAuthSuccess.mockReturnValue(true)
      const err = await expectRejection(
        pos.payment(MODEL.THREE_D_SECURE, { ...SUCCESS_ORDER, amount: 1.76 }, TX_TYPE.PAY_AUTH, null, SUCCESS_CALLBACK),
        OrderMismatchError,
      )
      expect((err as OrderMismatchError).field).toBe('amount')
      expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
      expect(requestDataPrepared).not.toHaveBeenCalled()
      expect(httpClient.request).not.toHaveBeenCalled()
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

  it.each([
    [{ id: '2020110828BC' }, TX_TYPE.PAY_AUTH],
    [{ id: '2020110828BC' }, TX_TYPE.PAY_PRE_AUTH],
  ] as Array<[PosOrder, TxType]>)('makeRegularPayment %o %s', async (order, txType) => {
    const c = card()
    const requestData = { createNonSecurePaymentRequestData: true }
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue(requestData)
    const decoded = { decodedData: true }
    const verify = configureClientResponse(txType, requestData, decoded, order, MODEL.NON_SECURE)
    responseMapper.mapPaymentResponse.mockReturnValue({ result: true })

    await pos.payment(MODEL.NON_SECURE, order, txType, c)

    expect(requestMapper.createNonSecurePaymentRequestData).toHaveBeenCalledWith(account, order, txType, c)
    verify()
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith(decoded, txType, order)
  })

  it('makeRegularPostAuthPayment', async () => {
    const order = { id: '2020110828BC' }
    const txType = TX_TYPE.PAY_POST_AUTH
    const requestData = { createNonSecurePostAuthPaymentRequestData: true }
    requestMapper.createNonSecurePostAuthPaymentRequestData.mockReturnValue(requestData)
    const decoded = { decodedData: true }
    const verify = configureClientResponse(txType, requestData, decoded, order, MODEL.NON_SECURE)
    responseMapper.mapPaymentResponse.mockReturnValue({ result: true })

    await pos.payment(MODEL.NON_SECURE, order, txType)

    expect(requestMapper.createNonSecurePostAuthPaymentRequestData).toHaveBeenCalledWith(account, order)
    verify()
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith(decoded, txType, order)
  })

  it('status request', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { createStatusRequestData: true }
    requestMapper.createStatusRequestData.mockReturnValue(requestData)
    const decoded = { decodedData: true }
    const verify = configureClientResponse(TX_TYPE.STATUS, requestData, decoded, order, MODEL.NON_SECURE)
    responseMapper.mapStatusResponse.mockReturnValue({ result: true })

    await pos.status(order)

    expect(requestMapper.createStatusRequestData).toHaveBeenCalledWith(account, order)
    verify()
    expect(responseMapper.mapStatusResponse).toHaveBeenCalledWith(decoded)
  })

  it('cancel request', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { createCancelRequestData: true }
    requestMapper.createCancelRequestData.mockReturnValue(requestData)
    const decoded = { decodedData: true }
    const verify = configureClientResponse(TX_TYPE.CANCEL, requestData, decoded, order, MODEL.NON_SECURE)
    responseMapper.mapCancelResponse.mockReturnValue({ result: true })

    await pos.cancel(order)

    expect(requestMapper.createCancelRequestData).toHaveBeenCalledWith(account, order)
    verify()
    expect(responseMapper.mapCancelResponse).toHaveBeenCalledWith(decoded)
  })

  it('refund request', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { createRefundRequestData: true }
    requestMapper.createRefundRequestData.mockReturnValue(requestData)
    const decoded = { decodedData: true }
    const verify = configureClientResponse(TX_TYPE.REFUND, requestData, decoded, order, MODEL.NON_SECURE)
    responseMapper.mapRefundResponse.mockReturnValue({ result: true })

    await pos.refund(order)

    expect(requestMapper.createRefundRequestData).toHaveBeenCalledWith(account, order, TX_TYPE.REFUND)
    verify()
    expect(responseMapper.mapRefundResponse).toHaveBeenCalledWith(decoded)
  })

  it('order history request', async () => {
    await expectRejection(pos.orderHistory({}), UnsupportedTransactionTypeError)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// End to end: real mappers, real crypt and the real JSON client over a fake fetch.

type Posted = { url: string; body: Data }

/** A fake POSNET JSON endpoint; `answer === null` means no request is expected. */
function fakeBank(answer: ((body: Data, url: string) => Data | Response | Promise<Data | Response>) | null = null) {
  const posted: Posted[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Data
    posted.push({ url: String(url), body })
    if (answer === null) {
      throw new Error('no network expected')
    }
    const out = await answer(body, String(url))
    return out instanceof Response ? out : new Response(JSON.stringify(out))
  }) as unknown as typeof fetch

  return { posted, fetchImpl }
}

function realGateway(
  fetchImpl: typeof fetch,
  options: { cfg?: GatewayConfig; logger?: PosLogger; hooks?: PosHooks; account?: PosNetPosAccount } = {},
): PosNetV1Pos {
  const log = options.logger ?? createLogger()
  const cryptImpl = new PosNetV1PosCrypt(log)
  const valueMapper = new PosNetV1PosRequestValueMapper()
  const valueFormatter = new PosNetV1PosRequestValueFormatter()
  const hooks: PosHooks = options.hooks ?? {}
  const deps: GatewayDeps<PosNetPosAccount> = {
    requestValueMapper: valueMapper,
    requestValueFormatter: valueFormatter,
    requestDataMapper: new PosNetV1PosRequestDataMapper(valueMapper, valueFormatter, hooks, cryptImpl),
    responseDataMapper: new PosNetV1PosResponseDataMapper(
      new PosNetPosResponseValueFormatter(),
      new PosNetV1PosResponseValueMapper(),
      log,
    ),
    crypt: cryptImpl,
    clientStrategy: new HttpClientStrategy([
      new PosNetV1PosHttpClient(PAYMENT_API, new HttpTransport({ fetch: fetchImpl }), log, valueMapper),
    ]),
    logger: log,
    hooks,
  }

  return new PosNetV1Pos(options.cfg ?? config, options.account ?? createAccount(), deps)
}

const pay3D = (gateway: PosNetV1Pos, order: PosOrder, callback: Data, txType: TxType = TX_TYPE.PAY_AUTH) =>
  gateway.payment(MODEL.THREE_D_SECURE, order, txType, null, callback as GatewayResponseData)

describe('PosNetV1Pos (end to end) 3D payment', () => {
  it('has consistent planning vectors', () => {
    expect(signCallback(SUCCESS_CALLBACK)).toBe(SUCCESS_CALLBACK.Mac)
    expect(signCallback(AUTH_FAIL_CALLBACK)).toBe(AUTH_FAIL_CALLBACK.Mac)
    expect(signCallback(PAYMENT_FAIL_CALLBACK)).toBe(PAYMENT_FAIL_CALLBACK.Mac)
    // VP4 re-splits the declined callback without changing the signed string
    expect(signCallback(VP4_CALLBACK)).toBe(AUTH_FAIL_CALLBACK.Mac)
    expect(new PosNetV1PosCrypt().check3DHash(createAccount(), VP4_CALLBACK as GatewayResponseData)).toBe(true)
  })

  // addition: the full success flow, one provision request built from the order and the callback's 3D session
  it('provisions a successful callback', async () => {
    const { posted, fetchImpl } = fakeBank(() => SUCCESS_PAYMENT_RESPONSE)
    const order: PosOrder = { ...SUCCESS_ORDER, installment: 0 }

    const result = await pay3D(realGateway(fetchImpl), order, SUCCESS_CALLBACK)

    expect(posted).toHaveLength(1)
    const [request] = posted as [Posted]
    expect(request.url).toBe(`${PAYMENT_API}/Sale`)
    expect(request.body.MAC).toBe('kAKxvbwXvmrM6lapGx1UcRTs454tsSuPrBXV7oA7L7w=')
    expect(request.body.ThreeDSecureData).toStrictEqual({
      SecureTransactionId: '1010028947569644',
      CavvData: 'jKOBaLBL3hQ+CREBPu1HBQQAAAA=',
      Eci: '02',
      MdStatus: 1,
      MD: '0161010028947569644,0161010028947569644',
    })
    expect(request.body.Amount).toBe(175)
    expect(request.body.CurrencyCode).toBe('TL')
    expect(request.body.OrderId).toBe('ALA_0000080603153823')
    expect(request.body.InstallmentCount).toBe('0')
    expect(request.body.InstallmentType).toBe('N')
    expect(request.body.MerchantNo).toBe(MERCHANT_ID)
    expect(request.body.TerminalNo).toBe(TERMINAL_ID)
    expect(result.status).toBe('approved')
    expect(result.auth_code).toBe('449324')
    expect(result.ref_ret_num).toBe('159044932490000231')
    expect(result.md_status).toBe('1')
    expect(result.order_id).toBe('ALA_0000080603153823')
    expect(result.amount).toBe(1.75)
    expect(result.currency).toBe(CURRENCY.TRY)
  })

  // addition: a successful 3D leg whose provision the bank refuses is a plain decline
  it('maps a refused provision as declined', async () => {
    const { posted, fetchImpl } = fakeBank(() => FAIL_PAYMENT_RESPONSE)

    const result = await pay3D(
      realGateway(fetchImpl, { account: createAccount('6702640212') }),
      PAYMENT_FAIL_ORDER,
      PAYMENT_FAIL_CALLBACK,
    )

    expect(posted).toHaveLength(1)
    expect(result.status).toBe('declined')
    expect(result.proc_return_code).toBe('0148')
    expect(result.requires_manual_review).toBeUndefined()
  })
})

describe('PosNetV1Pos (end to end) forged callbacks', () => {
  const expectNoProvision = async (
    callback: Data,
    order: PosOrder,
    errorClass: new (...args: never[]) => Error,
    message?: string,
  ): Promise<Error> => {
    const hook = vi.fn()
    const { posted, fetchImpl } = fakeBank()
    const err = await expectRejection(
      pay3D(realGateway(fetchImpl, { hooks: { onRequestDataPrepared: [hook] } }), order, callback),
      errorClass,
      message,
    )
    expect(posted).toHaveLength(0)
    expect(hook).not.toHaveBeenCalled()
    return err
  }

  // addition: P14 VP4, the declined callback re-split into MdStatus 1 keeps its genuine MAC
  it('rejects the re-split declined callback (VP4)', async () => {
    await expectNoProvision(VP4_CALLBACK, AUTH_FAIL_ORDER, HashMismatchError, '3D callback fields are malformed')
  })

  // addition: P13 the callback cannot choose the signed field list
  it('rejects a callback that names a subset of the signed fields', async () => {
    const forged: Data = { ...SUCCESS_CALLBACK, MacParams: 'MdStatus:SecureTransactionId' }
    forged.Mac = signCallback(forged, ['MdStatus', 'SecureTransactionId'])
    await expectNoProvision(forged, SUCCESS_ORDER, HashMismatchError, '3D callback hash mismatch')
  })

  // addition: P13 the signed field order is fixed too
  it('rejects a callback that reorders the signed fields', async () => {
    const order = ['CAVV', 'ECI', 'MdStatus', 'MdErrorMessage', 'MD', 'SecureTransactionId']
    const forged: Data = { ...SUCCESS_CALLBACK, MacParams: order.join(':') }
    forged.Mac = signCallback(forged, order)
    await expectNoProvision(forged, SUCCESS_ORDER, HashMismatchError, '3D callback hash mismatch')
  })

  // addition: P13 the MAC comparison is exact
  it('rejects a lower-cased Mac', async () => {
    const forged = { ...SUCCESS_CALLBACK, Mac: SUCCESS_CALLBACK.Mac.toLowerCase() }
    await expectNoProvision(forged, SUCCESS_ORDER, HashMismatchError, '3D callback hash mismatch')
  })

  // addition: P15 a successful callback must be signed
  it('rejects a successful callback without Mac', async () => {
    const { Mac: _omitted, ...unsigned } = SUCCESS_CALLBACK
    await expectNoProvision(unsigned, SUCCESS_ORDER, HashMismatchError, '3D callback hash mismatch')
  })

  // addition: P12 a nested value at the top level is refused before anything is read
  it.each([
    ['object', { ...SUCCESS_CALLBACK, CAVV: { a: 1 } }, 'CAVV'],
    ['array', { ...SUCCESS_CALLBACK, MdStatus: ['1'] }, 'MdStatus'],
    ['function', { ...SUCCESS_CALLBACK, Mac: () => SUCCESS_CALLBACK.Mac }, 'Mac'],
  ] as Array<[string, Data, string]>)('rejects a callback with a %s field', async (_name, forged, field) => {
    const err = await expectNoProvision(
      forged,
      SUCCESS_ORDER,
      PosError,
      `3D callback field "${field}" must be a string`,
    )
    expect(err).not.toBeInstanceOf(HashMismatchError)
  })

  // addition: P14 each signed format is pinned (MACs recomputed in the test, so only the format check can fail)
  it.each([
    ['ECI of one digit', { ECI: '2' }],
    ['ECI of three digits', { ECI: '020' }],
    ['CAVV without the trailing "="', { CAVV: 'jKOBaLBL3hQ+CREBPu1HBQQAAAAA' }],
    ['CAVV of 29 characters', { CAVV: 'jKOBaLBL3hQ+CREBPu1HBQQAAAAA=' }],
    ['CAVV null', { CAVV: null }],
    ['MD with letters', { MD: '0161010028947569644A' }],
    ['MD empty', { MD: '' }],
    ['SecureTransactionId with letters', { SecureTransactionId: '10100289475696X4' }],
    ['SecureTransactionId of 33 digits', { SecureTransactionId: '1'.repeat(33) }],
    ['MdErrorMessage longer than 512 characters', { MdErrorMessage: 'x'.repeat(513) }],
  ] as Array<[string, Data]>)('rejects a signed callback with %s', async (_name, change) => {
    const forged = { ...SUCCESS_CALLBACK, ...change }
    forged.Mac = signCallback(forged)
    expect(new PosNetV1PosCrypt().check3DHash(createAccount(), forged as GatewayResponseData)).toBe(true)
    await expectNoProvision(forged, SUCCESS_ORDER, HashMismatchError, '3D callback fields are malformed')
  })

  // addition: P14 the boundaries the bank does use are accepted (MAC recomputed in the test)
  it('accepts a signed callback with an empty MdErrorMessage and a 512-character one', async () => {
    for (const message of ['', 'x'.repeat(512)]) {
      const callback: Data = { ...SUCCESS_CALLBACK, MdErrorMessage: message }
      callback.Mac = signCallback(callback)
      const { posted, fetchImpl } = fakeBank(() => SUCCESS_PAYMENT_RESPONSE)
      const result = await pay3D(realGateway(fetchImpl), SUCCESS_ORDER, callback)
      expect(result.status).toBe('approved')
      expect(posted).toHaveLength(1)
    }
  })
})

// addition: a bank answer without a MdErrorMessage is accepted when the signature covers the empty value
describe('PosNetV1Pos (end to end) callback shape', () => {
  it.each([
    ['null', null],
    ['absent', undefined],
  ])('accepts a success callback with a %s MdErrorMessage', async (_name, message) => {
    const callback: Data = { ...SUCCESS_CALLBACK }
    if (message === undefined) {
      delete callback.MdErrorMessage
    } else {
      callback.MdErrorMessage = message
    }
    callback.Mac = signCallback(callback)
    const { posted, fetchImpl } = fakeBank(() => SUCCESS_PAYMENT_RESPONSE)

    const result = await pay3D(realGateway(fetchImpl), SUCCESS_ORDER, callback)

    expect(result.status).toBe('approved')
    expect(posted).toHaveLength(1)
  })

  it('refuses a nested value hidden in a non-enumerable property before any request', async () => {
    const callback: Data = { ...SUCCESS_CALLBACK }
    Object.defineProperty(callback, 'Hidden', { value: { a: 1 }, enumerable: false })
    const { posted, fetchImpl } = fakeBank(null)

    await expectRejection(pay3D(realGateway(fetchImpl), SUCCESS_ORDER, callback), PosError)
    expect(posted).toHaveLength(0)
  })
})

describe('PosNetV1Pos (end to end) order binding', () => {
  const expectMismatch = async (callback: Data, order: PosOrder, field: string, account = createAccount()) => {
    const { posted, fetchImpl } = fakeBank()
    const err = (await expectRejection(
      pay3D(realGateway(fetchImpl, { account }), order, callback),
      OrderMismatchError,
    )) as OrderMismatchError
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(false)
    expect(err.response).toBeUndefined()
    expect(posted).toHaveLength(0)
    return err
  }

  // addition: the order id is read as an existing id, so an array or object never turns into the id text
  it.each([[['2020110828BC']], [{}], [true], [1.5], [-1], [2 ** 53], ['2020110828BC\n'], ['a'.repeat(21)]])(
    'rejects the order id %j before any request',
    async (id) => {
      const { posted, fetchImpl } = fakeBank()
      const err = await expectRejection(
        pay3D(realGateway(fetchImpl), { ...SUCCESS_ORDER, id: id as never }, SUCCESS_CALLBACK),
        PosError,
      )
      expect((err as Error).message).toMatch(/^Order field "id"/)
      expect(posted).toHaveLength(0)
    },
  )

  // addition: an order created before the shared order-id rule is still bound exactly
  it('binds an existing order id with a leading "_" to the echoed order number', async () => {
    const err = await expectMismatch(SUCCESS_CALLBACK, { ...SUCCESS_ORDER, id: '_legacy1' }, 'order_id')
    expect([err.expected, err.actual]).toStrictEqual(['000000000000_legacy1', 'ALA_0000080603153823'])
  })

  // addition: P16 the echoed amount must be the order's amount in kuruş
  it('rejects another amount', async () => {
    const err = await expectMismatch({ ...SUCCESS_CALLBACK, Amount: '100' }, SUCCESS_ORDER, 'amount')
    expect([err.expected, err.actual]).toStrictEqual(['175', '100'])
  })

  // addition: P16 the echoed order number must be the order's padded id
  it('rejects another order number', async () => {
    const err = await expectMismatch(
      { ...SUCCESS_CALLBACK, OrderId: '0000000020230622A1C9' },
      SUCCESS_ORDER,
      'order_id',
    )
    expect([err.expected, err.actual]).toStrictEqual(['ALA_0000080603153823', '0000000020230622A1C9'])
  })

  // addition: P16 the order number and the amount are required echoes
  it('rejects a callback without OrderId or Amount', async () => {
    const { OrderId: _o, ...withoutOrderId } = SUCCESS_CALLBACK
    await expectMismatch(withoutOrderId, SUCCESS_ORDER, 'order_id')
    const { Amount: _a, ...withoutAmount } = SUCCESS_CALLBACK
    await expectMismatch(withoutAmount, SUCCESS_ORDER, 'amount')
  })

  // addition: P16 the echoed numeric currency must be the order's currency
  it('rejects another currency', async () => {
    const err = await expectMismatch({ ...SUCCESS_CALLBACK, CurrencyCode: '840' }, SUCCESS_ORDER, 'currency')
    expect([err.expected, err.actual]).toStrictEqual(['TRY', '840'])
    await expectMismatch(SUCCESS_CALLBACK, { ...SUCCESS_ORDER, currency: CURRENCY.USD }, 'currency')
    await expectMismatch({ ...SUCCESS_CALLBACK, CurrencyCode: 'TL' }, SUCCESS_ORDER, 'currency')
  })

  // addition: P16 the echoed transaction type must be the requested one
  it('rejects another transaction type', async () => {
    const err = await expectMismatch({ ...SUCCESS_CALLBACK, TranType: 'Auth' }, SUCCESS_ORDER, 'transaction_type')
    expect([err.expected, err.actual]).toStrictEqual(['Sale', 'Auth'])
  })

  // addition: P16 the real callback of another merchant
  it('rejects the callback of another merchant', async () => {
    const err = await expectMismatch(PAYMENT_FAIL_CALLBACK, PAYMENT_FAIL_ORDER, 'merchant_id')
    expect([err.expected, err.actual]).toStrictEqual([MERCHANT_ID, '6702640212'])
  })

  // addition: P16 optional echoes the bank leaves out are not compared
  it('accepts a callback without currency, merchant and transaction type', async () => {
    const { CurrencyCode: _c, MerchantId: _m, TranType: _t, ...partial } = SUCCESS_CALLBACK
    const { posted, fetchImpl } = fakeBank(() => SUCCESS_PAYMENT_RESPONSE)
    const result = await pay3D(realGateway(fetchImpl), SUCCESS_ORDER, partial)
    expect(result.status).toBe('approved')
    expect(posted).toHaveLength(1)
  })

  // addition: P16 a pre-authorisation callback for a pre-authorisation request
  it('accepts TranType Auth for a pre-authorisation', async () => {
    const { posted, fetchImpl } = fakeBank(() => SUCCESS_PAYMENT_RESPONSE)
    const result = await pay3D(
      realGateway(fetchImpl),
      SUCCESS_ORDER,
      { ...SUCCESS_CALLBACK, TranType: 'Auth' },
      TX_TYPE.PAY_PRE_AUTH,
    )
    expect(posted[0]?.url).toBe(`${PAYMENT_API}/Auth`)
    expect(result.status).toBe('approved')
    expect(result.transaction_type).toBe(TX_TYPE.PAY_PRE_AUTH)
  })

  // addition: P16 the order must carry an id and a positive amount before anything is sent
  it('requires the order id and a positive amount', async () => {
    const { posted, fetchImpl } = fakeBank()
    const gateway = realGateway(fetchImpl)
    await expectRejection(pay3D(gateway, { amount: 1.75 }, SUCCESS_CALLBACK), PosError, 'Order field "id" is required')
    await expectRejection(
      pay3D(gateway, { id: 'ALA_0000080603153823' }, SUCCESS_CALLBACK),
      PosError,
      'Order field "amount" is required',
    )
    await expectRejection(pay3D(gateway, { ...SUCCESS_ORDER, amount: 0 }, SUCCESS_CALLBACK), PosError)
    expect(posted).toHaveLength(0)
  })
})

describe('PosNetV1Pos (end to end) declined callbacks', () => {
  const requireHashConfig: GatewayConfig = { ...config, require_3d_hash: true }

  // addition: P15 the declined bank callback with its valid Mac
  it('maps the declined callback without any request', async () => {
    const { posted, fetchImpl } = fakeBank()
    const result = await pay3D(realGateway(fetchImpl), AUTH_FAIL_ORDER, AUTH_FAIL_CALLBACK)
    expect(result.status).toBe('declined')
    expect(result.md_status).toBe('0')
    expect(result.md_error_message).toBe('Not authenticated')
    expect(result.order_id).toBe('20230622A1C9')
    expect(posted).toHaveLength(0)
  })

  // addition: P15 a Mac on a declined callback must verify
  it('rejects the declined callback with an altered Mac', async () => {
    const { posted, fetchImpl } = fakeBank()
    await expectRejection(
      pay3D(realGateway(fetchImpl), AUTH_FAIL_ORDER, {
        ...AUTH_FAIL_CALLBACK,
        Mac: `A${AUTH_FAIL_CALLBACK.Mac.slice(1)}`,
      }),
      HashMismatchError,
      '3D callback hash mismatch',
    )
    expect(posted).toHaveLength(0)
  })

  // addition: P15 a declined callback with its Mac re-computed over another field list is still checked
  it('rejects the declined callback when it names another field list', async () => {
    const { fetchImpl } = fakeBank()
    await expectRejection(
      pay3D(realGateway(fetchImpl), AUTH_FAIL_ORDER, { ...AUTH_FAIL_CALLBACK, MacParams: 'MdStatus' }),
      HashMismatchError,
    )
  })

  // addition: P15 an unsigned decline is accepted, unless require_3d_hash is set
  it('maps an unsigned declined callback, or rejects it with require_3d_hash', async () => {
    const { Mac: _omitted, ...unsigned } = AUTH_FAIL_CALLBACK
    const { posted, fetchImpl } = fakeBank()

    const result = await pay3D(realGateway(fetchImpl), AUTH_FAIL_ORDER, unsigned)
    expect(result.status).toBe('declined')
    const emptyMac = await pay3D(realGateway(fetchImpl), AUTH_FAIL_ORDER, { ...AUTH_FAIL_CALLBACK, Mac: '' })
    expect(emptyMac.status).toBe('declined')

    await expectRejection(
      pay3D(realGateway(fetchImpl, { cfg: requireHashConfig }), AUTH_FAIL_ORDER, unsigned),
      HashMismatchError,
      '3D callback has no Mac',
    )
    // a signed decline is still accepted with require_3d_hash
    const signed = await pay3D(realGateway(fetchImpl, { cfg: requireHashConfig }), AUTH_FAIL_ORDER, AUTH_FAIL_CALLBACK)
    expect(signed.status).toBe('declined')
    expect(posted).toHaveLength(0)
  })

  // addition: P15 the synthetic half 3D fixture carries the success MAC over other values
  it('rejects the synthetic half 3D callback', async () => {
    const { posted, fetchImpl } = fakeBank()
    await expectRejection(
      pay3D(realGateway(fetchImpl), SUCCESS_ORDER, HALF_3D_CALLBACK),
      HashMismatchError,
      '3D callback hash mismatch',
    )
    expect(posted).toHaveLength(0)
  })

  // addition: P15 disable_3d_hash_check changes nothing
  it('ignores disable_3d_hash_check', async () => {
    const { posted, fetchImpl } = fakeBank()
    const gateway = realGateway(fetchImpl, { cfg: configWithHashCheckDisabled })
    await expectRejection(
      pay3D(gateway, AUTH_FAIL_ORDER, { ...AUTH_FAIL_CALLBACK, Mac: `A${AUTH_FAIL_CALLBACK.Mac.slice(1)}` }),
      HashMismatchError,
    )
    await expectRejection(pay3D(gateway, AUTH_FAIL_ORDER, VP4_CALLBACK), HashMismatchError)
    await expectRejection(pay3D(gateway, SUCCESS_ORDER, HALF_3D_CALLBACK), HashMismatchError)
    expect((await pay3D(gateway, AUTH_FAIL_ORDER, AUTH_FAIL_CALLBACK)).status).toBe('declined')
    expect(posted).toHaveLength(0)
  })

  // addition: P15 a status other than exactly "1" is never a 3D success
  it.each([[' 1'], ['1 '], ['01'], ['2'], ['']])('declines MdStatus %j', async (mdStatus) => {
    const callback: Data = { ...SUCCESS_CALLBACK, MdStatus: mdStatus }
    callback.Mac = signCallback(callback)
    const { posted, fetchImpl } = fakeBank()
    const result = await pay3D(realGateway(fetchImpl), SUCCESS_ORDER, callback)
    expect(result.status).toBe('declined')
    expect(posted).toHaveLength(0)
  })
})

describe('PosNetV1Pos (end to end) 3D form', () => {
  // addition: P12 the bank-page form (VP3): the card is typed on the bank's page
  it('builds the form without a card', async () => {
    const { posted, fetchImpl } = fakeBank()
    const form = await realGateway(fetchImpl).get3DFormData(
      { id: '2020110828BC', amount: 0.29, success_url: 'https://domain.com/success' },
      MODEL.THREE_D_SECURE,
      TX_TYPE.PAY_AUTH,
      null,
      true,
    )

    expect(form.gateway).toBe(GATEWAY_3D)
    expect(form.method).toBe('POST')
    expect(form.inputs.UseOOS).toBe('1')
    expect(form.inputs.Amount).toBe('29')
    expect(form.inputs.MacParams).toBe('MerchantNo:TerminalNo:Amount')
    expect(form.inputs.Mac).toBe('myI7crNpAToKnoldyv0Z9x89MhFu0Ix9EwOTpgxPqf0=')
    expect(form.inputs.CardNo).toBeUndefined()
    expect(posted).toHaveLength(0)
  })
})

describe('PosNetV1Pos (end to end) other transactions', () => {
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

  // addition: one instance serves concurrent requests; each body and response stays with its order
  it('keeps two concurrent cancels apart', async () => {
    const { posted, fetchImpl } = fakeBank(async (body) => {
      const orderId = body.OrderId as string
      await new Promise((r) => setTimeout(r, orderId.endsWith('A') ? 30 : 0))
      return {
        ServiceResponseData: { ResponseCode: orderId.endsWith('A') ? '00' : '0123', ResponseDescription: orderId },
      }
    })
    const gateway = realGateway(fetchImpl)

    const [a, b] = await Promise.all([gateway.cancel({ id: 'A' }), gateway.cancel({ id: 'B' })])

    const orderIdA = 'TDS_0000000000000000000A'
    const orderIdB = 'TDS_0000000000000000000B'
    const body = (orderId: string) => posted.find((p) => p.body.OrderId === orderId)?.body
    expect(body(orderIdA)?.MAC).toBe(H(`${MERCHANT_ID}${TERMINAL_ID}${orderIdA}${ENC_KEY}`))
    expect(body(orderIdB)?.MAC).toBe(H(`${MERCHANT_ID}${TERMINAL_ID}${orderIdB}${ENC_KEY}`))
    expect(posted.map((p) => p.url)).toStrictEqual([`${PAYMENT_API}/Reverse`, `${PAYMENT_API}/Reverse`])
    expect(a.status).toBe('approved')
    expect(b.status).toBe('declined')
    expect(b.error_message).toBe(orderIdB)
    expect('isSuccess' in gateway).toBe(false)
  })

  // addition: P23 nothing secret reaches the logger
  it('never logs the key, a MAC, a card number or a CVV', async () => {
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
    const { posted, fetchImpl } = fakeBank(() => SUCCESS_PAYMENT_RESPONSE)
    const hooks: PosHooks = {
      onRequestDataPrepared: [
        (e) => {
          e.requestData.changedByHook = '1'
        },
      ],
    }
    const gateway = realGateway(fetchImpl, { logger, hooks })

    const form = await gateway.get3DFormData(
      { id: '2020110828BC', amount: 1.75, success_url: 'https://domain.com/success' },
      MODEL.THREE_D_SECURE,
      TX_TYPE.PAY_AUTH,
      CreditCardFactory.create('5555444433332222', '21', '12', '122', 'ahmet'),
    )
    await pay3D(gateway, SUCCESS_ORDER, SUCCESS_CALLBACK)
    // both refused callbacks are logged too; the refusal itself is pinned so a swallowed error cannot hide a regression
    await expect(pay3D(gateway, SUCCESS_ORDER, VP4_CALLBACK)).rejects.toThrow(HashMismatchError)
    await expect(pay3D(gateway, AUTH_FAIL_ORDER, { ...AUTH_FAIL_CALLBACK, Mac: 'x' })).rejects.toThrow(
      '3D callback hash mismatch',
    )
    await gateway.payment(
      MODEL.NON_SECURE,
      { id: '2020110828BE', amount: 1.75 },
      TX_TYPE.PAY_AUTH,
      CreditCardFactory.create('5400619360964581', '20', '01', '056', 'ahmet'),
    )

    const logged = JSON.stringify(records)
    expect(records.length).toBeGreaterThan(0)
    expect(logged).not.toContain(ENC_KEY)
    expect(posted).toHaveLength(2)
    for (const p of posted) {
      expect(typeof p.body.MAC).toBe('string')
      expect(logged).not.toContain(p.body.MAC)
    }
    expect(logged).not.toContain(form.inputs.Mac)
    expect(logged).not.toContain(SUCCESS_CALLBACK.Mac)
    expect(logged).not.toContain(AUTH_FAIL_CALLBACK.Mac)
    expect(logged).not.toContain('5555444433332222')
    expect(logged).not.toContain('5400619360964581')
    expect(logged).not.toMatch(/"(Cvc2|Cvv)"\s*:\s*"(122|056)"/)
    // the hook below changes every request, so the logged before/after request data was masked too
    expect(logged).toContain('Request data is changed via listeners')
    // the MACs were logged, masked (so the checks above are not vacuous)
    expect(logged).toContain('"MAC":"***"')
    expect(logged).toContain('"Mac":"***"')
  })
})

// addition: a partial refund that cannot carry an amount never reaches the bank
describe('PosNetV1Pos (end to end) partial refund', () => {
  it('refuses a partial refund of a 3D order before any request', async () => {
    const { posted, fetchImpl } = fakeBank(null)
    const gateway = realGateway(fetchImpl)

    await expectRejection(
      gateway.refund({ id: 'ORD1', amount: 25, currency: 'TRY', order_amount: 100 }),
      UnsupportedTransactionTypeError,
    )
    await expectRejection(
      gateway.refund({ ref_ret_num: '159044932490000231', amount: 25, order_amount: 100 }),
      UnsupportedTransactionTypeError,
    )
    expect(posted).toHaveLength(0)
  })

  it('sends the amount of a partial refund of a regular order', async () => {
    const { posted, fetchImpl } = fakeBank(() => ({ ServiceResponseData: { ResponseCode: '00' } }))

    await realGateway(fetchImpl).refund({
      id: 'ORD1',
      amount: 25,
      currency: 'TRY',
      order_amount: 100,
      payment_model: MODEL.NON_SECURE,
    })

    expect(posted).toHaveLength(1)
    expect(posted[0]?.body.Amount).toBe(2500)
  })
})

describe('PosNetV1Pos (end to end) unknown outcome after a money request', () => {
  const UNKNOWN = 'Bank answer carries no result; the outcome is unknown'
  const resultless: Array<[string, () => Data | Response]> = [
    ['HTTP 204', () => new Response(null, { status: 204 })],
    ['an empty object', () => ({})],
    ['a record without ServiceResponseData', () => ({ AuthCode: '449324', ReferenceCode: '159044932490000231' })],
    ['an empty ServiceResponseData', () => ({ ServiceResponseData: {}, AuthCode: '449324' })],
    ['a null ResponseCode', () => ({ ServiceResponseData: { ResponseCode: null } })],
    ['an empty ResponseCode', () => ({ ServiceResponseData: { ResponseCode: '' } })],
    ['a blank ResponseCode', () => ({ ServiceResponseData: { ResponseCode: '  ' } })],
    ['a list ResponseCode', () => ({ ServiceResponseData: { ResponseCode: ['00'] } })],
    ['a list ServiceResponseData', () => ({ ServiceResponseData: [{ ResponseCode: '00' }] })],
  ]
  const card = () => CreditCardFactory.create('5555444433332222', '21', '12', '122', 'ahmet')
  const order: PosOrder = { ...SUCCESS_ORDER, ref_ret_num: '159044932490000231', payment_model: MODEL.NON_SECURE }

  // addition: L3 a sale, pre-/post-authorization or refund whose answer carries no result is an unknown outcome
  it.each(resultless)(
    'a sale, pre-/post-auth and full/partial refund answered with %s are PosHttpError',
    async (_n, answer) => {
      const actions: Array<(p: PosNetV1Pos) => Promise<unknown>> = [
        (p) => p.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card()),
        (p) => p.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_PRE_AUTH, card()),
        (p) => p.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_POST_AUTH),
        (p) => p.refund(order),
        (p) => p.refund({ ...order, amount: 1, order_amount: 1.75 }),
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

  // addition: L3 the 3D provision answer is checked before it is mapped
  it.each(resultless)('a 3D provision answered with %s is PosHttpError, never mapped', async (_n, answer) => {
    const { posted, fetchImpl } = fakeBank(answer)
    const mapped = vi.spyOn(PosNetV1PosResponseDataMapper.prototype, 'map3DPaymentData')
    try {
      const err = await pay3D(realGateway(fetchImpl), SUCCESS_ORDER, SUCCESS_CALLBACK).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PosHttpError)
      expect([(err as PosHttpError).message, (err as PosHttpError).url]).toStrictEqual([UNKNOWN, PAYMENT_API])
      expect(posted.map((p) => p.url)).toStrictEqual([`${PAYMENT_API}/Sale`])
      expect(mapped).not.toHaveBeenCalled()
    } finally {
      mapped.mockRestore()
    }
  })

  // addition: L3 a genuine decline with a result code is still a decline; a cancel moves no new money
  it('a sale declined with ResponseCode 0148 is declined and a cancel answered with 204 too', async () => {
    const sale = await realGateway(fakeBank(() => FAIL_PAYMENT_RESPONSE).fetchImpl).payment(
      MODEL.NON_SECURE,
      order,
      TX_TYPE.PAY_AUTH,
      card(),
    )
    expect([sale.status, sale.proc_return_code]).toStrictEqual(['declined', '0148'])

    const cancel = await realGateway(fakeBank(() => new Response(null, { status: 204 })).fetchImpl).cancel(order)
    expect(cancel.status).toBe('declined')
  })
})
