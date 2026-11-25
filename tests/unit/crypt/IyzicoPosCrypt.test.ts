import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IYZICO_SIGNED_FIELDS, IyzicoPosCrypt, type IyzicoSignedAnswer } from '../../../src/crypt/IyzicoPosCrypt.js'
import { NotImplementedError, PosError } from '../../../src/errors.js'
import { AccountFactory } from '../../../src/factory/AccountFactory.js'
import type { PosLogger } from '../../../src/logger.js'

type MockLogger = { [K in keyof PosLogger]: ReturnType<typeof vi.fn> }

function makeLogger(): MockLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

const SECRET = 'sandbox-secretKey'
const IA = AccountFactory.createIyzicoPosAccount('iyzico', 'sandbox-apiKey', SECRET)
const OTHER = AccountFactory.createIyzicoPosAccount('iyzico', 'sandbox-apiKey', 'another-secretKey')

const HX = (msg: string, key: string = SECRET): string => createHmac('sha256', key).update(msg, 'utf8').digest('hex')

let logger: MockLogger
let crypt: IyzicoPosCrypt

beforeEach(() => {
  logger = makeLogger()
  crypt = new IyzicoPosCrypt(logger as unknown as PosLogger)
})

describe('IyzicoPosCrypt (ported cases)', () => {
  it('supports', () => {
    expect(IyzicoPosCrypt.supports('IyzicoPos')).toBe(true)
    expect(IyzicoPosCrypt.supports('AkbankPos')).toBe(false)
  })

  it('create3DHash is not implemented', () => {
    expect(() => crypt.create3DHash(IA, {})).toThrow(NotImplementedError)
  })

  it('createHash', () => {
    expect(crypt.createHash(IA, { rnd: 'abc123', uri: '/payment/auth', requestBody: '{"key":"value"}' })).toBe(
      'cdf060d3da2bb89928cc9110c50594b47239deb879daf0fb72a556fcb9c0f563',
    )
  })

  it('hashString requires a key', () => {
    // deviation: C7 the missing key is a PosError, not a LogicException
    expect(() => crypt.hashString('data')).toThrow(PosError)
  })

  it('hashString returns the lowercase hex HMAC', () => {
    expect(crypt.hashString('test-string', 'secret')).toBe(
      '03359f1240bd7dd721e166122248951b5c6c86f517ea9d9a898af29100e9325a',
    )
  })

  it('check3DHash requires an iyzico account', () => {
    // deviation: C7 PosError instead of LogicException
    const other = AccountFactory.createAkbankPosAccount('akbank-pos', '1', '2', 'key')
    expect(() => crypt.check3DHash(other as never, {})).toThrow(PosError)
  })

  describe('check3DHash', () => {
    const data = {
      conversationData: 'conv-data',
      conversationId: 'conv-id-1',
      mdStatus: '1',
      paymentId: 'pay-001',
      status: 'success',
    }
    const validSig = '5d94003eabf9905de331bd8f03391f5fb1d07a1f722095cd9056c23f4526180c'

    it('success', () => {
      expect(crypt.check3DHash(IA, { ...data, signature: validSig })).toBe(true)
    })
    it('wrong signature', () => {
      expect(crypt.check3DHash(IA, { ...data, signature: 'wrong-sig' })).toBe(false)
    })
    it('missing signature', () => {
      expect(crypt.check3DHash(IA, data)).toBe(false)
    })
    it('missing fields', () => {
      expect(crypt.check3DHash(IA, { signature: 'anything' })).toBe(false)
    })
  })

  it.each([
    [undefined, 24],
    [16, 16],
  ])('generateRandomString(%s) has %d characters', (length, expected) => {
    const str = length === undefined ? crypt.generateRandomString() : crypt.generateRandomString(length)
    expect(str).toHaveLength(expected)
    expect(str).toMatch(/^[0-9A-F]+$/)
  })

  it('hashFromParams', () => {
    expect(
      crypt.hashFromParams(IA, { orderId: 'order-1', amount: '100', hashParams: 'orderId:amount' }, 'orderId:amount'),
    ).toBe('d45f9cd95075babe50ef5e10e3891f3dfdb9fca24dc1154dbf0bcb3833244b55')
  })

  it('hashFromParams rejects an empty parameter list', () => {
    // deviation: C7 PosError instead of InvalidArgumentException
    expect(() => crypt.hashFromParams(IA, { a: '1' }, '')).toThrow(new PosError('hashParamsValue cannot be empty'))
  })
})

