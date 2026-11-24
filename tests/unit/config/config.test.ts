import { describe, expect, it } from 'vitest'
import { posProductionConfig } from '../../../src/config/posProductionConfig.js'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { PosFactory } from '../../../src/factory/PosFactory.js'
import type { GatewayConfig } from '../../../src/gateway/AbstractGateway.js'
import { AkbankPos } from '../../../src/gateway/AkbankPos.js'
import { AssecoPos } from '../../../src/gateway/AssecoPos.js'
import { GarantiPos } from '../../../src/gateway/GarantiPos.js'
import { InterPos } from '../../../src/gateway/InterPos.js'
import { KuveytPos } from '../../../src/gateway/KuveytPos.js'
import { PayFlexCPV4Pos } from '../../../src/gateway/PayFlexCPV4Pos.js'
import { PayFlexV4Pos } from '../../../src/gateway/PayFlexV4Pos.js'
import { PayForPos } from '../../../src/gateway/PayForPos.js'
import { PosNetPos } from '../../../src/gateway/PosNetPos.js'
import { PosNetV1Pos } from '../../../src/gateway/PosNetV1Pos.js'

const accountFor = (gatewayClass: string, key: string) => {
  if (gatewayClass === 'AssecoPos') return AccountFactory.createAssecoPosAccount(key, 'c', 'u', 'p', 'k')
  if (gatewayClass === 'AkbankPos') return AccountFactory.createAkbankPosAccount(key, 'm', 't', 'k')
  if (gatewayClass === 'GarantiPos') return AccountFactory.createGarantiPosAccount(key, 'm', 'u', 'p', 't', 'k')
  if (gatewayClass === 'InterPos') return AccountFactory.createInterPosAccount(key, 's', 'u', 'p', 'k')
  if (gatewayClass === 'KuveytPos') return AccountFactory.createBoaPosAccount(key, 'm', 'u', 'c', 'k')
  if (gatewayClass === 'PayForPos') return AccountFactory.createPayForPosAccount(key, 'm', 'u', 'p', 'k')
  if (gatewayClass === 'PosNetPos' || gatewayClass === 'PosNetV1Pos')
    return AccountFactory.createPosNetPosAccount(key, 'm', 't', 'p', 'k')
  return AccountFactory.createPayFlexPosAccount(key, 'm', 'p', 't')
}

const configs = { production: posProductionConfig, test: posTestConfig }

