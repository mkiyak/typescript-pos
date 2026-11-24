import { describe, expect, it } from 'vitest'
import { AkbankPosHttpClient } from '../../../src/client/AkbankPosHttpClient.js'
import { AssecoPosHttpClient } from '../../../src/client/AssecoPosHttpClient.js'
import { GarantiPosHttpClient } from '../../../src/client/GarantiPosHttpClient.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PayFlexCPV4PosHttpClient } from '../../../src/client/PayFlexCPV4PosHttpClient.js'
import { PayFlexV4Pos3DFormHttpClient } from '../../../src/client/PayFlexV4Pos3DFormHttpClient.js'
import { PayFlexV4PosHttpClient } from '../../../src/client/PayFlexV4PosHttpClient.js'
import { PayFlexV4PosSearchApiHttpClient } from '../../../src/client/PayFlexV4PosSearchApiHttpClient.js'
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
})
