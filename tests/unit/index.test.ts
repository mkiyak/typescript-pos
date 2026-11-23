import { describe, expect, it } from 'vitest'
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
        'PosHttpError',
        'PosFactory',
        'AccountFactory',
        'CreditCardFactory',
        'CreditCard',
        'AbstractGateway',
        'AssecoPos',
        'PayFlexV4Pos',
        'AssecoPosAccount',
        'PayFlexPosAccount',
        'posProductionConfig',
        'posTestConfig',
        'HttpTransport',
        'noopLogger',
        'maskSensitiveData',
        'VERSION',
      ]),
    )
  })

  it('PosFactory creates a gateway from the shipped test config', () => {
    const account = mod.AccountFactory.createPayFlexPosAccount('vakifbank', 'm', 'p', 't')
    expect(mod.PosFactory.createPosGateway(account, mod.posTestConfig)).toBeInstanceOf(mod.PayFlexV4Pos)
  })
})