describe('request authorization', () => {
  // addition: header layout, three signed parts
  it('authorizationHeader is IYZWSv2 plus the base64 of apiKey, random key and signature', () => {
    const body = '{"locale":"tr","price":10.01}'
    const header = crypt.authorizationHeader(IA, 'https://sandbox-api.iyzipay.com/payment/auth', body, 'RND123')
    expect(header.startsWith('IYZWSv2 ')).toBe(true)
    const decoded = Buffer.from(header.slice('IYZWSv2 '.length), 'base64').toString('utf8')
    expect(decoded).toBe(`apiKey:sandbox-apiKey&randomKey:RND123&signature:${HX(`RND123/payment/auth${body}`)}`)
  })

  it('signs exactly the bytes it is given (non-ASCII, quotes, slashes, emoji)', () => {
    const body = '{"name":"Şükrü \\"Ö\\" / İ 😀"}'
    const header = crypt.authorizationHeader(IA, 'https://h/v2/payment/refund', body, 'R')
    const decoded = Buffer.from(header.slice(8), 'base64').toString('utf8')
    expect(decoded.endsWith(`&signature:${HX(`R/v2/payment/refund${body}`)}`)).toBe(true)
  })

  it('the signed path excludes the query string', () => {
    const header = crypt.authorizationHeader(IA, 'https://h/v2/reporting/payment/details?paymentId=1', '', 'R')
    const decoded = Buffer.from(header.slice(8), 'base64').toString('utf8')
    expect(decoded.endsWith(`&signature:${HX('R/v2/reporting/payment/details')}`)).toBe(true)
  })

  it('generates a fresh 24-character random key per header', () => {
    const parts = (): string =>
      Buffer.from(crypt.authorizationHeader(IA, 'https://h/p', '{}').slice(8), 'base64')
        .toString('utf8')
        .split('&')[1] as string
    const a = parts()
    const b = parts()
    expect(a).toMatch(/^randomKey:[0-9A-F]{24}$/)
    expect(a).not.toBe(b)
  })

  it.each(['http://h/p', 'x', '', 'ftp://h/p', '//h/p'])('rejects the URL %j', (url) => {
    expect(() => crypt.authorizationHeader(IA, url, '{}', 'R')).toThrow(PosError)
  })

  it('accepts an empty body', () => {
    expect(() => crypt.authorizationHeader(IA, 'https://h/p', '', 'R')).not.toThrow()
  })

  it.each([
    ['rnd', { uri: '/p', requestBody: '{}' }],
    ['rnd', { rnd: '', uri: '/p', requestBody: '{}' }],
    ['rnd', { rnd: 1, uri: '/p', requestBody: '{}' }],
    ['rnd', { rnd: null, uri: '/p', requestBody: '{}' }],
    ['uri', { rnd: 'R', requestBody: '{}' }],
    ['uri', { rnd: 'R', uri: '', requestBody: '{}' }],
    ['uri', { rnd: 'R', uri: ['/p'], requestBody: '{}' }],
    ['requestBody', { rnd: 'R', uri: '/p' }],
    ['requestBody', { rnd: 'R', uri: '/p', requestBody: 5 }],
    ['requestBody', { rnd: 'R', uri: '/p', requestBody: { a: 1 } }],
    ['requestBody', { rnd: 'R', uri: '/p', requestBody: null }],
  ])('createHash rejects a missing or non-string %s (%j) before signing', (name, requestData) => {
    const spy = vi.spyOn(crypt, 'hashString')
    expect(() => crypt.createHash(IA, requestData)).toThrow(
      new PosError(`iyzico authorization field "${name}" is missing`),
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it('createHash ignores inherited values', () => {
    const inherited = Object.create({ rnd: 'R', uri: '/p', requestBody: '{}' }) as Record<string, unknown>
    expect(() => crypt.createHash(IA, inherited)).toThrow(PosError)
  })

  it('the secret key never appears in a header or in a log', () => {
    const header = crypt.authorizationHeader(IA, 'https://h/p', '{}', 'R')
    expect(Buffer.from(header.slice(8), 'base64').toString('utf8')).not.toContain(SECRET)
    expect(JSON.stringify(logger)).not.toContain(SECRET)
    expect(JSON.stringify(logger.debug.mock.calls)).toBe('[]')
  })
})

describe('3D Secure callback signature', () => {
  const CB1 = {
    conversationData: '',
    conversationId: 'order-001',
    mdStatus: '1',
    paymentId: 'pay-1',
    status: 'success',
    signature: '0bf41021ed870dab1d3d3b31e072a467a95e82742dbf9c0d521d0861c95223d7',
  }
  const CB0 = {
    conversationId: 'order-001',
    mdStatus: '0',
    status: 'failure',
    signature: 'c7895d6c48cdf7cca1ba1e77434e6663603a07cc9f8fc2400e0e8525a6619cb4',
  }
  const CB2 = {
    conversationData: 'x:y',
    conversationId: 'order-001',
    mdStatus: '1',
    paymentId: 'pay-1',
    status: 'success',
    signature: '7392d8d1028cad91349a4efaf096d3b048fa630967287024af032760d9200902',
  }
  const CB3 = {
    conversationData: '',
    conversationId: 'order-001',
    mdStatus: '1',
    paymentId: '1001',
    status: 'success',
    signature: '45b616fbe1dc2f78d796505551d4c4bbaf7ada9cfa6fc960b668a3a000ead074',
  }

  // addition: vectors computed with the platform HMAC over the colon-joined fields
  it.each([
    ['CB0 (absent fields sign as empty)', CB0],
    ['CB1', CB1],
    ['CB2', CB2],
    ['CB3', CB3],
  ])('%s verifies', (_name, body) => {
    expect(crypt.check3DHash(IA, body)).toBe(true)
  })

  it('does not verify under another secret', () => {
    expect(crypt.check3DHash(OTHER, CB3)).toBe(false)
  })

  it('accepts an uppercase hex signature', () => {
    expect(crypt.check3DHash(IA, { ...CB3, signature: CB3.signature.toUpperCase() })).toBe(true)
  })

  it.each([
    ['63 characters', CB3.signature.slice(0, 63)],
    ['65 characters', `${CB3.signature}0`],
    ['non-hex', `${CB3.signature.slice(0, 63)}g`],
    ['with spaces', ` ${CB3.signature}`],
    ['null', null],
    ['number', 5],
    ['array', [CB3.signature]],
    ['object', {}],
    ['empty', ''],
  ])('rejects a %s signature', (_name, signature) => {
    expect(crypt.check3DHash(IA, { ...CB3, signature } as never)).toBe(false)
  })

  it.each([
    ['mdStatus', 1],
    ['mdStatus', {}],
    ['mdStatus', ['1']],
    ['mdStatus', null],
    ['paymentId', 1001],
    ['paymentId', ['1001']],
    ['status', true],
    ['conversationId', { a: 1 }],
    ['conversationData', 5],
  ])('rejects a non-string %s (%j) even with a valid signature for its text', (name, value) => {
    const message = (field: string, v: unknown): string =>
      typeof v === 'string' ? v : field === 'x' ? '' : String(v === null ? '' : v)
    const body = { ...CB3, [name]: value } as Record<string, unknown>
    const text = ['conversationData', 'conversationId', 'mdStatus', 'paymentId', 'status']
      .map((f) => message(f, body[f]))
      .join(':')
    body.signature = HX(text)
    expect(crypt.check3DHash(IA, body as never)).toBe(false)
  })

  it('ignores inherited fields and signature', () => {
    const inherited = Object.create(CB3) as Record<string, string>
    expect(crypt.check3DHash(IA, inherited)).toBe(false)
    const partial = Object.create({ signature: CB3.signature }) as Record<string, string>
    Object.assign(partial, {
      conversationData: '',
      conversationId: 'order-001',
      mdStatus: '1',
      paymentId: '1001',
      status: 'success',
    })
    expect(crypt.check3DHash(IA, partial)).toBe(false)
    // inherited fields next to an own signature of the full text
    const fields = Object.create({
      conversationData: '',
      conversationId: 'order-001',
      mdStatus: '1',
      paymentId: '1001',
      status: 'success',
    }) as Record<string, string>
    fields.signature = CB3.signature
    expect(crypt.check3DHash(IA, fields)).toBe(false)
  })

  it.each([[null], [undefined], ['x'], [5], [[CB3]], [() => 1]])('returns false, never throws, for %j', (data) => {
    expect(crypt.check3DHash(IA, data as never)).toBe(false)
  })

  it('logs success at debug level without data', () => {
    crypt.check3DHash(IA, CB3)
    expect(logger.debug.mock.calls.map((c) => c[0])).toEqual(['hash check is successful'])
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('failure log holds the order id only', () => {
    const body = { ...CB3, paymentId: '1002' }
    expect(crypt.check3DHash(IA, body)).toBe(false)
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith('hash check failed', { order_id: 'order-001' })
    const dump = JSON.stringify(logger.error.mock.calls)
    expect(dump).not.toContain(CB3.signature)
    expect(dump).not.toContain(HX(':order-001:1:1002:success'))
    expect(dump).not.toContain(SECRET)
  })

  it('failure log omits an order id that is not a string and bounds a long one', () => {
    crypt.check3DHash(IA, { conversationId: 5 } as never)
    expect(logger.error).toHaveBeenLastCalledWith('hash check failed', { order_id: undefined })
    crypt.check3DHash(IA, { conversationId: 'a'.repeat(100) })
    expect(logger.error).toHaveBeenLastCalledWith('hash check failed', { order_id: 'a'.repeat(64) })
  })

  describe('field boundaries', () => {
    /** Every way to cut the signed string at its colons into five fields. */
    function regroupings(signed: string): Array<Record<string, string>> {
      const tokens = signed.split(':')
      const gaps = tokens.length - 1
      const out: Array<Record<string, string>> = []
      const names = ['conversationData', 'conversationId', 'mdStatus', 'paymentId', 'status']
      const pick = (start: number, chosen: number[]): void => {
        if (chosen.length === 4) {
          const bounds = [0, ...chosen.map((c) => c + 1), tokens.length]
          const record: Record<string, string> = {}
          names.forEach((name, i) => {
            record[name] = tokens.slice(bounds[i], bounds[i + 1]).join(':')
          })
          out.push(record)
          return
        }
        for (let g = start; g < gaps; g++) pick(g + 1, [...chosen, g])
      }
      pick(0, [])
      return out
    }

    const pinned = (r: Record<string, string>): boolean =>
      r.conversationId === 'order-001' &&
      r.mdStatus === '1' &&
      /^[1-9]\d{0,19}$/.test(r.paymentId ?? '') &&
      r.status === 'success'

    // addition: the crypt joins fields with ':' and accepts any string, so a signed string with extra colons
    // verifies under several field splits (accepted by the crypt; the gateway rejects every split that is not
    // pinned on conversation id, 3D status, payment id digits and status).
    const signedStrings = [
      'x:y:order-001:1:pay-1:success',
      ':order-001:1:1001:success',
      'x:order-001:1:1001:success',
      'a:b:order-001:1:1001:success',
      'a:b:c:d:order-001:1:1001:success',
      ':order-001:1:1:success:success',
      'order-001:1:1001:success:order-001:1:1001:success',
    ]

    it.each(signedStrings)(
      'every verifying regrouping of %j either keeps the pinned fields or is not an approval',
      (signed) => {
        const splits = regroupings(signed)
        expect(splits.length).toBeGreaterThan(0)
        const signature = HX(signed)
        const original = splits.find((r) => r.conversationData === signed.split(':').slice(0, -4).join(':'))
        let verifying = 0
        for (const split of splits) {
          const body = { ...split, signature }
          // every regrouping joins back to the same signed text, so it verifies
          expect(crypt.check3DHash(IA, body)).toBe(true)
          verifying++
          if (pinned(split)) {
            // the four pinned fields contain no colon, so the split is the one that takes the colons into conversationData
            expect(original).toBeDefined()
            for (const name of ['conversationId', 'mdStatus', 'paymentId', 'status'] as const) {
              expect(split[name]).toBe((original as Record<string, string>)[name])
            }
          }
        }
        expect(verifying).toBe(splits.length)
      },
    )

    it('a pinned split exists for the digit payment ids and none for pay-1', () => {
      expect(regroupings('x:y:order-001:1:pay-1:success').some(pinned)).toBe(false)
      expect(regroupings('a:b:order-001:1:1001:success').filter(pinned)).toHaveLength(1)
      expect(regroupings(':order-001:1:1001:success').filter(pinned)).toHaveLength(1)
    })

    it('a conversation id carrying a colon is a different signed text than the pinned order id', () => {
      // the order id "order-001" shifted into conversationData is still a valid signature for the colon-joined text,
      // but the conversation id then no longer equals the order id
      const shifted = {
        conversationData: 'x:order-001',
        conversationId: '1',
        mdStatus: '1001',
        paymentId: 'success',
        status: '',
      }
      const signature = HX(Object.values(shifted).join(':'))
      expect(crypt.check3DHash(IA, { ...shifted, signature })).toBe(true)
      expect(pinned(shifted)).toBe(false)
    })
  })
})

describe('answer signature', () => {
  const payment = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    paymentId: '35790626',
    currency: 'TRY',
    basketId: '20260611C995',
    conversationId: '20260611C995',
    paidPrice: 10.01,
    price: 10.01,
    signature: '6462c3a03686a509584b5b0d631b6ea56b018735b294caa08175ede1841c6937',
    ...extra,
  })

  const vectors: Array<[string, IyzicoSignedAnswer, Record<string, unknown>]> = [
    ['P1', 'payment', payment()],
    [
      'P2',
      'payment',
      {
        paymentId: 'pay-1',
        currency: 'TRY',
        basketId: 'order-001',
        conversationId: 'order-001',
        paidPrice: 100,
        price: 100,
        signature: '339bab22b485391d99bece87317620b923f1bf49dfaafb7c0373009616637344',
      },
    ],
    [
      'P3',
      'payment',
      payment({
        paidPrice: '10.50',
        price: '10.50',
        signature: 'b1595e29f4058e21953323e498e0c5144eac776850784e22821e0aa467e71a07',
      }),
    ],
    [
      'P4',
      'payment',
      {
        paymentId: '1001',
        currency: 'TRY',
        basketId: 'order-001',
        conversationId: 'order-001',
        paidPrice: 100,
        price: 100,
        signature: 'f1689a8ed87fb7dda212cffaf08d2415e8a13f7b7a8a7fc499297582febfde30',
      },
    ],
    [
      'R1',
      'refund',
      {
        paymentId: 35790641,
        price: 1,
        currency: 'TRY',
        conversationId: '202606118557',
        signature: '581e63d587d52f6047988a2dcd67892b3efca4a03c95bdea802dd59f9116bd8f',
      },
    ],
    [
      'R2',
      'refund',
      {
        paymentId: '1001',
        price: 40,
        currency: 'TRY',
        conversationId: 'order-001',
        signature: 'd596a79b87ad1fc5bf0f3ecaf82319a67d6f1f2e22bf676b80f8abda41e33cdc',
      },
    ],
    [
      'CF1',
      'checkoutFormRetrieve',
      {
        paymentStatus: 'SUCCESS',
        paymentId: '35790626',
        currency: 'TRY',
        basketId: 'order-001',
        conversationId: 'order-001',
        paidPrice: 110,
        price: 100,
        token: 'tok-123',
        signature: 'e3bb130bac34683442ac69e18c1d988f2cb28e18665ce51e3d11176380dc9eb9',
      },
    ],
    [
      'CF2',
      'checkoutFormRetrieve',
      {
        paymentStatus: 'SUCCESS',
        paymentId: '1001',
        currency: 'TRY',
        basketId: 'order-001',
        conversationId: 'order-001',
        paidPrice: 110,
        price: 100,
        token: 'tok-123',
        signature: '0073309e4f8c2ae874d5a805470c020753ca4b3db071fa3a558e07549158636a',
      },
    ],
    [
      'CFI',
      'checkoutFormInit',
      {
        conversationId: 'order-001',
        token: 'tok-123',
        signature: 'd3d3f585f9e13111011b5ce4159128cab75287e616e2f46f6c007b640037a9d9',
      },
    ],
    [
      'I1',
      'threeDSInit',
      {
        paymentId: 'pay-1',
        conversationId: 'order-001',
        signature: 'd3c5c5f939400a8306cad50dbb8fd563477d427a5b7d0d40ab9b1c17907a4ae5',
      },
    ],
  ]

  // addition: answer signatures are not checked by the reference; vectors computed from the documented tables
  it.each(vectors)('%s verifies with the account and fails with another secret', (_name, kind, answer) => {
    expect(crypt.checkResponseSignature(IA, answer, kind)).toBe(true)
    expect(crypt.checkResponseSignature(OTHER, answer, kind)).toBe(false)
  })

  it('exposes the signed field lists', () => {
    expect(IYZICO_SIGNED_FIELDS).toEqual({
      payment: ['paymentId', 'currency', 'basketId', 'conversationId', 'paidPrice', 'price'],
      threeDSInit: ['paymentId', 'conversationId'],
      checkoutFormInit: ['conversationId', 'token'],
      checkoutFormRetrieve: [
        'paymentStatus',
        'paymentId',
        'currency',
        'basketId',
        'conversationId',
        'paidPrice',
        'price',
        'token',
      ],
      refund: ['paymentId', 'price', 'currency', 'conversationId'],
    })
    expect(Object.isFrozen(IYZICO_SIGNED_FIELDS)).toBe(true)
  })

  it('paidPrice 10.209999999999999 signs as 10.21', () => {
    const answer = { ...payment({ paidPrice: 10.209999999999999, price: 10.21 }) }
    answer.signature = HX('35790626:TRY:20260611C995:20260611C995:10.21:10.21')
    expect(crypt.checkResponseSignature(IA, answer, 'payment')).toBe(true)
  })

  it('numbers and numeric strings of one price sign the same', () => {
    const a = payment({ paidPrice: 10.5, price: 10.5, signature: undefined })
    const text = '35790626:TRY:20260611C995:20260611C995:10.5:10.5'
    for (const v of [10.5, '10.5', '10.50', '10.500']) {
      expect(crypt.checkResponseSignature(IA, { ...a, paidPrice: v, price: v, signature: HX(text) }, 'payment')).toBe(
        true,
      )
    }
  })

  it.each([
    ['a missing paymentId', { paymentId: undefined }],
    ['a null currency', { currency: null }],
    ['a missing price', { price: undefined }],
    ['paidPrice 1e2', { paidPrice: '1e2' }],
    ['paidPrice -1', { paidPrice: -1 }],
    ['paidPrice NaN', { paidPrice: Number.NaN }],
    ['paidPrice with 9 decimals', { paidPrice: '1.123456789' }],
    ['paidPrice true', { paidPrice: true }],
    ['paymentId {}', { paymentId: {} }],
    ['paymentId an array', { paymentId: ['35790626'] }],
    ['paymentId a float', { paymentId: 1.5 }],
    ['paymentId an unsafe integer', { paymentId: 2 ** 60 }],
    ['conversationId a number', { conversationId: 5 }],
    ['signature missing', { signature: undefined }],
    ['signature null', { signature: null }],
    ['signature an array', { signature: ['x'] }],
    ['signature 63 characters', { signature: 'a'.repeat(63) }],
  ])('fails for %s', (_name, patch) => {
    expect(crypt.checkResponseSignature(IA, payment(patch), 'payment')).toBe(false)
  })

  it.each([2 ** 60, 1.5, -0.5])('fails for a payment id %s even when the signature covers its text', (id) => {
    const answer = payment({ paymentId: id, signature: HX(`${String(id)}:TRY:20260611C995:20260611C995:10.01:10.01`) })
    expect(crypt.checkResponseSignature(IA, answer, 'payment')).toBe(false)
  })

  it('fails when a signed field is inherited rather than own', () => {
    const base = payment()
    const inherited = Object.create({ paymentId: base.paymentId }) as Record<string, unknown>
    for (const [k, v] of Object.entries(base)) if (k !== 'paymentId') inherited[k] = v
    expect(crypt.checkResponseSignature(IA, inherited, 'payment')).toBe(false)
  })

  it('fails for an unknown kind and for non-object answers, never throwing', () => {
    expect(crypt.checkResponseSignature(IA, payment(), 'nope' as never)).toBe(false)
    expect(crypt.checkResponseSignature(IA, payment(), '__proto__' as never)).toBe(false)
    expect(crypt.checkResponseSignature(IA, payment(), 'toString' as never)).toBe(false)
    for (const v of [null, undefined, 'x', 5, [payment()]]) {
      expect(crypt.checkResponseSignature(IA, v as never, 'payment')).toBe(false)
    }
  })

  it('requires an iyzico account', () => {
    const other = AccountFactory.createAkbankPosAccount('akbank-pos', '1', '2', 'key')
    expect(() => crypt.checkResponseSignature(other as never, payment(), 'payment')).toThrow(PosError)
  })

  it('a field changed after signing fails the check', () => {
    for (const patch of [
      { paymentId: '35790627' },
      { currency: 'USD' },
      { basketId: 'x' },
      { conversationId: 'x' },
      { paidPrice: 10.02 },
      { price: 10.02 },
    ]) {
      expect(crypt.checkResponseSignature(IA, payment(patch), 'payment')).toBe(false)
    }
  })

  it('colons inside signed values: every verifying split is accepted by the crypt; only one keeps currency and the two ids pinned', () => {
    // accepted by the crypt; the gateway rejects every split whose currency, basket id or conversation id differs
    // from the order, and the price fields at the end contain no colon
    const text = 'p:q:TRY:order-001:order-001:100:100'
    const signature = HX(text)
    const splits = [
      { paymentId: 'p:q', currency: 'TRY', basketId: 'order-001', conversationId: 'order-001' },
      { paymentId: 'p', currency: 'q', basketId: 'TRY', conversationId: 'order-001:order-001' },
      { paymentId: 'p', currency: 'q:TRY', basketId: 'order-001', conversationId: 'order-001' },
      { paymentId: 'p', currency: 'q', basketId: 'TRY:order-001', conversationId: 'order-001' },
    ]
    for (const split of splits) {
      expect(crypt.checkResponseSignature(IA, { ...split, paidPrice: 100, price: 100, signature }, 'payment')).toBe(
        true,
      )
    }
    const pinned = splits.filter(
      (s) => s.currency === 'TRY' && s.basketId === 'order-001' && s.conversationId === 'order-001',
    )
    expect(pinned).toEqual([splits[0]])
  })

  it('failure log holds the kind and the order id only', () => {
    expect(crypt.checkResponseSignature(IA, payment({ paidPrice: 11 }), 'payment')).toBe(false)
    expect(logger.error).toHaveBeenCalledWith('answer signature check failed', {
      kind: 'payment',
      order_id: '20260611C995',
    })
    const dump = JSON.stringify(logger.error.mock.calls)
    expect(dump).not.toContain(SECRET)
    expect(dump).not.toContain('6462c3a0')
  })

  it('success logs at debug level without data', () => {
    crypt.checkResponseSignature(IA, payment(), 'payment')
    expect(logger.debug.mock.calls.map((c) => c[0])).toEqual(['answer signature check is successful'])
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('the log keeps no order id that is not a string', () => {
    crypt.checkResponseSignature(IA, { conversationId: { a: 1 }, signature: 'x' }, 'threeDSInit')
    expect(logger.error).toHaveBeenLastCalledWith('answer signature check failed', {
      kind: 'threeDSInit',
      order_id: undefined,
    })
  })
})
