import { readFileSync } from 'node:fs'
import { CURRENCY, TX_TYPE } from '../../../../../src/PosInterface.js'

// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
export type Data = Record<string, any>

export type PaymentCase = { order: Data; txType: string; responseData: Data; expectedData: Data }
export type ThreeDCase = {
  order: Data
  txType: string
  threeDResponseData: Data
  paymentData: Data
  expectedData: Data
}
export type ThreeDPayCase = { order: Data; txType: string; paymentData: Data; expectedData: Data }
export type ResultCase = { responseData: Data; expectedData: Data }

// deviation: C7 result codes are canonical integer text ('1', '-1', '-100'), not integers
// deviation: Türkiye time, wall-clock dates are read as UTC+03:00

/** Marks "the time of the call": the mapper reads the clock, the tests compare the Türkiye calendar day. */
export const NOW = Symbol('now')

const BANK_EXTRA_SALE = `<Extra>
    <SETTLEID>15510</SETTLEID>
    <TRXDATE>20250104 14:35:41</TRXDATE>
    <ERRORCODE></ERRORCODE>
    <TERMINALID>0067672</TERMINALID>
    <MERCHANTID>306754300</MERCHANTID>
    <AVSAPPROVALINFORMATION>N</AVSAPPROVALINFORMATION>
    <CARDBRAND>VISA</CARDBRAND>
    <CARDISSUER>T. IS BANKASI A.S.</CARDISSUER>
    <AVSAPPROVE>Y</AVSAPPROVE>
    <HOSTDATE>0104-143542</HOSTDATE>
    <APIHASH>KRCvC47lNU5BZZbG6JyiV2Exjo/DOs6USfpermp8ah3XfNOeIh5gInrOJVABJ0VSQmgAAkSfqCVmVjxmPVGaeg==</APIHASH>
    <APIHASHVERSION>ver2</APIHASHVERSION>
    <AVSAPPROVALMSG>AVS dogrulama yap�l�yor uzunluk yetmedik</AVSAPPROVALMSG>
    <AVSERRORCODEDETAIL>avshatali-avshatali-avshatali-avshatali-</AVSERRORCODEDETAIL>
    <NUMCODE>00</NUMCODE>
  </Extra>`

const BANK_EXTRA_PROVISION = `<Extra>
<SETTLEID>2881</SETTLEID>
<TRXDATE>20241229 19:10:36</TRXDATE>
<ERRORCODE></ERRORCODE>
<CARDBRAND>VISA</CARDBRAND>
<CARDISSUER>Z&#x130;RAAT BANKASI</CARDISSUER>
<KAZANILANPUAN>000000010.00</KAZANILANPUAN>
<NUMCODE>00</NUMCODE>
</Extra>`

const BANK_EXTRA_STATUS = `<Extra>
    <AUTH_CODE>222905</AUTH_CODE>
    <AUTH_DTTM>2025-01-05 13:14:32.162</AUTH_DTTM>
    <CAPTURE_AMT>1001</CAPTURE_AMT>
    <CAPTURE_DTTM>2025-01-05 13:14:32.162</CAPTURE_DTTM>
    <CAVV_3D></CAVV_3D>
    <CHARGE_TYPE_CD>S</CHARGE_TYPE_CD>
    <ECI_3D></ECI_3D>
    <HOSTDATE>0105-131432</HOSTDATE>
    <HOST_REF_NUM>500513472717</HOST_REF_NUM>
    <MDSTATUS></MDSTATUS>
    <NUMCODE>0</NUMCODE>
    <ORDERSTATUS>ORD_ID:10126021842587\tCHARGE_TYPE_CD:S\tORIG_TRANS_AMT:1001\tCAPTURE_AMT:1001\tTRANS_STAT:C\tAUTH_DTTM:2025-01-05 13:14:32.162\tCAPTURE_DTTM:2025-01-05 13:14:32.162\tAUTH_CODE:222905\tTRANS_ID:25005NOgE12061</ORDERSTATUS>
    <ORD_ID>10126021842587</ORD_ID>
    <ORIG_TRANS_AMT>1001</ORIG_TRANS_AMT>
    <PAN>5818 77** **** 2285</PAN>
    <PROC_RET_CD>00</PROC_RET_CD>
    <SETTLEID></SETTLEID>
    <TRANS_ID>25005NOgE12061</TRANS_ID>
    <TRANS_STAT>C</TRANS_STAT>
    <XID_3D></XID_3D>
  </Extra>`

