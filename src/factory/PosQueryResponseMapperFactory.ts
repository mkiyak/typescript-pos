import type { QueryResponseDataMapperInterface } from '../data-mapper/pos-query/response/QueryResponseDataMapperInterface.js'
import type { ResponseValueFormatterInterface } from '../data-mapper/response/value-formatter/ResponseValueFormatterInterface.js'
import type { ResponseValueMapperInterface } from '../data-mapper/response/value-mapper/ResponseValueMapperInterface.js'
import type { PosLogger } from '../logger.js'

type ResponseMapperClass = {
  supports(gatewayClass: string): boolean
  new (
    valueFormatter: ResponseValueFormatterInterface,
    valueMapper: ResponseValueMapperInterface,
    logger: PosLogger,
  ): QueryResponseDataMapperInterface
}

/**
 * Gateways whose queries need a normalized answer (history, installments, BIN list) register their response mapper
 * here with their own version. AssecoPos, PayFlexV4Pos and PayFlexCPV4Pos answer custom queries only, which are
 * returned as the bank sent them, so nothing is registered yet.
 */
const RESPONSE_MAPPERS: readonly ResponseMapperClass[] = []

/** Picks the query response mapper of a gateway class, or null when it has none. Internal: not part of the public API. */
export const PosQueryResponseMapperFactory = {
  createForGateway(
    gatewayClass: string,
    valueFormatter: ResponseValueFormatterInterface,
    valueMapper: ResponseValueMapperInterface,
    logger: PosLogger,
  ): QueryResponseDataMapperInterface | null {
    for (const MapperClass of RESPONSE_MAPPERS) {
      if (MapperClass.supports(gatewayClass)) {
        return new MapperClass(valueFormatter, valueMapper, logger)
      }
    }
    return null
  },
}
