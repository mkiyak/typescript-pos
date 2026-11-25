import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToslaPosCrypt } from '../../../../../src/crypt/ToslaPosCrypt.js'
import { ToslaPosRequestDataMapper } from '../../../../../src/data-mapper/request/mapper/ToslaPosRequestDataMapper.js'
import { ToslaPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/ToslaPosRequestValueFormatter.js'
import { ToslaPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/ToslaPosRequestValueMapper.js'
import {
  NotImplementedError,
  PosError,
  UnsupportedPaymentModelError,
  UnsupportedTransactionTypeError,
} from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import {
  CARD_TYPE,
  CURRENCY,
  LANG,
  MODEL,
  type PaymentModel,
  TX_TYPE,
  type TxType,
} from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'

const TA = AccountFactory.createToslaPosAccount('tosla', '1000000494', 'POS_ENT_Test_001', 'POS_ENT_Test_001!*!*')
const card = CreditCardFactory.create('5555444433332222', '22', '01', '123', 'ahmet', CARD_TYPE.VISA)

const RV3 = '+XGO1qv+6W7nXZwSsYMaRrWXhi+99jffLvExGsFDodYyNadOG7OQKsygzly5ESDoNIS19oD2U+hSkVeT6UTAFA=='
const RV2 = 'jcgZOAf/m/E1uwYXmOPrdgqXRuEmVuG3Q14yri0okhULvRDbAicyAU8hflUP634yRRSZkOnIOeLZNqXfLhzz7g=='
const RV4 = 'bLp8WNYiaKrnW+EfwHuUZ1ovao0laSeuU/DqUMhjI40QNWdcHJWRKpkoE+eb1U07GGDgsIKKvx9nh84s6K1+pQ=='
const RV5 = 'csrJh00U/nYGim8jPp9uddRdRvEWZf8pYu9Elss5RtA9JQt6DRkXxrTTY4iYQt5iABp5bj+/RYhlnTflyD9eBw=='

const SESSION_HOST = 'A2A6E942BD2AE4A68BC42FE99D1BC917D67AFF54AB2BA44EBA675843744187708'
const SESSION_PAY = 'P6D383818909442128AB50AB1EC7A4B83080874341688447DA74B90150C8857F2'

type Stub = {
  generateRandomString: ReturnType<typeof vi.fn>
  createHash: ReturnType<typeof vi.fn>
  create3DHash: ReturnType<typeof vi.fn>
}

function makeMapper(crypt: unknown): ToslaPosRequestDataMapper {
  return new ToslaPosRequestDataMapper(
    new ToslaPosRequestValueMapper(),
    new ToslaPosRequestValueFormatter(),
    {},
    crypt as ToslaPosCrypt,
    LANG.EN,
  )
}

/** Same values and the same key order. */
function expectSame(actual: unknown, expected: unknown): void {
  expect(actual).toEqual(expected)
  expect(Object.keys(actual as object)).toEqual(Object.keys(expected as object))
}

function noHash<T extends Record<string, unknown>>(expected: T): Omit<T, 'hash'> {
  const { hash: _hash, ...rest } = expected
  return rest
}

function expectNoUndefined(value: unknown, path = 'value'): void {
  expect(value, path).not.toBeUndefined()
  if (typeof value === 'object' && value !== null) {
    for (const [key, inner] of Object.entries(value)) {
      expectNoUndefined(inner, `${path}.${key}`)
    }
  }
  if (typeof value === 'string') {
    expect(value, path).not.toContain('undefined')
  }
}

const registerOrder = (): PosOrder => ({
  id: 'order222',
  amount: 100.25,
  installment: 0,
  currency: CURRENCY.TRY,
  success_url: 'https://domain.com/success',
  time_span: new Date('2023-12-09T21:47:08+03:00'),
})

const registerExpected = {
  clientId: '1000000494',
  apiUser: 'POS_ENT_Test_001',
  callbackUrl: 'https://domain.com/success',
  orderId: 'order222',
  amount: 10025,
  currency: 949,
  installmentCount: 0,
  rnd: 'rand',
  timeSpan: '20231209214708',
  hash: RV3,
}

const nonSecureExpected = {
  clientId: '1000000494',
  apiUser: 'POS_ENT_Test_001',
  orderId: 'order222',
  amount: 10025,
  currency: 949,
  installmentCount: 0,
  rnd: 'rand',
  timeSpan: '20231209214708',
  cardHolderName: 'ahmet',
  cardNo: '5555444433332222',
  expireDate: '0122',
  cvv: '123',
  hash: RV3,
}

const idOrder = { id: 'id-12', time_span: new Date('2023-12-09T21:53:55+03:00') }
const statusExpected = {
  clientId: '1000000494',
  apiUser: 'POS_ENT_Test_001',
  orderId: 'id-12',
  rnd: 'rand-212s',
  timeSpan: '20231209215355',
  hash: RV2,
}

describe('ToslaPosRequestDataMapper', () => {
  let crypt: Stub
  let mapper: ToslaPosRequestDataMapper

  function arrange(expected: { rnd: string; hash: string }): void {
    crypt.generateRandomString.mockReturnValue(expected.rnd)
    crypt.createHash.mockReturnValue(expected.hash)
  }

  function expectHashedOnce(expected: Record<string, unknown>): void {
    expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
    expect(crypt.createHash).toHaveBeenCalledTimes(1)
    const [account, data] = crypt.createHash.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(account).toBe(TA)
    expectSame(data, noHash(expected))
  }

  beforeEach(() => {
    crypt = { generateRandomString: vi.fn(), createHash: vi.fn(), create3DHash: vi.fn() }
    mapper = makeMapper(crypt)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('supports only ToslaPos', () => {
    expect(ToslaPosRequestDataMapper.supports('ToslaPos')).toBe(true)
    expect(ToslaPosRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  describe('reference cases', () => {
    it('creates the post-auth request', () => {
      const expected = {
        clientId: '1000000494',
        apiUser: 'POS_ENT_Test_001',
        orderId: '2020110828BC',
        amount: 110,
        rnd: 'raranra',
        timeSpan: '20231209213944',
        hash: RV4,
      }
      arrange(expected)
      const actual = mapper.createNonSecurePostAuthPaymentRequestData(TA, {
        id: '2020110828BC',
        amount: 1.1,
        time_span: new Date('2023-12-09T21:39:44+03:00'),
      })
      expectSame(actual, expected)
      expectHashedOnce(expected)
    })

    it('creates the 3D session registration request', () => {
      arrange(registerExpected)
      const actual = mapper.create3DFormInitializeRequestData(TA, registerOrder(), MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH)
      expectSame(actual, registerExpected)
      expectHashedOnce(registerExpected)
    })

    it('creates the non-secure payment request', () => {
      arrange(nonSecureExpected)
      const actual = mapper.createNonSecurePaymentRequestData(TA, registerOrder(), TX_TYPE.PAY_AUTH, card)
      expectSame(actual, nonSecureExpected)
      expectHashedOnce(nonSecureExpected)
    })

    it('creates the cancel request', () => {
      arrange(statusExpected)
      expectSame(mapper.createCancelRequestData(TA, idOrder), statusExpected)
      expectHashedOnce(statusExpected)
    })

    it.each([
      [{}, 1, 10],
      [{ page: 2, page_size: 5 }, 2, 5],
    ])('creates the order history request %j', (extra, page, pageSize) => {
      const expected = {
        clientId: '1000000494',
        apiUser: 'POS_ENT_Test_001',
        orderId: '2020110828BC',
        transactionDate: '20231209',
        page,
        pageSize,
        rnd: 'rand-123',
        timeSpan: '20231209215355',
        hash: RV5,
      }
      arrange(expected)
      const actual = mapper.createOrderHistoryRequestData(TA, {
        id: '2020110828BC',
        time_span: new Date('2023-12-09T21:53:55+03:00'),
        transaction_date: new Date('2023-12-09T00:00:00+03:00'),
        ...extra,
      })
      expectSame(actual, expected)
      expectHashedOnce(expected)
    })

    it('creates the 3D Host form data (a GET to the session page)', async () => {
      const actual = await mapper.create3DFormData(
        TA,
        { ThreeDSessionId: SESSION_HOST },
        MODEL.THREE_D_HOST,
        TX_TYPE.PAY_AUTH,
        'https://ent.akodepos.com/api/Payment/threeDSecure',
        null,
      )
      expectSame(actual, {
        gateway: `https://ent.akodepos.com/api/Payment/threeDSecure/${SESSION_HOST}`,
        method: 'GET',
        inputs: {},
      })
      expect(crypt.create3DHash).not.toHaveBeenCalled()
      expect(crypt.generateRandomString).not.toHaveBeenCalled()
    })

    it('creates the 3D Pay form data with the card', async () => {
      const actual = await mapper.create3DFormData(
        TA,
        { ThreeDSessionId: SESSION_PAY, TransactionId: '2000000000032631', Code: 0, Message: 'Başarılı' },
        MODEL.THREE_D_PAY,
        TX_TYPE.PAY_AUTH,
        'https://ent.akodepos.com/api/Payment/ProcessCardForm',
        card,
      )
      expectSame(actual, {
        gateway: 'https://ent.akodepos.com/api/Payment/ProcessCardForm',
        method: 'POST',
        inputs: {
          ThreeDSessionId: SESSION_PAY,
          CardHolderName: 'ahmet',
          CardNo: '5555444433332222',
          ExpireDate: '01/22',
          Cvv: '123',
        },
      })
      expect(crypt.create3DHash).not.toHaveBeenCalled()
      expect(crypt.generateRandomString).not.toHaveBeenCalled()
    })

    it('creates the status request', () => {
      arrange(statusExpected)
      expectSame(mapper.createStatusRequestData(TA, idOrder), statusExpected)
      expectHashedOnce(statusExpected)
    })

    it('creates the refund request', () => {
      const expected = {
        clientId: '1000000494',
        apiUser: 'POS_ENT_Test_001',
        orderId: 'id-12',
        rnd: 'rand-212s',
        amount: 102,
        timeSpan: '20231209215355',
        hash: RV2,
      }
      arrange(expected)
      const actual = mapper.createRefundRequestData(TA, { ...idOrder, amount: 1.02 }, TX_TYPE.REFUND)
      expectSame(actual, expected)
      expectHashedOnce(expected)
    })

    // deviation: T19 (NotImplementedError)
    it('has no 3D provision request', () => {
      expect(() => mapper.create3DPaymentRequestData(TA, {}, TX_TYPE.PAY_AUTH, {})).toThrow(NotImplementedError)
    })
  })

  describe('additions', () => {
    const real = (): ToslaPosRequestDataMapper => makeMapper(new ToslaPosCrypt())

    // addition: the fixture hashes are the real request hashes of their rnd/timeSpan
    it.each([
      ['RV3 (non-secure, register)', RV3, 'rand', '20231209214708'],
      ['RV2 (status, cancel, refund)', RV2, 'rand-212s', '20231209215355'],
      ['RV4 (post-auth)', RV4, 'raranra', '20231209213944'],
      ['RV5 (history)', RV5, 'rand-123', '20231209215355'],
    ])('the fixture hash %s is what the real crypt computes', (_name, hash, rnd, timeSpan) => {
      const data = { clientId: '1000000494', apiUser: 'POS_ENT_Test_001', rnd, timeSpan }
      expect(new ToslaPosCrypt().createHash(TA, data)).toBe(hash)
    })

    // addition: the real crypt signs what the mapper produces
    it('signs the mapped request with the real crypt', () => {
      const m = real()
      const request = m.createStatusRequestData(TA, idOrder)
      const { hash, ...rest } = request
      expect(hash).toBe(new ToslaPosCrypt().createHash(TA, rest))
      expect(Object.keys(request).at(-1)).toBe('hash')
      expect(request.rnd).toMatch(/^[0-9A-F]{24}$/)
    })

    // addition: exact kurus where truncation loses one
    it('sends 1.15 as 115 everywhere', () => {
      const m = real()
      const base = { id: 'a1', time_span: new Date('2023-12-09T21:47:08+03:00') }
      expect(
        m.create3DFormInitializeRequestData(
          TA,
          { ...registerOrder(), amount: 1.15 },
          MODEL.THREE_D_PAY,
          TX_TYPE.PAY_AUTH,
        ).amount,
      ).toBe(115)
      expect(
        m.createNonSecurePaymentRequestData(TA, { ...registerOrder(), amount: 1.15 }, TX_TYPE.PAY_AUTH, card).amount,
      ).toBe(115)
      expect(m.createNonSecurePostAuthPaymentRequestData(TA, { ...base, amount: 1.15 }).amount).toBe(115)
      expect(m.createRefundRequestData(TA, { ...base, amount: 1.15 }, TX_TYPE.REFUND_PARTIAL).amount).toBe(115)
    })

    describe.each([
      [
        'register',
        (m: ToslaPosRequestDataMapper, o: PosOrder) =>
          m.create3DFormInitializeRequestData(TA, o, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH),
      ],
      [
        'non-secure',
        (m: ToslaPosRequestDataMapper, o: PosOrder) =>
          m.createNonSecurePaymentRequestData(TA, o, TX_TYPE.PAY_AUTH, card),
      ],
      ['post-auth', (m: ToslaPosRequestDataMapper, o: PosOrder) => m.createNonSecurePostAuthPaymentRequestData(TA, o)],
      ['refund', (m: ToslaPosRequestDataMapper, o: PosOrder) => m.createRefundRequestData(TA, o, TX_TYPE.REFUND)],
    ])('amount checks (%s)', (_name, run) => {
      it.each([0, -1, 0.004, 'abc', 1e13, Number.NaN, undefined, null, ''])('rejects the amount %j', (amount) => {
        expect(() => run(mapper, { ...registerOrder(), amount: amount as never })).toThrow(PosError)
        expect(crypt.generateRandomString).not.toHaveBeenCalled()
        expect(crypt.createHash).not.toHaveBeenCalled()
      })

      it('rejects a missing amount', () => {
        const { amount: _amount, ...order } = registerOrder()
        expect(() => run(mapper, order)).toThrow(PosError)
      })
    })

    describe.each([
      [
        'register',
        (m: ToslaPosRequestDataMapper, o: PosOrder) =>
          m.create3DFormInitializeRequestData(TA, o, MODEL.THREE_D_HOST, TX_TYPE.PAY_PRE_AUTH),
      ],
      [
        'non-secure',
        (m: ToslaPosRequestDataMapper, o: PosOrder) =>
          m.createNonSecurePaymentRequestData(TA, o, TX_TYPE.PAY_AUTH, card),
      ],
    ])('installment and currency checks (%s)', (_name, run) => {
      it.each([1.5, 100, 'x', -1, Number.NaN])('rejects the installment %j', (installment) => {
        expect(() => run(mapper, { ...registerOrder(), installment: installment as never })).toThrow(PosError)
      })

      it('rejects an unknown currency', () => {
        expect(() => run(mapper, { ...registerOrder(), currency: 'XXX' as never })).toThrow(PosError)
      })

      // addition: the currency is a code name, never the numeric bank code
      it('rejects a numeric currency', () => {
        expect(() => run(mapper, { ...registerOrder(), currency: 949 as never })).toThrow(PosError)
      })

      it('maps installment 1 to none and 3 to 3', () => {
        crypt.generateRandomString.mockReturnValue('r')
        crypt.createHash.mockReturnValue('h')
        expect(run(mapper, { ...registerOrder(), installment: 1 }).installmentCount).toBe(0)
        expect(run(mapper, { ...registerOrder(), installment: '3' as never }).installmentCount).toBe(3)
      })

      it('defaults the currency to TRY and installment to none', () => {
        crypt.generateRandomString.mockReturnValue('r')
        crypt.createHash.mockReturnValue('h')
        const { currency: _c, installment: _i, ...order } = registerOrder()
        const request = run(mapper, order)
        expect(request.currency).toBe(949)
        expect(request.installmentCount).toBe(0)
      })
    })

    describe('order id', () => {
      const runs: Array<[string, (o: PosOrder) => unknown]> = [
        [
          'register',
          (o) =>
            mapper.create3DFormInitializeRequestData(
              TA,
              { ...registerOrder(), ...o },
              MODEL.THREE_D_PAY,
              TX_TYPE.PAY_AUTH,
            ),
        ],
        [
          'non-secure',
          (o) => mapper.createNonSecurePaymentRequestData(TA, { ...registerOrder(), ...o }, TX_TYPE.PAY_AUTH, card),
        ],
        ['post-auth', (o) => mapper.createNonSecurePostAuthPaymentRequestData(TA, { amount: 1, ...o })],
        ['status', (o) => mapper.createStatusRequestData(TA, o)],
        ['cancel', (o) => mapper.createCancelRequestData(TA, o)],
        ['refund', (o) => mapper.createRefundRequestData(TA, { amount: 1, ...o }, TX_TYPE.REFUND)],
        ['history', (o) => mapper.createOrderHistoryRequestData(TA, { transaction_date: new Date(), ...o })],
      ]

      describe.each(runs)('%s', (_name, run) => {
        // deviation: the order id must start with a letter or a digit (stricter than a plain character class)
        it.each([
          'sipariş1',
          'a b',
          '',
          'x'.repeat(65),
          '-abc',
          '_abc',
          'a/b',
          'a\n',
          {},
          [],
          true,
          Number.NaN,
          Number.POSITIVE_INFINITY,
        ])('rejects the order id %j', (id) => {
          expect(() => run({ id: id as never })).toThrow(PosError)
          expect(crypt.generateRandomString).not.toHaveBeenCalled()
        })

        it('rejects a missing order id', () => {
          expect(() => run({ id: undefined })).toThrow(PosError)
        })

        it('accepts a numeric order id as text', () => {
          crypt.generateRandomString.mockReturnValue('r')
          crypt.createHash.mockReturnValue('h')
          expect((run({ id: 12345 as never }) as Record<string, unknown>).orderId).toBe('12345')
        })
      })
    })

    it.each([undefined, null, '', 'javascript:alert(1)', 'https://a b', 'https://ş.com', 'ftp://a.com', 42])(
      'rejects the success url %j',
      (url) => {
        expect(() =>
          mapper.create3DFormInitializeRequestData(
            TA,
            { ...registerOrder(), success_url: url as never },
            MODEL.THREE_D_PAY,
            TX_TYPE.PAY_AUTH,
          ),
        ).toThrow(PosError)
      },
    )

    it.each(['x', new Date(Number.NaN), 20231209, '20231209214708'])('rejects the time_span %j', (timeSpan) => {
      const order = { ...registerOrder(), time_span: timeSpan as never }
      expect(() => mapper.create3DFormInitializeRequestData(TA, order, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH)).toThrow(
        PosError,
      )
      expect(() => mapper.createStatusRequestData(TA, { id: 'a', time_span: timeSpan as never })).toThrow(PosError)
      expect(crypt.generateRandomString).not.toHaveBeenCalled()
    })

    it.each([undefined, null, '2023-12-09', new Date(Number.NaN), 20231209])(
      'rejects the transaction_date %j',
      (date) => {
        expect(() => mapper.createOrderHistoryRequestData(TA, { id: 'a', transaction_date: date as never })).toThrow(
          PosError,
        )
      },
    )

    it.each([
      [{ page: 0 }],
      [{ page: -1 }],
      [{ page: 1.5 }],
      [{ page: '1' }],
      [{ page_size: 0 }],
      [{ page_size: '5' }],
      [{ page_size: Number.NaN }],
    ])('rejects the paging %j', (paging) => {
      expect(() =>
        mapper.createOrderHistoryRequestData(TA, { id: 'a', transaction_date: new Date(), ...paging } as PosOrder),
      ).toThrow(PosError)
    })

    it('rejects a refund and a post-auth without an amount', () => {
      expect(() => mapper.createRefundRequestData(TA, { id: 'a' }, TX_TYPE.REFUND)).toThrow(PosError)
      expect(() => mapper.createNonSecurePostAuthPaymentRequestData(TA, { id: 'a' })).toThrow(PosError)
    })

    describe('transaction type guards', () => {
      const others: TxType[] = [
        TX_TYPE.PAY_POST_AUTH,
        TX_TYPE.CANCEL,
        TX_TYPE.REFUND,
        TX_TYPE.REFUND_PARTIAL,
        TX_TYPE.STATUS,
        'bogus' as never,
      ]

      it.each(others)('the sale paths refuse %s', (txType) => {
        expect(() => mapper.createNonSecurePaymentRequestData(TA, registerOrder(), txType, card)).toThrow(
          UnsupportedTransactionTypeError,
        )
        expect(() => mapper.create3DFormInitializeRequestData(TA, registerOrder(), MODEL.THREE_D_PAY, txType)).toThrow(
          UnsupportedTransactionTypeError,
        )
      })

      it.each([TX_TYPE.PAY_AUTH, TX_TYPE.PAY_PRE_AUTH, TX_TYPE.CANCEL, TX_TYPE.STATUS, 'bogus' as never])(
        'the refund path refuses %s',
        (txType) => {
          expect(() => mapper.createRefundRequestData(TA, { id: 'a', amount: 1 }, txType)).toThrow(
            UnsupportedTransactionTypeError,
          )
        },
      )

      it('accepts a partial refund', () => {
        crypt.generateRandomString.mockReturnValue('r')
        crypt.createHash.mockReturnValue('h')
        expect(mapper.createRefundRequestData(TA, { id: 'a', amount: 1 }, TX_TYPE.REFUND_PARTIAL).amount).toBe(100)
      })

      it.each([MODEL.THREE_D_SECURE, MODEL.NON_SECURE, 'x' as never])(
        'the 3D registration refuses the model %s',
        (model) => {
          expect(() => mapper.create3DFormInitializeRequestData(TA, registerOrder(), model, TX_TYPE.PAY_AUTH)).toThrow(
            UnsupportedPaymentModelError,
          )
        },
      )
    })

    describe('3D form data', () => {
      const form = (
        answer: Record<string, unknown> | null,
        model: PaymentModel = MODEL.THREE_D_PAY,
        withCard: typeof card | null = null,
      ) =>
        mapper.create3DFormData(
          TA,
          answer as never,
          model,
          TX_TYPE.PAY_AUTH,
          'https://t.example/api/Payment/ProcessCardForm',
          withCard,
        )

      it.each([undefined, '../x', 'a b', 'a'.repeat(129), '', 12, null, {}, 'a/b', 'ş'])(
        'rejects the session id %j',
        async (id) => {
          await expect(form({ ThreeDSessionId: id })).rejects.toThrow(PosError)
          await expect(form({ ThreeDSessionId: id }, MODEL.THREE_D_HOST)).rejects.toThrow(PosError)
        },
      )

      it('rejects a missing answer and an inherited session id', async () => {
        await expect(form(null)).rejects.toThrow(PosError)
        await expect(form(Object.create({ ThreeDSessionId: 'abc' }))).rejects.toThrow(PosError)
      })

      it('accepts the longest session id', async () => {
        const id = 'a'.repeat(128)
        expect((await form({ ThreeDSessionId: id })).inputs).toEqual({ ThreeDSessionId: id })
      })

      it('without a card the 3D Pay form carries only the session id', async () => {
        const actual = await form({ ThreeDSessionId: SESSION_PAY })
        expectSame(actual.inputs, { ThreeDSessionId: SESSION_PAY })
        expect(actual.method).toBe('POST')
      })

      it('uses an empty holder name when the card has none', async () => {
        const noName = CreditCardFactory.create('5555444433332222', '22', '01', '123')
        const actual = await form({ ThreeDSessionId: SESSION_PAY }, MODEL.THREE_D_PAY, noName)
        expect(actual.inputs.CardHolderName).toBe('')
      })

      // addition: a card without a holder name is sent with an empty text, never as an undefined value
      it('the non-secure request uses an empty holder name when the card has none', () => {
        const noName = CreditCardFactory.create('5555444433332222', '22', '01', '123')
        const request = mapper.createNonSecurePaymentRequestData(TA, registerOrder(), TX_TYPE.PAY_AUTH, noName)
        expect(request.cardHolderName).toBe('')
      })

      it('the 3D Host form never carries the card', async () => {
        const actual = await form({ ThreeDSessionId: SESSION_HOST }, MODEL.THREE_D_HOST, card)
        expect(actual.inputs).toEqual({})
      })

      it.each([MODEL.THREE_D_SECURE, MODEL.NON_SECURE, 'x' as never])('refuses the model %s', async (model) => {
        await expect(form({ ThreeDSessionId: SESSION_PAY }, model)).rejects.toThrow(UnsupportedPaymentModelError)
      })

      it('refuses a tx type that is no sale', async () => {
        await expect(
          mapper.create3DFormData(
            TA,
            { ThreeDSessionId: SESSION_PAY },
            MODEL.THREE_D_PAY,
            TX_TYPE.CANCEL,
            'https://t.example/x',
            null,
          ),
        ).rejects.toThrow(UnsupportedTransactionTypeError)
      })
    })

    it('uses the Turkiye time of now as the default time span', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-01T21:30:00Z'))
      crypt.generateRandomString.mockReturnValue('r')
      crypt.createHash.mockReturnValue('h')
      expect(mapper.createStatusRequestData(TA, { id: 'a' }).timeSpan).toBe('20240102003000')
      expect(mapper.createNonSecurePostAuthPaymentRequestData(TA, { id: 'a', amount: 1 }).timeSpan).toBe(
        '20240102003000',
      )
      expect(mapper.createOrderHistoryRequestData(TA, { id: 'a', transaction_date: new Date() }).timeSpan).toBe(
        '20240102003000',
      )
    })

    it('produces no value containing "undefined"', () => {
      crypt.generateRandomString.mockReturnValue('r')
      crypt.createHash.mockReturnValue('h')
      const base = { id: 'a', amount: 1, time_span: new Date('2023-12-09T21:47:08+03:00') }
      const results = [
        mapper.create3DFormInitializeRequestData(TA, registerOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_PRE_AUTH),
        mapper.createNonSecurePaymentRequestData(TA, registerOrder(), TX_TYPE.PAY_AUTH, card),
        mapper.createNonSecurePostAuthPaymentRequestData(TA, base),
        mapper.createStatusRequestData(TA, base),
        mapper.createCancelRequestData(TA, base),
        mapper.createRefundRequestData(TA, base, TX_TYPE.REFUND),
        mapper.createOrderHistoryRequestData(TA, { ...base, transaction_date: new Date() }),
      ]
      for (const result of results) expectNoUndefined(result)
    })

    it('does not mutate the caller order and fills its defaults on a copy', () => {
      crypt.generateRandomString.mockReturnValue('r')
      crypt.createHash.mockReturnValue('h')
      const order = Object.freeze({ id: 'a', amount: 1, success_url: 'https://domain.com/s' }) as PosOrder
      const copy = { ...order }
      mapper.create3DFormInitializeRequestData(TA, order, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH)
      mapper.createNonSecurePaymentRequestData(TA, order, TX_TYPE.PAY_AUTH, card)
      mapper.createNonSecurePostAuthPaymentRequestData(TA, order)
      mapper.createStatusRequestData(TA, order)
      mapper.createCancelRequestData(TA, order)
      mapper.createRefundRequestData(TA, order, TX_TYPE.REFUND)
      expect(order).toEqual(copy)
    })

    it('ignores inherited order values', () => {
      const order = Object.create({ id: 'inherited', amount: 5 }) as PosOrder
      expect(() => mapper.createCancelRequestData(TA, order)).toThrow(PosError)
    })

    it('never requests a random value when validation fails', () => {
      expect(() => mapper.createCancelRequestData(TA, { id: '' })).toThrow(PosError)
      expect(crypt.generateRandomString).not.toHaveBeenCalled()
      expect(crypt.createHash).not.toHaveBeenCalled()
    })
  })
})