const BANK_EXTRA_CANCEL = `
<Extra>
<SETTLEID>2976</SETTLEID>
<TRXDATE>20250105 14:01:56</TRXDATE>
<ERRORCODE></ERRORCODE>
<CARDBRAND>MASTERCARD</CARDBRAND>
<CARDISSUER>T. HALK BANKASI A.S.</CARDISSUER>
<CAVVRESULTCODE>3</CAVVRESULTCODE>
<NUMCODE>00</NUMCODE>
</Extra>
          `

const ORDER_TRY = { currency: CURRENCY.TRY, amount: 1.01 }

export const paymentCases: Record<string, PaymentCase> = {
  success_foreign_currency: {
    order: { id: '2025010408A0', currency: CURRENCY.USD, amount: 1.01 },
    txType: TX_TYPE.PAY_AUTH,
    responseData: {
      TP_Islem_Odeme_WDResponse: {
        TP_Islem_Odeme_WDResult: {
          Islem_ID: '3007300589',
          UCD_URL: 'NONSECURE',
          Sonuc: '1',
          Sonuc_Str: 'İşlem Başarılı',
          Banka_Sonuc_Kod: '0',
          Komisyon_Oran: '1.75',
        },
      },
    },
    expectedData: {
      amount: 1.01,
      auth_code: null,
      batch_num: null,
      currency: 'USD',
      error_code: null,
      error_message: null,
      installment_count: null,
      order_id: '2025010408A0',
      payment_model: 'regular',
      proc_return_code: '1',
      ref_ret_num: null,
      status: 'approved',
      transaction_id: null,
      transaction_type: 'pay',
      transaction_time: NOW,
    },
  },
  success1: {
    order: ORDER_TRY,
    txType: TX_TYPE.PAY_AUTH,
    responseData: {
      TP_WMD_UCDResponse: {
        TP_WMD_UCDResult: {
          Islem_ID: '3007296556',
          UCD_HTML: 'NONSECURE',
          Sonuc: '1',
          Sonuc_Str: 'İşlem Başarılı',
          Bank_Trans_ID: '25004OjqB07040101',
          Bank_AuthCode: 'P77950',
          Bank_HostMsg: '',
          Banka_Sonuc_Kod: '0',
          Bank_Extra: BANK_EXTRA_SALE,
          Siparis_ID: '2025010408A0',
          Bank_HostRefNum: '500400109501',
        },
      },
    },
    expectedData: {
      amount: 1.01,
      auth_code: 'P77950',
      batch_num: null,
      currency: 'TRY',
      error_code: null,
      error_message: null,
      installment_count: null,
      order_id: '2025010408A0',
      payment_model: 'regular',
      proc_return_code: '1',
      ref_ret_num: '500400109501',
      status: 'approved',
      transaction_id: '25004OjqB07040101',
      transaction_type: 'pay',
      transaction_time: NOW,
    },
  },
  success_pre_payment: {
    order: ORDER_TRY,
    txType: TX_TYPE.PAY_PRE_AUTH,
    responseData: {
      TP_Islem_Odeme_OnProv_WMDResponse: {
        TP_Islem_Odeme_OnProv_WMDResult: {
          Islem_ID: '6005034747',
          Islem_GUID: '72c9b68c-fedc-488e-9166-ae9fc7d4e523',
          UCD_HTML: 'NONSECURE',
          Sonuc: '1',
          Sonuc_Str: 'Ön Provizyon İşlemi Başarılı',
          Bank_Trans_ID: '21292RsEI18157',
          Bank_AuthCode: 'P66791',
          Bank_HostMsg: '',
          Banka_Sonuc_Kod: '0',
          Bank_Extra: 'bank data',
          Siparis_ID: '2025010408A0',
          Ext_Data: 'a|a|a|a|a',
        },
      },
    },
    expectedData: {
      amount: 1.01,
      auth_code: 'P66791',
      batch_num: null,
      currency: 'TRY',
      error_code: null,
      error_message: null,
      installment_count: null,
      order_id: '2025010408A0',
      payment_model: 'regular',
      proc_return_code: '1',
      ref_ret_num: null,
      status: 'approved',
      transaction_id: '21292RsEI18157',
      transaction_type: 'pre',
      transaction_time: NOW,
    },
  },
  success_post_payment: {
    order: ORDER_TRY,
    txType: TX_TYPE.PAY_POST_AUTH,
    responseData: {
      TP_Islem_Odeme_OnProv_KapaResponse: {
        TP_Islem_Odeme_OnProv_KapaResult: {
          Sonuc: '1',
          Sonuc_Str: 'Provizyon Kapama İşlem Başarılı',
          Prov_ID: 'f7184b1f-c4c2-4d2e-8428-fc6014a00900',
          Dekont_ID: '6004466311',
          Banka_Sonuc_Kod: '0',
          Siparis_ID: '20250105CB05',
          Bank_Trans_ID: '25005RvnD11226',
          Bank_AuthCode: '519104',
          Bank_HostRefNum: '500517472728',
          Bank_Extra: 'bank-data',
          Bank_HostMsg: null,
        },
      },
    },
    expectedData: {
      amount: 1.01,
      auth_code: '519104',
      batch_num: null,
      currency: 'TRY',
      error_code: null,
      error_message: null,
      installment_count: null,
      order_id: '20250105CB05',
      payment_model: 'regular',
      proc_return_code: '1',
      ref_ret_num: '500517472728',
      status: 'approved',
      transaction_id: '25005RvnD11226',
      transaction_type: 'post',
      transaction_time: NOW,
    },
  },
  fail_try_again: {
    order: ORDER_TRY,
    txType: TX_TYPE.PAY_AUTH,
    responseData: {
      TP_WMD_UCDResponse: {
        TP_WMD_UCDResult: {
          Islem_ID: '0',
          UCD_HTML: 'NONSECURE',
          Sonuc: '-1',
          Sonuc_Str: 'Tekrar girin, tekrar deneyin.',
          Banka_Sonuc_Kod: '99',
          Bank_Extra: '\n \n 20250104 14:25:24\n ISO8583-19\n 99858319\n ',
          Siparis_ID: '20250104586F',
        },
      },
    },
    expectedData: {
      amount: null,
      auth_code: null,
      batch_num: null,
      currency: null,
      error_code: '-1',
      error_message: 'Tekrar girin, tekrar deneyin.',
      installment_count: null,
      order_id: null,
      payment_model: 'regular',
      proc_return_code: '-1',
      ref_ret_num: null,
      status: 'declined',
      transaction_id: null,
      transaction_type: 'pay',
      transaction_time: null,
    },
  },
}

