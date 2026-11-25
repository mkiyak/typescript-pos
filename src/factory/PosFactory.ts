import { HttpTransport } from '../client/HttpTransport.js'
import { AkbankPosCrypt } from '../crypt/AkbankPosCrypt.js'
import { AssecoPosCrypt } from '../crypt/AssecoPosCrypt.js'
import { GarantiPosCrypt } from '../crypt/GarantiPosCrypt.js'
import { InterPosCrypt } from '../crypt/InterPosCrypt.js'
import { KuveytPosCrypt } from '../crypt/KuveytPosCrypt.js'
import { ParamPosCrypt } from '../crypt/ParamPosCrypt.js'
import { PayFlexCPV4PosCrypt } from '../crypt/PayFlexCPV4PosCrypt.js'
import { PayFlexV4PosCrypt } from '../crypt/PayFlexV4PosCrypt.js'
import { PayForPosCrypt } from '../crypt/PayForPosCrypt.js'
import { PosNetPosCrypt } from '../crypt/PosNetPosCrypt.js'
import { PosNetV1PosCrypt } from '../crypt/PosNetV1PosCrypt.js'
import { ToslaPosCrypt } from '../crypt/ToslaPosCrypt.js'
import { AkbankPosRequestDataMapper } from '../data-mapper/request/mapper/AkbankPosRequestDataMapper.js'
import { AssecoPosRequestDataMapper } from '../data-mapper/request/mapper/AssecoPosRequestDataMapper.js'
import { GarantiPosRequestDataMapper } from '../data-mapper/request/mapper/GarantiPosRequestDataMapper.js'
import { InterPosRequestDataMapper } from '../data-mapper/request/mapper/InterPosRequestDataMapper.js'
import { KuveytPosRequestDataMapper } from '../data-mapper/request/mapper/KuveytPosRequestDataMapper.js'
import { ParamPosRequestDataMapper } from '../data-mapper/request/mapper/ParamPosRequestDataMapper.js'
import { PayFlexCPV4PosRequestDataMapper } from '../data-mapper/request/mapper/PayFlexCPV4PosRequestDataMapper.js'
import { PayFlexV4PosRequestDataMapper } from '../data-mapper/request/mapper/PayFlexV4PosRequestDataMapper.js'
import { PayForPosRequestDataMapper } from '../data-mapper/request/mapper/PayForPosRequestDataMapper.js'
import { PosNetPosRequestDataMapper } from '../data-mapper/request/mapper/PosNetPosRequestDataMapper.js'
import { PosNetV1PosRequestDataMapper } from '../data-mapper/request/mapper/PosNetV1PosRequestDataMapper.js'
import { ToslaPosRequestDataMapper } from '../data-mapper/request/mapper/ToslaPosRequestDataMapper.js'
import { VakifKatilimPosRequestDataMapper } from '../data-mapper/request/mapper/VakifKatilimPosRequestDataMapper.js'
import { AkbankPosRequestValueFormatter } from '../data-mapper/request/value-formatter/AkbankPosRequestValueFormatter.js'
import { AssecoPosRequestValueFormatter } from '../data-mapper/request/value-formatter/AssecoPosRequestValueFormatter.js'
import { GarantiPosRequestValueFormatter } from '../data-mapper/request/value-formatter/GarantiPosRequestValueFormatter.js'
import { InterPosRequestValueFormatter } from '../data-mapper/request/value-formatter/InterPosRequestValueFormatter.js'
import { KuveytPosRequestValueFormatter } from '../data-mapper/request/value-formatter/KuveytPosRequestValueFormatter.js'
import { ParamPosRequestValueFormatter } from '../data-mapper/request/value-formatter/ParamPosRequestValueFormatter.js'
import { PayFlexCPV4PosRequestValueFormatter } from '../data-mapper/request/value-formatter/PayFlexCPV4PosRequestValueFormatter.js'
import { PayFlexV4PosRequestValueFormatter } from '../data-mapper/request/value-formatter/PayFlexV4PosRequestValueFormatter.js'
import { PayForPosRequestValueFormatter } from '../data-mapper/request/value-formatter/PayForPosRequestValueFormatter.js'
import { PosNetPosRequestValueFormatter } from '../data-mapper/request/value-formatter/PosNetPosRequestValueFormatter.js'
import { PosNetV1PosRequestValueFormatter } from '../data-mapper/request/value-formatter/PosNetV1PosRequestValueFormatter.js'
import { ToslaPosRequestValueFormatter } from '../data-mapper/request/value-formatter/ToslaPosRequestValueFormatter.js'
import { VakifKatilimPosRequestValueFormatter } from '../data-mapper/request/value-formatter/VakifKatilimPosRequestValueFormatter.js'
import { AkbankPosRequestValueMapper } from '../data-mapper/request/value-mapper/AkbankPosRequestValueMapper.js'
import { AssecoPosRequestValueMapper } from '../data-mapper/request/value-mapper/AssecoPosRequestValueMapper.js'
import { GarantiPosRequestValueMapper } from '../data-mapper/request/value-mapper/GarantiPosRequestValueMapper.js'
import { InterPosRequestValueMapper } from '../data-mapper/request/value-mapper/InterPosRequestValueMapper.js'
import { KuveytPosRequestValueMapper } from '../data-mapper/request/value-mapper/KuveytPosRequestValueMapper.js'
import { ParamPosRequestValueMapper } from '../data-mapper/request/value-mapper/ParamPosRequestValueMapper.js'
import { PayFlexCPV4PosRequestValueMapper } from '../data-mapper/request/value-mapper/PayFlexCPV4PosRequestValueMapper.js'
import { PayFlexV4PosRequestValueMapper } from '../data-mapper/request/value-mapper/PayFlexV4PosRequestValueMapper.js'
import { PayForPosRequestValueMapper } from '../data-mapper/request/value-mapper/PayForPosRequestValueMapper.js'
import { PosNetPosRequestValueMapper } from '../data-mapper/request/value-mapper/PosNetPosRequestValueMapper.js'
import { PosNetV1PosRequestValueMapper } from '../data-mapper/request/value-mapper/PosNetV1PosRequestValueMapper.js'
import { ToslaPosRequestValueMapper } from '../data-mapper/request/value-mapper/ToslaPosRequestValueMapper.js'
import { VakifKatilimPosRequestValueMapper } from '../data-mapper/request/value-mapper/VakifKatilimPosRequestValueMapper.js'
import { AkbankPosResponseDataMapper } from '../data-mapper/response/mapper/AkbankPosResponseDataMapper.js'
import { AssecoPosResponseDataMapper } from '../data-mapper/response/mapper/AssecoPosResponseDataMapper.js'
import { GarantiPosResponseDataMapper } from '../data-mapper/response/mapper/GarantiPosResponseDataMapper.js'
import { InterPosResponseDataMapper } from '../data-mapper/response/mapper/InterPosResponseDataMapper.js'
import { KuveytPosResponseDataMapper } from '../data-mapper/response/mapper/KuveytPosResponseDataMapper.js'
import { ParamPosResponseDataMapper } from '../data-mapper/response/mapper/ParamPosResponseDataMapper.js'
import { PayFlexCPV4PosResponseDataMapper } from '../data-mapper/response/mapper/PayFlexCPV4PosResponseDataMapper.js'
import { PayFlexV4PosResponseDataMapper } from '../data-mapper/response/mapper/PayFlexV4PosResponseDataMapper.js'
import { PayForPosResponseDataMapper } from '../data-mapper/response/mapper/PayForPosResponseDataMapper.js'
import { PosNetPosResponseDataMapper } from '../data-mapper/response/mapper/PosNetPosResponseDataMapper.js'
import { PosNetV1PosResponseDataMapper } from '../data-mapper/response/mapper/PosNetV1PosResponseDataMapper.js'
import { ToslaPosResponseDataMapper } from '../data-mapper/response/mapper/ToslaPosResponseDataMapper.js'
import { VakifKatilimPosResponseDataMapper } from '../data-mapper/response/mapper/VakifKatilimPosResponseDataMapper.js'
import { AssecoPosResponseValueFormatter } from '../data-mapper/response/value-formatter/AssecoPosResponseValueFormatter.js'
import { BasicResponseValueFormatter } from '../data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { BoaPosResponseValueFormatter } from '../data-mapper/response/value-formatter/BoaPosResponseValueFormatter.js'
import { GarantiPosResponseValueFormatter } from '../data-mapper/response/value-formatter/GarantiPosResponseValueFormatter.js'
import { InterPosResponseValueFormatter } from '../data-mapper/response/value-formatter/InterPosResponseValueFormatter.js'
import { ParamPosResponseValueFormatter } from '../data-mapper/response/value-formatter/ParamPosResponseValueFormatter.js'
import { PosNetPosResponseValueFormatter } from '../data-mapper/response/value-formatter/PosNetPosResponseValueFormatter.js'
import { ToslaPosResponseValueFormatter } from '../data-mapper/response/value-formatter/ToslaPosResponseValueFormatter.js'
import { AkbankPosResponseValueMapper } from '../data-mapper/response/value-mapper/AkbankPosResponseValueMapper.js'
import { AssecoPosResponseValueMapper } from '../data-mapper/response/value-mapper/AssecoPosResponseValueMapper.js'
import { GarantiPosResponseValueMapper } from '../data-mapper/response/value-mapper/GarantiPosResponseValueMapper.js'
import { InterPosResponseValueMapper } from '../data-mapper/response/value-mapper/InterPosResponseValueMapper.js'
import { KuveytPosResponseValueMapper } from '../data-mapper/response/value-mapper/KuveytPosResponseValueMapper.js'
import { ParamPosResponseValueMapper } from '../data-mapper/response/value-mapper/ParamPosResponseValueMapper.js'
import { PayFlexCPV4PosResponseValueMapper } from '../data-mapper/response/value-mapper/PayFlexCPV4PosResponseValueMapper.js'
import { PayFlexV4PosResponseValueMapper } from '../data-mapper/response/value-mapper/PayFlexV4PosResponseValueMapper.js'
import { PayForPosResponseValueMapper } from '../data-mapper/response/value-mapper/PayForPosResponseValueMapper.js'
import { PosNetPosResponseValueMapper } from '../data-mapper/response/value-mapper/PosNetPosResponseValueMapper.js'
import { PosNetV1PosResponseValueMapper } from '../data-mapper/response/value-mapper/PosNetV1PosResponseValueMapper.js'
import { ToslaPosResponseValueMapper } from '../data-mapper/response/value-mapper/ToslaPosResponseValueMapper.js'
import { VakifKatilimPosResponseValueMapper } from '../data-mapper/response/value-mapper/VakifKatilimPosResponseValueMapper.js'
import { GatewayClassNotConfiguredError, PosError } from '../errors.js'
import type { AbstractGateway, GatewayConfig } from '../gateway/AbstractGateway.js'
import { AkbankPos } from '../gateway/AkbankPos.js'
import { AssecoPos } from '../gateway/AssecoPos.js'
import { GarantiPos } from '../gateway/GarantiPos.js'
import { InterPos } from '../gateway/InterPos.js'
import { KuveytPos } from '../gateway/KuveytPos.js'
import { ParamPos } from '../gateway/ParamPos.js'
import { PayFlexCPV4Pos } from '../gateway/PayFlexCPV4Pos.js'
import { PayFlexV4Pos } from '../gateway/PayFlexV4Pos.js'
import { PayForPos } from '../gateway/PayForPos.js'
import { PosNetPos } from '../gateway/PosNetPos.js'
import { PosNetV1Pos } from '../gateway/PosNetV1Pos.js'
import { ToslaPos } from '../gateway/ToslaPos.js'
import { VakifKatilimPos } from '../gateway/VakifKatilimPos.js'
import { createSafeLogger, noopLogger, type PosLogger } from '../logger.js'
import type { AbstractPosAccount } from '../model/account/AbstractPosAccount.js'
import { AkbankPosAccount } from '../model/account/AkbankPosAccount.js'
import { AssecoPosAccount } from '../model/account/AssecoPosAccount.js'
import { BoaPosAccount } from '../model/account/BoaPosAccount.js'
import { GarantiPosAccount } from '../model/account/GarantiPosAccount.js'
import { InterPosAccount } from '../model/account/InterPosAccount.js'
import { ParamPosAccount } from '../model/account/ParamPosAccount.js'
import { PayFlexPosAccount } from '../model/account/PayFlexPosAccount.js'
import { PayForPosAccount } from '../model/account/PayForPosAccount.js'
import { PosNetPosAccount } from '../model/account/PosNetPosAccount.js'
import { ToslaPosAccount } from '../model/account/ToslaPosAccount.js'
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
 * Builds AssecoPos, PayFlexV4Pos, PayFlexCPV4Pos, GarantiPos, AkbankPos, PosNetPos, PosNetV1Pos, PayForPos, InterPos, KuveytPos, VakifKatilimPos, ToslaPos and ParamPos gateways: the gateway class is picked by `GatewayConfig.class` and wired with its crypt, mappers and HTTP clients.
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
      case PosNetPos.GATEWAY_CLASS:
        return createPosNetPos(account, gatewayConfig, transport, logger, hooks)
      case PosNetV1Pos.GATEWAY_CLASS:
        return createPosNetV1Pos(account, gatewayConfig, transport, logger, hooks)
      case PayForPos.GATEWAY_CLASS:
        return createPayForPos(account, gatewayConfig, transport, logger, hooks)
      case InterPos.GATEWAY_CLASS:
        return createInterPos(account, gatewayConfig, transport, logger, hooks)
      case KuveytPos.GATEWAY_CLASS:
        return createKuveytPos(account, gatewayConfig, transport, logger, hooks)
      case VakifKatilimPos.GATEWAY_CLASS:
        return createVakifKatilimPos(account, gatewayConfig, transport, logger, hooks)
      case ToslaPos.GATEWAY_CLASS:
        return createToslaPos(account, gatewayConfig, transport, logger, hooks)
      case ParamPos.GATEWAY_CLASS:
        return createParamPos(account, gatewayConfig, transport, logger, hooks)
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

