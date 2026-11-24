import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PosNetPosCrypt } from '../../../../../src/crypt/PosNetPosCrypt.js'
import { PosNetPosRequestDataMapper } from '../../../../../src/data-mapper/request/mapper/PosNetPosRequestDataMapper.js'
import { PosNetPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/PosNetPosRequestValueFormatter.js'
import { PosNetPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/PosNetPosRequestValueMapper.js'
import { NotImplementedError, PosError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import { CURRENCY, LANG, MODEL, TX_TYPE } from '../../../../../src/PosInterface.js'
import type { Before3DFormHashCalculatedEvent, PosOrder } from '../../../../../src/types.js'

const account = AccountFactory.createPosNetPosAccount(
  'yapikredi',
  '6706598320',
  '67005551',
  '27426',
  '10,10,10,10,10,10,10,10',
)
const card = CreditCardFactory.create('5555444433332222', '22', '01', '123', 'ahmet')

/** PHP assertSame on arrays also compares key order: compare the serialised form as well. */
function expectSame(actual: unknown, expected: unknown): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
  expect(actual).toStrictEqual(expected)
}

const baseOrder = (): PosOrder => ({
  id: 'TST_190620093100_024',
  amount: '1.75' as never,
  installment: 0,
  currency: CURRENCY.TRY,
  success_url: 'https://domain.com/success',
  fail_url: 'https://domain.com/fail_url',
  lang: LANG.TR,
})

const packets = {
  BankPacket: 'F61E1D0C0FB6EC5203A748124F309998F61E1D0C0FB6EC5203A748124F30',
  MerchantPacket: 'E1D0C0FB6EC5203A748124F309998F61E1D0C0FB6EC5203A748124F309998F61E1D0C0FB6EC5203A748124F30',
  Sign: '9998F61E1D0C0FB6EC5203A748124F30',
}

const MAC = 'oE7zwV87uOc2DFpGPlr4jQRQ0z9LsxGw56c7vaiZkTo='

describe('PosNetPosRequestDataMapper', () => {
  let crypt: Record<
    'hashString' | 'check3DHash' | 'create3DHash' | 'createHash' | 'hashFromParams' | 'generateRandomString',
    ReturnType<typeof vi.fn>
  >
  let hook: ReturnType<typeof vi.fn<(e: Before3DFormHashCalculatedEvent) => void>>
  let mapper: PosNetPosRequestDataMapper

  beforeEach(() => {
    crypt = {
      hashString: vi.fn(),
      check3DHash: vi.fn(),
      create3DHash: vi.fn(),
      createHash: vi.fn(),
      hashFromParams: vi.fn(),
      generateRandomString: vi.fn(),
    }
    hook = vi.fn()
    mapper = new PosNetPosRequestDataMapper(
      new PosNetPosRequestValueMapper(),
      new PosNetPosRequestValueFormatter(),
      { onBefore3DFormHashCalculated: [hook] },
      crypt as unknown as PosNetPosCrypt,
      LANG.EN,
    )
  })

  it('supports only PosNetPos', () => {
    expect(PosNetPosRequestDataMapper.supports('PosNetPos')).toBe(true)
    expect(PosNetPosRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  describe('non-secure post-auth', () => {
    it('maps the capture', () => {
      const order = {
        id: '2020110828BC',
        ref_ret_num: '019676067890000191',
        amount: 10.02,
        currency: CURRENCY.TRY,
        installment: 2,
      }
      expectSame(mapper.createNonSecurePostAuthPaymentRequestData(account, order), {
        mid: '6706598320',
        tid: '67005551',
        tranDateRequired: '1',
        capt: { hostLogKey: '019676067890000191', amount: 1002, currencyCode: 'TL', installment: '02' },
      })
    })
  })

  describe('non-secure payment', () => {
    it('maps the sale', () => {
      const order = { id: 'TST_190620093100_024', amount: '1.75' as never, installment: 0 }
      expectSame(mapper.createNonSecurePaymentRequestData(account, order, TX_TYPE.PAY_AUTH, card), {
        mid: '6706598320',
        tid: '67005551',
        tranDateRequired: '1',
        sale: {
          orderID: 'TST_190620093100_024',
          installment: '00',
          amount: 175,
          currencyCode: 'TL',
          ccno: '5555444433332222',
          expDate: '2201',
          cvc: '123',
        },
      })
    })
  })

  describe('cancel', () => {
    const wrap = (reverse: Record<string, string>) => ({
      mid: '6706598320',
      tid: '67005551',
      tranDateRequired: '1',
      reverse,
    })

    it.each([
      ['with_order_id', { id: '2020110828BC' }, wrap({ transaction: 'sale', orderID: 'TDSC000000002020110828BC' })],
      [
        'with_ref_ret_num',
        { ref_ret_num: '019676067890000191' },
        wrap({ transaction: 'sale', hostLogKey: '019676067890000191' }),
      ],
      [
        'with_auth_code',
        { id: '2020110828BC', auth_code: '901477' },
        wrap({ transaction: 'sale', authCode: '901477', orderID: 'TDSC000000002020110828BC' }),
      ],
      [
        'pre_pay',
        { id: '2020110828BC', transaction_type: TX_TYPE.PAY_PRE_AUTH },
        wrap({ transaction: 'auth', orderID: 'TDSC000000002020110828BC' }),
      ],
    ])('%s', (_name, order, expected) => {
      expectSame(mapper.createCancelRequestData(account, order as PosOrder), expected)
    })
  })

  describe('3D payment (tran)', () => {
    it('maps the packets and signs with the mapped order', () => {
      const expected = {
        mid: '6706598320',
        tid: '67005551',
        oosTranData: {
          bankData: packets.BankPacket,
          merchantData: packets.MerchantPacket,
          sign: packets.Sign,
          wpAmount: 0,
          mac: MAC,
        },
      }
      const { mac: _mac, ...tranWithoutMac } = expected.oosTranData
      const withoutMac = { ...expected, oosTranData: tranWithoutMac }
      crypt.createHash.mockReturnValue(MAC)

      const order = { id: '2020110828BC', amount: 100.01, installment: '0' as never, currency: CURRENCY.TRY }
      const actual = mapper.create3DPaymentRequestData(account, order, TX_TYPE.PAY_AUTH, packets)

      expectSame(actual, expected)
      expect(crypt.createHash).toHaveBeenCalledTimes(1)
      const call = crypt.createHash.mock.calls[0] as unknown[]
      expect(call[0]).toBe(account)
      expectSame(call[1], withoutMac)
      expect(call[2]).toStrictEqual({ id: '000000002020110828BC', amount: 10001, currency: 'TL' })
    })
  })

  describe('3D form initialisation', () => {
    it('maps the oos request', () => {
      const order = { id: 'TST_190620093100_024', amount: 1.75, installment: 0, currency: CURRENCY.TRY }
      expectSame(
        mapper.create3DFormInitializeRequestData(account, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
        {
          mid: '6706598320',
          tid: '67005551',
          oosRequestData: {
            posnetid: '27426',
            ccno: '5555444433332222',
            expDate: '2201',
            cvc: '123',
            amount: 175,
            currencyCode: 'TL',
            installment: '00',
            XID: 'TST_190620093100_024',
            cardHolderName: 'ahmet',
            tranType: 'Sale',
          },
        },
      )
    })

    it('rejects a too long order id', () => {
      // deviation: P28 typed error instead of InvalidArgumentException
      const order = { ...baseOrder(), id: 'd32458293945098y439244343' }
      expect(() =>
        mapper.create3DFormInitializeRequestData(account, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
      ).toThrow(PosError)
    })

    it('throws without a card', () => {
      // deviation: P28 typed error instead of InvalidArgumentException
      expect(() =>
        mapper.create3DFormInitializeRequestData(account, baseOrder(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH),
      ).toThrow(PosError)
    })
  })

  describe('3D resolve merchant data', () => {
    it('maps the packets and signs with the mapped order', () => {
      crypt.createHash.mockReturnValue(MAC)
      const order = { id: '2020110828BC', amount: 100.01, installment: '0' as never, currency: CURRENCY.TRY }
      const expected = {
        mid: '6706598320',
        tid: '67005551',
        oosResolveMerchantData: {
          bankData: packets.BankPacket,
          merchantData: packets.MerchantPacket,
          sign: packets.Sign,
          mac: MAC,
        },
      }

      const actual = mapper.create3DResolveMerchantRequestData(account, order, packets)

      expectSame(actual, expected)
      const call = crypt.createHash.mock.calls[0] as unknown[]
      expect(call[0]).toBe(account)
      expectSame(call[1], {
        mid: '6706598320',
        tid: '67005551',
        oosResolveMerchantData: {
          bankData: packets.BankPacket,
          merchantData: packets.MerchantPacket,
          sign: packets.Sign,
        },
      })
      expect(call[2]).toStrictEqual({ id: '000000002020110828BC', amount: 10001, currency: 'TL' })
      expect(crypt.createHash).toHaveBeenCalledTimes(1)
    })
  })

  describe('3D form data', () => {
    const extra = {
      data1: 'AEFE78BFC852867FF57078B723E284D1',
      data2: '69D04861340091B7014B15158CA3C834',
      sign: '9998F61E1D0C0FB6EC5203A748124F30',
    }

    it('builds the form', async () => {
      const order = { id: 'TST_190620093100_024', amount: '1.75' as never, success_url: 'https://domain.com/success' }
      const actual = await mapper.create3DFormData(
        account,
        order,
        MODEL.THREE_D_SECURE,
        '' as never,
        'https://setmpos.ykb.com/3DSWebService/YKBPaymentService',
        null,
        extra,
      )
      expectSame(actual, {
        gateway: 'https://setmpos.ykb.com/3DSWebService/YKBPaymentService',
        method: 'POST',
        inputs: {
          mid: '6706598320',
          posnetID: '27426',
          posnetData: extra.data1,
          posnetData2: extra.data2,
          digest: extra.sign,
          merchantReturnURL: 'https://domain.com/success',
          url: '',
          lang: 'en',
        },
      })
      expect(hook).not.toHaveBeenCalled()
    })

    it('throws without extra data', async () => {
      // deviation: P28 typed error instead of InvalidArgumentException
      await expect(
        mapper.create3DFormData(account, {}, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, '/api'),
      ).rejects.toThrow(PosError)
    })
  })

  describe('status', () => {
    it.each([
      [MODEL.THREE_D_SECURE, 'TDSC000000002020110828BC'],
      [MODEL.NON_SECURE, '0000000000002020110828BC'],
    ])('model %s', (paymentModel, orderID) => {
      expectSame(mapper.createStatusRequestData(account, { id: '2020110828BC', payment_model: paymentModel }), {
        mid: '6706598320',
        tid: '67005551',
        agreement: { orderID },
      })
    })
  })

  describe('refund', () => {
    const sorted = (value: Record<string, unknown>) => {
      const inner = Object.fromEntries(
        Object.entries(value.return as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      )
      return { ...value, return: inner }
    }

    it.each([
      [
        'with_order_id',
        { id: '2020110828BC', payment_model: MODEL.THREE_D_SECURE, amount: 50, currency: CURRENCY.TRY },
        { amount: 5000, currencyCode: 'TL', orderID: 'TDSC000000002020110828BC' },
      ],
      [
        'with_ref_ret_num',
        { ref_ret_num: '019676067890000191', payment_model: MODEL.THREE_D_SECURE, amount: 50, currency: CURRENCY.TRY },
        { amount: 5000, currencyCode: 'TL', hostLogKey: '019676067890000191' },
      ],
    ])('%s', (_name, order, ret) => {
      const actual = mapper.createRefundRequestData(account, order as PosOrder, TX_TYPE.REFUND)
      expectSame(sorted(actual), sorted({ mid: '6706598320', tid: '67005551', tranDateRequired: '1', return: ret }))
    })
  })

  it('has no order history', () => {
    // deviation: P28 NotImplementedError
    expect(() => mapper.createOrderHistoryRequestData(account, {})).toThrow(NotImplementedError)
  })

  describe('additions', () => {
    // addition: real crypt, the MAC vectors of the bank flow
    describe('with the real crypt', () => {
      let real: PosNetPosRequestDataMapper

      beforeEach(() => {
        real = new PosNetPosRequestDataMapper(
          new PosNetPosRequestValueMapper(),
          new PosNetPosRequestValueFormatter(),
          {},
          new PosNetPosCrypt(),
          LANG.EN,
        )
      })

      const order = (): PosOrder => ({
        id: '2020110828BC',
        amount: 100.01,
        installment: '0' as never,
        currency: CURRENCY.TRY,
      })

      it('signs resolve and tran with the known MAC', () => {
        expect(real.create3DResolveMerchantRequestData(account, order(), packets).oosResolveMerchantData).toMatchObject(
          {
            mac: MAC,
          },
        )
        expect(real.create3DPaymentRequestData(account, order(), TX_TYPE.PAY_AUTH, packets).oosTranData).toMatchObject({
          mac: MAC,
        })
      })

      it('sends 1.13 as 113 kuruş', () => {
        const o = { ...order(), amount: 1.13 }
        expect(
          real.create3DFormInitializeRequestData(account, o, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
            .oosRequestData,
        ).toMatchObject({ amount: 113 })
        expect(real.create3DResolveMerchantRequestData(account, o, packets).oosResolveMerchantData).toMatchObject({
          mac: 'qaAng0XtzvOtvxWhri36zAqfqPv6lzn2+TZTJbI8KxE=',
        })
      })
    })

    it('reads a string amount', () => {
      const data = mapper.createNonSecurePaymentRequestData(account, baseOrder(), TX_TYPE.PAY_AUTH, card)
      expect((data.sale as Record<string, unknown>).amount).toBe(175)
    })

    it.each([
      ['abc', 'amount'],
      [0, 'amount'],
      [-1.5, 'amount'],
      ['-1.5', 'amount'],
      [Number.NaN, 'amount'],
      [Number.POSITIVE_INFINITY, 'amount'],
      [0.001, 'amount'],
      [1.5, 'installment'],
      [-1, 'installment'],
      ['x', 'installment'],
    ])('rejects %s as %s on every path', (value, field) => {
      const o = (): PosOrder => ({ ...baseOrder(), [field]: value as never, ref_ret_num: '1', id: 'A1' })
      const paths: Array<() => unknown> = [
        () => mapper.create3DFormInitializeRequestData(account, o(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
        () => mapper.createNonSecurePaymentRequestData(account, o(), TX_TYPE.PAY_AUTH, card),
        () => mapper.createNonSecurePostAuthPaymentRequestData(account, o()),
      ]
      // the resolve, tran and refund requests carry no installment
      if (field === 'amount') {
        paths.push(() => mapper.create3DResolveMerchantRequestData(account, o(), packets))
        paths.push(() => mapper.create3DPaymentRequestData(account, o(), TX_TYPE.PAY_AUTH, packets))
        paths.push(() => mapper.createRefundRequestData(account, o(), TX_TYPE.REFUND))
      }
      for (const run of paths) {
        expect(run).toThrow(PosError)
      }
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    describe('missing required fields', () => {
      const without = (key: string, extra: PosOrder = {}): PosOrder => {
        const o: PosOrder = { ...baseOrder(), ref_ret_num: '019676067890000191', ...extra }
        delete o[key]
        return o
      }

      it.each(['id', 'amount'])('%s is required by init, resolve, tran and non-secure', (key) => {
        const o = without(key)
        expect(() =>
          mapper.create3DFormInitializeRequestData(account, o, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
        ).toThrow(PosError)
        expect(() => mapper.create3DResolveMerchantRequestData(account, o, packets)).toThrow(PosError)
        expect(() => mapper.create3DPaymentRequestData(account, o, TX_TYPE.PAY_AUTH, packets)).toThrow(PosError)
        expect(() => mapper.createNonSecurePaymentRequestData(account, o, TX_TYPE.PAY_AUTH, card)).toThrow(PosError)
        expect(crypt.createHash).not.toHaveBeenCalled()
      })

      it('requires success_url for the form', async () => {
        const extra = { data1: 'AA', data2: 'BB', sign: 'CC' }
        await expect(
          mapper.create3DFormData(
            account,
            without('success_url'),
            MODEL.THREE_D_SECURE,
            TX_TYPE.PAY_AUTH,
            '/g',
            null,
            extra,
          ),
        ).rejects.toThrow(PosError)
      })

      it('requires ref_ret_num and amount for post-auth, amount for refund', () => {
        expect(() => mapper.createNonSecurePostAuthPaymentRequestData(account, without('ref_ret_num'))).toThrow(
          PosError,
        )
        expect(() => mapper.createNonSecurePostAuthPaymentRequestData(account, without('amount'))).toThrow(PosError)
        expect(() => mapper.createRefundRequestData(account, without('amount'), TX_TYPE.REFUND)).toThrow(PosError)
      })

      it('requires an id or a ref_ret_num for cancel, refund and status', () => {
        expect(() => mapper.createCancelRequestData(account, {})).toThrow(PosError)
        expect(() => mapper.createRefundRequestData(account, { amount: 5 }, TX_TYPE.REFUND)).toThrow(PosError)
        expect(() => mapper.createStatusRequestData(account, {})).toThrow(PosError)
      })

      it('produces no "undefined" value', () => {
        const outputs = [
          mapper.createNonSecurePostAuthPaymentRequestData(account, { ref_ret_num: 'R1', amount: 1 }),
          mapper.createCancelRequestData(account, { ref_ret_num: 'R1' }),
          mapper.createRefundRequestData(account, { ref_ret_num: 'R1', amount: 1 }, TX_TYPE.REFUND),
          mapper.createStatusRequestData(account, { id: 'A1' }),
        ]
        for (const output of outputs) {
          expect(JSON.stringify(output)).not.toContain('undefined')
        }
      })
    })

    it('rejects a non-string packet', () => {
      for (const key of ['BankPacket', 'MerchantPacket', 'Sign']) {
        const bad = { ...packets, [key]: { a: 1 } as never }
        expect(() => mapper.create3DResolveMerchantRequestData(account, baseOrder(), bad)).toThrow(PosError)
        expect(() => mapper.create3DPaymentRequestData(account, baseOrder(), TX_TYPE.PAY_AUTH, bad)).toThrow(PosError)
        const missing = { ...packets, [key]: undefined as never }
        expect(() => mapper.create3DPaymentRequestData(account, baseOrder(), TX_TYPE.PAY_AUTH, missing)).toThrow(
          PosError,
        )
      }
    })

    it('sends an empty holder name when the card has none', () => {
      const anonymous = CreditCardFactory.create('5555444433332222', '22', '01', '123', null)
      const data = mapper.create3DFormInitializeRequestData(
        account,
        baseOrder(),
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        anonymous,
      )
      expect((data.oosRequestData as Record<string, unknown>).cardHolderName).toBe('')
    })

    it('does not mutate the input order', () => {
      const order = baseOrder()
      const copy = structuredClone(order)
      crypt.createHash.mockReturnValue(MAC)
      mapper.create3DFormInitializeRequestData(account, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
      mapper.create3DResolveMerchantRequestData(account, order, packets)
      mapper.create3DPaymentRequestData(account, order, TX_TYPE.PAY_AUTH, packets)
      mapper.createNonSecurePaymentRequestData(account, order, TX_TYPE.PAY_AUTH, card)
      expect(order).toStrictEqual(copy)
    })
  })
})
