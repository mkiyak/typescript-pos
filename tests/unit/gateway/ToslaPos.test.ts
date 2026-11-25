import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import type { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { ToslaPosCrypt } from '../../../src/crypt/ToslaPosCrypt.js'
import type { RequestDataMapperInterface } from '../../../src/data-mapper/request/mapper/RequestDataMapperInterface.js'
import { ToslaPosRequestDataMapper } from '../../../src/data-mapper/request/mapper/ToslaPosRequestDataMapper.js'
import { ToslaPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/ToslaPosRequestValueFormatter.js'
import { ToslaPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/ToslaPosRequestValueMapper.js'
import type { ResponseDataMapperInterface } from '../../../src/data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { ToslaPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/ToslaPosResponseDataMapper.js'
import { ToslaPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/ToslaPosResponseValueFormatter.js'
import { ToslaPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/ToslaPosResponseValueMapper.js'
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
import { ToslaPos } from '../../../src/gateway/ToslaPos.js'
import type { PosLogger } from '../../../src/logger.js'
import type { ToslaPosAccount } from '../../../src/model/account/ToslaPosAccount.js'
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
  cancelCases,
  orderHistoryCases,
  paymentCases,
  refundCases,
  statusCases,
  threeDHostCases,
  threeDPayCases,
} from '../data-mapper/response/mapper/ToslaPosResponseDataMapper.data.js'

// The first section replaces the collaborators with vi.fn() fakes (except the request value mapper); the end-to-end
// sections use the real crypt, mappers and HTTP client over a fake fetch that answers like the bank (by path), checks
// the hash of every request and records every request.

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

const CLIENT_ID = '1000000494'
const API_USER = 'POS_ENT_Test_001'
const API_PASS = 'POS_ENT_Test_001!*!*'
const TA = AccountFactory.createToslaPosAccount('tosla', CLIENT_ID, API_USER, API_PASS)

/** base64 SHA-512 of the UTF-8 bytes. */
const S5 = (s: string): string => createHash('sha512').update(s, 'utf8').digest('base64')
/** The request hash. */
const RQ = (rnd: string, timeSpan: string): string => S5(`${API_PASS}${CLIENT_ID}${API_USER}${rnd}${timeSpan}`)
/** The callback hash. */
const CB = (o: string, md: string, code: string, msg: string, req: string): string =>
  S5(`${API_PASS}${CLIENT_ID}${API_USER}${o}${md}${code}${msg}${req}`)
/** The only accepted callback field list. */
const HP = 'ClientId,ApiUser,OrderId,MdStatus,BankResponseCode,BankResponseMessage,RequestStatus'

const SESSION_ID = 'P40D18956D9C94188ABF6C87B37075AF7B1029577C4BF4BADB8E86058919000F4'

/** A callback signed over its five signed values (unless `over` names `Hash`; `undefined` leaves a key out). */
const signedCallback = (o: string, md: string, code: string, msg: string, req: string, over: Data = {}): Data => {
  const fields: Data = {
    ClientId: CLIENT_ID,
    OrderId: o,
    MdStatus: md,
    ThreeDSessionId: SESSION_ID,
    BankResponseCode: code,
    BankResponseMessage: msg,
    RequestStatus: req,
    HashParameters: HP,
    Hash: CB(o, md, code, msg, req),
    ...over,
  }
  for (const key of Object.keys(fields)) if (fields[key] === undefined) delete fields[key]
  return fields
}

const CV1_ORDER_ID = '202312034E91'
const CV2_ORDER_ID = '20231203626F'
/** Genuine 3D Pay approval (CV1). */
const cv1 = (over: Data = {}): Data => signedCallback(CV1_ORDER_ID, '1', '00', '', '1', over)
/** Genuine 3D Host approval (CV2). */
const cv2 = (over: Data = {}): Data => signedCallback(CV2_ORDER_ID, '1', '00', '', '1', over)
/** Genuine decline (CV3). */
const cv3 = (over: Data = {}): Data => signedCallback('20231203E148', '0', 'MD:0', '', '0', over)
/** A signed bank approval whose 3D authentication was only half successful (HV1). */
const hv1 = (over: Data = {}): Data => signedCallback(CV2_ORDER_ID, '2', '00', '', '1', over)

const hostedOrder = (id: string = CV1_ORDER_ID, over: PosOrder = {}): PosOrder => ({
  id,
  amount: 1.01,
  currency: CURRENCY.TRY,
  installment: 0,
  ...over,
})

const createLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })

const cb = (data: Data): GatewayResponseData => data as GatewayResponseData

const fixture = (cases: Record<string, { responseData: Data }>, name: string): Data => {
  const found = cases[name]
  if (found === undefined) throw new Error(`no fixture ${name}`)
  return structuredClone(found.responseData)
}

/** The bank's status record of an approved sale for `orderId` (the `success_pay` fixture). */
const statusRecord = (orderId: string, over: Data = {}): Data => ({
  ...fixture(statusCases, 'success_pay'),
  OrderId: orderId,
  ...over,
})

describe('ToslaPos planning vectors', () => {
  // addition: RV2, CV1-CV3, RP1 and HV1 recomputed with node:crypto
  it.each([
    [
      'RV2',
      RQ('rand-212s', '20231209215355'),
      'jcgZOAf/m/E1uwYXmOPrdgqXRuEmVuG3Q14yri0okhULvRDbAicyAU8hflUP634yRRSZkOnIOeLZNqXfLhzz7g==',
    ],
    ['CV1', cv1().Hash, 'CgibjWkLpfx+Cz6cVlbH1ViSW74ouKACVOW0Vrt2SfqPMt+V3hfIx/4LnOgcInFhPci/qcnIMgdN0RptHSmFOg=='],
    ['CV2', cv2().Hash, 'A+bjgxp/uIQjpsY+cEpUJcu+m6xXMgpDz7DOjtQ8TgKgJaFFsLGKkpNKOYzInqfkJ6U9+S8mxGFBv4o4WqC4hg=='],
    ['CV3', cv3().Hash, 'C7Vbcr3adDhlWEr9vT9oFHikjrjEiv5DSBORu0YnOATkF/YirOziwouAGk8vqB29oeyPBnlFgBih7bLN9YWweQ=='],
    [
      'RP1 genuine',
      CB('A1001', '1', '00', '', '1'),
      '4vdPQvhJ8eyjpdLPFOsSIwphXYI3Lr96iLjU0KKrTEd8bYUJDoaqenW7VEjqxhyMZOhSJQo7pq7CqkZY8g67lw==',
    ],
    [
      'RP1 re-read',
      CB('A', '1', '00', '1100', '1'),
      '4vdPQvhJ8eyjpdLPFOsSIwphXYI3Lr96iLjU0KKrTEd8bYUJDoaqenW7VEjqxhyMZOhSJQo7pq7CqkZY8g67lw==',
    ],
    ['HV1', hv1().Hash, 'IhkLeIo7ZAdYIG+6XqnppnExSdaQg4hekLlwSG4P47t50mEa//dHf06WWu2yApnG4f+tVrhQSFCK6FEaj3qAUg=='],
  ])('%s', (_name, actual, expected) => {
    expect(actual).toBe(expected)
  })

  // addition: the fixtures carry the planning vectors
  it('the 3D fixtures are signed with the planning vectors', () => {
    expect(fixture(threeDPayCases, 'success1').Hash).toBe(cv1().Hash)
    expect(fixture(threeDHostCases, 'success1').Hash).toBe(cv2().Hash)
    expect(fixture(threeDPayCases, 'auth_fail').Hash).toBe(cv3().Hash)
  })
})

describe('ToslaPos (mocked collaborators)', () => {
  // deviation: T22 the ported config needs payment_api for the HTTP client
  const config: GatewayConfig = {
    name: 'Tosla',
    class: 'ToslaPos',
    gateway_endpoints: {
      payment_api: 'https://ent.akodepos.com/api/Payment',
      gateway_3d: 'https://ent.akodepos.com/api/Payment/ProcessCardForm',
      gateway_3d_host: 'https://ent.akodepos.com/api/Payment/threeDSecure',
    },
  }

  /** `disable_3d_hash_check` is not an option; passing it must have no effect. */
  const configWithHashCheckDisabled = {
    ...config,
    gateway_configs: { disable_3d_hash_check: true },
  } as unknown as GatewayConfig

  let requestValueMapper: ToslaPosRequestValueMapper
  let requestMapper: Mocked<RequestDataMapperInterface>
  let responseMapper: Mocked<ResponseDataMapperInterface>
  let crypt: Mocked<CryptInterface>
  let httpClient: { supportsTx: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }
  let clientStrategy: { getClient: ReturnType<typeof vi.fn>; getAllClients: ReturnType<typeof vi.fn> }
  let requestDataPrepared: ReturnType<typeof vi.fn<(e: RequestDataPreparedEvent) => void>>
  let logger: ReturnType<typeof createLogger>
  let pos: ToslaPos

  const createGateway = (cfg: GatewayConfig): ToslaPos => {
    const hooks: PosHooks = { onRequestDataPrepared: [requestDataPrepared] }
    const deps: GatewayDeps<ToslaPosAccount> = {
      requestValueMapper,
      requestValueFormatter: new ToslaPosRequestValueFormatter(),
      requestDataMapper: requestMapper as unknown as RequestDataMapperInterface<ToslaPosAccount>,
      responseDataMapper: responseMapper as unknown as ResponseDataMapperInterface,
      crypt: crypt as unknown as CryptInterface<ToslaPosAccount>,
      clientStrategy: clientStrategy as unknown as HttpClientStrategy,
      logger,
      hooks,
    }
    return new ToslaPos(cfg, TA, deps)
  }

  beforeEach(() => {
    requestValueMapper = new ToslaPosRequestValueMapper()
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
      expect(event.gatewayClass).toBe('ToslaPos')
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

  const expectNoRequest = () => {
    expect(httpClient.request).not.toHaveBeenCalled()
    expect(requestDataPrepared).not.toHaveBeenCalled()
    expect(requestMapper.createStatusRequestData).not.toHaveBeenCalled()
  }

  it('init', () => {
    expect(pos.getAccount()).toBe(TA)
    expect(pos.isTestMode()).toBe(false)
    expect(pos.getCrypt()).toBe(crypt)
  })

  // addition: identifiers and the supported transactions table
  it('exposes NAME, the gateway class identifier and the supported transactions', () => {
    expect(ToslaPos.NAME).toBe('ToslaPos')
    expect(ToslaPos.GATEWAY_CLASS).toBe('ToslaPos')
    for (const model of [MODEL.THREE_D_PAY, MODEL.THREE_D_HOST, MODEL.NON_SECURE]) {
      expect(ToslaPos.isSupportedTransaction(TX_TYPE.PAY_AUTH, model)).toBe(true)
    }
    expect(ToslaPos.isSupportedTransaction(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE)).toBe(false)
    expect(ToslaPos.isSupportedTransaction(TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_PAY)).toBe(true)
    expect(ToslaPos.isSupportedTransaction(TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_HOST)).toBe(true)
    expect(ToslaPos.isSupportedTransaction(TX_TYPE.PAY_PRE_AUTH, MODEL.NON_SECURE)).toBe(false)
    for (const tx of [
      TX_TYPE.PAY_POST_AUTH,
      TX_TYPE.STATUS,
      TX_TYPE.CANCEL,
      TX_TYPE.REFUND,
      TX_TYPE.REFUND_PARTIAL,
      TX_TYPE.ORDER_HISTORY,
    ]) {
      expect(ToslaPos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(true)
    }
  })

  it('get3DGatewayURL', () => {
    expect(pos.get3DGatewayURL()).toBe('https://ent.akodepos.com/api/Payment/ProcessCardForm')
  })

  // ---- 3D Pay / 3D Host ----

  const authFailCallback = () => fixture(threeDPayCases, 'auth_fail')
  const successCallback = () => fixture(threeDPayCases, 'success1')

  type HostedRow = [name: string, callback: Data, expected: Data]

  // deviation: T3 the full signed field set is needed: the ported request rows completed to the fixture fields
  const hostedRows = (): HostedRow[] => [
    [
      'auth_fail',
      authFailCallback(),
      {
        tx_status: 'ERROR',
        md_error_message: null,
        order_id: '20231203E148',
        proc_return_code: 'MD:0',
        status: 'declined',
      },
    ],
    [
      'success',
      successCallback(),
      {
        md_status: '1',
        tx_status: 'PAYMENT_COMPLETED',
        md_error_message: null,
        order_id: '202312034E91',
        proc_return_code: '00',
        status: 'approved',
      },
    ],
  ]

  /** The inquiry round trip that confirms an approved 3D Pay / 3D Host result. */
  const configureConfirmation = (orderId: string, record: Data): (() => void) => {
    const statusOrder = { id: orderId }
    const requestData = { clientId: CLIENT_ID, orderId }
    requestMapper.createStatusRequestData.mockReturnValue(requestData)
    responseMapper.mapStatusResponse.mockReturnValue({ status: 'approved', order_id: orderId })
    const verifyClient = configureClientResponse(TX_TYPE.STATUS, requestData, record, statusOrder, MODEL.NON_SECURE)

    return () => {
      verifyClient()
      expect(requestMapper.createStatusRequestData).toHaveBeenCalledTimes(1)
      expect(requestMapper.createStatusRequestData).toHaveBeenCalledWith(TA, statusOrder)
      expect(responseMapper.mapStatusResponse).toHaveBeenCalledTimes(1)
      expect(responseMapper.mapStatusResponse).toHaveBeenCalledWith(record)
    }
  }

  describe.each([
    ['3D Pay', MODEL.THREE_D_PAY, 'map3DPayResponseData'],
    ['3D Host', MODEL.THREE_D_HOST, 'map3DHostResponseData'],
  ] as Array<[string, PaymentModel, 'map3DPayResponseData' | 'map3DHostResponseData']>)(
    '%s',
    (_label, paymentModel, mapperMethod) => {
      const run = async (p: ToslaPos, callback: Data, expected: Data) => {
        // deviation: T7/T8 the order carries the callback's order id, amount, currency and installment
        const order = hostedOrder(callback.OrderId)
        crypt.check3DHash.mockReturnValue(true)
        responseMapper[mapperMethod].mockReturnValue(expected)
        const verifyConfirmation =
          expected.status === 'approved' ? configureConfirmation(order.id as string, statusRecord(CV1_ORDER_ID)) : null

        const result = await p.payment(paymentModel, order, TX_TYPE.PAY_AUTH, null, cb(callback))

        // deviation: T5 every present hash is verified, the declined row included
        expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
        expect(crypt.check3DHash).toHaveBeenCalledWith(TA, callback)
        expect(responseMapper.extractMdStatus).not.toHaveBeenCalled()
        expect(responseMapper.is3dAuthSuccess).not.toHaveBeenCalled()
        expect(responseMapper[mapperMethod]).toHaveBeenCalledTimes(1)
        expect(responseMapper[mapperMethod]).toHaveBeenCalledWith(callback, TX_TYPE.PAY_AUTH, order)
        if (verifyConfirmation) {
          verifyConfirmation()
          // deviation: T8 the approval is confirmed by the bank record, whose references the result carries
          expect(result).toStrictEqual({
            ...expected,
            auth_code: null,
            ref_ret_num: null,
            transaction_id: null,
            installment_count: 0,
          })
        } else {
          expectNoRequest()
          expect(result).toStrictEqual(expected)
        }
      }

      it.each(hostedRows())('payment %s', async (_name, callback, expected) => {
        await run(pos, callback, expected)
      })

      // deviation: T5 the hash check cannot be disabled: disable_3d_hash_check is ignored, the hash is checked once
      it('payment without hash check success', async () => {
        const [, callback, expected] = hostedRows()[1] as HostedRow
        await run(createGateway(configWithHashCheckDisabled), callback, expected)
      })

      it('payment hash mismatch', async () => {
        const callback = {
          ClientId: CLIENT_ID,
          OrderId: CV1_ORDER_ID,
          MdStatus: '1',
          HashParameters: HP,
          Hash: cv1().Hash,
        }
        crypt.check3DHash.mockReturnValue(false)

        // deviation: T7 the order is validated before the callback, so it is a real order here
        await expect(
          pos.payment(paymentModel, hostedOrder(), TX_TYPE.PAY_AUTH, null, cb(callback)),
        ).rejects.toStrictEqual(new HashMismatchError('3D callback hash mismatch'))
        expect(crypt.check3DHash).toHaveBeenCalledWith(TA, callback)
        expect(responseMapper[mapperMethod]).not.toHaveBeenCalled()
        expectNoRequest()
      })

      // addition: T11 fail closed when the mapper approves a signed callback that carries no approval
      it('a signed decline mapped as approved is rejected (PosError) without confirmation', async () => {
        crypt.check3DHash.mockReturnValue(true)
        responseMapper[mapperMethod].mockReturnValue({ status: 'approved', order_id: '20231203E148' })

        const err = await pos
          .payment(paymentModel, hostedOrder('20231203E148'), TX_TYPE.PAY_AUTH, null, cb(authFailCallback()))
          .catch((e: unknown) => e)
        expect(err).toStrictEqual(new PosError('3D callback without approval was mapped as approved'))
        expectNoRequest()
      })

      // addition: T6 padded approval texts never reach the mapper
      it.each([
        [' 00', { BankResponseCode: ' 00' }],
        ['00 ', { BankResponseCode: '00 ' }],
        ['RequestStatus 1 padded', { RequestStatus: ' 1' }],
        ['MdStatus 1 padded', { MdStatus: '1 ' }],
      ])('a padded approval (%s) is malformed and never mapped', async (_name, over) => {
        crypt.check3DHash.mockReturnValue(true)

        await expect(
          pos.payment(paymentModel, hostedOrder(), TX_TYPE.PAY_AUTH, null, cb({ ...successCallback(), ...over })),
        ).rejects.toStrictEqual(new HashMismatchError('3D callback fields are malformed'))
        expect(responseMapper[mapperMethod]).not.toHaveBeenCalled()
        expectNoRequest()
      })

      // addition: T10 fail closed when the mapper approves an unsigned callback without an approval indicator
      it('an unsigned callback mapped as approved is HashMismatchError', async () => {
        responseMapper[mapperMethod].mockReturnValue({ status: 'approved', order_id: CV1_ORDER_ID })
        const callback = { OrderId: CV1_ORDER_ID, MdStatus: '0', BankResponseCode: 'MD:0', RequestStatus: '0' }

        await expect(
          pos.payment(paymentModel, hostedOrder(), TX_TYPE.PAY_AUTH, null, cb(callback)),
        ).rejects.toStrictEqual(new HashMismatchError('3D callback has no Hash'))
        expect(crypt.check3DHash).not.toHaveBeenCalled()
        expectNoRequest()
      })

      // addition: T9 fail closed when the mapper approves a bank approval without full 3D authentication
      it('a half 3D approval mapped as approved is PosError without a request', async () => {
        crypt.check3DHash.mockReturnValue(true)
        responseMapper[mapperMethod].mockReturnValue({ status: 'approved', order_id: CV1_ORDER_ID })

        await expect(
          pos.payment(paymentModel, hostedOrder(), TX_TYPE.PAY_AUTH, null, cb({ ...successCallback(), MdStatus: '2' })),
        ).rejects.toStrictEqual(new PosError('3D callback without full authentication was not mapped as declined'))
        expectNoRequest()
      })

      // addition: T8 the record's own result code and the mapper's reading must both confirm
      it.each([
        ['a record with Code 1 that the mapper reads as approved', { Code: 1 }, 'approved'],
        ["a record with Code '0' that the mapper reads as approved", { Code: '0' }, 'approved'],
        ['a record with Code 0 that the mapper reads as declined', {}, 'declined'],
      ])('%s is OrderMismatchError order_status', async (_name, over, mappedStatus) => {
        crypt.check3DHash.mockReturnValue(true)
        responseMapper[mapperMethod].mockReturnValue({ status: 'approved', order_id: CV1_ORDER_ID })
        configureConfirmation(CV1_ORDER_ID, statusRecord(CV1_ORDER_ID, over))
        responseMapper.mapStatusResponse.mockReturnValue({ status: mappedStatus })

        const err = await pos
          .payment(paymentModel, hostedOrder(), TX_TYPE.PAY_AUTH, null, cb(successCallback()))
          .catch((e: unknown) => e)
        expect(err).toBeInstanceOf(OrderMismatchError)
        expect((err as OrderMismatchError).field).toBe('order_status')
        expect((err as OrderMismatchError).paymentMayHaveCompleted).toBe(true)
        expect(httpClient.request).toHaveBeenCalledTimes(1)
      })
    },
  )

  // addition: T15 the gateway checks the session id before the form is built
  it.each([['../x'], ['a b'], [undefined]])(
    'a register answer with session id %j never reaches the form',
    async (sessionId) => {
      const order = { id: 'order' }
      const requestData = { request: 'request-data' }
      requestMapper.create3DFormInitializeRequestData.mockReturnValue(requestData)
      configureClientResponse(
        TX_TYPE.PAY_AUTH,
        requestData,
        { Code: 0, ThreeDSessionId: sessionId },
        order,
        MODEL.THREE_D_HOST,
      )

      await expect(pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true)).rejects.toStrictEqual(
        new PosError('3D session id is missing or malformed'),
      )
      expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
    },
  )

  // deviation: T19 through payment() the supported transactions table rejects the 3D Secure model first
  it.each([
    ['auth_fail', authFailCallback()],
    ['success', successCallback()],
  ])('make3DPayment %s', async (_name, callback) => {
    const order = hostedOrder(callback.OrderId)
    await expect(pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, card(), cb(callback))).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    expect(crypt.check3DHash).not.toHaveBeenCalled()
    expectNoRequest()
  })

  // addition: T24 the model itself is unsupported
  it('make3DPayment called directly is UnsupportedPaymentModelError', async () => {
    await expect(pos.make3DPayment(cb(successCallback()), hostedOrder(), TX_TYPE.PAY_AUTH)).rejects.toThrow(
      UnsupportedPaymentModelError,
    )
    expectNoRequest()
  })

  // ---- 3D form ----

  const formOrder = (): PosOrder => ({
    id: 'order222',
    amount: 100.25,
    installment: 0,
    currency: CURRENCY.TRY,
    success_url: 'https://domain.com/success',
    time_span: new Date('2023-12-09T21:47:08.000Z'),
  })

  const registerAnswer = (): Data => ({
    ThreeDSessionId: 'PA49E341381C94587AB4CB196DAC10DC02E509578520E4471A3EEE2BB4830AE4F',
    TransactionId: '2000000000032439',
    Code: 0,
    Message: 'Başarılı',
  })

  const returnedForm = (): Data => ({
    gateway: 'https://ent.akodepos.com/api/Payment/ProcessCardForm',
    method: 'POST',
    inputs: {
      ThreeDSessionId: 'P6D383818909442128AB50AB1EC7A4B83080874341688447DA74B90150C8857F2',
      CardHolderName: 'ahmet',
      CardNo: '5555444433332222',
      ExpireDate: '01/22',
      Cvv: '123',
    },
  })

  it.each([
    [
      '3d_pay',
      MODEL.THREE_D_PAY,
      true,
      {
        clientId: CLIENT_ID,
        apiUser: API_USER,
        callbackUrl: 'https://domain.com/success',
        hash: '+XGO1qv+6W7nXZwSsYMaRrWXhi+99jffLvExGsFDodYyNadOG7OQKsygzly5ESDoNIS19oD2U+hSkVeT6UTAFA==',
      },
      'https://ent.akodepos.com/api/Payment/ProcessCardForm',
    ],
    [
      '3d_host',
      MODEL.THREE_D_HOST,
      false,
      {
        clientId: CLIENT_ID,
        apiUser: API_USER,
        rnd: 'rand',
        timeSpan: '20231209214708',
        hash: '+XGO1qv+6W7nXZwSsYMaRrWXhi+99jffLvExGsFDodYyNadOG7OQKsygzly5ESDoNIS19oD2U+hSkVeT6UTAFA==',
      },
      'https://ent.akodepos.com/api/Payment/threeDSecure',
    ],
  ] as Array<[string, PaymentModel, boolean, Data, string]>)(
    'get3DFormData %s',
    async (_name, paymentModel, isWithCard, requestData, gatewayUrl) => {
      const order = formOrder()
      const c = isWithCard ? card() : null
      const answer = registerAnswer()
      const formData = returnedForm()
      requestMapper.create3DFormInitializeRequestData.mockReturnValue(requestData)
      requestMapper.create3DFormData.mockResolvedValue(formData)
      const verify = configureClientResponse(TX_TYPE.PAY_AUTH, requestData, answer, order, paymentModel)

      const actual = await pos.get3DFormData(order, paymentModel, TX_TYPE.PAY_AUTH, c, !isWithCard)

      verify()
      expect(requestMapper.create3DFormInitializeRequestData).toHaveBeenCalledTimes(1)
      expect(requestMapper.create3DFormInitializeRequestData).toHaveBeenCalledWith(
        TA,
        order,
        paymentModel,
        TX_TYPE.PAY_AUTH,
      )
      expect(requestMapper.create3DFormData).toHaveBeenCalledTimes(1)
      expect(requestMapper.create3DFormData).toHaveBeenCalledWith(
        TA,
        answer,
        paymentModel,
        TX_TYPE.PAY_AUTH,
        gatewayUrl,
        c,
      )
      expect(actual).toStrictEqual(formData)
    },
  )

  // deviation: T19 English messages and error classes of the shared 3D form input check
  it.each([
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
      MODEL.THREE_D_SECURE,
      TX_TYPE.PAY_AUTH,
      false,
      false,
      UnsupportedTransactionTypeError,
      'ToslaPos supports [3d_pay, 3d_host, regular] payment model(s) for transaction type [pay]. Provided payment model: [3d].',
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
      expect(requestMapper.create3DFormInitializeRequestData).not.toHaveBeenCalled()
      expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
      expectNoRequest()
    },
  )

  it('get3DFormData register payment fail', async () => {
    const order = { id: 'order' }
    const requestData = { request: 'request-data' }
    requestMapper.create3DFormInitializeRequestData.mockReturnValue(requestData)
    configureClientResponse(
      TX_TYPE.PAY_AUTH,
      requestData,
      { Code: 202, Message: 'Üye İşyeri Kullanıcısı Bulunamadı', ThreeDSessionId: null, TransactionId: null },
      order,
      MODEL.THREE_D_PAY,
    )

    // deviation: T19 PosError carrying the bank message instead of RuntimeException
    const err = await pos.get3DFormData(order, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, card()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect((err as Error).message).toContain('Üye İşyeri Kullanıcısı Bulunamadı')
    expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
  })

  // ---- non-3D transactions ----

  // deviation: T20 no isSuccess(); the mapped result is returned
  it('status', async () => {
    const order = { id: 'id-12' }
    const requestData = { clientId: CLIENT_ID, orderId: 'id-12' }
    const decoded = { BankResponseCode: '00', OrderId: '202401199AAA' }
    requestMapper.createStatusRequestData.mockReturnValue(requestData)
    responseMapper.mapStatusResponse.mockReturnValue({ status: 'approved' })
    const verify = configureClientResponse(TX_TYPE.STATUS, requestData, decoded, order, MODEL.NON_SECURE)

    const result = await pos.status(order)

    verify()
    expect(requestMapper.createStatusRequestData).toHaveBeenCalledWith(TA, order)
    expect(responseMapper.mapStatusResponse).toHaveBeenCalledWith(decoded)
    expect(result).toStrictEqual({ status: 'approved' })
  })

  // deviation: T20 no isSuccess(); the mapped result is returned
  it('cancel', async () => {
    const order = { id: 'id-12' }
    const requestData = { clientId: CLIENT_ID, orderId: 'id-12' }
    const decoded = { BankResponseCode: '00', OrderId: '202312058278' }
    requestMapper.createCancelRequestData.mockReturnValue(requestData)
    responseMapper.mapCancelResponse.mockReturnValue({ status: 'approved' })
    const verify = configureClientResponse(TX_TYPE.CANCEL, requestData, decoded, order, MODEL.NON_SECURE)

    const result = await pos.cancel(order)

    verify()
    expect(requestMapper.createCancelRequestData).toHaveBeenCalledWith(TA, order)
    expect(responseMapper.mapCancelResponse).toHaveBeenCalledWith(decoded)
    expect(result).toStrictEqual({ status: 'approved' })
  })

  // deviation: T20 no isSuccess(); the mapped result is returned
  it('refund', async () => {
    const order = { id: 'id-12', amount: 1.02 }
    const requestData = { clientId: CLIENT_ID, orderId: 'id-12', amount: 102 }
    const decoded = { BankResponseCode: '00', OrderId: '202312051B4E' }
    requestMapper.createRefundRequestData.mockReturnValue(requestData)
    responseMapper.mapRefundResponse.mockReturnValue({ status: 'approved' })
    const verify = configureClientResponse(TX_TYPE.REFUND, requestData, decoded, order, MODEL.NON_SECURE)

    const result = await pos.refund(order)

    verify()
    expect(requestMapper.createRefundRequestData).toHaveBeenCalledWith(TA, order, TX_TYPE.REFUND)
    expect(responseMapper.mapRefundResponse).toHaveBeenCalledWith(decoded)
    expect(result).toStrictEqual({ status: 'approved' })
  })

  // deviation: T20 no isSuccess(); the mapped result is returned
  it('order history', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { clientId: CLIENT_ID, orderId: '2020110828BC' }
    const decoded = { Count: 1, Code: 0, Transactions: [{ OrderId: '20231209C3AE' }] }
    requestMapper.createOrderHistoryRequestData.mockReturnValue(requestData)
    responseMapper.mapOrderHistoryResponse.mockReturnValue({ status: 'approved' })
    const verify = configureClientResponse(TX_TYPE.ORDER_HISTORY, requestData, decoded, order, MODEL.NON_SECURE)

    const result = await pos.orderHistory(order)

    verify()
    expect(requestMapper.createOrderHistoryRequestData).toHaveBeenCalledWith(TA, order)
    expect(responseMapper.mapOrderHistoryResponse).toHaveBeenCalledWith(decoded)
    expect(result).toStrictEqual({ status: 'approved' })
  })

  // deviation: T16 an answer without a result code is an unknown outcome, so the decoded answer carries one
  const paymentAnswer = (): Data => ({ Code: 0, BankResponseCode: '00', OrderId: '2020110828BC' })

  it('regular payment', async () => {
    const order = { id: '2020110828BC' }
    const c = card()
    const requestData = { request: 'createNonSecurePaymentRequestData' }
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue(requestData)
    responseMapper.mapPaymentResponse.mockReturnValue({ result: true })
    const verify = configureClientResponse(TX_TYPE.PAY_AUTH, requestData, paymentAnswer(), order, MODEL.NON_SECURE)

    const result = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, c)

    verify()
    expect(requestMapper.createNonSecurePaymentRequestData).toHaveBeenCalledWith(TA, order, TX_TYPE.PAY_AUTH, c)
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith(paymentAnswer(), TX_TYPE.PAY_AUTH, order)
    expect(result).toStrictEqual({ result: true })
  })

  it('regular post-auth payment', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { request: 'createNonSecurePostAuthPaymentRequestData' }
    requestMapper.createNonSecurePostAuthPaymentRequestData.mockReturnValue(requestData)
    responseMapper.mapPaymentResponse.mockReturnValue({ result: true })
    const verify = configureClientResponse(TX_TYPE.PAY_POST_AUTH, requestData, paymentAnswer(), order, MODEL.NON_SECURE)

    const result = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_POST_AUTH)

    verify()
    expect(requestMapper.createNonSecurePostAuthPaymentRequestData).toHaveBeenCalledWith(TA, order)
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith(paymentAnswer(), TX_TYPE.PAY_POST_AUTH, order)
    expect(result).toStrictEqual({ result: true })
  })

  it('status request', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { request: 'createStatusRequestData' }
    requestMapper.createStatusRequestData.mockReturnValue(requestData)
    responseMapper.mapStatusResponse.mockReturnValue({ result: true })
    const verify = configureClientResponse(TX_TYPE.STATUS, requestData, { decodedData: 1 }, order, MODEL.NON_SECURE)

    await pos.status(order)

    verify()
    expect(requestMapper.createStatusRequestData).toHaveBeenCalledWith(TA, order)
    expect(responseMapper.mapStatusResponse).toHaveBeenCalledWith({ decodedData: 1 })
  })

  it('cancel request', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { request: 'createCancelRequestData' }
    requestMapper.createCancelRequestData.mockReturnValue(requestData)
    responseMapper.mapCancelResponse.mockReturnValue({ result: true })
    const verify = configureClientResponse(TX_TYPE.CANCEL, requestData, { decodedData: 1 }, order, MODEL.NON_SECURE)

    await pos.cancel(order)

    verify()
    expect(requestMapper.createCancelRequestData).toHaveBeenCalledWith(TA, order)
    expect(responseMapper.mapCancelResponse).toHaveBeenCalledWith({ decodedData: 1 })
  })

  it('refund request', async () => {
    const order = { id: '2020110828BC' }
    const requestData = { request: 'createRefundRequestData' }
    requestMapper.createRefundRequestData.mockReturnValue(requestData)
    responseMapper.mapRefundResponse.mockReturnValue({ result: true })
    const verify = configureClientResponse(TX_TYPE.REFUND, requestData, { decodedData: 1 }, order, MODEL.NON_SECURE)

    await pos.refund(order)

    verify()
    expect(requestMapper.createRefundRequestData).toHaveBeenCalledWith(TA, order, TX_TYPE.REFUND)
    expect(responseMapper.mapRefundResponse).toHaveBeenCalledWith({ decodedData: 1 })
  })
})