function createPosNetPos(
  account: AbstractPosAccount,
  config: GatewayConfig,
  transport: HttpTransport,
  logger: PosLogger,
  hooks: PosHooks,
): PosNetPos {
  if (!(account instanceof PosNetPosAccount)) {
    throw new PosError(`Bank [${account.getBankName()}] is configured for PosNetPos and needs a PosNetPosAccount.`)
  }

  const crypt = new PosNetPosCrypt(logger)
  const requestValueMapper = new PosNetPosRequestValueMapper()
  const requestValueFormatter = new PosNetPosRequestValueFormatter()

  return new PosNetPos(config, account, {
    requestValueMapper,
    requestValueFormatter,
    requestDataMapper: new PosNetPosRequestDataMapper(
      requestValueMapper,
      requestValueFormatter,
      hooks,
      crypt,
      config.lang ?? LANG.TR,
    ),
    responseDataMapper: new PosNetPosResponseDataMapper(
      new PosNetPosResponseValueFormatter(),
      new PosNetPosResponseValueMapper(),
      logger,
    ),
    crypt,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(PosNetPos.GATEWAY_CLASS, config, transport, logger, {
      account,
      crypt,
    }),
    logger,
    hooks,
  })
}

function createPosNetV1Pos(
  account: AbstractPosAccount,
  config: GatewayConfig,
  transport: HttpTransport,
  logger: PosLogger,
  hooks: PosHooks,
): PosNetV1Pos {
  if (!(account instanceof PosNetPosAccount)) {
    throw new PosError(`Bank [${account.getBankName()}] is configured for PosNetV1Pos and needs a PosNetPosAccount.`)
  }

  const crypt = new PosNetV1PosCrypt(logger)
  const requestValueMapper = new PosNetV1PosRequestValueMapper()
  const requestValueFormatter = new PosNetV1PosRequestValueFormatter()

  return new PosNetV1Pos(config, account, {
    requestValueMapper,
    requestValueFormatter,
    requestDataMapper: new PosNetV1PosRequestDataMapper(
      requestValueMapper,
      requestValueFormatter,
      hooks,
      crypt,
      config.lang ?? LANG.TR,
    ),
    responseDataMapper: new PosNetV1PosResponseDataMapper(
      new PosNetPosResponseValueFormatter(),
      new PosNetV1PosResponseValueMapper(),
      logger,
    ),
    crypt,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(
      PosNetV1Pos.GATEWAY_CLASS,
      config,
      transport,
      logger,
      {
        account,
        crypt,
      },
    ),
    logger,
    hooks,
  })
}

