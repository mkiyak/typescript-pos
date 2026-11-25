import { freezeConfig, type ShippedPosConfig } from './freezeConfig.js'

/** Bank keys of `posTestConfig`. */
export type PosTestBank =
  | 'akbank-pos'
  | 'albaraka'
  | 'asseco'
  | 'denizbank'
  | 'garanti'
  | 'kuveytpos'
  | 'vakif-katilim'
  | 'tosla'
  | 'vakifbank'
  | 'vakifbank-cp'
  | 'yapikredi'
  | 'qnbfinansbank-payfor'
  | 'ziraat-katilim-payfor'
  | 'ziraat-vpos'

/**
 * Test endpoints for the AssecoPos, PayFlexV4Pos, PayFlexCPV4Pos, GarantiPos, AkbankPos, PosNetPos, PosNetV1Pos, PayForPos, InterPos, KuveytPos, VakifKatilimPos and ToslaPos banks (the VakifBank test API
 * gateway on port 8443; `vakifbank-cp` is the Common Payment hosted page). `test_mode` only changes request data for gateways that support it (not AkbankPos: its entry sets neither `test_mode` nor `lang`, the language comes from `order.lang`); for the
 * Asseco and PayFlex gateways the environment is selected by the endpoint URLs. The `garanti` entry sets `test_mode: true`
 * because the Garanti test environment needs `Mode TEST` in every request.
 *
 * Deeply frozen: spread an entry into a new object to change it
 * (`{ ...posTestConfig.banks.vakifbank, require_3d_hash: true }`).
 */
