import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InterPosCrypt } from '../../../../../src/crypt/InterPosCrypt.js'
import { InterPosRequestDataMapper } from '../../../../../src/data-mapper/request/mapper/InterPosRequestDataMapper.js'
import { InterPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/InterPosRequestValueFormatter.js'
import { InterPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/InterPosRequestValueMapper.js'
import { NotImplementedError, PosError } from '../../../../../src/errors.js'
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
import { FormEncoder } from '../../../../../src/serializer/FormEncoder.js'
import type { Before3DFormHashCalculatedEvent, PosOrder } from '../../../../../src/types.js'

const D = AccountFactory.createInterPosAccount('denizbank', '3123', 'InterTestApi', '3', 'gDg1N')
const card = CreditCardFactory.create('5555444433332222', '21', '12', '122', 'ahmet', CARD_TYPE.VISA)

/** Same values with the same key order: compare the serialised form as well. */
function expectSame(actual: unknown, expected: unknown): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
  expect(actual).toStrictEqual(expected)
}

/** Key-sorted copy, for the rows whose key order is not part of the expectation. */
function sorted(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** Fails on an `undefined` anywhere, including keys whose value is undefined (JSON would drop them). */
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

const s1 = (text: string): string => createHash('sha1').update(text, 'utf8').digest('base64')

type CryptStub = Record<'create3DHash' | 'generateRandomString', ReturnType<typeof vi.fn>>

function makeMapper(
  crypt: unknown,
  hooks: Array<(e: Before3DFormHashCalculatedEvent) => void | Promise<void>> = [],
): InterPosRequestDataMapper {
  return new InterPosRequestDataMapper(
    new InterPosRequestValueMapper(),
    new InterPosRequestValueFormatter(),
    { onBefore3DFormHashCalculated: hooks },
    crypt as InterPosCrypt,
    LANG.EN,
  )
}

const formOrder: PosOrder = {
  id: 'order222',
  ip: '127.0.0.1',
  amount: '100.25' as never,
  installment: 0,
  currency: CURRENCY.TRY,
  success_url: 'https://domain.com/success',
  fail_url: 'https://domain.com/fail_url',
  lang: LANG.TR,
}

const callback = { MD: '1', PayerTxnId: '2', Eci: '3', PayerAuthenticationCode: '4' }

describe('InterPosRequestDataMapper', () => {
  let crypt: CryptStub
  let hook: ReturnType<typeof vi.fn<(e: Before3DFormHashCalculatedEvent) => void>>
  let mapper: InterPosRequestDataMapper

  beforeEach(() => {
    crypt = { create3DHash: vi.fn(), generateRandomString: vi.fn() }
    hook = vi.fn()
    mapper = makeMapper(crypt, [hook])
  })

  it('supports only InterPos', () => {
    expect(InterPosRequestDataMapper.supports('InterPos')).toBe(true)
    expect(InterPosRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  it('creates the post-auth request', () => {
    expectSame(mapper.createNonSecurePostAuthPaymentRequestData(D, { id: 'order222', amount: 10.0 }), {
      UserCode: 'InterTestApi',
      UserPass: '3',
      ShopCode: '3123',
      TxnType: 'PostAuth',
      SecureType: 'NonSecure',
      OrderId: null,
      orgOrderId: 'order222',
      PurchAmount: '10',
      Currency: '949',
      MOTO: '0',
    })
  })

  it('creates the non-secure payment request', () => {
    expectSame(
      mapper.createNonSecurePaymentRequestData(
        D,
        {
          id: 'order222',
          amount: '100.25' as never,
          installment: 0,
          currency: CURRENCY.TRY,
          lang: LANG.TR,
        },
        TX_TYPE.PAY_AUTH,
        card,
      ),
      {
        UserCode: 'InterTestApi',
        UserPass: '3',
        ShopCode: '3123',
        TxnType: 'Auth',
        SecureType: 'NonSecure',
        OrderId: 'order222',
        PurchAmount: '100.25',
        Currency: '949',
        InstallmentCount: '',
        MOTO: '0',
        Lang: 'tr',
        CardType: '0',
        Pan: '5555444433332222',
        Expiry: '1221',
        Cvv2: '122',
      },
    )
  })

  it('creates the cancel request', () => {
    expectSame(mapper.createCancelRequestData(D, { id: '2020110828BC', lang: LANG.EN }), {
      UserCode: 'InterTestApi',
      UserPass: '3',
      ShopCode: '3123',
      OrderId: null,
      orgOrderId: '2020110828BC',
      TxnType: 'Void',
      SecureType: 'NonSecure',
      Lang: 'en',
    })
  })

  it('creates the 3D provision request', () => {
    expectSame(
      mapper.create3DPaymentRequestData(
        D,
        { id: 'order222', amount: '100.25' as never, lang: LANG.TR },
        TX_TYPE.PAY_AUTH,
        callback,
      ),
      {
        UserCode: 'InterTestApi',
        UserPass: '3',
        ShopCode: '3123',
        TxnType: 'Auth',
        SecureType: 'NonSecure',
        OrderId: 'order222',
        PurchAmount: '100.25',
        Currency: '949',
        InstallmentCount: '',
        MD: '1',
        PayerTxnId: '2',
        Eci: '3',
        PayerAuthenticationCode: '4',
        MOTO: '0',
        Lang: 'tr',
      },
    )
  })

  describe('3D form', () => {
    const rows: Array<[string, string, PaymentModel, boolean, Record<string, string>]> = [
      [
        'without_card',
        'https://test.inter-vpos.com.tr/mpi/Default.aspx',
        MODEL.THREE_D_SECURE,
        false,
        {
          ShopCode: '3123',
          TxnType: 'Auth',
          SecureType: '3DModel',
          PurchAmount: '100.25',
          OrderId: 'order222',
          OkUrl: 'https://domain.com/success',
          FailUrl: 'https://domain.com/fail_url',
          Rnd: 'rand-12',
          Lang: 'tr',
          Currency: '949',
          InstallmentCount: '',
          Hash: 'vEbwP8wnsGrBR9oCjfxP9wlho1g=',
        },
      ],
      [
        'with_card',
        'https://entegrasyon.asseco-see.com.tr/fim/est3Dgate',
        MODEL.THREE_D_SECURE,
        true,
        {
          ShopCode: '3123',
          TxnType: 'Auth',
          SecureType: '3DModel',
          PurchAmount: '100.25',
          OrderId: 'order222',
          OkUrl: 'https://domain.com/success',
          FailUrl: 'https://domain.com/fail_url',
          Rnd: 'rand-12',
          Lang: 'tr',
          Currency: '949',
          InstallmentCount: '',
          CardType: '0',
          Pan: '5555444433332222',
          Expiry: '1221',
          Cvv2: '122',
          Hash: 'vEbwP8wnsGrBR9oCjfxP9wlho1g=',
        },
      ],
      [
        '3d_host',
        'https://test.inter-vpos.com.tr/mpi/3DHost.aspx',
        MODEL.THREE_D_HOST,
        false,
        {
          ShopCode: '3123',
          TxnType: 'Auth',
          SecureType: '3DHost',
          PurchAmount: '100.25',
          OrderId: 'order222',
          OkUrl: 'https://domain.com/success',
          FailUrl: 'https://domain.com/fail_url',
          Rnd: 'rand-12',
          Lang: 'tr',
          Currency: '949',
          InstallmentCount: '',
          Hash: 'vEbwP8wnsGrBR9oCjfxP9wlho1g=',
        },
      ],
    ]

    it.each(rows)('builds the form: %s', async (_name, gatewayUrl, model, withCard, inputs) => {
      crypt.create3DHash.mockReturnValue(inputs.Hash)
      crypt.generateRandomString.mockReturnValue(inputs.Rnd)

      const actual = await mapper.create3DFormData(
        D,
        formOrder,
        model,
        TX_TYPE.PAY_AUTH,
        gatewayUrl,
        withCard ? card : null,
      )

      expectSame(actual, { gateway: gatewayUrl, method: 'POST', inputs })
      expect(crypt.create3DHash).toHaveBeenCalledTimes(1)
      expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
      expect(hook).toHaveBeenCalledTimes(1)
      const event = hook.mock.calls[0]?.[0] as Before3DFormHashCalculatedEvent
      expect(event.gatewayClass).toBe('InterPos')
      expect(event.txType).toBe(TX_TYPE.PAY_AUTH)
      expect(event.paymentModel).toBe(model)
      expect(Object.keys(event.formInputs).length).toBeGreaterThan(3)
    })
  })

  it('creates the status request', () => {
    expectSame(mapper.createStatusRequestData(D, { id: 'order222', lang: LANG.TR }), {
      UserCode: 'InterTestApi',
      UserPass: '3',
      ShopCode: '3123',
      OrderId: null,
      orgOrderId: 'order222',
      TxnType: 'StatusHistory',
      SecureType: 'NonSecure',
      Lang: 'tr',
    })
  })

  it.each([TX_TYPE.REFUND, TX_TYPE.REFUND_PARTIAL])('creates the refund request (%s)', (txType) => {
    const actual = mapper.createRefundRequestData(D, { id: '2020110828BC', amount: 123.1 }, txType)

    expect(sorted(actual)).toStrictEqual({
      Lang: 'en',
      MOTO: '0',
      OrderId: null,
      PurchAmount: '123.1',
      SecureType: 'NonSecure',
      ShopCode: '3123',
      TxnType: 'Refund',
      UserCode: 'InterTestApi',
      UserPass: '3',
      orgOrderId: '2020110828BC',
    })
  })

  it('does not support the order history request', () => {
    expect(() => mapper.createOrderHistoryRequestData(D, {} as PosOrder)).toThrow(NotImplementedError)
  })

  // addition: everything below is hardening of the request data
  describe('with the real crypt', () => {
    let real: InterPosCrypt

    beforeEach(() => {
      real = new InterPosCrypt()
      vi.spyOn(real, 'generateRandomString').mockReturnValue('rand-12')
    })

    it('signs the with_card form like the bank documents it', async () => {
      const form = await makeMapper(real).create3DFormData(
        D,
        formOrder,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        'https://test.inter-vpos.com.tr/mpi/Default.aspx',
        card,
      )

      expect(form.inputs.Hash).toBe('54l+lsAXyCZlcRvg9m2SyrcSV9M=')
      expect(Object.keys(form.inputs).at(-1)).toBe('Hash')
    })

    it('signs what the hooks left, not what was built', async () => {
      const bump = (e: Before3DFormHashCalculatedEvent): void => {
        e.formInputs.PurchAmount = '999'
      }
      const form = await makeMapper(real, [bump]).create3DFormData(
        D,
        formOrder,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        'https://test.inter-vpos.com.tr/mpi/Default.aspx',
      )

      expect(form.inputs.PurchAmount).toBe('999')
      expect(form.inputs.Hash).toBe(
        s1(`3123order222999${formOrder.success_url}${formOrder.fail_url}Auth${''}rand-12gDg1N`),
      )
    })
  })

  describe('amounts', () => {
    const order = (amount: unknown): PosOrder => ({ ...formOrder, amount: amount as never })

    it('rounds a sub-kurus amount the same way everywhere', async () => {
      crypt.create3DHash.mockReturnValue('h')
      crypt.generateRandomString.mockReturnValue('r')
      const o = order(1.005)

      expect(
        (await mapper.create3DFormData(D, o, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'https://x.test')).inputs
          .PurchAmount,
      ).toBe('1.01')
      expect(mapper.create3DPaymentRequestData(D, o, TX_TYPE.PAY_AUTH, callback).PurchAmount).toBe('1.01')
      expect(mapper.createNonSecurePaymentRequestData(D, o, TX_TYPE.PAY_AUTH, card).PurchAmount).toBe('1.01')
      expect(mapper.createNonSecurePostAuthPaymentRequestData(D, o).PurchAmount).toBe('1.01')
      expect(mapper.createRefundRequestData(D, o, TX_TYPE.REFUND).PurchAmount).toBe('1.01')
    })

    it('reads a decimal text amount', () => {
      expect(mapper.createRefundRequestData(D, order('1.75'), TX_TYPE.REFUND).PurchAmount).toBe('1.75')
    })

    it.each([0, -1, 0.004, 'abc', 1e13, Number.NaN, Number.POSITIVE_INFINITY, '1e3', ''])(
      'rejects the amount %j on every path',
      async (amount) => {
        crypt.create3DHash.mockReturnValue('h')
        crypt.generateRandomString.mockReturnValue('r')
        const o = order(amount)

        await expect(
          mapper.create3DFormData(D, o, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'https://x.test'),
        ).rejects.toThrow(PosError)
        expect(() => mapper.create3DPaymentRequestData(D, o, TX_TYPE.PAY_AUTH, callback)).toThrow(PosError)
        expect(() => mapper.createNonSecurePaymentRequestData(D, o, TX_TYPE.PAY_AUTH, card)).toThrow(PosError)
        expect(() => mapper.createNonSecurePostAuthPaymentRequestData(D, o)).toThrow(PosError)
        expect(() => mapper.createRefundRequestData(D, o, TX_TYPE.REFUND)).toThrow(PosError)
      },
    )
  })

  describe('installments', () => {
    it.each([
      [2, '2'],
      ['3', '3'],
      [1, ''],
      [0, ''],
      [undefined, ''],
      [99, '99'],
    ])('formats %j as %j', (value, expected) => {
      const request = mapper.createNonSecurePaymentRequestData(
        D,
        { ...formOrder, installment: value as never },
        TX_TYPE.PAY_AUTH,
        card,
      )
      expect(request.InstallmentCount).toBe(expected)
    })

    it.each([1.5, -1, 'x', 100, 'abc', '1e1'])('rejects %j', (value) => {
      expect(() =>
        mapper.createNonSecurePaymentRequestData(
          D,
          { ...formOrder, installment: value as never },
          TX_TYPE.PAY_AUTH,
          card,
        ),
      ).toThrow(PosError)
      expect(() =>
        mapper.create3DPaymentRequestData(D, { ...formOrder, installment: value as never }, TX_TYPE.PAY_AUTH, callback),
      ).toThrow(PosError)
    })
  })

  describe('order id', () => {
    it.each(['sipariş1', 'a&b', 'a b', '', 'x'.repeat(65)])('rejects %j in every method', async (id) => {
      crypt.create3DHash.mockReturnValue('h')
      crypt.generateRandomString.mockReturnValue('r')
      const o: PosOrder = { ...formOrder, id }

      await expect(
        mapper.create3DFormData(D, o, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'https://x.test'),
      ).rejects.toThrow(PosError)
      expect(() => mapper.create3DPaymentRequestData(D, o, TX_TYPE.PAY_AUTH, callback)).toThrow(PosError)
      expect(() => mapper.createNonSecurePaymentRequestData(D, o, TX_TYPE.PAY_AUTH, card)).toThrow(PosError)
      expect(() => mapper.createNonSecurePostAuthPaymentRequestData(D, o)).toThrow(PosError)
      expect(() => mapper.createStatusRequestData(D, o)).toThrow(PosError)
      expect(() => mapper.createCancelRequestData(D, o)).toThrow(PosError)
      expect(() => mapper.createRefundRequestData(D, o, TX_TYPE.REFUND)).toThrow(PosError)
    })

    it('accepts a numeric id and a 64 character id', () => {
      expect(mapper.createStatusRequestData(D, { id: 33554969 as never }).orgOrderId).toBe('33554969')
      expect(mapper.createStatusRequestData(D, { id: 'x'.repeat(64) }).orgOrderId).toBe('x'.repeat(64))
    })
  })

  describe('missing order fields', () => {
    beforeEach(() => {
      crypt.create3DHash.mockReturnValue('h')
      crypt.generateRandomString.mockReturnValue('r')
    })

    it.each(['id', 'amount', 'success_url', 'fail_url'] as const)('the form needs %s', async (key) => {
      const o: PosOrder = { ...formOrder }
      delete o[key]
      await expect(
        mapper.create3DFormData(D, o, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'https://x.test'),
      ).rejects.toThrow(PosError)
    })

    it('rejects a form without an order', async () => {
      await expect(
        mapper.create3DFormData(D, null, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'https://x.test'),
      ).rejects.toThrow(PosError)
    })

    it.each(['id', 'amount'] as const)('provision, non-secure, post-auth and refund need %s', (key) => {
      const o: PosOrder = { id: 'order222', amount: 1 }
      delete o[key]
      expect(() => mapper.create3DPaymentRequestData(D, o, TX_TYPE.PAY_AUTH, callback)).toThrow(PosError)
      expect(() => mapper.createNonSecurePaymentRequestData(D, o, TX_TYPE.PAY_AUTH, card)).toThrow(PosError)
      expect(() => mapper.createNonSecurePostAuthPaymentRequestData(D, o)).toThrow(PosError)
      expect(() => mapper.createRefundRequestData(D, o, TX_TYPE.REFUND)).toThrow(PosError)
    })

    it('status and cancel need the id', () => {
      expect(() => mapper.createStatusRequestData(D, {})).toThrow(PosError)
      expect(() => mapper.createCancelRequestData(D, {})).toThrow(PosError)
    })

    it('never produces an undefined value', async () => {
      const o: PosOrder = { id: 'order222', amount: 1 }
      expectNoUndefined(
        await mapper.create3DFormData(D, formOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'https://x.test', card),
      )
      expectNoUndefined(mapper.create3DPaymentRequestData(D, o, TX_TYPE.PAY_AUTH, callback))
      expectNoUndefined(mapper.createNonSecurePaymentRequestData(D, o, TX_TYPE.PAY_AUTH, card))
      expectNoUndefined(mapper.createNonSecurePostAuthPaymentRequestData(D, o))
      expectNoUndefined(mapper.createStatusRequestData(D, o))
      expectNoUndefined(mapper.createCancelRequestData(D, o))
      expectNoUndefined(mapper.createRefundRequestData(D, o, TX_TYPE.REFUND))
    })
  })

  describe('3D callback values', () => {
    const order: PosOrder = { id: 'order222', amount: '100.25' as never }

    it.each([
      ['empty MD', { ...callback, MD: '' }],
      ['missing MD', { PayerTxnId: '2', Eci: '3', PayerAuthenticationCode: '4' }],
      ['missing PayerTxnId', { MD: '1', Eci: '3', PayerAuthenticationCode: '4' }],
      ['missing Eci', { MD: '1', PayerTxnId: '2', PayerAuthenticationCode: '4' }],
      ['missing PayerAuthenticationCode', { MD: '1', PayerTxnId: '2', Eci: '3' }],
      ['numeric Eci', { ...callback, Eci: 2 }],
      ['object PayerAuthenticationCode', { ...callback, PayerAuthenticationCode: {} }],
      ['array PayerTxnId', { ...callback, PayerTxnId: ['x'] }],
      ['null MD', { ...callback, MD: null }],
    ])('rejects %s', (_name, data) => {
      expect(() => mapper.create3DPaymentRequestData(D, order, TX_TYPE.PAY_AUTH, data as never)).toThrow(PosError)
    })

    it('accepts empty authentication values other than MD', () => {
      const request = mapper.create3DPaymentRequestData(D, order, TX_TYPE.PAY_AUTH, {
        MD: 'x',
        PayerTxnId: '',
        Eci: '',
        PayerAuthenticationCode: '',
      })
      expect(request.PayerTxnId).toBe('')
    })

    it('does not read inherited callback values', () => {
      const inherited = Object.create(callback) as Record<string, unknown>
      expect(() => mapper.create3DPaymentRequestData(D, order, TX_TYPE.PAY_AUTH, inherited)).toThrow(PosError)
    })
  })

  describe('transaction type guards', () => {
    it('refund accepts only refund types', () => {
      expect(() => mapper.createRefundRequestData(D, { id: 'a', amount: 1 }, TX_TYPE.PAY_AUTH)).toThrow(PosError)
      expect(() => mapper.createRefundRequestData(D, { id: 'a', amount: 1 }, TX_TYPE.CANCEL)).toThrow(PosError)
    })

    it.each([TX_TYPE.CANCEL, TX_TYPE.REFUND, TX_TYPE.STATUS, TX_TYPE.PAY_POST_AUTH] as TxType[])(
      'payments and the form refuse %s',
      async (txType) => {
        crypt.create3DHash.mockReturnValue('h')
        crypt.generateRandomString.mockReturnValue('r')
        await expect(
          mapper.create3DFormData(D, formOrder, MODEL.THREE_D_SECURE, txType, 'https://x.test'),
        ).rejects.toThrow(PosError)
        expect(() => mapper.createNonSecurePaymentRequestData(D, formOrder, txType, card)).toThrow(PosError)
        expect(() => mapper.create3DPaymentRequestData(D, formOrder, txType, callback)).toThrow(PosError)
      },
    )

    it('pre-authorization is allowed', () => {
      expect(mapper.createNonSecurePaymentRequestData(D, formOrder, TX_TYPE.PAY_PRE_AUTH, card).TxnType).toBe('PreAuth')
    })
  })

  describe('wire form and card fields', () => {
    it('leaves OrderId out of the encoded status request', () => {
      const body = FormEncoder.encode(mapper.createStatusRequestData(D, { id: 'order222' }))
      expect(body).not.toMatch(/(^|&)OrderId=/)
      expect(body).toContain('orgOrderId=order222')
    })

    it('keeps CardType as null for a non-secure card without a type and the encoder omits it', () => {
      const untyped = CreditCardFactory.create('5555444433332222', '21', '12', '122')
      const request = mapper.createNonSecurePaymentRequestData(D, formOrder, TX_TYPE.PAY_AUTH, untyped)

      expect(Object.hasOwn(request, 'CardType')).toBe(true)
      expect(request.CardType).toBeNull()
      expect(FormEncoder.encode(request)).not.toContain('CardType')
    })

    it('sends an empty CardType in the 3D form for a card without a type', async () => {
      crypt.create3DHash.mockReturnValue('h')
      crypt.generateRandomString.mockReturnValue('r')
      const untyped = CreditCardFactory.create('5555444433332222', '21', '12', '122')
      const form = await mapper.create3DFormData(
        D,
        formOrder,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        'https://x.test',
        untyped,
      )

      expect(form.inputs.CardType).toBe('')
    })

    it('maps the troy card type', () => {
      const troy = CreditCardFactory.create('5555444433332222', '21', '12', '122', 'a', CARD_TYPE.TROY)
      expect(mapper.createNonSecurePaymentRequestData(D, formOrder, TX_TYPE.PAY_AUTH, troy).CardType).toBe('3')
    })

    it('adds no card keys without a card (hosted page)', async () => {
      crypt.create3DHash.mockReturnValue('h')
      crypt.generateRandomString.mockReturnValue('r')
      const form = await mapper.create3DFormData(
        D,
        formOrder,
        MODEL.THREE_D_HOST,
        TX_TYPE.PAY_AUTH,
        'https://x.test',
        null,
      )

      for (const key of ['CardType', 'Pan', 'Expiry', 'Cvv2']) {
        expect(Object.hasOwn(form.inputs, key)).toBe(false)
      }
    })
  })

  it('does not change the order it is given', async () => {
    crypt.create3DHash.mockReturnValue('h')
    crypt.generateRandomString.mockReturnValue('r')
    const o: PosOrder = { ...formOrder }
    const before = JSON.stringify(o)

    await mapper.create3DFormData(D, o, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'https://x.test', card)
    mapper.create3DPaymentRequestData(D, o, TX_TYPE.PAY_AUTH, callback)
    mapper.createNonSecurePaymentRequestData(D, o, TX_TYPE.PAY_AUTH, card)
    mapper.createNonSecurePostAuthPaymentRequestData(D, o)
    mapper.createStatusRequestData(D, o)
    mapper.createCancelRequestData(D, o)
    mapper.createRefundRequestData(D, o, TX_TYPE.REFUND)

    expect(JSON.stringify(o)).toBe(before)
  })
})