function createPayForPos(
  account: AbstractPosAccount,
  config: GatewayConfig,
  transport: HttpTransport,
  logger: PosLogger,
  hooks: PosHooks,
): PayForPos {
  if (!(account instanceof PayForPosAccount)) {
    throw new PosError(`Bank [${account.getBankName()}] is configured for PayForPos and needs a PayForPosAccount.`)
  }

  const crypt = new PayForPosCrypt(logger)
  const requestValueMapper = new PayForPosRequestValueMapper()
  const requestValueFormatter = new PayForPosRequestValueFormatter()

  return new PayForPos(config, account, {
    requestValueMapper,
    requestValueFormatter,
    requestDataMapper: new PayForPosRequestDataMapper(
      requestValueMapper,
      requestValueFormatter,
      hooks,
      crypt,
      config.lang ?? LANG.TR,
    ),
    responseDataMapper: new PayForPosResponseDataMapper(
      new BasicResponseValueFormatter(),
      new PayForPosResponseValueMapper(),
      logger,
    ),
    crypt,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(PayForPos.GATEWAY_CLASS, config, transport, logger, {
      account,
      crypt,
    }),
    logger,
    hooks,
  })
}

function createInterPos(
  account: AbstractPosAccount,
  config: GatewayConfig,
  transport: HttpTransport,
  logger: PosLogger,
  hooks: PosHooks,
): InterPos {
  if (!(account instanceof InterPosAccount)) {
    throw new PosError(`Bank [${account.getBankName()}] is configured for InterPos and needs an InterPosAccount.`)
  }

  const crypt = new InterPosCrypt(logger)
  const requestValueMapper = new InterPosRequestValueMapper()
  const requestValueFormatter = new InterPosRequestValueFormatter()

  return new InterPos(config, account, {
    requestValueMapper,
    requestValueFormatter,
    requestDataMapper: new InterPosRequestDataMapper(
      requestValueMapper,
      requestValueFormatter,
      hooks,
      crypt,
      config.lang ?? LANG.TR,
    ),
    responseDataMapper: new InterPosResponseDataMapper(
      new InterPosResponseValueFormatter(),
      new InterPosResponseValueMapper(),
      logger,
    ),
    crypt,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(InterPos.GATEWAY_CLASS, config, transport, logger, {
      account,
      crypt,
    }),
    logger,
    hooks,
  })
}

