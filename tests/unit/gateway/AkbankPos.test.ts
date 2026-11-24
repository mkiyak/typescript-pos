import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { AkbankPosHttpClient } from '../../../src/client/AkbankPosHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { AkbankPosCrypt } from '../../../src/crypt/AkbankPosCrypt.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { AkbankPosRequestDataMapper } from '../../../src/data-mapper/request/mapper/AkbankPosRequestDataMapper.js'
import type { RequestDataMapperInterface } from '../../../src/data-mapper/request/mapper/RequestDataMapperInterface.js'
import { AkbankPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/AkbankPosRequestValueFormatter.js'
import { AkbankPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/AkbankPosRequestValueMapper.js'
import { AkbankPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/AkbankPosResponseDataMapper.js'
import type { ResponseDataMapperInterface } from '../../../src/data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { BasicResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { AkbankPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/AkbankPosResponseValueMapper.js'
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
import { AkbankPos } from '../../../src/gateway/AkbankPos.js'
import type { PosLogger } from '../../../src/logger.js'
import type { AkbankPosAccount } from '../../../src/model/account/AkbankPosAccount.js'
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
import { QUERY_TYPE } from '../../../src/pos-query/PosQueryInterface.js'
import type { GatewayResponseData, PosHooks, PosOrder, RequestDataPreparedEvent } from '../../../src/types.js'
import {
  threeDHostCases,
  threeDPayCases,
  threeDPaymentCases,
} from '../data-mapper/response/mapper/AkbankPosResponseDataMapper.data.js'

// Dependencies are replaced by vi.fn() fakes except the request value mapper and formatter; the end-to-end section
// at the bottom uses the real mappers, crypt and HTTP client over a fake fetch that checks every request signature.

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

const PAYMENT_API = 'https://apipre.akbank.com/api/v1/payment/virtualpos'
const GATEWAY_3D = 'https://virtualpospaymentgateway.akbank.com/securepay'
const GATEWAY_3D_HOST = 'https://virtualpospaymentgateway.akbank.com/payhosting'
const MERCHANT_SAFE_ID = '2023090417500272654BD9A49CF07574'
const TERMINAL_SAFE_ID = '2023090417500284633D137A249DBBEB'
const SECRET_KEY =
  '3230323330393034313735303032363031353172675f357637355f3273387373745f7233725f73323333383737335f323272383774767276327672323531355f'

const config: GatewayConfig = {
  name: 'AKBANK T.A.S.',
  class: 'AkbankPos',
  gateway_endpoints: { payment_api: PAYMENT_API, gateway_3d: GATEWAY_3D, gateway_3d_host: GATEWAY_3D_HOST },
}

/** `disable_3d_hash_check` is not an option; passing it must have no effect. */
const configWithHashCheckDisabled = {
  ...config,
  gateway_configs: { disable_3d_hash_check: true },
} as unknown as GatewayConfig

const createAccount = (merchantSafeId = MERCHANT_SAFE_ID, terminalSafeId = TERMINAL_SAFE_ID): AkbankPosAccount =>
  AccountFactory.createAkbankPosAccount('akbank-pos', merchantSafeId, terminalSafeId, SECRET_KEY)

const H = (s: string): string =>
  createHmac('sha512', Buffer.from(SECRET_KEY, 'utf8')).update(s, 'utf8').digest('base64')

/** Signs a callback over the fields its `hashParams` names, as the bank does. */
const sign = (cb: Record<string, string>): Record<string, string> => ({
  ...cb,
  hash: H(
    (cb.hashParams ?? '')
      .split('+')
      .map((name) => cb[name] ?? '')
      .join(''),
  ),
})

const createLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })

const fixture = (cases: Record<string, Data>, name: string, key: string): Record<string, string> =>
  ({ ...(cases[name] as Data)[key] }) as Record<string, string>

const secureSuccess = () => fixture(threeDPaymentCases, 'success1', 'threeDResponseData')
const securePaymentFail = () => fixture(threeDPaymentCases, '3d_auth_success_payment_fail', 'threeDResponseData')
const secureAuthFail = () => fixture(threeDPaymentCases, '3d_auth_fail', 'threeDResponseData')
const paySuccess = () => fixture(threeDPayCases, 'success1', 'paymentData')
const payAuthFail = () => fixture(threeDPayCases, 'auth_fail', 'paymentData')
const hostSuccess = () => fixture(threeDHostCases, 'success1', 'paymentData')
const hostAuthFail = () => fixture(threeDHostCases, 'auth_fail', 'paymentData')

/** The signed payment_fail fixture with its field list as signed (the fixture text carries a stray marker). */
const payPaymentFail = (): Record<string, string> => {
  const cb = fixture(threeDPayCases, 'payment_fail', 'paymentData')
  return { ...cb, hashParams: (cb.hashParams as string).replace(' ◀', '') }
}

/** Declined by the API although the host approved (`hostResponseCode` 00), signed over all its fields. */
const hostApprovedDeclined = (): Record<string, string> =>
  sign({
    txnCode: '1000',
    responseCode: 'VPS-1005',
    responseMessage: 'Provizyon Hatası',
    hostResponseCode: '00',
    hostMessage: '000 ONAY KODU XXXXXX',
    txnDateTime: '2024-04-20T15:20:45.000',
    merchantSafeId: MERCHANT_SAFE_ID,
    terminalSafeId: TERMINAL_SAFE_ID,
    orderId: '202404207281',
    authCode: '000000',
    rrn: '411224360676',
    batchNumber: '46',
    hashParams:
      'txnCode+responseCode+responseMessage+hostResponseCode+hostMessage+txnDateTime+merchantSafeId+terminalSafeId+orderId+authCode+rrn+batchNumber',
  })

/**
 * An approved 3D Pay callback for order '1001' paid by '2X**', re-split as order '10012' paid by 'X**': the values
 * are concatenated without separator, so the hash is unchanged.
 */
const prefixShiftedCallback = (): Record<string, string> => ({
  txnCode: '1000',
  responseCode: 'VPS-0000',
  responseMessage: 'BAŞARILI',
  hostResponseCode: '00',
  hostMessage: '000 ONAY KODU XXXXXX',
  txnDateTime: '2024-04-18T20:27:45.000',
  merchantSafeId: MERCHANT_SAFE_ID,
  terminalSafeId: TERMINAL_SAFE_ID,
  orderId: '10012',
  cardHolderName: 'X**',
  authCode: '306456',
  rrn: '411024360235',
  batchNumber: '43',
  stan: '86',
  hashParams:
    'txnCode+responseCode+responseMessage+hostResponseCode+hostMessage+txnDateTime+merchantSafeId+terminalSafeId+orderId+cardHolderName+authCode+rrn+batchNumber+stan',
  hash: 'O9AMUq2cifbyOOjbx/nw76opeJhKlwdu/yipsQmRNrvO2BXgEunq9zS068Dy+ooQL5BkexFgGmpovVQTTiU/jQ==',
})

const cb = (data: Record<string, unknown>): GatewayResponseData => data as GatewayResponseData

describe('AkbankPos (mocked collaborators)', () => {
  const account = createAccount()
  let requestValueMapper: AkbankPosRequestValueMapper
  let requestMapper: Mocked<RequestDataMapperInterface>
  let responseMapper: Mocked<ResponseDataMapperInterface>
  let crypt: Mocked<CryptInterface>
  let httpClient: { supportsTx: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }
  let clientStrategy: { getClient: ReturnType<typeof vi.fn>; getAllClients: ReturnType<typeof vi.fn> }
  let requestDataPrepared: ReturnType<typeof vi.fn<(e: RequestDataPreparedEvent) => void>>
  let logger: ReturnType<typeof createLogger>
  let pos: AkbankPos

  const createGateway = (cfg: GatewayConfig): AkbankPos => {
    const hooks: PosHooks = { onRequestDataPrepared: [requestDataPrepared] }
    const deps: GatewayDeps<AkbankPosAccount> = {
      requestValueMapper,
      requestValueFormatter: new AkbankPosRequestValueFormatter(),
      requestDataMapper: requestMapper as unknown as RequestDataMapperInterface<AkbankPosAccount>,
      responseDataMapper: responseMapper as unknown as ResponseDataMapperInterface,
      crypt: crypt as unknown as CryptInterface<AkbankPosAccount>,
      clientStrategy: clientStrategy as unknown as HttpClientStrategy,
      logger,
      hooks,
    }
    return new AkbankPos(cfg, account, deps)
  }

  beforeEach(() => {
    requestValueMapper = new AkbankPosRequestValueMapper()
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
    decodedResponse: Data | Error,
    order: PosOrder,
    paymentModel: PaymentModel,
  ): (() => void) => {
    clientStrategy.getClient.mockReturnValue(httpClient as unknown as AbstractHttpClient)
    if (decodedResponse instanceof Error) {
      httpClient.request.mockRejectedValue(decodedResponse)
    } else {
      httpClient.request.mockResolvedValue(decodedResponse)
    }
    requestDataPrepared.mockImplementation((event) => {
      expect(event.gatewayClass).toBe('AkbankPos')
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

  /** The order history round trip that confirms an approved 3D Pay / 3D Host result. */
  const configureConfirmation = (order: PosOrder, txType: TxType): (() => void) => {
    const historyOrder = { id: order.id }
    const requestData = { txnCode: '1010', order: { orderId: order.id } }
    requestMapper.createOrderHistoryRequestData.mockReturnValue(requestData)
    responseMapper.mapOrderHistoryResponse.mockReturnValue({
      status: 'approved',
      order_id: order.id,
      transactions: [
        {
          status: 'approved',
          transaction_type: txType,
          order_status: 'PAYMENT_COMPLETED',
          first_amount: 1.01,
          currency: 'TRY',
        },
      ],
    })
    const verifyClient = configureClientResponse(
      TX_TYPE.ORDER_HISTORY,
      requestData,
      { responseCode: 'VPS-0000' },
      historyOrder,
      MODEL.NON_SECURE,
    )

    return () => {
      verifyClient()
      expect(requestMapper.createOrderHistoryRequestData).toHaveBeenCalledTimes(1)
      expect(requestMapper.createOrderHistoryRequestData).toHaveBeenCalledWith(account, historyOrder)
      expect(responseMapper.mapOrderHistoryResponse).toHaveBeenCalledTimes(1)
      expect(responseMapper.mapOrderHistoryResponse).toHaveBeenCalledWith({ responseCode: 'VPS-0000' })
    }
  }

  const expectNoRequest = () => {
    expect(httpClient.request).not.toHaveBeenCalled()
    expect(requestDataPrepared).not.toHaveBeenCalled()
    expect(requestMapper.createOrderHistoryRequestData).not.toHaveBeenCalled()
  }

  it('init', () => {
    expect(pos.getAccount()).toBe(account)
    expect(pos.isTestMode()).toBe(false)
    expect(pos.getCrypt()).toBe(crypt)
  })

  it('init on test mode logs a warning', () => {
    // deviation: A22 test_mode lives at the top level of the TS config; the warning is in English
    const p = createGateway({ ...config, test_mode: true })

    expect(requestMapper.setTestMode).toHaveBeenCalledTimes(1)
    expect(requestMapper.setTestMode).toHaveBeenCalledWith(true)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'The test_mode gateway setting does not affect request data for this gateway; test and production ' +
        'environments are selected by the endpoint URLs in the config',
      { gateway: 'AkbankPos' },
    )
    expect(p.isTestMode()).toBe(true)
  })

  // addition: identifiers and the supported transactions table
  it('exposes NAME, the gateway class identifier and the supported transactions', () => {
    expect(AkbankPos.NAME).toBe('AkbankPos')
    expect(AkbankPos.GATEWAY_CLASS).toBe('AkbankPos')
    for (const tx of [TX_TYPE.PAY_AUTH, TX_TYPE.PAY_PRE_AUTH]) {
      for (const model of [MODEL.THREE_D_SECURE, MODEL.THREE_D_PAY, MODEL.THREE_D_HOST, MODEL.NON_SECURE]) {
        expect(AkbankPos.isSupportedTransaction(tx, model)).toBe(true)
      }
      expect(AkbankPos.isSupportedTransaction(tx, MODEL.THREE_D_PAY_HOSTING)).toBe(false)
    }
    for (const tx of [
      TX_TYPE.PAY_POST_AUTH,
      TX_TYPE.CANCEL,
      TX_TYPE.REFUND,
      TX_TYPE.REFUND_PARTIAL,
      TX_TYPE.ORDER_HISTORY,
    ]) {
      expect(AkbankPos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(true)
    }
    expect(AkbankPos.isSupportedTransaction(TX_TYPE.STATUS, MODEL.NON_SECURE)).toBe(false)
  })

  it('get3DGatewayURL', () => {
    expect(pos.get3DGatewayURL()).toBe(GATEWAY_3D)
  })

  it('get3DGatewayURL for 3D Host', () => {
    expect(pos.get3DGatewayURL(MODEL.THREE_D_HOST)).toBe(GATEWAY_3D_HOST)
  })

  // ---- 3D Pay / 3D Host ----

  type HostedRow = [name: string, order: PosOrder, callback: Record<string, string>, expected: Data]

  const hostedRows = (success: Record<string, string>, authFail: Record<string, string>): HostedRow[] => [
    [
      'auth_fail',
      { id: authFail.orderId as string, amount: 1.01, currency: CURRENCY.TRY, installment: 0 },
      authFail,
      { status: 'declined', order_id: authFail.orderId, proc_return_code: 'VPS-1279', requires_manual_review: false },
    ],
    [
      'success',
      { id: success.orderId as string, amount: 1.01, currency: CURRENCY.TRY, installment: 0 },
      success,
      { status: 'approved', order_id: success.orderId, proc_return_code: 'VPS-0000', requires_manual_review: false },
    ],
  ]

  describe.each([
    ['3D Pay', MODEL.THREE_D_PAY, 'map3DPayResponseData', hostedRows(paySuccess(), payAuthFail())],
    ['3D Host', MODEL.THREE_D_HOST, 'map3DHostResponseData', hostedRows(hostSuccess(), hostAuthFail())],
  ] as Array<[string, PaymentModel, 'map3DPayResponseData' | 'map3DHostResponseData', HostedRow[]]>)(
    '%s',
    (_label, paymentModel, mapperMethod, rows) => {
      // deviation: A8/A4 the rows use the signed bank callbacks and orders with their own ids; approved results are
      // confirmed with one order history request
      it.each(rows)('payment %s', async (_name, order, callback, expected) => {
        crypt.check3DHash.mockReturnValue(true)
        responseMapper[mapperMethod].mockReturnValue(expected)
        const verifyConfirmation =
          expected.status === 'approved' ? configureConfirmation(order, TX_TYPE.PAY_AUTH) : null

        const result = await pos.payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb(callback))

        expect(result).toStrictEqual(expected)
        expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
        expect(crypt.check3DHash).toHaveBeenCalledWith(account, callback)
        expect(responseMapper.extractMdStatus).not.toHaveBeenCalled()
        expect(responseMapper.is3dAuthSuccess).not.toHaveBeenCalled()
        expect(responseMapper[mapperMethod]).toHaveBeenCalledTimes(1)
        expect(responseMapper[mapperMethod]).toHaveBeenCalledWith(callback, TX_TYPE.PAY_AUTH, order)
        if (verifyConfirmation) {
          verifyConfirmation()
        } else {
          expectNoRequest()
        }
      })

      // deviation: A5 disable_3d_hash_check is ignored, the hash is still checked once
      it.each(rows)('payment without hash check %s', async (_name, order, callback, expected) => {
        const p = createGateway(configWithHashCheckDisabled)
        crypt.check3DHash.mockReturnValue(true)
        responseMapper[mapperMethod].mockReturnValue(expected)
        const verifyConfirmation =
          expected.status === 'approved' ? configureConfirmation(order, TX_TYPE.PAY_AUTH) : null

        const result = await p.payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb(callback))

        expect(result).toStrictEqual(expected)
        expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
        expect(responseMapper.extractMdStatus).not.toHaveBeenCalled()
        expect(responseMapper.is3dAuthSuccess).not.toHaveBeenCalled()
        expect(responseMapper[mapperMethod]).toHaveBeenCalledTimes(1)
        if (verifyConfirmation) {
          verifyConfirmation()
        } else {
          expectNoRequest()
        }
      })

      it('payment hash mismatch', async () => {
        const orderId = paymentModel === MODEL.THREE_D_PAY ? '2024041811DA' : '2024041898FD'
        const callback = { txnCode: '1000', responseCode: 'VPS-0000', orderId }
        crypt.check3DHash.mockReturnValue(false)

        await expect(pos.payment(paymentModel, {}, TX_TYPE.PAY_AUTH, null, cb(callback))).rejects.toThrow(
          HashMismatchError,
        )
        expect(crypt.check3DHash).toHaveBeenCalledWith(account, callback)
        expect(responseMapper[mapperMethod]).not.toHaveBeenCalled()
        expectNoRequest()
      })

      // addition: A6 fail closed when the mapper approves a callback whose response code is not the approval
      it('a declined callback mapped as approved is rejected (PosError) without confirmation', async () => {
        const [, order, callback] = rows[0] as HostedRow
        crypt.check3DHash.mockReturnValue(true)
        responseMapper[mapperMethod].mockReturnValue({ status: 'approved', order_id: order.id })

        const err = await pos.payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb(callback)).catch((e) => e)
        expect(err).toBeInstanceOf(PosError)
        expect(err).not.toBeInstanceOf(OrderMismatchError)
        expectNoRequest()
      })
    },
  )

  // ---- 3D Secure ----

  type SecureRow = [
    name: string,
    order: PosOrder,
    callback: Record<string, string>,
    paymentResponse: Data,
    expected: Data,
    is3DSuccess: boolean,
  ]

  const secureOrder = (id: string): PosOrder => ({
    id,
    amount: 1.01,
    currency: CURRENCY.TRY,
    ip: '127.0.0.1',
    installment: 0,
  })

  const secureSuccessRows: SecureRow[] = [
    // deviation: A4/A7 need the signed fields and the order id
    [
      '3d_auth_success_payment_fail',
      secureOrder('20240420D268'),
      securePaymentFail(),
      { responseCode: 'VPS-1005' },
      { status: 'declined' },
      true,
    ],
    // deviation: A4/A7 need the signed fields and the order id
    [
      'success',
      secureOrder('20240418BA6C'),
      secureSuccess(),
      { responseCode: 'VPS-0000' },
      { status: 'approved' },
      true,
    ],
  ]

  const secureRows: SecureRow[] = [
    [
      'auth_fail',
      { id: 'order-3d-fail' },
      { orderId: '20240418D4A6', responseCode: 'VPS-1279' },
      {},
      { status: 'declined' },
      false,
    ],
    ...secureSuccessRows,
  ]

  const run3DPaymentRow = async (p: AkbankPos, row: SecureRow) => {
    const [, order, callback, paymentResponse, expected, is3DSuccess] = row
    const requestData = { request: 'create3DPaymentRequestData' }
    responseMapper.map3DPaymentData.mockReturnValue(expected)
    let verifyClient: (() => void) | null = null
    if (is3DSuccess) {
      crypt.check3DHash.mockReturnValue(true)
      requestMapper.create3DPaymentRequestData.mockReturnValue(requestData)
      verifyClient = configureClientResponse(
        TX_TYPE.PAY_AUTH,
        requestData,
        paymentResponse,
        order,
        MODEL.THREE_D_SECURE,
      )
    }

    const result = await p.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, cb(callback))

    expect(result).toStrictEqual(expected)
    // deviation: A6 3D success is decided on the callback's own response code, the mapper is not consulted
    expect(responseMapper.extractMdStatus).not.toHaveBeenCalled()
    expect(responseMapper.is3dAuthSuccess).not.toHaveBeenCalled()
    expect(responseMapper.map3DPaymentData).toHaveBeenCalledTimes(1)
    if (is3DSuccess) {
      expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
      expect(crypt.check3DHash).toHaveBeenCalledWith(account, callback)
      expect(requestMapper.create3DPaymentRequestData).toHaveBeenCalledWith(account, order, TX_TYPE.PAY_AUTH, callback)
      verifyClient?.()
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(callback, paymentResponse, TX_TYPE.PAY_AUTH, order)
    } else {
      expect(crypt.check3DHash).not.toHaveBeenCalled()
      expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
      expect(requestDataPrepared).not.toHaveBeenCalled()
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(callback, null, TX_TYPE.PAY_AUTH, order)
    }
  }

  it.each(secureRows)('3D payment %s', async (...row) => {
    await run3DPaymentRow(pos, row)
  })

  // deviation: A5 disable_3d_hash_check is ignored, the hash is still checked once
  it.each(secureSuccessRows)('3D payment without hash check %s', async (...row) => {
    await run3DPaymentRow(createGateway(configWithHashCheckDisabled), row)
  })

  it('3D payment hash mismatch', async () => {
    const callback = { txnCode: '3001', responseCode: 'VPS-0000', orderId: '20240418BA6C' }
    crypt.check3DHash.mockReturnValue(false)

    await expect(pos.payment(MODEL.THREE_D_SECURE, {}, TX_TYPE.PAY_AUTH, null, cb(callback))).rejects.toThrow(
      HashMismatchError,
    )
    expect(crypt.check3DHash).toHaveBeenCalledWith(account, callback)
    expect(responseMapper.map3DPaymentData).not.toHaveBeenCalled()
    expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
    expect(requestDataPrepared).not.toHaveBeenCalled()
  })

  // addition: A6 fail closed when a callback without 3D success is not mapped as declined
  it('3D payment: a callback without 3D success mapped as approved is rejected (PosError)', async () => {
    responseMapper.map3DPaymentData.mockReturnValue({ status: 'approved' })

    await expect(
      pos.payment(MODEL.THREE_D_SECURE, { id: 'x' }, TX_TYPE.PAY_AUTH, null, cb({ responseCode: 'VPS-1279' })),
    ).rejects.toThrow('3D callback without 3D success was not mapped as declined')
    expect(httpClient.request).not.toHaveBeenCalled()
  })

  // ---- 3D form ----

  type FormRow = [name: string, order: PosOrder, model: PaymentModel, isWithCard: boolean, formData: Data, url: string]

  const formOrder = (amount: number): PosOrder => ({
    id: '2020110828BC',
    amount,
    ip: '127.0.0.1',
    installment: 0,
    currency: CURRENCY.TRY,
    success_url: 'http:://localhost/success',
    fail_url: 'http:://localhost/fail',
  })

  it.each([
    [
      '3d_host',
      formOrder(10),
      MODEL.THREE_D_HOST,
      false,
      {
        gateway: 'https://virtualpospaymentgatewaypre.akbank.com/payhosting',
        method: 'POST',
        inputs: {
          paymentModel: '3D_PAY_HOSTING',
          txnCode: '3000',
          merchantSafeId: MERCHANT_SAFE_ID,
          terminalSafeId: TERMINAL_SAFE_ID,
          hash: 'hash-123',
        },
      },
      GATEWAY_3D_HOST,
    ],
    [
      '3d_pay',
      formOrder(1.1),
      MODEL.THREE_D_PAY,
      true,
      {
        gateway: 'https://virtualpospaymentgatewaypre.akbank.com/securepay',
        method: 'POST',
        inputs: {
          paymentModel: '3D_PAY',
          txnCode: '3000',
          merchantSafeId: MERCHANT_SAFE_ID,
          terminalSafeId: TERMINAL_SAFE_ID,
          orderId: '2020110828BC',
          hash: 'hash-123',
        },
      },
      GATEWAY_3D,
    ],
    [
      '3d_secure',
      formOrder(1.1),
      MODEL.THREE_D_SECURE,
      true,
      {
        gateway: 'https://virtualpospaymentgatewaypre.akbank.com/securepay',
        method: 'POST',
        inputs: {
          paymentModel: '3D',
          txnCode: '3000',
          merchantSafeId: MERCHANT_SAFE_ID,
          terminalSafeId: TERMINAL_SAFE_ID,
          orderId: '2020110828BC',
          hash: 'hash-123',
        },
      },
      GATEWAY_3D,
    ],
  ] as FormRow[])('get3DFormData %s', async (_name, order, paymentModel, isWithCard, formData, gatewayUrl) => {
    const c = isWithCard ? card() : null
    requestMapper.create3DFormData.mockResolvedValue(formData)

    const actual = await pos.get3DFormData(order, paymentModel, TX_TYPE.PAY_AUTH, c, !isWithCard)

    expect(requestMapper.create3DFormData).toHaveBeenCalledTimes(1)
    expect(requestMapper.create3DFormData).toHaveBeenCalledWith(account, order, paymentModel, 'pay', gatewayUrl, c)
    expect(actual).toStrictEqual(formData)
  })

  // deviation: A22 English messages and error classes of the shared 3D form input check
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
      '3d_host_with_card',
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_AUTH,
      true,
      false,
      PosError,
      'Do not use [3d_host] payment model with card data. Use [3d, 3d_pay, regular] payment model(s) instead.',
      null,
    ],
    [
      'unsupported_payment_model',
      MODEL.THREE_D_PAY_HOSTING,
      TX_TYPE.PAY_AUTH,
      false,
      true,
      UnsupportedTransactionTypeError,
      'AkbankPos supports [3d, 3d_pay, 3d_host, regular] payment model(s) for transaction type [pay]. Provided payment model: [3d_pay_hosting].',
      null,
    ],
    [
      'non_payment_tx_type',
      MODEL.THREE_D_PAY,
      QUERY_TYPE.HISTORY as unknown as TxType,
      false,
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
    },
  )

  // ---- non-3D transactions ----

  it('order history', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { txnCode: '1010', order: { orderId: '2020110828BC' } }
    const decoded = { txnCode: '1010', responseCode: 'VPS-0000' }
    requestMapper.createOrderHistoryRequestData.mockReturnValue(requestData)
    responseMapper.mapOrderHistoryResponse.mockReturnValue({ status: 'approved' })
    const verify = configureClientResponse(TX_TYPE.ORDER_HISTORY, requestData, decoded, order, MODEL.NON_SECURE)

    const result = await pos.orderHistory(order)

    verify()
    expect(requestMapper.createOrderHistoryRequestData).toHaveBeenCalledWith(account, order)
    expect(responseMapper.mapOrderHistoryResponse).toHaveBeenCalledWith(decoded)
    expect(result).toStrictEqual({ status: 'approved' })
  })

  it('regular payment', async () => {
    const order = { id: '2020110828BC' }
    const c = card()
    const requestData = { request: 'createNonSecurePaymentRequestData' }
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue(requestData)
    responseMapper.mapPaymentResponse.mockReturnValue({ result: true })
    const verify = configureClientResponse(
      TX_TYPE.PAY_AUTH,
      requestData,
      { paymentResponse: true },
      order,
      MODEL.NON_SECURE,
    )

    await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, c)

    verify()
    expect(requestMapper.createNonSecurePaymentRequestData).toHaveBeenCalledWith(account, order, TX_TYPE.PAY_AUTH, c)
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith({ paymentResponse: true }, TX_TYPE.PAY_AUTH, order)
  })

  it('regular payment bad request', async () => {
    const order = { id: '2020110828BC' }
    const c = card()
    const requestData = { request: 'createNonSecurePaymentRequestData' }
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue(requestData)
    configureClientResponse(
      TX_TYPE.PAY_AUTH,
      requestData,
      new PosHttpError('HTTP 400', { url: PAYMENT_API, status: 400, body: '{"code":123,"message":"error"}' }),
      order,
      MODEL.NON_SECURE,
    )

    // deviation: A22 PosHttpError instead of RuntimeException
    await expect(pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, c)).rejects.toThrow(PosHttpError)
    expect(responseMapper.mapPaymentResponse).not.toHaveBeenCalled()
  })

  it('regular post-auth payment', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { request: 'createNonSecurePostAuthPaymentRequestData' }
    requestMapper.createNonSecurePostAuthPaymentRequestData.mockReturnValue(requestData)
    responseMapper.mapPaymentResponse.mockReturnValue({ result: true })
    const verify = configureClientResponse(
      TX_TYPE.PAY_POST_AUTH,
      requestData,
      { paymentResponse: true },
      order,
      MODEL.NON_SECURE,
    )

    await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_POST_AUTH)

    verify()
    expect(requestMapper.createNonSecurePostAuthPaymentRequestData).toHaveBeenCalledWith(account, order)
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith(
      { paymentResponse: true },
      TX_TYPE.PAY_POST_AUTH,
      order,
    )
  })

  it('status request', async () => {
    // deviation: A21 status rejects instead of throwing synchronously
    await expect(pos.status({})).rejects.toThrow(UnsupportedTransactionTypeError)
    expect(requestMapper.createStatusRequestData).not.toHaveBeenCalled()
    expect(httpClient.request).not.toHaveBeenCalled()
  })

  it('cancel request', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { request: 'createCancelRequestData' }
    requestMapper.createCancelRequestData.mockReturnValue(requestData)
    responseMapper.mapCancelResponse.mockReturnValue({ result: true })
    const verify = configureClientResponse(
      TX_TYPE.CANCEL,
      requestData,
      { decodedResponse: true },
      order,
      MODEL.NON_SECURE,
    )

    await pos.cancel(order)

    verify()
    expect(requestMapper.createCancelRequestData).toHaveBeenCalledWith(account, order)
    expect(responseMapper.mapCancelResponse).toHaveBeenCalledWith({ decodedResponse: true })
  })

  it.each([
    ['full_refund', { id: '2020110828BC', amount: 5 }, TX_TYPE.REFUND],
    ['partial_refund', { id: '2020110828BC', amount: 5, order_amount: 10 }, TX_TYPE.REFUND_PARTIAL],
  ] as Array<[string, PosOrder, TxType]>)('refund request %s', async (_name, order, txType) => {
    const requestData = { request: 'createRefundRequestData' }
    requestMapper.createRefundRequestData.mockReturnValue(requestData)
    responseMapper.mapRefundResponse.mockReturnValue({ result: true })
    const verify = configureClientResponse(txType, requestData, { decodedResponse: true }, order, MODEL.NON_SECURE)

    await pos.refund(order)

    verify()
    expect(requestMapper.createRefundRequestData).toHaveBeenCalledWith(account, order, txType)
    expect(responseMapper.mapRefundResponse).toHaveBeenCalledWith({ decodedResponse: true })
  })
})

