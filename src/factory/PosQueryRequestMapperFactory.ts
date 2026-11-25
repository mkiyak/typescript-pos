import type { CryptInterface } from '../crypt/CryptInterface.js'
import { AkbankPosQueryRequestDataMapper } from '../data-mapper/pos-query/request/AkbankPosQueryRequestDataMapper.js'
import { AssecoPosQueryRequestDataMapper } from '../data-mapper/pos-query/request/AssecoPosQueryRequestDataMapper.js'
import { GarantiPosQueryRequestDataMapper } from '../data-mapper/pos-query/request/GarantiPosQueryRequestDataMapper.js'
import { InterPosQueryRequestDataMapper } from '../data-mapper/pos-query/request/InterPosQueryRequestDataMapper.js'
import { PayFlexCPV4PosQueryRequestDataMapper } from '../data-mapper/pos-query/request/PayFlexCPV4PosQueryRequestDataMapper.js'
import { PayFlexV4PosQueryRequestDataMapper } from '../data-mapper/pos-query/request/PayFlexV4PosQueryRequestDataMapper.js'
import { PayForPosQueryRequestDataMapper } from '../data-mapper/pos-query/request/PayForPosQueryRequestDataMapper.js'
import { PosNetPosQueryRequestDataMapper } from '../data-mapper/pos-query/request/PosNetPosQueryRequestDataMapper.js'
import { PosNetV1PosQueryRequestDataMapper } from '../data-mapper/pos-query/request/PosNetV1PosQueryRequestDataMapper.js'
import type { QueryRequestDataMapperInterface } from '../data-mapper/pos-query/request/QueryRequestDataMapperInterface.js'
import { ToslaPosQueryRequestDataMapper } from '../data-mapper/pos-query/request/ToslaPosQueryRequestDataMapper.js'
import { VakifKatilimPosQueryRequestDataMapper } from '../data-mapper/pos-query/request/VakifKatilimPosQueryRequestDataMapper.js'
import type { RequestValueFormatterInterface } from '../data-mapper/request/value-formatter/RequestValueFormatterInterface.js'
import type { RequestValueMapperInterface } from '../data-mapper/request/value-mapper/RequestValueMapperInterface.js'
import { GatewayClassNotConfiguredError } from '../errors.js'
import type { Lang } from '../PosInterface.js'

/** The first registered mapper whose `supports()` accepts the gateway class wins. */
const REQUEST_MAPPERS = [
  AkbankPosQueryRequestDataMapper,
  AssecoPosQueryRequestDataMapper,
  GarantiPosQueryRequestDataMapper,
  InterPosQueryRequestDataMapper,
  PayFlexCPV4PosQueryRequestDataMapper,
  PayFlexV4PosQueryRequestDataMapper,
  PayForPosQueryRequestDataMapper,
  PosNetPosQueryRequestDataMapper,
  PosNetV1PosQueryRequestDataMapper,
  ToslaPosQueryRequestDataMapper,
  VakifKatilimPosQueryRequestDataMapper,
]

/** Picks the query request mapper of a gateway class. Internal: not part of the public API. */
export const PosQueryRequestMapperFactory = {
  createForGateway(
    gatewayClass: string,
    valueMapper: RequestValueMapperInterface,
    valueFormatter: RequestValueFormatterInterface,
    crypt: CryptInterface,
    defaultLang: Lang,
  ): QueryRequestDataMapperInterface {
    for (const MapperClass of REQUEST_MAPPERS) {
      if (MapperClass.supports(gatewayClass)) {
        return new MapperClass(
          valueMapper,
          valueFormatter,
          crypt as never,
          defaultLang,
        ) as QueryRequestDataMapperInterface
      }
    }
    throw new GatewayClassNotConfiguredError(`PosQuery request mapper not found for gateway ${gatewayClass}`)
  },
}
