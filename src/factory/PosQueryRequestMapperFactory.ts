import type { CryptInterface } from '../crypt/CryptInterface.js'
import { AssecoPosQueryRequestDataMapper } from '../data-mapper/pos-query/request/AssecoPosQueryRequestDataMapper.js'
import { PayFlexCPV4PosQueryRequestDataMapper } from '../data-mapper/pos-query/request/PayFlexCPV4PosQueryRequestDataMapper.js'
import { PayFlexV4PosQueryRequestDataMapper } from '../data-mapper/pos-query/request/PayFlexV4PosQueryRequestDataMapper.js'
import type { QueryRequestDataMapperInterface } from '../data-mapper/pos-query/request/QueryRequestDataMapperInterface.js'
import type { RequestValueFormatterInterface } from '../data-mapper/request/value-formatter/RequestValueFormatterInterface.js'
import type { RequestValueMapperInterface } from '../data-mapper/request/value-mapper/RequestValueMapperInterface.js'
import { GatewayClassNotConfiguredError } from '../errors.js'
import type { Lang } from '../PosInterface.js'

/** The first registered mapper whose `supports()` accepts the gateway class wins. */
const REQUEST_MAPPERS = [
  AssecoPosQueryRequestDataMapper,
  PayFlexCPV4PosQueryRequestDataMapper,
  PayFlexV4PosQueryRequestDataMapper,
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