// ---------- end to end: real crypt, mappers and HTTP client over a fake fetch ----------

const PAYMENT_API = 'https://prepentegrasyon.tosla.com/api/Payment'
const E2E_CONFIG: GatewayConfig = {
  name: 'Tosla',
  class: 'ToslaPos',
  gateway_endpoints: {
    payment_api: PAYMENT_API,
    gateway_3d: `${PAYMENT_API}/ProcessCardForm`,
    gateway_3d_host: `${PAYMENT_API}/threeDSecure`,
  },
}

type Sent = { url: string; path: string; json: Data }
type Answer = Data | Response

type BankOptions = {
  /** The session registration answer (threeDPayment / threeDPreAuth). */
  register?: (json: Data) => Answer
  /** The inquiry answer. */
  inquiry?: (json: Data) => Answer
  /** The answer to a sale or post-authorization. */
  sale?: (path: string, json: Data) => Answer
}

/** Requests whose `hash` was not the request hash of the body's own client id, user, random value and time span. */
const unsignedRequests: Sent[] = []

afterEach(() => {
  expect(unsignedRequests).toStrictEqual([])
  unsignedRequests.length = 0
})

/** The confirming status record of the end-to-end happy path. */
const confirmingRecord = (orderId: string, over: Data = {}): Data =>
  statusRecord(orderId, { AuthCode: 'A1', HostReferenceNumber: 'R1', TransactionId: 2000000000032562, ...over })

