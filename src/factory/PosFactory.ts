import { HttpTransport } from '../client/HttpTransport.js'
import { AkbankPosCrypt } from '../crypt/AkbankPosCrypt.js'
import { AssecoPosCrypt } from '../crypt/AssecoPosCrypt.js'
import { GarantiPosCrypt } from '../crypt/GarantiPosCrypt.js'
import { PayFlexCPV4PosCrypt } from '../crypt/PayFlexCPV4PosCrypt.js'
import { PayFlexV4PosCrypt } from '../crypt/PayFlexV4PosCrypt.js'
import { AkbankPosRequestDataMapper } from '../data-mapper/request/mapper/AkbankPosRequestDataMapper.js'
import { AssecoPosRequestDataMapper } from '../data-mapper/request/mapper/AssecoPosRequestDataMapper.js'
import { GarantiPosRequestDataMapper } from '../data-mapper/request/mapper/GarantiPosRequestDataMapper.js'
import { PayFlexCPV4PosRequestDataMapper } from '../data-mapper/request/mapper/PayFlexCPV4PosRequestDataMapper.js'
import { PayFlexV4PosRequestDataMapper } from '../data-mapper/request/mapper/PayFlexV4PosRequestDataMapper.js'
import { AkbankPosRequestValueFormatter } from '../data-mapper/request/value-formatter/AkbankPosRequestValueFormatter.js'
import { AssecoPosRequestValueFormatter } from '../data-mapper/request/value-formatter/AssecoPosRequestValueFormatter.js'
import { GarantiPosRequestValueFormatter } from '../data-mapper/request/value-formatter/GarantiPosRequestValueFormatter.js'
import { PayFlexCPV4PosRequestValueFormatter } from '../data-mapper/request/value-formatter/PayFlexCPV4PosRequestValueFormatter.js'
import { PayFlexV4PosRequestValueFormatter } from '../data-mapper/request/value-formatter/PayFlexV4PosRequestValueFormatter.js'
import { AkbankPosRequestValueMapper } from '../data-mapper/request/value-mapper/AkbankPosRequestValueMapper.js'
import { AssecoPosRequestValueMapper } from '../data-mapper/request/value-mapper/AssecoPosRequestValueMapper.js'
import { GarantiPosRequestValueMapper } from '../data-mapper/request/value-mapper/GarantiPosRequestValueMapper.js'
import { PayFlexCPV4PosRequestValueMapper } from '../data-mapper/request/value-mapper/PayFlexCPV4PosRequestValueMapper.js'
import { PayFlexV4PosRequestValueMapper } from '../data-mapper/request/value-mapper/PayFlexV4PosRequestValueMapper.js'
import { AkbankPosResponseDataMapper } from '../data-mapper/response/mapper/AkbankPosResponseDataMapper.js'
import { AssecoPosResponseDataMapper } from '../data-mapper/response/mapper/AssecoPosResponseDataMapper.js'
import { GarantiPosResponseDataMapper } from '../data-mapper/response/mapper/GarantiPosResponseDataMapper.js'
import { PayFlexCPV4PosResponseDataMapper } from '../data-mapper/response/mapper/PayFlexCPV4PosResponseDataMapper.js'
import { PayFlexV4PosResponseDataMapper } from '../data-mapper/response/mapper/PayFlexV4PosResponseDataMapper.js'
import { AssecoPosResponseValueFormatter } from '../data-mapper/response/value-formatter/AssecoPosResponseValueFormatter.js'
import { BasicResponseValueFormatter } from '../data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { GarantiPosResponseValueFormatter } from '../data-mapper/response/value-formatter/GarantiPosResponseValueFormatter.js'
import { AkbankPosResponseValueMapper } from '../data-mapper/response/value-mapper/AkbankPosResponseValueMapper.js'
import { AssecoPosResponseValueMapper } from '../data-mapper/response/value-mapper/AssecoPosResponseValueMapper.js'
import { GarantiPosResponseValueMapper } from '../data-mapper/response/value-mapper/GarantiPosResponseValueMapper.js'
import { PayFlexCPV4PosResponseValueMapper } from '../data-mapper/response/value-mapper/PayFlexCPV4PosResponseValueMapper.js'
import { PayFlexV4PosResponseValueMapper } from '../data-mapper/response/value-mapper/PayFlexV4PosResponseValueMapper.js'
import { GatewayClassNotConfiguredError, PosError } from '../errors.js'
import type { AbstractGateway, GatewayConfig } from '../gateway/AbstractGateway.js'
import { AkbankPos } from '../gateway/AkbankPos.js'
import { AssecoPos } from '../gateway/AssecoPos.js'
import { GarantiPos } from '../gateway/GarantiPos.js'
import { PayFlexCPV4Pos } from '../gateway/PayFlexCPV4Pos.js'
import { PayFlexV4Pos } from '../gateway/PayFlexV4Pos.js'
import { createSafeLogger, noopLogger, type PosLogger } from '../logger.js'
import type { AbstractPosAccount } from '../model/account/AbstractPosAccount.js'
import { AkbankPosAccount } from '../model/account/AkbankPosAccount.js'
import { AssecoPosAccount } from '../model/account/AssecoPosAccount.js'
import { GarantiPosAccount } from '../model/account/GarantiPosAccount.js'
import { PayFlexPosAccount } from '../model/account/PayFlexPosAccount.js'
import { LANG } from '../PosInterface.js'
import type { PosHooks } from '../types.js'
import { assertHttpsEndpoints, PosHttpClientStrategyFactory } from './PosHttpClientStrategyFactory.js'

