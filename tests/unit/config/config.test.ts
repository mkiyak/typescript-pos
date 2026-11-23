import { describe, expect, it } from 'vitest'
import { posProductionConfig } from '../../../src/config/posProductionConfig.js'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { PosFactory } from '../../../src/factory/PosFactory.js'
import { AssecoPos } from '../../../src/gateway/AssecoPos.js'
import { PayFlexV4Pos } from '../../../src/gateway/PayFlexV4Pos.js'

const configs = { production: posProductionConfig, test: posTestConfig }

describe.each(Object.entries(configs))('%s config', (_label, cfg) => {
  const entries = Object.entries(cfg.banks)

  it('contains only AssecoPos and PayFlexV4Pos banks', () => {
    expect(entries.length).toBeGreaterThan(0)
    for (const [, bank] of entries) {
      expect(['AssecoPos', 'PayFlexV4Pos']).toContain(bank.class)
    }
  })

  it.each(entries)('%s builds a gateway with a matching account type', (key, bank) => {
    const account =
      bank.class === 'AssecoPos'
        ? AccountFactory.createAssecoPosAccount(key, 'c', 'u', 'p', 'k')
        : AccountFactory.createPayFlexPosAccount(key, 'm', 'p', 't')
    const gateway = PosFactory.createPosGateway(account, cfg)
    expect(gateway).toBeInstanceOf(bank.class === 'AssecoPos' ? AssecoPos : PayFlexV4Pos)
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

  it('every bank has a name', () => {
    for (const [, bank] of entries) {
      expect(bank.name).not.toBe('')
    }
  })
})

describe('VakifBank endpoints', () => {
  it('production uses the 8443 API gateway', () => {
    expect(posProductionConfig.banks.vakifbank?.gateway_endpoints).toStrictEqual({
      payment_api: 'https://apigw.vakifbank.com.tr:8443/virtualPos/Vposreq',
      gateway_3d: 'https://inbound.apigateway.vakifbank.com.tr:8443/threeDGateway/Enrollment',
      query_api: 'https://apigw.vakifbank.com.tr:8443/virtualPos/Search',
    })
  })

  it('test uses the 8443 test API gateway', () => {
    expect(posTestConfig.banks.vakifbank?.gateway_endpoints).toStrictEqual({
      payment_api: 'https://inbound.apigatewaytest.vakifbank.com.tr:8443/virtualPos/Vposreq',
      gateway_3d: 'https://inbound.apigatewaytest.vakifbank.com.tr:8443/threeDGateway/Enrollment',
      query_api: 'https://inbound.apigatewaytest.vakifbank.com.tr:8443/virtualPos/Search',
    })
  })

  it('production has the Asseco banks', () => {
    for (const key of ['akbank', 'finansbank', 'halkbank', 'teb', 'isbank', 'sekerbank', 'ziraat-asseco']) {
      expect(posProductionConfig.banks[key]?.class).toBe('AssecoPos')
    }
    expect(posProductionConfig.banks['ziraat-vpos']?.class).toBe('PayFlexV4Pos')
  })
})
