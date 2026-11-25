import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { AssecoPosHttpClient } from '../../../src/client/AssecoPosHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { AssecoPosCrypt } from '../../../src/crypt/AssecoPosCrypt.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { AssecoPosRequestDataMapper } from '../../../src/data-mapper/request/mapper/AssecoPosRequestDataMapper.js'
import type { RequestDataMapperInterface } from '../../../src/data-mapper/request/mapper/RequestDataMapperInterface.js'
import { AssecoPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/AssecoPosRequestValueFormatter.js'
import { AssecoPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/AssecoPosRequestValueMapper.js'
import { AssecoPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/AssecoPosResponseDataMapper.js'
import type { ResponseDataMapperInterface } from '../../../src/data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { AssecoPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/AssecoPosResponseValueFormatter.js'
import { AssecoPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/AssecoPosResponseValueMapper.js'
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
import { AssecoPos } from '../../../src/gateway/AssecoPos.js'
import { noopLogger } from '../../../src/logger.js'
import type { AssecoPosAccount } from '../../../src/model/account/AssecoPosAccount.js'
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
import type { GatewayResponseData, PosHooks, PosOrder, RequestDataPreparedEvent } from '../../../src/types.js'

// Dependencies are replaced by vi.fn() fakes; the
// end-to-end section at the bottom uses the real mappers, crypt and HTTP client over a fake fetch.

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
type Data = Record<string, unknown>

const config: GatewayConfig = {
  name: 'AKBANK T.A.S.',
  class: 'AssecoPos',
  gateway_endpoints: {
    payment_api: 'https://entegrasyon.asseco-see.com.tr/fim/api',
    gateway_3d: 'https://entegrasyon.asseco-see.com.tr/fim/est3Dgate',
  },
}

/** `disable_3d_hash_check` is not an option; passing it must have no effect. */
const configWithHashCheckDisabled = {
  ...config,
  gateway_configs: { disable_3d_hash_check: true },
} as unknown as GatewayConfig

const account = AccountFactory.createAssecoPosAccount('akbank', '700655000200', 'ISBANKAPI', 'ISBANK07', 'TRPS0200')

const defaultOrder: PosOrder = {
  id: 'order222',
  amount: 100.25,
  installment: 0,
  currency: CURRENCY.TRY,
  success_url: 'https://domain.com/success',
  fail_url: 'https://domain.com/fail_url',
  lang: LANG.TR,
}

describe('AssecoPos (mocked collaborators)', () => {
  let requestValueMapper: AssecoPosRequestValueMapper
  let requestMapper: Mocked<RequestDataMapperInterface>
  let responseMapper: Mocked<ResponseDataMapperInterface>
  let crypt: Mocked<CryptInterface>
  let httpClient: { supportsTx: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }
  let clientStrategy: { getClient: ReturnType<typeof vi.fn>; getAllClients: ReturnType<typeof vi.fn> }
  let requestDataPrepared: ReturnType<typeof vi.fn<(e: RequestDataPreparedEvent) => void>>
  let pos: AssecoPos

  const createGateway = (cfg: GatewayConfig): AssecoPos => {
    const hooks: PosHooks = { onRequestDataPrepared: [requestDataPrepared] }
    const deps: GatewayDeps<AssecoPosAccount> = {
      requestValueMapper,
      requestValueFormatter: new AssecoPosRequestValueFormatter(),
      requestDataMapper: requestMapper as unknown as RequestDataMapperInterface<AssecoPosAccount>,
      responseDataMapper: responseMapper as unknown as ResponseDataMapperInterface,
      crypt: crypt as unknown as CryptInterface<AssecoPosAccount>,
      clientStrategy: clientStrategy as unknown as HttpClientStrategy,
      logger: noopLogger,
      hooks,
    }
    return new AssecoPos(cfg, account, deps)
  }

  beforeEach(() => {
    requestValueMapper = new AssecoPosRequestValueMapper()
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
      expect(event.gatewayClass).toBe('AssecoPos')
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

  it('exposes NAME and the gateway class identifier', () => {
    expect(AssecoPos.NAME).toBe('Asseco')
    expect(AssecoPos.GATEWAY_CLASS).toBe('AssecoPos')
  })

  it('supported transactions table', () => {
    for (const model of [
      MODEL.THREE_D_SECURE,
      MODEL.THREE_D_PAY,
      MODEL.THREE_D_HOST,
      MODEL.THREE_D_PAY_HOSTING,
      MODEL.NON_SECURE,
    ]) {
      expect(AssecoPos.isSupportedTransaction(TX_TYPE.PAY_AUTH, model)).toBe(true)
      expect(AssecoPos.isSupportedTransaction(TX_TYPE.PAY_PRE_AUTH, model)).toBe(true)
    }
    for (const tx of [
      TX_TYPE.PAY_POST_AUTH,
      TX_TYPE.STATUS,
      TX_TYPE.CANCEL,
      TX_TYPE.REFUND,
      TX_TYPE.REFUND_PARTIAL,
      TX_TYPE.ORDER_HISTORY,
    ]) {
      expect(AssecoPos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(true)
    }
  })

  it.each([true, false])('get3DFormData (with card: %s)', async (isWithCard) => {
    const c = isWithCard ? card() : null
    const paymentModel = isWithCard ? MODEL.THREE_D_SECURE : MODEL.THREE_D_HOST
    const order = { id: '124' }
    const txType = TX_TYPE.PAY_PRE_AUTH
    requestMapper.create3DFormData.mockResolvedValue({ formData: true })

    const actual = await pos.get3DFormData(order, paymentModel, txType, c, !isWithCard)

    expect(requestMapper.create3DFormData).toHaveBeenCalledTimes(1)
    expect(requestMapper.create3DFormData).toHaveBeenCalledWith(
      account,
      order,
      paymentModel,
      txType,
      config.gateway_endpoints.gateway_3d,
      c,
    )
    expect(actual).toStrictEqual({ formData: true })
  })

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

  // The order guard requires the order id and amount to match the callback.
  const make3DHostCase = () => ({
    order: { id: '202210305DCF', amount: 1.01 },
    txType: TX_TYPE.PAY_AUTH,
    paymentData: { oid: '202210305DCF', mdStatus: '1', amount: '1.01', storetype: '3d_host' },
    expectedData: { status: 'approved', order_id: '202210305DCF' },
  })

  it('make3DHostPayment success', async () => {
    const t = make3DHostCase()
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.map3DHostResponseData.mockReturnValue(t.expectedData)

    const result = await pos.payment(MODEL.THREE_D_HOST, t.order, t.txType, null, t.paymentData)

    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
    expect(responseMapper.map3DHostResponseData).toHaveBeenCalledTimes(1)
    expect(responseMapper.map3DHostResponseData).toHaveBeenCalledWith(t.paymentData, t.txType, t.order)
    expect(result).toBe(t.expectedData)
  })

  it('make3DHostPayment still checks the hash when the config asks to disable it', async () => {
    const t = make3DHostCase()
    const p = createGateway(configWithHashCheckDisabled)
    crypt.check3DHash.mockReturnValue(false)

    await expect(p.payment(MODEL.THREE_D_HOST, t.order, t.txType, null, t.paymentData)).rejects.toThrow(
      HashMismatchError,
    )
    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
    expect(responseMapper.map3DHostResponseData).not.toHaveBeenCalled()
  })

  it('make3DHostPayment hash mismatch', async () => {
    const data = { oid: '202210305DCF', mdStatus: '1' }
    crypt.check3DHash.mockReturnValue(false)

    await expect(pos.payment(MODEL.THREE_D_HOST, {}, TX_TYPE.PAY_PRE_AUTH, null, data)).rejects.toThrow(
      HashMismatchError,
    )
    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
    expect(crypt.check3DHash).toHaveBeenCalledWith(account, data)
    expect(responseMapper.map3DHostResponseData).not.toHaveBeenCalled()
  })

  // The order guard needs an order id matching the callback.
  const make3DPayCase = () => ({
    order: { id: '2022103030CB', currency: CURRENCY.TRY, amount: 1.01 },
    txType: TX_TYPE.PAY_AUTH,
    paymentData: { oid: '2022103030CB', mdStatus: '1', amount: '1.01', storetype: '3d_pay' },
    expectedData: { status: 'approved', order_id: '2022103030CB' },
  })

  it.each([MODEL.THREE_D_PAY, MODEL.THREE_D_PAY_HOSTING])('make3DPayPayment success (%s)', async (model) => {
    const t = make3DPayCase()
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.map3DPayResponseData.mockReturnValue(t.expectedData)

    const result = await pos.payment(model, t.order, t.txType, null, t.paymentData)

    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
    expect(responseMapper.map3DPayResponseData).toHaveBeenCalledTimes(1)
    expect(responseMapper.map3DPayResponseData).toHaveBeenCalledWith(t.paymentData, t.txType, t.order)
    expect(result).toBe(t.expectedData)
  })

  it('make3DPayPayment still checks the hash when the config asks to disable it', async () => {
    const t = make3DPayCase()
    const p = createGateway(configWithHashCheckDisabled)
    crypt.check3DHash.mockReturnValue(false)

    await expect(p.payment(MODEL.THREE_D_PAY, t.order, t.txType, null, t.paymentData)).rejects.toThrow(
      HashMismatchError,
    )
    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
    expect(responseMapper.map3DPayResponseData).not.toHaveBeenCalled()
  })

  it('make3DPayPayment hash mismatch', async () => {
    const data = { oid: '2022103030CB', mdStatus: '1' }
    crypt.check3DHash.mockReturnValue(false)

    await expect(pos.payment(MODEL.THREE_D_PAY, {}, TX_TYPE.PAY_PRE_AUTH, null, data)).rejects.toThrow(
      HashMismatchError,
    )
    expect(crypt.check3DHash).toHaveBeenCalledWith(account, data)
    expect(responseMapper.map3DPayResponseData).not.toHaveBeenCalled()
  })

  describe.each([
    ['make3DPayPayment', MODEL.THREE_D_PAY, 'map3DPayResponseData', '3d_pay'],
    ['make3DHostPayment', MODEL.THREE_D_HOST, 'map3DHostResponseData', '3d_host'],
  ] as const)('%s order guard', (_name, model, mapMethod, storetype) => {
    const order = { id: 'O-1', amount: 100 }
    const run = (callback: GatewayResponseData, mapped: Data, o: PosOrder = order) => {
      crypt.check3DHash.mockReturnValue(true)
      responseMapper[mapMethod].mockReturnValue(mapped)
      return pos.payment(model, o, TX_TYPE.PAY_AUTH, null, { storetype, ...callback })
    }

    it('accepts a matching order id and amount (within 0.005)', async () => {
      await expect(run({ oid: 'O-1', amount: '100.00' }, { order_id: 'O-1' })).resolves.toStrictEqual({
        order_id: 'O-1',
      })
      await expect(run({ oid: 'O-1', amount: '100.004' }, { order_id: 'O-1' })).resolves.toBeDefined()
    })

    it.each([
      [{ oid: 'O-2', amount: '100' }, { order_id: 'O-2' }, 'order_id'],
      [{ oid: 'O-1', amount: '100' }, { order_id: null }, 'order_id'],
      [{ oid: 'O-1', amount: '1.01' }, { order_id: 'O-1' }, 'amount'],
      [{ oid: 'O-1', amount: '100.006' }, { order_id: 'O-1' }, 'amount'],
      [{ oid: 'O-1', amount: '99.99' }, { order_id: 'O-1' }, 'amount'],
      [{ oid: 'O-1', amount: 'abc' }, { order_id: 'O-1' }, 'amount'],
      [{ oid: 'O-1', amount: '' }, { order_id: 'O-1' }, 'amount'],
      [{ oid: 'O-1', amount: '0x64' }, { order_id: 'O-1' }, 'amount'],
      [{ oid: 'O-1' }, { order_id: 'O-1' }, 'amount'],
    ] as Array<[GatewayResponseData, Data, 'order_id' | 'amount']>)(
      'rejects %j mapped to %j (%s)',
      async (callback, mapped, field) => {
        const err = await run(callback, mapped).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(OrderMismatchError)
        expect((err as OrderMismatchError).field).toBe(field)
      },
    )

    it('rejects an order without id or amount', async () => {
      const noId = await run({ oid: 'O-1', amount: '100' }, { order_id: 'O-1' }, { amount: 100 }).catch((e) => e)
      expect((noId as OrderMismatchError).field).toBe('order_id')
      const noAmount = await run({ oid: 'O-1', amount: '100' }, { order_id: 'O-1' }, { id: 'O-1' }).catch((e) => e)
      expect((noAmount as OrderMismatchError).field).toBe('amount')
    })

    it('checks the hash before mapping and guarding', async () => {
      crypt.check3DHash.mockReturnValue(false)
      await expect(pos.payment(model, order, TX_TYPE.PAY_AUTH, null, { oid: 'X' })).rejects.toThrow(HashMismatchError)
      expect(responseMapper[mapMethod]).not.toHaveBeenCalled()
    })
  })

  it.each([
    [{ ProcReturnCode: '99' }, { status: 'declined' }],
    [{ ProcReturnCode: '00' }, { status: 'approved' }],
  ])('status %j', async (bankResponse, expectedData) => {
    const requestData = { request: 'createStatusRequestData' }
    requestMapper.createStatusRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(TX_TYPE.STATUS, requestData, bankResponse, defaultOrder, MODEL.NON_SECURE)
    responseMapper.mapStatusResponse.mockReturnValue(expectedData)

    const result = await pos.status(defaultOrder)

    expect(requestMapper.createStatusRequestData).toHaveBeenCalledWith(account, defaultOrder)
    verify()
    expect(responseMapper.mapStatusResponse).toHaveBeenCalledWith(bankResponse)
    expect(result).toBe(expectedData)
  })

  it.each([
    [{ ProcReturnCode: '00' }, { status: 'approved' }],
    [{ ProcReturnCode: '05' }, { status: 'declined' }],
  ])('orderHistory %j', async (bankResponse, expectedData) => {
    const requestData = { request: 'createOrderHistoryRequestData' }
    requestMapper.createOrderHistoryRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(
      TX_TYPE.ORDER_HISTORY,
      requestData,
      bankResponse,
      defaultOrder,
      MODEL.NON_SECURE,
    )
    responseMapper.mapOrderHistoryResponse.mockReturnValue(expectedData)

    const result = await pos.orderHistory(defaultOrder)

    expect(requestMapper.createOrderHistoryRequestData).toHaveBeenCalledWith(account, defaultOrder)
    verify()
    expect(responseMapper.mapOrderHistoryResponse).toHaveBeenCalledWith(bankResponse)
    expect(result).toBe(expectedData)
  })

  it.each([
    ['fail_1', { ProcReturnCode: '99' }, { status: 'declined' }],
    ['success_1', { ProcReturnCode: '00' }, { status: 'approved' }],
  ])('cancel %s', async (_name, bankResponse, expectedData) => {
    const requestData = { request: 'createCancelRequestData' }
    requestMapper.createCancelRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(TX_TYPE.CANCEL, requestData, bankResponse, defaultOrder, MODEL.NON_SECURE)
    responseMapper.mapCancelResponse.mockReturnValue(expectedData)

    const result = await pos.cancel(defaultOrder)

    expect(requestMapper.createCancelRequestData).toHaveBeenCalledWith(account, defaultOrder)
    verify()
    expect(responseMapper.mapCancelResponse).toHaveBeenCalledWith(bankResponse)
    expect(result).toBe(expectedData)
  })

  it.each([['fail_1', { ProcReturnCode: '99' }, { status: 'declined' }]])(
    'refund %s',
    async (_name, bankResponse, expectedData) => {
      const requestData = { request: 'createRefundRequestData' }
      requestMapper.createRefundRequestData.mockReturnValue(requestData)
      const verify = configureClientResponse(TX_TYPE.REFUND, requestData, bankResponse, defaultOrder, MODEL.NON_SECURE)
      responseMapper.mapRefundResponse.mockReturnValue(expectedData)

      const result = await pos.refund(defaultOrder)

      expect(requestMapper.createRefundRequestData).toHaveBeenCalledWith(account, defaultOrder, TX_TYPE.REFUND)
      verify()
      expect(responseMapper.mapRefundResponse).toHaveBeenCalledWith(bankResponse)
      expect(result).toBe(expectedData)
    },
  )

  const make3DPaymentCases: Array<[string, PosOrder, TxType, GatewayResponseData, Data, Data, boolean]> = [
    [
      'auth_fail',
      { currency: CURRENCY.TRY, amount: 1.01 },
      TX_TYPE.PAY_AUTH,
      { oid: '2022103076E7', mdStatus: '0' },
      {},
      { status: 'declined' },
      false,
    ],
    [
      '3d_auth_success_payment_fail',
      // deviation: L8 a 3D-successful callback is bound to the order id before the provision; the order names it
      { id: '20221030FE4C', currency: CURRENCY.TRY, amount: 1.01 },
      TX_TYPE.PAY_AUTH,
      { oid: '20221030FE4C', mdStatus: '1' },
      { ProcReturnCode: '99' },
      { status: 'declined' },
      true,
    ],
    [
      'success',
      // deviation: L8 a 3D-successful callback is bound to the order id before the provision; the order names it
      { id: '202210304547', currency: CURRENCY.TRY, amount: 1.01 },
      TX_TYPE.PAY_AUTH,
      { oid: '202210304547', mdStatus: '1' },
      { ProcReturnCode: '00' },
      { status: 'approved' },
      true,
    ],
  ]

  const runMake3DPayment = async (
    p: AssecoPos,
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
    const create3DPaymentRequestData = { request: 'create3DPaymentRequestData' }
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
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(gatewayResponseData, null, txType, order)
      expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
      expect(requestDataPrepared).not.toHaveBeenCalled()
      expect(httpClient.request).not.toHaveBeenCalled()
    }
    expect(result).toBe(expectedResponse)
  }

  it.each(make3DPaymentCases)('make3DPayment %s', async (_name, ...args) => {
    await runMake3DPayment(pos, ...args)
  })

  it.each(make3DPaymentCases.slice(1))(
    'make3DPayment %s with a config asking to disable the hash check still checks the hash',
    async (_name, ...args) => {
      await runMake3DPayment(createGateway(configWithHashCheckDisabled), ...args)
    },
  )

  it('make3DPayment hash mismatch', async () => {
    const data = { oid: '20221030FE4C', mdStatus: '1' }
    crypt.check3DHash.mockReturnValue(false)
    responseMapper.is3dAuthSuccess.mockReturnValue(true)

    await expect(pos.payment(MODEL.THREE_D_SECURE, {}, TX_TYPE.PAY_AUTH, null, data)).rejects.toThrow(HashMismatchError)
    expect(crypt.check3DHash).toHaveBeenCalledWith(account, data)
    expect(responseMapper.map3DPaymentData).not.toHaveBeenCalled()
    expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
    expect(requestDataPrepared).not.toHaveBeenCalled()
  })

  it.each([TX_TYPE.PAY_AUTH, TX_TYPE.PAY_PRE_AUTH])('makeRegularPayment %s', async (txType) => {
    const order = { id: '2020110828BC' }
    const c = card()
    const requestData = { request: 'createNonSecurePaymentRequestData' }
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue(requestData)
    const decodedResponse = { response: 'paymentResponse' }
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
    const requestData = { request: 'createNonSecurePostAuthPaymentRequestData' }
    requestMapper.createNonSecurePostAuthPaymentRequestData.mockReturnValue(requestData)
    const decodedResponse = { response: 'paymentResponse' }
    const verify = configureClientResponse(txType, requestData, decodedResponse, order, MODEL.NON_SECURE)
    responseMapper.mapPaymentResponse.mockReturnValue({ result: true })

    await pos.payment(MODEL.NON_SECURE, order, txType)

    expect(requestMapper.createNonSecurePostAuthPaymentRequestData).toHaveBeenCalledWith(account, order)
    verify()
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith(decodedResponse, txType, order)
  })
})

// ---------- end to end: real mappers, crypt and HTTP client over a fake fetch ----------

type Sent = { url: string; body: string }

function realGateway(fetchImpl: typeof fetch, hooks: PosHooks = {}) {
  const realAccount = AccountFactory.createAssecoPosAccount(
    'akbank',
    '700655000200',
    'ISBANKAPI',
    'ISBANK07',
    'TRPS0200',
  )
  const crypt = new AssecoPosCrypt()
  const valueMapper = new AssecoPosRequestValueMapper()
  const valueFormatter = new AssecoPosRequestValueFormatter()
  const deps: GatewayDeps<AssecoPosAccount> = {
    requestValueMapper: valueMapper,
    requestValueFormatter: valueFormatter,
    requestDataMapper: new AssecoPosRequestDataMapper(valueMapper, valueFormatter, hooks, crypt),
    responseDataMapper: new AssecoPosResponseDataMapper(
      new AssecoPosResponseValueFormatter(),
      new AssecoPosResponseValueMapper(),
    ),
    crypt,
    clientStrategy: new HttpClientStrategy([
      new AssecoPosHttpClient(
        config.gateway_endpoints.payment_api,
        new HttpTransport({ fetch: fetchImpl }),
        noopLogger,
      ),
    ]),
    logger: noopLogger,
    hooks,
  }
  return { pos: new AssecoPos(config, realAccount, deps), crypt, account: realAccount }
}

const noNetwork = (async () => {
  throw new Error('no network expected')
}) as unknown as typeof fetch

/** A 3D Pay callback signed with the account's store key (what the bank would post back). */
function signedCallback(
  crypt: AssecoPosCrypt,
  acc: AssecoPosAccount,
  data: Record<string, string>,
): GatewayResponseData {
  return { ...data, HASH: crypt.create3DHash(acc, data) }
}

const payCallback = {
  clientid: '700655000200',
  oid: '2022103030CB',
  amount: '1.01',
  currency: '949',
  storetype: '3d_pay',
  taksit: '',
  mdStatus: '1',
  ProcReturnCode: '00',
  Response: 'Approved',
  AuthCode: 'P37891',
  TransId: '22303LWsA14386',
  HostRefNum: '230300671764',
  EXTRA_TRXDATE: '20221030 11:22:43',
  maskedCreditCard: '4355 08** **** 4358',
  Ecom_Payment_Card_ExpDate_Month: '12',
  Ecom_Payment_Card_ExpDate_Year: '26',
  eci: '05',
  cavv: 'ABABByBkEgAAAABllJMDdVWUGZE=',
  rnd: 'kP/2JB5ajHJt+yVhHNG9',
  encoding: 'ISO-8859-9',
}
const payOrder: PosOrder = { id: '2022103030CB', amount: 1.01, currency: CURRENCY.TRY }

describe('AssecoPos (end to end)', () => {
  it('approves a correctly signed 3D Pay callback without a network call', async () => {
    const { pos, crypt, account: acc } = realGateway(noNetwork)
    const res = await pos.payment(
      MODEL.THREE_D_PAY,
      payOrder,
      TX_TYPE.PAY_AUTH,
      null,
      signedCallback(crypt, acc, payCallback),
    )
    expect(res.status).toBe('approved')
    expect(res.order_id).toBe('2022103030CB')
    expect(res.requires_manual_review).toBe(false)
    expect(res.transaction_time).toStrictEqual(new Date(Date.UTC(2022, 9, 30, 11 - 3, 22, 43)))
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['non-string', 12345 as unknown as string],
    ['wrong', 'FQLnGOxBBMIoMIRxehiaLtkEd34='],
  ])('a callback with a %s HASH raises HashMismatchError (never a TypeError)', async (_name, hash) => {
    const { pos } = realGateway(noNetwork)
    const callback: GatewayResponseData = { ...payCallback }
    if (hash !== undefined) callback.HASH = hash
    for (const model of [MODEL.THREE_D_PAY, MODEL.THREE_D_HOST, MODEL.THREE_D_SECURE]) {
      await expect(pos.payment(model, payOrder, TX_TYPE.PAY_AUTH, null, callback)).rejects.toThrow(HashMismatchError)
    }
  })

  it('a validly signed callback for another order raises OrderMismatchError (order_id)', async () => {
    const { pos, crypt, account: acc } = realGateway(noNetwork)
    const callback = signedCallback(crypt, acc, { ...payCallback, oid: 'SOMEONE-ELSE' })
    const err = await pos.payment(MODEL.THREE_D_PAY, payOrder, TX_TYPE.PAY_AUTH, null, callback).catch((e) => e)
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect((err as OrderMismatchError).field).toBe('order_id')
  })

  it('a validly signed callback with another amount raises OrderMismatchError (amount)', async () => {
    const { pos, crypt, account: acc } = realGateway(noNetwork)
    const callback = signedCallback(crypt, acc, payCallback) // amount '1.01'
    const err = await pos
      .payment(MODEL.THREE_D_PAY, { ...payOrder, amount: 100 }, TX_TYPE.PAY_AUTH, null, callback)
      .catch((e) => e)
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect((err as OrderMismatchError).field).toBe('amount')
    expect((err as OrderMismatchError).expected).toBe('100')
    expect((err as OrderMismatchError).actual).toBe('1.01')
  })

  it('OrderMismatchError carries the mapped response (manual-review flag, no card data) for 3D Pay and 3D Host', async () => {
    const { pos, crypt, account: acc } = realGateway(noNetwork)
    const check = async (model: PaymentModel, cb: Record<string, string>, o: PosOrder) => {
      const err = (await pos
        .payment(model, o, TX_TYPE.PAY_AUTH, null, signedCallback(crypt, acc, cb))
        .catch((e) => e)) as OrderMismatchError
      expect(err).toBeInstanceOf(OrderMismatchError)
      const response = err.response
      expect(response).toBeDefined()
      expect(response?.order_id).toBe(cb.oid)
      expect(typeof response?.requires_manual_review).toBe('boolean')
      expect(response).toHaveProperty('transaction_id')
      const serialized = JSON.stringify(response)
      expect(serialized).not.toMatch(/\d{13,19}/)
      expect(serialized.toLowerCase()).not.toContain('cvv')
    }
    await check(MODEL.THREE_D_PAY, { ...payCallback, oid: 'SOMEONE-ELSE' }, payOrder)
    await check(MODEL.THREE_D_PAY, payCallback, { ...payOrder, amount: 100 })
    await check(MODEL.THREE_D_HOST, { ...payCallback, storetype: '3d_host', oid: 'X' }, payOrder)
  })

  it('a bank-approved callback for another amount reports paymentMayHaveCompleted (money moved)', async () => {
    const { pos, crypt, account: acc } = realGateway(noNetwork)
    const callback = signedCallback(crypt, acc, { ...payCallback, amount: '1.00' }) // 00 + mdStatus 1
    const err = (await pos
      .payment(MODEL.THREE_D_PAY, { ...payOrder, amount: 100 }, TX_TYPE.PAY_AUTH, null, callback)
      .catch((e) => e)) as OrderMismatchError
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect(err.field).toBe('amount')
    expect(err.response?.status).toBe('approved')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
  })

  it('a bank-approved callback for another order id reports paymentMayHaveCompleted', async () => {
    const { pos, crypt, account: acc } = realGateway(noNetwork)
    const callback = signedCallback(crypt, acc, { ...payCallback, oid: 'SOMEONE-ELSE' })
    const err = (await pos
      .payment(MODEL.THREE_D_PAY, payOrder, TX_TYPE.PAY_AUTH, null, callback)
      .catch((e) => e)) as OrderMismatchError
    expect(err.field).toBe('order_id')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
  })

  it('a bank-declined callback for another amount does not report paymentMayHaveCompleted', async () => {
    const { pos, crypt, account: acc } = realGateway(noNetwork)
    const callback = signedCallback(crypt, acc, {
      ...payCallback,
      ProcReturnCode: '99',
      Response: 'Declined',
      amount: '1.00',
    })
    const err = (await pos
      .payment(MODEL.THREE_D_PAY, { ...payOrder, amount: 100 }, TX_TYPE.PAY_AUTH, null, callback)
      .catch((e) => e)) as OrderMismatchError
    expect(err.field).toBe('amount')
    expect(err.paymentMayHaveCompleted).toBe(false)
    expect(err.response?.requires_manual_review).toBe(false)
  })

  describe('callback storetype is bound to the payment model', () => {
    const run = async (model: PaymentModel, cb: Record<string, string>) => {
      const { pos, crypt, account: acc } = realGateway(noNetwork)
      return pos.payment(model, payOrder, TX_TYPE.PAY_AUTH, null, signedCallback(crypt, acc, cb)).catch((e) => e)
    }

    it('a declined 3D Pay Hosting callback completed as 3D Host is rejected, not approved', async () => {
      const err = (await run(MODEL.THREE_D_HOST, {
        ...payCallback,
        storetype: '3d_pay_hosting',
        ProcReturnCode: '99',
        Response: 'Declined',
      })) as OrderMismatchError
      expect(err).toBeInstanceOf(OrderMismatchError)
      expect(err.field).toBe('storetype')
      expect(err.expected).toBe('3d_host')
      expect(err.actual).toBe('3d_pay_hosting')
      expect(err.response?.status).toBe('declined')
      expect(err.paymentMayHaveCompleted).toBe(false)
    })

    it('an approved 3D Host callback completed as 3D Pay is rejected and flagged', async () => {
      const { ProcReturnCode: _p, ...host } = payCallback
      const err = (await run(MODEL.THREE_D_PAY, { ...host, storetype: '3d_host' })) as OrderMismatchError
      expect(err.field).toBe('storetype')
      expect(err.expected).toBe('3d_pay | 3d_pay_hosting')
      expect(err.paymentMayHaveCompleted).toBe(true)
      expect(err.response?.requires_manual_review).toBe(true)
    })

    it.each([
      [MODEL.THREE_D_PAY, '3d_pay'],
      [MODEL.THREE_D_PAY, '3D_PAY'],
      [MODEL.THREE_D_PAY, '3d_pay_hosting'],
      [MODEL.THREE_D_PAY_HOSTING, '3d_pay_hosting'],
      [MODEL.THREE_D_PAY_HOSTING, '3d_pay'],
      [MODEL.THREE_D_HOST, '3d_host'],
      [MODEL.THREE_D_HOST, '3D_HOST'],
    ] as const)('%s accepts storetype %s', async (model, storetype) => {
      const res = await run(model, { ...payCallback, storetype })
      expect(res).not.toBeInstanceOf(Error)
      expect(res.status).toBe('approved')
    })

    it.each([
      [MODEL.THREE_D_PAY, '3d'],
      [MODEL.THREE_D_PAY, '3d_host'],
      [MODEL.THREE_D_PAY, ''],
      [MODEL.THREE_D_PAY, undefined],
      [MODEL.THREE_D_HOST, '3d_pay'],
      [MODEL.THREE_D_HOST, '3d'],
      [MODEL.THREE_D_HOST, undefined],
    ] as const)('%s rejects storetype %s', async (model, storetype) => {
      const { storetype: _s, ...rest } = payCallback
      const err = await run(model, storetype === undefined ? rest : { ...rest, storetype })
      expect(err).toBeInstanceOf(OrderMismatchError)
      expect((err as OrderMismatchError).field).toBe('storetype')
    })

    it('make3DPayment rejects a signed 3D Pay callback before any provisioning request', async () => {
      const err = (await run(MODEL.THREE_D_SECURE, payCallback)) as OrderMismatchError
      expect(err).toBeInstanceOf(OrderMismatchError)
      expect(err.field).toBe('storetype')
      expect(err.expected).toBe('3d')
      // the 3D Pay callback was already provisioned by the bank
      expect(err.paymentMayHaveCompleted).toBe(true)
    })
  })

  it('provisioned (ProcReturnCode 00) but mdStatus 2 is declined and flagged for manual review', async () => {
    const { pos, crypt, account: acc } = realGateway(noNetwork)
    const callback = signedCallback(crypt, acc, { ...payCallback, mdStatus: '2' })
    const res = await pos.payment(MODEL.THREE_D_PAY, payOrder, TX_TYPE.PAY_AUTH, null, callback)
    expect(res.status).toBe('declined')
    expect(res.requires_manual_review).toBe(true)
  })

  it('3D Host callbacks are guarded the same way', async () => {
    const { pos, crypt, account: acc } = realGateway(noNetwork)
    const host = { ...payCallback, storetype: '3d_host' }
    const ok = await pos.payment(MODEL.THREE_D_HOST, payOrder, TX_TYPE.PAY_AUTH, null, signedCallback(crypt, acc, host))
    expect(ok.status).toBe('approved')
    const other = signedCallback(crypt, acc, { ...host, oid: 'X' })
    await expect(pos.payment(MODEL.THREE_D_HOST, payOrder, TX_TYPE.PAY_AUTH, null, other)).rejects.toThrow(
      OrderMismatchError,
    )
  })

  it('make3DPayment: failed 3D auth is mapped without a network call', async () => {
    const { pos } = realGateway(noNetwork)
    const res = await pos.payment(MODEL.THREE_D_SECURE, payOrder, TX_TYPE.PAY_AUTH, null, {
      ...payCallback,
      storetype: '3d',
      mdStatus: '0',
      mdErrorMsg: 'N-status',
    })
    expect(res.status).toBe('declined')
    expect(res.md_error_message).toBe('N-status')
  })

  it('make3DPayment: verifies the hash, posts the provision request and maps the bank response', async () => {
    const sent: Sent[] = []
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      sent.push({ url: String(url), body: Buffer.from(init?.body as Uint8Array).toString('latin1') })
      return new Response(
        '<?xml version="1.0" encoding="ISO-8859-9"?><CC5Response><OrderId>2022103030CB</OrderId>' +
          '<GroupId>2022103030CB</GroupId><Response>Approved</Response><AuthCode>P1</AuthCode>' +
          '<HostRefNum>1</HostRefNum><ProcReturnCode>00</ProcReturnCode><TransId>T1</TransId><ErrMsg></ErrMsg>' +
          '<Extra><TRXDATE>20221030 11:51:41</TRXDATE><NUMCODE>00</NUMCODE></Extra></CC5Response>',
      )
    }) as unknown as typeof fetch
    const { pos, crypt, account: acc } = realGateway(fetchImpl)
    const callback = signedCallback(crypt, acc, {
      ...payCallback,
      storetype: '3d',
      md: '435508:EC9C:4333:##700655000200',
      xid: 'xid',
    })

    const res = await pos.payment(MODEL.THREE_D_SECURE, payOrder, TX_TYPE.PAY_AUTH, null, callback)

    expect(res.status).toBe('approved')
    expect(res.order_id).toBe('2022103030CB')
    expect(res.transaction_id).toBe('T1')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(config.gateway_endpoints.payment_api)
    expect(sent[0]?.body).toContain('<OrderId>2022103030CB</OrderId>')
    expect(sent[0]?.body).toContain('<Number>435508:EC9C:4333:##700655000200</Number>')
  })

  it('make3DPayment: accepts a valid hashed callback that carries no storetype field', async () => {
    const fetchImpl = (async () =>
      new Response(
        '<?xml version="1.0" encoding="ISO-8859-9"?><CC5Response><OrderId>2022103030CB</OrderId>' +
          '<GroupId>2022103030CB</GroupId><Response>Approved</Response><AuthCode>P1</AuthCode>' +
          '<HostRefNum>1</HostRefNum><ProcReturnCode>00</ProcReturnCode><TransId>T1</TransId><ErrMsg></ErrMsg>' +
          '<Extra><TRXDATE>20221030 11:51:41</TRXDATE><NUMCODE>00</NUMCODE></Extra></CC5Response>',
      )) as unknown as typeof fetch
    const { pos, crypt, account: acc } = realGateway(fetchImpl)
    const { storetype: _omitted, ...withoutStoretype } = payCallback
    const callback = signedCallback(crypt, acc, {
      ...withoutStoretype,
      md: '435508:EC9C:4333:##700655000200',
      xid: 'xid',
    })
    expect(callback).not.toHaveProperty('storetype')

    const res = await pos.payment(MODEL.THREE_D_SECURE, payOrder, TX_TYPE.PAY_AUTH, null, callback)

    expect(res.status).toBe('approved')
    expect(res.transaction_id).toBe('T1')
  })

  it('one instance serves concurrent status() calls with independent responses', async () => {
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const body = Buffer.from(init?.body as Uint8Array).toString('latin1')
      const orderId = /<OrderId>([^<]*)<\/OrderId>/.exec(body)?.[1] ?? ''
      // the first request is answered last
      await new Promise((r) => setTimeout(r, orderId === 'ORDER-A' ? 30 : 0))
      return new Response(
        `<CC5Response><OrderId>${orderId}</OrderId><ProcReturnCode>00</ProcReturnCode><TransId>T-${orderId}</TransId>` +
          '<ErrMsg></ErrMsg><Extra><AUTH_CODE>A</AUTH_CODE><HOST_REF_NUM>H</HOST_REF_NUM><ORIG_TRANS_AMT>101</ORIG_TRANS_AMT>' +
          '<CAPTURE_AMT>101</CAPTURE_AMT><PAN>4355 08** **** 4358</PAN><NUMCODE>0</NUMCODE><CHARGE_TYPE_CD>S</CHARGE_TYPE_CD>' +
          '<TRANS_STAT>C</TRANS_STAT></Extra></CC5Response>',
      )
    }) as unknown as typeof fetch
    const { pos } = realGateway(fetchImpl)

    const [a, b] = await Promise.all([pos.status({ id: 'ORDER-A' }), pos.status({ id: 'ORDER-B' })])

    expect(a.order_id).toBe('ORDER-A')
    expect(a.transaction_id).toBe('T-ORDER-A')
    expect(b.order_id).toBe('ORDER-B')
    expect(b.transaction_id).toBe('T-ORDER-B')
    expect(a).not.toHaveProperty('isSuccess')
    expect('isSuccess' in pos).toBe(false)
    expect('getResponse' in pos).toBe(false)
  })

  it('3D form data is signed with the real crypt and verifies', async () => {
    const { pos, crypt, account: acc } = realGateway(noNetwork)
    const form = await pos.get3DFormData(
      { ...defaultOrder, id: 'order222' },
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_AUTH,
      null,
      true,
    )
    if (typeof form === 'string') throw new Error('expected form data')
    expect(form.gateway).toBe(config.gateway_endpoints.gateway_3d)
    expect(form.inputs.oid).toBe('order222')
    expect(crypt.check3DHash(acc, { ...form.inputs, HASH: form.inputs.hash })).toBe(true)
  })
})

// ---------- unknown outcome after a money request, 3D Secure callback bound to the order ----------

const SECURE_CALLBACK = {
  ...payCallback,
  storetype: '3d',
  md: '435508:EC9C:4333:##700655000200',
  xid: 'xid',
}

const xmlAnswer = (inner: string): string =>
  `<?xml version="1.0" encoding="ISO-8859-9"?><CC5Response>${inner}</CC5Response>`

const APPROVED_PROVISION = xmlAnswer(
  '<OrderId>2022103030CB</OrderId><GroupId>2022103030CB</GroupId><Response>Approved</Response><AuthCode>P1</AuthCode>' +
    '<HostRefNum>1</HostRefNum><ProcReturnCode>00</ProcReturnCode><TransId>T1</TransId><ErrMsg></ErrMsg>' +
    '<Extra><TRXDATE>20221030 11:51:41</TRXDATE><NUMCODE>00</NUMCODE></Extra>',
)

/** A fetch answering every request with `answer()` and counting the requests. */
function answeringFetch(answer: () => Response) {
  const sent: string[] = []
  const fetchImpl = (async (url: unknown) => {
    sent.push(String(url))
    return answer()
  }) as unknown as typeof fetch

  return { sent, fetchImpl }
}

const RESULTLESS: Array<[string, () => Response]> = [
  ['HTTP 204', () => new Response(null, { status: 204 })],
  ['an empty root', () => new Response(xmlAnswer(''))],
  [
    'a record without ProcReturnCode',
    () => new Response(xmlAnswer('<OrderId>2022103030CB</OrderId><Response>Approved</Response><TransId>T1</TransId>')),
  ],
  [
    'an empty ProcReturnCode',
    () => new Response(xmlAnswer('<OrderId>2022103030CB</OrderId><ProcReturnCode></ProcReturnCode>')),
  ],
  [
    'a blank ProcReturnCode',
    () => new Response(xmlAnswer('<OrderId>2022103030CB</OrderId><ProcReturnCode>  </ProcReturnCode>')),
  ],
  [
    'ProcReturnCode twice',
    () =>
      new Response(
        xmlAnswer(
          '<OrderId>2022103030CB</OrderId><ProcReturnCode>00</ProcReturnCode><ProcReturnCode>00</ProcReturnCode>',
        ),
      ),
  ],
]

const UNKNOWN_OUTCOME = 'Bank answer carries no result; the outcome is unknown'

describe('AssecoPos (end to end) unknown outcome after a money request', () => {
  const saleCard = (p: AssecoPos) =>
    CreditCardFactory.createForGateway(p, '5555444433332222', '21', '12', '122', 'ahmet', CARD_TYPE.VISA)
  const order: PosOrder = { id: '2022103030CB', amount: 1.01, currency: CURRENCY.TRY }

  // addition: L3 a sale, pre-/post-authorization or refund whose answer carries no result is an unknown outcome
  it.each(RESULTLESS)(
    'a non-secure sale, pre-/post-auth and refund answered with %s are PosHttpError',
    async (_n, answer) => {
      const actions: Array<(p: AssecoPos) => Promise<unknown>> = [
        (p) => p.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, saleCard(p)),
        (p) => p.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_PRE_AUTH, saleCard(p)),
        (p) => p.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_POST_AUTH),
        (p) => p.refund(order),
        (p) => p.refund({ ...order, amount: 0.5, order_amount: 1.01 }),
      ]
      for (const action of actions) {
        const { sent, fetchImpl } = answeringFetch(answer)
        const err = await action(realGateway(fetchImpl).pos).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(PosHttpError)
        expect([(err as PosHttpError).message, (err as PosHttpError).url]).toStrictEqual([
          UNKNOWN_OUTCOME,
          config.gateway_endpoints.payment_api,
        ])
        expect(sent).toHaveLength(1)
      }
    },
  )

  // addition: L3 the 3D provision answer is checked before it is mapped
  it.each(RESULTLESS)('a 3D Secure provision answered with %s is PosHttpError, never mapped', async (_n, answer) => {
    const { sent, fetchImpl } = answeringFetch(answer)
    const { pos, crypt, account: acc } = realGateway(fetchImpl)
    const mapped = vi.spyOn(AssecoPosResponseDataMapper.prototype, 'map3DPaymentData')
    try {
      const err = await pos
        .payment(MODEL.THREE_D_SECURE, payOrder, TX_TYPE.PAY_AUTH, null, signedCallback(crypt, acc, SECURE_CALLBACK))
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PosHttpError)
      expect([(err as PosHttpError).message, (err as PosHttpError).url]).toStrictEqual([
        UNKNOWN_OUTCOME,
        config.gateway_endpoints.payment_api,
      ])
      expect(sent).toHaveLength(1)
      expect(mapped).not.toHaveBeenCalled()
    } finally {
      mapped.mockRestore()
    }
  })

  // addition: L3 a genuine decline with a result code is still a decline; a cancel moves no new money
  it('a sale and a provision declined with ProcReturnCode 99 are declined; a cancel answered with 204 too', async () => {
    const declined = () =>
      new Response(
        xmlAnswer(
          '<OrderId>2022103030CB</OrderId><Response>Declined</Response><ProcReturnCode>99</ProcReturnCode><ErrMsg>Red</ErrMsg>',
        ),
      )
    const sale = realGateway(answeringFetch(declined).fetchImpl).pos
    const res = await sale.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, saleCard(sale))
    expect([res.status, res.proc_return_code]).toStrictEqual(['declined', '99'])

    const { pos, crypt, account: acc } = realGateway(answeringFetch(declined).fetchImpl)
    const provision = await pos.payment(
      MODEL.THREE_D_SECURE,
      payOrder,
      TX_TYPE.PAY_AUTH,
      null,
      signedCallback(crypt, acc, SECURE_CALLBACK),
    )
    expect([provision.status, provision.proc_return_code]).toStrictEqual(['declined', '99'])

    const cancel = realGateway(answeringFetch(() => new Response(null, { status: 204 })).fetchImpl).pos
    expect((await cancel.cancel(order)).status).toBe('declined')
  })
})

