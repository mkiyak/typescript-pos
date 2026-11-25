import { createHash, createHmac, pbkdf2Sync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import type { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { ParamPosCrypt } from '../../../src/crypt/ParamPosCrypt.js'
import { Param3DHostPosRequestDataMapper } from '../../../src/data-mapper/request/mapper/Param3DHostPosRequestDataMapper.js'
import type { RequestDataMapperInterface } from '../../../src/data-mapper/request/mapper/RequestDataMapperInterface.js'
import { ParamPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/ParamPosRequestValueFormatter.js'
import { ParamPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/ParamPosRequestValueMapper.js'
import { ParamPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/ParamPosResponseDataMapper.js'
import type { ResponseDataMapperInterface } from '../../../src/data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { ParamPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/ParamPosResponseValueFormatter.js'
import { ParamPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/ParamPosResponseValueMapper.js'
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
import { PosHttpClientStrategyFactory } from '../../../src/factory/PosHttpClientStrategyFactory.js'
import type { GatewayConfig, GatewayDeps } from '../../../src/gateway/AbstractGateway.js'
import { Param3DHostPos } from '../../../src/gateway/Param3DHostPos.js'
import type { PosLogger } from '../../../src/logger.js'
import type { ParamPosAccount } from '../../../src/model/account/ParamPosAccount.js'
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
import { ParamPosXmlDecoder } from '../../../src/serializer/ParamPosXmlDecoder.js'
import type { GatewayResponseData, PosHooks, PosOrder, RequestDataPreparedEvent } from '../../../src/types.js'
import { threeDHostCases } from '../data-mapper/response/mapper/ParamPosResponseDataMapper.data.js'

// The first section replaces the collaborators with vi.fn() fakes (except the request value mapper); the end-to-end
// sections use the real crypt, mappers and HTTP clients over a fake fetch that answers by endpoint and SOAP operation
// (the first element of the SOAP body) and records every request.

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

const PAYMENT_API = 'https://test-pos.param.com.tr/to.ws/Service_Odeme.asmx'
const GATEWAY_3D_HOST = 'https://test-pos.param.com.tr/default.aspx'
const QUERY_API = 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx'

// deviation: H6 the reference test config has only gateway_3d_host; the confirmation needs the TurkPos query_api
const config: GatewayConfig = {
  name: 'param-pos',
  class: 'Param3DHostPos',
  gateway_endpoints: { payment_api: PAYMENT_API, gateway_3d_host: GATEWAY_3D_HOST, query_api: QUERY_API },
}

const G = '0c13d406-873b-403b-9c09-a5766840d98c'
const USERNAME = 'Test1'
const PASSWORD = 'Test2'
/** The planning host account `HA`: the password differs from the user name, so a leak of either is visible. */
const HA = AccountFactory.createParamPosAccount('param-3d-host-pos', '10738', USERNAME, PASSWORD, G, '99001')

/** The transaction id of a hosted payment, recomputed here with node:crypto (independent of the crypt). */
const HOST_KEY = pbkdf2Sync(PASSWORD, `typescript-pos/param/3d-host-id|10738|${USERNAME}|${G}`, 200_000, 32, 'sha256')
const hostId = (orderId: string, kurus: number, currencyCode = '1000'): string =>
  createHmac('sha256', HOST_KEY)
    .update(`10738|${orderId}|${kurus}|${currencyCode}`, 'utf8')
    .digest('hex')
    .slice(0, 24)
    .toUpperCase()

const S1 = (text: string): string => createHash('sha1').update(text, 'utf8').digest('base64')
/** The signature of a payment result callback. */
const TPH = (c: Data, guid = G): string =>
  S1(
    `10738${guid}${c.TURKPOS_RETVAL_Dekont_ID ?? ''}${c.TURKPOS_RETVAL_Tahsilat_Tutari ?? ''}${c.TURKPOS_RETVAL_Siparis_ID ?? ''}${c.TURKPOS_RETVAL_Islem_ID ?? ''}`,
  )
const signedTp = (c: Data): Data => ({ ...c, TURKPOS_RETVAL_Hash: TPH(c) })

const createLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
const silent: PosLogger = { debug() {}, info() {}, warn() {}, error() {} }

const cb = (data: Data): GatewayResponseData => data as GatewayResponseData

/** CP1: a signed payment result approval (the 3D Host callback fixture is the 3D Pay one). */
const CP1: Data = threeDHostCases.success1?.paymentData as Data
/** CP3: a signed payment result decline. */
const CP3: Data = threeDHostCases.auth_fail?.paymentData as Data

/** The merchant's order the CP1 hosted payment was registered for. */
const ORDER: PosOrder = { id: 'order222', amount: 10.01, currency: CURRENCY.TRY, installment: 0 }
const ORDER_ID_HOST = hostId('order222', 1001)

/** A status record of a completed hosted sale (the bank's `DT_Bilgi`), registered for `ORDER`. */
const bankRecord = (over: Data = {}): Data => ({
  Odeme_Sonuc: '1',
  Odeme_Sonuc_Aciklama: 'İşlem Başarılı',
  Dekont_ID: '3007300695',
  Siparis_ID: '20250119BACB',
  Islem_ID: ORDER_ID_HOST,
  Durum: 'SUCCESS',
  Tarih: '19.01.2025 17:29:32',
  Toplam_Tutar: '10.01',
  Komisyon_Oran: '1.75',
  Komisyon_Tutar: '0.18',
  Banka_Sonuc_Aciklama: '',
  Taksit: '1',
  Ext_Data: '||||',
  Toplam_Iade_Tutar: '0',
  KK_No: '581877******2285',
  Islem_Tip: 'SALE',
  Bank_Trans_ID: '25019RcIG10421',
  Bank_AuthCode: '222905',
  Bank_HostRefNum: '501917472738',
  ...over,
})

const statusAnswer = (dt: unknown, sonuc: unknown = '1'): Data => ({
  TP_Islem_Sorgulama4Response: {
    TP_Islem_Sorgulama4Result: { ...(dt === undefined ? {} : { DT_Bilgi: dt }), Sonuc: sonuc, Sonuc_Str: 'Başarılı' },
  },
})

const ENCRYPTED =
  'JHnDLmT5yierHIqsHNRU2SR7HLxOpi8o7Eb/oVSiIf35v+Z1uzteqid4wop8SAuykWNFElYyAxGWcIGvTxmhSljuLTcJ3xDMkS3O0jUboNpl5ad6roy/92lDftpV535KmpbxMxStRa+qGT7Tk4BdEIf+Jobr2o1Yl1+ZakWZ+parsTgnodyWl432Hsv2FUNLhuU7H6folMwleaZFPYdFZ+bO1T95opw5pnDWcFkrIuPfAmVRg4cg+al22FQSN/58AXxWBb8jEPrqn+/ojZ+WqncGvw+NB/Mtv9iCDuF+SNQqRig2dRILzWYwcvNxzj/OxcYuNuvO8wYI/iF1kNBBNtaExIunWZyj1tntGeb7UUaDmHD4LmSMUMpgZGugRfUpxm8WL/EE+PnUkLXE7SOG3g=='

describe('Param3DHostPos planning vectors', () => {
  // addition: HI1 recomputed with node:crypto and by the crypt
  it('HI1', () => {
    expect(hostId('order222', 100025)).toBe('10EA8B9F7B2728D8F4BF034F')
    expect(new ParamPosCrypt(silent).create3DHostTransactionId(HA, 'order222', 100025, '1000')).toBe(
      '10EA8B9F7B2728D8F4BF034F',
    )
  })

  // addition: CP1 and CP3 verify with the host account's GUID
  it('the crypt verifies CP1 and CP3 with the account GUID', () => {
    const crypt = new ParamPosCrypt(silent)
    expect(TPH(CP1)).toBe('LOpkL9J8vne8E2j0A0HKOhUWGhI=')
    expect(crypt.check3DHash(HA, cb(CP1))).toBe(true)
    expect(crypt.check3DHash(HA, cb(CP3))).toBe(true)
  })
})

describe('Param3DHostPos (mocked collaborators)', () => {
  const account = HA
  let requestValueMapper: ParamPosRequestValueMapper
  let requestMapper: Mocked<RequestDataMapperInterface> & { createConfirmationRequestData: ReturnType<typeof vi.fn> }
  let responseMapper: Mocked<ResponseDataMapperInterface>
  let crypt: Mocked<CryptInterface> & { create3DHostTransactionId: ReturnType<typeof vi.fn> }
  let httpClient: { supportsTx: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }
  let clientStrategy: { getClient: ReturnType<typeof vi.fn>; getAllClients: ReturnType<typeof vi.fn> }
  let requestDataPrepared: ReturnType<typeof vi.fn<(e: RequestDataPreparedEvent) => void>>
  let logger: ReturnType<typeof createLogger>
  let pos: Param3DHostPos
  const realCrypt = new ParamPosCrypt(silent)

  const createGateway = (cfg: GatewayConfig = config, acc: ParamPosAccount = account): Param3DHostPos => {
    const hooks: PosHooks = { onRequestDataPrepared: [requestDataPrepared] }
    const deps: GatewayDeps<ParamPosAccount> = {
      requestValueMapper,
      requestValueFormatter: new ParamPosRequestValueFormatter(),
      requestDataMapper: requestMapper as unknown as RequestDataMapperInterface<ParamPosAccount>,
      responseDataMapper: responseMapper as unknown as ResponseDataMapperInterface,
      crypt: crypt as unknown as CryptInterface<ParamPosAccount>,
      clientStrategy: clientStrategy as unknown as HttpClientStrategy,
      logger,
      hooks,
    }
    return new Param3DHostPos(cfg, acc, deps)
  }

  beforeEach(() => {
    requestValueMapper = new ParamPosRequestValueMapper()
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
      createConfirmationRequestData: vi.fn(),
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
      // the transaction id is recomputed by the real derivation
      create3DHostTransactionId: vi.fn((acc: ParamPosAccount, id: string, kurus: number, code: string) =>
        realCrypt.create3DHostTransactionId(acc, id, kurus, code),
      ),
    }
    httpClient = { supportsTx: vi.fn(), request: vi.fn() }
    clientStrategy = { getClient: vi.fn(), getAllClients: vi.fn() }
    requestDataPrepared = vi.fn()
    logger = createLogger()
    pos = createGateway()
  })

  const card = () => CreditCardFactory.create('5555444433332222', '21', '12', '122', 'ahmet', CARD_TYPE.VISA)

  /** One request: the hook must see it with these values and add a key; the client answers `decoded`. */
  const configureClientResponse = (
    txType: TxType,
    requestData: Data,
    decoded: Data,
    order: PosOrder,
    paymentModel: PaymentModel,
  ): (() => void) => {
    clientStrategy.getClient.mockReturnValue(httpClient as unknown as AbstractHttpClient)
    httpClient.request.mockResolvedValueOnce(decoded)
    requestDataPrepared.mockImplementation((event) => {
      expect(event.gatewayClass).toBe('Param3DHostPos')
      expect(event.txType).toBe(txType)
      expect(event.requestData).toStrictEqual(requestData)
      expect(event.order).toStrictEqual(order)
      expect(event.paymentModel).toBe(paymentModel)
      event.requestData['test-update-request-data-with-event'] = true
    })

    return () => {
      expect(requestDataPrepared).toHaveBeenCalledTimes(1)
      expect(clientStrategy.getClient).toHaveBeenCalledTimes(1)
      expect(clientStrategy.getClient).toHaveBeenCalledWith(txType, paymentModel)
      expect(httpClient.request).toHaveBeenCalledTimes(1)
      expect(httpClient.request).toHaveBeenCalledWith(
        txType,
        paymentModel,
        { ...requestData, 'test-update-request-data-with-event': true },
        order,
        null,
      )
    }
  }

  const expectNoRequest = () => {
    expect(httpClient.request).not.toHaveBeenCalled()
    expect(requestDataPrepared).not.toHaveBeenCalled()
    expect(requestMapper.createConfirmationRequestData).not.toHaveBeenCalled()
  }

  it('init', () => {
    // deviation: real value mapper — the four currencies of the bank
    expect(pos.getCurrencies()).toStrictEqual(['TRY', 'USD', 'EUR', 'GBP'])
    expect(pos.getAccount()).toBe(account)
    expect(pos.isTestMode()).toBe(false)
    expect(pos.getCrypt()).toBe(crypt)
  })

  // addition: identifiers and the supported transactions table
  it('exposes NAME, the gateway class identifier and the supported transactions', () => {
    expect(Param3DHostPos.NAME).toBe('Param3DHostPos')
    expect(Param3DHostPos.GATEWAY_CLASS).toBe('Param3DHostPos')
    expect(Param3DHostPos.isSupportedTransaction(TX_TYPE.PAY_AUTH, MODEL.THREE_D_HOST)).toBe(true)
    for (const model of [MODEL.THREE_D_SECURE, MODEL.THREE_D_PAY, MODEL.NON_SECURE, MODEL.THREE_D_PAY_HOSTING]) {
      expect(Param3DHostPos.isSupportedTransaction(TX_TYPE.PAY_AUTH, model)).toBe(false)
    }
    for (const tx of [
      TX_TYPE.PAY_PRE_AUTH,
      TX_TYPE.PAY_POST_AUTH,
      TX_TYPE.STATUS,
      TX_TYPE.CANCEL,
      TX_TYPE.REFUND,
      TX_TYPE.REFUND_PARTIAL,
      TX_TYPE.ORDER_HISTORY,
    ]) {
      expect(Param3DHostPos.isSupportedTransaction(tx, MODEL.THREE_D_HOST)).toBe(false)
      expect(Param3DHostPos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(false)
    }
  })

  // addition: the gateway needs the confirmation request and the transaction id derivation
  it('refuses collaborators without the confirmation request or the transaction id', () => {
    const { createConfirmationRequestData: _m, ...plainMapper } = requestMapper
    const { create3DHostTransactionId: _c, ...plainCrypt } = crypt
    const deps = (mapper: unknown, c: unknown): GatewayDeps<ParamPosAccount> => ({
      requestValueMapper,
      requestValueFormatter: new ParamPosRequestValueFormatter(),
      requestDataMapper: mapper as RequestDataMapperInterface<ParamPosAccount>,
      responseDataMapper: responseMapper as unknown as ResponseDataMapperInterface,
      crypt: c as CryptInterface<ParamPosAccount>,
      clientStrategy: clientStrategy as unknown as HttpClientStrategy,
      logger,
      hooks: {},
    })
    expect(() => new Param3DHostPos(config, HA, deps(plainMapper, crypt))).toThrow(PosError)
    expect(() => new Param3DHostPos(config, HA, deps(requestMapper, plainCrypt))).toThrow(PosError)
  })

  // addition: test_mode only selects endpoints for this gateway
  it('init on test mode logs a warning', () => {
    const p = createGateway({ ...config, test_mode: true })
    expect(requestMapper.setTestMode).toHaveBeenCalledWith(true)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(p.isTestMode()).toBe(true)
  })

  it('get3DFormData 3d_host', async () => {
    const order: PosOrder = {}
    // deviation: C10 request data is a record (the hook adds a key to it)
    const requestData: Data = { 'request-data': true }
    const answer: Data = { TO_Pre_Encrypting_OOSResponse: { TO_Pre_Encrypting_OOSResult: ENCRYPTED } }
    const formData = { gateway: PAYMENT_API, method: 'GET', inputs: { s: ENCRYPTED } }
    requestMapper.create3DFormInitializeRequestData.mockReturnValue(requestData)
    requestMapper.create3DFormData.mockResolvedValue(formData)
    const verify = configureClientResponse(
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      requestData,
      answer,
      order,
      MODEL.THREE_D_HOST,
    )

    const actual = await pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)

    expect(actual).toBe(formData)
    expect(requestMapper.create3DFormInitializeRequestData).toHaveBeenCalledWith(
      account,
      order,
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_AUTH,
    )
    expect(requestMapper.create3DFormData).toHaveBeenCalledWith(
      account,
      order,
      MODEL.THREE_D_HOST,
      TX_TYPE.PAY_AUTH,
      GATEWAY_3D_HOST,
      null,
      answer,
    )
    verify()
  })

  it.each([
    [
      'unsupported_payment_model',
      MODEL.THREE_D_SECURE,
      true,
      // deviation: C8 English message of the shared 3D form input check
      new UnsupportedTransactionTypeError(
        'Param3DHostPos supports [3d_host] payment model(s) for transaction type [pay]. Provided payment model: [3d].',
      ),
      null,
    ],
    [
      'unsupported_form_format',
      MODEL.THREE_D_HOST,
      false,
      new UnsupportedFormFormatError('Unsupported 3D form format!'),
      FORM_FORMAT.HTML,
    ],
  ] as Array<[string, PaymentModel, boolean, Error, FormFormat | null]>)(
    'get3DFormData with bad inputs %s',
    async (_name, paymentModel, withCard, error, formFormat) => {
      const order: PosOrder = { id: '2020110828BC' }
      const err = await pos
        .get3DFormData(order, paymentModel, TX_TYPE.PAY_AUTH, withCard ? card() : null, false, formFormat)
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(error.constructor)
      expect((err as Error).message).toBe(error.message)
      expectNoRequest()
    },
  )

  it('make3DPayment', async () => {
    // deviation: C8 through payment() the supported transactions table answers first
    await expect(pos.payment(MODEL.THREE_D_SECURE, {}, TX_TYPE.PAY_AUTH, null, cb({ a: 'abc' }))).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    // addition: H5 called directly
    await expect(pos.make3DPayment(cb({ a: 'abc' }), {}, TX_TYPE.PAY_AUTH)).rejects.toThrow(
      new UnsupportedPaymentModelError('Use ParamPos for this payment model'),
    )
  })

  it('make3DPayPayment', async () => {
    // deviation: C8 through payment() the supported transactions table answers first
    await expect(pos.payment(MODEL.THREE_D_PAY, {}, TX_TYPE.PAY_AUTH, null, cb({ a: 'abc' }))).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    // addition: H5 called directly
    await expect(pos.make3DPayPayment(cb({ a: 'abc' }), {}, TX_TYPE.PAY_AUTH)).rejects.toThrow(
      new UnsupportedPaymentModelError('Use ParamPos for this payment model'),
    )
  })

  it('make3DHostPayment hash mismatch exception', async () => {
    // deviation: P8/H3 the callback must have the payment result shape (a hash field) and the order is validated
    // before the hash check, so both carry the minimum
    const callback: Data = {
      TURKPOS_RETVAL_Islem_GUID: '77f11031-cce8-4131-bf95-142303732608',
      TURKPOS_RETVAL_SanalPOS_Islem_ID: '6021847062',
      TURKPOS_RETVAL_Hash: 'LOpkL9J8vne8E2j0A0HKOhUWGhI=',
    }
    crypt.check3DHash.mockReturnValue(false)

    await expect(
      pos.payment(MODEL.THREE_D_HOST, { id: '123', amount: 10.01 }, TX_TYPE.PAY_AUTH, null, cb(callback)),
    ).rejects.toThrow(new HashMismatchError('3D callback hash mismatch'))
    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
    expect(crypt.check3DHash).toHaveBeenCalledWith(account, callback)
    expect(responseMapper.map3DHostResponseData).not.toHaveBeenCalled()
    expectNoRequest()
  })

  // deviation: H4 the reference returns the mapped callback; here the CP1-completed callback is confirmed with one
  // status request whose record holds the transaction id recomputed for the order
  const approvedHostPayment = async (p: Param3DHostPos) => {
    const callback: Data = {
      ...CP1,
      TURKPOS_RETVAL_Hash: 'LOpkL9J8vne8E2j0A0HKOhUWGhI=',
      TURKPOS_RETVAL_Islem_GUID: '77f11031-cce8-4131-bf95-142303732608',
      TURKPOS_RETVAL_SanalPOS_Islem_ID: '6021847062',
    }
    const order: PosOrder = { id: '123', amount: 10.01, currency: CURRENCY.TRY, installment: 0 }
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.map3DHostResponseData.mockReturnValue({ status: 'approved' })
    responseMapper.mapStatusResponse.mockReturnValue({ status: 'approved' })
    const confirmation: Data = { 'confirmation-request': true }
    requestMapper.createConfirmationRequestData.mockReturnValue(confirmation)
    const answer = statusAnswer(bankRecord({ Islem_ID: hostId('123', 1001) }))
    const verify = configureClientResponse(
      TX_TYPE.STATUS,
      confirmation,
      answer,
      // review fix: the hook and the client see the merchant's order, not the bank's order id
      order,
      MODEL.THREE_D_HOST,
    )

    const result = await p.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, cb(callback))

    expect(result.status).toBe('approved')
    expect(result.order_id).toBe('123')
    expect(crypt.check3DHash).toHaveBeenCalledWith(account, callback)
    expect(responseMapper.map3DHostResponseData).toHaveBeenCalledWith(callback, TX_TYPE.PAY_AUTH, order)
    expect(requestMapper.createConfirmationRequestData).toHaveBeenCalledWith(account, '20250119BACB')
    expect(crypt.create3DHostTransactionId).toHaveBeenCalledWith(account, '123', 1001, '1000')
    verify()
  }

  it('make3DHostPayment', async () => {
    await approvedHostPayment(pos)
  })

  it('make3DHostPayment without hash check', async () => {
    // deviation: P9 disable_3d_hash_check is ignored: the hash is checked
    const p = createGateway({ ...config, disable_3d_hash_check: true } as GatewayConfig)
    await approvedHostPayment(p)
    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
  })

  it('makeRegularPayment', async () => {
    // deviation: C8 through payment() the supported transactions table answers first
    await expect(pos.payment(MODEL.NON_SECURE, {}, TX_TYPE.PAY_AUTH, card(), cb({ a: 'abc' }))).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    // addition: H5 called directly
    await expect(pos.makeRegularPayment({}, card(), TX_TYPE.PAY_AUTH)).rejects.toThrow(
      new UnsupportedPaymentModelError('Use ParamPos for this payment model'),
    )
    expectNoRequest()
  })

  it('makeRegularPostAuthPayment', async () => {
    await expect(pos.payment(MODEL.NON_SECURE, {}, TX_TYPE.PAY_POST_AUTH)).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    // addition: H5 called directly
    await expect(pos.makeRegularPostPayment({})).rejects.toThrow(
      new UnsupportedTransactionTypeError('Use ParamPos for this transaction'),
    )
  })

  it.each([
    ['status', () => pos.status({})],
    ['cancel', () => pos.cancel({})],
    ['refund', () => pos.refund({})],
    ['orderHistory', () => pos.orderHistory({})],
  ] as Array<[string, () => Promise<unknown>]>)('%s request', async (_name, call) => {
    // deviation: C8 English message
    await expect(call()).rejects.toThrow(new UnsupportedTransactionTypeError('Use ParamPos for this transaction'))
    expectNoRequest()
  })

  // addition: H3 only a sale is completed here
  it('a hosted callback for a pre-authorization is refused before anything is read', async () => {
    await expect(pos.make3DHostPayment(cb(CP1), ORDER, TX_TYPE.PAY_PRE_AUTH)).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
    expect(crypt.check3DHash).not.toHaveBeenCalled()
    expectNoRequest()
  })

  // addition: P14 a decline whose mapping reads approved is refused
  it('a decline mapped as approved is refused', async () => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.map3DHostResponseData.mockReturnValue({ status: 'approved' })
    await expect(pos.payment(MODEL.THREE_D_HOST, ORDER, TX_TYPE.PAY_AUTH, null, cb(CP3))).rejects.toThrow(
      new PosError('3D callback without approval was mapped as approved'),
    )
    expectNoRequest()
  })

  // addition: an approval the mapping reads as declined is refused before the confirmation
  it('an approval mapped as declined is refused before any request', async () => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.map3DHostResponseData.mockReturnValue({ status: 'declined' })
    await expect(pos.payment(MODEL.THREE_D_HOST, ORDER, TX_TYPE.PAY_AUTH, null, cb(CP1))).rejects.toThrow(
      new PosError('3D callback approval was not mapped as approved'),
    )
    expectNoRequest()
  })
})

// =====================================================================================================================
// End to end: real crypt, mappers and HTTP clients over a fake fetch
// =====================================================================================================================

const esc = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** An element: text, nested records, lists repeat the element. */
function element(name: string, value: unknown): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.map((v) => element(name, v)).join('')
  if (typeof value === 'object') {
    const children = Object.entries(value as Data)
      .map(([k, v]) => element(k, v))
      .join('')
    return `<${name}>${children}</${name}>`
  }
  return `<${name}>${esc(String(value))}</${name}>`
}

/** A TurkPos answer: `<op>Response.<op>Result` holding the record. */
const soapAnswer = (op: string, result: Data | null): string =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soap:Body><${op}Response xmlns="https://turkpos.com.tr/">${
    result === null ? '' : element(`${op}Result`, result)
  }</${op}Response></soap:Body></soap:Envelope>`

const soapFault = (text: string): string =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>${esc(text)}</faultstring></soap:Fault></soap:Body></soap:Envelope>`

/** The bank's registration answer (fixture), its header echoing this account's credentials. */
const HOST_FORM_ANSWER = readFileSync(
  new URL('../test_data/parampos/3d_host_form_response_success.xml', import.meta.url),
  'utf8',
)
  .replace('<CLIENT_USERNAME>Test</CLIENT_USERNAME>', `<CLIENT_USERNAME>${USERNAME}</CLIENT_USERNAME>`)
  .replace('<CLIENT_PASSWORD>Test</CLIENT_PASSWORD>', `<CLIENT_PASSWORD>${PASSWORD}</CLIENT_PASSWORD>`)
const HOST_FORM_RESULT = /<TO_Pre_Encrypting_OOSResult>([^<]+)</.exec(HOST_FORM_ANSWER)?.[1] ?? ''

type Sent = { url: string; op: string; body: Data; text: string }
type Reply = string | Response | undefined
type BankOptions = {
  /** Replaces the answer of an operation (undefined keeps the default). */
  answer?: Partial<Record<string, (body: Data) => Reply>>
  /** Status records by the bank's order id (default: the CP1 record registered for `ORDER`). */
  records?: Record<string, unknown>
}

const DEFAULT_RECORDS: Record<string, unknown> = { '20250119BACB': bankRecord() }

/** The operation each endpoint takes; anything else is a test failure. */
const ENDPOINT_OF: Record<string, string> = {
  TO_Pre_Encrypting_OOS: PAYMENT_API,
  TP_Islem_Sorgulama4: QUERY_API,
}

function defaultAnswer(op: string, body: Data, records: Record<string, unknown>): Reply {
  switch (op) {
    case 'TO_Pre_Encrypting_OOS':
      return HOST_FORM_ANSWER
    case 'TP_Islem_Sorgulama4': {
      const record = records[String(body.Siparis_ID)]
      return soapAnswer(
        op,
        record === undefined
          ? { Sonuc: '-1', Sonuc_Str: 'İşlem bulunamadı' }
          : { DT_Bilgi: record, Sonuc: '1', Sonuc_Str: 'Başarılı' },
      )
    }
    default:
      return undefined
  }
}

/** A fetch that records each request and answers like the bank; another endpoint or operation fails. */
function bankFetch(options: BankOptions = {}) {
  const sent: Sent[] = []
  const records = options.records ?? DEFAULT_RECORDS
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    const text = String(init?.body ?? '')
    const decoded = ParamPosXmlDecoder.decode(text)
    const op = Object.keys(decoded)[0] ?? ''
    const body = (decoded[op] ?? {}) as Data
    sent.push({ url: u, op, body, text })
    if (ENDPOINT_OF[op] !== u) throw new Error(`unexpected request ${op} to ${u}`)
    const reply = options.answer?.[op]?.(body) ?? defaultAnswer(op, body, records)
    if (reply === undefined) throw new Error(`unexpected operation ${op}`)
    if (reply instanceof Response) return reply
    return new Response(reply, { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } })
  }) as unknown as typeof fetch

  return { sent, fetchImpl }
}

