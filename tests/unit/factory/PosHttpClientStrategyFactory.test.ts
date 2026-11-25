import { describe, expect, it } from 'vitest'
import { AkbankPosHttpClient } from '../../../src/client/AkbankPosHttpClient.js'
import { AssecoPosHttpClient } from '../../../src/client/AssecoPosHttpClient.js'
import { GarantiPosHttpClient } from '../../../src/client/GarantiPosHttpClient.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { InterPosHttpClient } from '../../../src/client/InterPosHttpClient.js'
import { KuveytPosHttpClient } from '../../../src/client/KuveytPosHttpClient.js'
import { KuveytPosSoapApiHttpClient } from '../../../src/client/KuveytPosSoapApiHttpClient.js'
import { ParamPosHttpClient } from '../../../src/client/ParamPosHttpClient.js'
import { PayFlexCPV4PosHttpClient } from '../../../src/client/PayFlexCPV4PosHttpClient.js'
import { PayFlexV4Pos3DFormHttpClient } from '../../../src/client/PayFlexV4Pos3DFormHttpClient.js'
import { PayFlexV4PosHttpClient } from '../../../src/client/PayFlexV4PosHttpClient.js'
import { PayFlexV4PosSearchApiHttpClient } from '../../../src/client/PayFlexV4PosSearchApiHttpClient.js'
import { PayForPos3DFormHttpClient } from '../../../src/client/PayForPos3DFormHttpClient.js'
import { PayForPosHttpClient } from '../../../src/client/PayForPosHttpClient.js'
import { PayTrPosHttpClient } from '../../../src/client/PayTrPosHttpClient.js'
import { PosNetPosHttpClient } from '../../../src/client/PosNetPosHttpClient.js'
import { PosNetV1PosHttpClient } from '../../../src/client/PosNetV1PosHttpClient.js'
import { ToslaPosHttpClient } from '../../../src/client/ToslaPosHttpClient.js'
import { VakifKatilimPosHttpClient } from '../../../src/client/VakifKatilimPosHttpClient.js'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import { AkbankPosCrypt } from '../../../src/crypt/AkbankPosCrypt.js'
import { AssecoPosCrypt } from '../../../src/crypt/AssecoPosCrypt.js'
import { GatewayClassNotConfiguredError, PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import {
  assertHttpsEndpoints,
  PosHttpClientStrategyFactory,
} from '../../../src/factory/PosHttpClientStrategyFactory.js'
import type { GatewayConfig } from '../../../src/gateway/AbstractGateway.js'
import { noopLogger } from '../../../src/logger.js'

const transport = new HttpTransport()
const classesOf = (gatewayClass: string, config: GatewayConfig) =>
  PosHttpClientStrategyFactory.createForGateway(gatewayClass, config, transport, noopLogger)
    .getAllClients()
    .map((c) => c.constructor)

const payForConfig: GatewayConfig = {
  name: 'QNBFinansbank-PayFor',
  class: 'PayForPos',
  gateway_endpoints: {
    payment_api: 'https://vpostest.qnb.com.tr/Gateway/XMLGate.aspx',
    gateway_3d: 'https://vpostest.qnb.com.tr/Gateway/Default.aspx',
    gateway_3d_host: 'https://vpostest.qnb.com.tr/Gateway/3DHost.aspx',
  },
}

const interConfig: GatewayConfig = {
  name: 'Denizbank-InterPos',
  class: 'InterPos',
  gateway_endpoints: {
    payment_api: 'https://test.inter-vpos.com.tr/mpi/Default.aspx',
    gateway_3d: 'https://test.inter-vpos.com.tr/mpi/3DHost.aspx',
  },
}

const akbankConfig: GatewayConfig = {
  name: 'AKBANK T.A.S. Akbank Pos',
  class: 'AkbankPos',
  gateway_endpoints: {
    payment_api: 'https://apipre.akbank.com/api/v1/payment/virtualpos',
    gateway_3d: 'https://virtualpospaymentgatewaypre.akbank.com/securepay',
    gateway_3d_host: 'https://virtualpospaymentgatewaypre.akbank.com/payhosting',
  },
}
const akbankAccount = AccountFactory.createAkbankPosAccount(
  'akbank-pos',
  '2023090417500272654BD9A49CF07574',
  '2023090417500284633D137A249DBBEB',
  '3230323330393034313735303032363031353172675f357637355f3273387373745f7233725f73323333383737335f323272383774767276327672323531355f',
)

const posNetConfig: GatewayConfig = {
  name: 'Yapıkredi',
  class: 'PosNetPos',
  gateway_endpoints: {
    payment_api: 'https://setmpos.ykb.com/PosnetWebService/XML',
    gateway_3d: 'https://setmpos.ykb.com/3DSWebService/YKBPaymentService',
  },
}

const paramConfig: GatewayConfig = {
  name: 'Param',
  class: 'ParamPos',
  gateway_endpoints: {
    payment_api: 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx',
  },
}

const paramHostConfig: GatewayConfig = {
  name: 'Param-3DHost',
  class: 'Param3DHostPos',
  gateway_endpoints: {
    payment_api: 'https://testposws.param.com.tr/to.ws/Service_Odeme.asmx',
    query_api: 'https://test-dmz.param.com.tr/turkpos.ws/service_turkpos_test.asmx',
  },
}

// addition: the client wiring moved out of PosFactory, so its order and errors are pinned here
describe('PosHttpClientStrategyFactory', () => {
  it('wires AssecoPos with its payment client', () => {
    expect(classesOf('AssecoPos', posTestConfig.banks.asseco)).toEqual([AssecoPosHttpClient])
  })

  it('wires PayFlexV4Pos with payment, 3D form and search clients in that order', () => {
    expect(classesOf('PayFlexV4Pos', posTestConfig.banks.vakifbank)).toEqual([
      PayFlexV4PosHttpClient,
      PayFlexV4Pos3DFormHttpClient,
      PayFlexV4PosSearchApiHttpClient,
    ])
  })

  it('wires PayFlexCPV4Pos with its payment client', () => {
    expect(classesOf('PayFlexCPV4Pos', posTestConfig.banks['vakifbank-cp'])).toEqual([PayFlexCPV4PosHttpClient])
  })

  it('wires GarantiPos with its payment client', () => {
    expect(classesOf('GarantiPos', posTestConfig.banks.garanti)).toEqual([GarantiPosHttpClient])
    expect(GarantiPosHttpClient.supports('GarantiPos', 'payment_api')).toBe(true)
    expect(GarantiPosHttpClient.supports('GarantiPos', 'query_api')).toBe(false)
  })

  it('wires PayForPos with its payment and 3D form clients', () => {
    expect(classesOf('PayForPos', payForConfig)).toEqual([PayForPosHttpClient, PayForPos3DFormHttpClient])
    expect(PayForPosHttpClient.supports('PayForPos', 'payment_api')).toBe(true)
  })

  // addition: each PayForPos endpoint is required, never a request to "undefined"
  it.each(['payment_api', 'gateway_3d'])('requires the %s endpoint of PayForPos', (key) => {
    const endpoints: Record<string, string> = { ...payForConfig.gateway_endpoints }
    delete endpoints[key]
    const config = { ...payForConfig, gateway_endpoints: endpoints as never }
    expect(() => classesOf('PayForPos', config)).toThrow(PosError)
    expect(() => classesOf('PayForPos', config)).toThrow(new RegExp(`Endpoint \\[${key}\\] is required for`))
  })

  // addition: the strategy routes the 3D form build and everything else to the matching client
  it('routes PayForPos transactions to the matching client', () => {
    const strategy = PosHttpClientStrategyFactory.createForGateway('PayForPos', payForConfig, transport, noopLogger)
    expect(strategy.getClient('3d_form_build', '3d')).toBeInstanceOf(PayForPos3DFormHttpClient)
    expect(strategy.getClient('status', 'regular')).toBeInstanceOf(PayForPosHttpClient)
  })

  it('wires InterPos with its payment client', () => {
    expect(classesOf('InterPos', interConfig)).toEqual([InterPosHttpClient])
    expect(InterPosHttpClient.supports('InterPos', 'payment_api')).toBe(true)
  })

  // addition: the payment endpoint is required, never a request to "undefined"
  it('requires the payment_api endpoint of InterPos', () => {
    const config = { ...interConfig, gateway_endpoints: { gateway_3d: 'https://x.example/3d' } as never }
    expect(() => classesOf('InterPos', config)).toThrow(PosError)
    expect(() => classesOf('InterPos', config)).toThrow(/Endpoint \[payment_api\] is required for/)
  })

  // addition: the strategy routes every InterPos transaction to the one client
  it('routes InterPos transactions to its client', () => {
    const strategy = PosHttpClientStrategyFactory.createForGateway('InterPos', interConfig, transport, noopLogger)
    expect(strategy.getClient('status', 'regular')).toBeInstanceOf(InterPosHttpClient)
    expect(strategy.getClient('pay', '3d')).toBeInstanceOf(InterPosHttpClient)
  })

  it('wires AkbankPos with its signing payment client', () => {
    const clients = PosHttpClientStrategyFactory.createForGateway('AkbankPos', akbankConfig, transport, noopLogger, {
      account: akbankAccount,
      crypt: new AkbankPosCrypt(),
    }).getAllClients()
    expect(clients).toHaveLength(1)
    expect(clients[0]).toBeInstanceOf(AkbankPosHttpClient)
    expect(AkbankPosHttpClient.supports('AkbankPos', 'payment_api')).toBe(true)
  })

  // addition: an AkbankPos client cannot be built without what it needs to sign requests
  it('rejects AkbankPos without its account and crypt', () => {
    const assecoAccount = AccountFactory.createAssecoPosAccount(
      'akbank',
      '700655000200',
      'ISBANKAPI',
      'ISBANK07',
      'TRPS0200',
    )
    const cases = [
      undefined,
      { account: assecoAccount, crypt: new AkbankPosCrypt() },
      { account: akbankAccount, crypt: new AssecoPosCrypt() },
    ]
    for (const signing of cases) {
      expect(() =>
        PosHttpClientStrategyFactory.createForGateway('AkbankPos', akbankConfig, transport, noopLogger, signing),
      ).toThrow(new PosError('AkbankPos needs its account and crypt to sign requests.'))
    }
  })

  // addition: a missing endpoint is a PosError, never a request to "undefined"
  it('requires the payment_api endpoint of AkbankPos', () => {
    expect(() =>
      PosHttpClientStrategyFactory.createForGateway(
        'AkbankPos',
        { ...akbankConfig, gateway_endpoints: {} as never },
        transport,
        noopLogger,
        { account: akbankAccount, crypt: new AkbankPosCrypt() },
      ),
    ).toThrow(/Endpoint \[payment_api\] is required for/)
  })

  // addition: gateways that do not sign ignore the signing argument
  it('ignores signing for other gateways', () => {
    const clients = PosHttpClientStrategyFactory.createForGateway(
      'GarantiPos',
      posTestConfig.banks.garanti,
      transport,
      noopLogger,
      { account: akbankAccount, crypt: new AkbankPosCrypt() },
    ).getAllClients()
    expect(clients.map((c) => c.constructor)).toEqual([GarantiPosHttpClient])
  })

  // addition: a missing endpoint is a PosError, never a request to "undefined"
  it('requires the payment_api endpoint of GarantiPos', () => {
    expect(() => classesOf('GarantiPos', { ...posTestConfig.banks.garanti, gateway_endpoints: {} as never })).toThrow(
      /Endpoint \[payment_api\] is required for/,
    )
  })

  it('requires the query_api endpoint of PayFlexV4Pos', () => {
    const { query_api: _omitted, ...endpoints } = posTestConfig.banks.vakifbank.gateway_endpoints
    expect(() => classesOf('PayFlexV4Pos', { ...posTestConfig.banks.vakifbank, gateway_endpoints: endpoints })).toThrow(
      /Endpoint \[query_api\] is required for/,
    )
  })

  it('wires PosNetPos with its payment client', () => {
    expect(classesOf('PosNetPos', posNetConfig)).toEqual([PosNetPosHttpClient])
    expect(PosNetPosHttpClient.supports('PosNetPos', 'payment_api')).toBe(true)
  })

  // addition: a missing endpoint is a PosError, never a request to "undefined"
  it('requires the payment_api endpoint of PosNetPos', () => {
    expect(() => classesOf('PosNetPos', { ...posNetConfig, gateway_endpoints: {} as never })).toThrow(PosError)
    expect(() => classesOf('PosNetPos', { ...posNetConfig, gateway_endpoints: {} as never })).toThrow(
      /Endpoint \[payment_api\] is required for/,
    )
  })

  it('wires PosNetV1Pos with its JSON payment client', () => {
    const paymentApi = 'https://epostest.albarakaturk.com.tr/ALBMerchantService/MerchantJSONAPI.svc'
    const cfg: GatewayConfig = {
      name: 'Albaraka',
      class: 'PosNetV1Pos',
      gateway_endpoints: {
        payment_api: paymentApi,
        gateway_3d: 'https://epostest.albarakaturk.com.tr/ALBSecurePaymentUI/SecureProcess/SecureVerification.aspx',
      },
    }
    const clients = PosHttpClientStrategyFactory.createForGateway(
      'PosNetV1Pos',
      cfg,
      transport,
      noopLogger,
    ).getAllClients()
    expect(clients).toHaveLength(1)
    expect(clients[0]).toBeInstanceOf(PosNetV1PosHttpClient)
    expect((clients[0] as PosNetV1PosHttpClient).getApiUrl('pay', '3d')).toBe(`${paymentApi}/Sale`)
    expect(PosNetV1PosHttpClient.supports('PosNetV1Pos', 'payment_api')).toBe(true)
  })

  // addition: K5/K6, the client wiring of KuveytPos: payment XML client first, SOAP query client second
  describe('KuveytPos', () => {
    const kuveytConfig: GatewayConfig = {
      name: 'KuveytTurk',
      class: 'KuveytPos',
      gateway_endpoints: {
        payment_api: 'https://boatest.kuveytturk.com.tr/boa.virtualpos.services/Home',
        gateway_3d: 'https://boatest.kuveytturk.com.tr/boa.virtualpos.services/Home/ThreeDModelPayGate',
        query_api:
          'https://boatest.kuveytturk.com.tr/BOA.Integration.WCFService/BOA.Integration.VirtualPos/VirtualPosService.svc/Basic',
      },
    }

    it('wires the payment and the SOAP query clients in that order', () => {
      expect(classesOf('KuveytPos', kuveytConfig)).toEqual([KuveytPosHttpClient, KuveytPosSoapApiHttpClient])
    })

    it.each(['payment_api', 'query_api'])('requires the %s endpoint', (key) => {
      const endpoints: Record<string, string> = { ...kuveytConfig.gateway_endpoints }
      delete endpoints[key]
      const config = { ...kuveytConfig, gateway_endpoints: endpoints as never }
      expect(() => classesOf('KuveytPos', config)).toThrow(PosError)
      expect(() => classesOf('KuveytPos', config)).toThrow(new RegExp(`Endpoint \\[${key}\\] is required for`))
    })

    it('routes each transaction to the matching client', () => {
      const strategy = PosHttpClientStrategyFactory.createForGateway('KuveytPos', kuveytConfig, transport, noopLogger)
      expect(strategy.getClient('status', 'regular')).toBeInstanceOf(KuveytPosSoapApiHttpClient)
      expect(strategy.getClient('cancel', 'regular')).toBeInstanceOf(KuveytPosSoapApiHttpClient)
      expect(strategy.getClient('pay', '3d')).toBeInstanceOf(KuveytPosHttpClient)
      expect(strategy.getClient('3d_form_build', '3d')).toBeInstanceOf(KuveytPosHttpClient)
    })
  })

  // addition: V6, VakifKatilimPos has one XML client for payments, queries and the 3D form
  describe('VakifKatilimPos', () => {
    const vakifConfig: GatewayConfig = {
      name: 'Vakıf Katılım',
      class: 'VakifKatilimPos',
      gateway_endpoints: {
        payment_api: 'https://boa.vakifkatilim.com.tr/VirtualPOS.Gateway/Home',
        gateway_3d_host: 'https://boa.vakifkatilim.com.tr/VirtualPOS.Gateway/CommonPaymentPage/CommonPaymentPage',
      },
    }

    it('holds one client', () => {
      expect(classesOf('VakifKatilimPos', vakifConfig)).toEqual([VakifKatilimPosHttpClient])
    })

    it('requires the payment_api endpoint', () => {
      const config = {
        ...vakifConfig,
        gateway_endpoints: { gateway_3d_host: vakifConfig.gateway_endpoints.gateway_3d_host } as never,
      }
      expect(() => classesOf('VakifKatilimPos', config)).toThrow(PosError)
      expect(() => classesOf('VakifKatilimPos', config)).toThrow(/Endpoint \[payment_api\] is required for/)
    })

    it('routes every transaction to that client', () => {
      const strategy = PosHttpClientStrategyFactory.createForGateway(
        'VakifKatilimPos',
        vakifConfig,
        transport,
        noopLogger,
      )
      for (const [txType, model] of [
        ['pay', '3d'],
        ['pay', 'regular'],
        ['status', 'regular'],
        ['cancel', 'regular'],
        ['3d_form_build', '3d'],
        ['history', 'regular'],
      ] as const) {
        expect(strategy.getClient(txType, model)).toBeInstanceOf(VakifKatilimPosHttpClient)
      }
    })
  })

  describe('PayTrPos', () => {
    const payTrConfig: GatewayConfig = {
      name: 'PayTR',
      class: 'PayTrPos',
      gateway_endpoints: { payment_api: 'https://www.paytr.com' },
    }

    // addition: one client serves every transaction and query
    it('holds one client', () => {
      expect(classesOf('PayTrPos', payTrConfig)).toEqual([PayTrPosHttpClient])
      const strategy = PosHttpClientStrategyFactory.createForGateway('PayTrPos', payTrConfig, transport, noopLogger)
      expect(strategy.getClient('3d_form_build', '3d_host')).toBeInstanceOf(PayTrPosHttpClient)
      expect(strategy.getClient('refund', 'regular')).toBeInstanceOf(PayTrPosHttpClient)
    })

    // addition: the client masks the account's key and salt, so the account reaches it from the signing data
    it('hands the account secrets to the client', async () => {
      const account = AccountFactory.createPayTrPosAccount('paytr', '123456', 'SALT-VALUE-12345', 'KEY-VALUE-123456')
      const lines: string[] = []
      const logger = {
        debug: (m: string, c?: unknown) => lines.push(m + JSON.stringify(c)),
        info: (m: string, c?: unknown) => lines.push(m + JSON.stringify(c)),
        warn: (m: string, c?: unknown) => lines.push(m + JSON.stringify(c)),
        error: (m: string, c?: unknown) => lines.push(m + JSON.stringify(c)),
      }
      const fake = (async () =>
        new Response('<html>SALT-VALUE-12345 KEY-VALUE-123456</html>')) as unknown as typeof fetch
      const strategy = PosHttpClientStrategyFactory.createForGateway(
        'PayTrPos',
        payTrConfig,
        new HttpTransport({ fetch: fake }),
        logger,
        { account, crypt: new AssecoPosCrypt() },
      )

      await expect(
        strategy.getClient('pay', 'regular').request('pay', 'regular', { a: 1 }, { id: 'o' } as never),
      ).rejects.toThrow()
      expect(lines.join('\n')).not.toMatch(/SALT-VALUE-12345|KEY-VALUE-123456/)
    })

    // addition: a missing endpoint is a PosError, never a request to "undefined"
    it('requires the payment_api endpoint', () => {
      expect(() => classesOf('PayTrPos', { ...payTrConfig, gateway_endpoints: {} as never })).toThrow(
        /Endpoint \[payment_api\] is required for/,
      )
    })
  })

  describe('ToslaPos', () => {
    const toslaConfig: GatewayConfig = {
      name: 'Tosla',
      class: 'ToslaPos',
      gateway_endpoints: { payment_api: 'https://ent.akodepos.com/api/Payment' },
    }

    // addition: one JSON client serves every transaction and query
    it('holds one client', () => {
      expect(classesOf('ToslaPos', toslaConfig)).toEqual([ToslaPosHttpClient])
      const strategy = PosHttpClientStrategyFactory.createForGateway('ToslaPos', toslaConfig, transport, noopLogger)
      expect(strategy.getClient('installment_prices', 'regular')).toBeInstanceOf(ToslaPosHttpClient)
      expect(strategy.getClient('pay', '3d_pay')).toBeInstanceOf(ToslaPosHttpClient)
    })

    // addition: a missing endpoint is a PosError, never a request to "undefined"
    it('requires the payment_api endpoint', () => {
      expect(() => classesOf('ToslaPos', { ...toslaConfig, gateway_endpoints: {} as never })).toThrow(
        /Endpoint \[payment_api\] is required for/,
      )
    })

    // addition: card data never travels over plain HTTP
    it('rejects an http: endpoint', () => {
      const config = { ...toslaConfig, gateway_endpoints: { payment_api: 'http://ent.akodepos.com/api/Payment' } }
      expect(() => assertHttpsEndpoints(config)).toThrow(/Endpoint \[payment_api\] of .* must be an https: URL\./)
    })
  })

  it('rejects an unknown gateway class', () => {
    expect(() => classesOf('stdClass', posTestConfig.banks.asseco)).toThrow(GatewayClassNotConfiguredError)
  })

  it('assertHttpsEndpoints rejects an http: endpoint with the endpoint name', () => {
    const config: GatewayConfig = {
      ...posTestConfig.banks.vakifbank,
      gateway_endpoints: { ...posTestConfig.banks.vakifbank.gateway_endpoints, gateway_3d: 'http://pay.example.com/x' },
    }
    expect(() => assertHttpsEndpoints(config)).toThrow(PosError)
    expect(() => assertHttpsEndpoints(config)).toThrow(/Endpoint \[gateway_3d\] of .* must be an https: URL\./)
  })

  // addition: ParamPos talks to one SOAP endpoint
  it('wires ParamPos with its payment client', () => {
    expect(classesOf('ParamPos', paramConfig)).toEqual([ParamPosHttpClient])
    const strategy = PosHttpClientStrategyFactory.createForGateway('ParamPos', paramConfig, transport, noopLogger)
    expect(strategy.getClient('pay', '3d')).toBeInstanceOf(ParamPosHttpClient)
    expect(strategy.getClient('cancel', 'regular')).toBeInstanceOf(ParamPosHttpClient)
  })

  // addition: Param3DHostPos reads status from the query endpoint and registers payments at the payment endpoint
  it('routes Param3DHostPos status to the query endpoint and everything else to the payment endpoint', () => {
    expect(classesOf('Param3DHostPos', paramHostConfig)).toEqual([ParamPosHttpClient, ParamPosHttpClient])
    const strategy = PosHttpClientStrategyFactory.createForGateway(
      'Param3DHostPos',
      paramHostConfig,
      transport,
      noopLogger,
    )
    const status = strategy.getClient('status', '3d_host') as ParamPosHttpClient
    const form = strategy.getClient('3d_form_build', '3d_host') as ParamPosHttpClient
    expect(status.getApiUrl('status', '3d_host')).toBe(paramHostConfig.gateway_endpoints.query_api)
    expect(form.getApiUrl('3d_form_build', '3d_host')).toBe(paramHostConfig.gateway_endpoints.payment_api)
    expect(status).not.toBe(form)
  })

  it.each([
    ['ParamPos', paramConfig, 'payment_api'],
    ['Param3DHostPos', paramHostConfig, 'payment_api'],
    ['Param3DHostPos', paramHostConfig, 'query_api'],
  ] as Array<[string, GatewayConfig, string]>)('requires the %s endpoint %s', (gatewayClass, config, key) => {
    const endpoints: Record<string, string> = { ...config.gateway_endpoints }
    delete endpoints[key]
    const broken = { ...config, gateway_endpoints: endpoints as never }
    expect(() => classesOf(gatewayClass, broken)).toThrow(PosError)
    expect(() => classesOf(gatewayClass, broken)).toThrow(new RegExp(`Endpoint \\[${key}\\] is required for`))
  })

  it('rejects an http: endpoint of the Param gateways', () => {
    const insecure = {
      ...paramHostConfig,
      gateway_endpoints: { ...paramHostConfig.gateway_endpoints, query_api: 'http://test-dmz.param.com.tr/x.asmx' },
    }
    expect(() => assertHttpsEndpoints(insecure)).toThrow(PosError)
  })
})
