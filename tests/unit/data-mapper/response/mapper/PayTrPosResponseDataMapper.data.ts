import { MODEL, PAYMENT_STATUS, TX_TYPE } from '../../../../../src/PosInterface.js'

// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

export interface Case {
  readonly responseData: Data
  readonly expectedData: Data
  readonly order?: Data
}

const APPROVED = 'approved'
const DECLINED = 'declined'

const defaultPayment = (model: string): Data => ({
  order_id: null,
  transaction_id: null,
  transaction_time: null,
  transaction_type: TX_TYPE.PAY_AUTH,
  installment_count: null,
  currency: null,
  amount: null,
  payment_model: model,
  auth_code: null,
  ref_ret_num: null,
  batch_num: null,
  proc_return_code: null,
  status: DECLINED,
  error_code: null,
  error_message: null,
})

const defaultCallback = (model: string): Data => ({
  ...defaultPayment(model),
  md_status: null,
  md_error_message: null,
  transaction_security: null,
})

export const paymentCases: Record<string, Case> = {
  empty_response: {
    responseData: {},
    order: { id: 'order-1' },
    expectedData: defaultPayment(MODEL.NON_SECURE),
  },
  success: {
    responseData: {
      merchant_oid: '20260623E335',
      status: 'success',
      total_amount: '1001',
      currency: 'TL',
      installment_count: '0',
    },
    order: { id: '20260623E335' },
    // transaction_time is asserted as a time range by the test, then removed
    expectedData: {
      ...defaultPayment(MODEL.NON_SECURE),
      order_id: '20260623E335',
      installment_count: 0,
      currency: 'TRY',
      amount: 10.01,
      status: APPROVED,
    },
  },
  success_with_installment: {
    responseData: {
      merchant_oid: 'order-inst',
      status: 'success',
      total_amount: '30000',
      currency: 'USD',
      installment_count: '3',
    },
    order: { id: 'order-inst' },
    expectedData: {
      ...defaultPayment(MODEL.NON_SECURE),
      order_id: 'order-inst',
      installment_count: 3,
      currency: 'USD',
      amount: 300,
      status: APPROVED,
    },
  },
  failure_with_failed_reason_msg: {
    responseData: {
      merchant_oid: 'order-fail',
      status: 'failed',
      failed_reason_code: '51',
      failed_reason_msg: 'Insufficient funds',
    },
    order: { id: 'order-fail', amount: 10.5, currency: 'TRY' },
    expectedData: {
      ...defaultPayment(MODEL.NON_SECURE),
      order_id: 'order-fail',
      amount: null,
      currency: 'TRY',
      error_code: '51',
      error_message: 'Insufficient funds',
    },
  },
  failure_no_merchant_oid_uses_order_id: {
    responseData: { status: 'failed', failed_reason_code: '99' },
    order: { id: 'fallback-id' },
    expectedData: { ...defaultPayment(MODEL.NON_SECURE), order_id: 'fallback-id', error_code: '99' },
  },
}

export const threeDHostCases: Record<string, Case> = {
  empty_callback: { responseData: {}, expectedData: defaultCallback(MODEL.THREE_D_HOST) },
  single_fail_message: {
    responseData: { fail_message: '3D auth rejected by bank' },
    expectedData: { ...defaultCallback(MODEL.THREE_D_HOST), md_error_message: '3D auth rejected by bank' },
  },
  success: {
    responseData: {
      hash: '+jxQ32k1XbdS6i7iBQecCZ7fFhRrStaZBMvbsRzRVZE=',
      merchant_oid: '20260624B505',
      status: 'success',
      total_amount: '1001',
      payment_type: 'card',
      payment_amount: '1001',
      currency: 'TL',
      installment_count: '1',
      merchant_id: '123456',
      test_mode: '1',
    },
    expectedData: {
      ...defaultCallback(MODEL.THREE_D_HOST),
      order_id: '20260624B505',
      installment_count: 0,
      currency: 'TRY',
      amount: 10.01,
      status: APPROVED,
    },
  },
  failure: {
    responseData: {
      merchant_oid: 'order-host-fail',
      status: 'failed',
      total_amount: '0',
      failed_reason_code: '05',
      failed_reason_msg: 'Do not honour',
      currency: 'TL',
      installment_count: '0',
      hash: 'bad-hash',
    },
    expectedData: {
      ...defaultCallback(MODEL.THREE_D_HOST),
      order_id: 'order-host-fail',
      error_code: '05',
      error_message: 'Do not honour',
    },
  },
}

export const threeDPayCases: Record<string, Case> = {
  empty_callback_data: { responseData: {}, expectedData: defaultCallback(MODEL.THREE_D_PAY) },
  single_key_fail_message: {
    responseData: { fail_message: 'Test modu hata mesajı. (Gerçek modda ilgili hata mesajı dönecektir)' },
    expectedData: {
      ...defaultCallback(MODEL.THREE_D_PAY),
      md_error_message: 'Test modu hata mesajı. (Gerçek modda ilgili hata mesajı dönecektir)',
    },
  },
  success: {
    responseData: {
      hash: 'kwKu739W963OrNp5CSIecYlBpp8x2mql1wDWtSWZhjc=',
      merchant_oid: '20260623E335',
      status: 'success',
      total_amount: '1001',
      payment_type: 'card',
      payment_amount: '1001',
      currency: 'TL',
      installment_count: '1',
      merchant_id: '123456',
      test_mode: '1',
    },
    expectedData: {
      ...defaultCallback(MODEL.THREE_D_PAY),
      order_id: '20260623E335',
      installment_count: 0,
      currency: 'TRY',
      amount: 10.01,
      status: APPROVED,
    },
  },
  failure: {
    responseData: {
      merchant_oid: 'test-order-456',
      status: 'failed',
      total_amount: '0',
      hash: 'xyz789hash',
      payment_type: '',
      failed_reason_code: '51',
      failed_reason_msg: 'Insufficient funds',
      test_mode: '1',
      currency: 'TL',
      installment_count: '0',
    },
    expectedData: {
      ...defaultCallback(MODEL.THREE_D_PAY),
      order_id: 'test-order-456',
      error_code: '51',
      error_message: 'Insufficient funds',
    },
  },
}

