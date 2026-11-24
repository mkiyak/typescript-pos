import { inspect } from 'node:util'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { MissingAccountInfoError, type OrderMismatchField, PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { AssecoPosAccount } from '../../../src/model/account/AssecoPosAccount.js'
import { GarantiPosAccount } from '../../../src/model/account/GarantiPosAccount.js'
import { PayFlexPosAccount } from '../../../src/model/account/PayFlexPosAccount.js'
import { CARD_CLASS } from '../../../src/PosInterface.js'
import { maskSensitiveData } from '../../../src/util/maskSensitiveData.js'

describe('AccountFactory', () => {
  it('createAssecoPosAccount non-secure', () => {
    const a = AccountFactory.createAssecoPosAccount('akbank', 'merchant-id', 'user', 'pass')
    expect(a).toBeInstanceOf(AssecoPosAccount)
    expect(a.getBankName()).toBe('akbank')
    expect(a.getMerchantId()).toBe('merchant-id')
    expect(a.getUsername()).toBe('user')
    expect(a.getPassword()).toBe('pass')
    expect(() => a.getSecretKey()).toThrow('secretKey is not set')
    expect(() => a.getSecretKey()).toThrow(MissingAccountInfoError)
    expect(() => a.getSecretKey()).toThrow(PosError)
  })

  it('createAssecoPosAccount 3D secure', () => {
    const a = AccountFactory.createAssecoPosAccount('akbank', 'merchant-id', 'user', 'pass', 'store-key')
    expect(a.getSecretKey()).toBe('store-key')
  })

  it('createPayFlexPosAccount standard', () => {
    const a = AccountFactory.createPayFlexPosAccount('vakifbank', 'merchant-id', 'password', 'dVB007000000000')
    expect(a).toBeInstanceOf(PayFlexPosAccount)
    expect(a.getBankName()).toBe('vakifbank')
    expect(a.getMerchantId()).toBe('merchant-id')
    expect(a.getPassword()).toBe('password')
    expect(a.getTerminalId()).toBe('dVB007000000000')
    expect(a.getMerchantType()).toBe(PayFlexPosAccount.MERCHANT_TYPE_STANDARD)
    expect(a.isSubBranch()).toBe(false)
    expect(a.getSubMerchantId()).toBeNull()
  })

  it('createPayFlexPosAccount main dealer', () => {
    const a = AccountFactory.createPayFlexPosAccount(
      'vakifbank',
      'merchant-id',
      'password',
      'dVB007000000000',
      PayFlexPosAccount.MERCHANT_TYPE_MAIN_DEALER,
    )
    expect(a.getMerchantType()).toBe(PayFlexPosAccount.MERCHANT_TYPE_MAIN_DEALER)
    expect(a.isSubBranch()).toBe(false)
  })

  it('createPayFlexPosAccount sub dealer', () => {
    const a = AccountFactory.createPayFlexPosAccount(
      'vakifbank',
      'merchant-id',
      'password',
      'dVB007000000000',
      PayFlexPosAccount.MERCHANT_TYPE_SUB_DEALER,
      'sub-merchant-1',
    )
    expect(a.getMerchantType()).toBe(PayFlexPosAccount.MERCHANT_TYPE_SUB_DEALER)
    expect(a.isSubBranch()).toBe(true)
    expect(a.getSubMerchantId()).toBe('sub-merchant-1')
  })

  it('sub dealer without subMerchantId throws', () => {
    expect(() =>
      AccountFactory.createPayFlexPosAccount('vakifbank', 'm', 'p', 't', PayFlexPosAccount.MERCHANT_TYPE_SUB_DEALER),
    ).toThrow(new MissingAccountInfoError('SubMerchantId is required for sub branches!'))
  })

  it('invalid merchant type throws', () => {
    expect(() => AccountFactory.createPayFlexPosAccount('vakifbank', 'm', 'p', 't', 999)).toThrow(
      new MissingAccountInfoError('Invalid MerchantType!'),
    )
  })

  it('PayFlexPosAccount.getMerchantTypes lists all types', () => {
    expect(PayFlexPosAccount.getMerchantTypes()).toEqual([0, 1, 2])
  })

  it('getTerminalId on Asseco account without terminal throws', () => {
    const a = AccountFactory.createAssecoPosAccount('b', 'm', 'u', 'p')
    expect(() => a.getTerminalId()).toThrow('terminalId is not set')
    expect(() => a.getTerminalId()).toThrow(MissingAccountInfoError)
  })
})

describe('createGarantiPosAccount', () => {
  it('non-secure', () => {
    const a = AccountFactory.createGarantiPosAccount('garanti', '7000679', 'PROVAUT', 'pass', '30691298')
    expect(a).toBeInstanceOf(GarantiPosAccount)
    expect(a.getBankName()).toBe('garanti')
    expect(a.getMerchantId()).toBe('7000679')
    expect(a.getUsername()).toBe('PROVAUT')
    expect(a.getPassword()).toBe('pass')
    expect(a.getTerminalId()).toBe('30691298')
    expect(a.getRefundUsername()).toBeNull()
    expect(a.getRefundPassword()).toBeNull()
    // addition: the store key is optional and throws when read unset
    expect(() => a.getSecretKey()).toThrow(MissingAccountInfoError)
  })

  it('3D secure with refund credentials', () => {
    const a = AccountFactory.createGarantiPosAccount(
      'garanti',
      '7000679',
      'PROVAUT',
      'pass',
      '30691298',
      'store-key',
      'PROVRFN',
      'refund-pass',
    )
    expect(a.getSecretKey()).toBe('store-key')
    expect(a.getRefundUsername()).toBe('PROVRFN')
    expect(a.getRefundPassword()).toBe('refund-pass')
  })

  // addition: type-level contract of the core extensions
  it('widens OrderMismatchField and exposes CARD_CLASS', () => {
    expectTypeOf<'payment_model'>().toExtend<OrderMismatchField>()
    expectTypeOf<'terminal_id'>().toExtend<OrderMismatchField>()
    expect(CARD_CLASS.PREPAID).toBe('prepaid')
    expect(CARD_CLASS.CREDIT).toBe('credit')
    expect(CARD_CLASS.DEBIT).toBe('debit')
  })
})

describe('account credential leakage', () => {
  const accounts = [
    ['Asseco', () => AccountFactory.createAssecoPosAccount('akbank', 'mid', 'USER1', 'PW1', 'SK1')],
    ['PayFlex', () => AccountFactory.createPayFlexPosAccount('vakifbank', 'mid', 'PW1', 'TERM1')],
    [
      'Garanti',
      () =>
        AccountFactory.createGarantiPosAccount(
          'garanti',
          'mid',
          'USER1',
          'PW1',
          'TERM1',
          'SK1',
          'PROVRFN',
          'refund-pass',
        ),
    ],
  ] as const

  it.each(accounts)('%s account hides secrets from JSON, masking and inspect', (_n, make) => {
    const a = make()
    const outputs = [JSON.stringify(a), JSON.stringify(maskSensitiveData(a)), inspect(a, { depth: 5 })]
    for (const out of outputs) {
      for (const secret of ['PW1', 'SK1', 'USER1', 'TERM1', 'PROVRFN', 'refund-pass']) expect(out).not.toContain(secret)
    }
    expect(JSON.stringify(a)).toContain('mid')
  })
})
