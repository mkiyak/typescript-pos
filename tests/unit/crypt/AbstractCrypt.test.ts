import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AbstractCrypt } from '../../../src/crypt/AbstractCrypt.js'
import type { AbstractPosAccount } from '../../../src/model/account/AbstractPosAccount.js'
import { AssecoPosAccount } from '../../../src/model/account/AssecoPosAccount.js'

class TestCrypt extends AbstractCrypt {
  create3DHash(): string {
    return ''
  }
  check3DHash(): boolean {
    return false
  }
  createHash(): string {
    return ''
  }
  // expose protected helpers for testing
  build(data: Record<string, unknown>, names: string[], sep = '', key: string | null = null): string {
    return this.buildHashString(data, names, sep, key)
  }
}

class Sha512Crypt extends TestCrypt {
  protected override readonly hashAlgorithm = 'sha512'
}

const b64 = (algo: string, s: string) => createHash(algo).update(s, 'utf8').digest('base64')

describe('AbstractCrypt', () => {
  const account = new AssecoPosAccount('bank', 'merchant', 'user', 'pass', 'SECRET')
  const crypt = new TestCrypt()

  describe('hashString', () => {
    it('defaults to base64 sha1', () => {
      expect(crypt.hashString('abc')).toBe('qZk+NkcGgWq6PiVxeFDCbJzQ2J0=')
    })

    it('ignores the encryption key', () => {
      expect(crypt.hashString('abc', 'anything')).toBe('qZk+NkcGgWq6PiVxeFDCbJzQ2J0=')
    })

    it('hashes the UTF-8 bytes of non-ASCII input', () => {
      expect(crypt.hashString('İşbank Ödeme ĞÜŞ')).toBe(b64('sha1', 'İşbank Ödeme ĞÜŞ'))
    })

    it('honours an overridden hash algorithm', () => {
      expect(new Sha512Crypt().hashString('abc')).toBe(b64('sha512', 'abc'))
    })
  })

  describe('hashFromParams', () => {
    const data = {
      MerchantNo: '123',
      TerminalNo: 'T1',
      Nested: { ReferenceCode: 'REF', Deeper: [{ OrderId: 'O-1' }] },
      Amount: 10.5,
      Flag: true,
      Empty: null,
    }

    it('concatenates the listed values (searched recursively) and appends the secret key', () => {
      const expected = b64('sha1', '123T1REFO-1SECRET')
      expect(crypt.hashFromParams(account, data, 'MerchantNo:TerminalNo:ReferenceCode:OrderId')).toBe(expected)
    })

    it('supports a custom separator', () => {
      expect(crypt.hashFromParams(account, data, 'MerchantNo;TerminalNo', ';')).toBe(b64('sha1', '123T1SECRET'))
    })

    it('uses PHP string casts for scalars and an empty string for missing keys', () => {
      expect(crypt.hashFromParams(account, data, 'Amount:Flag:Empty:Missing')).toBe(b64('sha1', '10.51SECRET'))
    })

    it('throws when hashParamsValue is empty', () => {
      expect(() => crypt.hashFromParams(account, data, '')).toThrow('hashParamsValue cannot be empty')
    })

    it('throws when the account has no secret key', () => {
      const noKey = new AssecoPosAccount('bank', 'merchant', 'user', 'pass') as AbstractPosAccount
      expect(() => crypt.hashFromParams(noKey, data, 'MerchantNo')).toThrow(/secretKey is not set/)
    })
  })

  describe('buildHashString', () => {
    it('joins values with the separator and appends the key when given', () => {
      expect(crypt.build({ a: '1', b: '2' }, ['a', 'b'], '|')).toBe('1|2')
      expect(crypt.build({ a: '1', b: '2' }, ['a', 'b'], '|', 'K')).toBe('1|2K')
    })

    it('finds the first key in depth-first pre-order', () => {
      expect(crypt.build({ x: { a: 'inner' }, a: 'outer' }, ['a'])).toBe('inner')
      expect(crypt.build({ a: 'outer', x: { a: 'inner' } }, ['a'])).toBe('outer')
    })

    it('does not match array indexes or inherited properties', () => {
      expect(crypt.build({ list: ['zero'] }, ['0'])).toBe('')
      expect(crypt.build({}, ['constructor', 'toString'])).toBe('')
    })
  })

  describe('generateRandomString', () => {
    it('returns 24 uppercase hex chars by default', () => {
      expect(crypt.generateRandomString()).toMatch(/^[0-9A-F]{24}$/)
    })

    it('honours the length argument', () => {
      expect(crypt.generateRandomString(8)).toMatch(/^[0-9A-F]{8}$/)
    })

    it('is not constant', () => {
      expect(crypt.generateRandomString()).not.toBe(crypt.generateRandomString())
    })
  })
})