const D = (iso: string): Date => new Date(`${iso}+03:00`)

const statusBase = {
  net_tutar: '0.00',
  kesinti_tutari: '0.00',
  kesinti_orani: '0.00',
  payment_date: '23.06.2026',
  auth_date: '23.06.2026',
  currency: 'TL',
  taksit: '0',
  kart_marka: '',
  masked_pan: null,
  odeme_tipi: 'KART',
  test_mode: '1',
}

const defaultStatus: Data = {
  order_id: null,
  auth_code: null,
  proc_return_code: null,
  transaction_id: null,
  transaction_type: null,
  transaction_time: null,
  capture_time: null,
  ref_ret_num: null,
  order_status: null,
  first_amount: null,
  capture_amount: null,
  status: DECLINED,
  error_code: null,
  error_message: null,
  capture: null,
  currency: null,
  masked_number: null,
  refund_amount: null,
  refund_time: null,
  cancel_time: null,
  installment_count: null,
}

const completedStatus: Data = {
  ...defaultStatus,
  proc_return_code: 'success',
  transaction_time: D('2026-06-23T00:00:00'),
  capture_time: D('2026-06-23T00:00:00'),
  order_status: PAYMENT_STATUS.PAYMENT_COMPLETED,
  status: APPROVED,
  capture: true,
  currency: 'TRY',
  installment_count: 0,
}

export const statusCases: Record<string, Case> = {
  success_payment_completed_no_refund: {
    responseData: {
      status: 'success',
      ...statusBase,
      payment_amount: '10.01',
      payment_total: '10.01',
      auth_code: 'XXXXXX',
      returns: [],
    },
    expectedData: { ...completedStatus, first_amount: 10.01, capture_amount: 10.01 },
  },
  success_payment_completed_with_installment: {
    responseData: {
      status: 'success',
      ...statusBase,
      payment_amount: '100.00',
      payment_total: '100.00',
      auth_code: 'YYYYYY',
      taksit: '3',
      kart_marka: 'VISA',
      masked_pan: '411111****1111',
      returns: [],
    },
    expectedData: {
      ...completedStatus,
      first_amount: 100,
      capture_amount: 100,
      masked_number: '411111****1111',
      installment_count: 3,
    },
  },
  success_partially_refunded: {
    responseData: {
      status: 'success',
      ...statusBase,
      payment_amount: '10.00',
      payment_total: '10.00',
      auth_code: 'ZZZZZZ',
      // deviation: S1 — refund entries carry return_amount in TL (official), not refund_amount in kuruş
      returns: [{ return_amount: '5.00', return_date: '24.06.2026' }],
    },
    expectedData: {
      ...completedStatus,
      order_status: PAYMENT_STATUS.PARTIALLY_REFUNDED,
      first_amount: 10,
      capture_amount: 10,
      refund_amount: 5,
      refund_time: D('2026-06-24T00:00:00'),
    },
  },
  success_fully_refunded: {
    responseData: {
      status: 'success',
      ...statusBase,
      payment_amount: '10.00',
      payment_total: '10.00',
      auth_code: 'AAAAAA',
      // deviation: S1 — refund entries carry return_amount in TL (official), not refund_amount in kuruş
      returns: [{ return_amount: '10.00', return_date: '25.06.2026' }],
    },
    expectedData: {
      ...completedStatus,
      order_status: PAYMENT_STATUS.FULLY_REFUNDED,
      first_amount: 10,
      capture_amount: 10,
      refund_amount: 10,
      refund_time: D('2026-06-25T00:00:00'),
    },
  },
  failure_order_not_found: {
    responseData: { status: 'error', err_no: '004', err_msg: 'merchant_oid ile basarili odeme bulunamadi' },
    expectedData: { ...defaultStatus, error_code: '004', error_message: 'merchant_oid ile basarili odeme bulunamadi' },
  },
  success_minimal_fields_no_optional: {
    responseData: { status: 'success', returns: [] },
    expectedData: {
      ...defaultStatus,
      proc_return_code: 'success',
      order_status: PAYMENT_STATUS.PAYMENT_COMPLETED,
      status: APPROVED,
      capture: false,
    },
  },
}

export const refundCases: Record<string, Case> = {
  success: {
    responseData: {
      status: 'success',
      is_test: '1',
      merchant_oid: '2026062350B3',
      return_amount: '6.00',
      reference_no: null,
    },
    expectedData: {
      order_id: '2026062350B3',
      status: APPROVED,
      refund_amount: 6,
      ref_ret_num: null,
      error_code: null,
      error_message: null,
    },
  },
  failure_amount_exceeds_remaining: {
    responseData: {
      status: 'error',
      err_no: '009',
      err_msg: 'Talep edilen iade tutari (12 TL), kalan tutardan (10.01 TL) fazla olamaz.',
    },
    expectedData: {
      order_id: null,
      status: DECLINED,
      refund_amount: null,
      ref_ret_num: null,
      error_code: '009',
      error_message: 'Talep edilen iade tutari (12 TL), kalan tutardan (10.01 TL) fazla olamaz.',
    },
  },
}