/** Bank configuration: `banks[account.getBankName()]` selects the gateway and its endpoints. */
export type PosConfig = { banks: Record<string, GatewayConfig> }

export type PosFactoryOptions = {
  /** Custom HTTP transport; takes precedence over `fetch` and `timeoutMs`. */
  transport?: HttpTransport
  /** Custom fetch implementation for the default transport. */
  fetch?: typeof fetch
  /** Request timeout of the default transport in milliseconds (default 60000). */
  timeoutMs?: number
  logger?: PosLogger
  hooks?: PosHooks
  /** Overrides the bank config's `test_mode`. */
  testMode?: boolean
}

/**
 * Builds AssecoPos, PayFlexV4Pos, PayFlexCPV4Pos, GarantiPos and AkbankPos gateways: the gateway class is picked by `GatewayConfig.class` and wired with its crypt, mappers and HTTP clients.
 */
export const PosFactory = {
  /**
   * @throws GatewayClassNotConfiguredError when the account's bank is not in the config or its class is unknown
   * @throws PosError when the account type does not fit the gateway, or a required endpoint is missing or is not an
   *   `https:` URL
   */
  createPosGateway(account: AbstractPosAccount, config: PosConfig, options: PosFactoryOptions = {}): AbstractGateway {
    const bankName = account.getBankName()
    if (!Object.hasOwn(config.banks, bankName)) {
      throw new GatewayClassNotConfiguredError(`Bank [${bankName}] is not configured.`)
    }
    const bankConfig = config.banks[bankName] as GatewayConfig
    const gatewayConfig: GatewayConfig =
      options.testMode === undefined ? bankConfig : { ...bankConfig, test_mode: options.testMode }

    assertHttpsEndpoints(gatewayConfig)

    const logger = createSafeLogger(options.logger ?? noopLogger)
    const hooks = options.hooks ?? {}
    const transport = options.transport ?? new HttpTransport({ fetch: options.fetch, timeoutMs: options.timeoutMs })

    switch (bankConfig.class) {
      case AssecoPos.GATEWAY_CLASS:
        return createAssecoPos(account, gatewayConfig, transport, logger, hooks)
      case PayFlexV4Pos.GATEWAY_CLASS:
        return createPayFlexV4Pos(account, gatewayConfig, transport, logger, hooks)
      case PayFlexCPV4Pos.GATEWAY_CLASS:
        return createPayFlexCPV4Pos(account, gatewayConfig, transport, logger, hooks)
      case GarantiPos.GATEWAY_CLASS:
        return createGarantiPos(account, gatewayConfig, transport, logger, hooks)
      case AkbankPos.GATEWAY_CLASS:
        return createAkbankPos(account, gatewayConfig, transport, logger, hooks)
      default:
        throw new GatewayClassNotConfiguredError(
          `Gateway class [${bankConfig.class}] of bank [${bankName}] is not supported.`,
        )
    }
  },
}

function createAssecoPos(
  account: AbstractPosAccount,
  config: GatewayConfig,
  transport: HttpTransport,
  logger: PosLogger,
  hooks: PosHooks,
): AssecoPos {
  if (!(account instanceof AssecoPosAccount)) {
    throw new PosError(`Bank [${account.getBankName()}] is configured for AssecoPos and needs an AssecoPosAccount.`)
  }

  const crypt = new AssecoPosCrypt(logger)
  const requestValueMapper = new AssecoPosRequestValueMapper()
  const requestValueFormatter = new AssecoPosRequestValueFormatter()

  return new AssecoPos(config, account, {
    requestValueMapper,
    requestValueFormatter,
    requestDataMapper: new AssecoPosRequestDataMapper(
      requestValueMapper,
      requestValueFormatter,
      hooks,
      crypt,
      config.lang ?? LANG.TR,
    ),
    responseDataMapper: new AssecoPosResponseDataMapper(
      new AssecoPosResponseValueFormatter(),
      new AssecoPosResponseValueMapper(),
      logger,
    ),
    crypt,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(AssecoPos.GATEWAY_CLASS, config, transport, logger, {
      account,
      crypt,
    }),
    logger,
    hooks,
  })
}

