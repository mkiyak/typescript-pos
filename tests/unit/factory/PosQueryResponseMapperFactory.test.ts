import { describe, expect, it } from 'vitest'
import { GarantiPosQueryResponseDataMapper } from '../../../src/data-mapper/pos-query/response/GarantiPosQueryResponseDataMapper.js'
import { AssecoPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/AssecoPosResponseValueFormatter.js'
import { BasicResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { GarantiPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/GarantiPosResponseValueFormatter.js'
import { AssecoPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/AssecoPosResponseValueMapper.js'
import { GarantiPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/GarantiPosResponseValueMapper.js'
import { PayFlexCPV4PosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PayFlexCPV4PosResponseValueMapper.js'
import { PayFlexV4PosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PayFlexV4PosResponseValueMapper.js'
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
