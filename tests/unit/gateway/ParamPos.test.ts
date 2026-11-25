import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import type { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { ParamPosCrypt } from '../../../src/crypt/ParamPosCrypt.js'
import { ParamPosRequestDataMapper } from '../../../src/data-mapper/request/mapper/ParamPosRequestDataMapper.js'
import type { RequestDataMapperInterface } from '../../../src/data-mapper/request/mapper/RequestDataMapperInterface.js'
import { ParamPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/ParamPosRequestValueFormatter.js'
import { ParamPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/ParamPosRequestValueMapper.js'
import { ParamPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/ParamPosResponseDataMapper.js'
import type { ResponseDataMapperInterface } from '../../../src/data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { ParamPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/ParamPosResponseValueFormatter.js'
import { ParamPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/ParamPosResponseValueMapper.js'
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
import { ParamPos } from '../../../src/gateway/ParamPos.js'
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
import {
  provisionSuccess,
  threeDCases,
  threeDPayCases,
} from '../data-mapper/response/mapper/ParamPosResponseDataMapper.data.js'

// The first section replaces the collaborators with vi.fn() fakes (except the request value mapper); the end-to-end
// sections use the real crypt, mappers and HTTP client over a fake fetch that answers by SOAP operation (the first
// element of the SOAP body) and records every request.

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

const PAYMENT_API = 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx'

// deviation: the reference test config has no endpoint
const config: GatewayConfig = {
  name: 'param-pos',
  class: 'ParamPos',
  gateway_endpoints: { payment_api: PAYMENT_API },
}

const G = '0c13d406-873b-403b-9c09-a5766840d98c'
const PASSWORD = 'Test2'
/** The account of the ported cases. */
const ACCOUNT = AccountFactory.createParamPosAccount('param-pos', '10738', 'Test', 'Test', G)
/** The planning account `PA`: the password differs from the user name, so a leak of either is visible. */
const PA = AccountFactory.createParamPosAccount('param-pos', '10738', 'Test1', PASSWORD, G)

const S1 = (text: string): string => createHash('sha1').update(text, 'utf8').digest('base64')
/** The signature of a 3D Secure card-check callback. */
const MDH = (c: Data, guid = G): string =>
  S1(`${c.islemGUID ?? ''}${c.md ?? ''}${c.mdStatus ?? ''}${c.orderId ?? ''}${guid}`)
/** The signature of a payment result callback. */
const TPH = (c: Data, guid = G): string =>
  S1(
    `10738${guid}${c.TURKPOS_RETVAL_Dekont_ID ?? ''}${c.TURKPOS_RETVAL_Tahsilat_Tutari ?? ''}${c.TURKPOS_RETVAL_Siparis_ID ?? ''}${c.TURKPOS_RETVAL_Islem_ID ?? ''}`,
  )
const signedMd = (c: Data): Data => ({ ...c, islemHash: MDH(c) })
const signedTp = (c: Data): Data => ({ ...c, TURKPOS_RETVAL_Hash: TPH(c) })

const createLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
const silent: PosLogger = { debug() {}, info() {}, warn() {}, error() {} }

const cb = (data: Data): GatewayResponseData => data as GatewayResponseData

// ---------- callbacks (the mapper fixtures) ----------

/** CS2: a signed failed card check (`mdStatus 0`). */
const CS2: Data = threeDCases['3d_auth_fail']?.threeDResponseData as Data
/** CS3: a signed card check whose provision the bank declined. */
const CS3: Data = threeDCases['3d_auth_success_payment_fail']?.threeDResponseData as Data
/** CS5: the `success1` card check, signed with the account GUID (the fixture's own hash does not verify). */
const CS5: Data = {
  ...(threeDCases.success1?.threeDResponseData as Data),
  islemHash: 'VW80ENgtqYCWlReB6tyAvqsomb4=',
}
/** CP1: a signed 3D Pay approval. */
const CP1: Data = threeDPayCases.success1?.paymentData as Data
/** CP3: a signed 3D Pay decline. */
const CP3: Data = threeDPayCases.auth_fail?.paymentData as Data
/** CP4: a signed foreign currency approval. */
const CP4: Data = threeDPayCases.success_foreign_currency?.paymentData as Data
/** RP1: CS5 re-split into an approval of order `2292160` (the signature stays valid). */
const RP1: Data = { ...CS5, md: `${CS5.md}12024`, orderId: '2292160' }

const ORDER_MD: PosOrder = { id: '202412292160', amount: 10.01, currency: CURRENCY.TRY, installment: 0 }
const ORDER_CP1: PosOrder = { id: '20250119BACB', amount: 10.01, currency: CURRENCY.TRY, installment: 0 }
const ORDER_CP4: PosOrder = { id: '202501053F4F', amount: 10.01, currency: CURRENCY.EUR, installment: 0 }

/** A status record of a completed sale (the bank's `DT_Bilgi`). */
const bankRecord = (over: Data = {}): Data => ({
  Odeme_Sonuc: '1',
  Odeme_Sonuc_Aciklama: 'İşlem Başarılı',
  Dekont_ID: '3007300695',
  Siparis_ID: '20250119BACB',
  Islem_ID: '1944A39AD0AEA92E173D665B',
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

const RECORD_MD = bankRecord({
  Siparis_ID: '202412292160',
  Dekont_ID: '3007295376',
  Islem_ID: '665C5908BA1D7583BDF62D3A',
})
const RECORD_CP4 = bankRecord({ Siparis_ID: '202501053F4F', Dekont_ID: '3007296668' })

/** The bank's answer of a declined 3D Secure provision (the mapper fixture `3d_auth_success_payment_fail`). */
const PROVISION_DECLINED: Data = {
  TP_WMD_PayResponse: {
    TP_WMD_PayResult: { Sonuc: '-100', Sonuc_Ack: 'Hesap bulunamadı.', Bank_Sonuc_Kod: '-1', Komisyon_Oran: '0' },
  },
}

const statusAnswer = (dt: unknown, sonuc: unknown = '1'): Data => ({
  TP_Islem_Sorgulama4Response: {
    TP_Islem_Sorgulama4Result: { ...(dt === undefined ? {} : { DT_Bilgi: dt }), Sonuc: sonuc, Sonuc_Str: 'Başarılı' },
  },
})

describe('ParamPos planning vectors', () => {
  // addition: CS2-CS5, CP1, CP3, CP4 and RP1 recomputed with node:crypto and verified by the crypt
  it.each([
    ['CS2', MDH(CS2), 'N1/W7/GcbuT3UVwVM9Q5C/rmoKg='],
    ['CS3', MDH(CS3), 'zrHcS2iMl0J0GPU6DalIdOppDz8='],
    ['CS5', MDH(CS5), 'VW80ENgtqYCWlReB6tyAvqsomb4='],
    ['RP1', MDH(RP1), 'VW80ENgtqYCWlReB6tyAvqsomb4='],
    ['CP1', TPH(CP1), 'LOpkL9J8vne8E2j0A0HKOhUWGhI='],
    ['CP3', TPH(CP3), '+qCEIrH+7ARPmJC55MGQCykg8pk='],
    ['CP4', TPH(CP4), 'LrFgOcE6S8HzNF4tzvtORAh3C20='],
  ])('%s', (_name, actual, expected) => {
    expect(actual).toBe(expected)
  })

  it('the crypt verifies every planning callback with the account GUID', () => {
    const crypt = new ParamPosCrypt(silent)
    for (const c of [CS2, CS3, CS5, RP1, CP1, CP3, CP4]) {
      expect(crypt.check3DHash(PA, cb(c))).toBe(true)
    }
  })
})

describe('ParamPos (mocked collaborators)', () => {
  const account = ACCOUNT
  let requestValueMapper: ParamPosRequestValueMapper
  let requestMapper: Mocked<RequestDataMapperInterface>
  let responseMapper: Mocked<ResponseDataMapperInterface>
  let crypt: Mocked<CryptInterface>
  let httpClient: { supportsTx: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }
  let clientStrategy: { getClient: ReturnType<typeof vi.fn>; getAllClients: ReturnType<typeof vi.fn> }
  let requestDataPrepared: ReturnType<typeof vi.fn<(e: RequestDataPreparedEvent) => void>>
  let logger: ReturnType<typeof createLogger>
  let pos: ParamPos

  const createGateway = (cfg: GatewayConfig = config, acc: ParamPosAccount = account): ParamPos => {
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
    return new ParamPos(cfg, acc, deps)
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
    CreditCardFactory.createForGateway(pos, '5555444433332222', '21', '12', '122', 'ahmet', CARD_TYPE.VISA)

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
      expect(event.gatewayClass).toBe('ParamPos')
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
    expect(requestMapper.createStatusRequestData).not.toHaveBeenCalled()
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
    expect(ParamPos.NAME).toBe('ParamPos')
    expect(ParamPos.GATEWAY_CLASS).toBe('ParamPos')
    for (const model of [MODEL.THREE_D_SECURE, MODEL.THREE_D_PAY, MODEL.NON_SECURE]) {
      expect(ParamPos.isSupportedTransaction(TX_TYPE.PAY_AUTH, model)).toBe(true)
    }
    for (const model of [MODEL.THREE_D_HOST, MODEL.THREE_D_PAY_HOSTING]) {
      expect(ParamPos.isSupportedTransaction(TX_TYPE.PAY_AUTH, model)).toBe(false)
    }
    expect(ParamPos.isSupportedTransaction(TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_SECURE)).toBe(true)
    expect(ParamPos.isSupportedTransaction(TX_TYPE.PAY_PRE_AUTH, MODEL.NON_SECURE)).toBe(true)
    expect(ParamPos.isSupportedTransaction(TX_TYPE.PAY_PRE_AUTH, MODEL.THREE_D_PAY)).toBe(false)
    expect(ParamPos.isSupportedTransaction(TX_TYPE.ORDER_HISTORY, MODEL.NON_SECURE)).toBe(false)
    for (const tx of [TX_TYPE.PAY_POST_AUTH, TX_TYPE.STATUS, TX_TYPE.CANCEL, TX_TYPE.REFUND, TX_TYPE.REFUND_PARTIAL]) {
      expect(ParamPos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(true)
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

  const FORM_ORDER: PosOrder = {
    id: 'order222',
    amount: 1000.25,
    installment: 0,
    currency: CURRENCY.TRY,
    ip: '127.0.0.1',
    success_url: 'https://domain.com/success',
    fail_url: 'https://domain.com/fail',
  }
  const FORM_REQUEST: Data = {
    'soap:Body': {
      TP_WMD_UCD: { '@xmlns': 'https://turkpos.com.tr/', Islem_ID: 'rand', Islem_Hash: 'jsLYSB3lJ81leFgDLw4D8PbXURs=' },
    },
  }

  it.each([
    [
      '3d_secure',
      FORM_ORDER,
      MODEL.THREE_D_SECURE,
      FORM_REQUEST,
      {
        TP_WMD_UCDResponse: {
          TP_WMD_UCDResult: {
            Islem_ID: '6021840768',
            Islem_GUID: 'd68ac15c-17ca-4b7d-a046-10700291b249',
            UCD_HTML: 'html-document',
            UCD_MD: 'MosNOirpqxod2A0BdoPpFNf7E/hJX2pKvt8hunrQF2RSrggeWpNj9p+XDEgRdWfGdtGMHF5A7X',
            Sonuc: '1',
            Sonuc_Str: 'İşlem Başarılı',
            Banka_Sonuc_Kod: '0',
            Siparis_ID: '20241229D2FF',
          },
        },
      },
      'html-document',
    ],
    [
      '3d_pay',
      { currency: CURRENCY.TRY },
      MODEL.THREE_D_PAY,
      // deviation: C10 request data is a record (the hook adds a key to it)
      { 'request-data': true },
      {
        Pos_OdemeResponse: {
          Pos_OdemeResult: {
            Islem_ID: '6021847071',
            UCD_URL:
              'https://test-pos.param.com.tr/3D_Secure/AkilliKart_3DPay_PFO.aspx?rURL=TURKPOS_3D_TRAN&SID=f2771b35-f5fd-434a-a1be-ba4eea554146',
            Sonuc: '1',
            Sonuc_Str: 'İşlem Başarılı',
            Banka_Sonuc_Kod: '-1',
            Komisyon_Oran: '1.01',
          },
        },
      },
      {
        gateway: 'https://test-pos.param.com.tr/3D_Secure/AkilliKart_3DPay_PFO.aspx',
        method: 'GET',
        inputs: { rURL: 'TURKPOS_3D_TRAN', SID: 'f2771b35-f5fd-434a-a1be-ba4eea554146' },
      },
    ],
  ] as Array<[string, PosOrder, PaymentModel, Data, Data, unknown]>)(
    'get3DFormData %s',
    async (_name, order, paymentModel, requestData, answer, formData) => {
      const c = card()
      requestMapper.create3DFormInitializeRequestData.mockReturnValue(requestData)
      requestMapper.create3DFormData.mockResolvedValue(formData)
      const verify = configureClientResponse(TX_TYPE.INTERNAL_3D_FORM_BUILD, requestData, answer, order, paymentModel)

      const result = await pos.get3DFormData(order, paymentModel, TX_TYPE.PAY_AUTH, c)

      expect(result).toStrictEqual(formData)
      expect(requestMapper.create3DFormInitializeRequestData).toHaveBeenCalledWith(
        account,
        order,
        paymentModel,
        TX_TYPE.PAY_AUTH,
        c,
      )
      // deviation: P6 the bank names the address; the gateway URL argument is unused
      expect(requestMapper.create3DFormData).toHaveBeenCalledWith(
        account,
        order,
        paymentModel,
        TX_TYPE.PAY_AUTH,
        '',
        null,
        answer,
      )
      verify()
    },
  )

  it.each([
    [
      'bad_request',
      new PosHttpError(
        'Bank SOAP fault: Unable to handle request without a valid action parameter. Please supply a valid soap action.',
        { url: PAYMENT_API },
      ),
      PosHttpError,
      'Bank SOAP fault: Unable to handle request without a valid action parameter. Please supply a valid soap action.',
    ],
    [
      'order_already_exist',
      {
        TP_WMD_UCDResponse: {
          TP_WMD_UCDResult: {
            Islem_ID: '0',
            Sonuc: '-400',
            Sonuc_Str:
              'Siparis_ID ye ait başarılı işlem mevcuttur. 124 Yeni Siparis_ID üreterek tekrar işlem deneyiniz.34/9/7',
            Banka_Sonuc_Kod: '0',
          },
        },
      },
      PosError,
      '3D form could not be created: Siparis_ID ye ait başarılı işlem mevcuttur. 124 Yeni Siparis_ID üreterek tekrar işlem deneyiniz.34/9/7',
    ],
    [
      'hash_error',
      {
        TP_WMD_UCDResponse: {
          TP_WMD_UCDResult: {
            Islem_ID: '0',
            Sonuc: '-102',
            Sonuc_Str: 'İşlem Hash geçersiz. Servise gelen Islem_Hash değeri:rvA0qAGEnAGZ8sfX4vk6AdSF/kI=2',
            Banka_Sonuc_Kod: '0',
          },
        },
      },
      PosError,
      '3D form could not be created: İşlem Hash geçersiz. Servise gelen Islem_Hash değeri:***2',
    ],
  ] as Array<[string, Data | Error, new (...a: never[]) => Error, string]>)(
    // deviation: C8 English messages; the bank text is masked and shortened
    'get3DFormData fail response %s',
    async (_name, answer, errorClass, message) => {
      requestMapper.create3DFormInitializeRequestData.mockReturnValue(FORM_REQUEST)
      configureClientResponse(TX_TYPE.INTERNAL_3D_FORM_BUILD, FORM_REQUEST, answer, FORM_ORDER, MODEL.THREE_D_SECURE)

      const err = await pos
        .get3DFormData(FORM_ORDER, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card())
        .catch((e: unknown) => e)

      expect(err).toBeInstanceOf(errorClass)
      expect((err as Error).message).toBe(message)
      expect((err as Error).message).not.toContain('rvA0qAGEnAGZ8sfX4vk6AdSF/kI=')
      expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
    },
  )

  // addition: P7 an answer without the result of the operation is no form
  it.each([[{}], [{ Pos_OdemeResponse: { Pos_OdemeResult: { Sonuc: '1' } } }], [{ TP_WMD_UCDResponse: [] }]])(
    'get3DFormData refuses the answer %j',
    async (answer) => {
      requestMapper.create3DFormInitializeRequestData.mockReturnValue(FORM_REQUEST)
      configureClientResponse(TX_TYPE.INTERNAL_3D_FORM_BUILD, FORM_REQUEST, answer, FORM_ORDER, MODEL.THREE_D_SECURE)
      await expect(pos.get3DFormData(FORM_ORDER, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card())).rejects.toThrow(
        new PosError('3D form could not be created: unknown error'),
      )
      expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
    },
  )

  // deviation: C8 English messages and error classes of the shared 3D form input check
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
      MODEL.THREE_D_PAY_HOSTING,
      TX_TYPE.PAY_AUTH,
      false,
      false,
      UnsupportedTransactionTypeError,
      'ParamPos supports [3d, 3d_pay, regular] payment model(s) for transaction type [pay]. Provided payment model: [3d_pay_hosting].',
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

  // ---- 3D Secure ----

  const PROVISION_REQUEST: Data = { request: 'create3DPaymentRequestData' }
  const STATUS_REQUEST: Data = { request: 'createStatusRequestData' }
  // deviation: P12 the approved provision answer carries its receipt and order id
  const PROVISION_APPROVED: Data = {
    TP_WMD_PayResponse: { TP_WMD_PayResult: { Sonuc: '1', Dekont_ID: '3007295376', Siparis_ID: '202412292160' } },
  }

  type SecureRow = [name: string, callback: Data, order: PosOrder, provision: Data | null, mapped: Data, expected: Data]

  // deviation: P9/P11 the callbacks are completed to the full signed field sets (CS2, CS3, CS5) and the orders to
  // the signed order ids, amount, currency and installment
  const secureRows: SecureRow[] = [
    [
      'auth_fail',
      CS2,
      { id: '20241229C152', amount: 10.01, currency: CURRENCY.TRY, installment: 0 },
      null,
      { amount: 1000.01, order_id: '20241229C152', payment_model: '3d', status: 'declined' },
      // deviation: P14 a decline carries trusted data only (the callback's amount is dropped)
      {
        amount: null,
        order_id: '20241229C152',
        payment_model: '3d',
        status: 'declined',
        transaction_type: 'pay',
        proc_return_code: null,
        error_code: null,
        error_message: null,
        md_status: '0',
        all: CS2,
        '3d_all': CS2,
      },
    ],
    [
      '3d_auth_success_payment_fail',
      CS3,
      { id: '202412306616', amount: 10.01, currency: CURRENCY.TRY, installment: 0 },
      PROVISION_DECLINED,
      { amount: 10.01, error_message: 'Hesap bulunamadı.', status: 'declined' },
      { amount: 10.01, error_message: 'Hesap bulunamadı.', status: 'declined', order_id: '202412306616' },
    ],
    [
      'success',
      CS5,
      ORDER_MD,
      PROVISION_APPROVED,
      {
        amount: 10.01,
        md_status: '1',
        order_id: '202412292160',
        payment_model: '3d',
        proc_return_code: '1',
        ref_ret_num: '436419200463',
        status: 'approved',
      },
      // deviation: P13 confirmed by the bank's status record; the references come from the record
      {
        amount: 10.01,
        md_status: '1',
        order_id: '202412292160',
        payment_model: '3d',
        proc_return_code: '1',
        ref_ret_num: '501917472738',
        status: 'approved',
        currency: 'TRY',
        auth_code: '222905',
        transaction_id: '25019RcIG10421',
        masked_number: '581877******2285',
        installment_count: 0,
        transaction_time: null,
        error_code: null,
        error_message: null,
        transaction_type: 'pay',
        all: PROVISION_APPROVED,
        '3d_all': CS5,
      },
    ],
  ]

  describe.each([
    ['make3DPayment', config],
    // deviation: P9 the hash check cannot be switched off (`disable_3d_hash_check` is an ignored unknown key)
    ['make3DPayment without hash check', { ...config, disable_3d_hash_check: true } as GatewayConfig],
  ])('%s', (_label, cfg) => {
    it.each(secureRows)('%s', async (_name, callback, order, provision, mapped, expected) => {
      const p = createGateway(cfg)
      crypt.check3DHash.mockReturnValue(true)
      responseMapper.map3DPaymentData.mockReturnValue(mapped)
      const exchanges: Exchange[] = []
      if (provision !== null) {
        requestMapper.create3DPaymentRequestData.mockReturnValue(PROVISION_REQUEST)
        exchanges.push({
          txType: TX_TYPE.PAY_AUTH,
          paymentModel: MODEL.THREE_D_SECURE,
          requestData: PROVISION_REQUEST,
          order,
          decodedResponse: provision,
        })
      }
      if (provision === PROVISION_APPROVED) {
        requestMapper.createStatusRequestData.mockReturnValue(STATUS_REQUEST)
        responseMapper.mapStatusResponse.mockReturnValue({ status: 'approved', transaction_time: null })
        exchanges.push({
          txType: TX_TYPE.STATUS,
          paymentModel: MODEL.NON_SECURE,
          requestData: STATUS_REQUEST,
          order: { id: '202412292160' },
          decodedResponse: statusAnswer(RECORD_MD),
        })
      }
      const verify = configureClientResponses(exchanges)

      const result = await p.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, cb(callback))

      expect(result).toStrictEqual(expected)
      // deviation: P9 a present hash is always verified, also on a declined card check
      expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
      expect(crypt.check3DHash).toHaveBeenCalledWith(account, callback)
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledTimes(1)
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(callback, provision, TX_TYPE.PAY_AUTH, order)
      if (provision === null) {
        expectNoRequest()
      } else {
        expect(requestMapper.create3DPaymentRequestData).toHaveBeenCalledWith(
          account,
          order,
          TX_TYPE.PAY_AUTH,
          callback,
        )
        verify()
      }
      if (provision === PROVISION_APPROVED) {
        expect(requestMapper.createStatusRequestData).toHaveBeenCalledWith(account, { id: '202412292160' })
      } else {
        expect(requestMapper.createStatusRequestData).not.toHaveBeenCalled()
      }
      expect(responseMapper.extractMdStatus).not.toHaveBeenCalled()
    })
  })

  it('make3DPayment foreign currency', async () => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.map3DPayResponseData.mockReturnValue({ amount: 10.01, status: 'approved' })
    requestMapper.createStatusRequestData.mockReturnValue(STATUS_REQUEST)
    responseMapper.mapStatusResponse.mockReturnValue({ status: 'approved', transaction_time: null })
    const verify = configureClientResponse(
      TX_TYPE.STATUS,
      STATUS_REQUEST,
      statusAnswer(RECORD_CP4),
      { id: '202501053F4F' },
      MODEL.NON_SECURE,
    )

    // deviation: P8/P13 the CP4 callback for an EUR order takes the payment result path with the bank's confirmation
    const result = await pos.payment(MODEL.THREE_D_SECURE, ORDER_CP4, TX_TYPE.PAY_AUTH, null, cb(CP4))

    expect(result).toMatchObject({
      amount: 10.01,
      status: 'approved',
      currency: 'EUR',
      order_id: '202501053F4F',
      payment_model: '3d',
      proc_return_code: '1',
    })
    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
    expect(crypt.check3DHash).toHaveBeenCalledWith(account, CP4)
    expect(responseMapper.extractMdStatus).not.toHaveBeenCalled()
    expect(responseMapper.is3dAuthSuccess).not.toHaveBeenCalled()
    expect(responseMapper.map3DPaymentData).not.toHaveBeenCalled()
    expect(responseMapper.map3DPayResponseData).toHaveBeenCalledTimes(1)
    verify()
  })

  it('make3DPayment hash mismatch', async () => {
    const data = {
      md: '444676:13FDE30917BF65D853787DB838390849D73151A10FC8C1192AC72660F2464521:3473:##190100000',
      islemHash: 'jF0PD92E+dM394Z1h5qm4SB6pPo=',
    }
    crypt.check3DHash.mockReturnValue(false)

    // deviation: C9 the order values are validated before the callback is read, so the order is a real one
    await expect(pos.payment(MODEL.THREE_D_SECURE, ORDER_MD, TX_TYPE.PAY_AUTH, null, cb(data))).rejects.toThrow(
      new HashMismatchError('3D callback hash mismatch'),
    )
    expect(crypt.check3DHash).toHaveBeenCalledWith(account, data)
    expect(responseMapper.map3DPaymentData).not.toHaveBeenCalled()
    expectNoRequest()
  })

  // deviation: P9/P11 full signed payment result callbacks (CP3, CP1) for the signed order ids
  const payRows: Array<[string, Data, PosOrder, Data, Data, Data | null]> = [
    [
      'auth_fail',
      CP3,
      { id: '202501193584', amount: 10.01, currency: CURRENCY.TRY, installment: 0 },
      { error_code: '-1', error_message: CP3.TURKPOS_RETVAL_Sonuc_Str, status: 'declined' },
      // deviation: P14 a decline carries the bank code and text only, the order's id, the echoed GUID redacted
      {
        error_code: '-1',
        error_message: CP3.TURKPOS_RETVAL_Sonuc_Str,
        status: 'declined',
        order_id: '202501193584',
        transaction_type: 'pay',
        payment_model: '3d_pay',
        proc_return_code: '-1',
        md_status: null,
        all: { ...CP3, TURKPOS_RETVAL_GUID: '***' },
      },
      null,
    ],
    [
      'success',
      CP1,
      ORDER_CP1,
      {
        transaction_id: null,
        transaction_type: 'pay',
        masked_number: '581877******2285',
        order_id: '20250119BACB',
        proc_return_code: '1',
        status: 'approved',
      },
      // deviation: P13 confirmed by the bank's status record; the references come from the record
      {
        transaction_id: '25019RcIG10421',
        transaction_type: 'pay',
        masked_number: '581877******2285',
        order_id: '20250119BACB',
        proc_return_code: '1',
        status: 'approved',
        amount: 10.01,
        currency: 'TRY',
        auth_code: '222905',
        ref_ret_num: '501917472738',
        installment_count: 0,
        transaction_time: null,
        error_code: null,
        error_message: null,
        md_status: null,
        payment_model: '3d_pay',
        all: { ...CP1, TURKPOS_RETVAL_GUID: '***' },
      },
      statusAnswer(bankRecord()),
    ],
  ]

  describe.each([
    ['make3DPayPayment', config],
    // deviation: P9 the hash check cannot be switched off
    ['make3DPayPayment without hash check', { ...config, disable_3d_hash_check: true } as GatewayConfig],
  ])('%s', (_label, cfg) => {
    it.each(payRows)('%s', async (_name, callback, order, mapped, expected, status) => {
      const p = createGateway(cfg)
      crypt.check3DHash.mockReturnValue(true)
      responseMapper.map3DPayResponseData.mockReturnValue(mapped)
      let verify = () => expectNoRequest()
      if (status !== null) {
        requestMapper.createStatusRequestData.mockReturnValue(STATUS_REQUEST)
        responseMapper.mapStatusResponse.mockReturnValue({ status: 'approved', transaction_time: null })
        verify = configureClientResponse(TX_TYPE.STATUS, STATUS_REQUEST, status, { id: order.id }, MODEL.NON_SECURE)
      }

      const result = await p.payment(MODEL.THREE_D_PAY, order, TX_TYPE.PAY_AUTH, null, cb(callback))

      expect(result).toStrictEqual(expected)
      expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
      expect(responseMapper.extractMdStatus).not.toHaveBeenCalled()
      expect(responseMapper.is3dAuthSuccess).not.toHaveBeenCalled()
      expect(responseMapper.map3DPayResponseData).toHaveBeenCalledTimes(1)
      expect(responseMapper.map3DPayResponseData).toHaveBeenCalledWith(callback, TX_TYPE.PAY_AUTH, order)
      verify()
    })
  })

  it('make3DPayPayment hash mismatch', async () => {
    const data = {
      TURKPOS_RETVAL_Hash: 'LOpkL9J8vne8E2j0A0HKOhUWGhI=',
      TURKPOS_RETVAL_Islem_GUID: '77f11031-cce8-4131-bf95-142303732608',
      TURKPOS_RETVAL_SanalPOS_Islem_ID: '6021847062',
    }
    crypt.check3DHash.mockReturnValue(false)

    // deviation: C9 the order values are validated before the callback is read, so the order is a real one
    await expect(pos.payment(MODEL.THREE_D_PAY, ORDER_CP1, TX_TYPE.PAY_AUTH, null, cb(data))).rejects.toThrow(
      new HashMismatchError('3D callback hash mismatch'),
    )
    expect(crypt.check3DHash).toHaveBeenCalledWith(account, data)
    expect(responseMapper.map3DPayResponseData).not.toHaveBeenCalled()
    expectNoRequest()
  })

  it('make3DHostPayment', async () => {
    // deviation: C8 the table answers first through payment()
    await expect(pos.payment(MODEL.THREE_D_HOST, {}, TX_TYPE.PAY_AUTH, null, cb({ a: 'abc' }))).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
  })

  // addition: a direct call names the other gateway
  it('make3DHostPayment called directly', async () => {
    await expect(pos.make3DHostPayment(cb({ a: 'abc' }), {}, TX_TYPE.PAY_AUTH)).rejects.toThrow(
      new UnsupportedPaymentModelError('Use Param3DHostPos for the 3D Host model'),
    )
  })

  // ---- other transactions ----

  // deviation: C10/P16 stateless results; the orders gain the values validated before the request and the decoded
  // answers become well-formed (an answer without a result is an unknown outcome)
  it.each([
    [
      TX_TYPE.PAY_AUTH,
      { TP_WMD_UCDResponse: { TP_WMD_UCDResult: { Sonuc: '1', Islem_ID: '6021', Siparis_ID: '2020110828BC' } } },
    ],
    [
      TX_TYPE.PAY_PRE_AUTH,
      {
        TP_Islem_Odeme_OnProv_WMDResponse: {
          TP_Islem_Odeme_OnProv_WMDResult: { Sonuc: '1', Islem_ID: '6021', Siparis_ID: '2020110828BC' },
        },
      },
    ],
  ] as Array<[TxType, Data]>)('makeRegularPayment %s', async (txType, answer) => {
    const order: PosOrder = { id: '2020110828BC', amount: 1.01, currency: CURRENCY.TRY, installment: 0 }
    const c = card()
    const requestData = { request: 'createNonSecurePaymentRequestData' }
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue(requestData)
    responseMapper.mapPaymentResponse.mockReturnValue({ status: 'approved', result: true })
    const verify = configureClientResponse(txType, requestData, answer, order, MODEL.NON_SECURE)

    const result = await pos.payment(MODEL.NON_SECURE, order, txType, c)

    expect(result).toStrictEqual({ status: 'approved', result: true })
    expect(requestMapper.createNonSecurePaymentRequestData).toHaveBeenCalledWith(account, order, txType, c)
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith(answer, txType, order)
    verify()
  })

  it('makeRegularPostAuthPayment', async () => {
    const order: PosOrder = { id: '2020110828BC', amount: 1.01 }
    const requestData = { request: 'createNonSecurePostAuthPaymentRequestData' }
    const answer = {
      TP_Islem_Odeme_OnProv_KapaResponse: {
        TP_Islem_Odeme_OnProv_KapaResult: { Sonuc: '1', Siparis_ID: '2020110828BC' },
      },
    }
    requestMapper.createNonSecurePostAuthPaymentRequestData.mockReturnValue(requestData)
    responseMapper.mapPaymentResponse.mockReturnValue({ status: 'approved' })
    const verify = configureClientResponse(TX_TYPE.PAY_POST_AUTH, requestData, answer, order, MODEL.NON_SECURE)

    expect(await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_POST_AUTH)).toStrictEqual({ status: 'approved' })
    expect(requestMapper.createNonSecurePostAuthPaymentRequestData).toHaveBeenCalledWith(account, order)
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith(answer, TX_TYPE.PAY_POST_AUTH, order)
    verify()
  })

  it('status', async () => {
    const order: PosOrder = { id: '2020110828BC' }
    const requestData = { request: 'createStatusRequestData' }
    const answer = { decodedData: true }
    requestMapper.createStatusRequestData.mockReturnValue(requestData)
    responseMapper.mapStatusResponse.mockReturnValue({ result: true })
    const verify = configureClientResponse(TX_TYPE.STATUS, requestData, answer, order, MODEL.NON_SECURE)

    expect(await pos.status(order)).toStrictEqual({ result: true })
    expect(requestMapper.createStatusRequestData).toHaveBeenCalledWith(account, order)
    expect(responseMapper.mapStatusResponse).toHaveBeenCalledWith(answer)
    verify()
  })

  it('cancel', async () => {
    const order: PosOrder = { id: '2020110828BC', amount: 1.01 }
    const requestData = { request: 'createCancelRequestData' }
    const answer = {
      TP_Islem_Iptal_Iade_Kismi2Response: { TP_Islem_Iptal_Iade_Kismi2Result: { Sonuc: '1', Sonuc_Str: 'Başarılı' } },
    }
    requestMapper.createCancelRequestData.mockReturnValue(requestData)
    responseMapper.mapCancelResponse.mockReturnValue({ result: true })
    const verify = configureClientResponse(TX_TYPE.CANCEL, requestData, answer, order, MODEL.NON_SECURE)

    expect(await pos.cancel(order)).toStrictEqual({ result: true })
    expect(requestMapper.createCancelRequestData).toHaveBeenCalledWith(account, order)
    expect(responseMapper.mapCancelResponse).toHaveBeenCalledWith(answer)
    verify()
  })

  it('refund', async () => {
    const order: PosOrder = { id: '2020110828BC', amount: 1.01 }
    const requestData = { request: 'createRefundRequestData' }
    const answer = {
      TP_Islem_Iptal_Iade_Kismi2Response: { TP_Islem_Iptal_Iade_Kismi2Result: { Sonuc: '1', Sonuc_Str: 'Başarılı' } },
    }
    requestMapper.createRefundRequestData.mockReturnValue(requestData)
    responseMapper.mapRefundResponse.mockReturnValue({ result: true })
    const verify = configureClientResponse(TX_TYPE.REFUND, requestData, answer, order, MODEL.NON_SECURE)

    expect(await pos.refund(order)).toStrictEqual({ result: true })
    expect(requestMapper.createRefundRequestData).toHaveBeenCalledWith(account, order, TX_TYPE.REFUND)
    expect(responseMapper.mapRefundResponse).toHaveBeenCalledWith(answer)
    verify()
  })

  // addition: a lower amount than the order amount is a partial refund
  it('refund of part of the order', async () => {
    const order: PosOrder = { id: '2020110828BC', amount: 1, order_amount: 2 }
    const requestData = { request: 'createRefundRequestData' }
    const answer = {
      TP_Islem_Iptal_Iade_Kismi2Response: { TP_Islem_Iptal_Iade_Kismi2Result: { Sonuc: '-1', Sonuc_Str: 'x' } },
    }
    requestMapper.createRefundRequestData.mockReturnValue(requestData)
    responseMapper.mapRefundResponse.mockReturnValue({ status: 'declined' })
    const verify = configureClientResponse(TX_TYPE.REFUND_PARTIAL, requestData, answer, order, MODEL.NON_SECURE)

    expect(await pos.refund(order)).toStrictEqual({ status: 'declined' })
    expect(requestMapper.createRefundRequestData).toHaveBeenCalledWith(account, order, TX_TYPE.REFUND_PARTIAL)
    verify()
  })

  it('orderHistory', async () => {
    await expect(pos.orderHistory({})).rejects.toThrow(UnsupportedTransactionTypeError)
    expectNoRequest()
  })

  // ---- fail-closed guards (additions) ----

  // addition: P14 a signed decline that maps as approved would skip the binding and the confirmation
  it.each([
    ['card check', MODEL.THREE_D_SECURE, CS2, { id: '20241229C152', amount: 10.01 }, 'map3DPaymentData'],
    ['payment result', MODEL.THREE_D_PAY, CP3, { id: '202501193584', amount: 10.01 }, 'map3DPayResponseData'],
  ] as Array<[string, PaymentModel, Data, PosOrder, 'map3DPaymentData' | 'map3DPayResponseData']>)(
    'a %s decline mapped as approved is refused',
    async (_name, model, callback, order, method) => {
      crypt.check3DHash.mockReturnValue(true)
      responseMapper[method].mockReturnValue({ status: 'approved' })
      await expect(pos.payment(model, order, TX_TYPE.PAY_AUTH, null, cb(callback))).rejects.toThrow(
        new PosError('3D callback without approval was mapped as approved'),
      )
      expectNoRequest()
    },
  )

  // addition: P13 a payment result approval the mapper does not approve is never confirmed or returned
  it('a payment result approval mapped as declined is refused before any request', async () => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.map3DPayResponseData.mockReturnValue({ status: 'declined' })
    await expect(pos.payment(MODEL.THREE_D_PAY, ORDER_CP1, TX_TYPE.PAY_AUTH, null, cb(CP1))).rejects.toThrow(
      new PosError('3D callback approval was not mapped as approved'),
    )
    expectNoRequest()
  })

  // addition: P12 a declined provision that maps as approved is refused
  it('a declined provision mapped as approved is refused', async () => {
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.map3DPaymentData.mockReturnValue({ status: 'approved' })
    requestMapper.create3DPaymentRequestData.mockReturnValue(PROVISION_REQUEST)
    configureClientResponse(
      TX_TYPE.PAY_AUTH,
      PROVISION_REQUEST,
      PROVISION_DECLINED,
      { id: '202412306616', amount: 10.01 },
      MODEL.THREE_D_SECURE,
    )
    await expect(
      pos.payment(MODEL.THREE_D_SECURE, { id: '202412306616', amount: 10.01 }, TX_TYPE.PAY_AUTH, null, cb(CS3)),
    ).rejects.toThrow(new PosError('Declined provision was mapped as approved'))
  })

  // addition: P16 a success code without transaction id is an unknown outcome even when the mapping approves it
  it('a sale success code without transaction id is an unknown outcome whatever the mapping says', async () => {
    const order: PosOrder = { id: '2020110828BC', amount: 1.01 }
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue({ r: 1 })
    responseMapper.mapPaymentResponse.mockReturnValue({ status: 'approved' })
    configureClientResponse(
      TX_TYPE.PAY_AUTH,
      { r: 1 },
      { TP_WMD_UCDResponse: { TP_WMD_UCDResult: { Sonuc: '1', Islem_ID: '0', Siparis_ID: '2020110828BC' } } },
      order,
      MODEL.NON_SECURE,
    )
    const err = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
  })

  // addition: P16 a money answer the mapper reads differently from the raw answer is an unknown outcome
  it('a sale answer whose mapping contradicts the raw result code is an unknown outcome', async () => {
    const order: PosOrder = { id: '2020110828BC', amount: 1.01 }
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue({ r: 1 })
    responseMapper.mapPaymentResponse.mockReturnValue({ status: 'declined' })
    configureClientResponse(
      TX_TYPE.PAY_AUTH,
      { r: 1 },
      { TP_WMD_UCDResponse: { TP_WMD_UCDResult: { Sonuc: '1', Islem_ID: '6021', Siparis_ID: '2020110828BC' } } },
      order,
      MODEL.NON_SECURE,
    )
    const err = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_AUTH, card()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).url).toBe(PAYMENT_API)
  })
})

// =====================================================================================================================
// End to end: real crypt, mappers and HTTP client over a fake fetch
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

type Sent = { url: string; op: string; body: Data; text: string }
type Reply = string | Response | undefined
type BankOptions = {
  /** Replaces the answer of an operation (undefined keeps the default). */
  answer?: Partial<Record<string, (body: Data) => Reply>>
  /** Status records by order id (default: the planning records). */
  records?: Record<string, unknown>
}

const PROVISION_RESULT: Data = provisionSuccess.TP_WMD_PayResponse.TP_WMD_PayResult as Data

const DEFAULT_RECORDS: Record<string, unknown> = {
  '202412292160': RECORD_MD,
  '20250119BACB': bankRecord(),
  '202501053F4F': RECORD_CP4,
}

const UCD_URL =
  'https://test-pos.param.com.tr/3D_Secure/AkilliKart_3DPay_PFO.aspx?rURL=TURKPOS_3D_TRAN&SID=f2771b35-f5fd-434a-a1be-ba4eea554146'

/** The bank: answers by SOAP operation and books what it is sent. */
function defaultAnswer(op: string, body: Data, records: Record<string, unknown>): Reply {
  const secure = body.Islem_Guvenlik_Tip === '3D'
  switch (op) {
    case 'TP_WMD_UCD':
    case 'TP_Islem_Odeme_OnProv_WMD':
      return soapAnswer(
        op,
        secure
          ? { Islem_ID: '6021840768', UCD_HTML: '<html>acs</html>', Sonuc: '1', Sonuc_Str: 'İşlem Başarılı' }
          : {
              Islem_ID: '6021840769',
              Sonuc: '1',
              Sonuc_Str: 'İşlem Başarılı',
              Siparis_ID: body.Siparis_ID,
              Bank_Trans_ID: '24364TKkF16602',
              Bank_AuthCode: '150888',
              Bank_HostRefNum: '436419200463',
            },
      )
    case 'Pos_Odeme':
    case 'TP_Islem_Odeme_WD':
      return soapAnswer(op, secure ? { Islem_ID: '6021847071', UCD_URL, Sonuc: '1' } : { Islem_ID: '6021', Sonuc: '1' })
    case 'TP_WMD_Pay':
      return soapAnswer(op, { ...PROVISION_RESULT, Siparis_ID: body.Siparis_ID })
    case 'TP_Islem_Sorgulama4': {
      const record = records[String(body.Siparis_ID)]
      return soapAnswer(
        op,
        record === undefined
          ? { Sonuc: '-1', Sonuc_Str: 'İşlem bulunamadı' }
          : { DT_Bilgi: record, Sonuc: '1', Sonuc_Str: 'Başarılı' },
      )
    }
    case 'TP_Islem_Odeme_OnProv_Kapa':
      return soapAnswer(op, { Sonuc: '1', Sonuc_Str: 'Başarılı', Siparis_ID: body.Siparis_ID })
    case 'TP_Islem_Iptal_Iade_Kismi2':
    case 'TP_Islem_Iptal_OnProv':
      return soapAnswer(op, { Sonuc: '1', Sonuc_Str: 'Başarılı' })
    default:
      return undefined
  }
}

/** A fetch that records each request and answers like the bank; any other URL or operation fails. */
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
    if (u !== PAYMENT_API) throw new Error(`unexpected request ${u}`)
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
    requestDataMapper: new ParamPosRequestDataMapper(valueMapper, valueFormatter, hooks, cryptImpl, LANG.TR),
    responseDataMapper: new ParamPosResponseDataMapper(
      new ParamPosResponseValueFormatter(),
      new ParamPosResponseValueMapper(),
      log,
    ),
    crypt: cryptImpl,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(
      ParamPos.GATEWAY_CLASS,
      cfg,
      new HttpTransport({ fetch: fetchImpl }),
      log,
    ),
    logger: log,
    hooks,
  }

  return new ParamPos(cfg, options.account ?? PA, deps)
}

const mismatch = async (promise: Promise<unknown>): Promise<OrderMismatchError> => {
  const err = await promise.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(OrderMismatchError)
  return err as OrderMismatchError
}

const NO_HASH = new HashMismatchError('3D callback has no hash')
const MALFORMED = new HashMismatchError('3D callback fields are malformed')
const UNKNOWN_OUTCOME = 'Bank answer carries no result code; the payment outcome is unknown'

const card3 = (p: ParamPos) =>
  CreditCardFactory.createForGateway(p, '5555444433332222', '21', '12', '122', 'ahmet', CARD_TYPE.VISA)

describe('ParamPos (end to end) 3D Secure', () => {
  const run = (callback: Data, order: PosOrder = ORDER_MD, options: BankOptions = {}, txType: TxType = 'pay') => {
    const { sent, fetchImpl } = bankFetch(options)
    const promise = realGateway(fetchImpl).payment(MODEL.THREE_D_SECURE, order, txType, null, cb(callback))
    return { sent, promise }
  }

  // addition: P12/P13 a CS5 card check is provisioned, then confirmed by the bank's status record
  it('provisions a CS5 approval and confirms it with one status request', async () => {
    // dcURL is not signed: a callback naming another service is still never contacted
    const callback = { ...CS5, dcURL: 'https://attacker.example/turkpos.ws/service_turkpos_test.asmx' }
    const { sent, promise } = run(callback)
    const res = (await promise) as Data

    expect(sent.map((s) => s.op)).toStrictEqual(['TP_WMD_Pay', 'TP_Islem_Sorgulama4'])
    expect(sent.every((s) => s.url === PAYMENT_API)).toBe(true)
    expect(sent[0]?.body).toStrictEqual({
      G: { CLIENT_CODE: '10738', CLIENT_USERNAME: 'Test1', CLIENT_PASSWORD: PASSWORD },
      GUID: G,
      UCD_MD: CS5.md,
      Islem_GUID: CS5.islemGUID,
      Siparis_ID: '202412292160',
    })
    expect(sent[1]?.body.Siparis_ID).toBe('202412292160')
    expect(res).toMatchObject({
      status: 'approved',
      md_status: '1',
      order_id: '202412292160',
      amount: 10.01,
      currency: 'TRY',
      payment_model: '3d',
      transaction_type: 'pay',
      proc_return_code: '1',
      // from the status record, not the provision answer
      auth_code: '222905',
      ref_ret_num: '501917472738',
      transaction_id: '25019RcIG10421',
      masked_number: '581877******2285',
      installment_count: 0,
      transaction_time: new Date('2025-01-19T17:29:32+03:00'),
    })
    expect(res['3d_all']).toStrictEqual(callback)
    expect(sent.some((s) => s.url === callback.dcURL)).toBe(false)
  })

  // addition: P13 a pre-authorization is confirmed by a PRE_AUTH record
  it('confirms a 3D pre-authorization with a PRE_AUTH record', async () => {
    const { sent, promise } = run(
      CS5,
      ORDER_MD,
      { records: { '202412292160': { ...RECORD_MD, Islem_Tip: 'PRE_AUTH' } } },
      'pre',
    )
    const res = (await promise) as Data
    expect(res.status).toBe('approved')
    expect(res.transaction_type).toBe('pre')
    expect(sent).toHaveLength(2)
  })

  // addition: P13 a sale record does not confirm a pre-authorization
  it('a SALE record does not confirm a pre-authorization', async () => {
    const err = await mismatch(run(CS5, ORDER_MD, {}, 'pre').promise)
    expect(err.field).toBe('transaction_type')
    expect(err.paymentMayHaveCompleted).toBe(true)
  })

  // addition: Review Focus md path, an unsigned approval never reaches the bank
  it('an unsigned approval is refused without any request', async () => {
    const { islemHash: _h, ...unsigned } = CS5
    const { sent, promise } = run(unsigned)
    await expect(promise).rejects.toThrow(NO_HASH)
    expect(sent).toHaveLength(0)
  })

  // addition: Review Focus md path, a padded 3D result is an approval and fails the pins (never a decline)
  it.each([' 1', '1 ', '\t1'])('a signed callback with mdStatus %j is malformed', async (mdStatus) => {
    const { sent, promise } = run(signedMd({ ...CS5, mdStatus }))
    await expect(promise).rejects.toThrow(MALFORMED)
    expect(sent).toHaveLength(0)
  })

  // addition: P10/P11 RP1, the re-split for order 2292160: the bank booked the original order
  it('RP1: a provision answer for the original order is an order mismatch with the payment flagged', async () => {
    const order: PosOrder = { id: '2292160', amount: 10.01, currency: CURRENCY.TRY, installment: 0 }
    const { sent, promise } = run(RP1, order, {
      answer: { TP_WMD_Pay: () => soapAnswer('TP_WMD_Pay', PROVISION_RESULT) },
    })
    const err = await mismatch(promise)
    expect(err.field).toBe('order_id')
    expect(err.expected).toBe('2292160')
    expect(err.actual).toBe('202412292160')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
    expect(sent.map((s) => s.op)).toStrictEqual(['TP_WMD_Pay'])
    expect(sent[0]?.body.UCD_MD).toBe(RP1.md)
  })

  // addition: P10/P13 RP1 with an answer echoing the re-split order: the status record decides (never approved)
  it('RP1: an answer echoing the re-split order is not confirmed by the status record', async () => {
    const order: PosOrder = { id: '2292160', amount: 10.01, currency: CURRENCY.TRY, installment: 0 }
    const { sent, promise } = run(RP1, order)
    const err = await mismatch(promise)
    expect(err.field).toBe('order_status')
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(sent.map((s) => s.op)).toStrictEqual(['TP_WMD_Pay', 'TP_Islem_Sorgulama4'])
    // and a record of the original order is no confirmation either
    const other = run(RP1, order, { records: { '2292160': RECORD_MD } })
    expect((await mismatch(other.promise)).field).toBe('order_id')
  })

  // addition: P11 the order is bound before any request
  it.each([
    ['another order id', CS5, { ...ORDER_MD, id: '202412292161' }, 'order_id'],
    ['another amount', { ...CS5, transactionAmount: '1000,01' }, ORDER_MD, 'amount'],
    ['a sub-kuruş amount', { ...CS5, transactionAmount: '10,02' }, ORDER_MD, 'amount'],
  ] as Array<[string, Data, PosOrder, string]>)('%s is refused before the provision', async (_n, c, order, field) => {
    const { sent, promise } = run(c, order)
    const err = await mismatch(promise)
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(false)
    expect(err.response).toBeUndefined()
    expect(sent).toHaveLength(0)
  })

  // addition: Review Focus money requests after a provision: an unclear answer is an unknown outcome, never a decline
  it.each([
    ['an empty body', () => soapAnswer('TP_WMD_Pay', null)],
    ['an empty answer (204)', () => new Response(null, { status: 204 })],
    ['no result code', () => soapAnswer('TP_WMD_Pay', { Sonuc_Ack: 'x', Dekont_ID: '3007295376' })],
    ['a text result code', () => soapAnswer('TP_WMD_Pay', { Sonuc: 'x' })],
    ['a success code without receipt', () => soapAnswer('TP_WMD_Pay', { Sonuc: '1', Dekont_ID: '0' })],
    ['a success code with a malformed receipt', () => soapAnswer('TP_WMD_Pay', { Sonuc: '1', Dekont_ID: '01' })],
    ['another operation', () => soapAnswer('TP_WMD_UCD', { Sonuc: '1', Dekont_ID: '3007295376' })],
  ] as Array<[string, () => Reply]>)('%s after the provision is an unknown outcome', async (_n, reply) => {
    const { sent, promise } = run(CS5, ORDER_MD, { answer: { TP_WMD_Pay: reply } })
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).url).toBe(PAYMENT_API)
    expect(sent).toHaveLength(1)
  })

  // addition: a SOAP fault after the provision is the client's PosHttpError
  it('a SOAP fault after the provision propagates as PosHttpError', async () => {
    const { sent, promise } = run(CS5, ORDER_MD, {
      answer: { TP_WMD_Pay: () => soapFault(`Server error for ${PASSWORD} and ${G}`) },
    })
    const err = (await promise.catch((e: unknown) => e)) as PosHttpError
    expect(err).toBeInstanceOf(PosHttpError)
    expect(err.message).not.toContain(PASSWORD)
    expect(err.message).not.toContain(G)
    expect(sent).toHaveLength(1)
  })

  // addition: P12 a declined provision is the bank's decline for this order (server to server), not confirmed
  it('a declined provision (CS3) is mapped as declined without a status request', async () => {
    const order: PosOrder = { id: '202412306616', amount: 10.01, currency: CURRENCY.TRY, installment: 0 }
    const { sent, promise } = run(CS3, order, {
      answer: {
        TP_WMD_Pay: () => soapAnswer('TP_WMD_Pay', PROVISION_DECLINED.TP_WMD_PayResponse.TP_WMD_PayResult),
      },
    })
    const res = (await promise) as Data
    expect(res).toMatchObject({
      status: 'declined',
      order_id: '202412306616',
      proc_return_code: '-100',
      error_message: 'Hesap bulunamadı.',
    })
    expect(res.requires_manual_review).toBeUndefined()
    expect(sent.map((s) => s.op)).toStrictEqual(['TP_WMD_Pay'])
  })

  // addition: P13 with the provision as evidence every confirmation failure flags the payment
  it.each([
    ['another amount', { Toplam_Tutar: '1.01' }, 'amount'],
    ['another receipt', { Dekont_ID: '1' }, 'transaction_id'],
    ['refunded', { Toplam_Iade_Tutar: '5.00' }, 'order_status'],
    ['failed', { Durum: 'FAIL' }, 'order_status'],
    ['installments', { Taksit: '3' }, 'installment'],
  ] as Array<[string, Data, string]>)('a record with %s is flagged for review', async (_n, over, field) => {
    const { sent, promise } = run(CS5, ORDER_MD, { records: { '202412292160': { ...RECORD_MD, ...over } } })
    const err = await mismatch(promise)
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(true)
    expect(err.response?.requires_manual_review).toBe(true)
    expect(err.response?.order_id).toBe('202412292160')
    expect(sent).toHaveLength(2)
  })

  it.each([
    ['no record', { records: {} }],
    ['a list of records', { records: { '202412292160': [RECORD_MD, RECORD_MD] } }],
  ] as Array<[string, BankOptions]>)('%s after an approved provision is flagged for review', async (_n, options) => {
    const err = await mismatch(run(CS5, ORDER_MD, options).promise)
    expect(err.field).toBe('order_status')
    expect(err.paymentMayHaveCompleted).toBe(true)
  })

  // addition: P13 an error of the status request propagates unchanged (outcome unknown)
  it('a fault of the status request propagates', async () => {
    const { sent, promise } = run(CS5, ORDER_MD, { answer: { TP_Islem_Sorgulama4: () => soapFault('busy') } })
    await expect(promise).rejects.toThrow(PosHttpError)
    expect(sent).toHaveLength(2)
  })

  // addition: P9/P14 a signed failed card check (CS2) is a trusted decline without any request
  it('CS2 is a trusted decline for the order', async () => {
    const order: PosOrder = { id: '20241229C152', amount: 10.01, currency: CURRENCY.TRY, installment: 0 }
    const { sent, promise } = run(CS2, order)
    const res = (await promise) as Data
    expect(res).toMatchObject({ status: 'declined', order_id: '20241229C152', md_status: '0', amount: null })
    expect(res.requires_manual_review).toBeUndefined()
    expect(sent).toHaveLength(0)
  })

  // addition: P9 a present hash is always verified, also on a decline
  it('a tampered signed decline is a hash mismatch', async () => {
    const { sent, promise } = run({ ...CS2, orderId: '20241229C153' }, { id: '20241229C153', amount: 10.01 })
    await expect(promise).rejects.toThrow(new HashMismatchError('3D callback hash mismatch'))
    expect(sent).toHaveLength(0)
  })

  // addition: unsigned declines, with and without require_3d_hash
  it('an unsigned decline is a trusted decline; require_3d_hash refuses it', async () => {
    const unsigned = { mdStatus: '0', orderId: 'X', islemGUID: CS2.islemGUID, md: CS2.md, transactionAmount: '99,00' }
    const order: PosOrder = { id: 'ORDER-9', amount: 10.01 }
    const { sent, fetchImpl } = bankFetch()
    const res = (await realGateway(fetchImpl).payment(MODEL.THREE_D_SECURE, order, 'pay', null, cb(unsigned))) as Data
    expect(res).toMatchObject({ status: 'declined', order_id: 'ORDER-9', amount: null, md_status: '0' })
    expect(res.requires_manual_review).toBeUndefined()
    await expect(
      realGateway(fetchImpl, { cfg: { ...config, require_3d_hash: true } }).payment(
        MODEL.THREE_D_SECURE,
        order,
        'pay',
        null,
        cb(unsigned),
      ),
    ).rejects.toThrow(NO_HASH)
    expect(sent).toHaveLength(0)
  })

  // addition: v0.9 lesson, a bad order fails before the callback is read
  it.each([
    ['no amount', { id: '202412292160' }],
    ['a zero amount', { ...ORDER_MD, amount: 0 }],
    ['an amount below one kuruş', { ...ORDER_MD, amount: 0.004 }],
    ['an amount text', { ...ORDER_MD, amount: 'abc' }],
    ['a bad installment', { ...ORDER_MD, installment: 1.5 }],
    ['an unknown currency', { ...ORDER_MD, currency: 'JPY' }],
    ['a bad order id', { ...ORDER_MD, id: '-1' }],
  ] as Array<[string, PosOrder]>)('an order with %s is refused before the crypt', async (_n, order) => {
    const spy = vi.spyOn(ParamPosCrypt.prototype, 'check3DHash')
    const { sent, promise } = run(CS5, order)
    await expect(promise).rejects.toThrow(PosError)
    expect(spy).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
    spy.mockRestore()
  })
})

