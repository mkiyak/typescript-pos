import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PosNetPosCrypt } from '../../../src/crypt/PosNetPosCrypt.js'
import { MissingAccountInfoError, NotImplementedError, PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosLogger } from '../../../src/logger.js'
import type { GatewayResponseData } from '../../../src/types.js'

const KEY = '10,10,10,10,10,10,10,10'
const account = AccountFactory.createPosNetPosAccount('yapikredi', '6706598320', '67005551', '27426', KEY)

type MockLogger = { [K in keyof PosLogger]: ReturnType<typeof vi.fn> }

function makeLogger(): MockLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

const h = (text: string): string => createHash('sha256').update(text, 'utf8').digest('base64')
const firstHash = h(`${KEY};67005551`)

const e1 = (): GatewayResponseData => ({
  mdStatus: '1',
  xid: '000000002020110828BC',
  amount: '10001',
  currency: 'TL',
  mac: 'JA8+68g04zptKLqLYwOOnK/doN2YRLDqaohzBNJ956Y=',
})

describe('PosNetPosCrypt', () => {
  let logger: MockLogger
  let crypt: PosNetPosCrypt

  beforeEach(() => {
    logger = makeLogger()
    crypt = new PosNetPosCrypt(logger as unknown as PosLogger)
  })

  it('supports only PosNetPos', () => {
    expect(PosNetPosCrypt.supports('PosNetPos')).toBe(true)
    expect(PosNetPosCrypt.supports('AssecoPos')).toBe(false)
  })

  it('create3DHash is not implemented', () => {
    expect(() => crypt.create3DHash(account, {})).toThrow(NotImplementedError)
  })

  it('createHash signs id, amount, currency, merchant and the first hash', () => {
    expect(
      crypt.createHash(
        account,
        { mid: '6706598320', tid: '67005551' },
        { id: 'TST_190620093100_024', amount: 175, currency: 'TL' },
      ),
    ).toBe('nyeFSQ4J9NZVeCcEGCDomM8e2YIvoeIa/IDh2D3qaL4=')
  })

  describe('check3DHash (reference vector)', () => {
    const data = (): GatewayResponseData => ({
      xid: '00000000000000000895',
      amount: '100',
      currency: 'TL',
      installment: '00',
      point: '0',
      pointAmount: '0',
      txStatus: 'N',
      mdStatus: '9',
      mdErrorMessage: 'None 3D - Secure Transaction',
      mac: '7I9ojRm7yzvZZTFNOYWocGIGSTv2Vmq23STR6X6X+c0=',
    })

    it('accepts the bank MAC and rejects an empty amount', () => {
      expect(crypt.check3DHash(account, data())).toBe(true)
      expect(crypt.check3DHash(account, { ...data(), amount: '' })).toBe(false)
    })
  })

  // addition: planning vectors and fail-closed behaviour
  describe('createHash additions', () => {
    const request = { mid: '6706598320', tid: '67005551' }

    it('signs the exact kuruş amount (VP1)', () => {
      expect(crypt.createHash(account, request, { id: '000000002020110828BC', amount: 113, currency: 'TL' })).toBe(
        'qaAng0XtzvOtvxWhri36zAqfqPv6lzn2+TZTJbI8KxE=',
      )
    })

    it('signs a second known order', () => {
      expect(crypt.createHash(account, request, { id: '000000002020110828BC', amount: 10001, currency: 'TL' })).toBe(
        'oE7zwV87uOc2DFpGPlr4jQRQ0z9LsxGw56c7vaiZkTo=',
      )
    })

    it('rejects a missing mapped order before hashing', () => {
      const spy = vi.spyOn(crypt, 'hashString')
      expect(() => crypt.createHash(account, request)).toThrow(PosError)
      expect(spy).not.toHaveBeenCalled()
    })

    it.each([
      [{ mid: undefined, tid: '67005551' }],
      [{ mid: '6706598320', tid: undefined }],
      [{ mid: '', tid: '67005551' }],
      [{ mid: '6706598320', tid: 5 }],
    ])('rejects unusable request identifiers %j and never signs "undefined"', (requestData) => {
      const spy = vi.spyOn(crypt, 'hashString')
      expect(() => crypt.createHash(account, requestData, { id: 'A', amount: 1, currency: 'TL' })).toThrow(PosError)
      for (const call of spy.mock.calls) {
        expect(call[0]).not.toContain('undefined')
      }
    })

    it('rejects an account without a secret key', () => {
      const noKey = AccountFactory.createPosNetPosAccount('yapikredi', '6706598320', '67005551', '27426')
      expect(() => crypt.createHash(noKey, request, { id: 'A', amount: 1, currency: 'TL' })).toThrow(
        MissingAccountInfoError,
      )
    })
  })

  describe('check3DHash additions', () => {
    it('accepts the resolve MAC of a successful 3D check (E1)', () => {
      expect(crypt.check3DHash(account, e1())).toBe(true)
    })

    it('starts the signed string with mdStatus (E2 differs from E1 only there)', () => {
      expect(crypt.check3DHash(account, { ...e1(), mdStatus: '9' })).toBe(false)
      expect(
        crypt.check3DHash(account, { ...e1(), mdStatus: '9', mac: 'sekuJgLB8LeMOFbyXJw/X4ndvBH814CC5qEIvEe0aOE=' }),
      ).toBe(true)
    })

    it('rejects a MAC that differs in case', () => {
      expect(crypt.check3DHash(account, { ...e1(), mac: String(e1().mac).toLowerCase() })).toBe(false)
    })

    it('rejects a value that carries the separator even with a matching MAC', () => {
      const data = { ...e1(), xid: '000000002020110828BC;1' }
      const mac = h(`1;${data.xid};10001;TL;6706598320;${firstHash}`)
      expect(crypt.check3DHash(account, { ...data, mac })).toBe(false)
    })

    it.each(['mdStatus', 'xid', 'amount', 'currency', 'mac'])('returns false when %s is missing or empty', (field) => {
      const missing = e1()
      delete missing[field]
      expect(crypt.check3DHash(account, missing)).toBe(false)
      expect(crypt.check3DHash(account, { ...e1(), [field]: '' })).toBe(false)
    })

    it('returns false for a non-string field and never throws', () => {
      expect(crypt.check3DHash(account, { ...e1(), mdStatus: 1 as never })).toBe(false)
      expect(crypt.check3DHash(account, { ...e1(), xid: { a: 1 } as never })).toBe(false)
    })

    it('ignores inherited fields', () => {
      const data = Object.create(e1()) as GatewayResponseData
      expect(crypt.check3DHash(account, data)).toBe(false)
    })

    it('logs only the order id on failure, never the generated MAC, the first hash or the key', () => {
      const data = { ...e1(), mac: 'AAAA' }
      const generated = h(`1;000000002020110828BC;10001;TL;6706598320;${firstHash}`)
      expect(crypt.check3DHash(account, data)).toBe(false)

      const logged = JSON.stringify(logger.error.mock.calls)
      expect(logger.error).toHaveBeenCalledTimes(1)
      // the logger masks the order id itself
      expect(logged).toContain('order_id')
      expect(logged).not.toContain(generated)
      expect(logged).not.toContain(firstHash)
      expect(logged).not.toContain(KEY)
      expect(JSON.stringify(logger.debug.mock.calls)).not.toContain(generated)
    })

    it('rejects an account without a secret key as a configuration error', () => {
      const noKey = AccountFactory.createPosNetPosAccount('yapikredi', '6706598320', '67005551', '27426')
      expect(() => crypt.check3DHash(noKey, e1())).toThrow(MissingAccountInfoError)
    })
  })
})
