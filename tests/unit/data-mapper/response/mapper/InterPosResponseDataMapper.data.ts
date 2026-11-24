// biome-ignore-all lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

/** Stand-in for the formatter stub's return value of a bank timestamp. */
export const STUB_TIME = new Date('2024-08-09T10:40:34+03:00')

export const HASH_PARAMS =
  'Version:PurchAmount:Exponent:Currency:OkUrl:FailUrl:MD:OrderId:ProcReturnCode:Response:mdStatus:'

export interface PaymentCase {
  order: Data
  txType: string
  responseData: Data
  expectedData: Data
}
export interface ThreeDCase {
  order: Data
  txType: string
  threeDResponseData: Data
  paymentData: Data
  expectedData: Data
}
export interface HostCase {
  order: Data
  txType: string
  paymentData: Data
  expectedData: Data
}
export interface RawCase {
  responseData: Data
  expectedData: Data
}

const bankRecord = (over: Data): Data => ({
  HostRefNum: null,
  AuthCode: '',
  TxnResult: 'Failed',
  CampanyId: '',
  CampanyInstallCount: '0',
  CampanyShiftDateCount: '0',
  CampanyTxnId: '',
  CampanyType: '',
  CampanyInstallment: '0',
  CampanyDate: '0',
  CampanyAmnt: '0',
  TRXDATE: '',
  TransId: '',
  EarnedBonus: '0',
  UsedBonus: '0',
  AvailableBonus: '0',
  BonusToBonus: '0',
  CampaignBonus: '0',
  FoldedBonus: '0',
  SurchargeAmount: '0',
  CardHolderName: '',
  ...over,
})

export const paymentTestDataProvider: Array<[string, PaymentCase]> = [
  [
    'fail1',
    {
      order: { currency: 'TRY', amount: 1.01 },
      txType: 'pay',
      responseData: bankRecord({
        OrderId: '20221225662C',
        ProcReturnCode: '81',
        ErrorMessage: 'Terminal Aktif Degil',
        ErrorCode: 'B810002',
        Amount: '1,01',
      }),
      expectedData: {
        order_id: '20221225662C',
        transaction_id: null,
        transaction_type: 'pay',
        currency: 'TRY',
        amount: 1.01,
        payment_model: 'regular',
        auth_code: null,
        ref_ret_num: null,
        batch_num: null,
        proc_return_code: '81',
        status: 'declined',
        error_code: 'B810002',
        error_message: 'Terminal Aktif Degil',
        installment_count: null,
        transaction_time: null,
      },
    },
  ],
  [
    'empty',
    {
      order: { currency: 'TRY', amount: 1.01 },
      txType: 'pay',
      responseData: {},
      expectedData: {
        order_id: null,
        transaction_id: null,
        transaction_time: null,
        transaction_type: 'pay',
        installment_count: null,
        currency: null,
        amount: null,
        payment_model: 'regular',
        auth_code: null,
        ref_ret_num: null,
        batch_num: null,
        proc_return_code: null,
        status: 'declined',
        error_code: null,
        error_message: null,
      },
    },
  ],
]

const authFailCallback = (extra: Data): Data => ({
  Version: '',
  MerchantID: '',
  ShopCode: '3123',
  TxnStat: 'N',
  MD: '',
  RetCode: '',
  RetDet: '',
  VenderCode: '',
  Eci: '',
  PayerAuthenticationCode: '',
  PayerTxnId: '',
  CavvAlg: '',
  PAResVerified: 'False',
  PAResSyntaxOK: 'False',
  Expiry: '****',
  Pan: '540061******0430',
  PurchAmount: '1,01',
  Exponent: '',
  Description: '',
  Description2: '',
  Currency: '949',
  '3DStatus': '0',
  AuthCode: '',
  HostRefNum: null,
  TransId: '',
  TRXDATE: '',
  CardHolderName: '',
  mdStatus: '0',
  ProcReturnCode: '81',
  TxnResult: '',
  ErrorMessage: 'Terminal Aktif Degil',
  ErrorCode: 'B810002',
  Response: '',
  HASHPARAMS: HASH_PARAMS,
  ...extra,
})

const authFailExpected = (extra: Data): Data => ({
  transaction_id: null,
  auth_code: null,
  ref_ret_num: null,
  batch_num: null,
  proc_return_code: '81',
  status: 'declined',
  error_code: 'B810002',
  error_message: 'Terminal Aktif Degil',
  transaction_security: 'MPI fallback',
  md_status: '0',
  masked_number: '540061******0430',
  month: null,
  year: null,
  amount: 1.01,
  currency: 'TRY',
  eci: null,
  tx_status: 'N',
  cavv: null,
  md_error_message: 'Terminal Aktif Degil',
  transaction_type: 'pay',
  installment_count: null,
  transaction_time: null,
  ...extra,
})

