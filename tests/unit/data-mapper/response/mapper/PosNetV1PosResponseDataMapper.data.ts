// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

/** Stand-in for the "now" timestamp of an approved payment (the formatter stub returns it). */
export const NOW = new Date('2026-11-24T10:00:00.000Z')

/** Bank time of the status fixtures: Türkiye wall clock 2019-11-08 13:58:37.909. */
// deviation: P20 the reference instant is created without a zone; bank times are UTC+03:00
export const TX_TIME = new Date('2019-11-08T13:58:37.909+03:00')

const POINT_DATA_LIST = [
  { PointType: 'EarnedPoint', Point: 1000, PointTLAmount: 500 },
  { PointType: 'TotalPoint', Point: 94739396, PointTLAmount: 347369698 },
  { PointType: 'EarnedStandartTotal', Point: 0, PointTLAmount: 500 },
  { PointType: 'EarnedStandartMrc', Point: 0, PointTLAmount: 250 },
  { PointType: 'EarnedLoyaltyTotal', Point: 0, PointTLAmount: 0 },
  { PointType: 'EarnedLoyaltyMrc', Point: 0, PointTLAmount: 0 },
  { PointType: 'UsedStandartTotal', Point: 0, PointTLAmount: 0 },
  { PointType: 'UsedLoyaltyTotal', Point: 0, PointTLAmount: 0 },
  { PointType: 'AvailableStandartTotal', Point: 0, PointTLAmount: 347369698 },
  { PointType: 'AvailableLoyaltyTotal', Point: 0, PointTLAmount: 0 },
]

/** The approved provision answer shared by the payment and the 3D fixtures. */
export const APPROVED_PROVISION: Data = {
  ServiceResponseData: { ResponseCode: '00', ResponseDescription: 'Onaylandı' },
  AuthCode: '449324',
  ReferenceCode: '159044932490000231',
  PointDataList: POINT_DATA_LIST,
  InstallmentData: { InstallmentCount: 0, Amount: 0 },
  MessageData: { Message1: ' ', Message2: null, Message3: null, Message4: null },
}

/** The callback of a successful 3D authentication (amount 1.75 TRY). */
export const SUCCESS_3D_CALLBACK: Data = {
  CCPrefix: '540061',
  TranType: 'Sale',
  Amount: '175',
  OrderId: 'ALA_0000080603153823',
  MerchantId: '6700950031',
  CAVV: 'jKOBaLBL3hQ+CREBPu1HBQQAAAA=',
  CAVVAlgorithm: '3',
  ECI: '02',
  MD: '0161010028947569644,0161010028947569644',
  MdErrorMessage: 'Authenticated',
  MdStatus: '1',
  SecureTransactionId: '1010028947569644',
  Mac: 'r21kMm4nMqvJakjq47Jl+3fk2xrFPrDoTJFQGxkgkfk=',
  MacParams: 'ECI:CAVV:MdStatus:MdErrorMessage:MD:SecureTransactionId',
  CurrencyCode: '949',
  InstalmentCode: '0',
  VtfCode: '',
  PointAmount: '',
}

interface PaymentCase {
  order: Data
  txType: 'pay'
  responseData: Data
  expectedData: Data
}

export const paymentTestDataProvider: [string, PaymentCase][] = [
  [
    'fail1',
    {
      order: { id: '202312171800ABC', currency: 'TRY', amount: 1.01 },
      txType: 'pay',
      responseData: {
        ServiceResponseData: { ResponseCode: '0127', ResponseDescription: 'ORDERID DAHA ONCE KULLANILMIS' },
        AuthCode: null,
        ReferenceCode: null,
        PointDataList: null,
        InstallmentData: null,
        MessageData: null,
      },
      expectedData: {
        transaction_id: null,
        transaction_type: 'pay',
        transaction_time: null,
        payment_model: 'regular',
        order_id: '202312171800ABC',
        currency: 'TRY',
        amount: 1.01,
        auth_code: null,
        ref_ret_num: null,
        batch_num: null,
        proc_return_code: '0127',
        status: 'declined',
        error_code: '0127',
        error_message: 'ORDERID DAHA ONCE KULLANILMIS',
        installment_count: null,
      },
    },
  ],
  [
    'success1',
    {
      order: { id: '202312171800ABC', currency: 'TRY', amount: 1.01 },
      txType: 'pay',
      responseData: APPROVED_PROVISION,
      expectedData: {
        transaction_id: null,
        transaction_time: NOW,
        transaction_type: 'pay',
        payment_model: 'regular',
        order_id: '202312171800ABC',
        currency: 'TRY',
        amount: 1.01,
        auth_code: '449324',
        ref_ret_num: '159044932490000231',
        batch_num: null,
        proc_return_code: '00',
        status: 'approved',
        error_code: null,
        error_message: null,
        installment_count: 0,
      },
    },
  ],
]