// ---------- end to end: real mappers, crypt and HTTP client over a fake fetch ----------

type Sent = { url: string; body: string; json: Data; authHash: string }

/** Requests whose `auth-hash` header was not the signature of the exact body received. */
const unsignedRequests: Sent[] = []

afterEach(() => {
  expect(unsignedRequests).toStrictEqual([])
  unsignedRequests.length = 0
})

/**
 * A fetch that checks the `auth-hash` of every request against the body it received, records the requests and
 * answers with `answer` (an object is sent as JSON with status 200). Without an answer any request fails the test.
 */
function bankFetch(answer: ((json: Data, url: string) => Response | Data) | null = null) {
  const sent: Sent[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const body = await new Request('https://example.invalid', { method: 'POST', body: init?.body ?? '' }).text()
    const headers = new Headers(init?.headers)
    const entry: Sent = {
      url: String(url),
      body,
      json: JSON.parse(body) as Data,
      authHash: headers.get('auth-hash') ?? '',
    }
    sent.push(entry)
    if (entry.authHash !== H(body)) {
      unsignedRequests.push(entry)
    }
    if (answer === null) {
      throw new Error('no network expected')
    }
    const reply = answer(entry.json, entry.url)
    return reply instanceof Response ? reply : new Response(JSON.stringify(reply), { status: 200 })
  }) as unknown as typeof fetch

  return { sent, fetchImpl }
}

