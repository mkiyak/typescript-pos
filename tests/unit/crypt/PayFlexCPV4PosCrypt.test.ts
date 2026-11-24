import { beforeEach, describe, expect, it } from 'vitest'
import { PayFlexCPV4PosCrypt } from '../../../src/crypt/PayFlexCPV4PosCrypt.js'
import { NotImplementedError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'

const account = AccountFactory.createPayFlexPosAccount('vakifbank-cp', '000000000111111', '3XTgER89as', 'VP999999')

describe('PayFlexCPV4PosCrypt', () => {
  let crypt: PayFlexCPV4PosCrypt

  beforeEach(() => {
    crypt = new PayFlexCPV4PosCrypt()
  })

  it('supports only PayFlexCPV4Pos', () => {
    expect(PayFlexCPV4PosCrypt.supports('PayFlexCPV4Pos')).toBe(true)
    expect(PayFlexCPV4PosCrypt.supports('AssecoPos')).toBe(false)
  })

  it('create3DHash is not supported', () => {
    expect(() => crypt.create3DHash(account, {})).toThrow(NotImplementedError)
  })

  it.each([
    [
      {
        HostMerchantId: '000000000111111',
        MerchantPassword: '3XTgER89as',
        AmountCode: '949',
        Amount: '10.10',
      },
      '/MfLewtkUjpN5e/RY2iuIoT72hk=',
    ],
  ])('createHash(%j) // %s', (requestData) => {
    // deviation: R2 HashedData is optional (guide §5) and this formula is rejected by the bank (5029)
    expect(() => crypt.createHash(account, requestData)).toThrow(NotImplementedError)
  })

  it('check3DHash is not supported', () => {
    expect(() => crypt.check3DHash(account, {})).toThrow(NotImplementedError)
  })
})