const MD_SUCCESS = {
  md: '444676:13FDE30917BF65D853787DB838390849D73151A10FC8C1192AC72660F2464521:3473:##190100000',
  mdStatus: '1',
  orderId: '202412292160',
  transactionAmount: '10,01',
  islemGUID: '8b6868fe-a553-4164-a7cc-528461f21759',
  islemHash: 'jF0PD92E+dM394Z1h5qm4SB6pPo=',
  bankResult:
    'Y-status/Challenge authentication via ACS: https://3ds-acs.test.modirum.com/mdpayacs/DkaeFfwOZ334oKIk/creq;token=338860451.17354  1',
  dc: '',
  dcURL: 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx',
}

export const provisionSuccess: Data = {
  TP_WMD_PayResponse: {
    TP_WMD_PayResult: {
      Sonuc: '1',
      Sonuc_Ack: 'Başarılı',
      Dekont_ID: '3007295376',
      Siparis_ID: '202412292160',
      UCD_MD: '444676:E997FB32A642B0929CCDB822BB3BB2B65050DAAA2E57A31F3E510B8664954C03:3915:##190100000',
      Bank_Trans_ID: '24364TKkF16602',
      Bank_AuthCode: '150888',
      Bank_HostMsg: 'Approved',
      Bank_Extra: BANK_EXTRA_PROVISION,
      Bank_Sonuc_Kod: '0',
      Bank_HostRefNum: '436419200463',
      Komisyon_Oran: '1.01',
    },
  },
}