function realGateway(
  fetchImpl: typeof fetch,
  options: { cfg?: GatewayConfig; account?: AkbankPosAccount; logger?: PosLogger; hooks?: PosHooks } = {},
) {
  const acc = options.account ?? createAccount()
  const log = options.logger ?? createLogger()
  const cryptImpl = new AkbankPosCrypt(log)
  const valueMapper = new AkbankPosRequestValueMapper()
  const valueFormatter = new AkbankPosRequestValueFormatter()
  const hooks = options.hooks ?? {}
  const deps: GatewayDeps<AkbankPosAccount> = {
    requestValueMapper: valueMapper,
    requestValueFormatter: valueFormatter,
    requestDataMapper: new AkbankPosRequestDataMapper(valueMapper, valueFormatter, hooks, cryptImpl),
    responseDataMapper: new AkbankPosResponseDataMapper(
      new BasicResponseValueFormatter(),
      new AkbankPosResponseValueMapper(),
      log,
    ),
    crypt: cryptImpl,
    clientStrategy: new HttpClientStrategy([
      new AkbankPosHttpClient(PAYMENT_API, new HttpTransport({ fetch: fetchImpl }), log, cryptImpl, acc),
    ]),
    logger: log,
    hooks,
  }

  return new AkbankPos(options.cfg ?? config, acc, deps)
}

