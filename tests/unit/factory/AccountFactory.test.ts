import { inspect } from 'node:util'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { MissingAccountInfoError, type OrderMismatchField, PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import { AkbankPosAccount } from '../../../src/model/account/AkbankPosAccount.js'
import { AssecoPosAccount } from '../../../src/model/account/AssecoPosAccount.js'
import { BoaPosAccount } from '../../../src/model/account/BoaPosAccount.js'
import { GarantiPosAccount } from '../../../src/model/account/GarantiPosAccount.js'
import { InterPosAccount } from '../../../src/model/account/InterPosAccount.js'
import { ParamPosAccount } from '../../../src/model/account/ParamPosAccount.js'
import { PayFlexPosAccount } from '../../../src/model/account/PayFlexPosAccount.js'
import { PayForPosAccount } from '../../../src/model/account/PayForPosAccount.js'
import { PosNetPosAccount } from '../../../src/model/account/PosNetPosAccount.js'
import { ToslaPosAccount } from '../../../src/model/account/ToslaPosAccount.js'
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

  it('createAkbankPosAccount with sub merchant', () => {
    const a = AccountFactory.createAkbankPosAccount('akbank-pos', '1', 'APIUSER', 'kdsnsksl', 'SUB1')
    expect(a).toBeInstanceOf(AkbankPosAccount)
    expect(a.getBankName()).toBe('akbank-pos')
    expect(a.getMerchantId()).toBe('1')
    expect(a.getTerminalId()).toBe('APIUSER')
    expect(a.getSecretKey()).toBe('kdsnsksl')
    expect(a.getSubMerchantId()).toBe('SUB1')
  })

  it('createAkbankPosAccount without sub merchant', () => {
    const a = AccountFactory.createAkbankPosAccount('akbank-pos', '1', 'APIUSER', 'kdsnsksl')
    expect(a.getSubMerchantId()).toBeNull()
  })

  // addition: empty or blank credentials are missing, not signed as empty strings
  it.each([
    ['merchant', ['', 'T', 'S']],
    ['merchant', ['  ', 'T', 'S']],
    ['terminal', ['M', '', 'S']],
    ['terminal', ['M', '  ', 'S']],
    ['secret', ['M', 'T', '']],
    ['secret', ['M', 'T', '  ']],
  ] as const)('createAkbankPosAccount rejects a blank %s', (_n, [m, t, s]) => {
    expect(() => AccountFactory.createAkbankPosAccount('akbank-pos', m, t, s)).toThrow(MissingAccountInfoError)
  })

  // addition: a blank sub merchant id is no sub merchant
  it.each(['', '  '])('createAkbankPosAccount maps sub merchant %j to null', (sub) => {
    expect(AccountFactory.createAkbankPosAccount('akbank-pos', 'M', 'T', 'S', sub).getSubMerchantId()).toBeNull()
  })
})

describe('AccountFactory PosNet', () => {
  it('createPosNetPosAccount non-secure', () => {
    const a = AccountFactory.createPosNetPosAccount('yapikredi', '6706598320', '67005551', '27426457')
    expect(a).toBeInstanceOf(PosNetPosAccount)
    expect(a.getBankName()).toBe('yapikredi')
    expect(a.getMerchantId()).toBe('6706598320')
    expect(a.getPosNetId()).toBe('27426457')
    expect(a.getTerminalId()).toBe('67005551')
    // addition: no secret key is a typed error
    expect(() => a.getSecretKey()).toThrow(MissingAccountInfoError)
  })

  it('createPosNetPosAccount 3D secure', () => {
    const key = '10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10'
    const a = AccountFactory.createPosNetPosAccount('yapikredi', '6706598320', '67005551', '27426457', key)
    expect(a.getMerchantId()).toBe('6706598320')
    expect(a.getPosNetId()).toBe('27426457')
    expect(a.getTerminalId()).toBe('67005551')
    expect(a.getSecretKey()).toBe(key)
  })

  // addition: blank credentials are rejected
  it.each([
    ['merchant', ['', '67005551', '27426457']],
    ['merchant', ['  ', '67005551', '27426457']],
    ['terminal', ['6706598320', '', '27426457']],
    ['terminal', ['6706598320', '  ', '27426457']],
    ['posNetId', ['6706598320', '67005551', '']],
    ['posNetId', ['6706598320', '67005551', '  ']],
  ] as const)('rejects blank %s', (_n, [m, t, p]) => {
    expect(() => AccountFactory.createPosNetPosAccount('yapikredi', m, t, p)).toThrow(MissingAccountInfoError)
  })

  it.each(['', '  '])('rejects blank secret %j', (secret) => {
    expect(() => AccountFactory.createPosNetPosAccount('yapikredi', 'M', 'T', 'P', secret)).toThrow(
      MissingAccountInfoError,
    )
  })
})

