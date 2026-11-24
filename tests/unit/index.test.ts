import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  AbstractGatewayLike,
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
        'AssecoPosAccount',
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
        'AssecoPosQuery',
        'PayFlexV4PosQuery',
        'PayFlexCPV4PosQuery',
      ]),
    )
  })

  it('PosFactory creates a gateway from the shipped test config', () => {
    const account = mod.AccountFactory.createPayFlexPosAccount('vakifbank', 'm', 'p', 't')
    expect(mod.PosFactory.createPosGateway(account, mod.posTestConfig)).toBeInstanceOf(mod.PayFlexV4Pos)
  })

  it('PosFactory creates the common payment gateway from the shipped test config', () => {
    const account = mod.AccountFactory.createPayFlexPosAccount('vakifbank-cp', 'm', 'p', 't')
    expect(mod.PosFactory.createPosGateway(account, mod.posTestConfig)).toBeInstanceOf(mod.PayFlexCPV4Pos)
  })

  it('exports the types the public API refers to', () => {
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