interface ThreeDCase {
  order: Data
  txType: 'pay'
  threeDResponseData: Data
  paymentData: Data
  expectedData: Data
}

export const threeDPaymentDataProvider: [string, ThreeDCase][] = [
  [
    '3d_auth_fail_1',
    {
      order: { id: '20230622A1C9' },
      txType: 'pay',
      threeDResponseData: {
        CCPrefix: '450634',
        TranType: 'Sale',
        Amount: '101',
        OrderId: '0000000020230622A1C9',
        MerchantId: '6702640212',
        CAVV: null,
        CAVVAlgorithm: null,
        ECI: '07',
        MD: '0161010063138198543',
        MdErrorMessage: 'Not authenticated',
        MdStatus: '0',
        SecureTransactionId: '1010063138198543',
        Mac: 'ltpqSazdMf67AjmWF0WQ5pOU78F+kjrfkyz7ex+ZvNg=',
        MacParams: 'ECI:CAVV:MdStatus:MdErrorMessage:MD:SecureTransactionId',
      },
      paymentData: {},
      expectedData: {
        transaction_id: null,
        transaction_type: 'pay',
        transaction_time: null,
        transaction_security: 'MPI fallback',
        masked_number: '450634',
        md_status: '0',
        md_error_message: 'Not authenticated',
        amount: 1.01,
        auth_code: null,
        installment_count: null,
        ref_ret_num: null,
        batch_num: null,
        error_code: null,
        error_message: null,
        order_id: '20230622A1C9',
        remote_order_id: '0000000020230622A1C9',
        proc_return_code: null,
        status: 'declined',
        currency: null,
        payment_model: '3d',
      },
    },
  ],
  [
    'success1',
    {
      order: { id: '80603153823' },
      txType: 'pay',
      threeDResponseData: SUCCESS_3D_CALLBACK,
      paymentData: APPROVED_PROVISION,
      expectedData: {
        transaction_id: null,
        transaction_type: 'pay',
        transaction_time: NOW,
        transaction_security: 'Full 3D Secure',
        masked_number: '540061',
        md_status: '1',
        md_error_message: null,
        amount: 1.75,
        auth_code: '449324',
        ref_ret_num: '159044932490000231',
        batch_num: null,
        error_code: null,
        error_message: null,
        order_id: '80603153823',
        remote_order_id: 'ALA_0000080603153823',
        proc_return_code: '00',
        status: 'approved',
        currency: 'TRY',
        payment_model: '3d',
        installment_count: 0,
      },
    },
  ],
  [
    'threeDAuthFail2',
    {
      order: { id: '80603153823' },
      txType: 'pay',
      threeDResponseData: { ...SUCCESS_3D_CALLBACK, MdErrorMessage: 'Error', MdStatus: '0' },
      paymentData: {},
      expectedData: {
        transaction_id: null,
        transaction_type: 'pay',
        transaction_time: null,
        transaction_security: 'MPI fallback',
        masked_number: '540061',
        md_status: '0',
        md_error_message: 'Error',
        amount: 1.75,
        auth_code: null,
        ref_ret_num: null,
        batch_num: null,
        error_code: null,
        error_message: null,
        order_id: '80603153823',
        remote_order_id: 'ALA_0000080603153823',
        proc_return_code: null,
        status: 'declined',
        currency: 'TRY',
        payment_model: '3d',
        installment_count: null,
      },
    },
  ],
  [
    '3d_auth_success_payment_fail',
    {
      order: { id: '202306226A90' },
      txType: 'pay',
      threeDResponseData: {
        CCPrefix: '450634',
        TranType: 'Sale',
        Amount: '101',
        OrderId: '00000000202306226A90',
        MerchantId: '6702640212',
        CAVV: 'AAIBAACZZAAAAABllJFzdQAAAAA=',
        CAVVAlgorithm: null,
        ECI: '05',
        MD: '0161010063138203939',
        MdErrorMessage: 'Y-status/Challenge authentication via ACS: https://certemvacs.bkm.com.tr/acs/creq',
        MdStatus: '1',
        SecureTransactionId: '1010063138203939',
        Mac: 'aw2jry3dZbmDMvIfuyx3sixxY50ysnRhaR3kOXHLJRw=',
        MacParams: 'ECI:CAVV:MdStatus:MdErrorMessage:MD:SecureTransactionId',
      },
      paymentData: {
        ServiceResponseData: {
          ResponseCode: '0148',
          ResponseDescription: 'INVALID MID TID IP. Hatalı IP:92.38.180.61',
        },
        AuthCode: null,
        ReferenceCode: null,
        PointDataList: null,
        InstallmentData: null,
        MessageData: null,
      },
      expectedData: {
        transaction_id: null,
        transaction_time: null,
        transaction_type: 'pay',
        transaction_security: 'Full 3D Secure',
        masked_number: '450634',
        md_status: '1',
        md_error_message: null,
        amount: 1.01,
        auth_code: null,
        ref_ret_num: null,
        batch_num: null,
        error_code: '0148',
        error_message: 'INVALID MID TID IP. Hatalı IP:92.38.180.61',
        order_id: '202306226A90',
        remote_order_id: '00000000202306226A90',
        proc_return_code: '0148',
        status: 'declined',
        currency: null,
        payment_model: '3d',
        installment_count: null,
      },
    },
  ],
  [
    'half_3d_secure',
    {
      order: { id: '80603153823' },
      txType: 'pay',
      threeDResponseData: {
        ...SUCCESS_3D_CALLBACK,
        CAVV: null,
        CAVVAlgorithm: null,
        MD: '0161010028947569644',
        MdErrorMessage: null,
        MdStatus: '2',
      },
      paymentData: {},
      expectedData: {
        transaction_id: null,
        transaction_type: 'pay',
        transaction_time: null,
        transaction_security: 'Half 3D Secure',
        masked_number: '540061',
        md_status: '2',
        md_error_message: null,
        amount: 1.75,
        auth_code: null,
        ref_ret_num: null,
        batch_num: null,
        error_code: null,
        error_message: null,
        order_id: '80603153823',
        remote_order_id: 'ALA_0000080603153823',
        proc_return_code: null,
        status: 'declined',
        currency: 'TRY',
        payment_model: '3d',
        installment_count: null,
      },
    },
  ],
]

