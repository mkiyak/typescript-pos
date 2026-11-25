import { freezeConfig, type ShippedPosConfig } from './freezeConfig.js'

/** Bank keys of `posProductionConfig`. */
export type PosProductionBank =
  | 'akbank'
  | 'akbank-pos'
  | 'albaraka'
  | 'finansbank'
  | 'denizbank'
  | 'garanti'
  | 'kuveytpos'
  | 'vakif-katilim'
  | 'tosla'
  | 'halkbank'
  | 'teb'
  | 'isbank'
  | 'sekerbank'
  | 'vakifbank'
  | 'vakifbank-cp'
  | 'ziraat-vpos'
  | 'ziraat-asseco'
  | 'yapikredi'
  | 'qnbfinansbank-payfor'
  | 'ziraat-katilim-payfor'

/**
 * Production endpoints for the AssecoPos, PayFlexV4Pos, PayFlexCPV4Pos, GarantiPos, AkbankPos, PosNetPos, PosNetV1Pos, PayForPos, InterPos, KuveytPos, VakifKatilimPos and ToslaPos banks (the VakifBank
 * API gateway on port 8443; `vakifbank-cp` is the Common Payment hosted page). Copy and adjust the entries you use; `require_3d_hash` is left at its default. The `akbank-pos` entry sets no `lang` or
 * `test_mode`: AkbankPos takes the language from `order.lang` and the environment from the endpoint URLs.
 *
 * Deeply frozen: spread an entry into a new object to change it
 * (`{ ...posProductionConfig.banks.vakifbank, require_3d_hash: true }`).
 */
