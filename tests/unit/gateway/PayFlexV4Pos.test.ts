import { createHash } from 'node:crypto'
import iconv from 'iconv-lite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbstractHttpClient } from '../../../src/client/AbstractHttpClient.js'
import { HttpClientStrategy } from '../../../src/client/HttpClientStrategy.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PayFlexV4Pos3DFormHttpClient } from '../../../src/client/PayFlexV4Pos3DFormHttpClient.js'
import { PayFlexV4PosHttpClient } from '../../../src/client/PayFlexV4PosHttpClient.js'
import { PayFlexV4PosSearchApiHttpClient } from '../../../src/client/PayFlexV4PosSearchApiHttpClient.js'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { PayFlexV4PosCrypt } from '../../../src/crypt/PayFlexV4PosCrypt.js'
import { PayFlexV4PosRequestDataMapper } from '../../../src/data-mapper/request/mapper/PayFlexV4PosRequestDataMapper.js'
import type { RequestDataMapperInterface } from '../../../src/data-mapper/request/mapper/RequestDataMapperInterface.js'
import { PayFlexV4PosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/PayFlexV4PosRequestValueFormatter.js'
import { PayFlexV4PosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/PayFlexV4PosRequestValueMapper.js'
import { PayFlexV4PosResponseDataMapper } from '../../../src/data-mapper/response/mapper/PayFlexV4PosResponseDataMapper.js'
import type { ResponseDataMapperInterface } from '../../../src/data-mapper/response/mapper/ResponseDataMapperInterface.js'
import { BasicResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { PayFlexV4PosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PayFlexV4PosResponseValueMapper.js'
import {
  HashMismatchError,
  OrderMismatchError,
  PosError,
  UnsupportedFormFormatError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../src/factory/CreditCardFactory.js'
import type { GatewayConfig, GatewayDeps } from '../../../src/gateway/AbstractGateway.js'
import { PayFlexV4Pos } from '../../../src/gateway/PayFlexV4Pos.js'
import { noopLogger } from '../../../src/logger.js'
import { PayFlexPosAccount } from '../../../src/model/account/PayFlexPosAccount.js'
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

// Dependencies are replaced by vi.fn() fakes; the
// end-to-end section at the bottom uses the real mappers, crypt and HTTP clients over a fake fetch.

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
type Data = Record<string, unknown>

const config: GatewayConfig = {
  name: 'VakifBank-VPOS',
  class: 'PayFlexV4Pos',
  gateway_endpoints: {
    payment_api: 'https://onlineodemetest.vakifbank.com.tr:4443/VposService/v3/Vposreq.aspx',
    gateway_3d: 'https://3dsecuretest.vakifbank.com.tr:4443/MPIAPI/MPI_Enrollment.aspxs',
    query_api: 'https://sanalpos.vakifbank.com.tr/v4/UIWebService/Search.aspx',
  },
}

const account = AccountFactory.createPayFlexPosAccount('vakifbank', '000000000111111', '3XTgER89as', 'VP999999')

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

const enrollmentSuccess = {
  MessageErrorCode: 'code',
  ErrorMessage: 'some error',
  Message: { VERes: { Status: 'Y', PaReq: 'PaReq2', TermUrl: 'TermUrl2', MD: 'MD3', ACSUrl: 'http' } },
}

describe('PayFlexV4Pos (mocked collaborators)', () => {
  let requestValueMapper: PayFlexV4PosRequestValueMapper
  let requestMapper: Mocked<RequestDataMapperInterface>
  let responseMapper: Mocked<ResponseDataMapperInterface>
  let crypt: Mocked<CryptInterface>
  let httpClient: { supportsTx: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }
  let clientStrategy: { getClient: ReturnType<typeof vi.fn>; getAllClients: ReturnType<typeof vi.fn> }
  let requestDataPrepared: ReturnType<typeof vi.fn<(e: RequestDataPreparedEvent) => void>>
  let pos: PayFlexV4Pos

  beforeEach(() => {
    requestValueMapper = new PayFlexV4PosRequestValueMapper()
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
    const hooks: PosHooks = { onRequestDataPrepared: [requestDataPrepared] }
    const deps: GatewayDeps<PayFlexPosAccount> = {
      requestValueMapper,
      requestValueFormatter: new PayFlexV4PosRequestValueFormatter(),
      requestDataMapper: requestMapper as unknown as RequestDataMapperInterface<PayFlexPosAccount>,
      responseDataMapper: responseMapper as unknown as ResponseDataMapperInterface,
      crypt: crypt as unknown as CryptInterface<PayFlexPosAccount>,
      clientStrategy: clientStrategy as unknown as HttpClientStrategy,
      logger: noopLogger,
      hooks,
    }
    pos = new PayFlexV4Pos(config, account, deps)
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
      expect(event.gatewayClass).toBe('PayFlexV4Pos')
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
    expect(PayFlexV4Pos.NAME).toBe('PayFlexV4')
    expect(PayFlexV4Pos.GATEWAY_CLASS).toBe('PayFlexV4Pos')
  })

  it('supported transactions table', () => {
    for (const tx of [TX_TYPE.PAY_AUTH, TX_TYPE.PAY_PRE_AUTH]) {
      expect(PayFlexV4Pos.isSupportedTransaction(tx, MODEL.THREE_D_SECURE)).toBe(true)
      expect(PayFlexV4Pos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(true)
      expect(PayFlexV4Pos.isSupportedTransaction(tx, MODEL.THREE_D_PAY)).toBe(false)
      expect(PayFlexV4Pos.isSupportedTransaction(tx, MODEL.THREE_D_HOST)).toBe(false)
      expect(PayFlexV4Pos.isSupportedTransaction(tx, MODEL.THREE_D_PAY_HOSTING)).toBe(false)
    }
    for (const tx of [TX_TYPE.PAY_POST_AUTH, TX_TYPE.STATUS, TX_TYPE.CANCEL, TX_TYPE.REFUND, TX_TYPE.REFUND_PARTIAL]) {
      expect(PayFlexV4Pos.isSupportedTransaction(tx, MODEL.NON_SECURE)).toBe(true)
    }
    expect(PayFlexV4Pos.isSupportedTransaction(TX_TYPE.ORDER_HISTORY, MODEL.NON_SECURE)).toBe(false)
  })

  // enrollment failures -> PosError with the bank message
  it.each([
    [
      'merchant_not_found',
      {
        Message: { VERes: { Status: 'E' } },
        VerifyEnrollmentRequestId: '0aebb0757acccae6fba75b2e4d78cecf',
        MessageErrorCode: '2005',
        ErrorMessage: 'Merchant cannot be found for this bank',
      },
      'Merchant cannot be found for this bank',
    ],
    // additions: the other non-Y enrollment states
    ['not_enrolled', { Message: { VERes: { Status: 'N' } } }, 'Card is not enrolled in 3-D Secure'],
    ['unavailable', { Message: { VERes: { Status: 'U' } } }, 'Card enrollment could not be checked'],
    // VakıfBank 2026 strict 3D rule: only status Y continues
    ['attempt', { Message: { VERes: { Status: 'A' } } }, 'Unexpected 3-D Secure enrollment status: A'],
    ['missing_veres', { ErrorMessage: '' }, 'Unexpected 3-D Secure enrollment status: '],
  ] as Array<[string, Data, string]>)('get3DFormData enrollment fail: %s', async (_name, response, message) => {
    const txType = TX_TYPE.PAY_AUTH
    const requestData = { request: 'request-data' }
    const order = defaultOrder
    requestMapper.create3DFormInitializeRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      requestData,
      response,
      order,
      MODEL.THREE_D_SECURE,
    )

    const result = pos.get3DFormData(order, MODEL.THREE_D_SECURE, txType, card)

    await expect(result).rejects.toThrow(PosError)
    await expect(result).rejects.toThrow(message)
    expect(requestMapper.create3DFormInitializeRequestData).toHaveBeenCalledWith(
      account,
      order,
      MODEL.THREE_D_SECURE,
      txType,
      card,
    )
    verify()
    expect(requestMapper.create3DFormData).not.toHaveBeenCalled()
  })

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
      'PayFlexV4Pos supports [3d, regular] payment model(s) for transaction type [pay]. Provided payment model: [3d_pay].',
      null,
    ],
    [
      'non_payment_tx_type',
      MODEL.THREE_D_SECURE,
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
      const result = pos.get3DFormData(
        { id: '2020110828BC' },
        paymentModel,
        txType,
        isWithCard ? card : null,
        false,
        formFormat,
      )
      await expect(result).rejects.toThrow(errorClass)
      await expect(result).rejects.toThrow(message)
      expect(requestMapper.create3DFormInitializeRequestData).not.toHaveBeenCalled()
      expect(clientStrategy.getClient).not.toHaveBeenCalled()
    },
  )

  it('get3DFormData without a card is rejected even with createWithoutCard (enrollment needs the card)', async () => {
    await expect(pos.get3DFormData(defaultOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, null, true)).rejects.toThrow(
      'Card data is required for this payment model',
    )
  })

  // 3D form data for standard and sub-merchant accounts
  it.each(['success', 'sub_merchant_success'])('get3DFormData %s', async () => {
    const txType = TX_TYPE.PAY_AUTH
    const paymentModel = MODEL.THREE_D_SECURE
    const order = defaultOrder
    const requestData = { request: 'request-data' }
    requestMapper.create3DFormInitializeRequestData.mockReturnValue(requestData)
    const verify = configureClientResponse(
      TX_TYPE.INTERNAL_3D_FORM_BUILD,
      requestData,
      enrollmentSuccess,
      order,
      paymentModel,
    )
    requestMapper.create3DFormData.mockResolvedValue({ form: '3d-form-data' })

    const result = await pos.get3DFormData(order, paymentModel, txType, card)

    expect(requestMapper.create3DFormInitializeRequestData).toHaveBeenCalledWith(
      account,
      order,
      paymentModel,
      txType,
      card,
    )
    verify()
    expect(requestMapper.create3DFormData).toHaveBeenCalledTimes(1)
    expect(requestMapper.create3DFormData).toHaveBeenCalledWith(
      account,
      null,
      paymentModel,
      txType,
      '',
      null,
      enrollmentSuccess.Message.VERes,
    )
    expect(result).toStrictEqual({ form: '3d-form-data' })
  })

  // Order binding: the callback must carry the order's amount and currency and this account's merchant id
  // (PurchAmount '101' for 1.01).
  const boundOrder: PosOrder = { amount: 1.01, currency: CURRENCY.TRY }
  const boundCallback = { MerchantId: '000000000111111', PurchAmount: '101', PurchCurrency: '949' }

  const make3DPaymentCases: Array<[string, PosOrder, TxType, GatewayResponseData, Data, Data, boolean]> = [
    [
      'auth_fail',
      {},
      TX_TYPE.PAY_AUTH,
      {
        MerchantId: '000000000111111',
        SubMerchantNo: '0',
        ErrorMessage: 'Üye isyeri IP si sistemde tanimli degil',
      },
      {},
      {
        md_status: 'E',
        md_error_message: 'Üye isyeri IP si sistemde tanimli degil',
        order_id: 'order-id-123',
        status: 'declined',
        error_code: '1105',
        error_message: 'Üye isyeri IP si sistemde tanimli degil',
      },
      false,
    ],
    [
      '3d_auth_success_payment_fail',
      boundOrder,
      TX_TYPE.PAY_PRE_AUTH,
      {
        ...boundCallback,
        VerifyEnrollmentRequestId: 'ce06048a3e9c0cd1d437803fb38b5ad0',
        Xid: 'ondg8d9t5besgt88sk8h',
      },
      {
        MerchantId: '000100000013506',
        TransactionType: 'Sale',
        TransactionId: '202303091489',
        ResultCode: '0312',
        ResultDetail: 'RED-GEÇERSİZ KART',
      },
      {
        cavv: 'ABIBCBgAAAEnAAABAQAAAAAAAAA=',
        md_status: 'Y',
        proc_return_code: '0312',
        eci: '05',
        order_id: '202303091489',
        status: 'declined',
        error_code: '0312',
        error_message: 'RED-GEÇERSİZ KART',
      },
      true,
    ],
    [
      'success',
      boundOrder,
      TX_TYPE.PAY_PRE_AUTH,
      {
        ...boundCallback,
        VerifyEnrollmentRequestId: 'ce06048a3e9c0cd1d437803fb38b5ad0',
        Xid: 'ondg8d9t5besgt88sk8h',
        SessionInfo: 'jpf58sdjj8p9mpb9shurh47v64',
        Status: 'Y',
      },
      {
        MerchantId: '000000000111111',
        TerminalNo: 'VP999999',
        TransactionType: 'Sale',
        TransactionId: '20230309B838',
        ResultCode: '0000',
        ResultDetail: 'İŞLEM BAŞARILI',
      },
      { cavv: 'AAABBBBBBBBBBBBBBBIIIIII=', md_status: 'Y', status: 'approved' },
      true,
    ],
  ]

  // The callback hash is verified after a successful 3D authentication. The mapper also receives the callback so it can apply the strict 3D rule.
  it.each(make3DPaymentCases)(
    'make3DPayment %s',
    async (_name, order, txType, gatewayResponseData, paymentResponse, expectedResponse, is3DSuccess) => {
      responseMapper.extractMdStatus.mockReturnValue('3d-status')
      responseMapper.is3dAuthSuccess.mockReturnValue(is3DSuccess)
      responseMapper.map3DPaymentData.mockReturnValue(expectedResponse)
      const create3DPaymentRequestData = { request: 'create3DPaymentRequestData' }
      let verify = () => {}
      if (is3DSuccess) {
        crypt.check3DHash.mockReturnValue(true)
        requestMapper.create3DPaymentRequestData.mockReturnValue(create3DPaymentRequestData)
        verify = configureClientResponse(
          txType,
          create3DPaymentRequestData,
          paymentResponse,
          order,
          MODEL.THREE_D_SECURE,
        )
      }

      const result = await pos.payment(MODEL.THREE_D_SECURE, order, txType, null, gatewayResponseData)

      expect(responseMapper.extractMdStatus).toHaveBeenCalledTimes(1)
      expect(responseMapper.extractMdStatus).toHaveBeenCalledWith(gatewayResponseData)
      expect(responseMapper.is3dAuthSuccess).toHaveBeenCalledTimes(1)
      expect(responseMapper.is3dAuthSuccess).toHaveBeenCalledWith('3d-status', gatewayResponseData)
      expect(responseMapper.map3DPaymentData).toHaveBeenCalledTimes(1)
      if (is3DSuccess) {
        expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
        expect(crypt.check3DHash).toHaveBeenCalledWith(account, gatewayResponseData)
        expect(requestMapper.create3DPaymentRequestData).toHaveBeenCalledWith(
          account,
          order,
          txType,
          gatewayResponseData,
          null,
        )
        verify()
        expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(
          gatewayResponseData,
          paymentResponse,
          txType,
          order,
        )
      } else {
        expect(crypt.check3DHash).not.toHaveBeenCalled()
        expect(responseMapper.map3DPaymentData).toHaveBeenCalledWith(gatewayResponseData, null, txType, order)
        expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
        expect(requestDataPrepared).not.toHaveBeenCalled()
        expect(httpClient.request).not.toHaveBeenCalled()
      }
      expect(result).toBe(expectedResponse)
    },
  )

  it('make3DPayment passes the card to the provision request (PayFlex needs it again)', async () => {
    responseMapper.is3dAuthSuccess.mockReturnValue(true)
    crypt.check3DHash.mockReturnValue(true)
    requestMapper.create3DPaymentRequestData.mockReturnValue({ request: 'x' })
    clientStrategy.getClient.mockReturnValue(httpClient as unknown as AbstractHttpClient)
    httpClient.request.mockResolvedValue({})
    responseMapper.map3DPaymentData.mockReturnValue({ status: 'approved' })
    const data = { Status: 'Y', MerchantId: '000000000111111', PurchAmount: '100.00', PurchCurrency: '949' }

    await pos.payment(MODEL.THREE_D_SECURE, defaultOrder, TX_TYPE.PAY_AUTH, card, data)

    expect(requestMapper.create3DPaymentRequestData).toHaveBeenCalledWith(
      account,
      defaultOrder,
      TX_TYPE.PAY_AUTH,
      data,
      card,
    )
  })

  it('make3DPayment hash mismatch', async () => {
    const data = { Status: 'Y', Eci: '05', Cavv: 'x', Hash: 'wrong' }
    crypt.check3DHash.mockReturnValue(false)
    responseMapper.is3dAuthSuccess.mockReturnValue(true)

    await expect(pos.payment(MODEL.THREE_D_SECURE, {}, TX_TYPE.PAY_AUTH, card, data)).rejects.toThrow(HashMismatchError)
    expect(crypt.check3DHash).toHaveBeenCalledWith(account, data)
    expect(responseMapper.map3DPaymentData).not.toHaveBeenCalled()
    expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
    expect(requestDataPrepared).not.toHaveBeenCalled()
    expect(clientStrategy.getClient).not.toHaveBeenCalled()
  })

  it('make3DPayment order mismatch: checked after the hash, nothing is provisioned or mapped', async () => {
    const data = { Status: 'Y', MerchantId: '000000000111111', PurchAmount: '99.00', PurchCurrency: '949' }
    crypt.check3DHash.mockReturnValue(true)
    responseMapper.is3dAuthSuccess.mockReturnValue(true)

    await expect(pos.payment(MODEL.THREE_D_SECURE, defaultOrder, TX_TYPE.PAY_AUTH, card, data)).rejects.toThrow(
      OrderMismatchError,
    )
    expect(crypt.check3DHash).toHaveBeenCalledTimes(1)
    expect(responseMapper.map3DPaymentData).not.toHaveBeenCalled()
    expect(requestMapper.create3DPaymentRequestData).not.toHaveBeenCalled()
    expect(requestDataPrepared).not.toHaveBeenCalled()
    expect(clientStrategy.getClient).not.toHaveBeenCalled()
  })

  // The payment() guard rejects the
  // unsupported model first, the gateway methods themselves still throw UnsupportedPaymentModelError.
  it.each([MODEL.THREE_D_HOST, MODEL.THREE_D_PAY])('payment with %s is rejected', async (model) => {
    await expect(pos.payment(model, {}, TX_TYPE.PAY_AUTH, null, { abc: 'abc' })).rejects.toThrow(
      UnsupportedTransactionTypeError,
    )
  })

  it('make3DHostPayment', async () => {
    await expect(pos.make3DHostPayment({ abc: 'abc' }, {}, TX_TYPE.PAY_AUTH)).rejects.toThrow(
      UnsupportedPaymentModelError,
    )
  })

  it('make3DPayPayment', async () => {
    await expect(pos.make3DPayPayment({ abc: 'abc' }, {}, TX_TYPE.PAY_AUTH)).rejects.toThrow(
      UnsupportedPaymentModelError,
    )
  })

  it.each([TX_TYPE.PAY_AUTH, TX_TYPE.PAY_PRE_AUTH])('makeRegularPayment %s', async (txType) => {
    const order = { id: '2020110828BC' }
    const requestData = { request: 'createNonSecurePaymentRequestData' }
    requestMapper.createNonSecurePaymentRequestData.mockReturnValue(requestData)
    const decodedResponse = { response: 'decodedData' }
    const verify = configureClientResponse(txType, requestData, decodedResponse, order, MODEL.NON_SECURE)
    responseMapper.mapPaymentResponse.mockReturnValue({ result: true })

    await expect(pos.payment(MODEL.NON_SECURE, order, txType, card)).resolves.toStrictEqual({ result: true })

    expect(requestMapper.createNonSecurePaymentRequestData).toHaveBeenCalledWith(account, order, txType, card)
    verify()
    expect(responseMapper.mapPaymentResponse).toHaveBeenCalledWith(decodedResponse, txType, order)
  })

  it('makeRegularPostAuthPayment', async () => {
    const order = { id: '2020110828BC' }
    const txType = TX_TYPE.PAY_POST_AUTH
    const requestData = { request: 'createNonSecurePostAuthPaymentRequestData' }
    requestMapper.createNonSecurePostAuthPaymentRequestData.mockReturnValue(requestData)
    const decodedResponse = { response: 'decodedData' }
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
    ['refund', TX_TYPE.REFUND, 'createRefundRequestData', 'mapRefundResponse'],
  ] as const)('%s request', async (method, txType, requestMethod, responseMethod) => {
    const order = { id: '2020110828BC' }
    const requestData = { request: requestMethod }
    requestMapper[requestMethod].mockReturnValue(requestData)
    const decodedResponse = { response: 'decodedData' }
    const verify = configureClientResponse(txType, requestData, decodedResponse, order, MODEL.NON_SECURE)
    responseMapper[responseMethod].mockReturnValue({ result: true })

    await expect(pos[method](order)).resolves.toStrictEqual({ result: true })

    if (method === 'refund') {
      expect(requestMapper[requestMethod]).toHaveBeenCalledWith(account, order, txType)
    } else {
      expect(requestMapper[requestMethod]).toHaveBeenCalledWith(account, order)
    }
    verify()
    expect(responseMapper[responseMethod]).toHaveBeenCalledWith(decodedResponse)
  })

  it('orderHistory request', async () => {
    await expect(pos.orderHistory({})).rejects.toThrow(UnsupportedTransactionTypeError)
    expect(requestMapper.createOrderHistoryRequestData).not.toHaveBeenCalled()
  })
})

// ---------- end to end: real mappers, crypt and HTTP clients over a fake fetch ----------

type Sent = { url: string; body: string; contentType: string | null }

const PASSWORD = '3XTgER89as'

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

function realGateway(
  fetchImpl: typeof fetch,
  cfg: GatewayConfig = config,
  realAccount: PayFlexPosAccount = AccountFactory.createPayFlexPosAccount(
    'vakifbank',
    '000000000111111',
    PASSWORD,
    'VP999999',
  ),
) {
  const crypt = new PayFlexV4PosCrypt()
  const valueMapper = new PayFlexV4PosRequestValueMapper()
  const valueFormatter = new PayFlexV4PosRequestValueFormatter()
  const transport = new HttpTransport({ fetch: fetchImpl })
  const endpoints = config.gateway_endpoints
  const deps: GatewayDeps<PayFlexPosAccount> = {
    requestValueMapper: valueMapper,
    requestValueFormatter: valueFormatter,
    requestDataMapper: new PayFlexV4PosRequestDataMapper(valueMapper, valueFormatter, {}, crypt),
    responseDataMapper: new PayFlexV4PosResponseDataMapper(
      new BasicResponseValueFormatter(),
      new PayFlexV4PosResponseValueMapper(),
    ),
    crypt,
    clientStrategy: new HttpClientStrategy([
      new PayFlexV4PosHttpClient(endpoints.payment_api, transport),
      new PayFlexV4Pos3DFormHttpClient(endpoints.gateway_3d as string, transport),
      new PayFlexV4PosSearchApiHttpClient(endpoints.query_api as string, transport),
    ]),
    logger: noopLogger,
    hooks: {},
  }
  return new PayFlexV4Pos(cfg, realAccount, deps)
}

/** The callback hash the bank computes (VakıfBank 2026 Standard API §15), built independently of the crypt. */
function sign(data: Record<string, string>): string {
  const str =
    (data.VerifyEnrollmentRequestId ?? '') +
    (data.MerchantId ?? '') +
    (data.PurchCurrency ?? '') +
    (data.PurchAmount ?? '').replaceAll('.', '') +
    (data.Eci ?? '') +
    (data.Cavv ?? '') +
    (data.MdStatus ?? '') +
    (data.Status ?? '') +
    PASSWORD
  return createHash('sha256').update(iconv.encode(str, 'ISO-8859-9')).digest('base64')
}

/** A full 3D callback as VakıfBank posts it back to the success URL. */
const callback: Record<string, string> = {
  MerchantId: '000000000111111',
  Pan: '5555***2222',
  Expiry: '2112',
  PurchAmount: '100.00',
  PurchCurrency: '949',
  VerifyEnrollmentRequestId: 'ce06048a3e9c0cd1d437803fb38b5ad0',
  Xid: 'ondg8d9t5besgt88sk8h',
  SessionInfo: '',
  Status: 'Y',
  Cavv: 'AAABBBBBBBBBBBBBBBIIIIII=',
  Eci: '05',
  ExpSign: '',
  InstallmentCount: '',
  ErrorCode: '',
  ErrorMessage: '',
}

const provisionApproved =
  '<?xml version="1.0" encoding="utf-8"?><VposResponse><MerchantId>000000000111111</MerchantId>' +
  '<TerminalNo>VP999999</TerminalNo><TransactionType>Sale</TransactionType><TransactionId>20230309B838</TransactionId>' +
  '<ResultCode>0000</ResultCode><ResultDetail>İŞLEM BAŞARILI</ResultDetail><InstallmentTable /><CampaignResult />' +
  '<AuthCode>822641</AuthCode><HostDate>20220404123456</HostDate><Rrn>209411062014</Rrn><CurrencyAmount>100.00</CurrencyAmount>' +
  '<CurrencyCode>949</CurrencyCode><OrderId>order222</OrderId><TLAmount>100.00</TLAmount><ECI>05</ECI>' +
  '<ThreeDSecureType>2</ThreeDSecureType><TransactionDeviceSource>0</TransactionDeviceSource><BatchNo>1</BatchNo></VposResponse>'

const unexpectedNetwork = (): never => {
  throw new Error('no network call expected')
}

/** prmstr XML of a payment API request. */
const prmstr = (req: Sent): string => new URLSearchParams(req.body).get('prmstr') ?? ''

describe('PayFlexV4Pos (end to end)', () => {
  it('provisions a full 3D callback with a valid Hash and maps the bank response', async () => {
    const sent: Sent[] = []
    const pos = realGateway(recordingFetch(sent, () => provisionApproved))
    const data = { ...callback, Hash: sign(callback) }

    const res = await pos.payment(MODEL.THREE_D_SECURE, defaultOrder, TX_TYPE.PAY_AUTH, card, data)

    expect(res.status).toBe('approved')
    expect(res.transaction_id).toBe('20230309B838')
    expect(res.auth_code).toBe('822641')
    expect(res.md_status).toBe('Y')
    expect(res.eci).toBe('05')
    expect(res.amount).toBe(100)
    expect(res.payment_model).toBe(MODEL.THREE_D_SECURE)
    expect(sent).toHaveLength(1)
    const [req] = sent as [Sent]
    expect(req.url).toBe(config.gateway_endpoints.payment_api)
    expect(req.contentType).toBe('application/x-www-form-urlencoded')
    const xml = prmstr(req)
    expect(xml.startsWith('<VposRequest>')).toBe(true)
    expect(xml).toContain('<ECI>05</ECI>')
    expect(xml).toContain('<CAVV>AAABBBBBBBBBBBBBBBIIIIII=</CAVV>')
    expect(xml).toContain('<MpiTransactionId>ce06048a3e9c0cd1d437803fb38b5ad0</MpiTransactionId>')
    expect(xml).toContain('<ClientIp>127.0.0.1</ClientIp>')
  })

  it('provisions a full 3D callback without Hash (banks that do not sign the callback)', async () => {
    const sent: Sent[] = []
    const pos = realGateway(recordingFetch(sent, () => provisionApproved))
    const res = await pos.payment(MODEL.THREE_D_SECURE, defaultOrder, TX_TYPE.PAY_AUTH, card, { ...callback })
    expect(res.status).toBe('approved')
    expect(sent).toHaveLength(1)
  })

  it.each([
    ['empty CAVV', { Cavv: '' }],
    ['MdStatus 2', { Cavv: 'x', MdStatus: '2' }],
    // VakıfBank 2026 strict 3D rule: these are not provisioned
    ['half secure ECI 06', { Eci: '06' }],
    ['half secure ECI 01', { Eci: '01' }],
    ['empty ECI', { Eci: '' }],
    ['one digit ECI', { Eci: '5' }],
    ['Status A', { Status: 'A' }],
    ['Status N', { Status: 'N', ErrorCode: '2005', ErrorMessage: 'Kart 3D Secure programına dahil değil' }],
  ] as Array<[string, Record<string, string>]>)(
    '%s is declined without any HTTP call (even when correctly signed)',
    async (_name, change) => {
      const fetchSpy = vi.fn(unexpectedNetwork)
      const pos = realGateway(fetchSpy as unknown as typeof fetch)
      const data = { ...callback, ...change }

      const res = await pos.payment(MODEL.THREE_D_SECURE, defaultOrder, TX_TYPE.PAY_AUTH, card, {
        ...data,
        Hash: sign(data),
      })

      expect(res.status).toBe('declined')
      expect(res.transaction_id).toBeNull()
      expect(res.auth_code).toBeNull()
      expect(fetchSpy).toHaveBeenCalledTimes(0)
    },
  )

  it('a declined callback reports the bank error', async () => {
    const fetchSpy = vi.fn(unexpectedNetwork)
    const pos = realGateway(fetchSpy as unknown as typeof fetch)
    const res = await pos.payment(MODEL.THREE_D_SECURE, defaultOrder, TX_TYPE.PAY_AUTH, card, {
      ...callback,
      Status: 'N',
      ErrorCode: '2005',
      ErrorMessage: 'Kart 3D Secure programına dahil değil',
    })
    expect(res.md_status).toBe('N')
    expect(res.error_code).toBe('2005')
    expect(res.md_error_message).toBe('Kart 3D Secure programına dahil değil')
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it.each([
    ['wrong', 'wrong-hash'],
    ['empty', ''],
    ['hash of another amount', sign({ ...callback, PurchAmount: '1.00' })],
  ])('a present but %s Hash raises HashMismatchError without an HTTP call', async (_name, hash) => {
    const fetchSpy = vi.fn(unexpectedNetwork)
    const pos = realGateway(fetchSpy as unknown as typeof fetch)
    await expect(
      pos.payment(MODEL.THREE_D_SECURE, defaultOrder, TX_TYPE.PAY_AUTH, card, { ...callback, Hash: hash }),
    ).rejects.toThrow(HashMismatchError)
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('a non-string Hash raises HashMismatchError, never a TypeError', async () => {
    const fetchSpy = vi.fn(unexpectedNetwork)
    const pos = realGateway(fetchSpy as unknown as typeof fetch)
    for (const hash of [undefined, 42, null, ['x'], { a: 1 }]) {
      const data = { ...callback, Hash: hash } as unknown as GatewayResponseData
      await expect(pos.payment(MODEL.THREE_D_SECURE, defaultOrder, TX_TYPE.PAY_AUTH, card, data)).rejects.toThrow(
        HashMismatchError,
      )
    }
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('a declined provision is mapped as declined', async () => {
    const sent: Sent[] = []
    const pos = realGateway(
      recordingFetch(
        sent,
        () =>
          '<VposResponse><TransactionId>T</TransactionId><ResultCode>0312</ResultCode>' +
          '<ResultDetail>RED-GEÇERSİZ KART</ResultDetail><CurrencyCode>949</CurrencyCode></VposResponse>',
      ),
    )
    const res = await pos.payment(MODEL.THREE_D_SECURE, defaultOrder, TX_TYPE.PAY_AUTH, card, { ...callback })
    expect(res.status).toBe('declined')
    expect(res.error_code).toBe('0312')
    expect(res.error_message).toBe('RED-GEÇERSİZ KART')
  })

  it('get3DFormData sends the enrollment request and returns the ACS form', async () => {
    const sent: Sent[] = []
    const pos = realGateway(
      recordingFetch(
        sent,
        () =>
          '<?xml version="1.0" encoding="utf-8"?><IPaySecure><Message ID="ce06048a3e9c0cd1d437803fb38b5ad0"><VERes>' +
          '<Version>1.0.2</Version><Status>Y</Status><PaReq>PAREQ+/=</PaReq><TermUrl>https://bank/term</TermUrl>' +
          '<MD>MD-1</MD><ACSUrl>https://acs.example/pareq</ACSUrl><ACTUALBRAND>100</ACTUALBRAND></VERes></Message>' +
          '<VerifyEnrollmentRequestId>ce06048a3e9c0cd1d437803fb38b5ad0</VerifyEnrollmentRequestId>' +
          '<MessageErrorCode /><ErrorMessage /></IPaySecure>',
      ),
    )

    const form = await pos.get3DFormData(defaultOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)

    expect(form).toStrictEqual({
      gateway: 'https://acs.example/pareq',
      method: 'POST',
      inputs: { PaReq: 'PAREQ+/=', TermUrl: 'https://bank/term', MD: 'MD-1' },
    })
    expect(sent).toHaveLength(1)
    const [req] = sent as [Sent]
    expect(req.url).toBe(config.gateway_endpoints.gateway_3d)
    expect(req.contentType).toBe('application/x-www-form-urlencoded')
    const params = new URLSearchParams(req.body)
    expect(params.get('MerchantId')).toBe('000000000111111')
    expect(params.get('PurchaseAmount')).toBe('100.00')
    expect(params.get('SuccessUrl')).toBe('https://domain.com/success')
    expect(params.get('Pan')).toBe('5555444433332222')
  })

  it('get3DFormData rejects a failed enrollment with the bank message', async () => {
    const pos = realGateway(
      recordingFetch(
        [],
        () =>
          '<IPaySecure><Message ID="x"><VERes><Status>E</Status></VERes></Message>' +
          '<VerifyEnrollmentRequestId>x</VerifyEnrollmentRequestId><MessageErrorCode>2005</MessageErrorCode>' +
          '<ErrorMessage>Merchant cannot be found for this bank</ErrorMessage></IPaySecure>',
      ),
    )
    await expect(pos.get3DFormData(defaultOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)).rejects.toThrow(
      'Merchant cannot be found for this bank',
    )
  })

  it('status goes to the Search API', async () => {
    const sent: Sent[] = []
    const pos = realGateway(
      recordingFetch(
        sent,
        () =>
          '<SearchResponse><ResponseInfo><Status>Error</Status><ResponseCode>9065</ResponseCode>' +
          '<ResponseMessage>Üye isyeri bulunamadi</ResponseMessage></ResponseInfo></SearchResponse>',
      ),
    )
    const res = await pos.status({ id: 'order222' })
    expect(res.status).toBe('declined')
    expect(res.error_code).toBe('9065')
    expect(sent[0]?.url).toBe(config.gateway_endpoints.query_api)
    expect(prmstr(sent[0] as Sent)).toContain('<SearchRequest>')
  })

  it('one instance serves concurrent cancel() calls with independent responses', async () => {
    const pos = realGateway(
      recordingFetch([], async (req) => {
        const ref = /<ReferenceTransactionId>([^<]*)</.exec(prmstr(req))?.[1] ?? ''
        // the first request is answered last
        await new Promise((r) => setTimeout(r, ref === 'TX-A' ? 30 : 0))
        return `<VposResponse><TransactionId>C-${ref}</TransactionId><ResultCode>0000</ResultCode><AuthCode>1</AuthCode></VposResponse>`
      }),
    )

    const [a, b] = await Promise.all([
      pos.cancel({ transaction_id: 'TX-A', ip: '127.0.0.1' }),
      pos.cancel({ transaction_id: 'TX-B', ip: '127.0.0.1' }),
    ])

    expect(a.transaction_id).toBe('C-TX-A')
    expect(b.transaction_id).toBe('C-TX-B')
    expect('isSuccess' in pos).toBe(false)
    expect('getResponse' in pos).toBe(false)
  })

  describe('order binding (amount, currency, merchant) before provisioning', () => {
    const provisions = async (change: Record<string, string | undefined>, order: PosOrder = defaultOrder) => {
      const sent: Sent[] = []
      const pos = realGateway(recordingFetch(sent, () => provisionApproved))
      const data = { ...callback, ...change } as Record<string, string>
      for (const [k, v] of Object.entries(change)) if (v === undefined) delete data[k]
      const res = await pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, card, { ...data, Hash: sign(data) })
      return { res, sent }
    }

    it.each([
      ['major units with a dot and two decimals', '100.00'],
      ['minor units without a dot', '10000'],
    ])('a matching amount in %s provisions', async (_name, purchAmount) => {
      const { res, sent } = await provisions({ PurchAmount: purchAmount })
      expect(res.status).toBe('approved')
      expect(sent).toHaveLength(1)
    })

    it.each(['1.01', '101'])('PurchAmount %j matches an order amount of 1.01', async (purchAmount) => {
      const { sent } = await provisions({ PurchAmount: purchAmount }, { ...defaultOrder, amount: 1.01 })
      expect(sent).toHaveLength(1)
    })

    it.each([
      ['amount', 'another amount', { PurchAmount: '99.99' }, defaultOrder],
      ['amount', 'minor units of another amount', { PurchAmount: '100' }, defaultOrder],
      ['amount', 'a missing amount', { PurchAmount: undefined }, defaultOrder],
      ['amount', 'an empty amount', { PurchAmount: '' }, defaultOrder],
      ['amount', 'an exponent amount', { PurchAmount: '1e4' }, defaultOrder],
      ['amount', 'a non-numeric amount', { PurchAmount: 'abc' }, defaultOrder],
      ['amount', 'a negative amount', { PurchAmount: '-100.00' }, defaultOrder],
      ['amount', 'an order without amount', {}, { ...defaultOrder, amount: undefined }],
      // The §15 hash signs PurchAmount without its dot, so '1.00', '100' and '10.0' carry the same valid hash:
      // only the signed digits (two implied decimals) may be read, never a one- or three-decimal value.
      [
        'amount',
        "'10.0' (signed digits 100 = 1.00) against 10",
        { PurchAmount: '10.0' },
        { ...defaultOrder, amount: 10 },
      ],
      ['amount', "'100.0' (signed digits 1000 = 10.00) against 100", { PurchAmount: '100.0' }, defaultOrder],
      ['amount', "'1.5' against 1.5", { PurchAmount: '1.5' }, { ...defaultOrder, amount: 1.5 }],
      ['amount', "'1.000' against 1", { PurchAmount: '1.000' }, { ...defaultOrder, amount: 1 }],
      ['currency', 'another currency', { PurchCurrency: '840' }, defaultOrder],
      ['currency', 'a missing currency', { PurchCurrency: undefined }, defaultOrder],
      ['currency', 'an order in another currency', {}, { ...defaultOrder, currency: CURRENCY.USD }],
      ['merchant_id', 'another merchant', { MerchantId: '000000000999999' }, defaultOrder],
      ['merchant_id', 'a missing merchant', { MerchantId: undefined }, defaultOrder],
    ] as Array<[string, string, Record<string, string | undefined>, PosOrder]>)(
      '%s: %s raises OrderMismatchError without an HTTP call',
      async (field, _name, change, order) => {
        const fetchSpy = vi.fn(unexpectedNetwork)
        const pos = realGateway(fetchSpy as unknown as typeof fetch)
        const data = { ...callback, ...change } as Record<string, string>
        for (const [k, v] of Object.entries(change)) if (v === undefined) delete data[k]

        const err = await pos
          .payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, card, { ...data, Hash: sign(data) })
          .catch((e: unknown) => e)

        expect(err).toBeInstanceOf(OrderMismatchError)
        expect((err as OrderMismatchError).field).toBe(field)
        expect((err as OrderMismatchError).paymentMayHaveCompleted).toBe(false)
        expect(fetchSpy).toHaveBeenCalledTimes(0)
      },
    )

    it('an order without currency is bound to TRY (the request default)', async () => {
      const { sent } = await provisions({}, { ...defaultOrder, currency: undefined })
      expect(sent).toHaveLength(1)
    })

    const subAccount = () =>
      AccountFactory.createPayFlexPosAccount(
        'vakifbank',
        '000000000111111',
        PASSWORD,
        'VP999999',
        PayFlexPosAccount.MERCHANT_TYPE_SUB_DEALER,
        '000000000222222',
      )

    // VakifBank 2026 guide §15: for dealers the callback MerchantId is the sub-dealer number
    it.each([
      ['the main merchant id', '000000000111111'],
      ['the sub-dealer number', '000000000222222'],
    ])('a sub-branch account accepts %s', async (_name, merchantId) => {
      const sent: Sent[] = []
      const pos = realGateway(
        recordingFetch(sent, () => provisionApproved),
        config,
        subAccount(),
      )
      const data = { ...callback, MerchantId: merchantId }
      const res = await pos.payment(MODEL.THREE_D_SECURE, defaultOrder, TX_TYPE.PAY_AUTH, card, {
        ...data,
        Hash: sign(data),
      })
      expect(res.status).toBe('approved')
      expect(sent).toHaveLength(1)
    })

    it('a sub-branch account rejects any third merchant id without an HTTP call', async () => {
      const fetchSpy = vi.fn(unexpectedNetwork)
      const pos = realGateway(fetchSpy as unknown as typeof fetch, config, subAccount())
      const err = await pos
        .payment(MODEL.THREE_D_SECURE, defaultOrder, TX_TYPE.PAY_AUTH, card, {
          ...callback,
          MerchantId: '000000000333333',
        })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(OrderMismatchError)
      expect((err as OrderMismatchError).field).toBe('merchant_id')
      expect(fetchSpy).toHaveBeenCalledTimes(0)
    })

    it('a non sub-branch account rejects a sub-dealer number without an HTTP call', async () => {
      const mainDealer = AccountFactory.createPayFlexPosAccount(
        'vakifbank',
        '000000000111111',
        PASSWORD,
        'VP999999',
        PayFlexPosAccount.MERCHANT_TYPE_MAIN_DEALER,
        '000000000222222',
      )
      const fetchSpy = vi.fn(unexpectedNetwork)
      const pos = realGateway(fetchSpy as unknown as typeof fetch, config, mainDealer)
      await expect(
        pos.payment(MODEL.THREE_D_SECURE, defaultOrder, TX_TYPE.PAY_AUTH, card, {
          ...callback,
          MerchantId: '000000000222222',
        }),
      ).rejects.toThrow(OrderMismatchError)
      expect(fetchSpy).toHaveBeenCalledTimes(0)
    })
  })

  describe('require_3d_hash', () => {
    const strictConfig: GatewayConfig = { ...config, require_3d_hash: true }

    it('true: a callback without Hash raises HashMismatchError without an HTTP call', async () => {
      const fetchSpy = vi.fn(unexpectedNetwork)
      const pos = realGateway(fetchSpy as unknown as typeof fetch, strictConfig)
      await expect(
        pos.payment(MODEL.THREE_D_SECURE, defaultOrder, TX_TYPE.PAY_AUTH, card, { ...callback }),
      ).rejects.toThrow(HashMismatchError)
      expect(fetchSpy).toHaveBeenCalledTimes(0)
    })

    it('true: a callback with a valid Hash provisions', async () => {
      const sent: Sent[] = []
      const pos = realGateway(
        recordingFetch(sent, () => provisionApproved),
        strictConfig,
      )
      const res = await pos.payment(MODEL.THREE_D_SECURE, defaultOrder, TX_TYPE.PAY_AUTH, card, {
        ...callback,
        Hash: sign(callback),
      })
      expect(res.status).toBe('approved')
      expect(sent).toHaveLength(1)
    })

    it('true: a declined callback without Hash is still mapped as declined (no hash use)', async () => {
      const fetchSpy = vi.fn(unexpectedNetwork)
      const pos = realGateway(fetchSpy as unknown as typeof fetch, strictConfig)
      const res = await pos.payment(MODEL.THREE_D_SECURE, defaultOrder, TX_TYPE.PAY_AUTH, card, {
        ...callback,
        Eci: '06',
      })
      expect(res.status).toBe('declined')
      expect(fetchSpy).toHaveBeenCalledTimes(0)
    })

    it.each([undefined, false])('%s (default): a callback without Hash provisions', async (requireHash) => {
      const sent: Sent[] = []
      const pos = realGateway(
        recordingFetch(sent, () => provisionApproved),
        { ...config, require_3d_hash: requireHash },
      )
      const res = await pos.payment(MODEL.THREE_D_SECURE, defaultOrder, TX_TYPE.PAY_AUTH, card, { ...callback })
      expect(res.status).toBe('approved')
      expect(sent).toHaveLength(1)
    })
  })
})
