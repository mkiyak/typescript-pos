import { describe, expect, it } from 'vitest'
import { NullCrypt } from '../../../src/crypt/NullCrypt.js'
import { AssecoPosAccount } from '../../../src/model/account/AssecoPosAccount.js'

describe('NullCrypt', () => {
  const account = new AssecoPosAccount('bank', 'merchant', 'user', 'pass', 'key')
  const crypt = new NullCrypt()

  it('supports every gateway', () => {
    expect(NullCrypt.supports('KuveytPos')).toBe(true)
    expect(NullCrypt.supports('AssecoPos')).toBe(true)
  })

  it('create3DHash returns an empty string', () => {
    expect(crypt.create3DHash(account, {})).toBe('')
  })

  it('check3DHash returns true', () => {
    expect(crypt.check3DHash(account, {})).toBe(true)
  })

  it('createHash returns an empty string', () => {
    expect(crypt.createHash(account, {})).toBe('')
  })
})