export const posProductionConfig: ShippedPosConfig<PosProductionBank> = freezeConfig({
  banks: {
    'akbank-pos': {
      name: 'AKBANK T.A.S. Akbank Pos',
      class: 'AkbankPos',
      gateway_endpoints: {
        payment_api: 'https://api.akbank.com/api/v1/payment/virtualpos',
        gateway_3d: 'https://virtualpospaymentgateway.akbank.com/securepay',
        gateway_3d_host: 'https://virtualpospaymentgateway.akbank.com/payhosting',
      },
    },
    albaraka: {
      name: 'Albaraka',
      class: 'PosNetV1Pos',
      gateway_endpoints: {
        payment_api: 'https://epos.albarakaturk.com.tr/ALBMerchantService/MerchantJSONAPI.svc',
        gateway_3d: 'https://epos.albarakaturk.com.tr/ALBSecurePaymentUI/SecureProcess/SecureVerification.aspx',
      },
    },
    akbank: {
      name: 'AKBANK T.A.S. Asseco',
      class: 'AssecoPos',
      gateway_endpoints: {
        payment_api: 'https://www.sanalakpos.com/fim/api',
        gateway_3d: 'https://www.sanalakpos.com/fim/est3Dgate',
        gateway_3d_host: 'https://sanalpos.sanalakpos.com.tr/fim/est3Dgate',
      },
    },
    finansbank: {
      name: 'QNB Finansbank Asseco',
      class: 'AssecoPos',
      gateway_endpoints: {
        payment_api: 'https://www.fbwebpos.com/fim/api',
        gateway_3d: 'https://www.fbwebpos.com/fim/est3dgate',
      },
    },
    denizbank: {
      name: 'DenizBank-InterPos',
      class: 'InterPos',
      gateway_endpoints: {
        payment_api: 'https://inter-vpos.com.tr/mpi/Default.aspx',
        gateway_3d: 'https://inter-vpos.com.tr/mpi/Default.aspx',
        gateway_3d_host: 'https://inter-vpos.com.tr/mpi/3DHost.aspx',
      },
    },
    garanti: {
      name: 'Garanti BBVA',
      class: 'GarantiPos',
      gateway_endpoints: {
        payment_api: 'https://sanalposprov.garanti.com.tr/VPServlet',
        gateway_3d: 'https://sanalposprov.garanti.com.tr/servlet/gt3dengine',
      },
    },
    kuveytpos: {
      name: 'kuveyt-pos',
      class: 'KuveytPos',
      gateway_endpoints: {
        payment_api: 'https://sanalpos.kuveytturk.com.tr/ServiceGateWay/Home',
        query_api:
          'https://boa.kuveytturk.com.tr/BOA.Integration.WCFService/BOA.Integration.VirtualPos/VirtualPosService.svc/Basic',
      },
    },
    tosla: {
      name: 'Tosla',
      class: 'ToslaPos',
      gateway_endpoints: {
        payment_api: 'https://entegrasyon.tosla.com/api/Payment',
        gateway_3d: 'https://entegrasyon.tosla.com/api/Payment/ProcessCardForm',
        gateway_3d_host: 'https://entegrasyon.tosla.com/api/Payment/threeDSecure',
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
    halkbank: {
      name: 'Halkbank Asseco',
      class: 'AssecoPos',
      gateway_endpoints: {
        payment_api: 'https://sanalpos.halkbank.com.tr/fim/api',
        gateway_3d: 'https://sanalpos.halkbank.com.tr/fim/est3dgate',
      },
    },
    teb: {
      name: 'TEB Asseco',
      class: 'AssecoPos',
      gateway_endpoints: {
        payment_api: 'https://sanalpos.teb.com.tr/fim/api',
        gateway_3d: 'https://sanalpos.teb.com.tr/fim/est3Dgate',
      },
    },
    isbank: {
      name: 'İşbank T.A.S. Asseco',
      class: 'AssecoPos',
      gateway_endpoints: {
        payment_api: 'https://sanalpos.isbank.com.tr/fim/api',
        gateway_3d: 'https://sanalpos.isbank.com.tr/fim/est3Dgate',
      },
    },
    sekerbank: {
      name: 'Şeker Bank Asseco',
      class: 'AssecoPos',
      gateway_endpoints: {
        payment_api: 'https://sanalpos.sekerbank.com.tr/fim/api',
        gateway_3d: 'https://sanalpos.sekerbank.com.tr/fim/est3Dgate',
      },
    },
    vakifbank: {
      name: 'VakifBank-VPOS',
      class: 'PayFlexV4Pos',
      gateway_endpoints: {
        payment_api: 'https://apigw.vakifbank.com.tr:8443/virtualPos/Vposreq',
        gateway_3d: 'https://inbound.apigateway.vakifbank.com.tr:8443/threeDGateway/Enrollment',
        query_api: 'https://apigw.vakifbank.com.tr:8443/virtualPos/Search',
      },
    },
    'vakifbank-cp': {
      name: 'VakifBank-PayFlex-Common-Payment',
      class: 'PayFlexCPV4Pos',
      gateway_endpoints: {
        payment_api: 'https://inbound.apigateway.vakifbank.com.tr:8443/commonPayment',
      },
    },
    'ziraat-vpos': {
      name: 'Ziraat Bankası PayFlex',
      class: 'PayFlexV4Pos',
      gateway_endpoints: {
        payment_api: 'https://sanalpos.ziraatbank.com.tr/v4/v3/Vposreq.aspx',
        gateway_3d: 'https://mpi.ziraatbank.com.tr/Enrollment.aspx',
        query_api: 'https://sanalpos.ziraatbank.com.tr/v4/UIWebService/Search.aspx',
      },
    },
    'qnbfinansbank-payfor': {
      name: 'QNBFinansbank-PayFor',
      class: 'PayForPos',
      gateway_endpoints: {
        payment_api: 'https://vpos.qnb.com.tr/Gateway/XMLGate.aspx',
        gateway_3d: 'https://vpos.qnb.com.tr/Gateway/Default.aspx',
        gateway_3d_host: 'https://vpos.qnb.com.tr/Gateway/3DHost.aspx',
      },
    },
    'ziraat-katilim-payfor': {
      name: 'ZiraatKatilim-PayFor',
      class: 'PayForPos',
      lang: 'tr',
      gateway_endpoints: {
        payment_api: 'https://vpos.ziraatkatilim.com.tr/Mpi/XMLGate.aspx',
        gateway_3d: 'https://vpos.ziraatkatilim.com.tr/Mpi/Default.aspx',
        gateway_3d_host: 'https://vpos.ziraatkatilim.com.tr/Mpi/3Dhost.aspx',
      },
    },
    yapikredi: {
      name: 'Yapıkredi',
      class: 'PosNetPos',
      gateway_endpoints: {
        payment_api: 'https://posnet.yapikredi.com.tr/PosnetWebService/XML',
        gateway_3d: 'https://posnet.yapikredi.com.tr/3DSWebService/YKBPaymentService',
      },
    },
    'ziraat-asseco': {
      name: 'Ziraat Bankası Asseco',
      class: 'AssecoPos',
      gateway_endpoints: {
        payment_api: 'https://sanalpos2.ziraatbank.com.tr/fim/api',
        gateway_3d: 'https://sanalpos2.ziraatbank.com.tr/fim/est3Dgate',
      },
    },
  },
})