function createKuveytPos(
  account: AbstractPosAccount,
  config: GatewayConfig,
  transport: HttpTransport,
  logger: PosLogger,
  hooks: PosHooks,
): KuveytPos {
  if (!(account instanceof BoaPosAccount)) {
    throw new PosError(`Bank [${account.getBankName()}] is configured for KuveytPos and needs a BoaPosAccount.`)
  }

  const crypt = new KuveytPosCrypt(logger)
  const requestValueMapper = new KuveytPosRequestValueMapper()
  const requestValueFormatter = new KuveytPosRequestValueFormatter()

  return new KuveytPos(config, account, {
    requestValueMapper,
    requestValueFormatter,
    requestDataMapper: new KuveytPosRequestDataMapper(
      requestValueMapper,
      requestValueFormatter,
      hooks,
      crypt,
      config.lang ?? LANG.TR,
    ),
    responseDataMapper: new KuveytPosResponseDataMapper(
      new BoaPosResponseValueFormatter(),
      new KuveytPosResponseValueMapper(),
      logger,
    ),
    crypt,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(KuveytPos.GATEWAY_CLASS, config, transport, logger, {
      account,
      crypt,
    }),
    logger,
    hooks,
  })
}

function createVakifKatilimPos(
  account: AbstractPosAccount,
  config: GatewayConfig,
  transport: HttpTransport,
  logger: PosLogger,
  hooks: PosHooks,
): VakifKatilimPos {
  if (!(account instanceof BoaPosAccount)) {
    throw new PosError(`Bank [${account.getBankName()}] is configured for VakifKatilimPos and needs a BoaPosAccount.`)
  }

  const crypt = new KuveytPosCrypt(logger)
  const requestValueMapper = new VakifKatilimPosRequestValueMapper()
  const requestValueFormatter = new VakifKatilimPosRequestValueFormatter()

  return new VakifKatilimPos(config, account, {
    requestValueMapper,
    requestValueFormatter,
    requestDataMapper: new VakifKatilimPosRequestDataMapper(
      requestValueMapper,
      requestValueFormatter,
      hooks,
      crypt,
      config.lang ?? LANG.TR,
    ),
    responseDataMapper: new VakifKatilimPosResponseDataMapper(
      new BoaPosResponseValueFormatter(),
      new VakifKatilimPosResponseValueMapper(),
      logger,
    ),
    crypt,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(
      VakifKatilimPos.GATEWAY_CLASS,
      config,
      transport,
      logger,
      {
        account,
        crypt,
      },
    ),
    logger,
    hooks,
  })
}

