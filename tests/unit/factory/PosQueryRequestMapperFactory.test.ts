import { describe, expect, it } from 'vitest'
import type { CryptInterface } from '../../../src/crypt/CryptInterface.js'
import { AkbankPosQueryRequestDataMapper } from '../../../src/data-mapper/pos-query/request/AkbankPosQueryRequestDataMapper.js'
import { AssecoPosQueryRequestDataMapper } from '../../../src/data-mapper/pos-query/request/AssecoPosQueryRequestDataMapper.js'
import { GarantiPosQueryRequestDataMapper } from '../../../src/data-mapper/pos-query/request/GarantiPosQueryRequestDataMapper.js'
import { InterPosQueryRequestDataMapper } from '../../../src/data-mapper/pos-query/request/InterPosQueryRequestDataMapper.js'
import { PayFlexCPV4PosQueryRequestDataMapper } from '../../../src/data-mapper/pos-query/request/PayFlexCPV4PosQueryRequestDataMapper.js'
import { PayFlexV4PosQueryRequestDataMapper } from '../../../src/data-mapper/pos-query/request/PayFlexV4PosQueryRequestDataMapper.js'
import { PayForPosQueryRequestDataMapper } from '../../../src/data-mapper/pos-query/request/PayForPosQueryRequestDataMapper.js'
import { PosNetPosQueryRequestDataMapper } from '../../../src/data-mapper/pos-query/request/PosNetPosQueryRequestDataMapper.js'
import { PosNetV1PosQueryRequestDataMapper } from '../../../src/data-mapper/pos-query/request/PosNetV1PosQueryRequestDataMapper.js'
import { ToslaPosQueryRequestDataMapper } from '../../../src/data-mapper/pos-query/request/ToslaPosQueryRequestDataMapper.js'
import { VakifKatilimPosQueryRequestDataMapper } from '../../../src/data-mapper/pos-query/request/VakifKatilimPosQueryRequestDataMapper.js'
import { AkbankPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/AkbankPosRequestValueFormatter.js'
import { AssecoPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/AssecoPosRequestValueFormatter.js'
import { GarantiPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/GarantiPosRequestValueFormatter.js'
import { InterPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/InterPosRequestValueFormatter.js'
import { PayFlexCPV4PosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/PayFlexCPV4PosRequestValueFormatter.js'
import { PayFlexV4PosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/PayFlexV4PosRequestValueFormatter.js'
import { PayForPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/PayForPosRequestValueFormatter.js'
import { PosNetPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/PosNetPosRequestValueFormatter.js'
import { PosNetV1PosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/PosNetV1PosRequestValueFormatter.js'
import { ToslaPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/ToslaPosRequestValueFormatter.js'
import { VakifKatilimPosRequestValueFormatter } from '../../../src/data-mapper/request/value-formatter/VakifKatilimPosRequestValueFormatter.js'
import { AkbankPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/AkbankPosRequestValueMapper.js'
import { AssecoPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/AssecoPosRequestValueMapper.js'
import { GarantiPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/GarantiPosRequestValueMapper.js'
import { InterPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/InterPosRequestValueMapper.js'
import { PayFlexCPV4PosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/PayFlexCPV4PosRequestValueMapper.js'
import { PayFlexV4PosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/PayFlexV4PosRequestValueMapper.js'
import { PayForPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/PayForPosRequestValueMapper.js'
import { PosNetPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/PosNetPosRequestValueMapper.js'
import { PosNetV1PosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/PosNetV1PosRequestValueMapper.js'
import { ToslaPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/ToslaPosRequestValueMapper.js'
import { VakifKatilimPosRequestValueMapper } from '../../../src/data-mapper/request/value-mapper/VakifKatilimPosRequestValueMapper.js'
import { GatewayClassNotConfiguredError } from '../../../src/errors.js'
import { PosQueryRequestMapperFactory } from '../../../src/factory/PosQueryRequestMapperFactory.js'
import { LANG } from '../../../src/PosInterface.js'

const crypt = {} as CryptInterface

const rows = [
  ['AkbankPos', AkbankPosQueryRequestDataMapper, AkbankPosRequestValueMapper, AkbankPosRequestValueFormatter],
  ['AssecoPos', AssecoPosQueryRequestDataMapper, AssecoPosRequestValueMapper, AssecoPosRequestValueFormatter],
  ['GarantiPos', GarantiPosQueryRequestDataMapper, GarantiPosRequestValueMapper, GarantiPosRequestValueFormatter],
  ['InterPos', InterPosQueryRequestDataMapper, InterPosRequestValueMapper, InterPosRequestValueFormatter],
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
  ['PayForPos', PayForPosQueryRequestDataMapper, PayForPosRequestValueMapper, PayForPosRequestValueFormatter],
  ['PosNetPos', PosNetPosQueryRequestDataMapper, PosNetPosRequestValueMapper, PosNetPosRequestValueFormatter],
  ['PosNetV1Pos', PosNetV1PosQueryRequestDataMapper, PosNetV1PosRequestValueMapper, PosNetV1PosRequestValueFormatter],
  ['ToslaPos', ToslaPosQueryRequestDataMapper, ToslaPosRequestValueMapper, ToslaPosRequestValueFormatter],
  [
    'VakifKatilimPos',
    VakifKatilimPosQueryRequestDataMapper,
    VakifKatilimPosRequestValueMapper,
    VakifKatilimPosRequestValueFormatter,
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