describe('AssecoPos (end to end) 3D Secure callback bound to the order before the provision', () => {
  const run = async (callback: Record<string, string>, order: PosOrder = payOrder) => {
    const { sent, fetchImpl } = answeringFetch(() => new Response(APPROVED_PROVISION))
    const hook = vi.fn()
    const { pos, crypt, account: acc } = realGateway(fetchImpl, { onRequestDataPrepared: [hook] })
    const result = await pos
      .payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, signedCallback(crypt, acc, callback))
      .catch((e: unknown) => e)

    return { result, sent, hook }
  }

  // addition: L8 a signed callback of another order, amount or currency never reaches the provision
  it.each([
    [
      'another order id',
      { ...SECURE_CALLBACK, oid: 'ORDER1' },
      { ...payOrder, id: 'ORDER12' },
      'order_id',
      'ORDER12',
      'ORDER1',
    ],
    [
      'a longer order id',
      { ...SECURE_CALLBACK, oid: 'ORDER12' },
      { ...payOrder, id: 'ORDER1' },
      'order_id',
      'ORDER1',
      'ORDER12',
    ],
    [
      'a padded order id',
      { ...SECURE_CALLBACK, oid: ' 2022103030CB' },
      payOrder,
      'order_id',
      '2022103030CB',
      ' 2022103030CB',
    ],
    ['no order id', (({ oid: _o, ...rest }) => rest)(SECURE_CALLBACK), payOrder, 'order_id', '2022103030CB', ''],
    ['an empty order id', { ...SECURE_CALLBACK, oid: '' }, payOrder, 'order_id', '2022103030CB', ''],
    ['an order without id', SECURE_CALLBACK, { amount: 1.01, currency: CURRENCY.TRY }, 'order_id', '', '2022103030CB'],
    ['another amount', { ...SECURE_CALLBACK, amount: '10.01' }, { ...payOrder, amount: 10 }, 'amount', '10', '10.01'],
    ['a malformed amount', { ...SECURE_CALLBACK, amount: '1.01x' }, payOrder, 'amount', '1.01', '1.01x'],
    ['an empty amount', { ...SECURE_CALLBACK, amount: '' }, payOrder, 'amount', '1.01', ''],
    ['another currency', { ...SECURE_CALLBACK, currency: '840' }, payOrder, 'currency', '949', '840'],
    ['a padded currency', { ...SECURE_CALLBACK, currency: '949 ' }, payOrder, 'currency', '949', '949 '],
    ['the currency of a USD order', SECURE_CALLBACK, { ...payOrder, currency: CURRENCY.USD }, 'currency', '840', '949'],
  ] as const)(
    'a hash-valid callback with %s is OrderMismatchError before any request',
    async (_n, cb, order, field, expected, actual) => {
      const { result, sent, hook } = await run(cb as Record<string, string>, order as PosOrder)
      expect(result).toBeInstanceOf(OrderMismatchError)
      const err = result as OrderMismatchError
      expect([err.field, err.expected, err.actual]).toStrictEqual([field, expected, actual])
      expect(err.paymentMayHaveCompleted).toBe(false)
      expect(err.response).toBeUndefined()
      expect(sent).toHaveLength(0)
      expect(hook).not.toHaveBeenCalled()
    },
  )

  it('the same callback provisions an order whose amount is within 0.005, with or without a currency', async () => {
    for (const order of [
      payOrder,

      { ...payOrder, amount: 1.0149 },
      { id: '2022103030CB', amount: 1.01 },
    ]) {
      const { result, sent, hook } = await run(SECURE_CALLBACK, order as PosOrder)
      expect((result as Data).status).toBe('approved')
      expect(sent).toHaveLength(1)
      expect(hook).toHaveBeenCalledTimes(1)
    }
  })

  it('a callback without amount or currency is bound by its order id only', async () => {
    const { amount: _a, currency: _c, ...withoutBoth } = SECURE_CALLBACK
    const { result, sent } = await run(withoutBoth)
    expect((result as Data).status).toBe('approved')
    expect(sent).toHaveLength(1)
    const other = await run({ ...withoutBoth, oid: 'X' })
    expect((other.result as OrderMismatchError).field).toBe('order_id')
    expect(other.sent).toHaveLength(0)
  })

  it('a failed 3D authentication is still mapped as a decline without binding or request', async () => {
    const { result, sent } = await run({ ...SECURE_CALLBACK, oid: 'SOMEONE-ELSE', mdStatus: '0' })
    expect((result as Data).status).toBe('declined')
    expect(sent).toHaveLength(0)
  })
})