describe('AccountFactory PayFor', () => {
  it('testCreatePayForPosAccount', () => {
    const a = AccountFactory.createPayForPosAccount(
      'qnbfinansbank-payfor',
      '085300000009704',
      'QNB_API_KULLANICI_3DPAY',
      'UcBN0',
      '12345678',
      PayForPosAccount.MBR_ID_ZIRAAT_KATILIM,
    )
    expect(a).toBeInstanceOf(PayForPosAccount)
    expect(a.getBankName()).toBe('qnbfinansbank-payfor')
    expect(a.getMerchantId()).toBe('085300000009704')
    expect(a.getUsername()).toBe('QNB_API_KULLANICI_3DPAY')
    expect(a.getPassword()).toBe('UcBN0')
    expect(a.getSecretKey()).toBe('12345678')
    expect(a.getMbrId()).toBe('12')
  })

  it('testCreatePayForPosAccountNonSecure', () => {
    const a = AccountFactory.createPayForPosAccount(
      'qnbfinansbank-payfor',
      '085300000009704',
      'QNB_API_KULLANICI',
      'UcBN0',
    )
    expect(a.getMerchantId()).toBe('085300000009704')
    expect(a.getUsername()).toBe('QNB_API_KULLANICI')
    expect(a.getMbrId()).toBe(PayForPosAccount.MBR_ID_FINANSBANK)
    expect(PayForPosAccount.MBR_ID_FINANSBANK).toBe('5')
    // addition: F1 (no merchant pass means 3D is unavailable)
    expect(() => a.getSecretKey()).toThrow(MissingAccountInfoError)
  })

  // addition: F1
  it.each([
    ['merchantId', ['', 'u', 'p']],
    ['merchantId', ['  ', 'u', 'p']],
    ['userCode', ['m', '', 'p']],
    ['userCode', ['m', '  ', 'p']],
    ['userPassword', ['m', 'u', '']],
    ['userPassword', ['m', 'u', '  ']],
  ] as const)('rejects a blank %s', (_n, [m, u, p]) => {
    expect(() => AccountFactory.createPayForPosAccount('qnbfinansbank-payfor', m, u, p)).toThrow(
      MissingAccountInfoError,
    )
  })

  // addition: F1
  it.each(['', ' '])('rejects a blank merchantPass %j', (pass) => {
    expect(() => AccountFactory.createPayForPosAccount('qnbfinansbank-payfor', 'm', 'u', 'p', pass)).toThrow(
      MissingAccountInfoError,
    )
  })

  // addition: F1 the institution code has one to four digits
  it.each(['1', '12', '123', '1234'])('accepts the mbrId %j', (mbrId) => {
    expect(AccountFactory.createPayForPosAccount('qnbfinansbank-payfor', 'm', 'u', 'p', null, mbrId).getMbrId()).toBe(
      mbrId,
    )
  })

  // addition: F1
  it.each(['', '5a', '12345', ' 12', '١٢', '05', '0005', '0'])('rejects an invalid mbrId %j', (mbrId) => {
    expect(() => AccountFactory.createPayForPosAccount('qnbfinansbank-payfor', 'm', 'u', 'p', null, mbrId)).toThrow(
      MissingAccountInfoError,
    )
  })
})

describe('AccountFactory InterPos', () => {
  it('testCreateInterPosAccountNonSecure', () => {
    const a = AccountFactory.createInterPosAccount('denizbank', 'shop-code', 'user-code', 'user-pass')
    expect(a).toBeInstanceOf(InterPosAccount)
    expect(a.getBankName()).toBe('denizbank')
    expect(a.getMerchantId()).toBe('shop-code')
    expect(a.getUsername()).toBe('user-code')
    expect(a.getPassword()).toBe('user-pass')
    // addition: F1 (no merchant pass means 3D is unavailable)
    expect(() => a.getSecretKey()).toThrow(MissingAccountInfoError)
  })

  it('testCreateInterPosAccount3DSecure', () => {
    const a = AccountFactory.createInterPosAccount('denizbank', 'shop-code', 'user-code', 'user-pass', 'merchant-pass')
    expect(a).toBeInstanceOf(InterPosAccount)
    expect(a.getBankName()).toBe('denizbank')
    expect(a.getMerchantId()).toBe('shop-code')
    expect(a.getUsername()).toBe('user-code')
    expect(a.getPassword()).toBe('user-pass')
    expect(a.getSecretKey()).toBe('merchant-pass')
  })

  // addition: F1
  it.each([
    ['shopCode', ['', 'u', 'p']],
    ['shopCode', ['  ', 'u', 'p']],
    ['userCode', ['s', '', 'p']],
    ['userCode', ['s', '  ', 'p']],
    ['userPass', ['s', 'u', '']],
    ['userPass', ['s', 'u', '  ']],
  ] as const)('rejects a blank %s', (_n, [s, u, p]) => {
    expect(() => AccountFactory.createInterPosAccount('denizbank', s, u, p)).toThrow(MissingAccountInfoError)
  })

  // addition: F1
  it.each(['', ' '])('rejects a blank merchantPass %j', (pass) => {
    expect(() => AccountFactory.createInterPosAccount('denizbank', 's', 'u', 'p', pass)).toThrow(
      MissingAccountInfoError,
    )
  })
})

