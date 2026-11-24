import { HttpTransport } from '../client/HttpTransport.js'
import { AkbankPosCrypt } from '../crypt/AkbankPosCrypt.js'
import { AssecoPosCrypt } from '../crypt/AssecoPosCrypt.js'
import type { CryptInterface } from '../crypt/CryptInterface.js'
import { GarantiPosCrypt } from '../crypt/GarantiPosCrypt.js'
import { InterPosCrypt } from '../crypt/InterPosCrypt.js'
import { KuveytPosCrypt } from '../crypt/KuveytPosCrypt.js'
import { PayFlexCPV4PosCrypt } from '../crypt/PayFlexCPV4PosCrypt.js'
import { PayFlexV4PosCrypt } from '../crypt/PayFlexV4PosCrypt.js'
import { PayForPosCrypt } from '../crypt/PayForPosCrypt.js'
import { PosNetPosCrypt } from '../crypt/PosNetPosCrypt.js'
import { PosNetV1PosCrypt } from '../crypt/PosNetV1PosCrypt.js'
import { AkbankPosRequestValueFormatter } from '../data-mapper/request/value-formatter/AkbankPosRequestValueFormatter.js'
import { AssecoPosRequestValueFormatter } from '../data-mapper/request/value-formatter/AssecoPosRequestValueFormatter.js'
import { GarantiPosRequestValueFormatter } from '../data-mapper/request/value-formatter/GarantiPosRequestValueFormatter.js'
import { InterPosRequestValueFormatter } from '../data-mapper/request/value-formatter/InterPosRequestValueFormatter.js'
import { PayFlexCPV4PosRequestValueFormatter } from '../data-mapper/request/value-formatter/PayFlexCPV4PosRequestValueFormatter.js'
import { PayFlexV4PosRequestValueFormatter } from '../data-mapper/request/value-formatter/PayFlexV4PosRequestValueFormatter.js'
import { PayForPosRequestValueFormatter } from '../data-mapper/request/value-formatter/PayForPosRequestValueFormatter.js'
import { PosNetPosRequestValueFormatter } from '../data-mapper/request/value-formatter/PosNetPosRequestValueFormatter.js'
import { PosNetV1PosRequestValueFormatter } from '../data-mapper/request/value-formatter/PosNetV1PosRequestValueFormatter.js'
import type { RequestValueFormatterInterface } from '../data-mapper/request/value-formatter/RequestValueFormatterInterface.js'
import { VakifKatilimPosRequestValueFormatter } from '../data-mapper/request/value-formatter/VakifKatilimPosRequestValueFormatter.js'
import { AkbankPosRequestValueMapper } from '../data-mapper/request/value-mapper/AkbankPosRequestValueMapper.js'
import { AssecoPosRequestValueMapper } from '../data-mapper/request/value-mapper/AssecoPosRequestValueMapper.js'
import { GarantiPosRequestValueMapper } from '../data-mapper/request/value-mapper/GarantiPosRequestValueMapper.js'
import { InterPosRequestValueMapper } from '../data-mapper/request/value-mapper/InterPosRequestValueMapper.js'
import { PayFlexCPV4PosRequestValueMapper } from '../data-mapper/request/value-mapper/PayFlexCPV4PosRequestValueMapper.js'
import { PayFlexV4PosRequestValueMapper } from '../data-mapper/request/value-mapper/PayFlexV4PosRequestValueMapper.js'
import { PayForPosRequestValueMapper } from '../data-mapper/request/value-mapper/PayForPosRequestValueMapper.js'
import { PosNetPosRequestValueMapper } from '../data-mapper/request/value-mapper/PosNetPosRequestValueMapper.js'
import { PosNetV1PosRequestValueMapper } from '../data-mapper/request/value-mapper/PosNetV1PosRequestValueMapper.js'
import type { RequestValueMapperInterface } from '../data-mapper/request/value-mapper/RequestValueMapperInterface.js'
import { VakifKatilimPosRequestValueMapper } from '../data-mapper/request/value-mapper/VakifKatilimPosRequestValueMapper.js'
import { AssecoPosResponseValueFormatter } from '../data-mapper/response/value-formatter/AssecoPosResponseValueFormatter.js'
import { BasicResponseValueFormatter } from '../data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { BoaPosResponseValueFormatter } from '../data-mapper/response/value-formatter/BoaPosResponseValueFormatter.js'
import { GarantiPosResponseValueFormatter } from '../data-mapper/response/value-formatter/GarantiPosResponseValueFormatter.js'
import { InterPosResponseValueFormatter } from '../data-mapper/response/value-formatter/InterPosResponseValueFormatter.js'
import { PosNetPosResponseValueFormatter } from '../data-mapper/response/value-formatter/PosNetPosResponseValueFormatter.js'
import type { ResponseValueFormatterInterface } from '../data-mapper/response/value-formatter/ResponseValueFormatterInterface.js'
import { AkbankPosResponseValueMapper } from '../data-mapper/response/value-mapper/AkbankPosResponseValueMapper.js'
import { AssecoPosResponseValueMapper } from '../data-mapper/response/value-mapper/AssecoPosResponseValueMapper.js'
import { GarantiPosResponseValueMapper } from '../data-mapper/response/value-mapper/GarantiPosResponseValueMapper.js'
import { InterPosResponseValueMapper } from '../data-mapper/response/value-mapper/InterPosResponseValueMapper.js'
import { PayFlexCPV4PosResponseValueMapper } from '../data-mapper/response/value-mapper/PayFlexCPV4PosResponseValueMapper.js'
import { PayFlexV4PosResponseValueMapper } from '../data-mapper/response/value-mapper/PayFlexV4PosResponseValueMapper.js'
import { PayForPosResponseValueMapper } from '../data-mapper/response/value-mapper/PayForPosResponseValueMapper.js'
import { PosNetPosResponseValueMapper } from '../data-mapper/response/value-mapper/PosNetPosResponseValueMapper.js'
import { PosNetV1PosResponseValueMapper } from '../data-mapper/response/value-mapper/PosNetV1PosResponseValueMapper.js'
import type { ResponseValueMapperInterface } from '../data-mapper/response/value-mapper/ResponseValueMapperInterface.js'
import { VakifKatilimPosResponseValueMapper } from '../data-mapper/response/value-mapper/VakifKatilimPosResponseValueMapper.js'
import { GatewayClassNotConfiguredError, PosError } from '../errors.js'
import type { GatewayConfig } from '../gateway/AbstractGateway.js'
import { createSafeLogger, noopLogger } from '../logger.js'
import type { AbstractPosAccount } from '../model/account/AbstractPosAccount.js'
import { AkbankPosAccount } from '../model/account/AkbankPosAccount.js'
import { AssecoPosAccount } from '../model/account/AssecoPosAccount.js'
import { BoaPosAccount } from '../model/account/BoaPosAccount.js'
import { GarantiPosAccount } from '../model/account/GarantiPosAccount.js'
import { InterPosAccount } from '../model/account/InterPosAccount.js'
import { PayFlexPosAccount } from '../model/account/PayFlexPosAccount.js'
import { PayForPosAccount } from '../model/account/PayForPosAccount.js'
import { PosNetPosAccount } from '../model/account/PosNetPosAccount.js'
import { LANG } from '../PosInterface.js'
import type { AbstractPosQuery, PosQueryDeps } from '../pos-query/AbstractPosQuery.js'
import { AkbankPosQuery } from '../pos-query/AkbankPosQuery.js'
import { AssecoPosQuery } from '../pos-query/AssecoPosQuery.js'
import { GarantiPosQuery } from '../pos-query/GarantiPosQuery.js'
import { InterPosQuery } from '../pos-query/InterPosQuery.js'
import { PayFlexCPV4PosQuery } from '../pos-query/PayFlexCPV4PosQuery.js'
import { PayFlexV4PosQuery } from '../pos-query/PayFlexV4PosQuery.js'
import { PayForPosQuery } from '../pos-query/PayForPosQuery.js'
import { PosNetPosQuery } from '../pos-query/PosNetPosQuery.js'
import { PosNetV1PosQuery } from '../pos-query/PosNetV1PosQuery.js'
import { VakifKatilimPosQuery } from '../pos-query/VakifKatilimPosQuery.js'
import type { PosConfig, PosFactoryOptions } from './PosFactory.js'
import { assertHttpsEndpoints, PosHttpClientStrategyFactory } from './PosHttpClientStrategyFactory.js'
import { PosQueryRequestMapperFactory } from './PosQueryRequestMapperFactory.js'
import { PosQueryResponseMapperFactory } from './PosQueryResponseMapperFactory.js'

