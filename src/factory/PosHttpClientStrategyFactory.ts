import { AssecoPosHttpClient } from '../client/AssecoPosHttpClient.js'
import { GarantiPosHttpClient } from '../client/GarantiPosHttpClient.js'
import { HttpClientStrategy } from '../client/HttpClientStrategy.js'
import type { HttpTransport } from '../client/HttpTransport.js'
import { PayFlexCPV4PosHttpClient } from '../client/PayFlexCPV4PosHttpClient.js'
import { PayFlexV4Pos3DFormHttpClient } from '../client/PayFlexV4Pos3DFormHttpClient.js'
import { PayFlexV4PosHttpClient } from '../client/PayFlexV4PosHttpClient.js'
import { PayFlexV4PosSearchApiHttpClient } from '../client/PayFlexV4PosSearchApiHttpClient.js'
import { GatewayClassNotConfiguredError, PosError } from '../errors.js'
import type { GatewayConfig } from '../gateway/AbstractGateway.js'
import type { PosLogger } from '../logger.js'

/** Card data, credentials and 3D forms must never travel over plain HTTP: every configured endpoint is `https:`. */
export function assertHttpsEndpoints(config: GatewayConfig): void {
  const endpoints: Record<string, unknown> = config.gateway_endpoints ?? {}
  for (const [key, url] of Object.entries(endpoints)) {
    if (url === undefined || url === null || url === '') {
      continue
    }
    let protocol: string | undefined
    try {
      protocol = typeof url === 'string' ? new URL(url).protocol : undefined
    } catch {
      protocol = undefined
    }
    if (protocol !== 'https:') {
      throw new PosError(`Endpoint [${key}] of ${config.name} (${config.class}) must be an https: URL.`)
    }
  }
}

export function requiredEndpoint(config: GatewayConfig, key: 'payment_api' | 'gateway_3d' | 'query_api'): string {
  const url = config.gateway_endpoints[key]
  if (typeof url !== 'string' || url === '') {
    throw new PosError(`Endpoint [${key}] is required for ${config.name} (${config.class}).`)
  }

  return url
}

/** Builds the HTTP clients of a gateway class. Shared by the payment and the query factory so both talk to a bank the same way. */
export const PosHttpClientStrategyFactory = {
  createForGateway(
    gatewayClass: string,
    config: GatewayConfig,
    transport: HttpTransport,
    logger: PosLogger,
  ): HttpClientStrategy {
    switch (gatewayClass) {
      case 'AssecoPos':
        return new HttpClientStrategy([
          new AssecoPosHttpClient(requiredEndpoint(config, 'payment_api'), transport, logger),
        ])
      case 'PayFlexV4Pos':
        return new HttpClientStrategy([
          new PayFlexV4PosHttpClient(requiredEndpoint(config, 'payment_api'), transport, logger),
          new PayFlexV4Pos3DFormHttpClient(requiredEndpoint(config, 'gateway_3d'), transport, logger),
          new PayFlexV4PosSearchApiHttpClient(requiredEndpoint(config, 'query_api'), transport, logger),
        ])
      case 'PayFlexCPV4Pos':
        return new HttpClientStrategy([
          new PayFlexCPV4PosHttpClient(requiredEndpoint(config, 'payment_api'), transport, logger),
        ])
      case 'GarantiPos':
        return new HttpClientStrategy([
          new GarantiPosHttpClient(requiredEndpoint(config, 'payment_api'), transport, logger),
        ])
      default:
        throw new GatewayClassNotConfiguredError(`No HTTP clients for gateway class [${gatewayClass}].`)
    }
  },
}
