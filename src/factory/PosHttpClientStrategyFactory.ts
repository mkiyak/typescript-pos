import { AkbankPosHttpClient } from '../client/AkbankPosHttpClient.js'
import { AssecoPosHttpClient } from '../client/AssecoPosHttpClient.js'
import { GarantiPosHttpClient } from '../client/GarantiPosHttpClient.js'
import { HttpClientStrategy } from '../client/HttpClientStrategy.js'
import type { HttpTransport } from '../client/HttpTransport.js'
import { InterPosHttpClient } from '../client/InterPosHttpClient.js'
import { KuveytPosHttpClient } from '../client/KuveytPosHttpClient.js'
import { KuveytPosSoapApiHttpClient } from '../client/KuveytPosSoapApiHttpClient.js'
import { ParamPosHttpClient } from '../client/ParamPosHttpClient.js'
import { PayFlexCPV4PosHttpClient } from '../client/PayFlexCPV4PosHttpClient.js'
import { PayFlexV4Pos3DFormHttpClient } from '../client/PayFlexV4Pos3DFormHttpClient.js'
import { PayFlexV4PosHttpClient } from '../client/PayFlexV4PosHttpClient.js'
import { PayFlexV4PosSearchApiHttpClient } from '../client/PayFlexV4PosSearchApiHttpClient.js'
import { PayForPos3DFormHttpClient } from '../client/PayForPos3DFormHttpClient.js'
import { PayForPosHttpClient } from '../client/PayForPosHttpClient.js'
import { PayTrPosHttpClient } from '../client/PayTrPosHttpClient.js'
import { PosNetPosHttpClient } from '../client/PosNetPosHttpClient.js'
import { PosNetV1PosHttpClient } from '../client/PosNetV1PosHttpClient.js'
import { ToslaPosHttpClient } from '../client/ToslaPosHttpClient.js'
import { VakifKatilimPosHttpClient } from '../client/VakifKatilimPosHttpClient.js'
import { AkbankPosCrypt } from '../crypt/AkbankPosCrypt.js'
import type { CryptInterface } from '../crypt/CryptInterface.js'
import { KuveytPosRequestValueMapper } from '../data-mapper/request/value-mapper/KuveytPosRequestValueMapper.js'
import { PosNetV1PosRequestValueMapper } from '../data-mapper/request/value-mapper/PosNetV1PosRequestValueMapper.js'
import { GatewayClassNotConfiguredError, PosError } from '../errors.js'
import type { GatewayConfig } from '../gateway/AbstractGateway.js'
import type { PosLogger } from '../logger.js'
import type { AbstractPosAccount } from '../model/account/AbstractPosAccount.js'
import { AkbankPosAccount } from '../model/account/AkbankPosAccount.js'
import { PayTrPosAccount } from '../model/account/PayTrPosAccount.js'

/** What a client needs to sign its requests itself; gateways whose clients do not sign ignore it. */
export interface HttpClientSigning {
  account: AbstractPosAccount
  crypt: CryptInterface
}

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
    signing?: HttpClientSigning,
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
      case 'PayForPos':
        return new HttpClientStrategy([
          new PayForPosHttpClient(requiredEndpoint(config, 'payment_api'), transport, logger),
          new PayForPos3DFormHttpClient(requiredEndpoint(config, 'gateway_3d'), transport, logger),
        ])
      case 'PosNetPos':
        return new HttpClientStrategy([
          new PosNetPosHttpClient(requiredEndpoint(config, 'payment_api'), transport, logger),
        ])
      case 'PosNetV1Pos':
        // The URL of each transaction is named after it; the value mapper is a stateless table.
        return new HttpClientStrategy([
          new PosNetV1PosHttpClient(
            requiredEndpoint(config, 'payment_api'),
            transport,
            logger,
            new PosNetV1PosRequestValueMapper(),
          ),
        ])
      case 'InterPos':
        return new HttpClientStrategy([
          new InterPosHttpClient(requiredEndpoint(config, 'payment_api'), transport, logger),
        ])
      case 'KuveytPos':
        // Payments and the 3D form go to the XML gateway; status, cancel and refund to the SOAP service.
        return new HttpClientStrategy([
          new KuveytPosHttpClient(requiredEndpoint(config, 'payment_api'), transport, logger),
          new KuveytPosSoapApiHttpClient(
            requiredEndpoint(config, 'query_api'),
            transport,
            logger,
            new KuveytPosRequestValueMapper(),
          ),
        ])
      case 'VakifKatilimPos':
        // One XML gateway for payments, status, reversals, history and the 3D form.
        return new HttpClientStrategy([
          new VakifKatilimPosHttpClient(requiredEndpoint(config, 'payment_api'), transport, logger),
        ])
      case 'ToslaPos':
        return new HttpClientStrategy([
          new ToslaPosHttpClient(requiredEndpoint(config, 'payment_api'), transport, logger),
        ])
      case 'AkbankPos': {
        const account = signing?.account
        const crypt = signing?.crypt
        if (!(account instanceof AkbankPosAccount) || !(crypt instanceof AkbankPosCrypt)) {
          throw new PosError('AkbankPos needs its account and crypt to sign requests.')
        }
        return new HttpClientStrategy([
          new AkbankPosHttpClient(requiredEndpoint(config, 'payment_api'), transport, logger, crypt, account),
        ])
      }
      case 'ParamPos':
        return new HttpClientStrategy([
          new ParamPosHttpClient(requiredEndpoint(config, 'payment_api'), transport, logger),
        ])
      case 'Param3DHostPos':
        // Status goes to the TurkPos query endpoint; the hosted page's registration to the payment endpoint.
        return new HttpClientStrategy([
          new ParamPosHttpClient(requiredEndpoint(config, 'query_api'), transport, logger, ['status']),
          new ParamPosHttpClient(requiredEndpoint(config, 'payment_api'), transport, logger),
        ])
      case 'PayTrPos': {
        // The merchant key and salt are not sent in a body, but a bank text may echo them: the client masks them.
        const account = signing?.account
        const secrets = account instanceof PayTrPosAccount ? [account.getPassword(), account.getSecretKey()] : []
        return new HttpClientStrategy([
          new PayTrPosHttpClient(requiredEndpoint(config, 'payment_api'), transport, logger, secrets),
        ])
      }
      default:
        throw new GatewayClassNotConfiguredError(`No HTTP clients for gateway class [${gatewayClass}].`)
    }
  },
}