/**
 * A fetch that answers like the bank by path, checks every request hash against the body it received and records
 * the requests (the body parsed as JSON).
 */
function bankFetch(options: BankOptions = {}) {
  const sent: Sent[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const body = await new Request('https://example.invalid', { method: 'POST', body: init?.body ?? '' }).text()
    const u = String(url)
    const json = JSON.parse(body) as Data
    const entry: Sent = { url: u, path: u.slice(PAYMENT_API.length + 1), json }
    sent.push(entry)
    if (
      json.clientId !== CLIENT_ID ||
      json.apiUser !== API_USER ||
      typeof json.rnd !== 'string' ||
      typeof json.timeSpan !== 'string' ||
      json.hash !== RQ(json.rnd, json.timeSpan)
    ) {
      unsignedRequests.push(entry)
    }
    let reply: Answer | undefined
    switch (entry.path) {
      case 'threeDPayment':
      case 'threeDPreAuth':
        reply = options.register?.(json) ?? {
          ThreeDSessionId: 'PA49E341381C94587AB4CB196DAC10DC02E509578520E4471A3EEE2BB4830AE4F',
          TransactionId: '2000000000032439',
          Code: 0,
          Message: 'Başarılı',
        }
        break
      case 'inquiry':
        reply = options.inquiry?.(json) ?? confirmingRecord(String(json.orderId))
        break
      case 'Payment':
      case 'postAuth':
        reply = options.sale?.(entry.path, json) ?? {
          ...fixture(paymentCases, 'success1'),
          OrderId: json.orderId,
        }
        break
      case 'void':
        reply = fixture(cancelCases, 'success1')
        break
      case 'refund':
        reply = fixture(refundCases, 'success1')
        break
      case 'history':
        reply = fixture(orderHistoryCases, 'success_only_payment_transaction')
        break
    }
    if (reply === undefined) throw new Error(`unexpected request ${u}`)
    return reply instanceof Response ? reply : new Response(JSON.stringify(reply), { status: 200 })
  }) as unknown as typeof fetch

  return { sent, fetchImpl }
}