describe('ParamPos (end to end) payment result callbacks', () => {
  const run = (
    callback: Data,
    order: PosOrder = ORDER_CP1,
    options: BankOptions = {},
    model: PaymentModel = MODEL.THREE_D_PAY,
  ) => {
    const { sent, fetchImpl } = bankFetch(options)
    const promise = realGateway(fetchImpl).payment(model, order, TX_TYPE.PAY_AUTH, null, cb(callback))
    return { sent, promise }
  }

  // addition: Review Focus forgeable callbacks, CP1 is confirmed with exactly one status request
  it('CP1 is approved after one status request, with the record references', async () => {
    const { sent, promise } = run(CP1)
    const res = (await promise) as Data
    expect(sent).toHaveLength(1)
    expect(sent[0]?.op).toBe('TP_Islem_Sorgulama4')
    expect(sent[0]?.text).toContain('<Siparis_ID>20250119BACB</Siparis_ID>')
    expect(res).toMatchObject({
      status: 'approved',
      order_id: '20250119BACB',
      amount: 10.01,
      currency: 'TRY',
      payment_model: '3d_pay',
      proc_return_code: '1',
      md_status: null,
      auth_code: '222905',
      ref_ret_num: '501917472738',
      transaction_id: '25019RcIG10421',
      masked_number: '581877******2285',
    })
    expect((res.all as Data).TURKPOS_RETVAL_GUID).toBe('***')
    expect(JSON.stringify(res)).not.toContain(G)
  })

  // addition: P8 a foreign currency 3D order takes the payment result path
  it('CP4 for an EUR 3D order is approved after one status request', async () => {
    const { sent, promise } = run(CP4, ORDER_CP4, {}, MODEL.THREE_D_SECURE)
    const res = (await promise) as Data
    expect(sent.map((s) => s.op)).toStrictEqual(['TP_Islem_Sorgulama4'])
    expect(res).toMatchObject({ status: 'approved', currency: 'EUR', payment_model: '3d', order_id: '202501053F4F' })
    expect((res.all as Data).TURKPOS_RETVAL_GUID).toBe('***')
  })

  // addition: C5 the echoed GUID is never read: a callback echoing another GUID but signed with the account's verifies
  it('a callback echoing another GUID verifies with the account GUID and never returns either', async () => {
    const other = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const { promise } = run({ ...CP1, TURKPOS_RETVAL_GUID: other })
    const res = (await promise) as Data
    expect(res.status).toBe('approved')
    expect(JSON.stringify(res)).not.toContain(other)
    expect(JSON.stringify(res)).not.toContain(G)
    // a callback signed with the echoed GUID instead fails
    await expect(
      run({ ...CP1, TURKPOS_RETVAL_GUID: other, TURKPOS_RETVAL_Hash: TPH(CP1, other) }).promise,
    ).rejects.toThrow(new HashMismatchError('3D callback hash mismatch'))
  })

  // addition: Review Focus forgeable callbacks, the record decides; evidence decides the flag
  it.each([
    ['Toplam_Tutar 1.01', { Toplam_Tutar: '1.01' }, 'amount', true],
    ['Dekont_ID 1', { Dekont_ID: '1' }, 'transaction_id', true],
    ['Toplam_Iade_Tutar 5.00', { Toplam_Iade_Tutar: '5.00' }, 'order_status', true],
    ['PRE_AUTH', { Islem_Tip: 'PRE_AUTH' }, 'transaction_type', true],
    ['Taksit 3', { Taksit: '3' }, 'installment', true],
    ['Durum FAIL', { Durum: 'FAIL' }, 'order_status', false],
    ['Odeme_Sonuc 0', { Odeme_Sonuc: '0' }, 'order_status', false],
    ['Dekont_ID 0', { Dekont_ID: '0' }, 'transaction_id', false],
  ] as Array<[string, Data, string, boolean]>)('a record with %s', async (_n, over, field, evidence) => {
    const { sent, promise } = run(CP1, ORDER_CP1, { records: { '20250119BACB': bankRecord(over) } })
    const err = await mismatch(promise)
    expect(err.field).toBe(field)
    expect(err.paymentMayHaveCompleted).toBe(evidence)
    if (evidence) {
      expect(err.response?.requires_manual_review).toBe(true)
      expect(JSON.stringify(err.response)).not.toContain(G)
    } else {
      expect(err.response).toBeUndefined()
    }
    expect(sent).toHaveLength(1)
  })

  it.each([
    ['no record', {}],
    ['a list of records', { '20250119BACB': [bankRecord(), bankRecord()] }],
    ['a record of another order', { '20250119BACB': bankRecord({ Siparis_ID: '20250119BACC' }) }],
  ] as Array<[string, Record<string, unknown>]>)('%s raises no alert', async (_n, records) => {
    const err = await mismatch(run(CP1, ORDER_CP1, { records }).promise)
    expect(err.paymentMayHaveCompleted).toBe(false)
    expect(err.response).toBeUndefined()
  })

  // addition: CP1 re-split (dekont 300730069, amount 510,01) verifies but is malformed or not confirmed
  it('the CP1 dekont/amount re-split is never approved', async () => {
    const resplit = { ...CP1, TURKPOS_RETVAL_Dekont_ID: '300730069', TURKPOS_RETVAL_Tahsilat_Tutari: '510,01' }
    expect(TPH(resplit)).toBe(CP1.TURKPOS_RETVAL_Hash)
    const err = await mismatch(run(resplit).promise)
    expect(err.field).toBe('transaction_id')
  })

  // addition: P11 a payment result for another order is refused before the status request
  it('a CP1 callback for another order is refused without a request', async () => {
    const { sent, promise } = run(CP1, { ...ORDER_CP1, id: '20250119BACC' })
    const err = await mismatch(promise)
    expect(err.field).toBe('order_id')
    expect(err.response).toBeUndefined()
    expect(sent).toHaveLength(0)
  })

  // addition: P10 malformed approvals, P9 unsigned approvals
  it.each([
    ['a padded result code', signedTp({ ...CP1, TURKPOS_RETVAL_Sonuc: ' 1' }), MALFORMED],
    ['a receipt with a leading zero', signedTp({ ...CP1, TURKPOS_RETVAL_Dekont_ID: '03007300695' }), MALFORMED],
    ['a negative code with a receipt', signedTp({ ...CP1, TURKPOS_RETVAL_Sonuc: '-1' }), MALFORMED],
    ['a dotted amount', signedTp({ ...CP1, TURKPOS_RETVAL_Tahsilat_Tutari: '10.01' }), MALFORMED],
    [
      'a lower-case transaction id',
      signedTp({ ...CP1, TURKPOS_RETVAL_Islem_ID: CP1.TURKPOS_RETVAL_Islem_ID.toLowerCase() }),
      MALFORMED,
    ],
    ['no hash', { ...CP1, TURKPOS_RETVAL_Hash: undefined }, NO_HASH],
    ['an empty hash', { ...CP1, TURKPOS_RETVAL_Hash: '' }, NO_HASH],
    ['no hash and only a receipt', { ...CP3, TURKPOS_RETVAL_Hash: undefined, TURKPOS_RETVAL_Dekont_ID: '5' }, NO_HASH],
  ] as Array<[string, Data, Error]>)('%s is refused without a request', async (_n, callback, error) => {
    const { sent, promise } = run(callback, { ...ORDER_CP1, id: callback.TURKPOS_RETVAL_Siparis_ID })
    await expect(promise).rejects.toThrow(error)
    expect(sent).toHaveLength(0)
  })

  // addition: P14 CP3 is a trusted decline with the bank's code and text
  it('CP3 is a trusted decline', async () => {
    const order: PosOrder = { id: '202501193584', amount: 10.01, currency: CURRENCY.TRY, installment: 0 }
    const { sent, promise } = run(CP3, order)
    const res = (await promise) as Data
    expect(res).toMatchObject({
      status: 'declined',
      order_id: '202501193584',
      error_code: '-1',
      proc_return_code: '-1',
      error_message: CP3.TURKPOS_RETVAL_Sonuc_Str,
      amount: null,
      payment_model: '3d_pay',
    })
    expect(res.masked_number ?? null).toBeNull()
    expect((res.all as Data).TURKPOS_RETVAL_GUID).toBe('***')
    expect(sent).toHaveLength(0)
  })

  // addition: a signed decline is not bound to the order (its echo is not used)
  it('an unsigned payment result decline is a trusted decline for the order', async () => {
    const { TURKPOS_RETVAL_Hash: _h, ...unsigned } = CP3
    const res = (await run(unsigned, { id: 'MINE-1', amount: 1 }).promise) as Data
    expect(res).toMatchObject({ status: 'declined', order_id: 'MINE-1', error_code: '-1' })
  })

  // addition: Review Focus routing, refused before the crypt
  it.each([
    ['a card check for 3D Pay', CS5, ORDER_CP1, MODEL.THREE_D_PAY, 'Unexpected 3D callback for this payment model'],
    [
      'a payment result for a TRY 3D order',
      CP1,
      ORDER_CP1,
      MODEL.THREE_D_SECURE,
      'Unexpected 3D callback for this payment model',
    ],
    [
      'a card check for a foreign 3D order',
      CS5,
      { ...ORDER_MD, currency: CURRENCY.EUR },
      MODEL.THREE_D_SECURE,
      'Unexpected 3D callback for this payment model',
    ],
    ['both shapes', { ...CP1, mdStatus: '1' }, ORDER_CP1, MODEL.THREE_D_PAY, 'Unexpected 3D callback'],
    ['neither shape', { orderId: '20250119BACB' }, ORDER_CP1, MODEL.THREE_D_PAY, 'Unexpected 3D callback'],
    [
      'a list value',
      { ...CS5, mdStatus: ['1'] },
      ORDER_MD,
      MODEL.THREE_D_SECURE,
      '3D callback field "mdStatus" must be a string',
    ],
    [
      'a number value',
      { ...CP1, TURKPOS_RETVAL_Sonuc: 1 },
      ORDER_CP1,
      MODEL.THREE_D_PAY,
      '3D callback field "TURKPOS_RETVAL_Sonuc" must be a string',
    ],
  ] as Array<[string, Data, PosOrder, PaymentModel, string]>)(
    '%s is refused',
    async (_n, callback, order, model, message) => {
      const spy = vi.spyOn(ParamPosCrypt.prototype, 'check3DHash')
      const { sent, promise } = run(callback, order, {}, model)
      await expect(promise).rejects.toThrow(new PosError(message))
      expect(spy).not.toHaveBeenCalled()
      expect(sent).toHaveLength(0)
      spy.mockRestore()
    },
  )

  // addition: P3 a foreign currency 3D pre-authorization does not exist
  it('a payment result for a foreign currency pre-authorization is refused', async () => {
    const { fetchImpl } = bankFetch()
    await expect(
      realGateway(fetchImpl).payment(MODEL.THREE_D_SECURE, ORDER_CP4, TX_TYPE.PAY_PRE_AUTH, null, cb(CP4)),
    ).rejects.toThrow(new PosError('Param 3D pre-authorization supports TRY only'))
  })

  // addition: concurrency, one gateway serves two completions at once
  it('two concurrent completions keep their own status requests and results', async () => {
    const second = signedTp({
      ...CP1,
      TURKPOS_RETVAL_Siparis_ID: '20250120AAAA',
      TURKPOS_RETVAL_Dekont_ID: '3007300700',
      TURKPOS_RETVAL_Tahsilat_Tutari: '20,50',
      TURKPOS_RETVAL_Islem_ID: 'AAAAAAAAAAAAAAAAAAAAAAAA',
    })
    const records = {
      '20250119BACB': bankRecord(),
      '20250120AAAA': bankRecord({
        Siparis_ID: '20250120AAAA',
        Dekont_ID: '3007300700',
        Toplam_Tutar: '20.50',
        Bank_AuthCode: '999999',
      }),
    }
    const { sent, fetchImpl } = bankFetch({ records })
    const p = realGateway(fetchImpl)
    const [a, b] = (await Promise.all([
      p.payment(MODEL.THREE_D_PAY, ORDER_CP1, 'pay', null, cb(CP1)),
      p.payment(MODEL.THREE_D_PAY, { id: '20250120AAAA', amount: 20.5 }, 'pay', null, cb(second)),
    ])) as Data[]
    expect(a).toMatchObject({ status: 'approved', order_id: '20250119BACB', amount: 10.01, auth_code: '222905' })
    expect(b).toMatchObject({ status: 'approved', order_id: '20250120AAAA', amount: 20.5, auth_code: '999999' })
    expect(sent.map((s) => s.body.Siparis_ID).sort()).toStrictEqual(['20250119BACB', '20250120AAAA'])
  })
})