export const posTestConfig: ShippedPosConfig<PosTestBank> = freezeConfig({
  banks: {
    'akbank-pos': {
      name: 'AKBANK T.A.S. Akbank Pos',
      class: 'AkbankPos',
      gateway_endpoints: {
        payment_api: 'https://apipre.akbank.com/api/v1/payment/virtualpos',
        gateway_3d: 'https://virtualpospaymentgatewaypre.akbank.com/securepay',
        gateway_3d_host: 'https://virtualpospaymentgatewaypre.akbank.com/payhosting',
      },
    },
    albaraka: {
      name: 'Albaraka',
      class: 'PosNetV1Pos',
      gateway_endpoints: {
        payment_api: 'https://epostest.albarakaturk.com.tr/ALBMerchantService/MerchantJSONAPI.svc',
        gateway_3d: 'https://epostest.albarakaturk.com.tr/ALBSecurePaymentUI/SecureProcess/SecureVerification.aspx',
      },
    },
    asseco: {
      name: 'Asseco/Payten',
      class: 'AssecoPos',
      gateway_endpoints: {
        payment_api: 'https://entegrasyon.asseco-see.com.tr/fim/api',
        gateway_3d: 'https://entegrasyon.asseco-see.com.tr/fim/est3Dgate',
      },
    },
    denizbank: {
      name: 'DenizBank-InterPos',
      class: 'InterPos',
      gateway_endpoints: {
        payment_api: 'https://test.inter-vpos.com.tr/mpi/Default.aspx',
        gateway_3d: 'https://test.inter-vpos.com.tr/mpi/Default.aspx',
        gateway_3d_host: 'https://test.inter-vpos.com.tr/mpi/3DHost.aspx',
      },
    },
    garanti: {
      name: 'Garanti BBVA',
      class: 'GarantiPos',
      lang: 'tr',
      test_mode: true,
      gateway_endpoints: {
        payment_api: 'https://sanalposprovtest.garantibbva.com.tr/VPServlet',
        gateway_3d: 'https://sanalposprovtest.garantibbva.com.tr/servlet/gt3dengine',
      },
    },
    kuveytpos: {
      name: 'kuveyt-pos',
      class: 'KuveytPos',
      gateway_endpoints: {
        payment_api: 'https://boatest.kuveytturk.com.tr/boa.virtualpos.services/Home',
        query_api:
          'https://boatest.kuveytturk.com.tr/BOA.Integration.WCFService/BOA.Integration.VirtualPos/VirtualPosService.svc/Basic',
      },
      lang: 'tr',
    },
    tosla: {
      name: 'Tosla',
      class: 'ToslaPos',
      gateway_endpoints: {
        payment_api: 'https://prepentegrasyon.tosla.com/api/Payment',
        gateway_3d: 'https://prepentegrasyon.tosla.com/api/Payment/ProcessCardForm',
        gateway_3d_host: 'https://prepentegrasyon.tosla.com/api/Payment/threeDSecure',
      },
    },
    'vakif-katilim': {
      name: 'Vakıf Katılım',
      class: 'VakifKatilimPos',
      gateway_endpoints: {
        payment_api: 'https://boa.vakifkatilim.com.tr/VirtualPOS.Gateway/Home',
        gateway_3d_host: 'https://boa.vakifkatilim.com.tr/VirtualPOS.Gateway/CommonPaymentPage/CommonPaymentPage',
      },
    },
    vakifbank: {
      name: 'VakifBank-VPOS',
      class: 'PayFlexV4Pos',
      gateway_endpoints: {
        payment_api: 'https://inbound.apigatewaytest.vakifbank.com.tr:8443/virtualPos/Vposreq',
        gateway_3d: 'https://inbound.apigatewaytest.vakifbank.com.tr:8443/threeDGateway/Enrollment',
        query_api: 'https://inbound.apigatewaytest.vakifbank.com.tr:8443/virtualPos/Search',
      },
    },
    'vakifbank-cp': {
      name: 'VakifBank-PayFlex-Common-Payment',
      class: 'PayFlexCPV4Pos',
      gateway_endpoints: {
        payment_api: 'https://inbound.apigatewaytest.vakifbank.com.tr:8443/commonPayment',
      },
    },
    'qnbfinansbank-payfor': {
      name: 'QNBFinansbank-PayFor',
      class: 'PayForPos',
      gateway_endpoints: {
        payment_api: 'https://vpostest.qnb.com.tr/Gateway/XMLGate.aspx',
        gateway_3d: 'https://vpostest.qnb.com.tr/Gateway/Default.aspx',
        gateway_3d_host: 'https://vpostest.qnb.com.tr/Gateway/3DHost.aspx',
      },
    },
    'ziraat-katilim-payfor': {
      name: 'ZiraatKatilim-PayFor',
      class: 'PayForPos',
      lang: 'tr',
      gateway_endpoints: {
        payment_api: 'https://payfortestziraatkatilim.cordisnetwork.com/Mpi/XMLGate.aspx',
        gateway_3d: 'https://payfortestziraatkatilim.cordisnetwork.com/Mpi/Default.aspx',
        gateway_3d_host: 'https://payfortestziraatkatilim.cordisnetwork.com/Mpi/3DHost.aspx',
      },
    },
    yapikredi: {
      name: 'Yapıkredi',
      class: 'PosNetPos',
      gateway_endpoints: {
        payment_api: 'https://setmpos.ykb.com/PosnetWebService/XML',
        gateway_3d: 'https://setmpos.ykb.com/3DSWebService/YKBPaymentService',
      },
    },
    'ziraat-vpos': {
      name: 'Ziraat Bankası',
      class: 'PayFlexV4Pos',
      gateway_endpoints: {
        payment_api: 'https://preprod.payflex.com.tr/Ziraatbank/VposWeb/v3/Vposreq.aspx',
        gateway_3d: 'https://preprod.payflex.com.tr/ZiraatBank/MpiWeb/MPI_Enrollment.aspx',
        // Note: this test entry's query_api points at the Ziraat PRODUCTION host. Status queries
        // made with test credentials go to production; override it if your bank gives you a test Search URL.
        query_api: 'https://sanalpos.ziraatbank.com.tr/v4/UIWebService/Search.aspx',
      },
    },
  },
})