describe('AccountFactory BOA account', () => {
  it('createBoaPosAccount', () => {
    const a = AccountFactory.createBoaPosAccount('vakif-katilim', '1', 'APIUSER', '11111', 'kdsnsksl', 'SUB1')
    expect(a).toBeInstanceOf(BoaPosAccount)
    expect(a.getBankName()).toBe('vakif-katilim')
    expect(a.getMerchantId()).toBe('1')
    expect(a.getUsername()).toBe('APIUSER')
    expect(a.getCustomerId()).toBe('11111')
    expect(a.getSecretKey()).toBe('kdsnsksl')
    expect(a.getSubMerchantId()).toBe('SUB1')
  })

  it('createBoaPosAccount without sub merchant id', () => {
    const a = AccountFactory.createBoaPosAccount('vakif-katilim', '1', 'APIUSER', '11111', 'kdsnsksl')
    expect(a.getSubMerchantId()).toBeNull()
  })

  // addition: B1 an empty or blank credential is missing, never signed or sent
  it.each([
    ['merchantId', ['', 'u', 'c', 's']],
    ['merchantId', [' ', 'u', 'c', 's']],
    ['username', ['m', '', 'c', 's']],
    ['username', ['m', '  ', 'c', 's']],
    ['customerId', ['m', 'u', '', 's']],
    ['customerId', ['m', 'u', ' ', 's']],
    ['secretKey', ['m', 'u', 'c', '']],
    ['secretKey', ['m', 'u', 'c', '\t']],
  ] as const)('blank %s is rejected (%j)', (_name, [m, u, c, s]) => {
    expect(() => AccountFactory.createBoaPosAccount('kuveytpos', m, u, c, s)).toThrow(MissingAccountInfoError)
  })

  // addition: B1
  it.each([[''], [' ']])('a blank sub merchant id %j is rejected', (sub) => {
    expect(() => AccountFactory.createBoaPosAccount('kuveytpos', 'm', 'u', 'c', 's', sub)).toThrow(
      MissingAccountInfoError,
    )
  })

  // addition: B1 a non-string credential is missing too
  it('a non-string credential is rejected', () => {
    const make = AccountFactory.createBoaPosAccount as unknown as (...a: unknown[]) => unknown
    expect(() => make('kuveytpos', 80, 'u', 'c', 's')).toThrow(MissingAccountInfoError)
    expect(() => make('kuveytpos', 'm', 'u', 'c', null)).toThrow(MissingAccountInfoError)
    expect(() => make('kuveytpos', 'm', 'u', undefined, 's')).toThrow(MissingAccountInfoError)
  })

  // addition: B1 the account has no separate password
  it('getPassword is empty', () => {
    expect(AccountFactory.createBoaPosAccount('kuveytpos', 'm', 'u', 'c', 's').getPassword()).toBe('')
  })
})

describe('AccountFactory Tosla', () => {
  it('testCreateToslaPosAccount', () => {
    const a = AccountFactory.createToslaPosAccount('tosla', 'merchant-id', 'api-user', 'api-pass')
    expect(a).toBeInstanceOf(ToslaPosAccount)
    expect(a.getBankName()).toBe('tosla')
    expect(a.getMerchantId()).toBe('merchant-id')
    expect(a.getUsername()).toBe('api-user')
    expect(a.getSecretKey()).toBe('api-pass')
    // addition: T1 there is no account password
    expect(a.getPassword()).toBe('')
  })

  // addition: T1
  it.each([
    ['clientId', ['', 'u', 'p']],
    ['clientId', ['  ', 'u', 'p']],
    ['apiUser', ['c', '', 'p']],
    ['apiUser', ['c', ' \t', 'p']],
    ['apiPass', ['c', 'u', '']],
    ['apiPass', ['c', 'u', '   ']],
  ] as const)('rejects a blank %s', (_n, [c, u, p]) => {
    expect(() => AccountFactory.createToslaPosAccount('tosla', c, u, p)).toThrow(MissingAccountInfoError)
  })

  // addition: T1
  it.each([null, undefined, 5, {}, ['x']])('rejects a non-string value %j', (value) => {
    const make = AccountFactory.createToslaPosAccount as unknown as (...a: unknown[]) => unknown
    expect(() => make('tosla', value, 'u', 'p')).toThrow(MissingAccountInfoError)
    expect(() => make('tosla', 'c', value, 'p')).toThrow(MissingAccountInfoError)
    expect(() => make('tosla', 'c', 'u', value)).toThrow(MissingAccountInfoError)
  })
})