describe('ParamPos (end to end) 3D form', () => {
  const formOrder = (over: PosOrder = {}): PosOrder => ({
    id: 'order222',
    amount: 1000.25,
    installment: 0,
    currency: CURRENCY.TRY,
    ip: '127.0.0.1',
    success_url: 'https://domain.com/success',
    fail_url: 'https://domain.com/fail',
    ...over,
  })

  // addition: the bank page of a 3D Secure registration is returned as it is
  it('3D Secure returns the bank page; 3D Pay returns the GET form', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    expect(await p.get3DFormData(formOrder(), MODEL.THREE_D_SECURE, 'pay', card3(p))).toBe('<html>acs</html>')
    expect(await p.get3DFormData(formOrder(), MODEL.THREE_D_PAY, 'pay', card3(p))).toStrictEqual({
      gateway: 'https://test-pos.param.com.tr/3D_Secure/AkilliKart_3DPay_PFO.aspx',
      method: 'GET',
      inputs: { rURL: 'TURKPOS_3D_TRAN', SID: 'f2771b35-f5fd-434a-a1be-ba4eea554146' },
    })
    expect(await p.get3DFormData(formOrder({ currency: 'USD' }), MODEL.THREE_D_SECURE, 'pay', card3(p))).toMatchObject({
      method: 'GET',
    })
    expect(sent.map((s) => s.op)).toStrictEqual(['TP_WMD_UCD', 'Pos_Odeme', 'TP_Islem_Odeme_WD'])
    expect(sent[0]?.body.Islem_Tutar).toBe('1000,25')
  })

  // addition: Review Focus money requests, a 3D pre-authorization in USD sends nothing
  it('a 3D pre-authorization in USD is refused without a request', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    await expect(
      p.get3DFormData(formOrder({ currency: 'USD' }), MODEL.THREE_D_SECURE, 'pre', card3(p)),
    ).rejects.toThrow(new PosError('Param 3D pre-authorization supports TRY only'))
    expect(sent).toHaveLength(0)
  })

  // addition: P7 the bank's text is masked
  it('a registration error shows the masked bank text', async () => {
    const { fetchImpl } = bankFetch({
      answer: {
        TP_WMD_UCD: () =>
          soapAnswer('TP_WMD_UCD', {
            Sonuc: '-102',
            Sonuc_Str: `İşlem Hash geçersiz. Servise gelen Islem_Hash değeri:rvA0qAGEnAGZ8sfX4vk6AdSF/kI=2 ${PASSWORD} ${G}`,
          }),
      },
    })
    const p = realGateway(fetchImpl)
    const err = (await p
      .get3DFormData(formOrder(), MODEL.THREE_D_SECURE, 'pay', card3(p))
      .catch((e: unknown) => e)) as Error
    expect(err).toBeInstanceOf(PosError)
    expect(err.message.startsWith('3D form could not be created: İşlem Hash geçersiz.')).toBe(true)
    expect(err.message).not.toContain('rvA0qAGEnAGZ8sfX4vk6AdSF/kI=')
    expect(err.message).not.toContain(PASSWORD)
    expect(err.message).not.toContain(G)
  })
})