function realGateway(
  fetchImpl: typeof fetch,
  options: { cfg?: GatewayConfig; account?: ToslaPosAccount; logger?: PosLogger; hooks?: PosHooks } = {},
) {
  const log = options.logger ?? createLogger()
  const cfg = options.cfg ?? E2E_CONFIG
  const cryptImpl = new ToslaPosCrypt(log)
  const valueMapper = new ToslaPosRequestValueMapper()
  const valueFormatter = new ToslaPosRequestValueFormatter()
  const hooks = options.hooks ?? {}
  const deps: GatewayDeps<ToslaPosAccount> = {
    requestValueMapper: valueMapper,
    requestValueFormatter: valueFormatter,
    requestDataMapper: new ToslaPosRequestDataMapper(valueMapper, valueFormatter, hooks, cryptImpl),
    responseDataMapper: new ToslaPosResponseDataMapper(
      new ToslaPosResponseValueFormatter(),
      new ToslaPosResponseValueMapper(),
      log,
    ),
    crypt: cryptImpl,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(
      ToslaPos.GATEWAY_CLASS,
      cfg,
      new HttpTransport({ fetch: fetchImpl }),
      log,
    ),
    logger: log,
    hooks,
  }

  return { pos: new ToslaPos(cfg, options.account ?? TA, deps), crypt: cryptImpl }
}

const mismatch = async (promise: Promise<unknown>): Promise<OrderMismatchError> => {
  const err = await promise.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(OrderMismatchError)
  return err as OrderMismatchError
}

const MALFORMED = new HashMismatchError('3D callback fields are malformed')
const NO_HASH = new HashMismatchError('3D callback has no Hash')
const HASH_MISMATCH = new HashMismatchError('3D callback hash mismatch')

const HOSTED = [
  ['3D Pay', MODEL.THREE_D_PAY],
  ['3D Host', MODEL.THREE_D_HOST],
] as Array<[string, PaymentModel]>

/** Runs one hosted completion over a fresh fake bank. */
const complete = (
  callback: Data,
  order: PosOrder = hostedOrder(),
  options: BankOptions = {},
  paymentModel: PaymentModel = MODEL.THREE_D_PAY,
  txType: TxType = TX_TYPE.PAY_AUTH,
  cfg: GatewayConfig = E2E_CONFIG,
) => {
  const { sent, fetchImpl } = bankFetch(options)
  const { pos, crypt } = realGateway(fetchImpl, { cfg })
  const check = vi.spyOn(crypt, 'check3DHash')
  const promise = pos.payment(paymentModel, order, txType, null, cb(callback))
  return { sent, promise, check }
}