describe('AccountFactory Param', () => {
  it('testCreateParamPosAccount', () => {
    const a = AccountFactory.createParamPosAccount('param-pos', '12345', 'APIUSER', 'kdsnsksl', 'guid123')
    expect(a).toBeInstanceOf(ParamPosAccount)
    expect(a.getBankName()).toBe('param-pos')
    expect(a.getMerchantId()).toBe('12345')
    expect(a.getUsername()).toBe('APIUSER')
    expect(a.getPassword()).toBe('kdsnsksl')
    expect(a.getSecretKey()).toBe('guid123')
    expect(a.getSubMerchantId()).toBeNull()
  })

  it('testCreateParamPosAccountWithTerminalId', () => {
    const a = AccountFactory.createParamPosAccount('param-pos', '12345', 'APIUSER', 'kdsnsksl', 'guid123', '99001')
    expect(a.getTerminalId()).toBe('99001')
    expect(a.getMerchantId()).toBe('12345')
  })

  // addition: C2 a blank or non-string value is never signed or sent
  it.each([
    ['clientCode', 0],
    ['username', 1],
    ['password', 2],
    ['guid', 3],
  ])('rejects a blank, whitespace or non-string %s', (_name, index) => {
    const make = AccountFactory.createParamPosAccount as unknown as (...a: unknown[]) => unknown
    for (const bad of ['', '   ', '\t', null, undefined, 5, {}, ['x']]) {
      const args: unknown[] = ['12345', 'APIUSER', 'kdsnsksl', 'guid123']
      args[index as number] = bad
      expect(() => make('param-pos', ...args), `${String(bad)}`).toThrow(MissingAccountInfoError)
    }
  })

  // addition: C2
  it.each(['', '  ', 5, {}])('rejects a blank or non-string terminal id %j', (bad) => {
    const make = AccountFactory.createParamPosAccount as unknown as (...a: unknown[]) => unknown
    expect(() => make('param-pos', '12345', 'APIUSER', 'kdsnsksl', 'guid123', bad)).toThrow(MissingAccountInfoError)
  })

  // addition: C2 no terminal id means getTerminalId() throws
  it('has no terminal id unless one is given', () => {
    const a = AccountFactory.createParamPosAccount('param-pos', '12345', 'APIUSER', 'kdsnsksl', 'guid123')
    expect(() => a.getTerminalId()).toThrow(MissingAccountInfoError)
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
    ['Akbank', () => AccountFactory.createAkbankPosAccount('akbank-pos', 'mid', 'APIUSER', 'kdsnsksl', 'SUB1')],
    ['PosNet', () => AccountFactory.createPosNetPosAccount('yapikredi', 'mid', 'TERM1', '27426457', 'SK1')],
    // addition: F1
    [
      'PayFor',
      () => AccountFactory.createPayForPosAccount('qnbfinansbank-payfor', 'mid', 'USER1', 'UcBN0', '12345678'),
    ],
    // addition: F1
    ['InterPos', () => AccountFactory.createInterPosAccount('denizbank', 'mid', 'USER1', 'user-pass', 'merchant-pass')],
    // addition: B1
    ['BOA', () => AccountFactory.createBoaPosAccount('vakif-katilim', 'mid', 'APIUSER', '11111', 'kdsnsksl', 'SUB1')],
    // addition: T1
    ['Tosla', () => AccountFactory.createToslaPosAccount('tosla', 'mid', 'api-user', 'api-pass')],
    // addition: C2
    [
      'Param',
      () => AccountFactory.createParamPosAccount('param-pos', 'mid', 'APIUSER', 'kdsnsksl', 'guid123', '99001'),
    ],
  ] as const

  it.each(accounts)('%s account hides secrets from JSON, masking and inspect', (_n, make) => {
    const a = make()
    const outputs = [JSON.stringify(a), JSON.stringify(maskSensitiveData(a)), inspect(a, { depth: 5 })]
    for (const out of outputs) {
      for (const secret of [
        'PW1',
        'SK1',
        'USER1',
        'TERM1',
        'PROVRFN',
        'refund-pass',
        'kdsnsksl',
        'APIUSER',
        '27426457',
        'UcBN0',
        '12345678',
        'user-pass',
        'merchant-pass',
        '11111',
        'SUB1',
        'api-user',
        'api-pass',
        'guid123',
        '99001',
      ])
        expect(out).not.toContain(secret)
    }
    expect(JSON.stringify(a)).toContain('mid')
  })
})
