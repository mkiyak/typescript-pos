import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import { MissingAccountInfoError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { AssecoPosAccount } from '../../../src/model/account/AssecoPosAccount.js'
import { PayFlexPosAccount } from '../../../src/model/account/PayFlexPosAccount.js'
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
  })
})

describe('account credential leakage', () => {
  const accounts = [
    ['Asseco', () => AccountFactory.createAssecoPosAccount('akbank', 'mid', 'USER1', 'PW1', 'SK1')],
    ['PayFlex', () => AccountFactory.createPayFlexPosAccount('vakifbank', 'mid', 'PW1', 'TERM1')],
  ] as const

  it.each(accounts)('%s account hides secrets from JSON, masking and inspect', (_n, make) => {
    const a = make()
    const outputs = [JSON.stringify(a), JSON.stringify(maskSensitiveData(a)), inspect(a, { depth: 5 })]
    for (const out of outputs) {
      for (const secret of ['PW1', 'SK1', 'USER1', 'TERM1']) expect(out).not.toContain(secret)
    }
    expect(JSON.stringify(a)).toContain('mid')
  })
})