function realGateway(
  fetchImpl: typeof fetch,
  options: { cfg?: GatewayConfig; account?: ParamPosAccount; logger?: PosLogger; hooks?: PosHooks } = {},
) {
  const log = options.logger ?? silent
  const cfg = options.cfg ?? config
  const cryptImpl = new ParamPosCrypt(log)
  const valueMapper = new ParamPosRequestValueMapper()
  const valueFormatter = new ParamPosRequestValueFormatter()
  const hooks = options.hooks ?? {}
  const deps: GatewayDeps<ParamPosAccount> = {
    requestValueMapper: valueMapper,
    requestValueFormatter: valueFormatter,
    requestDataMapper: new Param3DHostPosRequestDataMapper(valueMapper, valueFormatter, hooks, cryptImpl, LANG.TR),
    responseDataMapper: new ParamPosResponseDataMapper(
      new ParamPosResponseValueFormatter(),
      new ParamPosResponseValueMapper(),
      log,
    ),
    crypt: cryptImpl,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(
      Param3DHostPos.GATEWAY_CLASS,
      cfg,
      new HttpTransport({ fetch: fetchImpl }),
      log,
    ),
    logger: log,
    hooks,
  }

  return new Param3DHostPos(cfg, options.account ?? HA, deps)
}

const mismatch = async (promise: Promise<unknown>): Promise<OrderMismatchError> => {
  const err = await promise.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(OrderMismatchError)
  return err as OrderMismatchError
}

