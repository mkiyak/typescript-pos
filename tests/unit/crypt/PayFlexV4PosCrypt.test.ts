import { createHash } from 'node:crypto'
import iconv from 'iconv-lite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayFlexV4PosCrypt } from '../../../src/crypt/PayFlexV4PosCrypt.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosLogger } from '../../../src/logger.js'
import type { GatewayResponseData } from '../../../src/types.js'

const account = AccountFactory.createPayFlexPosAccount('vakifbank', '000000000011445', 'Ab123456', 'VP999999')

type MockLogger = { [K in keyof PosLogger]: ReturnType<typeof vi.fn> }

/** Independent of the implementation: node:crypto + iconv-lite directly. */
function expectedHash(concatenated: string): string {
  return createHash('sha256').update(iconv.encode(concatenated, 'ISO-8859-9')).digest('base64')
}

const baseData = (): GatewayResponseData => ({
  VerifyEnrollmentRequestId: 'vakif1954a',
  MerchantId: '000000000011445',
  PurchCurrency: '949',
  PurchAmount: '1.09',
  Eci: '05',
  Cavv: 'AAABBBCCC',
  MdStatus: '1',
  Status: 'Y',
})

describe('PayFlexV4PosCrypt', () => {
  let logger: MockLogger
  let crypt: PayFlexV4PosCrypt

  beforeEach(() => {
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    crypt = new PayFlexV4PosCrypt(logger as unknown as PosLogger)
  })

  it('supports only PayFlexV4Pos', () => {
    expect(PayFlexV4PosCrypt.supports('PayFlexV4Pos')).toBe(true)
    expect(PayFlexV4PosCrypt.supports('AssecoPos')).toBe(false)
  })

  it('matches the precomputed reference vector (verified with php hash/mb_convert_encoding)', () => {
    expect(expectedHash('vakif1954a000000000011445949109' + '05AAABBBCCC1YAb123456')).toBe(
      'qWT40M7fpAKuOSvxeDHoBaAnZJEq8l8A4LHPgE7kJec=',
    )
    expect(crypt.check3DHash(account, { ...baseData(), Hash: 'qWT40M7fpAKuOSvxeDHoBaAnZJEq8l8A4LHPgE7kJec=' })).toBe(
      true,
    )
  })

  it('accepts a correct hash', () => {
    const hash = expectedHash('vakif1954a000000000011445949109' + '05AAABBBCCC1YAb123456')
    expect(crypt.check3DHash(account, { ...baseData(), Hash: hash })).toBe(true)
  })

  it('rejects a hash with one char changed', () => {
    const hash = expectedHash('vakif1954a000000000011445949109' + '05AAABBBCCC1YAb123456')
    const tampered = (hash.startsWith('A') ? 'B' : 'A') + hash.slice(1)
    expect(crypt.check3DHash(account, { ...baseData(), Hash: tampered })).toBe(false)
  })

  it('rejects when a hashed field is tampered', () => {
    const hash = expectedHash('vakif1954a000000000011445949109' + '05AAABBBCCC1YAb123456')
    expect(crypt.check3DHash(account, { ...baseData(), PurchAmount: '2.09', Hash: hash })).toBe(false)
  })

  it('returns true when the Hash key is absent', () => {
    expect(crypt.check3DHash(account, baseData())).toBe(true)
  })

  it('finds the hash key case-insensitively', () => {
    const hash = expectedHash('vakif1954a000000000011445949109' + '05AAABBBCCC1YAb123456')
    expect(crypt.check3DHash(account, { ...baseData(), HASH: hash })).toBe(true)
    expect(crypt.check3DHash(account, { ...baseData(), hash: 'wrong' })).toBe(false)
  })

  it('an empty or non-string Hash never matches', () => {
    expect(crypt.check3DHash(account, { ...baseData(), Hash: '' })).toBe(false)
    expect(crypt.check3DHash(account, { ...baseData(), Hash: undefined })).toBe(false)
    expect(crypt.check3DHash(account, { ...baseData(), Hash: 123 as never })).toBe(false)
  })

  it.each([null, undefined, 'str', 42])('returns false (never throws) for non-object data %s', (data) => {
    expect(crypt.check3DHash(account, data as never)).toBe(false)
  })

  it('removes the dot from PurchAmount', () => {
    const hash = expectedHash('vakif1954a000000000011445949' + '1000' + '05AAABBBCCC1YAb123456')
    expect(crypt.check3DHash(account, { ...baseData(), PurchAmount: '10.00', Hash: hash })).toBe(true)
  })

  it('zero-pads Eci to 2 chars', () => {
    const hash = expectedHash('vakif1954a000000000011445949109' + '05AAABBBCCC1YAb123456')
    expect(crypt.check3DHash(account, { ...baseData(), Eci: '5', Hash: hash })).toBe(true)
  })

  it('hashes Turkish characters as ISO-8859-9, not UTF-8', () => {
    const turkish = AccountFactory.createPayFlexPosAccount('vakifbank', '000000000011445', 'şifreĞ1', 'VP999999')
    const latin5 = expectedHash('vakif1954a000000000011445949109' + '05AAABBBCCC1Y' + 'şifreĞ1')
    const utf8 = createHash('sha256')
      .update('vakif1954a000000000011445949109' + '05AAABBBCCC1Y' + 'şifreĞ1', 'utf8')
      .digest('base64')
    expect(latin5).not.toBe(utf8)
    expect(crypt.check3DHash(turkish, { ...baseData(), Hash: latin5 })).toBe(true)
    expect(crypt.check3DHash(turkish, { ...baseData(), Hash: utf8 })).toBe(false)
  })

  it('never logs the merchant password or the generated hash', () => {
    const hash = expectedHash('vakif1954a000000000011445949109' + '05AAABBBCCC1YAb123456')
    crypt.check3DHash(account, { ...baseData(), Hash: 'wrong' })
    const logged = JSON.stringify([logger.debug.mock.calls, logger.error.mock.calls])
    expect(logged).not.toContain('Ab123456')
    expect(logged).not.toContain(hash)
    expect(logger.error).toHaveBeenCalled()
  })
})