describe.each(Object.entries(configs))('%s config', (_label, cfg) => {
  const entries = Object.entries(cfg.banks)

  it('contains only AssecoPos, PayFlexV4Pos, PayFlexCPV4Pos, GarantiPos, AkbankPos, PosNetPos, PosNetV1Pos, PayForPos, InterPos and KuveytPos banks', () => {
    expect(entries.length).toBeGreaterThan(0)
    for (const [, bank] of entries) {
      expect([
        'AssecoPos',
        'PayFlexV4Pos',
        'PayFlexCPV4Pos',
        'GarantiPos',
        'AkbankPos',
        'PosNetPos',
        'PosNetV1Pos',
        'PayForPos',
        'InterPos',
        'KuveytPos',
      ]).toContain(bank.class)
    }
  })

  it.each(entries)('%s builds a gateway with a matching account type', (key, bank) => {
    const account = accountFor(bank.class, key)
    const gateway = PosFactory.createPosGateway(account, cfg)
    const expected = {
      AssecoPos,
      PayFlexV4Pos,
      PayFlexCPV4Pos,
      GarantiPos,
      AkbankPos,
      PosNetPos,
      PosNetV1Pos,
      PayForPos,
      InterPos,
      KuveytPos,
    }[
      bank.class as
        | 'AssecoPos'
        | 'PayFlexV4Pos'
        | 'PayFlexCPV4Pos'
        | 'GarantiPos'
        | 'AkbankPos'
        | 'PosNetPos'
        | 'PosNetV1Pos'
        | 'PayForPos'
        | 'InterPos'
        | 'KuveytPos'
    ]
    expect(gateway).toBeInstanceOf(expected)
  })

  it('every URL is https and none uses port 4443', () => {
    for (const [, bank] of entries) {
      for (const url of Object.values(bank.gateway_endpoints)) {
        expect(url).toMatch(/^https:\/\//)
        expect(url).not.toContain(':4443')
      }
    }
  })

  it('keeps require_3d_hash at its default (unset / false)', () => {
    for (const [, bank] of entries) {
      expect(bank.require_3d_hash ?? false).toBe(false)
    }
  })

  it('is deeply frozen (mutation throws in strict mode and has no effect)', () => {
    const banks = cfg.banks as Record<string, GatewayConfig>
    const [key, bank] = entries[0] as [string, GatewayConfig]
    const url = bank.gateway_endpoints.payment_api
    expect(Object.isFrozen(cfg)).toBe(true)
    expect(() => {
      banks.evil = bank
    }).toThrow(TypeError)
    expect(() => {
      bank.gateway_endpoints.payment_api = 'https://evil.test'
    }).toThrow(TypeError)
    expect(() => {
      bank.require_3d_hash = true
    }).toThrow(TypeError)
    expect(() => {
      ;(cfg as { banks: unknown }).banks = {}
    }).toThrow(TypeError)
    expect(banks).not.toHaveProperty('evil')
    expect(banks[key]?.gateway_endpoints.payment_api).toBe(url)
    expect(banks[key]?.require_3d_hash).toBeUndefined()
  })

  it('a spread copy can still be changed and used', () => {
    const [key, bank] = entries[0] as [string, GatewayConfig]
    const copy = { ...bank, require_3d_hash: true }
    expect(copy.require_3d_hash).toBe(true)
    const account = accountFor(bank.class, key)
    expect(PosFactory.createPosGateway(account, { banks: { [key]: copy } })).toBeDefined()
  })

  it('every bank has a name', () => {
    for (const [, bank] of entries) {
      expect(bank.name).not.toBe('')
    }
  })
})

describe('typed bank keys', () => {
  it('reads shipped entries without non-null assertions', () => {
    const asseco: Readonly<GatewayConfig> = posTestConfig.banks.asseco
    const isbank: Readonly<GatewayConfig> = posProductionConfig.banks.isbank
    // accepted by PosFactory as a PosConfig
    const account = AccountFactory.createAssecoPosAccount('isbank', 'c', 'u', 'p', 'k')
    expect(PosFactory.createPosGateway(account, { banks: { isbank: asseco } })).toBeInstanceOf(AssecoPos)
    expect(PosFactory.createPosGateway(account, posProductionConfig)).toBeInstanceOf(AssecoPos)
    expect(isbank.class).toBe('AssecoPos')
  })

  it('documents that the ziraat-vpos test query_api is the production host', () => {
    expect(posTestConfig.banks['ziraat-vpos'].gateway_endpoints.query_api).toContain('sanalpos.ziraatbank.com.tr')
  })
})

describe('VakifBank endpoints', () => {
  it('production uses the 8443 API gateway', () => {
    expect(posProductionConfig.banks.vakifbank.gateway_endpoints).toStrictEqual({
      payment_api: 'https://apigw.vakifbank.com.tr:8443/virtualPos/Vposreq',
      gateway_3d: 'https://inbound.apigateway.vakifbank.com.tr:8443/threeDGateway/Enrollment',
      query_api: 'https://apigw.vakifbank.com.tr:8443/virtualPos/Search',
    })
  })

  it('test uses the 8443 test API gateway', () => {
    expect(posTestConfig.banks.vakifbank.gateway_endpoints).toStrictEqual({
      payment_api: 'https://inbound.apigatewaytest.vakifbank.com.tr:8443/virtualPos/Vposreq',
      gateway_3d: 'https://inbound.apigatewaytest.vakifbank.com.tr:8443/threeDGateway/Enrollment',
      query_api: 'https://inbound.apigatewaytest.vakifbank.com.tr:8443/virtualPos/Search',
    })
  })

  it('production vakifbank-cp is the common payment API', () => {
    expect(posProductionConfig.banks['vakifbank-cp']).toStrictEqual({
      name: 'VakifBank-PayFlex-Common-Payment',
      class: 'PayFlexCPV4Pos',
      gateway_endpoints: { payment_api: 'https://inbound.apigateway.vakifbank.com.tr:8443/commonPayment' },
    })
    expect(Object.isFrozen(posProductionConfig.banks['vakifbank-cp'])).toBe(true)
  })

  it('test vakifbank-cp is the common payment test API', () => {
    expect(posTestConfig.banks['vakifbank-cp']).toStrictEqual({
      name: 'VakifBank-PayFlex-Common-Payment',
      class: 'PayFlexCPV4Pos',
      gateway_endpoints: { payment_api: 'https://inbound.apigatewaytest.vakifbank.com.tr:8443/commonPayment' },
    })
    expect(Object.isFrozen(posTestConfig.banks['vakifbank-cp'])).toBe(true)
  })

  it('production has the Asseco banks', () => {
    for (const key of ['akbank', 'finansbank', 'halkbank', 'teb', 'isbank', 'sekerbank', 'ziraat-asseco'] as const) {
      expect(posProductionConfig.banks[key].class).toBe('AssecoPos')
    }
    expect(posProductionConfig.banks['ziraat-vpos'].class).toBe('PayFlexV4Pos')
  })
})

// addition: shipped PosNet / PosNetV1 entries
describe('PosNet endpoints', () => {
  const expected = (host: string, albarakaHost: string) => ({
    yapikredi: {
      name: 'Yapıkredi',
      class: 'PosNetPos',
      gateway_endpoints: {
        payment_api: `https://${host}/PosnetWebService/XML`,
        gateway_3d: `https://${host}/3DSWebService/YKBPaymentService`,
      },
    },
    albaraka: {
      name: 'Albaraka',
      class: 'PosNetV1Pos',
      gateway_endpoints: {
        payment_api: `https://${albarakaHost}/ALBMerchantService/MerchantJSONAPI.svc`,
        gateway_3d: `https://${albarakaHost}/ALBSecurePaymentUI/SecureProcess/SecureVerification.aspx`,
      },
    },
  })

  it('production uses the live hosts', () => {
    const want = expected('posnet.yapikredi.com.tr', 'epos.albarakaturk.com.tr')
    expect(posProductionConfig.banks.yapikredi).toStrictEqual(want.yapikredi)
    expect(posProductionConfig.banks.albaraka).toStrictEqual(want.albaraka)
  })

  it('test uses the test hosts', () => {
    const want = expected('setmpos.ykb.com', 'epostest.albarakaturk.com.tr')
    expect(posTestConfig.banks.yapikredi).toStrictEqual(want.yapikredi)
    expect(posTestConfig.banks.albaraka).toStrictEqual(want.albaraka)
  })

  it('both entries are deeply frozen', () => {
    for (const cfg of [posProductionConfig, posTestConfig]) {
      for (const key of ['yapikredi', 'albaraka'] as const) {
        expect(Object.isFrozen(cfg.banks[key])).toBe(true)
        expect(Object.isFrozen(cfg.banks[key].gateway_endpoints)).toBe(true)
      }
    }
  })
})

describe('Garanti endpoints', () => {
  it('production uses the live VPServlet and 3D engine', () => {
    expect(posProductionConfig.banks.garanti).toStrictEqual({
      name: 'Garanti BBVA',
      class: 'GarantiPos',
      gateway_endpoints: {
        payment_api: 'https://sanalposprov.garanti.com.tr/VPServlet',
        gateway_3d: 'https://sanalposprov.garanti.com.tr/servlet/gt3dengine',
      },
    })
  })

  it('test uses the test host and turns on test_mode', () => {
    expect(posTestConfig.banks.garanti).toStrictEqual({
      name: 'Garanti BBVA',
      class: 'GarantiPos',
      lang: 'tr',
      test_mode: true,
      gateway_endpoints: {
        payment_api: 'https://sanalposprovtest.garantibbva.com.tr/VPServlet',
        gateway_3d: 'https://sanalposprovtest.garantibbva.com.tr/servlet/gt3dengine',
      },
    })
  })
})

describe('Akbank POS endpoints', () => {
  it('production uses the live API and payment gateway hosts', () => {
    expect(posProductionConfig.banks['akbank-pos']).toStrictEqual({
      name: 'AKBANK T.A.S. Akbank Pos',
      class: 'AkbankPos',
      gateway_endpoints: {
        payment_api: 'https://api.akbank.com/api/v1/payment/virtualpos',
        gateway_3d: 'https://virtualpospaymentgateway.akbank.com/securepay',
        gateway_3d_host: 'https://virtualpospaymentgateway.akbank.com/payhosting',
      },
    })
    expect(Object.isFrozen(posProductionConfig.banks['akbank-pos'])).toBe(true)
  })

  it('test uses the pre-production hosts', () => {
    expect(posTestConfig.banks['akbank-pos']).toStrictEqual({
      name: 'AKBANK T.A.S. Akbank Pos',
      class: 'AkbankPos',
      gateway_endpoints: {
        payment_api: 'https://apipre.akbank.com/api/v1/payment/virtualpos',
        gateway_3d: 'https://virtualpospaymentgatewaypre.akbank.com/securepay',
        gateway_3d_host: 'https://virtualpospaymentgatewaypre.akbank.com/payhosting',
      },
    })
    expect(Object.isFrozen(posTestConfig.banks['akbank-pos'].gateway_endpoints)).toBe(true)
  })
})

// addition: shipped PayFor entries (no hash-check switch exists in this library)
describe('PayFor endpoints', () => {
  const entry = (name: string, base: string, files: [string, string, string], lang?: string) => ({
    name,
    class: 'PayForPos',
    ...(lang ? { lang } : {}),
    gateway_endpoints: {
      payment_api: `${base}/${files[0]}`,
      gateway_3d: `${base}/${files[1]}`,
      gateway_3d_host: `${base}/${files[2]}`,
    },
  })

  it('production uses the live hosts', () => {
    expect(posProductionConfig.banks['qnbfinansbank-payfor']).toStrictEqual(
      entry('QNBFinansbank-PayFor', 'https://vpos.qnb.com.tr/Gateway', ['XMLGate.aspx', 'Default.aspx', '3DHost.aspx']),
    )
    expect(posProductionConfig.banks['ziraat-katilim-payfor']).toStrictEqual(
      entry(
        'ZiraatKatilim-PayFor',
        'https://vpos.ziraatkatilim.com.tr/Mpi',
        ['XMLGate.aspx', 'Default.aspx', '3Dhost.aspx'],
        'tr',
      ),
    )
  })

  it('test uses the test hosts', () => {
    expect(posTestConfig.banks['qnbfinansbank-payfor']).toStrictEqual(
      entry('QNBFinansbank-PayFor', 'https://vpostest.qnb.com.tr/Gateway', [
        'XMLGate.aspx',
        'Default.aspx',
        '3DHost.aspx',
      ]),
    )
    expect(posTestConfig.banks['ziraat-katilim-payfor']).toStrictEqual(
      entry(
        'ZiraatKatilim-PayFor',
        'https://payfortestziraatkatilim.cordisnetwork.com/Mpi',
        ['XMLGate.aspx', 'Default.aspx', '3DHost.aspx'],
        'tr',
      ),
    )
  })

  it('both entries are deeply frozen and carry no hash-check switch', () => {
    for (const cfg of [posProductionConfig, posTestConfig]) {
      for (const key of ['qnbfinansbank-payfor', 'ziraat-katilim-payfor'] as const) {
        expect(Object.isFrozen(cfg.banks[key])).toBe(true)
        expect(Object.isFrozen(cfg.banks[key].gateway_endpoints)).toBe(true)
        expect(cfg.banks[key]).not.toHaveProperty('disable_3d_hash_check')
      }
    }
  })
})

// addition: shipped InterPos entry (no hash-check switch, no language or test-mode override)
describe('InterPos endpoints', () => {
  const entry = (base: string) => ({
    name: 'DenizBank-InterPos',
    class: 'InterPos',
    gateway_endpoints: {
      payment_api: `${base}/mpi/Default.aspx`,
      gateway_3d: `${base}/mpi/Default.aspx`,
      gateway_3d_host: `${base}/mpi/3DHost.aspx`,
    },
  })

  it('production uses the live host', () => {
    expect(posProductionConfig.banks.denizbank).toStrictEqual(entry('https://inter-vpos.com.tr'))
  })

  it('test uses the test host', () => {
    expect(posTestConfig.banks.denizbank).toStrictEqual(entry('https://test.inter-vpos.com.tr'))
  })

  it('both entries are deeply frozen and carry no lang, test_mode or hash-check switch', () => {
    for (const cfg of [posProductionConfig, posTestConfig]) {
      expect(Object.isFrozen(cfg.banks.denizbank)).toBe(true)
      expect(Object.isFrozen(cfg.banks.denizbank.gateway_endpoints)).toBe(true)
      for (const key of ['lang', 'test_mode', 'disable_3d_hash_check']) {
        expect(cfg.banks.denizbank).not.toHaveProperty(key)
      }
    }
  })
})

// addition: K12 shipped KuveytPos entries (the test entry keeps the bank's language; no test_mode, gateway_3d or
// hash-check switch)
describe('KuveytPos endpoints', () => {
  it('production uses the live hosts', () => {
    expect(posProductionConfig.banks.kuveytpos).toStrictEqual({
      name: 'kuveyt-pos',
      class: 'KuveytPos',
      gateway_endpoints: {
        payment_api: 'https://sanalpos.kuveytturk.com.tr/ServiceGateWay/Home',
        query_api:
          'https://boa.kuveytturk.com.tr/BOA.Integration.WCFService/BOA.Integration.VirtualPos/VirtualPosService.svc/Basic',
      },
    })
  })

  it('test uses the test hosts and Turkish', () => {
    expect(posTestConfig.banks.kuveytpos).toStrictEqual({
      name: 'kuveyt-pos',
      class: 'KuveytPos',
      gateway_endpoints: {
        payment_api: 'https://boatest.kuveytturk.com.tr/boa.virtualpos.services/Home',
        query_api:
          'https://boatest.kuveytturk.com.tr/BOA.Integration.WCFService/BOA.Integration.VirtualPos/VirtualPosService.svc/Basic',
      },
      lang: 'tr',
    })
  })

  it('both entries are deeply frozen and carry no test_mode, gateway_3d or hash-check switch', () => {
    for (const cfg of [posProductionConfig, posTestConfig]) {
      expect(Object.isFrozen(cfg.banks.kuveytpos)).toBe(true)
      expect(Object.isFrozen(cfg.banks.kuveytpos.gateway_endpoints)).toBe(true)
      expect(cfg.banks.kuveytpos).not.toHaveProperty('test_mode')
      expect(cfg.banks.kuveytpos).not.toHaveProperty('disable_3d_hash_check')
      expect(cfg.banks.kuveytpos).not.toHaveProperty('require_3d_hash')
      expect(cfg.banks.kuveytpos.gateway_endpoints).not.toHaveProperty('gateway_3d')
    }
  })
})