interface StatusCase {
  responseData: Data
  expectedData: Data
}

const REFUND_TX = {
  Amount: '1,75',
  AuthCode: '628698',
  CardNo: '540061******4581',
  CurrencyCode: 'TL',
  HostLogKey: '022562869890000191',
  OrderId: 'ALB_TST_19091900_20a1234',
  TransactionDate: '2019-11-0813:58:37.909',
  TransactionStatus: '1',
  TransactionType: 'Return',
}

const SALE_TX = {
  Amount: '1,75',
  AuthCode: '190742',
  CardNo: '540061******4581',
  CurrencyCode: 'TL',
  HostLogKey: '021419074290000191',
  OrderId: 'ALB_TST_19091900_20a1234',
  TransactionDate: '2019-09-2018:50:58.111',
  TransactionStatus: '1',
  TransactionType: 'Sale',
}

export const statusTestDataProvider: [string, StatusCase][] = [
  [
    'success_refunded',
    {
      responseData: {
        ServiceResponseData: { ResponseCode: '0000', ResponseDescription: 'Başarılı' },
        TransactionData: [REFUND_TX, SALE_TX],
      },
      expectedData: {
        order_id: 'ALB_TST_19091900_20a1234',
        auth_code: null,
        transaction_id: null,
        ref_ret_num: null,
        proc_return_code: '0000',
        status: 'approved',
        order_status: 'FULLY_REFUNDED',
        error_code: null,
        error_message: null,
        transaction_time: TX_TIME,
        capture_time: null,
        capture: null,
        capture_amount: null,
        transaction_type: 'refund',
        currency: 'TRY',
        first_amount: 1.75,
        masked_number: '540061******4581',
        cancel_time: null,
        refund_amount: null,
        refund_time: TX_TIME,
        installment_count: null,
      },
    },
  ],
  [
    'success_no_completed_tx',
    {
      responseData: {
        ServiceResponseData: { ResponseCode: '0000', ResponseDescription: 'Başarılı' },
        TransactionData: [
          {
            Amount: '1,75',
            AuthCode: '',
            CardNo: '540061******4581',
            CurrencyCode: 'TL',
            HostLogKey: '',
            OrderId: 'ALB_TST_19091900_test1',
            TransactionDate: '2019-11-0813:58:37.909',
            TransactionStatus: '0',
            TransactionType: 'Sale',
          },
        ],
      },
      expectedData: {
        auth_code: null,
        transaction_id: null,
        ref_ret_num: null,
        proc_return_code: '0000',
        status: 'approved',
        error_code: null,
        error_message: null,
        transaction_time: null,
        capture_time: null,
        capture: null,
        capture_amount: null,
        currency: null,
        first_amount: null,
        masked_number: null,
        order_id: null,
        order_status: null,
        transaction_type: null,
        cancel_time: null,
        refund_amount: null,
        refund_time: null,
        installment_count: null,
      },
    },
  ],
  [
    'success_cancel',
    {
      responseData: {
        ServiceResponseData: { ResponseCode: '0000', ResponseDescription: 'Başarılı' },
        TransactionData: [{ ...REFUND_TX, TransactionType: 'Cancel' }],
      },
      expectedData: {
        order_id: 'ALB_TST_19091900_20a1234',
        auth_code: null,
        transaction_id: null,
        ref_ret_num: null,
        proc_return_code: '0000',
        status: 'approved',
        order_status: 'CANCELED',
        error_code: null,
        error_message: null,
        transaction_time: TX_TIME,
        capture_time: null,
        capture: null,
        capture_amount: null,
        transaction_type: 'cancel',
        currency: 'TRY',
        first_amount: 1.75,
        masked_number: '540061******4581',
        cancel_time: TX_TIME,
        refund_amount: null,
        refund_time: null,
        installment_count: null,
      },
    },
  ],
  [
    'fail1',
    {
      responseData: {
        ServiceResponseData: { ResponseCode: 'E219', ResponseDescription: 'Kayıt Bulunamadı' },
        AuthCode: null,
        ReferenceCode: null,
        TransactionData: null,
      },
      expectedData: {
        auth_code: null,
        transaction_id: null,
        ref_ret_num: null,
        proc_return_code: 'E219',
        status: 'declined',
        error_code: 'E219',
        error_message: 'Kayıt Bulunamadı',
        transaction_time: null,
        capture_time: null,
        capture: null,
        capture_amount: null,
        currency: null,
        first_amount: null,
        masked_number: null,
        order_id: null,
        order_status: null,
        transaction_type: null,
        cancel_time: null,
        refund_amount: null,
        refund_time: null,
        installment_count: null,
      },
    },
  ],
]

