import { describe, expect, it } from 'vitest'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { AssecoPosQueryRequestDataMapper } from '../../../src/data-mapper/pos-query/request/AssecoPosQueryRequestDataMapper.js'
import { GarantiPosQueryRequestDataMapper } from '../../../src/data-mapper/pos-query/request/GarantiPosQueryRequestDataMapper.js'
import { PayFlexCPV4PosQueryRequestDataMapper } from '../../../src/data-mapper/pos-query/request/PayFlexCPV4PosQueryRequestDataMapper.js'
import { PayFlexV4PosQueryRequestDataMapper } from '../../../src/data-mapper/pos-query/request/PayFlexV4PosQueryRequestDataMapper.js'
import { AssecoPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/AssecoPosRequestValueFormatter.js'
import { GarantiPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/GarantiPosRequestValueFormatter.js'
import { PayFlexCPV4PosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/PayFlexCPV4PosRequestValueFormatter.js'
import { PayFlexV4PosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/PayFlexV4PosRequestValueFormatter.js'
import { AssecoPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/AssecoPosRequestValueMapper.js'
import { GarantiPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/GarantiPosRequestValueMapper.js'
import { PayFlexCPV4PosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/PayFlexCPV4PosRequestValueMapper.js'
import { PayFlexV4PosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/PayFlexV4PosRequestValueMapper.js'
import { GatewayClassNotConfiguredError } from '../../../src/errors.js'
import { PosQueryRequestMapperFactory } from '../../../src/factory/PosQueryRequestMapperFactory.js'
import { LANG } from '../../../src/PosInterface.js'

const crypt = {} as CryptInterface

const rows = [
  ['AssecoPos', AssecoPosQueryRequestDataMapper, AssecoPosRequestValueMapper, AssecoPosRequestValueFormatter],
  ['GarantiPos', GarantiPosQueryRequestDataMapper, GarantiPosRequestValueMapper, GarantiPosRequestValueFormatter],
  [
    'PayFlexCPV4Pos',
    PayFlexCPV4PosQueryRequestDataMapper,
    PayFlexCPV4PosRequestValueMapper,
    PayFlexCPV4PosRequestValueFormatter,
  ],
  [
    'PayFlexV4Pos',
    PayFlexV4PosQueryRequestDataMapper,
    PayFlexV4PosRequestValueMapper,
    PayFlexV4PosRequestValueFormatter,
  ],
] as const

describe('PosQueryRequestMapperFactory', () => {
  it.each(rows)('testCreateForGatewayReturnsCorrectMapper %s', (gatewayClass, expected, ValueMapper, Formatter) => {
    const mapper = PosQueryRequestMapperFactory.createForGateway(
      gatewayClass,
      new ValueMapper(),
      new Formatter(),
      crypt,
      LANG.TR,
    )
    expect(mapper).toBeInstanceOf(expected)
  })

  it('testCreateForGatewayThrowsForUnknownGateway', () => {
    // deviation: Q7 no plain errors; PosFactory uses the same error for an unknown class
    expect(() =>
      PosQueryRequestMapperFactory.createForGateway(
        'stdClass',
        new AssecoPosRequestValueMapper(),
        new AssecoPosRequestValueFormatter(),
        crypt,
        LANG.TR,
      ),
    ).toThrow(GatewayClassNotConfiguredError)
  })
})
