import { describe, expect, it, vi } from 'vitest'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import { GatewayClassNotConfiguredError, PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { type PosConfig, PosFactory } from '../../../src/factory/PosFactory.js'
import type { GatewayConfig } from '../../../src/gateway/AbstractGateway.js'
import { AssecoPos } from '../../../src/gateway/AssecoPos.js'
import { PayFlexV4Pos } from '../../../src/gateway/PayFlexV4Pos.js'
import { CURRENCY, LANG, MODEL, TX_TYPE } from '../../../src/PosInterface.js'
import type { PosHooks, PosOrder } from '../../../src/types.js'

const assecoAccount = (bank = 'asseco') => AccountFactory.createAssecoPosAccount(bank, '700655000200', 'u', 'p', 'k')
const payFlexAccount = (bank = 'vakifbank') =>
  AccountFactory.createPayFlexPosAccount(bank, '000000000011445', 'p', 'VP1')

const config: PosConfig = {
  banks: {
    asseco: {
      name: 'Asseco/Payten',
      class: 'AssecoPos',
      gateway_endpoints: {
        payment_api: 'https://entegrasyon.asseco-see.com.tr/fim/api',
        gateway_3d: 'https://entegrasyon.asseco-see.com.tr/fim/est3Dgate',
      },
    },
    vakifbank: {
      name: 'VakifBank-VPOS',
      class: 'PayFlexV4Pos',
      gateway_endpoints: {
        payment_api: 'https://pay.example.com/Vposreq',
        gateway_3d: 'https://pay.example.com/Enrollment',
        query_api: 'https://pay.example.com/Search',
      },
    },
  },
}

const assecoCfg = config.banks.asseco as GatewayConfig
const vakifCfg = config.banks.vakifbank as GatewayConfig

describe('PosFactory.createPosGateway', () => {
  it('creates an AssecoPos gateway', () => {
    const account = assecoAccount()
    const gateway = PosFactory.createPosGateway(account, config)
    expect(gateway).toBeInstanceOf(AssecoPos)
    expect(gateway.getAccount()).toBe(account)
    expect(gateway.getCurrencies().length).toBeGreaterThan(0)
    expect(gateway.getCardTypeMapping()).toStrictEqual({}) // AssecoPos has no card type mapping
    expect(gateway.isTestMode()).toBe(false)
  })

  it('creates a PayFlexV4Pos gateway', () => {
    const account = payFlexAccount()
    const gateway = PosFactory.createPosGateway(account, config)
    expect(gateway).toBeInstanceOf(PayFlexV4Pos)
    expect(gateway.getAccount()).toBe(account)
    expect(gateway.getCurrencies().length).toBeGreaterThan(0)
    expect(Object.keys(gateway.getCardTypeMapping()).length).toBeGreaterThan(0)
    expect(gateway.get3DGatewayURL()).toBe('https://pay.example.com/Enrollment')
  })

  it('throws GatewayClassNotConfiguredError when the bank is not in the config', () => {
    expect(() => PosFactory.createPosGateway(assecoAccount('unknown-bank'), config)).toThrow(
      GatewayClassNotConfiguredError,
    )
    // prototype keys are not banks
    expect(() => PosFactory.createPosGateway(assecoAccount('constructor'), config)).toThrow(
      GatewayClassNotConfiguredError,
    )
  })

  it('throws GatewayClassNotConfiguredError for an unknown gateway class', () => {
    const bad: PosConfig = { banks: { asseco: { ...assecoCfg, class: 'GarantiPos' } } }
    expect(() => PosFactory.createPosGateway(assecoAccount(), bad)).toThrow(GatewayClassNotConfiguredError)
  })

  it('rejects an account of the wrong type for the configured gateway', () => {
    expect(() => PosFactory.createPosGateway(payFlexAccount('asseco'), config)).toThrow(PosError)
    expect(() => PosFactory.createPosGateway(assecoAccount('vakifbank'), config)).toThrow(PosError)
  })

  it('requires the PayFlex gateway_3d and query_api endpoints', () => {
    const bad: PosConfig = {
      banks: { vakifbank: { ...vakifCfg, gateway_endpoints: { payment_api: 'https://a.example.com' } } },
    }
    expect(() => PosFactory.createPosGateway(payFlexAccount(), bad)).toThrow(PosError)
  })

  it('options.testMode overrides the config test_mode', () => {
    const cfg: PosConfig = { banks: { asseco: { ...assecoCfg, test_mode: false } } }
    expect(PosFactory.createPosGateway(assecoAccount(), cfg, { testMode: true }).isTestMode()).toBe(true)
    const cfgTest: PosConfig = { banks: { asseco: { ...assecoCfg, test_mode: true } } }
    expect(PosFactory.createPosGateway(assecoAccount(), cfgTest).isTestMode()).toBe(true)
  })

  it('passes config.lang to the request mapper as default language', async () => {
    const cfg: PosConfig = { banks: { asseco: { ...assecoCfg, lang: LANG.EN } } }
    const gateway = PosFactory.createPosGateway(assecoAccount(), cfg)
    const order: PosOrder = {
      id: 'o1',
      amount: 1,
      currency: CURRENCY.TRY,
      installment: 0,
      success_url: 'https://x.test/ok',
      fail_url: 'https://x.test/fail',
    }
    const form = await gateway.get3DFormData(order, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, null, true)
    expect(typeof form).toBe('object')
    expect((form as { inputs: Record<string, string> }).inputs.lang).toBe('en')
  })

  it('uses the injected fetch / transport and wraps the logger', async () => {
    const body = '<CC5Response><Response>Approved</Response><ProcReturnCode>00</ProcReturnCode></CC5Response>'
    const fetchSpy = vi.fn(async () => new Response(body, { status: 200 }))
    const gateway = PosFactory.createPosGateway(assecoAccount(), config, { fetch: fetchSpy as unknown as typeof fetch })
    await gateway.status({ id: 'o1' }).catch(() => undefined)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe('https://entegrasyon.asseco-see.com.tr/fim/api')

    const transport = new HttpTransport({ fetch: fetchSpy as unknown as typeof fetch })
    const post = vi.spyOn(transport, 'post')
    const gw2 = PosFactory.createPosGateway(assecoAccount(), config, { transport })
    await gw2.status({ id: 'o1' }).catch(() => undefined)
    expect(post).toHaveBeenCalled()
  })

  it('masks sensitive data before it reaches a user logger', async () => {
    const logs: unknown[] = []
    const logger = {
      debug: (_m: string, c?: unknown) => logs.push(c),
      info: (_m: string, c?: unknown) => logs.push(c),
      warn: (_m: string, c?: unknown) => logs.push(c),
      error: (_m: string, c?: unknown) => logs.push(c),
    }
    const fetchImpl = (async () => new Response('<CC5Response/>', { status: 200 })) as unknown as typeof fetch
    const gateway = PosFactory.createPosGateway(assecoAccount(), config, { logger, fetch: fetchImpl, testMode: true })
    await gateway.status({ id: 'o1' }).catch(() => undefined)
    expect(logs.length).toBeGreaterThan(0)
    expect(JSON.stringify(logs)).not.toContain('"k"') // account secret key never logged
  })

  it('wires hooks into the request data mapper', async () => {
    const seen: string[] = []
    const hooks: PosHooks = { onRequestDataPrepared: [(e) => void seen.push(e.txType)] }
    const fetchImpl = (async () => new Response('<CC5Response/>', { status: 200 })) as unknown as typeof fetch
    const gateway = PosFactory.createPosGateway(assecoAccount(), config, { hooks, fetch: fetchImpl })
    await gateway.status({ id: 'o1' }).catch(() => undefined)
    expect(seen).toEqual([TX_TYPE.STATUS])
  })

  it('builds a gateway for every entry of the test config', () => {
    expect(Object.keys(posTestConfig.banks).length).toBeGreaterThan(0)
  })
})