function createPayFlexV4Pos(
  account: AbstractPosAccount,
  config: GatewayConfig,
  transport: HttpTransport,
  logger: PosLogger,
  hooks: PosHooks,
): PayFlexV4Pos {
  if (!(account instanceof PayFlexPosAccount)) {
    throw new PosError(`Bank [${account.getBankName()}] is configured for PayFlexV4Pos and needs a PayFlexPosAccount.`)
  }

  const crypt = new PayFlexV4PosCrypt(logger)
  const requestValueMapper = new PayFlexV4PosRequestValueMapper()
  const requestValueFormatter = new PayFlexV4PosRequestValueFormatter()

  return new PayFlexV4Pos(config, account, {
    requestValueMapper,
    requestValueFormatter,
    requestDataMapper: new PayFlexV4PosRequestDataMapper(
      requestValueMapper,
      requestValueFormatter,
      hooks,
      crypt,
      config.lang ?? LANG.TR,
    ),
    responseDataMapper: new PayFlexV4PosResponseDataMapper(
      new BasicResponseValueFormatter(),
      new PayFlexV4PosResponseValueMapper(),
      logger,
    ),
    crypt,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(
      PayFlexV4Pos.GATEWAY_CLASS,
      config,
      transport,
      logger,
      { account, crypt },
    ),
    logger,
    hooks,
  })
}

function createPayFlexCPV4Pos(
  account: AbstractPosAccount,
  config: GatewayConfig,
  transport: HttpTransport,
  logger: PosLogger,
  hooks: PosHooks,
): PayFlexCPV4Pos {
  if (!(account instanceof PayFlexPosAccount)) {
    throw new PosError(
      `Bank [${account.getBankName()}] is configured for PayFlexCPV4Pos and needs a PayFlexPosAccount.`,
    )
  }

  const crypt = new PayFlexCPV4PosCrypt(logger)
  const requestValueMapper = new PayFlexCPV4PosRequestValueMapper()
  const requestValueFormatter = new PayFlexCPV4PosRequestValueFormatter()

  return new PayFlexCPV4Pos(config, account, {
    requestValueMapper,
    requestValueFormatter,
    requestDataMapper: new PayFlexCPV4PosRequestDataMapper(
      requestValueMapper,
      requestValueFormatter,
      hooks,
      crypt,
      config.lang ?? LANG.TR,
    ),
    responseDataMapper: new PayFlexCPV4PosResponseDataMapper(
      new BasicResponseValueFormatter(),
      new PayFlexCPV4PosResponseValueMapper(),
      logger,
    ),
    crypt,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(
      PayFlexCPV4Pos.GATEWAY_CLASS,
      config,
      transport,
      logger,
      { account, crypt },
    ),
    logger,
    hooks,
  })
}

function createGarantiPos(
  account: AbstractPosAccount,
  config: GatewayConfig,
  transport: HttpTransport,
  logger: PosLogger,
  hooks: PosHooks,
): GarantiPos {
  if (!(account instanceof GarantiPosAccount)) {
    throw new PosError(`Bank [${account.getBankName()}] is configured for GarantiPos and needs a GarantiPosAccount.`)
  }

  const crypt = new GarantiPosCrypt(logger)
  const requestValueMapper = new GarantiPosRequestValueMapper()
  const requestValueFormatter = new GarantiPosRequestValueFormatter()

  return new GarantiPos(config, account, {
    requestValueMapper,
    requestValueFormatter,
    requestDataMapper: new GarantiPosRequestDataMapper(
      requestValueMapper,
      requestValueFormatter,
      hooks,
      crypt,
      config.lang ?? LANG.TR,
    ),
    responseDataMapper: new GarantiPosResponseDataMapper(
      new GarantiPosResponseValueFormatter(),
      new GarantiPosResponseValueMapper(),
      logger,
    ),
    crypt,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(GarantiPos.GATEWAY_CLASS, config, transport, logger, {
      account,
      crypt,
    }),
    logger,
    hooks,
  })
}

function createAkbankPos(
  account: AbstractPosAccount,
  config: GatewayConfig,
  transport: HttpTransport,
  logger: PosLogger,
  hooks: PosHooks,
): AkbankPos {
  if (!(account instanceof AkbankPosAccount)) {
    throw new PosError(`Bank [${account.getBankName()}] is configured for AkbankPos and needs an AkbankPosAccount.`)
  }

  const crypt = new AkbankPosCrypt(logger)
  const requestValueMapper = new AkbankPosRequestValueMapper()
  const requestValueFormatter = new AkbankPosRequestValueFormatter()

  return new AkbankPos(config, account, {
    requestValueMapper,
    requestValueFormatter,
    requestDataMapper: new AkbankPosRequestDataMapper(
      requestValueMapper,
      requestValueFormatter,
      hooks,
      crypt,
      config.lang ?? LANG.TR,
    ),
    responseDataMapper: new AkbankPosResponseDataMapper(
      new BasicResponseValueFormatter(),
      new AkbankPosResponseValueMapper(),
      logger,
    ),
    crypt,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(AkbankPos.GATEWAY_CLASS, config, transport, logger, {
      account,
      crypt,
    }),
    logger,
    hooks,
  })
}
