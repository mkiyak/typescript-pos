import { describe, expect, it } from 'vitest'
import { AkbankPosQueryResponseDataMapper } from '../../../src/data-mapper/pos-query/response/AkbankPosQueryResponseDataMapper.js'
import { GarantiPosQueryResponseDataMapper } from '../../../src/data-mapper/pos-query/response/GarantiPosQueryResponseDataMapper.js'
import { IyzicoPosQueryResponseDataMapper } from '../../../src/data-mapper/pos-query/response/IyzicoPosQueryResponseDataMapper.js'
import { ParamPosQueryResponseDataMapper } from '../../../src/data-mapper/pos-query/response/ParamPosQueryResponseDataMapper.js'
import { PayForPosQueryResponseDataMapper } from '../../../src/data-mapper/pos-query/response/PayForPosQueryResponseDataMapper.js'
import { PayTrPosQueryResponseDataMapper } from '../../../src/data-mapper/pos-query/response/PayTrPosQueryResponseDataMapper.js'
import { ToslaPosQueryResponseDataMapper } from '../../../src/data-mapper/pos-query/response/ToslaPosQueryResponseDataMapper.js'
import { VakifKatilimPosQueryResponseDataMapper } from '../../../src/data-mapper/pos-query/response/VakifKatilimPosQueryResponseDataMapper.js'
import { AssecoPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/AssecoPosResponseValueFormatter.js'
import { BasicResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { BoaPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/BoaPosResponseValueFormatter.js'
import { GarantiPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/GarantiPosResponseValueFormatter.js'
import { IyzicoPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/IyzicoPosResponseValueFormatter.js'
import { ParamPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/ParamPosResponseValueFormatter.js'
import { PayTrPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/PayTrPosResponseValueFormatter.js'
import { ToslaPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/ToslaPosResponseValueFormatter.js'
import { AkbankPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/AkbankPosResponseValueMapper.js'
import { AssecoPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/AssecoPosResponseValueMapper.js'
import { GarantiPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/GarantiPosResponseValueMapper.js'
import { IyzicoPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/IyzicoPosResponseValueMapper.js'
import { KuveytPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/KuveytPosResponseValueMapper.js'
import { ParamPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/ParamPosResponseValueMapper.js'
import { PayFlexCPV4PosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PayFlexCPV4PosResponseValueMapper.js'
import { PayFlexV4PosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PayFlexV4PosResponseValueMapper.js'
import { PayForPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PayForPosResponseValueMapper.js'
import { PayTrPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PayTrPosResponseValueMapper.js'
import { ToslaPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/ToslaPosResponseValueMapper.js'
import { VakifKatilimPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/VakifKatilimPosResponseValueMapper.js'
import { PosQueryResponseMapperFactory } from '../../../src/factory/PosQueryResponseMapperFactory.js'
import { noopLogger } from '../../../src/logger.js'

describe('PosQueryResponseMapperFactory', () => {
  it('testCreateForGatewayReturnsNullForUnregisteredGateway', () => {
    expect(
      PosQueryResponseMapperFactory.createForGateway(
        'AssecoPos',
        new AssecoPosResponseValueFormatter(),
        new AssecoPosResponseValueMapper(),
        noopLogger,
      ),
    ).toBeNull()
  })

  it('testCreateForGatewayReturnsCorrectMapper AkbankPos', () => {
    expect(
      PosQueryResponseMapperFactory.createForGateway(
        'AkbankPos',
        new BasicResponseValueFormatter(),
        new AkbankPosResponseValueMapper(),
        noopLogger,
      ),
    ).toBeInstanceOf(AkbankPosQueryResponseDataMapper)
  })

  it('testCreateForGatewayReturnsCorrectMapper GarantiPos', () => {
    expect(
      PosQueryResponseMapperFactory.createForGateway(
        'GarantiPos',
        new GarantiPosResponseValueFormatter(),
        new GarantiPosResponseValueMapper(),
        noopLogger,
      ),
    ).toBeInstanceOf(GarantiPosQueryResponseDataMapper)
  })

  it('testCreateForGatewayReturnsCorrectMapper ParamPos', () => {
    expect(
      PosQueryResponseMapperFactory.createForGateway(
        'ParamPos',
        new ParamPosResponseValueFormatter(),
        new ParamPosResponseValueMapper(),
        noopLogger,
      ),
    ).toBeInstanceOf(ParamPosQueryResponseDataMapper)
  })

  // addition: the hosted-page gateway has no query response mapper
  it('returns null for Param3DHostPos', () => {
    expect(
      PosQueryResponseMapperFactory.createForGateway(
        'Param3DHostPos',
        new ParamPosResponseValueFormatter(),
        new ParamPosResponseValueMapper(),
        noopLogger,
      ),
    ).toBeNull()
  })

  it('testCreateForGatewayReturnsCorrectMapper PayForPos', () => {
    expect(
      PosQueryResponseMapperFactory.createForGateway(
        'PayForPos',
        new BasicResponseValueFormatter(),
        new PayForPosResponseValueMapper(),
        noopLogger,
      ),
    ).toBeInstanceOf(PayForPosQueryResponseDataMapper)
  })

  it('testCreateForGatewayReturnsCorrectMapper ToslaPos', () => {
    expect(
      PosQueryResponseMapperFactory.createForGateway(
        'ToslaPos',
        new ToslaPosResponseValueFormatter(),
        new ToslaPosResponseValueMapper(),
        noopLogger,
      ),
    ).toBeInstanceOf(ToslaPosQueryResponseDataMapper)
  })

  it('testCreateForGatewayReturnsCorrectMapper IyzicoPos', () => {
    expect(
      PosQueryResponseMapperFactory.createForGateway(
        'IyzicoPos',
        new IyzicoPosResponseValueFormatter(),
        new IyzicoPosResponseValueMapper(),
        noopLogger,
      ),
    ).toBeInstanceOf(IyzicoPosQueryResponseDataMapper)
  })

  it('testCreateForGatewayReturnsCorrectMapper PayTrPos', () => {
    expect(
      PosQueryResponseMapperFactory.createForGateway(
        'PayTrPos',
        new PayTrPosResponseValueFormatter(),
        new PayTrPosResponseValueMapper(),
        noopLogger,
      ),
    ).toBeInstanceOf(PayTrPosQueryResponseDataMapper)
  })

  it('testCreateForGatewayReturnsCorrectMapper VakifKatilimPos', () => {
    expect(
      PosQueryResponseMapperFactory.createForGateway(
        'VakifKatilimPos',
        new BoaPosResponseValueFormatter(),
        new VakifKatilimPosResponseValueMapper(),
        noopLogger,
      ),
    ).toBeInstanceOf(VakifKatilimPosQueryResponseDataMapper)
  })

  // addition: Kuveyt answers no history query, so it has no response mapper
  it('returns null for KuveytPos', () => {
    expect(
      PosQueryResponseMapperFactory.createForGateway(
        'KuveytPos',
        new BoaPosResponseValueFormatter(),
        new KuveytPosResponseValueMapper(),
        noopLogger,
      ),
    ).toBeNull()
  })

  // addition: the other two gateways of this version have no query response mapper either
  it.each([
    ['PayFlexV4Pos', new PayFlexV4PosResponseValueMapper()],
    ['PayFlexCPV4Pos', new PayFlexCPV4PosResponseValueMapper()],
  ] as const)('returns null for %s', (gatewayClass, valueMapper) => {
    expect(
      PosQueryResponseMapperFactory.createForGateway(
        gatewayClass,
        new BasicResponseValueFormatter(),
        valueMapper,
        noopLogger,
      ),
    ).toBeNull()
  })
})