export const threeDCases: Record<string, ThreeDCase> = {
  success1: {
    order: ORDER_TRY,
    txType: TX_TYPE.PAY_AUTH,
    threeDResponseData: MD_SUCCESS,
    paymentData: provisionSuccess,
    expectedData: {
      amount: 10.01,
      auth_code: '150888',
      batch_num: null,
      currency: 'TRY',
      error_code: null,
      error_message: null,
      installment_count: null,
      md_error_message: null,
      md_status: '1',
      order_id: '202412292160',
      payment_model: '3d',
      proc_return_code: '1',
      ref_ret_num: '436419200463',
      status: 'approved',
      transaction_id: '24364TKkF16602',
      transaction_security: null,
      transaction_type: 'pay',
      transaction_time: null,
    },
  },
  '3d_auth_fail': {
    order: ORDER_TRY,
    txType: TX_TYPE.PAY_AUTH,
    threeDResponseData: {
      md: '444676:84E83D96A7CEC3A5815D49EB7F64D2709D1BC30425D578D118B9819A81749FB8:4429:##190100000',
      mdStatus: '0',
      orderId: '20241229C152',
      transactionAmount: '1000,01',
      islemGUID: 'c1ee369b-ec27-4ab6-8c27-2e15e62793d3',
      islemHash: 'N1/W7/GcbuT3UVwVM9Q5C/rmoKg=',
      bankResult:
        'N-status/Challenge authentication via ACS: https://3ds-acs.test.modirum.com/mdpayacs/wkwLCHgiNwZCiVZp/creq;token=338863271.17354  0',
      dc: null,
      dcURL: 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx',
    },
    paymentData: {},
    expectedData: {
      amount: 1000.01,
      auth_code: null,
      batch_num: null,
      currency: 'TRY',
      error_code: null,
      error_message: null,
      installment_count: null,
      md_error_message: null,
      md_status: '0',
      order_id: '20241229C152',
      payment_model: '3d',
      proc_return_code: null,
      ref_ret_num: null,
      status: 'declined',
      transaction_id: null,
      transaction_security: null,
      transaction_time: null,
      transaction_type: 'pay',
    },
  },
  '3d_auth_success_payment_fail': {
    order: ORDER_TRY,
    txType: TX_TYPE.PAY_AUTH,
    threeDResponseData: {
      md: '444676:B1748AA7FF30A96AADFECC19670A3038C1419A842DD221D2408708A84FE9D811:4011:##190100000',
      mdStatus: '1',
      orderId: '202412306616',
      transactionAmount: '10,01',
      islemGUID: '5ee6c14d-94c2-48c9-bfe1-da31c415e647',
      islemHash: 'zrHcS2iMl0J0GPU6DalIdOppDz8=',
      bankResult:
        'Y-status/Challenge authentication via ACS: https://3ds-acs.test.modirum.com/mdpayacs/GfPAbJmZtVUkn73n/creq;token=338907941.17355  1',
      dc: 'd1',
      dcURL: 'https://test-dmzd1.param.com.tr/turkpos.ws/service_turkpos_test.asmx',
    },
    paymentData: {
      TP_WMD_PayResponse: {
        TP_WMD_PayResult: {
          Sonuc: '-100',
          Sonuc_Ack: 'Hesap bulunamadı.',
          Bank_Sonuc_Kod: '-1',
          Komisyon_Oran: '0',
        },
      },
    },
    expectedData: {
      amount: 10.01,
      auth_code: null,
      batch_num: null,
      currency: 'TRY',
      error_code: '-100',
      error_message: 'Hesap bulunamadı.',
      installment_count: null,
      md_error_message: null,
      md_status: '1',
      order_id: '202412306616',
      payment_model: '3d',
      proc_return_code: '-100',
      ref_ret_num: null,
      status: 'declined',
      transaction_id: null,
      transaction_security: null,
      transaction_type: 'pay',
      transaction_time: null,
    },
  },
  '3d_auth_success_payment_fail_not_found': {
    order: ORDER_TRY,
    txType: TX_TYPE.PAY_AUTH,
    threeDResponseData: {
      md: '444676:A78A6D388E30776DA8F0EB5920F615F9AA523AC0E1EBA1499DB65C2B2BC4F29B:4474:##190100000',
      mdStatus: '1',
      orderId: '20250104E733',
      transactionAmount: '10,01',
      islemGUID: '45c47ad7-2d2a-4e9f-adca-a9641cd34b74',
      islemHash: 'TLN7U1O+XAreUpt7nx6UlP63nzc=',
      bankResult:
        'Y-status/Challenge authentication via ACS: https://3ds-acs.test.modirum.com/mdpayacs/5KExb5V_7OxhntjM/creq;token=339263081.17359  1',
      dc: null,
      dcURL: 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx',
    },
    paymentData: {
      TP_WMD_PayResponse: {
        TP_WMD_PayResult: {
          Sonuc: '-1',
          Sonuc_Ack: 'İşlem bilgisi sorgulanamadı.',
          Bank_Sonuc_Kod: '-1',
          Komisyon_Oran: '0',
        },
      },
    },
    expectedData: {
      amount: 10.01,
      auth_code: null,
      batch_num: null,
      currency: 'TRY',
      error_code: '-1',
      error_message: 'İşlem bilgisi sorgulanamadı.',
      installment_count: null,
      md_error_message: null,
      md_status: '1',
      order_id: '20250104E733',
      payment_model: '3d',
      proc_return_code: '-1',
      ref_ret_num: null,
      status: 'declined',
      transaction_id: null,
      transaction_security: null,
      transaction_type: 'pay',
      transaction_time: null,
    },
  },
}