export type PosQueryFactoryOptions = PosFactoryOptions & {
  /** Extra `https:` origins `customQuery(…, apiUrl)` may target besides the configured endpoints. */
  allowedApiOrigins?: readonly string[]
}

const QUERY_CLASSES = [
  AkbankPosQuery,
  AssecoPosQuery,
  GarantiPosQuery,
  InterPosQuery,
  PayFlexCPV4PosQuery,
  PayFlexV4PosQuery,
  PayForPosQuery,
  PosNetPosQuery,
  PosNetV1PosQuery,
  VakifKatilimPosQuery,
]

/** Builds the query service of a bank: the same config, account and options as `PosFactory`, a different service. */
export const PosQueryFactory = {
  /** The query class registered for a gateway class, or null. */
  getPosQueryClassForGateway(gatewayClass: string): typeof AbstractPosQuery<never> | null {
    for (const queryClass of QUERY_CLASSES) {
      if (queryClass.supports(gatewayClass)) {
        return queryClass as unknown as typeof AbstractPosQuery<never>
      }
    }
    return null
  },

  /**
   * @throws GatewayClassNotConfiguredError when the bank is not configured or has no gateway class or no query class
   * @throws PosError when the account type does not fit the gateway, a required endpoint is missing or an endpoint
   *   (or an `allowedApiOrigins` entry) is not an `https:` URL
   */
  createPosQuery(
    account: AbstractPosAccount,
    config: PosConfig,
    options: PosQueryFactoryOptions = {},
  ): AbstractPosQuery {
    const bankName = account.getBankName()
    if (!Object.hasOwn(config.banks, bankName)) {
      throw new GatewayClassNotConfiguredError(`Bank [${bankName}] is not configured.`)
    }
    const bankConfig = config.banks[bankName] as GatewayConfig
    if (!bankConfig.class) {
      throw new GatewayClassNotConfiguredError(`Gateway class of bank [${bankName}] is not configured.`)
    }
    const gatewayConfig: GatewayConfig =
      options.testMode === undefined ? bankConfig : { ...bankConfig, test_mode: options.testMode }

    assertHttpsEndpoints(gatewayConfig)

    const gatewayClass = bankConfig.class
    const QueryClass = PosQueryFactory.getPosQueryClassForGateway(gatewayClass)
    if (QueryClass === null) {
      throw new GatewayClassNotConfiguredError(`PosQuery not found for gateway ${gatewayClass}`)
    }

    const logger = createSafeLogger(options.logger ?? noopLogger)
    const transport = options.transport ?? new HttpTransport({ fetch: options.fetch, timeoutMs: options.timeoutMs })

    let requestValueMapper: RequestValueMapperInterface
    let requestValueFormatter: RequestValueFormatterInterface
    let crypt: CryptInterface
    let responseValueFormatter: ResponseValueFormatterInterface
    let responseValueMapper: ResponseValueMapperInterface

    switch (gatewayClass) {
      case 'AkbankPos': {
        if (!(account instanceof AkbankPosAccount)) {
          throw new PosError(`Bank [${bankName}] is configured for AkbankPos and needs an AkbankPosAccount.`)
        }
        requestValueMapper = new AkbankPosRequestValueMapper()
        requestValueFormatter = new AkbankPosRequestValueFormatter()
        crypt = new AkbankPosCrypt(logger)
        responseValueFormatter = new BasicResponseValueFormatter()
        responseValueMapper = new AkbankPosResponseValueMapper()
        break
      }
      case 'AssecoPos': {
        if (!(account instanceof AssecoPosAccount)) {
          throw new PosError(`Bank [${bankName}] is configured for AssecoPos and needs an AssecoPosAccount.`)
        }
        ;({ requestValueMapper, requestValueFormatter, crypt } = buildAsseco(logger))
        responseValueFormatter = new AssecoPosResponseValueFormatter()
        responseValueMapper = new AssecoPosResponseValueMapper()
        break
      }
      case 'GarantiPos': {
        if (!(account instanceof GarantiPosAccount)) {
          throw new PosError(`Bank [${bankName}] is configured for GarantiPos and needs a GarantiPosAccount.`)
        }
        requestValueMapper = new GarantiPosRequestValueMapper()
        requestValueFormatter = new GarantiPosRequestValueFormatter()
        crypt = new GarantiPosCrypt(logger)
        responseValueFormatter = new GarantiPosResponseValueFormatter()
        responseValueMapper = new GarantiPosResponseValueMapper()
        break
      }
      case 'InterPos': {
        if (!(account instanceof InterPosAccount)) {
          throw new PosError(`Bank [${bankName}] is configured for InterPos and needs an InterPosAccount.`)
        }
        requestValueMapper = new InterPosRequestValueMapper()
        requestValueFormatter = new InterPosRequestValueFormatter()
        crypt = new InterPosCrypt(logger)
        responseValueFormatter = new InterPosResponseValueFormatter()
        responseValueMapper = new InterPosResponseValueMapper()
        break
      }
      case 'PayFlexV4Pos': {
        if (!(account instanceof PayFlexPosAccount)) {
          throw new PosError(`Bank [${bankName}] is configured for PayFlexV4Pos and needs a PayFlexPosAccount.`)
        }
        requestValueMapper = new PayFlexV4PosRequestValueMapper()
        requestValueFormatter = new PayFlexV4PosRequestValueFormatter()
        crypt = new PayFlexV4PosCrypt(logger)
        responseValueFormatter = new BasicResponseValueFormatter()
        responseValueMapper = new PayFlexV4PosResponseValueMapper()
        break
      }
      case 'PayFlexCPV4Pos': {
        if (!(account instanceof PayFlexPosAccount)) {
          throw new PosError(`Bank [${bankName}] is configured for PayFlexCPV4Pos and needs a PayFlexPosAccount.`)
        }
        requestValueMapper = new PayFlexCPV4PosRequestValueMapper()
        requestValueFormatter = new PayFlexCPV4PosRequestValueFormatter()
        crypt = new PayFlexCPV4PosCrypt(logger)
        responseValueFormatter = new BasicResponseValueFormatter()
        responseValueMapper = new PayFlexCPV4PosResponseValueMapper()
        break
      }
      case 'PayForPos': {
        if (!(account instanceof PayForPosAccount)) {
          throw new PosError(`Bank [${bankName}] is configured for PayForPos and needs a PayForPosAccount.`)
        }
        requestValueMapper = new PayForPosRequestValueMapper()
        requestValueFormatter = new PayForPosRequestValueFormatter()
        crypt = new PayForPosCrypt(logger)
        responseValueFormatter = new BasicResponseValueFormatter()
        responseValueMapper = new PayForPosResponseValueMapper()
        break
      }
      case 'PosNetPos': {
        if (!(account instanceof PosNetPosAccount)) {
          throw new PosError(`Bank [${bankName}] is configured for PosNetPos and needs a PosNetPosAccount.`)
        }
        requestValueMapper = new PosNetPosRequestValueMapper()
        requestValueFormatter = new PosNetPosRequestValueFormatter()
        crypt = new PosNetPosCrypt(logger)
        responseValueFormatter = new PosNetPosResponseValueFormatter()
        responseValueMapper = new PosNetPosResponseValueMapper()
        break
      }
      case 'PosNetV1Pos': {
        if (!(account instanceof PosNetPosAccount)) {
          throw new PosError(`Bank [${bankName}] is configured for PosNetV1Pos and needs a PosNetPosAccount.`)
        }
        requestValueMapper = new PosNetV1PosRequestValueMapper()
        requestValueFormatter = new PosNetV1PosRequestValueFormatter()
        crypt = new PosNetV1PosCrypt(logger)
        responseValueFormatter = new PosNetPosResponseValueFormatter()
        responseValueMapper = new PosNetV1PosResponseValueMapper()
        break
      }
      case 'VakifKatilimPos': {
        if (!(account instanceof BoaPosAccount)) {
          throw new PosError(`Bank [${bankName}] is configured for VakifKatilimPos and needs a BoaPosAccount.`)
        }
        requestValueMapper = new VakifKatilimPosRequestValueMapper()
        requestValueFormatter = new VakifKatilimPosRequestValueFormatter()
        crypt = new KuveytPosCrypt(logger)
        responseValueFormatter = new BoaPosResponseValueFormatter()
        responseValueMapper = new VakifKatilimPosResponseValueMapper()
        break
      }
      default:
        throw new GatewayClassNotConfiguredError(`PosQuery not found for gateway ${gatewayClass}`)
    }

    const responseDataMapper = PosQueryResponseMapperFactory.createForGateway(
      gatewayClass,
      responseValueFormatter,
      responseValueMapper,
      logger,
    )
    const deps: PosQueryDeps & { responseDataMapper?: unknown } = {
      requestDataMapper: PosQueryRequestMapperFactory.createForGateway(
        gatewayClass,
        requestValueMapper,
        requestValueFormatter,
        crypt,
        gatewayConfig.lang ?? LANG.TR,
      ),
      clientStrategy: PosHttpClientStrategyFactory.createForGateway(gatewayClass, gatewayConfig, transport, logger, {
        account,
        crypt,
      }),
      logger,
      hooks: options.hooks ?? {},
      allowedApiOrigins: options.allowedApiOrigins,
    }
    if (responseDataMapper !== null) {
      deps.responseDataMapper = responseDataMapper
    }

    return new (
      QueryClass as unknown as new (
        c: GatewayConfig,
        a: AbstractPosAccount,
        d: PosQueryDeps,
      ) => AbstractPosQuery
    )(gatewayConfig, account, deps)
  },
}

function buildAsseco(logger: ReturnType<typeof createSafeLogger>) {
  return {
    requestValueMapper: new AssecoPosRequestValueMapper(),
    requestValueFormatter: new AssecoPosRequestValueFormatter(),
    crypt: new AssecoPosCrypt(logger),
  }
}
