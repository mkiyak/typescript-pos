import { describe, expect, it, vi } from 'vitest'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import { GatewayClassNotConfiguredError, PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosConfig } from '../../../src/factory/PosFactory.js'
import { PosQueryFactory } from '../../../src/factory/PosQueryFactory.js'
import type { GatewayConfig } from '../../../src/gateway/AbstractGateway.js'
import { AbstractPosQuery } from '../../../src/pos-query/AbstractPosQuery.js'
import { AssecoPosQuery } from '../../../src/pos-query/AssecoPosQuery.js'
import { PayFlexCPV4PosQuery } from '../../../src/pos-query/PayFlexCPV4PosQuery.js'
import { PayFlexV4PosQuery } from '../../../src/pos-query/PayFlexV4PosQuery.js'

const assecoConfig: PosConfig = {
  banks: {
    akbank: {
      name: 'Akbank',
      class: 'AssecoPos',
      gateway_endpoints: {
        payment_api: 'https://entegrasyon.asseco-see.com.tr/fim/api',
        gateway_3d: 'https://entegrasyon.asseco-see.com.tr/fim/est3Dgate',
      },
    },
  },
}
const assecoAccount = (bank = 'akbank') => AccountFactory.createAssecoPosAccount(bank, '700655000200', 'u', 'p', 'k')
const cpAccount = () => AccountFactory.createPayFlexPosAccount('vakifbank-cp', '000000000111111', 'pw', 'VP1')

describe('PosQueryFactory', () => {
  it('testCreateReturnsCorrectPosQueryInstance', () => {
    const q = PosQueryFactory.createPosQuery(assecoAccount(), assecoConfig)
    expect(q).toBeInstanceOf(AssecoPosQuery)
    expect(q).toBeInstanceOf(AbstractPosQuery)
  })

  it('testCreateThrowsWhenGatewayClassMissingFromConfig', () => {
    const bank = { ...(assecoConfig.banks.akbank as GatewayConfig), class: undefined } as unknown as GatewayConfig
    expect(() => PosQueryFactory.createPosQuery(assecoAccount(), { banks: { akbank: bank } })).toThrow(
      GatewayClassNotConfiguredError,
    )
  })

  it('testCreateThrowsWhenNoPosQueryClassForGateway', () => {
    // deviation: Q7 no plain errors; PosFactory uses the same error for an unknown class
    const config: PosConfig = {
      banks: { akbank: { name: 'X', class: 'stdClass', gateway_endpoints: { payment_api: 'https://example.com' } } },
    }
    expect(() => PosQueryFactory.createPosQuery(assecoAccount(), config)).toThrow(GatewayClassNotConfiguredError)
  })

  // addition: behaviour the factory shares with PosFactory
  it('throws when the bank is not in the config', () => {
    expect(() => PosQueryFactory.createPosQuery(assecoAccount('nobank'), assecoConfig)).toThrow(
      GatewayClassNotConfiguredError,
    )
  })

  it('creates PayFlexV4PosQuery and PayFlexCPV4PosQuery from the shipped test config', () => {
    const v4 = AccountFactory.createPayFlexPosAccount('vakifbank', 'm', 'p', 't')
    expect(PosQueryFactory.createPosQuery(v4, posTestConfig)).toBeInstanceOf(PayFlexV4PosQuery)
    expect(PosQueryFactory.createPosQuery(cpAccount(), posTestConfig)).toBeInstanceOf(PayFlexCPV4PosQuery)
  })

  it('getPosQueryClassForGateway returns the registered class or null', () => {
    expect(PosQueryFactory.getPosQueryClassForGateway('AssecoPos')).toBe(AssecoPosQuery)
    expect(PosQueryFactory.getPosQueryClassForGateway('PayFlexV4Pos')).toBe(PayFlexV4PosQuery)
    expect(PosQueryFactory.getPosQueryClassForGateway('PayFlexCPV4Pos')).toBe(PayFlexCPV4PosQuery)
    expect(PosQueryFactory.getPosQueryClassForGateway('stdClass')).toBeNull()
  })

  it('rejects an account of the wrong type', () => {
    expect(() => PosQueryFactory.createPosQuery(assecoAccount('vakifbank'), posTestConfig)).toThrow(PosError)
    expect(() => PosQueryFactory.createPosQuery(cpAccount(), assecoConfigFor('AssecoPos'))).toThrow(PosError)
  })

  it('rejects an http: endpoint', () => {
    const config: PosConfig = {
      banks: {
        akbank: {
          ...(assecoConfig.banks.akbank as GatewayConfig),
          gateway_endpoints: { payment_api: 'http://entegrasyon.asseco-see.com.tr/fim/api' },
        },
      },
    }
    expect(() => PosQueryFactory.createPosQuery(assecoAccount(), config)).toThrow(PosError)
  })

  it('applies options.testMode', () => {
    expect(PosQueryFactory.createPosQuery(assecoAccount(), assecoConfig, { testMode: true }).isTestMode()).toBe(true)
  })

  it('passes fetch, hooks and allowedApiOrigins through to the query', async () => {
    const fake = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => new Response('{"ResultCode":"0000"}'),
    )
    const hook = vi.fn()
    const q = PosQueryFactory.createPosQuery(cpAccount(), posTestConfig, {
      fetch: fake as unknown as typeof fetch,
      hooks: { onPosQueryRequestDataPrepared: [hook] },
      allowedApiOrigins: ['https://apipos.vakifbank.com.tr:8443'],
    })

    await q.customQuery({ TransactionId: 'abc' }, 'https://apipos.vakifbank.com.tr:8443/x')
    expect(String(fake.mock.calls[0]?.[0])).toBe('https://apipos.vakifbank.com.tr:8443/x')
    expect(hook).toHaveBeenCalledTimes(1)

    await expect(q.customQuery({}, 'https://evil.example/')).rejects.toBeInstanceOf(PosError)
    expect(fake).toHaveBeenCalledTimes(1)
  })
})

function assecoConfigFor(cls: string): PosConfig {
  return {
    banks: {
      'vakifbank-cp': {
        name: 'X',
        class: cls,
        gateway_endpoints: { payment_api: 'https://example.com/api' },
      },
    },
  }
}