const TURKPOS_SUCCESS = {
  TURKPOS_RETVAL_Islem_ID: '1944A39AD0AEA92E173D665B',
  TURKPOS_RETVAL_Sonuc: '1',
  TURKPOS_RETVAL_Sonuc_Str: 'Odeme Islemi Basarili',
  TURKPOS_RETVAL_GUID: '0c13d406-873b-403b-9c09-a5766840d98c',
  TURKPOS_RETVAL_Islem_Tarih: '19.01.2025 17:29:32',
  TURKPOS_RETVAL_Dekont_ID: '3007300695',
  TURKPOS_RETVAL_Tahsilat_Tutari: '10,01',
  TURKPOS_RETVAL_Odeme_Tutari: '9,83',
  TURKPOS_RETVAL_Siparis_ID: '20250119BACB',
  TURKPOS_RETVAL_Ext_Data: '|||||||||',
  TURKPOS_RETVAL_Banka_Sonuc_Kod: '0',
  TURKPOS_RETVAL_PB: 'TL',
  TURKPOS_RETVAL_KK_No: '581877******2285',
  TURKPOS_RETVAL_Taksit: '0',
  TURKPOS_RETVAL_Hash: 'LOpkL9J8vne8E2j0A0HKOhUWGhI=',
  TURKPOS_RETVAL_Islem_GUID: '77f11031-cce8-4131-bf95-142303732608',
  TURKPOS_RETVAL_SanalPOS_Islem_ID: '6021847062',
}

const TURKPOS_AUTH_FAIL = {
  TURKPOS_RETVAL_Islem_ID: 'FF0591BD887935E481743533',
  TURKPOS_RETVAL_Sonuc: '-1',
  TURKPOS_RETVAL_Sonuc_Str:
    '3D Dogrulamasi Basarisiz. [3D Hatasi: N-status/Challenge authentication via ACS: https://3ds-acs.test.modirum.com/mdpayacs/I-yRFxWEcBOCtERD/creq;token=340262061.17373]',
  TURKPOS_RETVAL_GUID: '0c13d406-873b-403b-9c09-a5766840d98c',
  TURKPOS_RETVAL_Islem_Tarih: '19.01.2025 18:53:48',
  TURKPOS_RETVAL_Dekont_ID: '0',
  TURKPOS_RETVAL_Tahsilat_Tutari: '10,01',
  TURKPOS_RETVAL_Odeme_Tutari: '9,83',
  TURKPOS_RETVAL_Siparis_ID: '202501193584',
  TURKPOS_RETVAL_Ext_Data: '|||||||||',
  TURKPOS_RETVAL_Banka_Sonuc_Kod: '-1',
  TURKPOS_RETVAL_PB: 'TL',
  TURKPOS_RETVAL_KK_No: '581877******2285',
  TURKPOS_RETVAL_Taksit: '0',
  TURKPOS_RETVAL_Hash: '+qCEIrH+7ARPmJC55MGQCykg8pk=',
  TURKPOS_RETVAL_Islem_GUID: '93dd02a2-d43b-42aa-83b1-a3fc7d8393ab',
  TURKPOS_RETVAL_SanalPOS_Islem_ID: '6021847067',
}

const ORDER_INSTALLMENT_0 = { currency: CURRENCY.TRY, amount: 1.01, installment: 0 }

const declinedExpectation = (paymentModel: string, errorMessage: string): Data => ({
  amount: null,
  auth_code: null,
  batch_num: null,
  currency: null,
  error_code: '-1',
  error_message: errorMessage,
  installment_count: null,
  order_id: null,
  payment_model: paymentModel,
  proc_return_code: '-1',
  ref_ret_num: null,
  status: 'declined',
  transaction_id: null,
  transaction_type: 'pay',
  transaction_time: null,
  md_error_message: null,
  md_status: null,
  transaction_security: null,
})

const AUTH_FAIL_MESSAGE = TURKPOS_AUTH_FAIL.TURKPOS_RETVAL_Sonuc_Str

export const threeDHostCases: Record<string, ThreeDPayCase> = {
  success1: {
    order: ORDER_INSTALLMENT_0,
    txType: TX_TYPE.PAY_AUTH,
    paymentData: TURKPOS_SUCCESS,
    expectedData: {
      transaction_id: null,
      transaction_time: new Date('2025-01-19T17:29:32+03:00'),
      transaction_type: 'pay',
      masked_number: '581877******2285',
      auth_code: null,
      batch_num: null,
      ref_ret_num: null,
      error_code: null,
      error_message: null,
      order_id: '20250119BACB',
      proc_return_code: '1',
      status: 'approved',
      payment_model: '3d_host',
      currency: 'TRY',
      amount: 10.01,
      installment_count: 0,
      md_error_message: null,
      md_status: null,
      transaction_security: null,
    },
  },
  auth_fail: {
    order: ORDER_INSTALLMENT_0,
    txType: TX_TYPE.PAY_AUTH,
    paymentData: TURKPOS_AUTH_FAIL,
    expectedData: declinedExpectation('3d_host', AUTH_FAIL_MESSAGE),
  },
}