describe('ParamPos (end to end) money requests', () => {
  const order = (over: PosOrder = {}): PosOrder => ({
    id: '2020110828BC',
    amount: 1.15,
    currency: CURRENCY.TRY,
    installment: 0,
    ip: '127.0.0.1',
    success_url: 'https://domain.com/success',
    fail_url: 'https://domain.com/fail',
    ...over,
  })

  // addition: P1 1.15 is '1,15' for sale, pre and post and '1.15' for cancel and refund
  it('1.15 is sent exactly', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    const sale = (await p.payment(MODEL.NON_SECURE, order(), 'pay', card3(p))) as Data
    const pre = (await p.payment(MODEL.NON_SECURE, order(), 'pre', card3(p))) as Data
    const post = (await p.payment(MODEL.NON_SECURE, order(), 'post')) as Data
    const cancel = (await p.cancel(order())) as Data
    const refund = (await p.refund(order())) as Data
    const preCancel = (await p.cancel(order({ transaction_type: 'pre' }))) as Data
    expect([sale, pre, post, cancel, refund, preCancel].map((r) => r.status)).toStrictEqual([
      'approved',
      'approved',
      'approved',
      'approved',
      'approved',
      'approved',
    ])
    expect(sent.map((s) => s.op)).toStrictEqual([
      'TP_WMD_UCD',
      'TP_Islem_Odeme_OnProv_WMD',
      'TP_Islem_Odeme_OnProv_Kapa',
      'TP_Islem_Iptal_Iade_Kismi2',
      'TP_Islem_Iptal_Iade_Kismi2',
      'TP_Islem_Iptal_OnProv',
    ])
    expect([sent[0]?.body.Islem_Tutar, sent[1]?.body.Islem_Tutar, sent[2]?.body.Prov_Tutar]).toStrictEqual([
      '1,15',
      '1,15',
      '1,15',
    ])
    expect([sent[3]?.body.Tutar, sent[4]?.body.Tutar]).toStrictEqual(['1.15', '1.15'])
  })

  // addition: P1/C9 invalid amounts never reach the bank
  it.each([[0], [-1], [0.004], ['abc'], [1e13], [undefined]] as Array<[unknown]>)(
    'a sale of %j sends nothing',
    async (raw) => {
      const amount = raw as number
      const { sent, fetchImpl } = bankFetch()
      const p = realGateway(fetchImpl)
      await expect(p.payment(MODEL.NON_SECURE, order({ amount }), 'pay', card3(p))).rejects.toThrow(PosError)
      await expect(p.payment(MODEL.NON_SECURE, order({ amount }), 'post')).rejects.toThrow(PosError)
      await expect(p.refund(order({ amount }))).rejects.toThrow(PosError)
      expect(sent).toHaveLength(0)
    },
  )

  // addition: P5 cancelling a sale needs its amount
  it('cancelling a sale without an amount sends nothing', async () => {
    const { sent, fetchImpl } = bankFetch()
    await expect(realGateway(fetchImpl).cancel({ id: '2020110828BC' })).rejects.toThrow(PosError)
    expect(sent).toHaveLength(0)
  })

  // addition: P16 an unclear sale answer is an unknown outcome naming the URL
  it.each([
    ['no result', () => soapAnswer('TP_WMD_UCD', null)],
    ['another operation', () => soapAnswer('TP_Islem_Odeme_WD', { Sonuc: '1', Islem_ID: '6021' })],
    ['a text result code', () => soapAnswer('TP_WMD_UCD', { Sonuc: 'x', Islem_ID: '6021' })],
    ['a success code without transaction id', () => soapAnswer('TP_WMD_UCD', { Sonuc: '1', Islem_ID: '0' })],
    ['an empty answer (204)', () => new Response(null, { status: 204 })],
  ] as Array<[string, () => Reply]>)('a sale answered with %s is an unknown outcome', async (_n, reply) => {
    const { sent, fetchImpl } = bankFetch({ answer: { TP_WMD_UCD: reply } })
    const p = realGateway(fetchImpl)
    const err = await p.payment(MODEL.NON_SECURE, order(), 'pay', card3(p)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PosHttpError)
    expect((err as PosHttpError).message).toBe(UNKNOWN_OUTCOME)
    expect((err as PosHttpError).url).toBe(PAYMENT_API)
    expect(sent).toHaveLength(1)
  })

  it.each([
    ['pre', 'TP_Islem_Odeme_OnProv_WMD'],
    ['post', 'TP_Islem_Odeme_OnProv_Kapa'],
  ] as Array<[TxType, string]>)('a %s answered without a result is an unknown outcome', async (txType, op) => {
    const { fetchImpl } = bankFetch({ answer: { [op]: () => soapAnswer(op, { Sonuc_Str: 'x' }) } })
    const p = realGateway(fetchImpl)
    const promise =
      txType === 'post'
        ? p.payment(MODEL.NON_SECURE, order(), txType)
        : p.payment(MODEL.NON_SECURE, order(), txType, card3(p))
    await expect(promise).rejects.toThrow(new PosHttpError(UNKNOWN_OUTCOME, { url: PAYMENT_API }))
  })

  // addition: P16 a foreign currency sale is read from its own operation
  it('a foreign currency sale reads the foreign currency answer', async () => {
    const { sent, fetchImpl } = bankFetch()
    const p = realGateway(fetchImpl)
    const res = (await p.payment(MODEL.NON_SECURE, order({ currency: 'USD' }), 'pay', card3(p))) as Data
    expect(res.status).toBe('approved')
    expect(sent[0]?.op).toBe('TP_Islem_Odeme_WD')
  })

  // addition: P16 an approval for another order
  it.each([
    ['pay', 'TP_WMD_UCD', { Sonuc: '1', Islem_ID: '6021', Siparis_ID: 'other' }],
    ['pre', 'TP_Islem_Odeme_OnProv_WMD', { Sonuc: '1', Islem_ID: '6021', Siparis_ID: 'other' }],
    ['post', 'TP_Islem_Odeme_OnProv_Kapa', { Sonuc: '1', Siparis_ID: 'other' }],
  ] as Array<[TxType, string, Data]>)('a %s approval for another order is flagged', async (txType, op, result) => {
    const { fetchImpl } = bankFetch({ answer: { [op]: () => soapAnswer(op, result) } })
    const p = realGateway(fetchImpl)
    const promise =
      txType === 'post'
        ? p.payment(MODEL.NON_SECURE, order(), txType)
        : p.payment(MODEL.NON_SECURE, order(), txType, card3(p))
    const err = await mismatch(promise)
    expect(err.field).toBe('order_id')
    expect(err.actual).toBe('other')
    expect(err.paymentMayHaveCompleted).toBe(true)
  })

  // addition: P16 a declined sale is a decline
  it('a declined sale is mapped as declined', async () => {
    const { fetchImpl } = bankFetch({
      answer: {
        TP_WMD_UCD: () => soapAnswer('TP_WMD_UCD', { Sonuc: '-1', Sonuc_Str: 'Kart limiti yetersiz', Islem_ID: '0' }),
      },
    })
    const p = realGateway(fetchImpl)
    const res = (await p.payment(MODEL.NON_SECURE, order(), 'pay', card3(p))) as Data
    expect(res).toMatchObject({ status: 'declined', error_code: '-1', error_message: 'Kart limiti yetersiz' })
  })

  // addition: P17 a cancel or refund answer without a result is an unknown outcome
  it.each([
    ['cancel', () => soapAnswer('TP_Islem_Iptal_Iade_Kismi2', null)],
    ['cancel', () => soapAnswer('TP_Islem_Iptal_Iade_Kismi2', { Sonuc: 'x' })],
    ['cancel', () => new Response(null, { status: 204 })],
    ['refund', () => soapAnswer('TP_Islem_Iptal_Iade_Kismi2', { Sonuc_Str: 'x' })],
    ['refund', () => new Response(null, { status: 204 })],
  ] as Array<['cancel' | 'refund', () => Reply]>)(
    'a %s answered without a result is an unknown outcome',
    async (kind, reply) => {
      const { sent, fetchImpl } = bankFetch({ answer: { TP_Islem_Iptal_Iade_Kismi2: reply } })
      const p = realGateway(fetchImpl)
      const err = await (kind === 'cancel' ? p.cancel(order()) : p.refund(order())).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PosHttpError)
      expect((err as PosHttpError).message).toBe('Bank answer carries no result; the outcome is unknown')
      expect((err as PosHttpError).url).toBe(PAYMENT_API)
      expect(sent).toHaveLength(1)
    },
  )

  it('a pre-authorization cancel answered without a result is an unknown outcome', async () => {
    const { fetchImpl } = bankFetch({
      answer: { TP_Islem_Iptal_OnProv: () => soapAnswer('TP_Islem_Iptal_OnProv', null) },
    })
    await expect(realGateway(fetchImpl).cancel(order({ transaction_type: 'pre' }))).rejects.toThrow(PosHttpError)
  })

  // addition: a declined cancel is the bank's decline
  it('a declined cancel is mapped as declined', async () => {
    const { fetchImpl } = bankFetch({
      answer: {
        TP_Islem_Iptal_Iade_Kismi2: () =>
          soapAnswer('TP_Islem_Iptal_Iade_Kismi2', { Sonuc: '-1', Sonuc_Str: 'İptal edilemez' }),
      },
    })
    expect(await realGateway(fetchImpl).cancel(order())).toMatchObject({ status: 'declined', error_code: '-1' })
  })

  // addition: status is the bank's record, mapped
  it('status maps the bank record', async () => {
    const { sent, fetchImpl } = bankFetch()
    const res = (await realGateway(fetchImpl).status({ id: '20250119BACB' })) as Data
    expect(res).toMatchObject({ status: 'approved', order_id: '20250119BACB', order_status: 'PAYMENT_COMPLETED' })
    expect(sent.map((s) => s.op)).toStrictEqual(['TP_Islem_Sorgulama4'])
  })
})