interface NonPaymentCase {
  responseData: Data
  expectedData: Data
}

const cancelExpected = (overrides: Data): Data => ({
  auth_code: null,
  transaction_id: null,
  ref_ret_num: null,
  group_id: null,
  transaction_type: null,
  proc_return_code: null,
  status: 'declined',
  error_code: null,
  error_message: null,
  ...overrides,
})

const SUCCESS_NON_PAYMENT = {
  responseData: {
    ServiceResponseData: { ResponseCode: '00', ResponseDescription: 'Onaylandı' },
    AuthCode: null,
    ReferenceCode: null,
  },
  expectedData: cancelExpected({ proc_return_code: '00', status: 'approved' }),
}

const FAIL_NON_PAYMENT = {
  responseData: {
    ServiceResponseData: { ResponseCode: '0148', ResponseDescription: 'INVALID MID TID IP. Hatalı IP:92.38.180.64' },
  },
  expectedData: cancelExpected({
    proc_return_code: '0148',
    error_code: '0148',
    error_message: 'INVALID MID TID IP. Hatalı IP:92.38.180.64',
  }),
}

export const cancelTestDataProvider: [string, NonPaymentCase][] = [
  ['success1', SUCCESS_NON_PAYMENT],
  ['fail1', FAIL_NON_PAYMENT],
]

export const refundTestDataProvider: [string, NonPaymentCase][] = [
  ['success1', SUCCESS_NON_PAYMENT],
  [
    'fail1',
    {
      responseData: {
        ...FAIL_NON_PAYMENT.responseData,
        AuthCode: null,
        ReferenceCode: null,
        PointDataList: null,
        InstallmentData: null,
        LateChargeData: null,
      },
      expectedData: FAIL_NON_PAYMENT.expectedData,
    },
  ],
]