/** The 3D success callback (provision still to come). */
export const threeDSuccessCallback: Data = {
  Version: '',
  MerchantID: '',
  ShopCode: 'gizlendi',
  TxnStat: 'Y',
  MD: 'gizlendi',
  RetCode: '',
  RetDet: '',
  VenderCode: '',
  Eci: '02',
  PayerAuthenticationCode: 'gizlendi=',
  PayerTxnId: '',
  CavvAlg: '',
  PAResVerified: 'True',
  PAResSyntaxOK: 'True',
  Expiry: 'expiry-123',
  Pan: 'kart*****no',
  OrderId: '33554969',
  PurchAmount: '1',
  Exponent: '',
  Description: '',
  Description2: '',
  Currency: '949',
  OkUrl: 'gizlendi',
  FailUrl: 'gizlendi',
  '3DStatus': '1',
  AuthCode: '',
  HostRefNum: null,
  TransId: '',
  TRXDATE: '',
  CardHolderName: '',
  mdStatus: '1',
  ProcReturnCode: '',
  TxnResult: '',
  ErrorMessage: '',
  ErrorCode: '',
  Response: '',
  HASH: 'gizlendi/gizlendi=',
  HASHPARAMS: HASH_PARAMS,
  HASHPARAMSVAL: 'gizlendi',
}

/** The approved provision answer of the 3D success callback. */
export const provisionSuccess: Data = {
  OrderId: '33554969',
  ProcReturnCode: '00',
  HostRefNum: null,
  AuthCode: 'auth-code-123',
  TxnResult: 'Success',
  ErrorMessage: '',
  CampanyId: '',
  CampanyInstallCount: '0',
  CampanyShiftDateCount: '0',
  CampanyTxnId: '',
  CampanyType: '',
  CampanyInstallment: '0',
  CampanyDate: '0',
  CampanyAmnt: '0',
  TRXDATE: '09.08.2024 10:40:34',
  TransId: 'trans-id-123',
  ErrorCode: '',
  EarnedBonus: '0,00',
  UsedBonus: '0,00',
  AvailableBonus: '0,00',
  BonusToBonus: '0',
  CampaignBonus: '0,00',
  FoldedBonus: '0',
  SurchargeAmount: '0',
  Amount: '1,00',
  CardHolderName: 'kart-sahibi-abc',
  QrReferenceNumber: '',
  QrCardToken: '',
  QrData: '',
  QrPayIsSucess: 'False',
  QrIssuerPaymentMethod: '',
  QrFastMessageReferenceNo: '',
  QrFastParticipantReceiverCode: '',
  QrFastParticipantReceiverName: '',
  QrFastParticipantSenderCode: '',
  QrFastSenderIban: '',
  QrFastParticipantSenderName: '',
  QrFastPaymentResultDesc: '',
}

export const threeDPaymentDataProvider: Array<[string, ThreeDCase]> = [
  [
    'authFail1',
    {
      order: {},
      txType: 'pay',
      threeDResponseData: authFailCallback({
        Version: null,
        MerchantID: null,
        MD: null,
        RetCode: null,
        RetDet: null,
        VenderCode: null,
        Eci: null,
        PayerAuthenticationCode: null,
        PayerTxnId: null,
        CavvAlg: null,
        OrderId: '20221225E1DF',
        Exponent: null,
        Description: null,
        Description2: null,
        OkUrl: 'http:\\/\\/localhost\\/interpos\\/3d\\/response.php',
        FailUrl: 'http:\\/\\/localhost\\/interpos\\/3d\\/response.php',
        AuthCode: null,
        TransId: null,
        TRXDATE: null,
        CardHolderName: null,
        TxnResult: null,
        Response: null,
        HASH: '423AWRAXl0VlEbQjpmAfntT5e3E=',
        HASHPARAMSVAL:
          '1,01949http:\\/\\/localhost\\/interpos\\/3d\\/response.phphttp:\\/\\/localhost\\/interpos\\/3d\\/response.php20221225E1DF810',
      }),
      paymentData: {},
      expectedData: authFailExpected({ order_id: '20221225E1DF', payment_model: '3d' }),
    },
  ],
  [
    'success',
    {
      order: {},
      txType: 'pay',
      threeDResponseData: threeDSuccessCallback,
      paymentData: provisionSuccess,
      expectedData: {
        order_id: '33554969',
        transaction_id: 'trans-id-123',
        auth_code: 'auth-code-123',
        ref_ret_num: null,
        batch_num: null,
        proc_return_code: '00',
        status: 'approved',
        error_code: null,
        error_message: null,
        transaction_security: 'Full 3D Secure',
        md_status: '1',
        masked_number: 'kart*****no',
        month: null,
        year: null,
        amount: 1.0,
        currency: 'TRY',
        eci: '02',
        tx_status: 'Y',
        cavv: null,
        md_error_message: null,
        transaction_type: 'pay',
        payment_model: '3d',
        installment_count: null,
        transaction_time: STUB_TIME,
      },
    },
  ],
]