const UNKNOWN_STATUS = 'Bank status answer could not be read; the payment outcome is unknown'
const NO_HASH = new HashMismatchError('3D callback has no hash')
const MALFORMED = new HashMismatchError('3D callback fields are malformed')

/** Status answers that do not say whether the payment exists. */
const UNREADABLE_STATUS: Array<[string, () => Reply]> = [
  ['no content (204)', () => new Response(null, { status: 204 })],
  ['an empty response', () => soapAnswer('TP_Islem_Sorgulama4', null)],
  ['no result code', () => soapAnswer('TP_Islem_Sorgulama4', { DT_Bilgi: bankRecord(), Sonuc_Str: 'x' })],
  ['a text result code', () => soapAnswer('TP_Islem_Sorgulama4', { DT_Bilgi: bankRecord(), Sonuc: 'x' })],
  ['a success code without record', () => soapAnswer('TP_Islem_Sorgulama4', { Sonuc: '1', Sonuc_Str: 'Başarılı' })],
]

const formOrder = (over: PosOrder = {}): PosOrder => ({
  id: 'order222',
  amount: 1000.25,
  currency: CURRENCY.TRY,
  installment: 0,
  success_url: 'https://domain.com/success',
  ...over,
})

describe('Param3DHostPos (end to end) 3D form', () => {
  // addition: H1/H2 the registration goes to payment_api with the SOAP header; the form is a GET to gateway_3d_host
  it('posts TO_Pre_Encrypting_OOS to payment_api and returns the GET form of the hosted page', async () => {
    const { sent, fetchImpl } = bankFetch()
    const form = await realGateway(fetchImpl).get3DFormData(formOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)

    expect(form).toStrictEqual({ gateway: GATEWAY_3D_HOST, method: 'GET', inputs: { s: HOST_FORM_RESULT } })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(PAYMENT_API)
    expect(sent[0]?.op).toBe('TO_Pre_Encrypting_OOS')
    expect(sent[0]?.text).toContain('<soap:Header><ServiceSecuritySoapHeader xmlns="https://turkodeme.com.tr/">')
    expect(sent[0]?.text).toContain(`<CLIENT_PASSWORD>${PASSWORD}</CLIENT_PASSWORD>`)
    // HI1: the transaction id of order222 / 1000.25 / TRY
    expect(sent[0]?.body.Islem_ID).toBe('10EA8B9F7B2728D8F4BF034F')
    expect(sent[0]?.body.Terminal_ID).toBe('99001')
    expect(sent[0]?.text).not.toContain('order222')
    // the answer's header echoes the password; nothing of it is returned
    expect(JSON.stringify(form)).not.toContain(PASSWORD)
  })

  // addition: H1 a missing terminal id fails before any request
  it('an account without a terminal id is refused before any request', async () => {
    const { sent, fetchImpl } = bankFetch()
    const noTerminal = AccountFactory.createParamPosAccount('param-3d-host-pos', '10738', USERNAME, PASSWORD, G)
    await expect(
      realGateway(fetchImpl, { account: noTerminal }).get3DFormData(formOrder(), MODEL.THREE_D_HOST, 'pay'),
    ).rejects.toThrow(MissingAccountInfoError)
    expect(sent).toHaveLength(0)
  })

  // addition: H1 order values are validated before any request
  it.each([
    ['amount 0', { amount: 0 }],
    ['amount -1', { amount: -1 }],
    ['amount abc', { amount: 'abc' }],
    ['amount 1e13', { amount: 1e13 }],
    ['no amount', { amount: undefined }],
    ['a bad order id', { id: 'a b' }],
    ['an unknown currency', { currency: 'XYZ' }],
    ['a bad installment', { installment: 'x' }],
    ['no success_url', { success_url: undefined }],
  ] as Array<[string, PosOrder]>)('a form order with %s is refused before any request', async (_n, over) => {
    const { sent, fetchImpl } = bankFetch()
    await expect(
      realGateway(fetchImpl).get3DFormData(formOrder(over), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH),
    ).rejects.toThrow(PosError)
    expect(sent).toHaveLength(0)
  })

  // addition: H2 a refused registration shows the masked bank text
  it('a refused registration shows the masked bank text', async () => {
    const { fetchImpl } = bankFetch({
      answer: {
        TO_Pre_Encrypting_OOS: () =>
          `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><TO_Pre_Encrypting_OOSResponse xmlns="https://turkodeme.com.tr/"><TO_Pre_Encrypting_OOSResult>SOAP Güvenlik Hatası. ${PASSWORD}</TO_Pre_Encrypting_OOSResult></TO_Pre_Encrypting_OOSResponse></soap:Body></soap:Envelope>`,
      },
    })
    const err = await realGateway(fetchImpl)
      .get3DFormData(formOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosError)
    expect((err as Error).message).toBe('3D form could not be created: SOAP Güvenlik Hatası. ***')
  })
})