export const threeDPayCases: Record<string, ThreeDPayCase> = {
  success1: {
    order: ORDER_INSTALLMENT_0,
    txType: TX_TYPE.PAY_AUTH,
    paymentData: TURKPOS_SUCCESS,
    expectedData: {
      transaction_id: null,
      transaction_time: new Date('2025-01-19T17:29:32+03:00'),
      transaction_type: 'pay',
      masked_number: '581877******2285',
      auth_code: null,
      batch_num: null,
      ref_ret_num: null,
      error_code: null,
      error_message: null,
      order_id: '20250119BACB',
      proc_return_code: '1',
      status: 'approved',
      payment_model: '3d_pay',
      currency: 'TRY',
      amount: 10.01,
      installment_count: 0,
      md_error_message: null,
      md_status: null,
      transaction_security: null,
    },
  },
  success_foreign_currency: {
    order: { currency: CURRENCY.EUR, amount: 1.01, installment: 0 },
    txType: TX_TYPE.PAY_AUTH,
    paymentData: {
      TURKPOS_RETVAL_Islem_ID: '25B4E0BAAD1F3FC05D46F5B4',
      TURKPOS_RETVAL_Sonuc: '1',
      TURKPOS_RETVAL_Sonuc_Str: 'Odeme Islemi Basarili',
      TURKPOS_RETVAL_GUID: '0c13d406-873b-403b-9c09-a5766840d98c',
      TURKPOS_RETVAL_Islem_Tarih: '5.01.2025 14:52:20',
      TURKPOS_RETVAL_Dekont_ID: '3007296668',
      TURKPOS_RETVAL_Tahsilat_Tutari: '10,01',
      TURKPOS_RETVAL_Odeme_Tutari: '9,83',
      TURKPOS_RETVAL_Siparis_ID: '202501053F4F',
      TURKPOS_RETVAL_Ext_Data: '||||',
      TURKPOS_RETVAL_Banka_Sonuc_Kod: '0',
      TURKPOS_RETVAL_PB: 'USD',
      TURKPOS_RETVAL_KK_No: '581877******2285',
      TURKPOS_RETVAL_Taksit: '0',
      TURKPOS_RETVAL_Hash: 'LrFgOcE6S8HzNF4tzvtORAh3C20=',
      TURKPOS_RETVAL_Islem_GUID: '597b2fc9-df6d-40d7-861a-c4f5d0e94ed3',
      TURKPOS_RETVAL_SanalPOS_Islem_ID: '6021842602',
    },
    expectedData: {
      amount: 10.01,
      auth_code: null,
      batch_num: null,
      currency: 'USD',
      error_code: null,
      error_message: null,
      installment_count: 0,
      masked_number: '581877******2285',
      order_id: '202501053F4F',
      payment_model: '3d_pay',
      proc_return_code: '1',
      ref_ret_num: null,
      status: 'approved',
      transaction_id: null,
      transaction_type: 'pay',
      transaction_time: new Date('2025-01-05T14:52:20+03:00'),
      md_error_message: null,
      md_status: null,
      transaction_security: null,
    },
  },
  fail_foreign_currency: {
    order: { currency: CURRENCY.USD, amount: 1.01, installment: 0 },
    txType: TX_TYPE.PAY_AUTH,
    paymentData: {
      TURKPOS_RETVAL_Islem_ID: 'C38F20632F9FBBC3FD2A3B35',
      TURKPOS_RETVAL_Sonuc: '-1',
      TURKPOS_RETVAL_Sonuc_Str: '3D Dogrulama basarisiz',
      TURKPOS_RETVAL_GUID: '0c13d406-873b-403b-9c09-a5766840d98c',
      TURKPOS_RETVAL_Islem_Tarih: '20.01.2025 18:03:23',
      TURKPOS_RETVAL_Dekont_ID: '0',
      TURKPOS_RETVAL_Tahsilat_Tutari: '10,01',
      TURKPOS_RETVAL_Odeme_Tutari: '9,83',
      TURKPOS_RETVAL_Siparis_ID: '20250120B068',
      TURKPOS_RETVAL_Ext_Data: '||||',
      TURKPOS_RETVAL_Banka_Sonuc_Kod: '-1',
      TURKPOS_RETVAL_PB: 'USD',
      TURKPOS_RETVAL_KK_No: '454671******7894',
      TURKPOS_RETVAL_Taksit: '0',
      TURKPOS_RETVAL_Hash: 'Df3gttv1swwT8N1m3aCVYzp23Rg=',
      TURKPOS_RETVAL_Islem_GUID: '9ccd323a-9a3e-4a7d-8367-58498fac8fb0',
      TURKPOS_RETVAL_SanalPOS_Islem_ID: '6021847392',
    },
    expectedData: declinedExpectation('3d_pay', '3D Dogrulama basarisiz'),
  },
  auth_fail: {
    order: ORDER_INSTALLMENT_0,
    txType: TX_TYPE.PAY_AUTH,
    paymentData: TURKPOS_AUTH_FAIL,
    expectedData: declinedExpectation('3d_pay', AUTH_FAIL_MESSAGE),
  },
}