function createToslaPos(
  account: AbstractPosAccount,
  config: GatewayConfig,
  transport: HttpTransport,
  logger: PosLogger,
  hooks: PosHooks,
): ToslaPos {
  if (!(account instanceof ToslaPosAccount)) {
    throw new PosError(`Bank [${account.getBankName()}] is configured for ToslaPos and needs a ToslaPosAccount.`)
  }

  const crypt = new ToslaPosCrypt(logger)
  const requestValueMapper = new ToslaPosRequestValueMapper()
  const requestValueFormatter = new ToslaPosRequestValueFormatter()

  return new ToslaPos(config, account, {
    requestValueMapper,
    requestValueFormatter,
    requestDataMapper: new ToslaPosRequestDataMapper(
      requestValueMapper,
      requestValueFormatter,
      hooks,
      crypt,
      config.lang ?? LANG.TR,
    ),
    responseDataMapper: new ToslaPosResponseDataMapper(
      new ToslaPosResponseValueFormatter(),
      new ToslaPosResponseValueMapper(),
      logger,
    ),
    crypt,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(ToslaPos.GATEWAY_CLASS, config, transport, logger),
    logger,
    hooks,
  })
}

function createParamPos(
  account: AbstractPosAccount,
  config: GatewayConfig,
  transport: HttpTransport,
  logger: PosLogger,
  hooks: PosHooks,
): ParamPos {
  if (!(account instanceof ParamPosAccount)) {
    throw new PosError(`Bank [${account.getBankName()}] is configured for ParamPos and needs a ParamPosAccount.`)
  }

  const crypt = new ParamPosCrypt(logger)
  const requestValueMapper = new ParamPosRequestValueMapper()
  const requestValueFormatter = new ParamPosRequestValueFormatter()

  return new ParamPos(config, account, {
    requestValueMapper,
    requestValueFormatter,
    requestDataMapper: new ParamPosRequestDataMapper(
      requestValueMapper,
      requestValueFormatter,
      hooks,
      crypt,
      config.lang ?? LANG.TR,
    ),
    responseDataMapper: new ParamPosResponseDataMapper(
      new ParamPosResponseValueFormatter(),
      new ParamPosResponseValueMapper(),
      logger,
    ),
    crypt,
    clientStrategy: PosHttpClientStrategyFactory.createForGateway(ParamPos.GATEWAY_CLASS, config, transport, logger),
    logger,
    hooks,
  })
}