describe('ToslaPos (end to end) bank-confirmed hosted payments', () => {
  // addition: T8 a CV1 approval is confirmed with exactly one inquiry bound to the order
  it.each(HOSTED)(
    '%s: a genuine approval is confirmed with one inquiry and takes the record references',
    async (_label, paymentModel) => {
      const callback = paymentModel === MODEL.THREE_D_PAY ? cv1() : cv2()
      const orderId = callback.OrderId as string
      const { sent, promise } = complete(callback, hostedOrder(orderId), {}, paymentModel)
      const res = (await promise) as Data

      expect(sent).toHaveLength(1)
      expect(sent[0]?.url).toBe(`${PAYMENT_API}/inquiry`)
      expect(Object.keys(sent[0]?.json ?? {})).toStrictEqual([
        'clientId',
        'apiUser',
        'orderId',
        'rnd',
        'timeSpan',
        'hash',
      ])
      expect(sent[0]?.json.orderId).toBe(orderId)
      expect(sent[0]?.json.rnd).toMatch(/^[0-9A-F]{24}$/)
      expect(sent[0]?.json.timeSpan).toMatch(/^\d{14}$/)
      expect(sent[0]?.json.hash).toBe(RQ(sent[0]?.json.rnd, sent[0]?.json.timeSpan))
      expect(res.status).toBe('approved')
      expect(res.order_id).toBe(orderId)
      expect(res.auth_code).toBe('A1')
      expect(res.ref_ret_num).toBe('R1')
      expect(res.transaction_id).toBe('2000000000032562')
      expect(res.installment_count).toBe(0)
      expect(res.amount).toBe(1.01)
      expect(res.currency).toBe('TRY')
      expect(res.payment_model).toBe(paymentModel)
    },
  )

  // addition: T8 a pre-authorization is confirmed by a record of transaction type 2
  it.each(HOSTED)('%s: a pre-authorization is confirmed by a pre-authorization record', async (_label, model) => {
    const { sent, promise } = complete(
      cv1(),
      hostedOrder(),
      { inquiry: (j) => confirmingRecord(j.orderId, { TransactionType: 2 }) },
      model,
      TX_TYPE.PAY_PRE_AUTH,
    )
    const res = (await promise) as Data

    expect(sent).toHaveLength(1)
    expect(res.status).toBe('approved')
    expect(res.transaction_type).toBe('pre')
  })

  // addition: T8 (ruling) the record's transaction id is a reference: a positive integer or its text, up to 30 digits
  it.each([
    ['the text 2000000000032562', '2000000000032562', '2000000000032562'],
    ['the number 2000000000032562', 2000000000032562, '2000000000032562'],
    ['30 digits', '1'.repeat(30), '1'.repeat(30)],
    ['0', 0, null],
    ["'0'", '0', null],
    ["'01'", '01', null],
    ['31 digits', '1'.repeat(31), null],
    ['1.5', 1.5, null],
    ["' 12'", ' 12', null],
  ])('a record TransactionId of %s is reported as %j', async (_name, transactionId, expected) => {
    const { promise } = complete(cv1(), hostedOrder(), {
      inquiry: (j) => confirmingRecord(j.orderId, { TransactionId: transactionId }),
    })
    const res = (await promise) as Data
    expect(res.status).toBe('approved')
    expect(res.transaction_id).toBe(expected)
  })

  // addition: T8 the record's kuruş amount may come as text
  it('an Amount written as the text 101 confirms 1.01', async () => {
    const { promise } = complete(cv1(), hostedOrder(), {
      inquiry: (j) => confirmingRecord(j.orderId, { Amount: '101' }),
    })
    expect(((await promise) as Data).status).toBe('approved')
  })

  // addition: T8 every way the record does not confirm the payment, with the result attached for manual review
  it.each([
    ['Amount 1 (kuruş)', { Amount: 1 }, 'amount'],
    ['Amount 101.0000001', { Amount: 101.0000001 }, 'amount'],
    ["Amount '1.01'", { Amount: '1.01' }, 'amount'],
    ['no Amount', { Amount: undefined }, 'amount'],
    ['Currency 840', { Currency: 840 }, 'currency'],
    ['TransactionType 2 for a sale', { TransactionType: 2 }, 'transaction_type'],
    ['RequestStatus 10 (waiting)', { RequestStatus: 10 }, 'order_status'],
    ['RequestStatus 2 (cancelled)', { RequestStatus: 2 }, 'order_status'],
    ['RefundedAmount 59', { RefundedAmount: 59 }, 'order_status'],
    ['PostAuthedAmount 101', { PostAuthedAmount: 101 }, 'order_status'],
    ['no RefundedAmount', { RefundedAmount: undefined }, 'order_status'],
    ['Code 1', { Code: 1 }, 'order_status'],
    ["Code '0'", { Code: '0' }, 'order_status'],
    ["BankResponseCode '05'", { BankResponseCode: '05' }, 'order_status'],
    ["BankResponseCode ' 00'", { BankResponseCode: ' 00' }, 'order_status'],
    ['another OrderId', { OrderId: '202312034E92' }, 'order_id'],
    ['InstallmentCount 3', { InstallmentCount: 3 }, 'installment'],
    ['ClientId 999', { ClientId: 999 }, 'merchant_id'],
  ] as Array<[string, Data, string]>)('a record with %s is OrderMismatchError %s', async (_name, over, field) => {
    const { sent, promise } = complete(cv1(), hostedOrder(), {
      inquiry: (j) => {
        const record = confirmingRecord(j.orderId, over)
        for (const key of Object.keys(record)) if (record[key] === undefined) delete record[key]
        return record
      },
    })
    const err = await mismatch(promise)

    expect(sent).toHaveLength(1)
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
  })

  // addition: T8 the bank's "order not found" record is no confirmation
  it('the fail_order_not_found record is OrderMismatchError order_id', async () => {
    const { sent, promise } = complete(cv1(), hostedOrder(), {
      inquiry: () => fixture(statusCases, 'fail_order_not_found'),
    })
    const err = await mismatch(promise)

    expect(sent).toHaveLength(1)
    expect(err.field).toBe('order_id')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
  })

  // addition: T8 installment one is a single payment, like none
  it('an order with installment 1 is confirmed by a record of installment 0, and 3 by 3', async () => {
    const single = complete(cv1(), hostedOrder(CV1_ORDER_ID, { installment: 1 }))
    expect(((await single.promise) as Data).status).toBe('approved')
    const three = complete(cv1(), hostedOrder(CV1_ORDER_ID, { installment: 3 }), {
      inquiry: (j) => confirmingRecord(j.orderId, { InstallmentCount: 3 }),
    })
    expect(((await three.promise) as Data).status).toBe('approved')
  })

  // addition: T8 transport errors of the inquiry propagate
  it.each([
    ['HTTP 500', () => new Response('error', { status: 500 })],
    ['HTML 200', () => new Response('<html><body>blocked</body></html>', { status: 200 })],
  ])('an inquiry answered with %s is PosHttpError', async (_name, answer) => {
    const { sent, promise } = complete(cv1(), hostedOrder(), { inquiry: answer })
    await expect(promise).rejects.toBeInstanceOf(PosHttpError)
    expect(sent).toHaveLength(1)
  })

  // addition: T20 one gateway serves concurrent completions, each with its own inquiry and result
  it('two concurrent completions keep their own inquiries and results', async () => {
    const { sent, fetchImpl } = bankFetch({
      inquiry: (j) => confirmingRecord(j.orderId, { AuthCode: `A-${j.orderId}` }),
    })
    const { pos } = realGateway(fetchImpl)
    const [one, two] = (await Promise.all([
      pos.payment(MODEL.THREE_D_PAY, hostedOrder(CV1_ORDER_ID), TX_TYPE.PAY_AUTH, null, cb(cv1())),
      pos.payment(MODEL.THREE_D_HOST, hostedOrder(CV2_ORDER_ID), TX_TYPE.PAY_AUTH, null, cb(cv2())),
    ])) as Data[]

    expect(sent.map((s) => s.json.orderId).sort()).toStrictEqual([CV2_ORDER_ID, CV1_ORDER_ID].sort())
    expect(one?.order_id).toBe(CV1_ORDER_ID)
    expect(one?.auth_code).toBe(`A-${CV1_ORDER_ID}`)
    expect(two?.order_id).toBe(CV2_ORDER_ID)
    expect(two?.auth_code).toBe(`A-${CV2_ORDER_ID}`)
  })
})