const readStatusFile = (name: string): Data =>
  JSON.parse(readFileSync(new URL(`../../../test_data/parampos/${name}`, import.meta.url), 'utf8'))

const statusExpectation = (overrides: Data): Data => ({
  order_id: null,
  auth_code: null,
  proc_return_code: '1',
  transaction_id: null,
  error_message: null,
  ref_ret_num: null,
  order_status: null,
  transaction_type: 'pay',
  masked_number: '581877******2285',
  first_amount: 10.01,
  capture_amount: 10.01,
  currency: null,
  status: 'approved',
  error_code: null,
  capture: true,
  transaction_time: null,
  capture_time: null,
  cancel_time: null,
  refund_amount: null,
  refund_time: null,
  installment_count: null,
  ...overrides,
})

const at = (text: string): Date => new Date(text)

export const statusCases: Record<string, ResultCase> = {
  success_payment: {
    responseData: {
      TP_Islem_Sorgulama4Response: {
        TP_Islem_Sorgulama4Result: {
          DT_Bilgi: {
            Odeme_Sonuc: '1',
            Odeme_Sonuc_Aciklama: 'İşlem Başarılı',
            Dekont_ID: '3007296662',
            Siparis_ID: '20250105E324',
            Islem_ID: '665C5908BA1D7583BDF62D3A',
            Durum: 'SUCCESS',
            Tarih: '05.01.2025 13:14:32',
            Toplam_Tutar: '10.01',
            Komisyon_Oran: '1.75',
            Komisyon_Tutar: '0.18',
            Banka_Sonuc_Aciklama: '',
            Taksit: '1',
            Ext_Data: '||||',
            Toplam_Iade_Tutar: '0',
            KK_No: '581877******2285',
            Bank_Extra: BANK_EXTRA_STATUS,
            Islem_Tip: 'SALE',
            Bank_Trans_ID: '25005NOgE12061',
            Bank_AuthCode: '222905',
            Bank_HostRefNum: '500513472717',
          },
          Sonuc: '1',
          Sonuc_Str: 'Başarılı',
        },
      },
    },
    expectedData: statusExpectation({
      order_id: '20250105E324',
      auth_code: '222905',
      transaction_id: '25005NOgE12061',
      ref_ret_num: '500513472717',
      order_status: 'PAYMENT_COMPLETED',
      transaction_time: at('2025-01-05T13:14:32+03:00'),
      capture_time: at('2025-01-05T13:14:32+03:00'),
    }),
  },
  success_pay_then_refund: {
    responseData: readStatusFile('status_pay_then_refund_response.json'),
    expectedData: statusExpectation({
      order_id: '20250105E324',
      auth_code: '222905',
      transaction_id: '25005NOgE12061',
      ref_ret_num: '500513472717',
      order_status: 'FULLY_REFUNDED',
      transaction_time: at('2025-01-05T13:14:32+03:00'),
      capture_time: at('2025-01-05T13:14:32+03:00'),
    }),
  },
  success_pay_then_canceled: {
    responseData: readStatusFile('status_pay_then_cancel_response.json'),
    expectedData: statusExpectation({
      order_id: '2025011251F7',
      auth_code: '609945',
      transaction_id: '25012UZnE17558',
      ref_ret_num: '501220476656',
      order_status: 'CANCELED',
      transaction_time: at('2025-01-12T20:25:38+03:00'),
      capture_time: at('2025-01-12T20:25:38+03:00'),
      cancel_time: at('2025-01-12T20:25:38+03:00'),
    }),
  },
  success_pre_pay: {
    responseData: readStatusFile('status_pre_pay_response.json'),
    expectedData: statusExpectation({
      order_id: '20250105F546',
      auth_code: '308452',
      transaction_id: '25005QOSI13750',
      ref_ret_num: '500516472750',
      order_status: 'PRE_AUTH_COMPLETED',
      transaction_type: 'pre',
      capture_amount: null,
      capture: false,
      transaction_time: at('2025-01-05T16:14:18+03:00'),
    }),
  },
  success_post_pay: {
    responseData: readStatusFile('status_post_pay_response.json'),
    expectedData: statusExpectation({
      order_id: '20250105D70C',
      auth_code: '570335',
      transaction_id: '25005SMEB15694',
      ref_ret_num: '500518472771',
      order_status: 'PRE_AUTH_COMPLETED',
      transaction_type: 'pre',
      capture_amount: null,
      capture: false,
      transaction_time: at('2025-01-05T18:12:03+03:00'),
    }),
  },
  success_pre_pay_then_cancel: {
    responseData: readStatusFile('status_pre_pay_then_cancel_response.json'),
    expectedData: statusExpectation({
      order_id: '2025010540D6',
      auth_code: '105199',
      transaction_id: '25005SnhJ14709',
      ref_ret_num: '500518472763',
      order_status: 'CANCELED',
      transaction_type: 'pre',
      capture_amount: null,
      capture: false,
      transaction_time: at('2025-01-05T18:39:33+03:00'),
      cancel_time: at('2025-01-05T18:39:33+03:00'),
    }),
  },
}

