import { describe, expect, it } from 'vitest'
import { AssecoPosHttpClient } from '../../../src/client/AssecoPosHttpClient.js'
import { HttpTransport } from '../../../src/client/HttpTransport.js'
import { PayFlexCPV4PosHttpClient } from '../../../src/client/PayFlexCPV4PosHttpClient.js'
import { PayFlexV4Pos3DFormHttpClient } from '../../../src/client/PayFlexV4Pos3DFormHttpClient.js'
import { PayFlexV4PosHttpClient } from '../../../src/client/PayFlexV4PosHttpClient.js'
import { PayFlexV4PosSearchApiHttpClient } from '../../../src/client/PayFlexV4PosSearchApiHttpClient.js'
import { posTestConfig } from '../../../src/config/posTestConfig.js'
import { GatewayClassNotConfiguredError, PosError } from '../../../src/errors.js'
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