describe('ToslaPos (end to end) callback signature and order binding', () => {
  // addition: T3 the announced field list must be the pinned one
  it.each([
    ['reordered', 'ApiUser,ClientId,OrderId,MdStatus,BankResponseCode,BankResponseMessage,RequestStatus'],
    ['without ApiUser', 'ClientId,OrderId,MdStatus,BankResponseCode,BankResponseMessage,RequestStatus'],
    ['with spaces', HP.replaceAll(',', ', ')],
    ['absent', undefined],
  ])('HashParameters %s is HashMismatchError without a request', async (_name, list) => {
    const { sent, promise } = complete(cv1({ HashParameters: list }))
    await expect(promise).rejects.toStrictEqual(HASH_MISMATCH)
    expect(sent).toHaveLength(0)
  })

  // addition: T3 malformed hashes fail
  it.each([
    ['87 characters', `${cv1().Hash}`.slice(1)],
    ['lowercase garbage', 'a'.repeat(86).concat('==')],
  ])('a Hash of %s is HashMismatchError without a request', async (_name, hash) => {
    const { sent, promise } = complete(cv1({ Hash: hash }))
    await expect(promise).rejects.toStrictEqual(HASH_MISMATCH)
    expect(sent).toHaveLength(0)
  })

  // addition: T3/T5 a callback is a flat form of strings: anything else is refused before the crypt
  it.each([
    ['Hash as a list', { Hash: [cv1().Hash] }],
    ['MdStatus as a number', { MdStatus: 1 }],
    ['OrderId as a record', { OrderId: {} }],
    ['RequestStatus null', { RequestStatus: null }],
    ['BankResponseCode true', { BankResponseCode: true }],
  ])('%s is PosError before the crypt, without a request', async (_name, over) => {
    const { sent, promise, check } = complete(cv1(over))
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect(err).not.toBeInstanceOf(HashMismatchError)
    expect((err as Error).message).toMatch(/^3D callback field ".+" must be a string$/)
    expect(check).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  // addition: T5 an approval without a Hash is refused
  it.each([
    ['all three indicators', { OrderId: CV1_ORDER_ID, MdStatus: '1', BankResponseCode: '00', RequestStatus: '1' }],
    ['only MdStatus 1', { OrderId: CV1_ORDER_ID, MdStatus: '1', BankResponseCode: 'MD:1', RequestStatus: '0' }],
    ['only a padded code 00', { OrderId: CV1_ORDER_ID, MdStatus: '0', BankResponseCode: ' 00 ', RequestStatus: '0' }],
    ['only RequestStatus 1', { OrderId: CV1_ORDER_ID, MdStatus: '0', BankResponseCode: 'MD:0', RequestStatus: '1' }],
    ['an empty Hash', { ...cv1(), Hash: '' }],
  ])('an unsigned callback with %s is HashMismatchError without a request', async (_name, callback) => {
    const { sent, promise, check } = complete(callback)
    await expect(promise).rejects.toStrictEqual(NO_HASH)
    expect(check).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  // addition: T5 every present Hash is verified, the declines included
  it('a signed decline with a wrong Hash is HashMismatchError', async () => {
    const { sent, promise } = complete(cv3({ Hash: cv1().Hash }), hostedOrder('20231203E148'))
    await expect(promise).rejects.toStrictEqual(HASH_MISMATCH)
    expect(sent).toHaveLength(0)
  })

  // addition: T6 RP1 the A1001 approval re-read for order A is refused
  it('RP1: the A1001 approval re-read as order A with message 1100 is malformed, without a request', async () => {
    const reread = signedCallback('A', '1', '00', '1100', '1')
    expect(reread.Hash).toBe(signedCallback('A1001', '1', '00', '', '1').Hash)
    const { sent, promise, check } = complete(reread, hostedOrder('A'))
    await expect(promise).rejects.toStrictEqual(MALFORMED)
    expect(check).toHaveBeenCalledTimes(1)
    expect(check).toHaveReturnedWith(true)
    expect(sent).toHaveLength(0)

    const genuine = complete(signedCallback('A1001', '1', '00', '', '1'), hostedOrder('A1001'))
    expect(((await genuine.promise) as Data).status).toBe('approved')
    expect(genuine.sent).toHaveLength(1)
  })

  // addition: T6 the approve-path pins compare the signed text exactly
  it.each([
    ["BankResponseCode ' 00'", ' 00', '1', '1', '', CV1_ORDER_ID],
    ["BankResponseCode '00 '", '00 ', '1', '1', '', CV1_ORDER_ID],
    ["RequestStatus ' 1'", '00', ' 1', '1', '', CV1_ORDER_ID],
    ["RequestStatus '0'", '00', '0', '1', '', CV1_ORDER_ID],
    ["MdStatus '1 '", '00', '1', '1 ', '', CV1_ORDER_ID],
    ["MdStatus '12'", '00', '1', '12', '', CV1_ORDER_ID],
    ["MdStatus ''", '00', '1', '', '', CV1_ORDER_ID],
    ["message 'Onay 1'", '00', '1', '1', 'Onay 1', CV1_ORDER_ID],
    ["OrderId '_A1'", '00', '1', '1', '', '_A1'],
    ["OrderId 'A 1'", '00', '1', '1', '', 'A 1'],
    ['OrderId of 65 characters', '00', '1', '1', '', 'A'.repeat(65)],
  ])('a signed approval with %s is malformed, without a request', async (_name, code, req, md, msg, orderId) => {
    const { sent, promise } = complete(signedCallback(orderId, md, code, msg, req), hostedOrder())
    await expect(promise).rejects.toStrictEqual(MALFORMED)
    expect(sent).toHaveLength(0)
  })

  // addition: T6 (ruling) on a signed callback the 3D result alone is no approval signal: a genuine 3D-authenticated
  // bank decline is mapped declined without a request
  it.each(HOSTED)('%s: a signed 3D-authenticated bank decline is declined without a request', async (_label, model) => {
    const callback = signedCallback(CV1_ORDER_ID, '1', '51', 'Yetersiz bakiye', '0')
    const { sent, promise, check } = complete(callback, hostedOrder(), {}, model)
    const res = (await promise) as Data

    expect(check).toHaveReturnedWith(true)
    expect(sent).toHaveLength(0)
    expect(res.status).toBe('declined')
    expect(res.proc_return_code).toBe('51')
    expect(res.error_message).toBe('Yetersiz bakiye')
    expect(res.md_status).toBe('1')
    expect(res.requires_manual_review).toBeUndefined()
  })

  // addition: T6 (ruling) a signed MD:1 code with 3D result 1 is a decline too
  it('a signed callback with BankResponseCode MD:1, MdStatus 1 and RequestStatus 0 is declined', async () => {
    const { sent, promise } = complete(signedCallback(CV1_ORDER_ID, '1', 'MD:1', '', '0'))
    expect(((await promise) as Data).status).toBe('declined')
    expect(sent).toHaveLength(0)
  })

  // addition: T6 a decline text without digits passes the pins
  it('an approval with a message without digits is confirmed', async () => {
    const { promise } = complete(signedCallback(CV1_ORDER_ID, '1', '00', 'Onay', '1'))
    expect(((await promise) as Data).status).toBe('approved')
  })

  // addition: T7 the signed order id is bound before any request
  it('a CV1 approval completed for order 202312034E92 is OrderMismatchError order_id without a request', async () => {
    const { sent, promise } = complete(cv1(), hostedOrder('202312034E92'))
    const err = await mismatch(promise)
    expect([err.field, err.expected, err.actual, err.paymentMayHaveCompleted]).toStrictEqual([
      'order_id',
      '202312034E92',
      CV1_ORDER_ID,
      false,
    ])
    expect(err.response).toBeUndefined()
    expect(sent).toHaveLength(0)
  })

  // addition: T7 the unsigned client id of an approval must be the account's
  it("a callback ClientId '999' is OrderMismatchError merchant_id without a request", async () => {
    const callback = cv1({ ClientId: '999' })
    const { sent, promise, check } = complete(callback)
    const err = await mismatch(promise)
    expect(check).toHaveReturnedWith(true)
    expect([err.field, err.paymentMayHaveCompleted]).toStrictEqual(['merchant_id', false])
    expect(sent).toHaveLength(0)
  })

  // addition: T7 the client id may be left out
  it('an approval without ClientId is confirmed', async () => {
    const { promise } = complete(cv1({ ClientId: undefined }))
    expect(((await promise) as Data).status).toBe('approved')
  })

  // addition: T13/T12 the order is validated before the crypt
  it.each([
    ['amount 0', { amount: 0 }],
    ['amount 0.004', { amount: 0.004 }],
    ['amount -1', { amount: -1 }],
    ["amount 'abc'", { amount: 'abc' }],
    ['amount 1e13', { amount: 1e13 }],
    ['no amount', { amount: undefined }],
    ['currency XYZ', { currency: 'XYZ' }],
    ['installment 1.5', { installment: 1.5 }],
    ["id '_A1'", { id: '_A1' }],
    ['no id', { id: undefined }],
  ])('an order with %s is PosError before the crypt', async (_name, over) => {
    const order = hostedOrder(CV1_ORDER_ID, over as PosOrder)
    for (const key of Object.keys(order)) if (order[key] === undefined) delete order[key]
    const { sent, promise, check } = complete(cv1(), order)
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect(err).not.toBeInstanceOf(HashMismatchError)
    expect(err).not.toBeInstanceOf(OrderMismatchError)
    expect(check).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })
})

describe('ToslaPos (end to end) declines', () => {
  // addition: T10 an unsigned decline carries trusted data only
  it.each(HOSTED)(
    '%s: an unsigned decline carries the order id and bounded decline reasons only',
    async (_label, model) => {
      const callback = {
        OrderId: 'X',
        MdStatus: '0',
        BankResponseCode: 'MD:0',
        RequestStatus: '0',
        TransactionId: '99',
      }
      const { sent, promise } = complete(callback, hostedOrder(), {}, model)
      const res = (await promise) as Data

      expect(sent).toHaveLength(0)
      expect(res.status).toBe('declined')
      expect(res.order_id).toBe(CV1_ORDER_ID)
      expect(res.transaction_id).toBeNull()
      expect(res.auth_code).toBeNull()
      expect(res.md_status).toBeNull()
      expect(res.tx_status).toBeNull()
      expect(res.error_code).toBe('MD:0')
      expect(res.proc_return_code).toBe('MD:0')
      expect(res.payment_model).toBe(model)
      expect(res.transaction_type).toBe('pay')
      expect(res.requires_manual_review).toBeUndefined()
      expect(res.all).toStrictEqual(callback)
    },
  )

  // addition: T10 the decline reasons of an unsigned callback are bounded
  it('a decline message longer than 256 characters is cut to 256', async () => {
    const callback = {
      MdStatus: '0',
      BankResponseCode: 'MD:0',
      BankResponseMessage: 'x'.repeat(300),
      RequestStatus: '0',
    }
    const res = (await complete(callback).promise) as Data
    expect(res.error_message).toBe('x'.repeat(256))
  })

  // addition: T5 require_3d_hash refuses every unsigned callback
  it('require_3d_hash refuses an unsigned decline', async () => {
    const callback = { OrderId: 'X', MdStatus: '0', BankResponseCode: 'MD:0', RequestStatus: '0' }
    const { sent, promise } = complete(callback, hostedOrder(), {}, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, {
      ...E2E_CONFIG,
      require_3d_hash: true,
    })
    await expect(promise).rejects.toStrictEqual(NO_HASH)
    expect(sent).toHaveLength(0)
  })

  // addition: the half_3d_secure fixture (empty Hash) is an unsigned decline
  it('the half_3d_secure fixture is an unsigned decline', async () => {
    const res = (await complete(fixture(threeDPayCases, 'half_3d_secure')).promise) as Data
    expect(res.status).toBe('declined')
    expect(res.order_id).toBe(CV1_ORDER_ID)
    expect(res.error_code).toBe('MD:2')
  })

  // addition: T10/T7 a signed decline is mapped as it came and never bound to the order
  it.each(HOSTED)(
    '%s: a signed decline (CV3) is mapped declined as it came, without a request',
    async (_label, model) => {
      const { sent, promise } = complete(cv3(), hostedOrder(), {}, model)
      const res = (await promise) as Data
      expect(sent).toHaveLength(0)
      expect(res.status).toBe('declined')
      expect(res.order_id).toBe('20231203E148')
      expect(res.md_status).toBe('0')
      expect(res.proc_return_code).toBe('MD:0')
      expect(res.requires_manual_review).toBeUndefined()
    },
  )

  // addition: T6 a signed decline is not pinned (decline texts are free form)
  it('a signed decline with digits in its message is mapped declined', async () => {
    const res = (await complete(signedCallback('20231203E148', '0', 'MD:0', 'Hata 51', '0')).promise) as Data
    expect(res.status).toBe('declined')
    expect(res.error_message).toBe('Hata 51')
  })

  // addition: T9 a bank approval with half 3D is declined; flagged only with bank evidence
  it.each(HOSTED)(
    '%s: HV1 with a confirming record is declined and flagged for manual review',
    async (_label, model) => {
      const { sent, promise } = complete(hv1(), hostedOrder(CV2_ORDER_ID), {}, model)
      const res = (await promise) as Data

      expect(sent).toHaveLength(1)
      expect(sent[0]?.path).toBe('inquiry')
      expect(sent[0]?.json.orderId).toBe(CV2_ORDER_ID)
      expect(res.status).toBe('declined')
      expect(res.requires_manual_review).toBe(true)
      expect(res.auth_code).toBe('A1')
      expect(res.ref_ret_num).toBe('R1')
      expect(res.transaction_id).toBe('2000000000032562')
      expect(res.order_id).toBe(CV2_ORDER_ID)
    },
  )

  // addition: T9 without bank evidence the decline is plain
  it.each([
    ['another amount', { Amount: 1 }],
    ['refunded', { RefundedAmount: 101 }],
    ['not found', { OrderId: null, Code: 0 }],
  ])('HV1 with a record that does not confirm (%s) is a plain decline', async (_name, over) => {
    const { sent, promise } = complete(hv1(), hostedOrder(CV2_ORDER_ID), {
      inquiry: (j) => confirmingRecord(j.orderId, over),
    })
    const res = (await promise) as Data
    expect(sent).toHaveLength(1)
    expect(res.status).toBe('declined')
    expect(res.requires_manual_review).toBeUndefined()
    expect(res.auth_code).toBeNull()
    expect(res.transaction_id).toBeNull()
  })

  // addition: T9 the half 3D approval is bound before the inquiry
  it('HV1 completed for another order is OrderMismatchError order_id without a request', async () => {
    const { sent, promise } = complete(hv1(), hostedOrder('20231203626E'))
    const err = await mismatch(promise)
    expect([err.field, err.paymentMayHaveCompleted]).toStrictEqual(['order_id', false])
    expect(sent).toHaveLength(0)
  })
})

describe('ToslaPos (end to end) re-split readings', () => {
  /** Every reading of `text` as five consecutive values (each possibly empty). */
  function* splits(text: string): Generator<[string, string, string, string, string]> {
    const n = text.length
    for (let a = 0; a <= n; a++)
      for (let b = a; b <= n; b++)
        for (let c = b; c <= n; c++)
          for (let d = c; d <= n; d++)
            yield [text.slice(0, a), text.slice(a, b), text.slice(b, c), text.slice(c, d), text.slice(d)]
  }

  // addition: T6 every reading of a genuine signature other than the genuine one is refused or declined; only the
  // genuine approval is confirmed (one inquiry) and approved, and only the genuine half 3D approval raises a review
  it.each([
    ['CV1', [CV1_ORDER_ID, '1', '00', '', '1'], 'approved'],
    ['RP1', ['A1001', '1', '00', '', '1'], 'approved'],
    ['HV1', [CV2_ORDER_ID, '2', '00', '', '1'], 'review'],
    ['CV3', ['20231203E148', '0', 'MD:0', '', '0'], 'declined'],
  ] as Array<[string, [string, string, string, string, string], string]>)(
    '%s',
    async (_name, genuine, genuineOutcome) => {
      const hash = CB(...genuine)
      const text = genuine.join('')
      const { sent, fetchImpl } = bankFetch()
      const { pos } = realGateway(fetchImpl)
      const outcomes: Record<string, number> = {}
      let readings = 0
      let genuineSeen = 0
      for (const [o, md, code, msg, req] of splits(text)) {
        readings++
        const isGenuine = [o, md, code, msg, req].join('|') === genuine.join('|')
        const callback = {
          ClientId: CLIENT_ID,
          OrderId: o,
          MdStatus: md,
          BankResponseCode: code,
          BankResponseMessage: msg,
          RequestStatus: req,
          HashParameters: HP,
          Hash: hash,
        }
        // the payer picks the order the reading names, the best case for a forger
        const orderId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(o) ? o : 'Z9'
        const before = sent.length
        let outcome: string
        try {
          const res = await pos.payment(MODEL.THREE_D_PAY, hostedOrder(orderId), TX_TYPE.PAY_AUTH, null, cb(callback))
          outcome = res.status === 'approved' ? 'approved' : res.requires_manual_review === true ? 'review' : 'declined'
        } catch (e) {
          outcome = (e as Error).constructor.name
        }
        const requests = sent.length - before
        if (isGenuine) {
          genuineSeen++
          expect(outcome).toBe(genuineOutcome)
        } else {
          expect(outcome).not.toBe('approved')
          expect(outcome).not.toBe('review')
          expect(requests).toBe(0)
        }
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
      }
      expect(genuineSeen).toBe(1)
      expect(readings).toBeGreaterThan(700)
      expect(sent.length).toBe(genuineOutcome === 'declined' ? 0 : 1)
    },
    60_000,
  )
})

describe('ToslaPos (end to end) 3D form', () => {
  const formOrder = (over: PosOrder = {}): PosOrder => ({
    id: 'order222',
    amount: 100.25,
    installment: 0,
    currency: CURRENCY.TRY,
    success_url: 'https://domain.com/success',
    ...over,
  })

  const formCard = () => CreditCardFactory.create('4546711234567894', '26', '12', '000', 'John Doe', CARD_TYPE.VISA)

  // addition: T15 the 3D Pay session is registered with one signed request; the form carries the card
  it('3D Pay registers a session and returns the card form', async () => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    const form = await pos.get3DFormData(formOrder(), MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, formCard())

    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(`${PAYMENT_API}/threeDPayment`)
    expect(sent[0]?.json).toMatchObject({
      clientId: CLIENT_ID,
      apiUser: API_USER,
      callbackUrl: 'https://domain.com/success',
      orderId: 'order222',
      amount: 10025,
      currency: 949,
      installmentCount: 0,
    })
    expect(sent[0]?.json.hash).toBe(RQ(sent[0]?.json.rnd, sent[0]?.json.timeSpan))
    expect(form).toStrictEqual({
      gateway: `${PAYMENT_API}/ProcessCardForm`,
      method: 'POST',
      inputs: {
        ThreeDSessionId: 'PA49E341381C94587AB4CB196DAC10DC02E509578520E4471A3EEE2BB4830AE4F',
        CardHolderName: 'John Doe',
        CardNo: '4546711234567894',
        ExpireDate: '12/26',
        Cvv: '000',
      },
    })
  })

  // deviation: T23 with createWithoutCard the card is not passed on, so the form carries only the session id
  it('3D Pay without card data returns only the session id', async () => {
    const { fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    const form = await pos.get3DFormData(formOrder(), MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, formCard(), true)
    expect(form).toStrictEqual({
      gateway: `${PAYMENT_API}/ProcessCardForm`,
      method: 'POST',
      inputs: { ThreeDSessionId: 'PA49E341381C94587AB4CB196DAC10DC02E509578520E4471A3EEE2BB4830AE4F' },
    })
  })

  // addition: T15 the 3D Host page is a GET of the session URL; a pre-authorization registers at threeDPreAuth
  it('3D Host returns the session URL; a pre-authorization registers at threeDPreAuth', async () => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    const form = await pos.get3DFormData(formOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true)
    await pos.get3DFormData(formOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_PRE_AUTH, null, true)
    await pos.get3DFormData(formOrder(), MODEL.THREE_D_PAY, TX_TYPE.PAY_PRE_AUTH, formCard())

    expect(form).toStrictEqual({
      gateway:
        'https://prepentegrasyon.tosla.com/api/Payment/threeDSecure/PA49E341381C94587AB4CB196DAC10DC02E509578520E4471A3EEE2BB4830AE4F',
      method: 'GET',
      inputs: {},
    })
    expect(sent.map((s) => s.path)).toStrictEqual(['threeDPayment', 'threeDPreAuth', 'threeDPreAuth'])
  })

  // addition: T15 a failed registration never builds a form
  it('a register answer with Code 202 is PosError carrying the bank message', async () => {
    const { fetchImpl } = bankFetch({
      register: () => ({ Code: 202, Message: 'Üye İşyeri Kullanıcısı Bulunamadı', ThreeDSessionId: null }),
    })
    const { pos } = realGateway(fetchImpl)
    await expect(
      pos.get3DFormData(formOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true),
    ).rejects.toStrictEqual(new PosError('3D session could not be created: Üye İşyeri Kullanıcısı Bulunamadı'))
  })

  // addition: T15 the result code must be the number 0
  it.each([
    ["Code '0'", { Code: '0', ThreeDSessionId: 'P1' }],
    ['no Code', { ThreeDSessionId: 'P1' }],
    ['Code 1 with a long message', { Code: 1, Message: 'm'.repeat(300) }],
  ])('a register answer with %s is PosError', async (_name, answer) => {
    const { fetchImpl } = bankFetch({ register: () => answer })
    const { pos } = realGateway(fetchImpl)
    const err = await pos
      .get3DFormData(formOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect((err as Error).message.startsWith('3D session could not be created: ')).toBe(true)
    expect((err as Error).message.length).toBeLessThanOrEqual('3D session could not be created: '.length + 256)
  })

  // addition: T15 the session id becomes a URL path segment and a form value
  it.each([
    ['missing', undefined],
    ['../x', '../x'],
    ['a b', 'a b'],
    ['129 characters', 'P'.repeat(129)],
    ['a number', 12345],
  ])('a session id %s is PosError', async (_name, sessionId) => {
    const { fetchImpl } = bankFetch({ register: () => ({ Code: 0, ThreeDSessionId: sessionId }) })
    const { pos } = realGateway(fetchImpl)
    await expect(
      pos.get3DFormData(formOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true),
    ).rejects.toStrictEqual(new PosError('3D session id is missing or malformed'))
  })

  // addition: T12/T13 the order is validated before the registration
  it.each([
    ['amount 0', { amount: 0 }],
    ["amount 'abc'", { amount: 'abc' }],
    ['a bad callback URL', { success_url: 'javascript:alert(1)' }],
    ["id '_x'", { id: '_x' }],
  ])('an order with %s is PosError without a request', async (_name, over) => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    await expect(
      pos.get3DFormData(formOrder(over as PosOrder), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true),
    ).rejects.toBeInstanceOf(PosError)
    expect(sent).toHaveLength(0)
  })
})

describe('ToslaPos (end to end) money requests', () => {
  const saleCard = () => CreditCardFactory.create('4546711234567894', '26', '12', '000', 'John Doe', CARD_TYPE.VISA)

  // addition: T12 1.15 is 115 kuruş in every request that carries an amount
  it('1.15 is sent as 115 kuruş in the registration, sale, post-authorization and refund', async () => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    const order = { id: 'K115', amount: 1.15, currency: CURRENCY.TRY, success_url: 'https://domain.com/cb' }
    await pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true)
    await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, saleCard())
    await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_POST_AUTH)
    await pos.refund({ id: 'K115', amount: 1.15 })

    expect(sent.map((s) => [s.path, s.json.amount])).toStrictEqual([
      ['threeDPayment', 115],
      ['Payment', 115],
      ['postAuth', 115],
      ['refund', 115],
    ])
  })

  // addition: T12 a bad amount never reaches the bank
  it.each([[0.004], [0], [-1], ['abc'], [1e13]])('amount %j is PosError before any request', async (amount) => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    const order = { id: 'K1', amount, success_url: 'https://domain.com/cb' } as unknown as PosOrder
    for (const run of [
      () => pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true),
      () => pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, saleCard()),
      () => pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_POST_AUTH),
      () => pos.refund(order),
    ]) {
      await expect(run()).rejects.toBeInstanceOf(PosError)
    }
    expect(sent).toHaveLength(0)
  })

  // addition: T16 an answer without a result code after a sale or post-authorization is an unknown outcome
  it.each([
    ['204', () => new Response(null, { status: 204 })],
    ['{}', () => ({})],
    ["{ Message: 'x' }", () => ({ Message: 'x' })],
    ["Code '0'", () => ({ Code: '0', BankResponseCode: '00', OrderId: 'S1' })],
    ['Code 0.5', () => ({ Code: 0.5, BankResponseCode: '05', OrderId: 'S1' })],
    ['Code null', () => ({ Code: null, BankResponseCode: '05', OrderId: 'S1' })],
  ])('a sale answered %s is PosHttpError naming the request URL, never declined', async (_name, answer) => {
    for (const [txType, path] of [
      [TX_TYPE.PAY_AUTH, 'Payment'],
      [TX_TYPE.PAY_POST_AUTH, 'postAuth'],
    ] as const) {
      const { sent, fetchImpl } = bankFetch({ sale: () => answer() })
      const { pos } = realGateway(fetchImpl)
      const order = { id: 'S1', amount: 1.01 }
      const err = await (txType === TX_TYPE.PAY_AUTH
        ? pos.payment(MODEL.NON_SECURE, order, txType, saleCard())
        : pos.payment(MODEL.NON_SECURE, order, txType)
      ).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PosHttpError)
      expect((err as PosHttpError).url).toBe(`${PAYMENT_API}/${path}`)
      expect((err as Error).message).toBe('Bank answer carries no result code; the payment outcome is unknown')
      expect(sent).toHaveLength(1)
    }
  })

  // addition: T16 an approval with another result code or for another order may still have moved money
  it.each([
    ['Code 997', { Code: 997, BankResponseCode: '00', OrderId: 'S1' }, 'order_status'],
    ["OrderId 'other'", { Code: 0, BankResponseCode: '00', OrderId: 'other' }, 'order_id'],
    ['no OrderId', { Code: 0, BankResponseCode: '00' }, 'order_id'],
  ] as Array<[string, Data, string]>)(
    'an approved sale with %s is OrderMismatchError %s',
    async (_name, answer, field) => {
      for (const txType of [TX_TYPE.PAY_AUTH, TX_TYPE.PAY_POST_AUTH]) {
        const { fetchImpl } = bankFetch({ sale: () => answer })
        const { pos } = realGateway(fetchImpl)
        const order = { id: 'S1', amount: 1.01 }
        const err = await mismatch(
          txType === TX_TYPE.PAY_AUTH
            ? pos.payment(MODEL.NON_SECURE, order, txType, saleCard())
            : pos.payment(MODEL.NON_SECURE, order, txType),
        )
        expect(err.field).toBe(field)
        expect(err.paymentMayHaveCompleted).toBe(true)
        expect(err.response?.requires_manual_review).toBe(true)
      }
    },
  )

  // addition: T16 a result code 0 without a bank response code does not tell whether money moved
  it.each([
    ['no BankResponseCode', { Code: 0, OrderId: 'S1' }],
    ['BankResponseCode null', { Code: 0, BankResponseCode: null, OrderId: 'S1' }],
    ["BankResponseCode ''", { Code: 0, BankResponseCode: '', OrderId: 'S1' }],
    ['BankResponseCode 0 (a number)', { Code: 0, BankResponseCode: 0, OrderId: 'S1' }],
    ["BankResponseCode ['00']", { Code: 0, BankResponseCode: ['00'], OrderId: 'S1' }],
  ] as Array<[string, Data]>)(
    'a sale answered with Code 0 and %s is PosHttpError, never declined',
    async (_name, answer) => {
      for (const [txType, path] of [
        [TX_TYPE.PAY_AUTH, 'Payment'],
        [TX_TYPE.PAY_POST_AUTH, 'postAuth'],
      ] as const) {
        const { sent, fetchImpl } = bankFetch({ sale: () => answer })
        const { pos } = realGateway(fetchImpl)
        const order = { id: 'S1', amount: 1.01 }
        const err = await (txType === TX_TYPE.PAY_AUTH
          ? pos.payment(MODEL.NON_SECURE, order, txType, saleCard())
          : pos.payment(MODEL.NON_SECURE, order, txType)
        ).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(PosHttpError)
        expect((err as PosHttpError).url).toBe(`${PAYMENT_API}/${path}`)
        expect(sent).toHaveLength(1)
      }
    },
  )

  // addition: a padded approval code may be an approval the bank wrote with stray blanks: the outcome is unknown
  it.each([' 00', '00 ', ' 00 ', '00\n'])(
    'a sale or post-authorization answered with Code 0 and BankResponseCode %j is PosHttpError, never declined',
    async (code) => {
      for (const [txType, path] of [
        [TX_TYPE.PAY_AUTH, 'Payment'],
        [TX_TYPE.PAY_POST_AUTH, 'postAuth'],
      ] as const) {
        const { sent, fetchImpl } = bankFetch({ sale: () => ({ Code: 0, BankResponseCode: code, OrderId: 'S1' }) })
        const { pos } = realGateway(fetchImpl)
        const order = { id: 'S1', amount: 1.01 }
        const err = await (txType === TX_TYPE.PAY_AUTH
          ? pos.payment(MODEL.NON_SECURE, order, txType, saleCard())
          : pos.payment(MODEL.NON_SECURE, order, txType)
        ).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(PosHttpError)
        expect((err as PosHttpError).url).toBe(`${PAYMENT_API}/${path}`)
        expect(sent).toHaveLength(1)
      }
    },
  )

  // addition: another clean code with result code 0 is the bank's decline
  it("a sale or post-authorization answered with Code 0 and BankResponseCode '05' is declined", async () => {
    const order = { id: 'S1', amount: 1.01 }
    for (const txType of [TX_TYPE.PAY_AUTH, TX_TYPE.PAY_POST_AUTH]) {
      const { fetchImpl } = bankFetch({ sale: () => ({ Code: 0, BankResponseCode: '05', OrderId: 'S1' }) })
      const { pos } = realGateway(fetchImpl)
      const res = await (txType === TX_TYPE.PAY_AUTH
        ? pos.payment(MODEL.NON_SECURE, order, txType, saleCard())
        : pos.payment(MODEL.NON_SECURE, order, txType))
      expect(res.status).toBe('declined')
      expect(res.proc_return_code).toBe('05')
    }
  })

  // addition: T16 a declined sale with a result code stays a decline
  it('a sale declined with Code 5 and BankResponseCode 05 is declined', async () => {
    const { fetchImpl } = bankFetch({
      sale: () => ({ Code: 5, BankResponseCode: '05', Message: 'Red', OrderId: 'S1' }),
    })
    const { pos } = realGateway(fetchImpl)
    const res = await pos.payment(MODEL.NON_SECURE, { id: 'S1', amount: 1.01 }, TX_TYPE.PAY_AUTH, saleCard())
    expect(res.status).toBe('declined')
    expect(res.error_message).toBe('Red')
  })

  // addition: the approved sale and post-authorization of the happy path
  it('an approved sale and post-authorization are returned', async () => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    const sale = await pos.payment(MODEL.NON_SECURE, { id: 'S1', amount: 1.01 }, TX_TYPE.PAY_AUTH, saleCard())
    const post = await pos.payment(MODEL.NON_SECURE, { id: 'S1', amount: 1.01 }, TX_TYPE.PAY_POST_AUTH)
    expect([sale.status, post.status]).toStrictEqual(['approved', 'approved'])
    expect(sent[0]?.json).toMatchObject({ orderId: 'S1', amount: 101, currency: 949, installmentCount: 0 })
  })

  // addition: T25 cancel, refund and order history go to their paths
  it('cancel, partial refund and order history go to void, refund and history', async () => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    const cancel = await pos.cancel({ id: 'C1' })
    const refund = await pos.refund({ id: 'C1', amount: 0.59, order_amount: 1.01 })
    const history = await pos.orderHistory({ id: 'C1', transaction_date: new Date('2023-12-09T12:00:00+03:00') })

    expect(sent.map((s) => s.path)).toStrictEqual(['void', 'refund', 'history'])
    expect(sent[0]?.json).toMatchObject({ orderId: 'C1' })
    expect(sent[1]?.json).toMatchObject({ orderId: 'C1', amount: 59 })
    expect(sent[2]?.json).toMatchObject({ orderId: 'C1', transactionDate: '20231209', page: 1, pageSize: 10 })
    expect([cancel.status, refund.status, history.status]).toStrictEqual(['approved', 'approved', 'approved'])
  })

  // addition: a non-secure pre-authorization is not offered
  it('a non-secure pre-authorization is UnsupportedTransactionTypeError without a request', async () => {
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl)
    await expect(pos.makeRegularPayment({ id: 'S1', amount: 1 }, saleCard(), TX_TYPE.PAY_PRE_AUTH)).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    expect(sent).toHaveLength(0)
  })
})