const reversalExpectation = (overrides: Data): Data => ({
  order_id: null,
  group_id: null,
  auth_code: null,
  ref_ret_num: null,
  proc_return_code: '1',
  transaction_id: null,
  error_code: null,
  error_message: null,
  status: 'approved',
  ...overrides,
})

const reversalSuccess: Data = {
  TP_Islem_Iptal_Iade_Kismi2Response: {
    TP_Islem_Iptal_Iade_Kismi2Result: {
      Sonuc: '1',
      Sonuc_Str: 'Approved',
      Banka_Sonuc_Kod: '0',
      Bank_AuthCode: '142436',
      Bank_Trans_ID: '25005OB6H12275',
      Bank_Extra: BANK_EXTRA_CANCEL,
      Bank_HostRefNum: '500514472735',
    },
  },
}

const reversalFailure = (code: string, message: string): Data => ({
  TP_Islem_Iptal_Iade_Kismi2Response: {
    TP_Islem_Iptal_Iade_Kismi2Result: { Sonuc: code, Sonuc_Str: message },
  },
})

const reversalFailureExpectation = (code: string, message: string): Data =>
  reversalExpectation({
    proc_return_code: code,
    error_code: code,
    error_message: message,
    status: 'declined',
  })

const reversalSuccessExpectation = reversalExpectation({
  auth_code: '142436',
  ref_ret_num: '500514472735',
  transaction_id: '25005OB6H12275',
})

export const cancelCases: Record<string, ResultCase> = {
  success_payment: { responseData: reversalSuccess, expectedData: reversalSuccessExpectation },
  success_pre_pay: {
    responseData: {
      TP_Islem_Iptal_OnProvResponse: {
        TP_Islem_Iptal_OnProvResult: { Sonuc: '1', Sonuc_Str: 'Approved', Banka_Sonuc_Kod: '00' },
      },
    },
    expectedData: reversalExpectation({}),
  },
  fail_order_not_found_1: {
    responseData: reversalFailure('-210', 'İptal/İadeye uygun işlem bulunamadı.'),
    expectedData: reversalFailureExpectation('-210', 'İptal/İadeye uygun işlem bulunamadı.'),
  },
  fail_already_canceled: {
    responseData: reversalFailure('-211', 'İşlem iptal durumunda'),
    expectedData: reversalFailureExpectation('-211', 'İşlem iptal durumunda'),
  },
}

export const refundCases: Record<string, ResultCase> = {
  success_payment: { responseData: reversalSuccess, expectedData: reversalSuccessExpectation },
  fail_order_not_found_1: {
    responseData: reversalFailure('-210', 'İptal/İadeye uygun işlem bulunamadı.'),
    expectedData: reversalFailureExpectation('-210', 'İptal/İadeye uygun işlem bulunamadı.'),
  },
  fail_refund_twice: {
    responseData: reversalFailure('-221', 'İade tutarı, iade edilebilir tutardan büyük olamaz.'),
    expectedData: reversalFailureExpectation('-221', 'İade tutarı, iade edilebilir tutardan büyük olamaz.'),
  },
}