describe('ParamPos (end to end) masking', () => {
  // addition: C6/P20 nothing secret reaches the logger
  it('never logs the password, the GUID, the card number, the CVV or a callback hash', async () => {
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
          event.requestData.changed = 'yes'
        },
      ],
    }
    const { sent, fetchImpl } = bankFetch({
      answer: {
        TP_WMD_UCD: (body) =>
          body.Islem_Guvenlik_Tip === '3D'
            ? soapAnswer('TP_WMD_UCD', { Sonuc: '-1', Sonuc_Str: `bad ${PASSWORD}` })
            : undefined,
      },
    })
    const p = realGateway(fetchImpl, { logger, hooks })
    const c = card3(p)
    const formOrder: PosOrder = {
      id: 'order222',
      amount: 10.01,
      currency: CURRENCY.TRY,
      installment: 0,
      ip: '127.0.0.1',
      success_url: 'https://domain.com/success',
      fail_url: 'https://domain.com/fail',
    }
    const tampered = { ...CS5, orderId: '202412292161' }
    const tamperedHash = MDH(tampered)

    await p.get3DFormData(formOrder, MODEL.THREE_D_SECURE, 'pay', c).catch(() => undefined)
    await p.get3DFormData(formOrder, MODEL.THREE_D_PAY, 'pay', c)
    await p.payment(MODEL.THREE_D_SECURE, ORDER_MD, 'pay', null, cb(CS5))
    await p
      .payment(MODEL.THREE_D_SECURE, { ...ORDER_MD, id: '202412292161' }, 'pay', null, cb(tampered))
      .catch(() => undefined)
    await p.payment(MODEL.THREE_D_PAY, ORDER_CP1, 'pay', null, cb(CP1))
    await p
      .payment(MODEL.THREE_D_PAY, ORDER_CP1, 'pay', null, cb({ ...CP1, TURKPOS_RETVAL_Tahsilat_Tutari: '1,01' }))
      .catch(() => undefined)
    await p.payment(MODEL.NON_SECURE, formOrder, 'pay', c)
    await p.payment(MODEL.NON_SECURE, formOrder, 'post')
    await p.cancel(formOrder)
    await p.refund(formOrder)
    await p.status({ id: '20250119BACB' })

    const logged = JSON.stringify(records)
    expect(records.length).toBeGreaterThan(0)
    expect(sent.length).toBe(10)
    expect(logged).not.toContain(PASSWORD)
    expect(logged).not.toContain(G)
    expect(logged).not.toContain('5555444433332222')
    expect(logged).not.toMatch(/KK_CVC\\?"\s*:\s*\\?"?122/)
    expect(logged).not.toContain(CS5.islemHash)
    expect(logged).not.toContain(CP1.TURKPOS_RETVAL_Hash)
    expect(logged).not.toContain(tamperedHash)
    expect(logged).not.toContain(TPH({ ...CP1, TURKPOS_RETVAL_Tahsilat_Tutari: '1,01' }))
  })
})