describe('Param3DHostPos (end to end) callbacks', () => {
  const run = (callback: Data, order: PosOrder = ORDER, options: BankOptions = {}, cfg: GatewayConfig = config) => {
    const { sent, fetchImpl } = bankFetch(options)
    const promise = realGateway(fetchImpl, { cfg }).payment(MODEL.THREE_D_HOST, order, 'pay', null, cb(callback))
    return { sent, promise }
  }

  // addition: H4 the approval is confirmed with exactly one status request to query_api bound to the order
  it('CP1 for the order it was registered for is approved after one status request to query_api', async () => {
    const { sent, promise } = run(CP1)
    const res = (await promise) as Data

    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe(QUERY_API)
    expect(sent[0]?.op).toBe('TP_Islem_Sorgulama4')
    expect(sent[0]?.text).toContain('<Siparis_ID>20250119BACB</Siparis_ID>')
    expect(res).toMatchObject({
      status: 'approved',
      // the order's id, not the bank-assigned one of the callback
      order_id: 'order222',
      amount: 10.01,
      currency: 'TRY',
      payment_model: '3d_host',
      transaction_type: 'pay',
      proc_return_code: '1',
      error_code: null,
      md_status: null,
      auth_code: '222905',
      ref_ret_num: '501917472738',
      transaction_id: '25019RcIG10421',
      masked_number: '581877******2285',
      installment_count: 0,
    })
    expect(res.transaction_time).toStrictEqual(new Date('2025-01-19T17:29:32+03:00'))
    expect(res).not.toHaveProperty('requires_manual_review')
    expect((res.all as Data).TURKPOS_RETVAL_GUID).toBe('***')
    expect(JSON.stringify(res)).not.toContain(G)
  })

  // addition: H4 the binding: a record registered for another order never confirms this order and raises no alert
  // (review fix: the record is evidence only when its transaction id is this order's)
  it('a record registered for another order id is an order_id mismatch without alert', async () => {
    const { sent, promise } = run(CP1, { ...ORDER, id: 'order223' })
    const err = await mismatch(promise)
    expect(err.field).toBe('order_id')
    expect(err.paymentMayHaveCompleted).toBe(false)
    expect(err.response).toBeUndefined()
    expect(sent).toHaveLength(1)
  })

  // addition: review fix, a record of this order registered at another amount or currency is flagged with the
  // precise field: the bank shows a payment of this order that does not match it
  it.each([
    ['another amount', { ...ORDER, amount: 10.02 }, 'amount', '1002', '10.01'],
    ['another currency', { ...ORDER, currency: CURRENCY.USD }, 'currency', 'USD', 'TRY'],
  ] as Array<[string, PosOrder, string, string, string]>)(
    'a record of this order registered for %s is flagged',
    async (_n, order, field, wanted, actual) => {
      const { sent, promise } = run(CP1, order)
      const err = await mismatch(promise)
      expect(err.field).toBe(field)
      expect(err.expected).toBe(wanted)
      expect(err.actual).toBe(actual)
      expect(err.paymentMayHaveCompleted).toBe(true)
      expect(err.response?.requires_manual_review).toBe(true)
      expect(err.response?.order_id).toBe(order.id)
      expect(JSON.stringify(err.response)).not.toContain(G)
      expect(sent).toHaveLength(1)
    },
  )

  // addition: review fix (PoC), the genuine payment of this order at an older amount is flagged as an amount mismatch
  it('the genuine payment of this order at an older amount is flagged', async () => {
    const older = bankRecord({ Islem_ID: hostId('order222', 500), Toplam_Tutar: '5.00' })
    const err = await mismatch(run(CP1, ORDER, { records: { '20250119BACB': older } }).promise)
    expect(err.field).toBe('amount')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
    expect(err.response?.order_id).toBe('order222')
  })

  // addition: review fix, a record amount that cannot be read is no evidence (and never reaches the derivation)
  it.each([['0.00'], ['0'], ['abc'], ['-1.00'], ['1.001']])(
    'a record of this order with the amount %j raises no alert',
    async (amount) => {
      const err = await mismatch(
        run(CP1, ORDER, { records: { '20250119BACB': bankRecord({ Toplam_Tutar: amount }) } }).promise,
      )
      expect(err.field).toBe('amount')
      expect(err.paymentMayHaveCompleted).toBe(false)
      expect(err.response).toBeUndefined()
    },
  )

  // addition: H4 a record without the transaction id never confirms
  it.each([
    ['no Islem_ID', { Islem_ID: undefined }],
    ['the callback Islem_ID', { Islem_ID: CP1.TURKPOS_RETVAL_Islem_ID }],
    ['a lower-case id', { Islem_ID: ORDER_ID_HOST.toLowerCase() }],
  ] as Array<[string, Data]>)('a record with %s is an order_id mismatch', async (_n, over) => {
    const err = await mismatch(run(CP1, ORDER, { records: { '20250119BACB': bankRecord(over) } }).promise)
    expect(err.field).toBe('order_id')
    expect(err.paymentMayHaveCompleted).toBe(false)
    expect(err.response).toBeUndefined()
  })

  // addition: Review Focus forgeable callbacks, the record decides; evidence decides the flag
  it.each([
    // review fix: a record amount the transaction id was not derived from is no evidence of this order's payment
    ['Toplam_Tutar 1.01', { Toplam_Tutar: '1.01' }, 'amount', false],
    ['Dekont_ID 1', { Dekont_ID: '1' }, 'transaction_id', true],
    ['Toplam_Iade_Tutar 5.00', { Toplam_Iade_Tutar: '5.00' }, 'order_status', true],
    ['PRE_AUTH', { Islem_Tip: 'PRE_AUTH' }, 'transaction_type', true],
    ['Taksit 3', { Taksit: '3' }, 'installment', true],
    ['Durum FAIL', { Durum: 'FAIL' }, 'order_status', false],
    ['Odeme_Sonuc 0', { Odeme_Sonuc: '0' }, 'order_status', false],
    ['Dekont_ID 0', { Dekont_ID: '0' }, 'transaction_id', false],
  ] as Array<[string, Data, string, boolean]>)('a record with %s', async (_n, over, field, evidence) => {
    const { sent, promise } = run(CP1, ORDER, { records: { '20250119BACB': bankRecord(over) } })
    const err = await mismatch(promise)
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(evidence)
    if (evidence) {
      expect(err.response?.requires_manual_review).toBe(true)
      expect(err.response?.status).toBe('approved')
      expect(err.response?.order_id).toBe('order222')
      expect(JSON.stringify(err.response)).not.toContain(G)
    } else {
      expect(err.response).toBeUndefined()
    }
    expect(sent).toHaveLength(1)
  })

  it.each([
    ['no record', {}],
    ['a list of records', { '20250119BACB': [bankRecord(), bankRecord()] }],
    ['a record of another bank order id', { '20250119BACB': bankRecord({ Siparis_ID: '20250119BACC' }) }],
  ] as Array<[string, Record<string, unknown>]>)('%s raises no alert', async (_n, records) => {
    const err = await mismatch(run(CP1, ORDER, { records }).promise)
    expect(err.paymentMayHaveCompleted).toBe(false)
    expect(err.response).toBeUndefined()
  })

  // addition: Task 6 ruling, a status answer that cannot be read after a reported approval is an unknown outcome
  it.each(UNREADABLE_STATUS)('a status answer with %s is an unknown outcome', async (_n, reply) => {
    const { sent, promise } = run(CP1, ORDER, { answer: { TP_Islem_Sorgulama4: reply } })
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).message).toBe(UNKNOWN_STATUS)
    expect((err as PosHttpError).url).toBe(QUERY_API)
    expect(sent).toHaveLength(1)
  })

  it('a fault of the status request propagates', async () => {
    const { sent, promise } = run(CP1, ORDER, {
      answer: { TP_Islem_Sorgulama4: () => new Response(soapFault(`boom ${PASSWORD}`), { status: 500 }) },
    })
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as Error).message).not.toContain(PASSWORD)
    expect(sent).toHaveLength(1)
  })

  // addition: forged callbacks signed with the echoed GUID are never approved without the matching record
  it.each([
    ['a bank order id without record', { TURKPOS_RETVAL_Siparis_ID: 'FORGED1' }, false],
    ['another receipt', { TURKPOS_RETVAL_Dekont_ID: '3007300696' }, true],
  ] as Array<[string, Data, boolean]>)('a forged approval with %s is never approved', async (_n, over, evidence) => {
    const forged = signedTp({ ...CP1, ...over })
    const err = await mismatch(run(forged).promise)
    expect(err.paymentMayHaveCompleted).toBe(evidence)
    if (!evidence) expect(err.response).toBeUndefined()
  })

  // addition: the callback's amount proves nothing: a forged amount on the genuine payment's callback changes nothing,
  // the result carries the order's amount the record confirmed
  it('a forged amount on the callback of the genuine payment is ignored', async () => {
    const res = (await run(signedTp({ ...CP1, TURKPOS_RETVAL_Tahsilat_Tutari: '1,00' })).promise) as Data
    expect(res).toMatchObject({ status: 'approved', amount: 10.01, order_id: 'order222' })
    expect(JSON.stringify(res.amount)).not.toContain('1,00')
  })

  // addition: forged callback for any order: a genuine payment record of another order never confirms this one
  // (review fix PoC: and raises no alert for it)
  it.each([
    ['the same amount', 10.01],
    ['another amount', 999.99],
  ])(
    'a forged approval for B (%s) naming the genuine payment of A is never approved or flagged',
    async (_n, amount) => {
      // the record of order222 / 10.01 is real; the forger completes order999 with it
      const err = await mismatch(run(CP1, { ...ORDER, id: 'order999', amount }).promise)
      expect(err.field).toBe('order_id')
      expect(err.paymentMayHaveCompleted).toBe(false)
      expect(err.response).toBeUndefined()
      // review fix: the message names the derived value, not its hex digits
      expect(err.expected).toBe('the transaction id of this order')
      expect(err.message).not.toContain(hostId('order999', Math.round(amount * 100)))
    },
  )

  // addition: re-splits are closed by the record binding
  it('the CP1 dekont/amount re-split is never approved', async () => {
    const resplit = { ...CP1, TURKPOS_RETVAL_Dekont_ID: '300730069', TURKPOS_RETVAL_Tahsilat_Tutari: '510,01' }
    expect(TPH(resplit)).toBe(CP1.TURKPOS_RETVAL_Hash)
    const err = await mismatch(run(resplit).promise)
    expect(err.field).toBe('transaction_id')
  })

  // addition: C5 the echoed GUID is never read: a callback echoing another GUID but signed with the account's verifies
  it('a callback echoing another GUID verifies with the account GUID and never returns either', async () => {
    const other = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const res = (await run({ ...CP1, TURKPOS_RETVAL_GUID: other }).promise) as Data
    expect(res.status).toBe('approved')
    expect(JSON.stringify(res)).not.toContain(other)
    expect(JSON.stringify(res)).not.toContain(G)
    const { sent, promise } = run({ ...CP1, TURKPOS_RETVAL_GUID: other, TURKPOS_RETVAL_Hash: TPH(CP1, other) })
    await expect(promise).rejects.toThrow(new HashMismatchError('3D callback hash mismatch'))
    expect(sent).toHaveLength(0)
  })

  // addition: P9 a tampered signed callback, an unsigned approval
  it('a tampered signed approval is a hash mismatch without any request', async () => {
    const { sent, promise } = run({ ...CP1, TURKPOS_RETVAL_Tahsilat_Tutari: '1,01' })
    await expect(promise).rejects.toThrow(new HashMismatchError('3D callback hash mismatch'))
    expect(sent).toHaveLength(0)
  })

  it.each([
    ['result code 1', { TURKPOS_RETVAL_Sonuc: '1' }],
    ['a padded result code', { TURKPOS_RETVAL_Sonuc: ' 1' }],
    ['only a receipt', { TURKPOS_RETVAL_Sonuc: '-1', TURKPOS_RETVAL_Dekont_ID: '3007300695' }],
  ] as Array<[string, Data]>)('an unsigned approval with %s is refused without any request', async (_n, over) => {
    const { TURKPOS_RETVAL_Hash: _h, ...unsigned } = { ...CP1, ...over }
    const { sent, promise } = run(unsigned)
    await expect(promise).rejects.toThrow(NO_HASH)
    expect(sent).toHaveLength(0)
  })

  // addition: P10 malformed signed approvals
  it.each([
    ['a padded result code', { TURKPOS_RETVAL_Sonuc: ' 1' }],
    ['a receipt with a leading zero', { TURKPOS_RETVAL_Dekont_ID: '03007300695' }],
    ['a negative code with a receipt', { TURKPOS_RETVAL_Sonuc: '-1' }],
    ['a dotted amount', { TURKPOS_RETVAL_Tahsilat_Tutari: '10.01' }],
    ['a bank order id with a space', { TURKPOS_RETVAL_Siparis_ID: '2025 0119' }],
    ['a lower-case transaction id', { TURKPOS_RETVAL_Islem_ID: '1944a39ad0aea92e173d665b' }],
  ] as Array<[string, Data]>)('a signed approval with %s is malformed', async (_n, over) => {
    const { sent, promise } = run(signedTp({ ...CP1, ...over }))
    await expect(promise).rejects.toThrow(MALFORMED)
    expect(sent).toHaveLength(0)
  })

  // addition: P14 declines carry trusted data only
  it('CP3 is a trusted decline for the order', async () => {
    const { sent, promise } = run(CP3, { id: 'MINE-1', amount: 1 })
    const res = (await promise) as Data
    expect(sent).toHaveLength(0)
    expect(res).toMatchObject({
      status: 'declined',
      order_id: 'MINE-1',
      payment_model: '3d_host',
      transaction_type: 'pay',
      proc_return_code: '-1',
      error_code: '-1',
      amount: null,
      currency: null,
      transaction_time: null,
      md_status: null,
    })
    expect(res.masked_number ?? null).toBeNull()
    expect(String(res.error_message).length).toBeLessThanOrEqual(256)
    expect(res).not.toHaveProperty('requires_manual_review')
    expect(res).not.toHaveProperty('3d_all')
    expect((res.all as Data).TURKPOS_RETVAL_GUID).toBe('***')
    expect(JSON.stringify(res)).not.toContain(G)
  })

  it('an unsigned decline is a trusted decline; require_3d_hash refuses it', async () => {
    const { TURKPOS_RETVAL_Hash: _h, ...unsigned }: Data = { ...CP3, TURKPOS_RETVAL_Sonuc_Str: 'x'.repeat(400) }
    const res = (await run(unsigned, { id: 'MINE-2', amount: 1 }).promise) as Data
    expect(res).toMatchObject({ status: 'declined', order_id: 'MINE-2', amount: null, payment_model: '3d_host' })
    expect(res.error_message).toBe('x'.repeat(256))
    const strict = { ...config, require_3d_hash: true }
    const { sent, promise } = run(unsigned, { id: 'MINE-2', amount: 1 }, {}, strict)
    await expect(promise).rejects.toThrow(NO_HASH)
    expect(sent).toHaveLength(0)
  })

  // addition: P8/H3 only flat payment result callbacks
  it.each([
    [
      'a card-check callback',
      { mdStatus: '1', islemHash: 'VW80ENgtqYCWlReB6tyAvqsomb4=' },
      'Unexpected 3D callback for this payment model',
    ],
    ['both shapes', { ...CP1, mdStatus: '1' }, 'Unexpected 3D callback'],
    ['neither shape', { a: 'b' }, 'Unexpected 3D callback'],
    [
      'a nested value',
      { ...CP1, TURKPOS_RETVAL_Sonuc: ['1'] },
      '3D callback field "TURKPOS_RETVAL_Sonuc" must be a string',
    ],
  ] as Array<[string, Data, string]>)('%s is refused before the crypt', async (_n, callback, message) => {
    const { sent, promise } = run(callback)
    await expect(promise).rejects.toThrow(new PosError(message))
    expect(sent).toHaveLength(0)
  })

  // addition: order values are validated before the callback is read
  it.each([
    ['amount 0', { amount: 0 }],
    ['amount 0.004', { amount: 0.004 }],
    ['amount abc', { amount: 'abc' }],
    ['no amount', { amount: undefined }],
    ['a bad order id', { id: 'a b' }],
    ['an unknown currency', { currency: 'XYZ' }],
    ['a currency that is no text', { currency: 1 }],
    ['a bad installment', { installment: -1 }],
  ] as Array<[string, PosOrder]>)('an order with %s is refused before any request', async (_n, over) => {
    const { sent, promise } = run(CP1, { ...ORDER, ...over })
    await expect(promise).rejects.toThrow(PosError)
    expect(sent).toHaveLength(0)
  })

  // addition: H4 the confirmation runs through the hook (tx type status, model 3d_host); an edited request that looks
  // up another payment never confirms this order
  it('the confirmation passes the hook; a hook looking up another payment never confirms the order', async () => {
    const seen: Array<[string, string, unknown]> = []
    const hooks: PosHooks = {
      onRequestDataPrepared: [
        (event) => {
          seen.push([event.txType, event.paymentModel, event.order.id])
          const body = (event.requestData['soap:Body'] as Data).TP_Islem_Sorgulama4 as Data
          body.Siparis_ID = 'OTHER1'
        },
      ],
    }
    const { sent, fetchImpl } = bankFetch({
      records: { '20250119BACB': bankRecord(), OTHER1: bankRecord({ Siparis_ID: 'OTHER1' }) },
    })
    const err = await mismatch(
      realGateway(fetchImpl, { hooks }).payment(MODEL.THREE_D_HOST, ORDER, 'pay', null, cb(CP1)),
    )
    expect(err.field).toBe('order_id')
    // review fix: the hook sees the merchant's order; the bank's order id is only in the request body
    expect(seen).toStrictEqual([['status', '3d_host', 'order222']])
    expect(sent.map((s) => s.body.Siparis_ID)).toStrictEqual(['OTHER1'])
  })

  // addition: stateless, concurrent completions keep their own requests and results
  it('two concurrent completions keep their own status requests and results', async () => {
    const other = signedTp({
      ...CP1,
      TURKPOS_RETVAL_Siparis_ID: '20250119BACD',
      TURKPOS_RETVAL_Dekont_ID: '3007300700',
      TURKPOS_RETVAL_Tahsilat_Tutari: '20,02',
    })
    const { sent, fetchImpl } = bankFetch({
      records: {
        '20250119BACB': bankRecord(),
        '20250119BACD': bankRecord({
          Siparis_ID: '20250119BACD',
          Dekont_ID: '3007300700',
          Toplam_Tutar: '20.02',
          Islem_ID: hostId('order333', 2002),
          Bank_AuthCode: '999999',
        }),
      },
    })
    const p = realGateway(fetchImpl)
    const [a, b] = (await Promise.all([
      p.payment(MODEL.THREE_D_HOST, ORDER, 'pay', null, cb(CP1)),
      p.payment(MODEL.THREE_D_HOST, { ...ORDER, id: 'order333', amount: 20.02 }, 'pay', null, cb(other)),
    ])) as Data[]
    expect(sent).toHaveLength(2)
    expect(a).toMatchObject({ status: 'approved', order_id: 'order222', auth_code: '222905' })
    expect(b).toMatchObject({ status: 'approved', order_id: 'order333', auth_code: '999999', amount: 20.02 })
  })
})

