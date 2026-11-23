import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayFlexV4PosResponseDataMapper } from '../../../../../src/data-mapper/response/mapper/PayFlexV4PosResponseDataMapper.js'
import { BasicResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import type { ResponseValueFormatterInterface } from '../../../../../src/data-mapper/response/value-formatter/ResponseValueFormatterInterface.js'
import { PayFlexV4PosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/PayFlexV4PosResponseValueMapper.js'
import type { ResponseValueMapperInterface } from '../../../../../src/data-mapper/response/value-mapper/ResponseValueMapperInterface.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import { noopLogger } from '../../../../../src/logger.js'
import { CURRENCY, MODEL, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
type Data = Record<string, unknown>

/** Bank wall-clock time in Türkiye (UTC+03:00). */
const tr = (y: number, m: number, d: number, h = 0, i = 0, s = 0): Date => new Date(Date.UTC(y, m - 1, d, h - 3, i, s))

/** The current year in Türkiye (for Ziraat's yearless HostDate). */
const currentBankYear = (): number => new Date(Date.now() + 3 * 3600 * 1000).getUTCFullYear()

/** PHP ksort + assertSame: same keys (any order) with identical values. */
function expectSameSorted(actual: Data, expected: Data): void {
  expect(Object.keys(actual).sort()).toStrictEqual(Object.keys(expected).sort())
  expect(actual).toStrictEqual(expected)
}

/** PHP assertSame without ksort: same keys in the same order. */
function expectSame(actual: Data, expected: Data): void {
  expect(actual).toStrictEqual(expected)
  expect(Object.keys(actual)).toStrictEqual(Object.keys(expected))
}

/** `assertArrayHasKey` + `assertIsArray` + `assertNotEmpty`, then `unset`. */
function takeNonEmpty(actual: Data, key: string): void {
  expect(actual).toHaveProperty(key)
  const value = actual[key]
  expect(value !== null && typeof value === 'object').toBe(true)
  expect(Object.keys(value as Data).length).toBeGreaterThan(0)
  delete actual[key]
}

/** Loose comparison: the mapper sees bank values after emptyStringsToNull ('' -> null). */
const arg = (value: unknown): unknown => (typeof value === 'string' && value.trim() === '' ? null : value)

const statusTestDataProvider: Array<[string, { responseData: Data; expectedData: Data }]> = [
  [
    'fail1',
    {
      responseData: {
        ResponseInfo: {
          Status: 'Error',
          ResponseCode: '9065',
          ResponseMessage: 'Üye isyeri bulunamadi',
          ResponseDateTime: '2023-05-27T13:58:53.0340773+03:00',
          IsIdempotent: 'false',
        },
      },
      expectedData: {
        order_id: null,
        auth_code: null,
        proc_return_code: '9065',
        transaction_id: null,
        transaction_type: null,
        ref_ret_num: null,
        order_status: null,
        first_amount: null,
        capture_amount: null,
        currency: null,
        status: 'declined',
        error_code: '9065',
        error_message: 'Üye isyeri bulunamadi',
        masked_number: null,
        capture: null,
        capture_time: null,
        transaction_time: null,
        cancel_time: null,
        refund_amount: null,
        refund_time: null,
        installment_count: null,
      },
    },
  ],
  [
    'success_pay',
    {
      responseData: {
        ResponseInfo: {
          Status: 'Success',
          ResponseCode: '0000',
          ResponseMessage: 'Succeeded.',
          ResponseDateTime: '2023-05-27T13:58:53.0340773+03:00',
          IsIdempotent: 'false',
        },
        PageIndex: 1,
        PageSize: 10,
        TotalItemCount: 1,
        TransactionSearchResultInfo: {
          TransactionSearchResultInfo: {
            MerchantId: '655500056',
            TransactionType: 'Sale',
            TransactionId: 'b2d71cc5-d242-4b01-8479-d56eb8f74d7c',
            OrderId: 'z2d71cc5-d242-4b01-8479-d56eb8f74d7',
            ResultCode: '0000',
            ResponseMessage: 'İŞLEM BAŞARILI',
            HostResultCode: '000',
            AuthCode: '11234',
            HostDate: '1130145930',
            Rrn: '201101240006',
            CurrencyAmount: '90.50',
            AmountCode: '949',
            CurrencyCode: '',
            ThreeDSecureType: '1',
            GainedPoint: '0',
            TotalPoint: '100',
            SurchargeAmount: '92.50',
            Extract: '090020304',
            IsReversed: 'false',
            IsCanceled: 'false',
            IsRefunded: 'false',
            CustomItems: { CustomItem: { Name: 'Kontrol1', Value: '01' } },
          },
        },
      },
      expectedData: {
        order_id: 'z2d71cc5-d242-4b01-8479-d56eb8f74d7',
        auth_code: '11234',
        proc_return_code: '0000',
        transaction_id: 'b2d71cc5-d242-4b01-8479-d56eb8f74d7c',
        ref_ret_num: '201101240006',
        order_status: 'PAYMENT_COMPLETED',
        transaction_type: 'pay',
        first_amount: 90.5,
        capture_amount: null,
        currency: CURRENCY.TRY,
        status: 'approved',
        error_code: null,
        error_message: null,
        masked_number: null,
        capture: null,
        capture_time: null,
        transaction_time: null,
        cancel_time: null,
        refund_amount: null,
        refund_time: null,
        installment_count: null,
      },
    },
  ],
]

const refundDataProvider: Array<[string, { responseData: Data; expectedData: Data }]> = [
  [
    'success_1',
    {
      responseData: {
        MerchantId: '000100000013506',
        TransactionType: 'Refund',
        TransactionId: '455ae6c09140434ea6edafc0018acbb9',
        ReferenceTransactionId: '6d491ea480564068976fafc0018a9def',
        ResultCode: '0000',
        ResultDetail: 'İŞLEM BAŞARILI',
        InstallmentTable: null,
        CampaignResult: null,
        AuthCode: '752800',
        HostDate: '20230309235724',
        Rrn: '306823971382',
        TerminalNo: 'VP000579',
        CurrencyAmount: '1.01',
        CurrencyCode: '949',
        BatchNo: '300',
        TLAmount: '1.01',
      },
      expectedData: {
        order_id: '455ae6c09140434ea6edafc0018acbb9',
        auth_code: '752800',
        ref_ret_num: '306823971382',
        proc_return_code: '0000',
        transaction_id: '455ae6c09140434ea6edafc0018acbb9',
        error_code: null,
        error_message: null,
        status: 'approved',
      },
    },
  ],
  [
    'fail_1',
    {
      responseData: { ResultCode: '1059', ResultDetail: 'İşlemin tamamı iade edilmiş.', InstallmentTable: null },
      expectedData: {
        order_id: null,
        auth_code: null,
        ref_ret_num: null,
        proc_return_code: '1059',
        transaction_id: null,
        error_code: '1059',
        error_message: 'İşlemin tamamı iade edilmiş.',
        status: 'declined',
      },
    },
  ],
]

const cancelDataProvider: Array<[string, { responseData: Data; expectedData: Data }]> = [
  [
    'success_1',
    {
      responseData: {
        MerchantId: '000100000013506',
        TransactionType: 'Cancel',
        TransactionId: '4a8e979308de4568b500afc00187a501',
        ReferenceTransactionId: '3f30ab117aa74826b448afc0018789fa',
        ResultCode: '0000',
        ResultDetail: 'İŞLEM BAŞARILI',
        InstallmentTable: null,
        CampaignResult: null,
        AuthCode: '836044',
        HostDate: '20230309234556',
        Rrn: '306823971363',
        TerminalNo: 'VP000579',
        CurrencyAmount: '1.01',
        CurrencyCode: '949',
        BatchNo: '300',
        TLAmount: '1.01',
      },
      expectedData: {
        order_id: '4a8e979308de4568b500afc00187a501',
        auth_code: '836044',
        ref_ret_num: '306823971363',
        proc_return_code: '0000',
        transaction_id: '4a8e979308de4568b500afc00187a501',
        error_code: null,
        error_message: null,
        status: 'approved',
      },
    },
  ],
  [
    'fail_1',
    {
      responseData: {
        ResultCode: '1083',
        ResultDetail: 'Referans islem daha önceden iptal edilmis.',
        InstallmentTable: null,
      },
      expectedData: {
        order_id: null,
        auth_code: null,
        ref_ret_num: null,
        proc_return_code: '1083',
        transaction_id: null,
        error_code: '1083',
        error_message: 'Referans islem daha önceden iptal edilmis.',
        status: 'declined',
      },
    },
  ],
]

type PaymentCase = { txType: TxType; responseData: Data; expectedData: Data }

const salePayment = (hostDate: string): Data => ({
  MerchantId: '000100000013506',
  TransactionType: 'Sale',
  TransactionId: '9972767117b3400eb2acafc0018643df',
  ResultCode: '0000',
  ResultDetail: 'İŞLEM BAŞARILI',
  CustomItems: { Item: { '@name': 'CardHolderName', '@value': 'AR* ÖZ*', '#': null } },
  InstallmentTable: null,
  CampaignResult: null,
  AuthCode: '961451',
  HostDate: hostDate,
  Rrn: '306823971358',
  TerminalNo: 'VP000579',
  GainedPoint: '10.00',
  TotalPoint: '103032.52',
  CurrencyAmount: '1.01',
  CurrencyCode: '949',
  OrderId: '202303095646',
  ThreeDSecureType: '1',
  TransactionDeviceSource: '0',
  BatchNo: '300',
  TLAmount: '1.01',
})

const saleExpected = (time: Date): Data => ({
  transaction_id: '9972767117b3400eb2acafc0018643df',
  transaction_type: 'pay',
  transaction_time: time,
  auth_code: '961451',
  ref_ret_num: '9972767117b3400eb2acafc0018643df',
  batch_num: '300',
  order_id: '202303095646',
  proc_return_code: '0000',
  status: 'approved',
  error_code: null,
  error_message: null,
  currency: 'TRY',
  amount: 1.01,
  payment_model: 'regular',
  installment_count: null,
})

const paymentDataProvider = (): Array<[string, PaymentCase]> => [
  [
    'success_1',
    {
      txType: TX_TYPE.PAY_PRE_AUTH,
      responseData: salePayment('20230309234054'),
      expectedData: saleExpected(tr(2023, 3, 9, 23, 40, 54)),
    },
  ],
  [
    'success_with_short_host_date',
    {
      txType: TX_TYPE.PAY_PRE_AUTH,
      responseData: salePayment('0309234054'),
      expectedData: saleExpected(tr(currentBankYear(), 3, 9, 23, 40, 54)),
    },
  ],
  [
    'fail_1',
    {
      txType: TX_TYPE.PAY_PRE_AUTH,
      responseData: {
        MerchantId: '000100000013506',
        TransactionType: 'Sale',
        TransactionId: '9b47227c275246d39454afc00186dfba',
        ResultCode: '0312',
        ResultDetail: 'RED-GEÇERSİZ KART',
        InstallmentTable: null,
        CampaignResult: null,
        AuthCode: '000000',
        HostDate: '20230309234307',
        Rrn: '306823971359',
        TerminalNo: 'VP000579',
        CurrencyAmount: '1.01',
        CurrencyCode: '949',
        OrderId: '20230309EF68',
        ThreeDSecureType: '1',
        TransactionDeviceSource: '0',
        BatchNo: '300',
        TLAmount: '1.01',
      },
      expectedData: {
        transaction_id: null,
        transaction_type: 'pay',
        transaction_time: null,
        auth_code: null,
        ref_ret_num: null,
        batch_num: null,
        order_id: '20230309EF68',
        proc_return_code: '0312',
        status: 'declined',
        error_code: '0312',
        error_message: 'RED-GEÇERSİZ KART',
        currency: 'TRY',
        amount: 1.01,
        payment_model: 'regular',
        installment_count: null,
      },
    },
  ],
  [
    'fail_2',
    {
      txType: TX_TYPE.PAY_AUTH,
      responseData: { ResultCode: '9039', ResultDetail: 'Üye işyeri bulunamadı.', InstallmentTable: '' },
      expectedData: {
        transaction_id: null,
        transaction_type: null,
        transaction_time: null,
        auth_code: null,
        ref_ret_num: null,
        batch_num: null,
        order_id: null,
        proc_return_code: '9039',
        status: 'declined',
        error_code: '9039',
        error_message: 'Üye işyeri bulunamadı.',
        currency: null,
        amount: null,
        payment_model: null,
        installment_count: null,
      },
    },
  ],
]

type ThreeDCase = {
  order: PosOrder
  txType: TxType
  threeDResponseData: Data
  paymentData: Data
  expectedData: Data
}

const threeDPaymentDataProvider: Array<[string, ThreeDCase]> = [
  [
    '3d_auth_fail',
    {
      order: {},
      txType: TX_TYPE.PAY_AUTH,
      threeDResponseData: {
        MerchantId: '000000000111111',
        SubMerchantNo: '0',
        SubMerchantName: null,
        SubMerchantNumber: null,
        PurchAmount: 100,
        PurchCurrency: '949',
        VerifyEnrollmentRequestId: 'order-id-123',
        SessionInfo: { data: 'sss' },
        InstallmentCount: null,
        Pan: '5555444433332222',
        Expiry: 'hj',
        Xid: 'xid0393i3kdkdlslsls',
        Status: 'E', // other error states: N, U
        Cavv: 'AAABBBBBBBBBBBBBBBIIIIII=',
        Eci: '02',
        ExpSign: '',
        ErrorCode: '1105',
        ErrorMessage: 'Üye isyeri IP si sistemde tanimli degil',
      },
      paymentData: {},
      expectedData: {
        eci: '02',
        cavv: 'AAABBBBBBBBBBBBBBBIIIIII=',
        md_status: 'E',
        md_error_message: 'Üye isyeri IP si sistemde tanimli degil',
        transaction_id: null,
        transaction_type: 'pay',
        transaction_time: null,
        transaction_security: null,
        ref_ret_num: null,
        batch_num: null,
        proc_return_code: null,
        auth_code: null,
        order_id: 'order-id-123',
        status: 'declined',
        error_code: '1105',
        error_message: 'Üye isyeri IP si sistemde tanimli degil',
        amount: null,
        currency: 'TRY',
        payment_model: null,
        installment_count: 0,
      },
    },
  ],
  [
    '3d_auth_success_payment_fail',
    {
      order: {},
      txType: TX_TYPE.PAY_PRE_AUTH,
      threeDResponseData: {
        MerchantId: '000100000013506',
        Pan: '4938460158754205',
        Expiry: '2411',
        PurchAmount: '101',
        PurchCurrency: '949',
        VerifyEnrollmentRequestId: 'ce06048a3e9c0cd1d437803fb38b5ad0',
        Xid: 'ondg8d9t5besgt88sk8h',
        SessionInfo: 'jpf58sdjj8p9mpb9shurh47v64',
        Status: 'Y',
        Cavv: 'ABIBCBgAAAEnAAABAQAAAAAAAAA=',
        Eci: '05',
        ExpSign: null,
        InstallmentCount: null,
        SubMerchantNo: null,
        SubMerchantName: null,
        SubMerchantNumber: null,
        ErrorCode: null,
        ErrorMessage: null,
      },
      paymentData: {
        MerchantId: '000100000013506',
        TransactionType: 'Sale',
        TransactionId: '202303091489',
        ResultCode: '0312',
        ResultDetail: 'RED-GEÇERSİZ KART',
        InstallmentTable: null,
        CampaignResult: null,
        AuthCode: '000000',
        HostDate: '20230309235359',
        Rrn: '306823971380',
        TerminalNo: 'VP000579',
        CurrencyAmount: '1.01',
        CurrencyCode: '949',
        OrderId: '202303091489',
        ECI: '05',
        ThreeDSecureType: '2',
        TransactionDeviceSource: '0',
        BatchNo: '300',
        TLAmount: '1.01',
      },
      expectedData: {
        cavv: 'ABIBCBgAAAEnAAABAQAAAAAAAAA=',
        md_status: 'Y',
        md_error_message: null,
        transaction_id: null,
        transaction_type: 'pay',
        transaction_time: null,
        transaction_security: null,
        ref_ret_num: null,
        batch_num: null,
        proc_return_code: '0312',
        eci: '05',
        auth_code: null,
        order_id: '202303091489',
        status: 'declined',
        error_code: '0312',
        error_message: 'RED-GEÇERSİZ KART',
        amount: 1.01,
        currency: 'TRY',
        payment_model: '3d',
        installment_count: 0,
      },
    },
  ],
  [
    'success1',
    {
      order: {},
      txType: TX_TYPE.PAY_PRE_AUTH,
      threeDResponseData: {
        MerchantId: '000000000111111',
        SubMerchantNo: '0',
        SubMerchantName: null,
        SubMerchantNumber: null,
        PurchAmount: 100,
        PurchCurrency: '949',
        VerifyEnrollmentRequestId: 'order-id-123',
        SessionInfo: { data: 'sss' },
        InstallmentCount: null,
        Pan: '5555444433332222',
        Expiry: 'cv',
        Xid: 'xid0393i3kdkdlslsls',
        Status: 'Y',
        Cavv: 'AAABBBBBBBBBBBBBBBIIIIII=',
        Eci: '02',
        ExpSign: null,
        ErrorCode: null,
        ErrorMessage: null,
      },
      paymentData: {
        MerchantId: '000000000111111',
        TerminalNo: 'VP999999',
        TransactionType: 'Sale',
        TransactionId: '20230309B838',
        ResultCode: '0000',
        ResultDetail: 'İŞLEM BAŞARILI',
        CustomItems: {},
        InstallmentTable: null,
        CampaignResult: null,
        AuthCode: '822641',
        HostDate: '20220404123456',
        Rrn: '209411062014',
        CurrencyAmount: 100,
        CurrencyCode: '949',
        OrderId: 'order-id-123',
        TLAmount: 100,
        ECI: '02',
        ThreeDSecureType: '2',
        TransactionDeviceSource: '0',
        BatchNo: '1',
      },
      expectedData: {
        cavv: 'AAABBBBBBBBBBBBBBBIIIIII=',
        md_status: 'Y',
        md_error_message: null,
        transaction_id: '20230309B838',
        transaction_type: 'pay',
        transaction_time: tr(2022, 4, 4, 12, 34, 56),
        transaction_security: null,
        ref_ret_num: '20230309B838',
        batch_num: '1',
        proc_return_code: '0000',
        eci: '02',
        auth_code: '822641',
        order_id: 'order-id-123',
        status: 'approved',
        error_code: null,
        error_message: null,
        amount: 100.0,
        currency: 'TRY',
        payment_model: '3d',
        installment_count: 0,
      },
    },
  ],
]

/** A full-3D callback that passes the strict rule. */
const strictSuccess: Data = {
  MerchantId: '000000000111111',
  PurchAmount: '100',
  PurchCurrency: '949',
  VerifyEnrollmentRequestId: 'order-id-123',
  InstallmentCount: null,
  Status: 'Y',
  Cavv: 'AAABBBBBBBBBBBBBBBIIIIII=',
  Eci: '05',
  ErrorCode: null,
  ErrorMessage: null,
}

describe('PayFlexV4PosResponseDataMapper', () => {
  let formatter: Mocked<ResponseValueFormatterInterface>
  let valueMapper: Mocked<ResponseValueMapperInterface>
  let mapper: PayFlexV4PosResponseDataMapper

  beforeEach(() => {
    formatter = { formatInstallment: vi.fn(), formatAmount: vi.fn(), formatDateTime: vi.fn() }
    valueMapper = {
      mapTxType: vi.fn(),
      mapSecureType: vi.fn(),
      mapCurrency: vi.fn(),
      mapOrderStatus: vi.fn(),
      mapCardType: vi.fn(),
      mapCardFamilyName: vi.fn(),
      mapCardClass: vi.fn(),
    }
    mapper = new PayFlexV4PosResponseDataMapper(
      formatter as unknown as ResponseValueFormatterInterface,
      valueMapper as unknown as ResponseValueMapperInterface,
      noopLogger,
    )
  })

  const integrationMapper = () =>
    new PayFlexV4PosResponseDataMapper(new BasicResponseValueFormatter(), new PayFlexV4PosResponseValueMapper())

  it('supports', () => {
    expect(PayFlexV4PosResponseDataMapper.supports('PayFlexV4Pos')).toBe(true)
    expect(PayFlexV4PosResponseDataMapper.supports('AkbankPos')).toBe(false)
  })

  it('uses the PayFlex procedure success code', () => {
    expect(PayFlexV4PosResponseDataMapper.PROCEDURE_SUCCESS_CODE).toBe('0000')
  })

  // The status alone (no callback data) is passed.
  it.each([
    [null, false],
    ['', false],
    ['A', false],
    // VakıfBank 2026 strict 3D rule: without the callback data
    // (Eci, Cavv) the strict rule cannot be satisfied.
    ['Y', false],
  ])('is3dAuthSuccess(%j) -> %j', (mdStatus, expected) => {
    expect(mapper.is3dAuthSuccess(mdStatus)).toBe(expected)
  })

  describe('is3dAuthSuccess strict 3D rule', () => {
    it.each([
      ['full 3D, ECI 05', {}, true],
      ['full 3D, ECI 02', { Eci: '02' }, true],
      ['MdStatus 1', { MdStatus: '1' }, true],
      ['empty MdStatus counts as absent', { MdStatus: '' }, true],
      // VakıfBank 2026 strict 3D rule: Status 'Y' alone is not enough
      ['half secure ECI 06', { Eci: '06' }, false],
      ['half secure ECI 01', { Eci: '01' }, false],
      ['ECI 07', { Eci: '07' }, false],
      ['empty ECI', { Eci: '' }, false],
      ['missing ECI', { Eci: undefined }, false],
      ['one digit ECI 5', { Eci: '5' }, false],
      ['padded ECI " 05"', { Eci: ' 05' }, false],
      ['numeric ECI', { Eci: 5 }, false],
      ['empty CAVV', { Cavv: '' }, false],
      ['blank CAVV', { Cavv: '   ' }, false],
      ['missing CAVV', { Cavv: undefined }, false],
      ['MdStatus 2', { MdStatus: '2' }, false],
      ['MdStatus 0', { MdStatus: '0' }, false],
      ['Status A (attempt)', { Status: 'A' }, false],
      ['Status N', { Status: 'N' }, false],
      ['Status y (lower case)', { Status: 'y' }, false],
    ] as Array<[string, Data, boolean]>)('%s -> %j', (_name, change, expected) => {
      const data: Data = { ...strictSuccess, ...change }
      for (const [k, v] of Object.entries(change)) if (v === undefined) delete data[k]
      expect(mapper.is3dAuthSuccess(mapper.extractMdStatus(data), data)).toBe(expected)
    })

    it('the extracted status must match the callback Status', () => {
      expect(mapper.is3dAuthSuccess('Y', { ...strictSuccess, Status: 'A' })).toBe(false)
      expect(mapper.is3dAuthSuccess('A', strictSuccess)).toBe(false)
    })

    it('rejects prototype-only fields', () => {
      const data = Object.create({ Eci: '05', Cavv: 'x' }) as Data
      data.Status = 'Y'
      expect(mapper.is3dAuthSuccess('Y', data)).toBe(false)
    })
  })

  it.each([
    [{}, null],
    [{ Status: 'Y' }, 'Y'],
    [{ Status: 'Y' }, 'Y'],
  ])('extractMdStatus(%j) -> %j', (responseData, expected) => {
    expect(mapper.extractMdStatus(responseData)).toBe(expected)
  })

  it.each(threeDPaymentDataProvider)(
    'map3DPaymentData %s',
    (_name, { order, txType, threeDResponseData, paymentData: paymentResponse, expectedData }) => {
      if (paymentResponse.TLAmount !== undefined) formatter.formatAmount.mockReturnValueOnce(expectedData.amount)
      if (paymentResponse.TransactionType !== undefined)
        valueMapper.mapTxType.mockReturnValueOnce(expectedData.transaction_type)
      if (paymentResponse.ThreeDSecureType !== undefined)
        valueMapper.mapSecureType.mockReturnValueOnce(expectedData.payment_model)
      if (expectedData.transaction_time instanceof Date)
        formatter.formatDateTime.mockReturnValueOnce(expectedData.transaction_time)
      formatter.formatInstallment.mockReturnValueOnce(expectedData.installment_count)
      valueMapper.mapCurrency.mockReturnValueOnce(expectedData.currency)

      const actual: Data = mapper.map3DPaymentData(threeDResponseData, paymentResponse, txType, order)

      if (paymentResponse.TLAmount !== undefined) {
        expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
        expect(formatter.formatAmount).toHaveBeenCalledWith(paymentResponse.TLAmount, txType)
      }
      if (paymentResponse.TransactionType !== undefined) {
        expect(valueMapper.mapTxType).toHaveBeenCalledTimes(1)
        expect(valueMapper.mapTxType.mock.calls[0]?.[0]).toBe(paymentResponse.TransactionType)
      }
      if (paymentResponse.ThreeDSecureType !== undefined) {
        expect(valueMapper.mapSecureType).toHaveBeenCalledTimes(1)
        expect(valueMapper.mapSecureType.mock.calls[0]?.[0]).toBe(paymentResponse.ThreeDSecureType)
      }
      if (expectedData.transaction_time instanceof Date) {
        expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
        expect(formatter.formatDateTime).toHaveBeenCalledWith(paymentResponse.HostDate, txType)
      }
      expect(formatter.formatInstallment).toHaveBeenCalledTimes(1)
      expect(formatter.formatInstallment).toHaveBeenCalledWith(arg(threeDResponseData.InstallmentCount), txType)
      expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapCurrency).toHaveBeenCalledWith(
        paymentResponse.CurrencyCode ?? threeDResponseData.PurchCurrency,
        txType,
      )

      expect(actual).toHaveProperty('all')
      if (Object.keys(paymentResponse).length > 0) {
        takeNonEmpty(actual, 'all')
      } else {
        delete actual.all
      }
      takeNonEmpty(actual, '3d_all')
      expectSameSorted(actual, expectedData)
    },
  )

  it.each(paymentDataProvider())('mapPaymentResponse %s', (_name, { txType, responseData, expectedData }) => {
    if (responseData.TLAmount !== undefined) formatter.formatAmount.mockReturnValueOnce(expectedData.amount)
    if (responseData.TransactionType !== undefined)
      valueMapper.mapTxType.mockReturnValueOnce(expectedData.transaction_type)
    if (responseData.ThreeDSecureType !== undefined)
      valueMapper.mapSecureType.mockReturnValueOnce(expectedData.payment_model)
    if (expectedData.transaction_time instanceof Date)
      formatter.formatDateTime.mockReturnValueOnce(expectedData.transaction_time)
    if (responseData.CurrencyCode !== undefined) valueMapper.mapCurrency.mockReturnValueOnce(expectedData.currency)

    const actual: Data = mapper.mapPaymentResponse(responseData, txType, {})

    if (responseData.TLAmount !== undefined) {
      expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
      expect(formatter.formatAmount).toHaveBeenCalledWith(responseData.TLAmount, txType)
    } else {
      expect(formatter.formatAmount).not.toHaveBeenCalled()
    }
    if (responseData.TransactionType !== undefined) {
      expect(valueMapper.mapTxType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapTxType.mock.calls[0]?.[0]).toBe(responseData.TransactionType)
    }
    if (responseData.ThreeDSecureType !== undefined) {
      expect(valueMapper.mapSecureType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapSecureType.mock.calls[0]?.[0]).toBe(responseData.ThreeDSecureType)
    }
    if (expectedData.transaction_time instanceof Date) {
      const hostDate = responseData.HostDate as string
      expect(formatter.formatDateTime).toHaveBeenCalledTimes(1)
      expect(formatter.formatDateTime).toHaveBeenCalledWith(
        hostDate.length === 10 ? `${currentBankYear()}${hostDate}` : hostDate,
        txType,
      )
    } else {
      expect(formatter.formatDateTime).not.toHaveBeenCalled()
    }
    if (responseData.CurrencyCode !== undefined) {
      expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapCurrency).toHaveBeenCalledWith(responseData.CurrencyCode, txType)
    }

    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expectedData)
  })

  it.each(cancelDataProvider)('mapCancelResponse %s', (_name, { responseData, expectedData }) => {
    const actual: Data = mapper.mapCancelResponse(responseData)
    takeNonEmpty(actual, 'all')
    expectSame(actual, expectedData)
  })

  it.each(refundDataProvider)('mapRefundResponse %s', (_name, { responseData, expectedData }) => {
    const actual: Data = mapper.mapRefundResponse(responseData)
    takeNonEmpty(actual, 'all')
    expectSame(actual, expectedData)
  })

  it.each(statusTestDataProvider)('mapStatusResponse %s', (_name, { responseData, expectedData }) => {
    const txType = TX_TYPE.STATUS
    const approved = expectedData.status === PayFlexV4PosResponseDataMapper.TX_APPROVED
    if (approved) {
      valueMapper.mapTxType.mockReturnValueOnce(expectedData.transaction_type)
      valueMapper.mapCurrency.mockReturnValueOnce(expectedData.currency)
      formatter.formatAmount.mockReturnValueOnce(expectedData.first_amount)
    }

    const actual: Data = mapper.mapStatusResponse(responseData)

    if (approved) {
      const info = (responseData.TransactionSearchResultInfo as Data).TransactionSearchResultInfo as Data
      expect(valueMapper.mapTxType).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapTxType.mock.calls[0]?.[0]).toBe(info.TransactionType)
      expect(valueMapper.mapCurrency).toHaveBeenCalledTimes(1)
      expect(valueMapper.mapCurrency).toHaveBeenCalledWith(info.AmountCode, txType)
      expect(formatter.formatAmount).toHaveBeenCalledTimes(1)
      expect(formatter.formatAmount).toHaveBeenCalledWith(info.CurrencyAmount ?? info.Amount, txType)
    } else {
      expect(valueMapper.mapTxType).not.toHaveBeenCalled()
    }
    takeNonEmpty(actual, 'all')
    expectSameSorted(actual, expectedData)
  })

  // not implemented -> NotImplementedError
  it('map3DPayResponseData is not implemented', () => {
    expect(() => mapper.map3DPayResponseData({}, TX_TYPE.PAY_AUTH, {})).toThrow(NotImplementedError)
  })

  it('map3DHostResponseData is not implemented', () => {
    expect(() => mapper.map3DHostResponseData({}, TX_TYPE.PAY_AUTH, {})).toThrow(NotImplementedError)
  })

  it('mapOrderHistoryResponse is not implemented', () => {
    expect(() => mapper.mapOrderHistoryResponse({})).toThrow(NotImplementedError)
  })

  // ---- additions ----

  describe('map3DPaymentData applies the strict 3D rule', () => {
    const provision: Data = {
      TransactionType: 'Sale',
      TransactionId: 'T1',
      ResultCode: '0000',
      ResultDetail: 'İŞLEM BAŞARILI',
      AuthCode: '822641',
      HostDate: '20220404123456',
      CurrencyCode: '949',
      OrderId: 'order-id-123',
      TLAmount: '100.00',
      ThreeDSecureType: '2',
      BatchNo: '1',
    }

    it('approves a full 3D callback with an approved provision', () => {
      const res = integrationMapper().map3DPaymentData(strictSuccess, provision, TX_TYPE.PAY_AUTH, {})
      expect(res.status).toBe('approved')
      expect(res.md_status).toBe('Y')
      expect(res.transaction_time).toStrictEqual(tr(2022, 4, 4, 12, 34, 56))
      expect(res.amount).toBe(100)
      expect(res.currency).toBe(CURRENCY.TRY)
      expect(res.payment_model).toBe(MODEL.THREE_D_SECURE)
    })

    it.each([
      // VakıfBank 2026 strict 3D rule: these are not 3D success
      ['half secure ECI 06', { Eci: '06' }],
      ['half secure ECI 01', { Eci: '01' }],
      ['empty CAVV', { Cavv: '' }],
      ['MdStatus 2', { MdStatus: '2' }],
    ] as Array<[string, Data]>)('%s is declined and a provision response is ignored', (_name, change) => {
      const res = integrationMapper().map3DPaymentData({ ...strictSuccess, ...change }, provision, TX_TYPE.PAY_AUTH, {})
      expect(res.status).toBe('declined')
      expect(res.transaction_id).toBeNull()
      expect(res.auth_code).toBeNull()
      expect(res.proc_return_code).toBeNull()
    })

    it('never returns undefined values for a sparse callback', () => {
      const res = integrationMapper().map3DPaymentData({ Status: 'N' }, null, TX_TYPE.PAY_AUTH, {})
      expect(res.status).toBe('declined')
      expect(Object.values(res).includes(undefined)).toBe(false)
      expect(res.currency).toBeNull()
      expect(res.installment_count).toBe(0)
    })
  })

  it('mapPaymentResponse never returns undefined for an approved response missing fields', () => {
    const res = integrationMapper().mapPaymentResponse({ ResultCode: '0000' }, TX_TYPE.PAY_AUTH, {})
    expect(res.status).toBe('approved')
    expect(res.transaction_time).toBeNull()
    expect(Object.values(res).includes(undefined)).toBe(false)
  })

  it('mapStatusResponse with real formatters maps a canceled order', () => {
    const [, { responseData }] = statusTestDataProvider[1] as [string, { responseData: Data }]
    const info = (responseData.TransactionSearchResultInfo as Data).TransactionSearchResultInfo as Data
    const res = integrationMapper().mapStatusResponse({
      ...responseData,
      TransactionSearchResultInfo: { TransactionSearchResultInfo: { ...info, IsCanceled: 'true' } },
    })
    expect(res.status).toBe('approved')
    expect(res.order_status).toBe('CANCELED')
    expect(res.first_amount).toBe(90.5)
    expect(res.transaction_type).toBe(TX_TYPE.PAY_AUTH)
  })

  it.each([
    ['IsReversed', 'REVERSED'],
    ['IsRefunded', 'FULLY_REFUNDED'],
  ])('mapStatusResponse %s', (flag, orderStatus) => {
    const [, { responseData }] = statusTestDataProvider[1] as [string, { responseData: Data }]
    const info = (responseData.TransactionSearchResultInfo as Data).TransactionSearchResultInfo as Data
    const res = integrationMapper().mapStatusResponse({
      ...responseData,
      TransactionSearchResultInfo: { TransactionSearchResultInfo: { ...info, [flag]: 'true' } },
    })
    expect(res.order_status).toBe(orderStatus)
  })

  it('mapStatusResponse with several search records is declined with empty transaction fields (documented)', () => {
    const [, { responseData }] = statusTestDataProvider[1] as [string, { responseData: Data }]
    const info = (responseData.TransactionSearchResultInfo as Data).TransactionSearchResultInfo as Data
    const res = integrationMapper().mapStatusResponse({
      ...responseData,
      TotalItemCount: 2,
      TransactionSearchResultInfo: { TransactionSearchResultInfo: [info, { ...info, TransactionId: 'T2' }] },
    })
    expect(res.status).toBe('declined')
    expect(res.transaction_id).toBeNull()
    expect(res.order_id).toBeNull()
    expect(res.first_amount).toBeNull()
  })

  it('mapStatusResponse without ResponseInfo is declined, not a TypeError', () => {
    const res = integrationMapper().mapStatusResponse({ Foo: 'bar' })
    expect(res.status).toBe('declined')
    expect(res.proc_return_code).toBeNull()
  })
})
