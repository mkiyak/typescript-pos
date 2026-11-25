import { AkbankPosQueryResponseDataMapper } from '../data-mapper/pos-query/response/AkbankPosQueryResponseDataMapper.js'
import { GarantiPosQueryResponseDataMapper } from '../data-mapper/pos-query/response/GarantiPosQueryResponseDataMapper.js'
import { ParamPosQueryResponseDataMapper } from '../data-mapper/pos-query/response/ParamPosQueryResponseDataMapper.js'
import { PayForPosQueryResponseDataMapper } from '../data-mapper/pos-query/response/PayForPosQueryResponseDataMapper.js'
import { PayTrPosQueryResponseDataMapper } from '../data-mapper/pos-query/response/PayTrPosQueryResponseDataMapper.js'
import type { QueryResponseDataMapperInterface } from '../data-mapper/pos-query/response/QueryResponseDataMapperInterface.js'
import { ToslaPosQueryResponseDataMapper } from '../data-mapper/pos-query/response/ToslaPosQueryResponseDataMapper.js'
import { VakifKatilimPosQueryResponseDataMapper } from '../data-mapper/pos-query/response/VakifKatilimPosQueryResponseDataMapper.js'
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
 * here (Akbank, Garanti, Param, PayFor, PayTR and Vakıf Katılım answer history queries, Param, PayTR and Tosla the
 * installment queries, Garanti, Param and PayTR the BIN list). AssecoPos, InterPos, PayFlexV4Pos, PayFlexCPV4Pos and the PosNet gateways answer custom queries only
 * (KuveytPos has no query class), which are returned as the bank sent them, so they have none.
 */
const RESPONSE_MAPPERS: readonly ResponseMapperClass[] = [
  AkbankPosQueryResponseDataMapper,
  GarantiPosQueryResponseDataMapper,
  ParamPosQueryResponseDataMapper,
  PayForPosQueryResponseDataMapper,
  PayTrPosQueryResponseDataMapper,
  ToslaPosQueryResponseDataMapper,
  VakifKatilimPosQueryResponseDataMapper,
]

/** Picks the query response mapper of a gateway class, or null when it has none. Internal, not public API. */
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
