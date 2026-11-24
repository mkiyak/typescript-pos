import { describe, expect, it } from 'vitest'
import { posProductionConfig } from '../../../src/config/posProductionConfig.js'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { PosFactory } from '../../../src/factory/PosFactory.js'
import type { GatewayConfig } from '../../../src/gateway/AbstractGateway.js'
import { AssecoPos } from '../../../src/gateway/AssecoPos.js'
import { PayFlexCPV4Pos } from '../../../src/gateway/PayFlexCPV4Pos.js'
import { PayFlexV4Pos } from '../../../src/gateway/PayFlexV4Pos.js'

const configs = { production: posProductionConfig, test: posTestConfig }

describe.each(Object.entries(configs))('%s config', (_label, cfg) => {
  const entries = Object.entries(cfg.banks)

  it('contains only AssecoPos, PayFlexV4Pos and PayFlexCPV4Pos banks', () => {
    expect(entries.length).toBeGreaterThan(0)
    for (const [, bank] of entries) {
      expect(['AssecoPos', 'PayFlexV4Pos', 'PayFlexCPV4Pos']).toContain(bank.class)
    }
  })

  it.each(entries)('%s builds a gateway with a matching account type', (key, bank) => {
    const account =
      bank.class === 'AssecoPos'
        ? AccountFactory.createAssecoPosAccount(key, 'c', 'u', 'p', 'k')
        : AccountFactory.createPayFlexPosAccount(key, 'm', 'p', 't')
    const gateway = PosFactory.createPosGateway(account, cfg)
    const expected = { AssecoPos, PayFlexV4Pos, PayFlexCPV4Pos }[
      bank.class as 'AssecoPos' | 'PayFlexV4Pos' | 'PayFlexCPV4Pos'
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
    const account =
      bank.class === 'AssecoPos'
        ? AccountFactory.createAssecoPosAccount(key, 'c', 'u', 'p', 'k')
        : AccountFactory.createPayFlexPosAccount(key, 'm', 'p', 't')
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