export const threeDPayPaymentDataProvider: Array<[string, HostCase]> = [
  [
    'authFail1',
    {
      order: {},
      txType: 'pay',
      paymentData: authFailCallback({
        OrderId: '20221225B83B',
        OkUrl: 'http:\\/\\/localhost\\/interpos\\/3d-pay\\/response.php',
        FailUrl: 'http:\\/\\/localhost\\/interpos\\/3d-pay\\/response.php',
        HASH: 'PvDXe6Puf9W2oZnBZuHVp8oWpyY=',
        HASHPARAMSVAL:
          '1,01949http:\\/\\/localhost\\/interpos\\/3d-pay\\/response.phphttp:\\/\\/localhost\\/interpos\\/3d-pay\\/response.php20221225B83B810',
      }),
      expectedData: authFailExpected({ order_id: '20221225B83B', payment_model: '3d_pay' }),
    },
  ],
]

export const threeDHostPaymentDataProvider: Array<[string, HostCase]> = [
  [
    '3d_auth_fail1',
    {
      order: {},
      txType: 'pay',
      paymentData: authFailCallback({
        OrderId: '202212256D26',
        OkUrl: 'http:\\/\\/localhost\\/interpos\\/3d-host\\/response.php',
        FailUrl: 'http:\\/\\/localhost\\/interpos\\/3d-host\\/response.php',
        HASH: 'hmL3n1OMlNnKM4mjk2BgqfFM0rI=',
        HASHPARAMSVAL:
          '1,01949http:\\/\\/localhost\\/interpos\\/3d-host\\/response.phphttp:\\/\\/localhost\\/interpos\\/3d-host\\/response.php202212256D26810',
        __EVENTTARGET: '',
        __EVENTARGUMENT: '',
      }),
      expectedData: authFailExpected({ order_id: '202212256D26', payment_model: '3d_host' }),
    },
  ],
]

export const statusTestDataProvider: Array<[string, RawCase]> = [
  [
    'fail1',
    {
      responseData: {
        OrderId: 'SYSOID121327781',
        ProcReturnCode: '81',
        BatchNo: '',
        TransId: '',
        TRXDATE: '',
        TxnStat: '',
        PurchAmount: '0',
        VoidDate: '1.1.0001 00:00:00',
        TxnStatus: '',
        ChargeTypeCd: '',
        ErrorCode: 'B810002',
        ErrorMessage: 'TR:Terminal Aktif Degil',
        RefundedAmount: '0',
        AuthCode: '',
      },
      expectedData: {
        order_id: 'SYSOID121327781',
        auth_code: null,
        proc_return_code: '81',
        transaction_id: null,
        error_code: '81',
        error_message: 'TR:Terminal Aktif Degil',
        ref_ret_num: null,
        order_status: null,
        transaction_type: null,
        currency: null,
        masked_number: null,
        refund_amount: null,
        capture_amount: null,
        first_amount: null,
        status: 'declined',
        capture: null,
        transaction_time: null,
        capture_time: null,
        cancel_time: null,
        refund_time: null,
        installment_count: null,
      },
    },
  ],
]

export const cancelTestDataProvider: Array<[string, RawCase]> = [
  [
    'fail1',
    {
      responseData: bankRecord({
        OrderId: 'SYSOID121330755',
        ProcReturnCode: '81',
        ErrorMessage: 'Terminal Aktif Degil',
        ErrorCode: 'B810002',
        Amount: '0',
      }),
      expectedData: {
        order_id: 'SYSOID121330755',
        group_id: null,
        auth_code: null,
        ref_ret_num: null,
        proc_return_code: '81',
        transaction_id: null,
        error_code: 'B810002',
        error_message: 'Terminal Aktif Degil',
        status: 'declined',
      },
    },
  ],
]

export const refundTestDataProvider: Array<[string, RawCase]> = [
  [
    'fail1',
    {
      responseData: bankRecord({
        OrderId: 'SYSOID121332551',
        ProcReturnCode: '81',
        ErrorMessage: 'Terminal Aktif Degil',
        ErrorCode: 'B810002',
        Amount: '1,01',
      }),
      expectedData: {
        order_id: 'SYSOID121332551',
        group_id: null,
        auth_code: null,
        ref_ret_num: null,
        proc_return_code: '81',
        transaction_id: null,
        error_code: 'B810002',
        error_message: 'Terminal Aktif Degil',
        status: 'declined',
      },
    },
  ],
]