const secureE2EOrder: PosOrder = {
  id: '20240418BA6C',
  amount: 1.01,
  currency: CURRENCY.TRY,
  ip: '127.0.0.1',
  installment: 0,
}

const provisionApproved = (threeDPaymentCases.success1 as Data).paymentData as Data

describe('AkbankPos (end to end) 3D Secure', () => {
  const run = (callback: Record<string, unknown>, order: PosOrder = secureE2EOrder, account?: AkbankPosAccount) => {
    const { sent, fetchImpl } = bankFetch(() => provisionApproved)
    const p = realGateway(fetchImpl, account ? { account } : {})
    return {
      sent,
      result: p.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, cb(callback)).catch((e: unknown) => e),
    }
  }

  // addition: a signed 3D-successful callback is provisioned for the merchant's own order
  it('provisions a signed successful callback', async () => {
    const callback = secureSuccess()
    const { sent, result } = run(callback)
    const res = (await result) as Data

    expect(sent).toHaveLength(1)
    const [request] = sent as [Sent]
    expect(request.url).toBe(`${PAYMENT_API}/transaction/process`)
    expect(request.json.txnCode).toBe('1000')
    expect(request.json.order.orderId).toBe('20240418BA6C')
    expect(request.json.transaction.amount).toBe('1.01')
    expect(request.json.transaction.currencyCode).toBe(949)
    expect(request.json.secureTransaction).toStrictEqual({
      secureId: callback.secureId,
      secureEcomInd: callback.secureEcomInd,
      secureData: callback.secureData,
      secureMd: callback.secureMd,
    })
    expect(request.json.randomNumber).toMatch(/^[0-9A-Fa-f]{128}$/)

    expect(res.status).toBe('approved')
    expect(res.auth_code).toBe('306455')
    expect(res.ref_ret_num).toBe('411024360234')
    expect(res.batch_num).toBe(43)
    expect(res.eci).toBe('02')
    expect(res.transaction_time).toStrictEqual(new Date('2024-04-18T20:15:38.036+03:00'))
  })

  // addition: A7 the callback must belong to the order and the account, checked before any request
  it.each([
    ['order_id', { ...secureE2EOrder, id: 'X' }, createAccount(), 'X', '20240418BA6C'],
    ['merchant_id', secureE2EOrder, createAccount('OTHER'), 'OTHER', MERCHANT_SAFE_ID],
    ['terminal_id', secureE2EOrder, createAccount(MERCHANT_SAFE_ID, 'OTHER'), 'OTHER', TERMINAL_SAFE_ID],
  ] as Array<[string, PosOrder, AkbankPosAccount, string, string]>)(
    'OrderMismatchError %s before the provision request',
    async (field, order, account, expected, actual) => {
      const { sent, result } = run(secureSuccess(), order, account)
      const err = (await result) as OrderMismatchError
      expect(err).toBeInstanceOf(OrderMismatchError)
      expect(err.field).toBe(field)
      expect(err.expected).toBe(expected)
      expect(err.actual).toBe(actual)
      expect(err.paymentMayHaveCompleted).toBe(false)
      expect(sent).toHaveLength(0)
    },
  )

  // addition: A3/A4 shifting a character from the transaction code into the response code keeps the hash valid
  it('rejects txnCode 300 + responseCode 1VPS-0000 (same hash) before any request', async () => {
    const callback = { ...secureSuccess(), txnCode: '300', responseCode: '1VPS-0000' }
    expect(new AkbankPosCrypt().check3DHash(createAccount(), cb(callback))).toBe(true)

    const { sent, result } = run(callback)
    expect(await result).toBeInstanceOf(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: A4 a 3D Secure callback carries no provision outcome yet
  it('rejects a signed successful callback carrying an authorization code', async () => {
    const original = secureSuccess()
    const callback = sign({ ...original, authCode: '306455', hashParams: `${original.hashParams}+authCode` })
    expect(new AkbankPosCrypt().check3DHash(createAccount(), cb(callback))).toBe(true)

    const { sent, result } = run(callback)
    const err = await result
    expect(err).toBeInstanceOf(HashMismatchError)
    expect((err as Error).message).toBe('3D callback fields are malformed')
    expect(sent).toHaveLength(0)
  })

  // addition: A4 a nested callback value is rejected before anything else
  it('rejects an object callback value (PosError)', async () => {
    const { sent, result } = run({ ...secureSuccess(), orderId: { a: 1 } })
    const err = await result
    expect(err).toBeInstanceOf(PosError)
    expect(err).not.toBeInstanceOf(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: A7 the remaining shift between orderId and secureId provisions the merchant's own order and amount
  it('a shifted order id provisions only the order given by the merchant, for its amount', async () => {
    const callback = { ...secureSuccess(), orderId: '20240418BA6CV', secureId: 'G8yV2tCRHpTSlpNN2VqcDJRS1k=' }
    const { sent, result } = run(callback, {
      id: '20240418BA6CV',
      amount: 7.5,
      currency: CURRENCY.TRY,
      ip: '127.0.0.1',
    })
    await result

    expect(sent).toHaveLength(1)
    expect((sent[0] as Sent).json.order.orderId).toBe('20240418BA6CV')
    expect((sent[0] as Sent).json.transaction.amount).toBe('7.50')
  })

  // addition: A5 a signed declined callback is verified and mapped declined without a request
  it('maps a signed declined callback without a request', async () => {
    const callback = secureAuthFail()
    const { sent, result } = run(callback, { ...secureE2EOrder, id: callback.orderId as string })
    const res = (await result) as Data
    expect(res.status).toBe('declined')
    expect(res.proc_return_code).toBe('VPS-1279')
    expect(sent).toHaveLength(0)
  })

  // addition: A5 a declined callback carrying a hash must verify
  it('rejects a declined callback with a wrong hash', async () => {
    const callback = { ...secureAuthFail(), hash: `${secureAuthFail().hash?.slice(0, -4)}AAA=` }
    const { sent, result } = run(callback)
    expect(await result).toBeInstanceOf(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: A5 an unsigned declined callback is mapped declined (no money moves)
  it('maps an unsigned declined callback without a request', async () => {
    const { sent, result } = run({ orderId: '20240418D4A6', responseCode: 'VPS-1279' }, { id: 'order-3d-fail' })
    const res = (await result) as Data
    expect(res.status).toBe('declined')
    expect(sent).toHaveLength(0)
  })

  // addition: A5 an unsigned successful callback is rejected
  it('rejects a successful callback without hash', async () => {
    const { hash: _hash, ...unsigned } = secureSuccess()
    const { sent, result } = run(unsigned)
    expect(await result).toBeInstanceOf(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: A4 a signed declined callback whose response code is malformed is rejected
  it('rejects a signed declined callback whose response code is malformed', async () => {
    const callback = sign({
      responseCode: 'VPS-12X9',
      responseMessage: 'x',
      orderId: 'A',
      hashParams: 'responseCode+responseMessage+orderId',
    })
    const { sent, result } = run(callback, { id: 'A' })
    expect(await result).toBeInstanceOf(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: A4 a signed successful callback must sign every field the provision depends on
  it('rejects a signed successful callback that does not sign its 3D values', async () => {
    const original = secureSuccess()
    const callback = sign({
      ...original,
      hashParams: 'txnCode+responseCode+responseMessage+txnDateTime+merchantSafeId+terminalSafeId+orderId',
    })
    const { sent, result } = run(callback)
    expect(await result).toBeInstanceOf(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: A5 disable_3d_hash_check has no effect
  it('disable_3d_hash_check does not disable the check', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl, { cfg: configWithHashCheckDisabled })
    await expect(
      p.payment(MODEL.THREE_D_SECURE, secureE2EOrder, TX_TYPE.PAY_AUTH, null, {
        ...secureSuccess(),
        responseMessage: 'X',
      }),
    ).rejects.toThrow(HashMismatchError)
    expect(sent).toHaveLength(0)
  })
})

/** The bank's order history answer confirming a 3D Pay / 3D Host payment. */
const historyAnswer = (orderId: string, overrides: Data = {}): Data => ({
  txnCode: '1010',
  responseCode: 'VPS-0000',
  responseMessage: 'BAŞARILI',
  txnDetailList: [
    {
      amount: 1.01,
      authCode: '306456',
      orderId,
      orgOrderId: orderId,
      maskedCardNumber: '435509******5232',
      txnDateTime: '2024-04-18T20:27:45.000',
      responseCode: 'VPS-0000',
      rrn: '411024360235',
      installCount: 1,
      txnCode: '3000',
      txnStatus: 'N',
      currencyCode: 949,
      batchNumber: 43,
      ...overrides,
    },
  ],
})

const payE2EOrder: PosOrder = { id: '2024041811DA', amount: 1.01, currency: CURRENCY.TRY, installment: 0 }

describe('AkbankPos (end to end) 3D Pay', () => {
  const run = (
    callback: Record<string, unknown>,
    order: PosOrder,
    answer: ((json: Data) => Response | Data) | null = null,
    cfg: GatewayConfig = config,
  ) => {
    const logger = createLogger()
    const { sent, fetchImpl } = bankFetch(answer)
    const p = realGateway(fetchImpl, { cfg, logger })
    return {
      sent,
      logger,
      result: p.payment(MODEL.THREE_D_PAY, order, TX_TYPE.PAY_AUTH, null, cb(callback)).catch((e: unknown) => e),
    }
  }

  // addition: A8 an approved callback is confirmed with one signed order history request
  it('confirms an approved callback with the bank order history', async () => {
    const { sent, result } = run(paySuccess(), payE2EOrder, () => historyAnswer('2024041811DA'))
    const res = (await result) as Data

    expect(res.status).toBe('approved')
    expect(res.requires_manual_review).toBe(false)
    expect(res.order_id).toBe('2024041811DA')
    expect(sent).toHaveLength(1)
    const [request] = sent as [Sent]
    expect(request.url).toBe(`${PAYMENT_API}/transaction/process`)
    expect(request.json.txnCode).toBe('1010')
    expect(request.json.order).toStrictEqual({ orderId: '2024041811DA' })
    expect(request.json.randomNumber).toMatch(/^[0-9A-Fa-f]{128}$/)
  })

  // addition: A8 the bank must confirm the order, type, amount and currency
  it.each([
    ['amount', historyAnswer('2024041811DA', { amount: 1.0 }), '1.01', '1.00'],
    ['currency', historyAnswer('2024041811DA', { currencyCode: 840 }), 'TRY', 'USD'],
    ['transaction_type', historyAnswer('2024041811DA', { txnCode: '3004' }), 'pay', 'pre'],
    ['order_id', { responseCode: 'VPS-1007', responseMessage: 'x' }, '2024041811DA', ''],
  ] as Array<[string, Data, string, string]>)(
    'OrderMismatchError %s when the order history does not confirm the payment',
    async (field, answer, expected, actual) => {
      const { sent, result } = run(paySuccess(), payE2EOrder, () => answer)
      const err = (await result) as OrderMismatchError
      expect(err).toBeInstanceOf(OrderMismatchError)
      expect(err.field).toBe(field)
      expect(err.expected).toBe(expected)
      expect(err.actual).toBe(actual)
      expect(err.paymentMayHaveCompleted).toBe(true)
      expect(err.response?.status).toBe('approved')
      expect(err.response?.requires_manual_review).toBe(true)
      expect(sent).toHaveLength(1)
    },
  )

  // addition: A8 errors of the confirmation request propagate unchanged
  it('a failing order history request propagates PosHttpError', async () => {
    const { sent, result } = run(paySuccess(), payE2EOrder, () => new Response('{"message":"x"}', { status: 500 }))
    const err = (await result) as PosHttpError
    expect(err).toBeInstanceOf(PosHttpError)
    expect(err.status).toBe(500)
    expect(sent).toHaveLength(1)
  })

  // addition: A8 the mapped order id is bound before any request
  it('OrderMismatchError order_id for another order, before any request', async () => {
    const { sent, result } = run(paySuccess(), { ...payE2EOrder, id: 'other' })
    const err = (await result) as OrderMismatchError
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect(err.field).toBe('order_id')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(sent).toHaveLength(0)
  })

  // addition: A8 approved callbacks are bound to the account
  it('OrderMismatchError merchant_id for another account, before any request', async () => {
    const { sent, fetchImpl } = bankFetch()
    const err = (await realGateway(fetchImpl, { account: createAccount('OTHER') })
      .payment(MODEL.THREE_D_PAY, payE2EOrder, TX_TYPE.PAY_AUTH, null, paySuccess())
      .catch((e: unknown) => e)) as OrderMismatchError
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect(err.field).toBe('merchant_id')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(sent).toHaveLength(0)
  })

  // addition: A8 prefix attack, a cheap payment for order 1001 re-split to complete order 10012
  it('a re-split order id is not approved: the bank has no such payment', async () => {
    const callback = prefixShiftedCallback()
    expect(new AkbankPosCrypt().check3DHash(createAccount(), cb(callback))).toBe(true)

    const { sent, result } = run(callback, { id: '10012', amount: 500, currency: CURRENCY.TRY }, () => ({
      responseCode: 'VPS-1007',
      responseMessage: 'x',
    }))
    const err = (await result) as OrderMismatchError
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect(err.field).toBe('order_id')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
    expect(sent).toHaveLength(1)
    expect((sent[0] as Sent).json.order).toStrictEqual({ orderId: '10012' })
  })

  // addition: A8 prefix attack, the history shows the amount the bank actually charged
  it('a re-split order id whose history shows another amount is not approved', async () => {
    const { result } = run(prefixShiftedCallback(), { id: '10012', amount: 500, currency: CURRENCY.TRY }, () =>
      historyAnswer('10012'),
    )
    const err = (await result) as OrderMismatchError
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect(err.field).toBe('amount')
    expect(err.expected).toBe('500.00')
    expect(err.actual).toBe('1.01')
    expect(err.paymentMayHaveCompleted).toBe(true)
  })

  // addition: A5 signed declined callbacks are mapped without confirmation
  it('maps the signed auth_fail callback declined without a request', async () => {
    const { sent, result } = run(payAuthFail(), { ...payE2EOrder, id: '202404180331' })
    const res = (await result) as Data
    expect(res.status).toBe('declined')
    expect(res.requires_manual_review).toBe(false)
    expect(sent).toHaveLength(0)
  })

  it('maps the signed payment_fail callback declined without a request', async () => {
    const { sent, result } = run(payPaymentFail(), { ...payE2EOrder, id: '202404207281' })
    const res = (await result) as Data
    expect(res.status).toBe('declined')
    expect(res.proc_return_code).toBe('VPS-1005')
    expect(res.requires_manual_review).toBe(false)
    expect(sent).toHaveLength(0)
  })

  // addition: A9 host approved, API declined
  it('a declined callback approved by the host is flagged for manual review, without confirmation', async () => {
    const { sent, logger, result } = run(hostApprovedDeclined(), { ...payE2EOrder, id: '202404207281' })
    const res = (await result) as Data
    expect(res.status).toBe('declined')
    expect(res.requires_manual_review).toBe(true)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(sent).toHaveLength(0)
  })

  it('a declined callback approved by the host for another order: payment may have completed', async () => {
    const { sent, result } = run(hostApprovedDeclined(), { ...payE2EOrder, id: 'Y' })
    const err = (await result) as OrderMismatchError
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect(err.field).toBe('order_id')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(sent).toHaveLength(0)
  })

  // addition: A5 an unsigned callback is rejected whatever require_3d_hash says
  it.each([
    ['without require_3d_hash', config],
    ['with require_3d_hash', { ...config, require_3d_hash: true }],
  ])('rejects the success callback without hash %s', async (_label, cfg) => {
    const { hash: _hash, ...unsigned } = paySuccess()
    const { sent, result } = run(unsigned, payE2EOrder, null, cfg)
    expect(await result).toBeInstanceOf(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  it('rejects an unsigned declined callback', async () => {
    const { hash: _hash, ...unsigned } = payAuthFail()
    const { sent, result } = run(unsigned, { ...payE2EOrder, id: '202404180331' })
    expect(await result).toBeInstanceOf(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: A4 the approval must carry a well-formed host outcome
  it.each([
    ['hostResponseCode is not 00', { hostResponseCode: '05' }],
    ['authCode is not six characters', { authCode: '30645' }],
    ['rrn is not twelve digits', { rrn: '41102436023' }],
    ['txnDateTime is malformed', { txnDateTime: '2024-04-18 20:27:45' }],
    ['txnCode is not four digits', { txnCode: '100' }],
  ] as Array<[string, Record<string, string>]>)(
    'rejects a signed approved callback whose %s',
    async (_label, changes) => {
      const { sent, result } = run(sign({ ...paySuccess(), ...changes }), payE2EOrder)
      const err = await result
      expect(err).toBeInstanceOf(HashMismatchError)
      expect((err as Error).message).toBe('3D callback fields are malformed')
      expect(sent).toHaveLength(0)
    },
  )

  // addition: A4 an approval that does not sign the host outcome is rejected
  it('rejects a signed approved callback that does not sign authCode', async () => {
    const callback = sign({
      ...paySuccess(),
      hashParams:
        'txnCode+responseCode+responseMessage+hostResponseCode+hostMessage+txnDateTime+merchantSafeId+terminalSafeId+orderId+cardHolderName+rrn',
    })
    const { sent, result } = run(callback, payE2EOrder)
    expect(await result).toBeInstanceOf(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: A4 a signed declined callback must sign the order id
  it('rejects a signed declined callback that does not sign the order id', async () => {
    const callback = sign({ ...payAuthFail(), hashParams: 'responseCode+responseMessage' })
    const { sent, result } = run(callback, { ...payE2EOrder, id: '202404180331' })
    expect(await result).toBeInstanceOf(HashMismatchError)
    expect(sent).toHaveLength(0)
  })

  // addition: A5 disable_3d_hash_check has no effect
  it('disable_3d_hash_check does not disable the check', async () => {
    const { sent, result } = run(
      { ...paySuccess(), responseMessage: 'X' },
      payE2EOrder,
      null,
      configWithHashCheckDisabled,
    )
    expect(await result).toBeInstanceOf(HashMismatchError)
    expect(sent).toHaveLength(0)
  })
})

describe('AkbankPos (end to end) 3D Host', () => {
  // addition: A8 an approved 3D Host callback is confirmed with the order history
  it('confirms an approved callback with the bank order history', async () => {
    const { sent, fetchImpl } = bankFetch(() => historyAnswer('2024041898FD'))
    const res = (await realGateway(fetchImpl).payment(
      MODEL.THREE_D_HOST,
      { id: '2024041898FD', amount: 1.01, currency: CURRENCY.TRY, installment: 0 },
      TX_TYPE.PAY_AUTH,
      null,
      hostSuccess(),
    )) as Data

    expect(res.status).toBe('approved')
    expect(res.payment_model).toBe('3d_host')
    expect(sent).toHaveLength(1)
    expect((sent[0] as Sent).json.order).toStrictEqual({ orderId: '2024041898FD' })
  })

  it('a history for another amount is not approved', async () => {
    const { fetchImpl } = bankFetch(() => historyAnswer('2024041898FD', { amount: 2.02 }))
    const err = await realGateway(fetchImpl)
      .payment(
        MODEL.THREE_D_HOST,
        { id: '2024041898FD', amount: 1.01, currency: CURRENCY.TRY },
        TX_TYPE.PAY_AUTH,
        null,
        hostSuccess(),
      )
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OrderMismatchError)
    expect((err as OrderMismatchError).field).toBe('amount')
  })
})

describe('AkbankPos (end to end) API requests', () => {
  // addition: bank error pages
  it.each([
    ['HTTP 500', () => new Response('{"message":"Error message","code":222}', { status: 500 }), 500],
    ['an HTML page with HTTP 200', () => new Response('<html><body>Request Rejected</body></html>'), 200],
  ] as Array<[string, () => Response, number]>)('cancel with %s raises PosHttpError', async (_label, reply, status) => {
    const { sent, fetchImpl } = bankFetch(reply)
    const err = (await realGateway(fetchImpl)
      .cancel({ id: 'A' })
      .catch((e: unknown) => e)) as PosHttpError
    expect(err).toBeInstanceOf(PosHttpError)
    expect(err.status).toBe(status)
    expect(sent).toHaveLength(1)
  })

  // addition: one gateway serves concurrent requests, each signed with its own nonce
  it('concurrent cancels keep their own nonce, signature and response', async () => {
    const { sent, fetchImpl } = bankFetch((json) => ({
      txnCode: '1003',
      responseCode: 'VPS-0000',
      order: { orderId: json.order.orderId },
    }))
    const p = realGateway(fetchImpl)

    const [a, b] = await Promise.all([p.cancel({ id: 'A' }), p.cancel({ id: 'B' })])

    expect(a.order_id).toBe('A')
    expect(b.order_id).toBe('B')
    expect(a.status).toBe('approved')
    expect(sent).toHaveLength(2)
    expect((sent[0] as Sent).json.randomNumber).not.toBe((sent[1] as Sent).json.randomNumber)
    expect((sent[0] as Sent).authHash).not.toBe((sent[1] as Sent).authHash)
  })

  // addition: A1 the signature covers the body as changed by an onRequestDataPrepared hook
  it('signs the body changed by an onRequestDataPrepared hook', async () => {
    const { sent, fetchImpl } = bankFetch(() => ({
      txnCode: '1003',
      responseCode: 'VPS-0000',
      order: { orderId: 'A' },
    }))
    const hooks: PosHooks = {
      onRequestDataPrepared: [
        (event) => {
          event.requestData.note = 'Çağrı Öztürk'
        },
      ],
    }
    await realGateway(fetchImpl, { hooks }).cancel({ id: 'A' })

    expect(sent).toHaveLength(1)
    expect((sent[0] as Sent).json.note).toBe('Çağrı Öztürk')
  })

  // addition: A21 status is not supported
  it('status rejects UnsupportedTransactionTypeError without a request', async () => {
    const { sent, fetchImpl } = bankFetch()
    await expect(realGateway(fetchImpl).status({ id: 'A' })).rejects.toThrow(UnsupportedTransactionTypeError)
    expect(sent).toHaveLength(0)
  })

  // addition: A14 nothing secret reaches the logger
  it('never logs the secret key, a request signature, the card number or the CVV', async () => {
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
    const { sent, fetchImpl } = bankFetch(() => provisionApproved)
    const p = realGateway(fetchImpl, { logger })

    await p.payment(MODEL.THREE_D_SECURE, secureE2EOrder, TX_TYPE.PAY_AUTH, null, secureSuccess())
    await p
      .payment(MODEL.THREE_D_SECURE, { ...secureE2EOrder, id: 'X' }, TX_TYPE.PAY_AUTH, null, secureSuccess())
      .catch(() => undefined)
    await p
      .payment(MODEL.THREE_D_SECURE, secureE2EOrder, TX_TYPE.PAY_AUTH, null, {
        ...secureSuccess(),
        responseMessage: 'X',
      })
      .catch(() => undefined)
    const c = CreditCardFactory.createForGateway(p, '5555444433332222', '21', '12', '122', 'ahmet', CARD_TYPE.VISA)
    await p.payment(
      MODEL.NON_SECURE,
      { id: 'N1', amount: 1.01, currency: CURRENCY.TRY, ip: '127.0.0.1', installment: 0 },
      TX_TYPE.PAY_AUTH,
      c,
    )

    const logged = JSON.stringify(records)
    expect(records.length).toBeGreaterThan(0)
    expect(sent).toHaveLength(2)
    expect(logged).not.toContain(SECRET_KEY)
    for (const request of sent) {
      expect(logged).not.toContain(request.authHash)
    }
    expect(logged).not.toContain('5555444433332222')
    expect(logged).not.toMatch(/cvv2?\\?"\s*:\s*\\?"?122/i)
  })
})
