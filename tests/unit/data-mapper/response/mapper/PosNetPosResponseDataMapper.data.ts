// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

interface PaymentCase {
  order: Data
  txType: 'pay'
  responseData: Data
  expectedData: Data
}

/** Stand-in for the "now" timestamp of an approved payment (the formatter stub returns it). */
export const NOW = new Date('2026-11-24T10:00:00.000Z')

export const paymentTestDataProvider: [string, PaymentCase][] = [
  [
    'success1',
    {
      order: { id: '202312171800ABC', currency: 'TRY', amount: 1.01 },
      txType: 'pay',
      responseData: {
        approved: '1',
        respCode: '',
        respText: '00',
        mac: 'DF2323A3BMC782QOP42RT',
        hostlogkey: '0000000002P0806031',
        authCode: '901477',
        instInfo: { inst1: '00', amnt1: '000000000000' },
        pointInfo: {
          point: '00000228',
          pointAmount: '000000000114',
          totalPoint: '00000000',
          totalPointAmount: '000000000000',
        },
      },
      expectedData: {
        order_id: '202312171800ABC',
        transaction_id: null,
        transaction_type: 'pay',
        transaction_time: NOW,
        installment_count: 0,
        currency: 'TRY',
        amount: 1.01,
        payment_model: 'regular',
        auth_code: '901477',
        ref_ret_num: '0000000002P0806031',
        batch_num: null,
        proc_return_code: '1',
        status: 'approved',
        error_code: null,
        error_message: '00',
      },
    },
  ],
  [
    'fail1',
    {
      order: { id: '202312171800ABC', currency: 'TRY', amount: 1.01 },
      txType: 'pay',
      responseData: {
        approved: '0',
        respCode: '0148',
        respText: 'INVALID MID TID IP. Hatalı IP:89.244.149.137',
      },
      expectedData: {
        order_id: '202312171800ABC',
        transaction_id: null,
        transaction_type: 'pay',
        transaction_time: null,
        installment_count: null,
        currency: 'TRY',
        amount: 1.01,
        payment_model: 'regular',
        auth_code: null,
        ref_ret_num: null,
        batch_num: null,
        proc_return_code: '0',
        status: 'declined',
        error_code: '0148',
        error_message: 'INVALID MID TID IP. Hatalı IP:89.244.149.137',
      },
    },
  ],
  [
    'fail2',
    {
      order: { id: '202312171800ABC', currency: 'TRY', amount: 1.01 },
      txType: 'pay',
      responseData: {
        order: { id: '202312171800ABC', currency: 'TRY', amount: 1.01 },
        txType: 'pay',
        approved: '2',
        respCode: '0127',
        respText: 'ORDERID DAHA ONCE KULLANILMIS 0127',
        hostlogkey: '020527337090000191',
        authCode: '273370',
        tranDate: '190703093340',
      },
      expectedData: {
        order_id: '202312171800ABC',
        transaction_id: null,
        transaction_type: 'pay',
        transaction_time: null,
        installment_count: null,
        currency: 'TRY',
        amount: 1.01,
        payment_model: 'regular',
        auth_code: '273370',
        ref_ret_num: '020527337090000191',
        batch_num: null,
        proc_return_code: '2',
        status: 'declined',
        error_code: '0127',
        error_message: 'ORDERID DAHA ONCE KULLANILMIS 0127',
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

const resolveBase = {
  xid: 'YKB_0000080603153823',
  amount: '5696',
  currency: 'TL',
  installment: '00',
  point: '0',
  pointAmount: '0',
}

export const threeDPaymentDataProvider: [string, ThreeDCase][] = [
  [
    'success1',
    {
      order: { id: '80603153823' },
      txType: 'pay',
      threeDResponseData: {
        approved: '1',
        respCode: '',
        respText: '',
        oosResolveMerchantDataResponse: {
          ...resolveBase,
          txStatus: 'Y',
          mdStatus: '1',
          mdErrorMessage: '',
          mac: 'y0fU6rRA0OvqJ5GN6uMdHVu6Xra7QR1qeT9rN7R1L+o=',
        },
      },
      paymentData: {
        approved: '1',
        respCode: '',
        respText: '00',
        mac: 'DF2323A3BMC782QOP42RT',
        hostlogkey: '0000000002P0806031',
        authCode: '901477',
        instInfo: { inst1: '00', amnt1: '000000000000' },
        pointInfo: {
          point: '00000228',
          pointAmount: '000000000114',
          totalPoint: '00000000',
          totalPointAmount: '000000000000',
        },
      },
      expectedData: {
        transaction_id: null,
        transaction_type: 'pay',
        transaction_time: NOW,
        transaction_security: 'Full 3D Secure',
        md_status: '1',
        md_error_message: null,
        installment_count: 0,
        auth_code: '901477',
        ref_ret_num: '0000000002P0806031',
        batch_num: null,
        error_code: null,
        error_message: '00',
        order_id: '80603153823',
        remote_order_id: 'YKB_0000080603153823',
        proc_return_code: '1',
        status: 'approved',
        amount: 56.96,
        currency: 'TRY',
        payment_model: '3d',
      },
    },
  ],
  [
    'auth_fail1',
    {
      order: { id: '80603153823' },
      txType: 'pay',
      threeDResponseData: {
        oosResolveMerchantDataResponse: {
          ...resolveBase,
          txStatus: 'N',
          mdStatus: '9',
          mdErrorMessage: 'None 3D - Secure Transaction',
          mac: 'ED7254A3ABC264QOP67MN',
        },
      },
      paymentData: {},
      expectedData: {
        transaction_id: null,
        transaction_type: 'pay',
        transaction_time: null,
        transaction_security: 'MPI fallback',
        md_status: '9',
        md_error_message: 'None 3D - Secure Transaction',
        auth_code: null,
        ref_ret_num: null,
        batch_num: null,
        error_code: null,
        error_message: null,
        order_id: '80603153823',
        remote_order_id: 'YKB_0000080603153823',
        proc_return_code: null,
        status: 'declined',
        amount: 56.96,
        currency: 'TRY',
        payment_model: '3d',
        installment_count: null,
      },
    },
  ],
  [
    'fail2-md-empty',
    {
      order: { id: '80603153823' },
      txType: 'pay',
      threeDResponseData: {
        oosResolveMerchantDataResponse: {
          ...resolveBase,
          txStatus: 'N',
          mdStatus: '',
          mdErrorMessage: 'None 3D - Secure Transaction',
          mac: 'ED7254A3ABC264QOP67MN',
        },
      },
      paymentData: {},
      expectedData: {
        transaction_id: null,
        transaction_type: 'pay',
        transaction_time: null,
        transaction_security: null,
        md_status: null,
        md_error_message: 'None 3D - Secure Transaction',
        auth_code: null,
        ref_ret_num: null,
        batch_num: null,
        error_code: null,
        error_message: null,
        order_id: '80603153823',
        remote_order_id: 'YKB_0000080603153823',
        proc_return_code: null,
        status: 'declined',
        amount: 56.96,
        currency: 'TRY',
        payment_model: '3d',
        installment_count: null,
      },
    },
  ],
  [
    'fail_no_oosResolveMerchantDataResponse',
    {
      order: { id: '80603153823' },
      txType: 'pay',
      threeDResponseData: {
        approved: '0',
        respCode: 'E216',
        respText: 'Mac Doğrulama hatalı',
      },
      paymentData: {},
      expectedData: {
        transaction_id: null,
        transaction_type: 'pay',
        transaction_time: null,
        amount: null,
        currency: null,
        installment_count: null,
        payment_model: '3d',
        order_id: null,
        auth_code: null,
        ref_ret_num: null,
        batch_num: null,
        proc_return_code: '0',
        status: 'declined',
        error_code: 'E216',
        error_message: 'Mac Doğrulama hatalı',
      },
    },
  ],
]

interface StatusCase {
  responseData: Data
  expectedData: Data
}

export const statusTestDataProvider: [string, StatusCase][] = [
  [
    'success1',
    {
      responseData: {
        approved: '1',
        transactions: {
          transaction: {
            orderID: 'TDS_YKB_0000191010111730',
            ccno: '4506 34** **** 4637',
            amount: '1,16',
            currencyCode: 'TL',
            authCode: '504289',
            tranDate: '2019-10-10 11:21:14.281',
            state: 'Sale',
            txnStatus: '1',
            hostlogkey: '021450428990000191',
          },
        },
      },
      expectedData: {
        auth_code: '504289',
        transaction_id: null,
        ref_ret_num: '021450428990000191',
        // deviation: P20 the bank time without offset is Türkiye time
        transaction_time: new Date('2019-10-10T11:21:14.281+03:00'),
        transaction_type: 'pay',
        proc_return_code: '1',
        status: 'approved',
        error_code: null,
        error_message: null,
        capture: null,
        capture_amount: null,
        first_amount: 1.16,
        masked_number: null,
        order_id: 'TDS_YKB_0000191010111730',
        order_status: null,
        capture_time: null,
        currency: 'TRY',
        cancel_time: null,
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
        approved: '0',
        respCode: '0148',
        respText: 'INVALID MID TID IP. Hatalı IP:89.244.149.137',
      },
      expectedData: {
        auth_code: null,
        transaction_id: null,
        ref_ret_num: null,
        transaction_type: null,
        capture: null,
        capture_amount: null,
        capture_time: null,
        currency: null,
        transaction_time: null,
        first_amount: null,
        masked_number: null,
        order_id: null,
        order_status: null,
        proc_return_code: '0',
        status: 'declined',
        error_code: '0148',
        error_message: 'INVALID MID TID IP. Hatalı IP:89.244.149.137',
        cancel_time: null,
        refund_amount: null,
        refund_time: null,
        installment_count: null,
      },
    },
  ],
]

export const refundTestDataProvider: [string, StatusCase][] = [
  [
    'fail1',
    {
      responseData: {
        approved: '0',
        respCode: '0148',
        respText: 'INVALID MID TID IP. Hatalı IP:89.244.149.137',
      },
      expectedData: {
        auth_code: null,
        transaction_id: null,
        ref_ret_num: null,
        group_id: null,
        date: null,
        transaction_type: null,
        proc_return_code: '0',
        status: 'declined',
        error_code: '0148',
        error_message: 'INVALID MID TID IP. Hatalı IP:89.244.149.137',
      },
    },
  ],
]