describe('Param3DHostPos (end to end) masking', () => {
  const recorder = () => {
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
    return { records, logger }
  }

  // addition: C6/P20 nothing secret reaches the logger, and no returned value holds the GUID
  it('never logs the password, the GUID or a callback hash; no result holds the GUID', async () => {
    const { records, logger } = recorder()
    const hooks: PosHooks = {
      onRequestDataPrepared: [
        (event) => {
          event.requestData.changed = 'yes'
        },
      ],
    }
    const { sent, fetchImpl } = bankFetch({
      records: { '20250119BACB': bankRecord(), FAULT1: bankRecord() },
      answer: {
        TP_Islem_Sorgulama4: (body) =>
          body.Siparis_ID === 'FAULT1' ? soapFault(`Server error ${G} ${PASSWORD}`) : undefined,
      },
    })
    const p = realGateway(fetchImpl, { logger, hooks })
    const tampered = { ...CP1, TURKPOS_RETVAL_Tahsilat_Tutari: '1,01' }
    const faulty = signedTp({ ...CP1, TURKPOS_RETVAL_Siparis_ID: 'FAULT1' })
    const returned: unknown[] = []
    const keep = (value: unknown) => void returned.push(value)

    await p.get3DFormData(formOrder(), MODEL.THREE_D_HOST, 'pay').then(keep)
    await p.payment(MODEL.THREE_D_HOST, ORDER, 'pay', null, cb(CP1)).then(keep)
    await p.payment(MODEL.THREE_D_HOST, ORDER, 'pay', null, cb(tampered)).catch(keep)
    await p.payment(MODEL.THREE_D_HOST, { ...ORDER, id: 'order999' }, 'pay', null, cb(CP1)).catch(keep)
    await p.payment(MODEL.THREE_D_HOST, ORDER, 'pay', null, cb(faulty)).catch(keep)
    await p.payment(MODEL.THREE_D_HOST, ORDER, 'pay', null, cb(CP3)).then(keep)

    expect(sent).toHaveLength(4)
    const logged = JSON.stringify(records)
    expect(records.length).toBeGreaterThan(0)
    expect(logged).not.toContain(PASSWORD)
    expect(logged).not.toContain(G)
    expect(logged).not.toContain(G.slice(0, 8))
    expect(logged).not.toContain(CP1.TURKPOS_RETVAL_Hash)
    expect(logged).not.toContain(CP3.TURKPOS_RETVAL_Hash)
    expect(logged).not.toContain(faulty.TURKPOS_RETVAL_Hash)
    expect(logged).not.toContain(TPH(tampered))

    const errorResponses = returned.map((r) => (r instanceof OrderMismatchError ? r.response : r))
    const shown = JSON.stringify(errorResponses)
    expect(shown).not.toContain(G)
    expect(shown).not.toContain(PASSWORD)
    for (const r of returned) {
      if (r instanceof Error) {
        expect(r.message).not.toContain(G)
        expect(r.message).not.toContain(PASSWORD)
      }
    }
  })
})
