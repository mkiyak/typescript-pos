import { HttpTransport } from '../client/HttpTransport.js'
import { AssecoPosCrypt } from '../crypt/AssecoPosCrypt.js'
import type { CryptInterface } from '../crypt/CryptInterface.js'
import { PayFlexCPV4PosCrypt } from '../crypt/PayFlexCPV4PosCrypt.js'
import { PayFlexV4PosCrypt } from '../crypt/PayFlexV4PosCrypt.js'
import { AssecoPosRequestValueFormatter } from '../data-mapper/request/value-formatter/AssecoPosRequestValueFormatter.js'
import { PayFlexCPV4PosRequestValueFormatter } from '../data-mapper/request/value-formatter/PayFlexCPV4PosRequestValueFormatter.js'
import { PayFlexV4PosRequestValueFormatter } from '../data-mapper/request/value-formatter/PayFlexV4PosRequestValueFormatter.js'
import type { RequestValueFormatterInterface } from '../data-mapper/request/value-formatter/RequestValueFormatterInterface.js'
import { AssecoPosRequestValueMapper } from '../data-mapper/request/value-mapper/AssecoPosRequestValueMapper.js'
import { PayFlexCPV4PosRequestValueMapper } from '../data-mapper/request/value-mapper/PayFlexCPV4PosRequestValueMapper.js'
import { PayFlexV4PosRequestValueMapper } from '../data-mapper/request/value-mapper/PayFlexV4PosRequestValueMapper.js'
import type { RequestValueMapperInterface } from '../data-mapper/request/value-mapper/RequestValueMapperInterface.js'
import { AssecoPosResponseValueFormatter } from '../data-mapper/response/value-formatter/AssecoPosResponseValueFormatter.js'
import { BasicResponseValueFormatter } from '../data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import type { ResponseValueFormatterInterface } from '../data-mapper/response/value-formatter/ResponseValueFormatterInterface.js'
import { AssecoPosResponseValueMapper } from '../data-mapper/response/value-mapper/AssecoPosResponseValueMapper.js'
import { PayFlexCPV4PosResponseValueMapper } from '../data-mapper/response/value-mapper/PayFlexCPV4PosResponseValueMapper.js'
import { PayFlexV4PosResponseValueMapper } from '../data-mapper/response/value-mapper/PayFlexV4PosResponseValueMapper.js'
import type { ResponseValueMapperInterface } from '../data-mapper/response/value-mapper/ResponseValueMapperInterface.js'
import { GatewayClassNotConfiguredError, PosError } from '../errors.js'
import type { GatewayConfig } from '../gateway/AbstractGateway.js'
import { createSafeLogger, noopLogger } from '../logger.js'
import type { AbstractPosAccount } from '../model/account/AbstractPosAccount.js'
import { AssecoPosAccount } from '../model/account/AssecoPosAccount.js'
import { PayFlexPosAccount } from '../model/account/PayFlexPosAccount.js'
import { LANG } from '../PosInterface.js'
import type { AbstractPosQuery, PosQueryDeps } from '../pos-query/AbstractPosQuery.js'
import { AssecoPosQuery } from '../pos-query/AssecoPosQuery.js'
import { PayFlexCPV4PosQuery } from '../pos-query/PayFlexCPV4PosQuery.js'
import { PayFlexV4PosQuery } from '../pos-query/PayFlexV4PosQuery.js'
import type { PosConfig, PosFactoryOptions } from './PosFactory.js'
import { assertHttpsEndpoints, PosHttpClientStrategyFactory } from './PosHttpClientStrategyFactory.js'
import { PosQueryRequestMapperFactory } from './PosQueryRequestMapperFactory.js'
import { PosQueryResponseMapperFactory } from './PosQueryResponseMapperFactory.js'

export type PosQueryFactoryOptions = PosFactoryOptions & {
  /** Extra `https:` origins `customQuery(…, apiUrl)` may target besides the configured endpoints. */
  allowedApiOrigins?: readonly string[]
}

const QUERY_CLASSES = [AssecoPosQuery, PayFlexCPV4PosQuery, PayFlexV4PosQuery]

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
      case 'AssecoPos': {
        if (!(account instanceof AssecoPosAccount)) {
          throw new PosError(`Bank [${bankName}] is configured for AssecoPos and needs an AssecoPosAccount.`)
        }
        ;({ requestValueMapper, requestValueFormatter, crypt } = buildAsseco(logger))
        responseValueFormatter = new AssecoPosResponseValueFormatter()
        responseValueMapper = new AssecoPosResponseValueMapper()
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
      default: {
        if (!(account instanceof PayFlexPosAccount)) {
          throw new PosError(`Bank [${bankName}] is configured for PayFlexCPV4Pos and needs a PayFlexPosAccount.`)
        }
        requestValueMapper = new PayFlexCPV4PosRequestValueMapper()
        requestValueFormatter = new PayFlexCPV4PosRequestValueFormatter()
        crypt = new PayFlexCPV4PosCrypt(logger)
        responseValueFormatter = new BasicResponseValueFormatter()
        responseValueMapper = new PayFlexCPV4PosResponseValueMapper()
      }
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
      clientStrategy: PosHttpClientStrategyFactory.createForGateway(gatewayClass, gatewayConfig, transport, logger),
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
