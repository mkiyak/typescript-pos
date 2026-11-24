import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayFlexCPV4PosResponseDataMapper } from '../../../../../src/data-mapper/response/mapper/PayFlexCPV4PosResponseDataMapper.js'
import { BasicResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import type { ResponseValueFormatterInterface } from '../../../../../src/data-mapper/response/value-formatter/ResponseValueFormatterInterface.js'
import { PayFlexCPV4PosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/PayFlexCPV4PosResponseValueMapper.js'
import type { ResponseValueMapperInterface } from '../../../../../src/data-mapper/response/value-mapper/ResponseValueMapperInterface.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import { noopLogger } from '../../../../../src/logger.js'
import { TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> }
type Data = Record<string, unknown>

const failRaw1: Data = {
  Rc: '2053',
  Message: 'VeRes status is E Message : Directory server communication error',
  PaymentToken: '68244b7e3dfd4b3ebea1afbe0185b9ed',
  TransactionId: '0cb6a57715144178a014afbe0185b9ed',
  MaskedPan: '49384601****4205',
}

const failRaw2: Data = {
  Rc: '0057',
  AuthCode: '000000',
  ErrorCode: '0057',
  Message: 'RED-KARTIN İŞLEM İZNİ YOK',
  PaymentToken: '5aeb359892f8400b9d0fafbd016c7636',
  TransactionId: '868382724da7480c949dafbd016c7636',
  MaskedPan: '49384601****4205',
}

const successRaw: Data = {
  Rc: '0000',
  AuthCode: '735879',
  Rrn: '306822971283',
  Message: 'İŞLEM BAŞARILI',
  TransactionId: '3ee068d5b5a747ada65dafc0016d5887',
  PaymentToken: 'b35a56bf37334872a945afc0016d5887',
  MaskedPan: '49384601****4205',
  HostMerchantId: '000100000013506',
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

const txTime = new Date('2023-03-09T22:10:37+03:00')

const baseExpected = {
  order_id: null,
  transaction_id: null,
  transaction_type: 'pay',
  transaction_time: null,
  transaction_security: null,
  auth_code: null,
  ref_ret_num: null,
  batch_num: null,
  md_status: null,
  md_error_message: null,
  masked_number: '49384601****4205',
  currency: null,
  amount: null,
  installment_count: null,
}

const providerRows: Array<[string, Data, Data]> = [
  [
    'fail_response_from_gateway_1',
    failRaw1,
    {
      ...baseExpected,
      transaction_id: '0cb6a57715144178a014afbe0185b9ed',
      proc_return_code: '2053',
      status: 'declined',
      error_code: '2053',
      error_message: 'VeRes status is E Message : Directory server communication error',
    },
  ],
  [
    'fail_response_from_gateway_2',
    failRaw2,
    {
      ...baseExpected,
      transaction_id: '868382724da7480c949dafbd016c7636',
      proc_return_code: '0057',
      status: 'declined',
      error_code: '0057',
      error_message: 'RED-KARTIN İŞLEM İZNİ YOK',
    },
  ],
  [
    'success_response_from_gateway_1',
    successRaw,
    {
      ...baseExpected,
      order_id: '2023030913ED',
      transaction_id: '3ee068d5b5a747ada65dafc0016d5887',
      transaction_time: txTime,
      auth_code: '735879',
      ref_ret_num: '3ee068d5b5a747ada65dafc0016d5887',
      proc_return_code: '0000',
      status: 'approved',
      error_code: null,
      error_message: null,
      currency: 'TRY',
      amount: 1.01, // deviation: R9 decimal comma normalized before formatting
      installment_count: 0,
    },
  ],
]

describe('PayFlexCPV4PosResponseDataMapper', () => {
  let formatter: Mocked<ResponseValueFormatterInterface>
  let valueMapper: Mocked<ResponseValueMapperInterface>
  let mapper: PayFlexCPV4PosResponseDataMapper

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
    mapper = new PayFlexCPV4PosResponseDataMapper(
      formatter as unknown as ResponseValueFormatterInterface,
      valueMapper as unknown as ResponseValueMapperInterface,
      noopLogger,
    )
  })

  const integrationMapper = () =>
    new PayFlexCPV4PosResponseDataMapper(new BasicResponseValueFormatter(), new PayFlexCPV4PosResponseValueMapper())

  it('supports', () => {
    expect(PayFlexCPV4PosResponseDataMapper.supports('PayFlexCPV4Pos')).toBe(true)
    expect(PayFlexCPV4PosResponseDataMapper.supports('AkbankPos')).toBe(false)
  })

  it.each([[null], [''], ['21']])('is3dAuthSuccess(%j) is true', (mdStatus) => {
    expect(mapper.is3dAuthSuccess(mdStatus)).toBe(true)
  })

  it.each([[{}], [{ blabla: '1' }]])('extractMdStatus(%j) is null', (data) => {
    expect(mapper.extractMdStatus(data)).toBeNull()
  })

  /** Arranges the stubs the success row needs and checks they were called with the expected arguments. */
  function arrangeApproved(expected: Data): void {
    valueMapper.mapTxType.mockReturnValue(expected.transaction_type)
    formatter.formatDateTime.mockReturnValue(expected.transaction_time)
    formatter.formatAmount.mockReturnValue(expected.amount)
    formatter.formatInstallment.mockReturnValue(expected.installment_count)
    valueMapper.mapCurrency.mockReturnValue(expected.currency)
  }

  function assertApprovedCalls(txType: TxType): void {
    expect(valueMapper.mapTxType).toHaveBeenCalledExactlyOnceWith('Sale')
    expect(formatter.formatDateTime).toHaveBeenCalledExactlyOnceWith('20230309221037', txType)
    // deviation: R9 decimal comma normalized before formatting ('1,01' -> '1.01')
    expect(formatter.formatAmount).toHaveBeenCalledExactlyOnceWith('1.01', txType)
    expect(formatter.formatInstallment).toHaveBeenCalledExactlyOnceWith(null, txType)
    expect(valueMapper.mapCurrency).toHaveBeenCalledExactlyOnceWith('949', txType)
  }

  describe.each([
    ['map3DPayResponseData', '3d_pay'],
    ['map3DHostResponseData', '3d_host'],
  ] as const)('%s', (method, model) => {
    it.each(providerRows)('%s', (_name, raw, expectedRow) => {
      const expected: Data = { ...expectedRow, payment_model: model }
      const approved = expected.status === 'approved'
      if (approved) arrangeApproved(expected)

      const actual = { ...mapper[method](raw, TX_TYPE.PAY_AUTH, {} as never) } as Data

      expect(actual.all).toBeTypeOf('object')
      expect(Object.keys(actual.all as Data).length).toBeGreaterThan(0)
      delete actual.all

      expect(Object.keys(actual).sort()).toStrictEqual(Object.keys(expected).sort())
      expect(actual).toStrictEqual(expected)
      if (approved) assertApprovedCalls(TX_TYPE.PAY_AUTH)
    })
  })

  it('map3DPaymentData throws NotImplementedError', () => {
    expect(() => mapper.map3DPaymentData({}, {}, TX_TYPE.PAY_AUTH, {} as never)).toThrow(NotImplementedError)
  })

  it('mapPaymentResponse throws NotImplementedError', () => {
    expect(() => mapper.mapPaymentResponse({}, TX_TYPE.PAY_AUTH, {} as never)).toThrow(NotImplementedError)
  })

  it('mapRefundResponse throws NotImplementedError', () => {
    expect(() => mapper.mapRefundResponse({})).toThrow(NotImplementedError)
  })

  it('mapCancelResponse throws NotImplementedError', () => {
    expect(() => mapper.mapCancelResponse({})).toThrow(NotImplementedError)
  })

  it('mapOrderHistoryResponse throws NotImplementedError', () => {
    expect(() => mapper.mapOrderHistoryResponse({})).toThrow(NotImplementedError)
  })

  // deviation: R10 status supported (the reference threw NotImplementedError)
  it('mapStatusResponse maps the query answer', () => {
    valueMapper.mapTxType.mockReturnValue('pay')
    formatter.formatDateTime.mockReturnValue(txTime)
    formatter.formatAmount.mockReturnValue(1.01)
    formatter.formatInstallment.mockReturnValue(0)
    valueMapper.mapCurrency.mockReturnValue('TRY')

    const approved = mapper.mapStatusResponse(successRaw)
    expect(formatter.formatAmount).toHaveBeenCalledExactlyOnceWith('1.01', TX_TYPE.STATUS)
    expect(approved.status).toBe('approved')
    expect(approved.order_id).toBe('2023030913ED')
    expect(approved.ref_ret_num).toBe('306822971283')
    expect(approved.first_amount).toBe(1.01)
    expect(approved.proc_return_code).toBe('0000')
    expect(approved.auth_code).toBe('735879')
    expect(approved.transaction_id).toBe('3ee068d5b5a747ada65dafc0016d5887')
    expect(approved.transaction_time).toBe(txTime)
    expect(approved.masked_number).toBe('49384601****4205')
    expect(approved.order_status).toBeNull()

    const declined = mapper.mapStatusResponse({ ErrorCode: '5003', ResponseMessage: 'Islem bulunamadi.' })
    expect(declined.status).toBe('declined')
    expect(declined.error_code).toBe('5003')
    expect(declined.proc_return_code).toBe('5003')
    expect(declined.error_message).toBe('Islem bulunamadi.')
    expect(declined.order_id).toBeNull()
  })

  describe('with the real formatter and value mapper', () => {
    // addition: field names of the v2.1 query answer
    it('maps the guide-named fields', () => {
      const raw = {
        ResultCode: '0000',
        ResultDescription: 'ONAY',
        AuthorizeId: '123456',
        TransactionId: 't',
        OrderId: 'o1',
        Amount: '10.00',
        AmountCode: '949',
        TransactionType: 'Sale',
        HostDate: '20260224101500',
      }
      for (const result of [
        integrationMapper().map3DPayResponseData(raw, TX_TYPE.PAY_AUTH, {} as never),
        integrationMapper().mapStatusResponse(raw),
      ]) {
        expect(result.status).toBe('approved')
        expect(result.auth_code).toBe('123456')
        expect(result.order_id).toBe('o1')
        expect(result.currency).toBe('TRY')
        expect(result.transaction_type).toBe('pay')
        expect(result.transaction_time).toEqual(new Date('2026-02-24T07:15:00Z'))
      }
      expect(integrationMapper().map3DPayResponseData(raw, TX_TYPE.PAY_AUTH, {} as never).amount).toBe(10)
      expect(integrationMapper().mapStatusResponse(raw).first_amount).toBe(10)
    })

    // addition: only a plain decimal comma is normalized
    it('passes a grouped amount through unchanged', () => {
      formatter.formatAmount.mockReturnValue(1234.56)
      formatter.formatInstallment.mockReturnValue(0)
      mapper.map3DPayResponseData({ ...successRaw, Amount: '1.234,56' }, TX_TYPE.PAY_AUTH, {} as never)
      expect(formatter.formatAmount).toHaveBeenCalledExactlyOnceWith('1.234,56', TX_TYPE.PAY_AUTH)
    })

    // addition: JSON-shaped answers nest objects and lists
    it('does not throw on a JSON-shaped success with nested CampaignResult', () => {
      const raw = { ...successRaw, Amount: '1.01', CampaignResult: { CampaignInfo: [] } }
      const result = integrationMapper().map3DPayResponseData(raw, TX_TYPE.PAY_AUTH, {} as never)
      expect(result.status).toBe('approved')
      expect(result.amount).toBe(1.01)
      expect(result.transaction_time).toEqual(txTime)
    })
  })
})
