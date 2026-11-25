import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  AbstractGatewayLike,
  CardClass,
  CardExpiration,
  CryptInterface,
  EncodedData,
  GatewayConfig,
  GatewayDeps,
  PosHooks,
  PosQueryDeps,
  PosQueryRequestDataPreparedEvent,
  PosTestBank,
  QueryRequestDataMapperInterface,
  RecurringFrequency,
  RequestDataMapperInterface,
  RequestTxTypeMappings,
  RequestValueFormatterInterface,
  RequestValueMapperInterface,
  ResponseDataMapperInterface,
  ShippedPosConfig,
  SupportedTransactions,
} from '../../src/index.js'
import * as mod from '../../src/index.js'

describe('public index', () => {
  it('exports the documented runtime names', () => {
    expect(Object.keys(mod)).toEqual(
      expect.arrayContaining([
        'LANG',
        'TX_TYPE',
        'MODEL',
        'CURRENCY',
        'PAYMENT_STATUS',
        'FORM_FORMAT',
        'CARD_TYPE',
        'PosError',
        'HashMismatchError',
        'OrderMismatchError',
        'UnsupportedPaymentModelError',
        'UnsupportedTransactionTypeError',
        'UnsupportedFormFormatError',
        'MissingAccountInfoError',
        'CardTypeRequiredError',
        'CardTypeNotSupportedError',
        'GatewayClassNotConfiguredError',
        'NotImplementedError',
        'InvalidCardError',
        'PosHttpError',
        'PosFactory',
        'AccountFactory',
        'CreditCardFactory',
        'CreditCard',
        'AbstractGateway',
        'AssecoPos',
        'PayFlexV4Pos',
        'PayFlexCPV4Pos',
        'GarantiPos',
        'AkbankPos',
        'PosNetPos',
        'PosNetV1Pos',
        'PayForPos',
        'PayForPosAccount',
        'InterPos',
        'InterPosAccount',
        'KuveytPos',
        'VakifKatilimPos',
        'ToslaPos',
        'BoaPosAccount',
        'ToslaPosAccount',
        'CARD_FAMILY',
        'PosNetPosAccount',
        'AssecoPosAccount',
        'AkbankPosAccount',
        'GarantiPosAccount',
        'CARD_CLASS',
        'PayFlexPosAccount',
        'posProductionConfig',
        'posTestConfig',
        'HttpTransport',
        'noopLogger',
        'maskSensitiveData',
        'VERSION',
        'QUERY_TYPE',
        'PosQueryFactory',
        'AbstractPosQuery',
        'AbstractMappedPosQuery',
        'AkbankPosQuery',
        'AssecoPosQuery',
        'GarantiPosQuery',
        'InterPosQuery',
        'PayFlexV4PosQuery',
        'PayFlexCPV4PosQuery',
        'PayForPosQuery',
        'PosNetPosQuery',
        'PosNetV1PosQuery',
        'ToslaPosQuery',
        'VakifKatilimPosQuery',
      ]),
    )
  })

  // addition: T1 the card family names the installment queries report
  it('CARD_FAMILY holds the eight card programme names', () => {
    expect(mod.CARD_FAMILY).toStrictEqual({
      WORLD: 'world',
      AXESS: 'axess',
      CARDFINANS: 'cardfinans',
      PARAF: 'paraf',
      ADVANTAGE: 'advantage',
      BONUS: 'bonus',
      MAXIMUM: 'maximum',
      SAGLAMKART: 'saglamkart',
    })
  })

  it('PosFactory creates a gateway from the shipped test config', () => {
    const account = mod.AccountFactory.createPayFlexPosAccount('vakifbank', 'm', 'p', 't')
    expect(mod.PosFactory.createPosGateway(account, mod.posTestConfig)).toBeInstanceOf(mod.PayFlexV4Pos)
  })

  it('PosFactory creates the common payment gateway from the shipped test config', () => {
    const account = mod.AccountFactory.createPayFlexPosAccount('vakifbank-cp', 'm', 'p', 't')
    expect(mod.PosFactory.createPosGateway(account, mod.posTestConfig)).toBeInstanceOf(mod.PayFlexCPV4Pos)
  })

  it('PosFactory creates the Garanti gateway from the shipped test config', () => {
    const account = mod.AccountFactory.createGarantiPosAccount('garanti', 'm', 'u', 'p', 't')
    expect(mod.PosFactory.createPosGateway(account, mod.posTestConfig)).toBeInstanceOf(mod.GarantiPos)
    expect(account).toBeInstanceOf(mod.GarantiPosAccount)
  })

  // addition: both PosNet gateways are reachable from the public entry point
  it('PosFactory creates the PosNet gateways from the shipped test config', () => {
    const yapikredi = mod.AccountFactory.createPosNetPosAccount('yapikredi', 'm', 't', 'p', 'k')
    expect(mod.PosFactory.createPosGateway(yapikredi, mod.posTestConfig)).toBeInstanceOf(mod.PosNetPos)
    expect(yapikredi).toBeInstanceOf(mod.PosNetPosAccount)
    const albaraka = mod.AccountFactory.createPosNetPosAccount('albaraka', 'm', 't', 'p', 'k')
    expect(mod.PosFactory.createPosGateway(albaraka, mod.posTestConfig)).toBeInstanceOf(mod.PosNetV1Pos)
  })

  // addition: the PayFor gateway is reachable from the public entry point
  it('PosFactory creates the PayFor gateway from the shipped test config', () => {
    const account = mod.AccountFactory.createPayForPosAccount('qnbfinansbank-payfor', 'm', 'u', 'p', 'k')
    expect(mod.PosFactory.createPosGateway(account, mod.posTestConfig)).toBeInstanceOf(mod.PayForPos)
    expect(account).toBeInstanceOf(mod.PayForPosAccount)
  })

  // addition: the InterPos gateway is reachable from the public entry point
  it('PosFactory creates the InterPos gateway from the shipped test config', () => {
    const account = mod.AccountFactory.createInterPosAccount('denizbank', 's', 'u', 'p', 'k')
    expect(mod.PosFactory.createPosGateway(account, mod.posTestConfig)).toBeInstanceOf(mod.InterPos)
    expect(account).toBeInstanceOf(mod.InterPosAccount)
  })

  // addition: the KuveytPos gateway is reachable from the public entry point
  it('PosFactory creates the KuveytPos gateway from the shipped test config', () => {
    const account = mod.AccountFactory.createBoaPosAccount('kuveytpos', '496', 'apiuser1', '400235', 'Api123')
    expect(mod.PosFactory.createPosGateway(account, mod.posTestConfig)).toBeInstanceOf(mod.KuveytPos)
    expect(account).toBeInstanceOf(mod.BoaPosAccount)
  })

  // addition: the ToslaPos gateway is reachable from the public entry point
  it('PosFactory creates the ToslaPos gateway from the shipped test config', () => {
    const account = mod.AccountFactory.createToslaPosAccount('tosla', '1000000494', 'POS_ENT_Test_001', 'secret')
    expect(mod.PosFactory.createPosGateway(account, mod.posTestConfig)).toBeInstanceOf(mod.ToslaPos)
  })

  // addition: the VakifKatilimPos gateway is reachable from the public entry point
  it('PosFactory creates the VakifKatilimPos gateway from the shipped test config', () => {
    const account = mod.AccountFactory.createBoaPosAccount('vakif-katilim', '1', 'APIUSER', '11111', 'kdsnsksl')
    expect(mod.PosFactory.createPosGateway(account, mod.posTestConfig)).toBeInstanceOf(mod.VakifKatilimPos)
  })

  it('PosFactory creates the Akbank gateway from the shipped test config', () => {
    const account = mod.AccountFactory.createAkbankPosAccount('akbank-pos', 'm', 't', 'k')
    expect(mod.PosFactory.createPosGateway(account, mod.posTestConfig)).toBeInstanceOf(mod.AkbankPos)
    expect(account).toBeInstanceOf(mod.AkbankPosAccount)
  })

  it('exports the types the public API refers to', () => {
    expectTypeOf<CardClass>().toEqualTypeOf<'credit' | 'debit' | 'prepaid'>()
    const expiration: CardExpiration = { year: 2030, month: 12 }
    expect(new mod.CreditCard('4111111111111111', expiration, '123').getExpireMonth()).toBe('12')
    expectTypeOf<GatewayDeps['crypt']>().toEqualTypeOf<CryptInterface>()
    expectTypeOf<GatewayDeps['requestDataMapper']>().toEqualTypeOf<RequestDataMapperInterface>()
    expectTypeOf<GatewayDeps['responseDataMapper']>().toEqualTypeOf<ResponseDataMapperInterface>()
    expectTypeOf<GatewayDeps['requestValueMapper']>().toEqualTypeOf<RequestValueMapperInterface>()
    expectTypeOf<GatewayDeps['requestValueFormatter']>().toEqualTypeOf<RequestValueFormatterInterface>()
    expectTypeOf<SupportedTransactions>().toMatchTypeOf<object>()
    expectTypeOf<RecurringFrequency>().toEqualTypeOf<'DAY' | 'WEEK' | 'MONTH' | 'YEAR'>()
    expectTypeOf<RequestTxTypeMappings>().toMatchTypeOf<object>()
    expectTypeOf<EncodedData['format']>().toEqualTypeOf<'xml' | 'form' | 'json'>()
    expectTypeOf<typeof mod.posTestConfig>().toEqualTypeOf<ShippedPosConfig<PosTestBank>>()
    expectTypeOf<typeof mod.posTestConfig.banks.asseco>().toMatchTypeOf<GatewayConfig>()
    const gatewayLike: AbstractGatewayLike = mod.PosFactory.createPosGateway(
      mod.AccountFactory.createAssecoPosAccount('asseco', 'c', 'u', 'p', 'k'),
      mod.posTestConfig,
    )
    expect(gatewayLike.getCardTypeMapping()).toBeTypeOf('object')
  })

  it('PosQueryFactory creates queries from the shipped test config', () => {
    const cp = mod.AccountFactory.createPayFlexPosAccount('vakifbank-cp', 'm', 'p', 't')
    expect(mod.PosQueryFactory.createPosQuery(cp, mod.posTestConfig)).toBeInstanceOf(mod.PayFlexCPV4PosQuery)
    const asseco = mod.AccountFactory.createAssecoPosAccount('asseco', 'c', 'u', 'p', 'k')
    expect(mod.PosQueryFactory.createPosQuery(asseco, mod.posTestConfig)).toBeInstanceOf(mod.AssecoPosQuery)
    const garanti = mod.AccountFactory.createGarantiPosAccount('garanti', 'm', 'u', 'p', 't')
    expect(mod.PosQueryFactory.createPosQuery(garanti, mod.posTestConfig)).toBeInstanceOf(mod.GarantiPosQuery)
    const akbank = mod.AccountFactory.createAkbankPosAccount('akbank-pos', 'm', 't', 'k')
    expect(mod.PosQueryFactory.createPosQuery(akbank, mod.posTestConfig)).toBeInstanceOf(mod.AkbankPosQuery)
    const yapikredi = mod.AccountFactory.createPosNetPosAccount('yapikredi', 'm', 't', 'p', 'k')
    expect(mod.PosQueryFactory.createPosQuery(yapikredi, mod.posTestConfig)).toBeInstanceOf(mod.PosNetPosQuery)
    const albaraka = mod.AccountFactory.createPosNetPosAccount('albaraka', 'm', 't', 'p', 'k')
    expect(mod.PosQueryFactory.createPosQuery(albaraka, mod.posTestConfig)).toBeInstanceOf(mod.PosNetV1PosQuery)
    const payfor = mod.AccountFactory.createPayForPosAccount('qnbfinansbank-payfor', 'm', 'u', 'p', 'k')
    expect(mod.PosQueryFactory.createPosQuery(payfor, mod.posTestConfig)).toBeInstanceOf(mod.PayForPosQuery)
    const inter = mod.AccountFactory.createInterPosAccount('denizbank', 's', 'u', 'p', 'k')
    expect(mod.PosQueryFactory.createPosQuery(inter, mod.posTestConfig)).toBeInstanceOf(mod.InterPosQuery)
    const tosla = mod.AccountFactory.createToslaPosAccount('tosla', '1000000494', 'POS_ENT_Test_001', 'k')
    expect(mod.PosQueryFactory.createPosQuery(tosla, mod.posTestConfig)).toBeInstanceOf(mod.ToslaPosQuery)
    const vakifKatilim = mod.AccountFactory.createBoaPosAccount('vakif-katilim', '1', 'u', 'c', 'k')
    expect(mod.PosQueryFactory.createPosQuery(vakifKatilim, mod.posTestConfig)).toBeInstanceOf(mod.VakifKatilimPosQuery)
  })

  it('exports the query types', () => {
    expectTypeOf<PosQueryDeps['requestDataMapper']>().toEqualTypeOf<QueryRequestDataMapperInterface>()
    expectTypeOf<NonNullable<PosHooks['onPosQueryRequestDataPrepared']>[number]>()
      .parameter(0)
      .toEqualTypeOf<PosQueryRequestDataPreparedEvent>()
  })

  it('keeps gateway orderHistory and query history apart', () => {
    expect('history' in mod.AbstractGateway.prototype).toBe(false)
    expect('orderHistory' in mod.AbstractPosQuery.prototype).toBe(false)
    expect('orderHistory' in mod.AbstractGateway.prototype).toBe(true)
  })
})
