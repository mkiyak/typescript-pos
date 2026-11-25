import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { PosFactory } from '../../../src/factory/PosFactory.js'
import { PosQueryFactory } from '../../../src/factory/PosQueryFactory.js'
import type { AbstractPosAccount } from '../../../src/model/account/AbstractPosAccount.js'

// addition: L4 — every object the factories build (gateway, its client strategy and clients, its crypt and mappers,
// and the query object) keeps the account's credentials out of JSON.stringify and util.inspect.

interface Case {
  gatewayClass: string
  account: AbstractPosAccount
  /** Every credential handed to the account: none of them may appear in a dump. */
  secrets: string[]
}

function caseOf(gatewayClass: string, build: (secret: (name: string) => string) => AbstractPosAccount): Case {
  const secrets: string[] = []
  const secret = (name: string): string => {
    const value = `S3cr3t-${gatewayClass}-${name}`
    secrets.push(value)
    return value
  }
  return { gatewayClass, account: build(secret), secrets }
}

const CASES: Case[] = [
  caseOf('AssecoPos', (s) => AccountFactory.createAssecoPosAccount('asseco', '700', 'ISBANKAPI', s('pw'), s('key'))),
  caseOf('PayFlexV4Pos', (s) =>
    AccountFactory.createPayFlexPosAccount('vakifbank', '000100000013506', s('pw'), 'VP000579'),
  ),
  caseOf('PayFlexCPV4Pos', (s) =>
    AccountFactory.createPayFlexPosAccount('vakifbank-cp', '000000000111111', s('pw'), 'VP999999'),
  ),
  caseOf('GarantiPos', (s) =>
    AccountFactory.createGarantiPosAccount(
      'garanti',
      '7000679',
      'PROVAUT',
      s('pw'),
      '30691298',
      s('key'),
      'PROVRFN',
      s('refund-pw'),
    ),
  ),
  caseOf('AkbankPos', (s) => AccountFactory.createAkbankPosAccount('akbank-pos', 'm-safe', 't-safe', s('key'))),
  caseOf('PosNetPos', (s) =>
    AccountFactory.createPosNetPosAccount('yapikredi', '6706598320', '67005551', '27426', s('key')),
  ),
  caseOf('PosNetV1Pos', (s) =>
    AccountFactory.createPosNetPosAccount('albaraka', '6700950031', '67540050', '1010028724242434', s('key')),
  ),
  caseOf('PayForPos', (s) =>
    AccountFactory.createPayForPosAccount('qnbfinansbank-payfor', '085300000009704', 'QNB_API', s('pw'), s('key')),
  ),
  caseOf('InterPos', (s) =>
    AccountFactory.createInterPosAccount('denizbank', 'InterTestApi', '3123', s('pw'), s('key')),
  ),
  caseOf('KuveytPos', (s) => AccountFactory.createBoaPosAccount('kuveytpos', '496', 'apitest', '400235', s('key'))),
  caseOf('VakifKatilimPos', (s) =>
    AccountFactory.createBoaPosAccount('vakif-katilim', '1', 'APIUSER', '11111', s('key')),
  ),
  caseOf('ToslaPos', (s) => AccountFactory.createToslaPosAccount('tosla', '1000000494', 'POS_ENT_Test_001', s('pass'))),
  caseOf('ParamPos', (s) => AccountFactory.createParamPosAccount('param-pos', '10738', 'Test1', s('pw'), s('guid'))),
  caseOf('Param3DHostPos', (s) =>
    AccountFactory.createParamPosAccount('param-3d-host-pos', '10738', 'Test1', s('pw'), s('guid'), '99001'),
  ),
  caseOf('PayTrPos', (s) => AccountFactory.createPayTrPosAccount('paytr', '123456', s('salt'), s('key'))),
  caseOf('IyzicoPos', (s) => AccountFactory.createIyzicoPosAccount('iyzico', 'sandbox-apiKey', s('key'))),
]

function dumpsOf(value: unknown): string[] {
  return [
    JSON.stringify(value) ?? '',
    inspect(value, { depth: 10, showHidden: false }),
    inspect(value, { depth: 10, showHidden: true }),
  ]
}

describe('no credential in a factory-built object', () => {
  it('covers every gateway class the factory builds', () => {
    expect(new Set(CASES.map((c) => c.gatewayClass)).size).toBe(16)
    for (const c of CASES) {
      expect(PosFactory.createPosGateway(c.account, posTestConfig).constructor.name).toBe(c.gatewayClass)
    }
  })

  it.each(CASES.map((c) => [c.gatewayClass, c] as const))('%s gateway', (_name, c) => {
    const gateway = PosFactory.createPosGateway(c.account, posTestConfig)
    for (const dump of dumpsOf(gateway)) {
      for (const secret of c.secrets) expect(dump).not.toContain(secret)
    }
    // the dump does reach the gateway's parts (the account's bank name is printed), so the check is not vacuous
    expect(inspect(gateway, { depth: 10 })).toContain('HttpClientStrategy')
  })

  it.each(
    CASES.filter((c) => PosQueryFactory.getPosQueryClassForGateway(c.gatewayClass) !== null).map(
      (c) => [c.gatewayClass, c] as const,
    ),
  )('%s query', (_name, c) => {
    const query = PosQueryFactory.createPosQuery(c.account, posTestConfig)
    for (const dump of dumpsOf(query)) {
      for (const secret of c.secrets) expect(dump).not.toContain(secret)
    }
  })

  it('has a query object for the 14 gateways that have one', () => {
    expect(CASES.filter((c) => PosQueryFactory.getPosQueryClassForGateway(c.gatewayClass) !== null)).toHaveLength(14)
  })
})