describe('ToslaPos (end to end) masking', () => {
  // addition: T21 nothing secret reaches the logger
  it('never logs the API password, a request hash, the card number, the CVV or a computed callback hash', async () => {
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
    const hooks: PosHooks = {
      onRequestDataPrepared: [
        (event) => {
          if (event.txType === TX_TYPE.STATUS) event.requestData.note = 'changed by a hook'
        },
      ],
    }
    const { sent, fetchImpl } = bankFetch()
    const { pos } = realGateway(fetchImpl, { logger, hooks })
    const c = CreditCardFactory.create('4546711234567894', '26', '12', '000', 'John Doe', CARD_TYPE.VISA)
    const formOrder = { id: 'F1', amount: 1.01, success_url: 'https://domain.com/cb' }
    const tampered = cv1({ BankResponseMessage: 'x' }) // carries CV1's hash; the crypt computes another one
    const tamperedHash = CB(CV1_ORDER_ID, '1', '00', 'x', '1')

    await pos.get3DFormData(formOrder, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, c)
    await pos.payment(MODEL.THREE_D_PAY, hostedOrder(), TX_TYPE.PAY_AUTH, null, cb(cv1()))
    await pos.payment(MODEL.THREE_D_HOST, hostedOrder(CV2_ORDER_ID), TX_TYPE.PAY_AUTH, null, cb(cv2()))
    await pos.payment(MODEL.THREE_D_PAY, hostedOrder(), TX_TYPE.PAY_AUTH, null, cb(tampered)).catch(() => undefined)
    await pos.payment(MODEL.NON_SECURE, { id: 'N1', amount: 1.01 }, TX_TYPE.PAY_AUTH, c)
    await pos.payment(MODEL.NON_SECURE, { id: 'N1', amount: 1.01 }, TX_TYPE.PAY_POST_AUTH)
    await pos.cancel({ id: 'N1' })
    await pos.refund({ id: 'N1', amount: 1.01 })
    await pos.orderHistory({ id: 'N1', transaction_date: new Date() })

    const logged = JSON.stringify(records)
    expect(sent).toHaveLength(8)
    expect(logged).toContain('Request data is changed via listeners')
    expect(logged).not.toContain(API_PASS)
    expect(logged).not.toContain('4546711234567894')
    expect(logged).not.toMatch(/[Cc]vv\\?"\s*:\s*\\?"?000/)
    expect(logged).not.toContain(tamperedHash)
    expect(logged).not.toContain(cv1().Hash)
    for (const s of sent) expect(logged).not.toContain(s.json.hash)
  })
})
