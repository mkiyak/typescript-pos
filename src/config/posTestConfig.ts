import { freezeConfig, type ShippedPosConfig } from './freezeConfig.js'

/** Bank keys of `posTestConfig`. */
export type PosTestBank = 'akbank-pos' | 'asseco' | 'garanti' | 'vakifbank' | 'vakifbank-cp' | 'ziraat-vpos'

/**
 * Test endpoints for the AssecoPos, PayFlexV4Pos, PayFlexCPV4Pos, GarantiPos and AkbankPos banks (the VakifBank test API
 * gateway on port 8443; `vakifbank-cp` is the Common Payment hosted page). `test_mode` only changes request data for gateways that support it; for the
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
    asseco: {
      name: 'Asseco/Payten',
      class: 'AssecoPos',
      gateway_endpoints: {
        payment_api: 'https://entegrasyon.asseco-see.com.tr/fim/api',
        gateway_3d: 'https://entegrasyon.asseco-see.com.tr/fim/est3Dgate',
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
