import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CryptInterface } from '../../../../../src/crypt/CryptInterface.js'
import { PayFlexCPV4PosRequestDataMapper } from '../../../../../src/data-mapper/request/mapper/PayFlexCPV4PosRequestDataMapper.js'
import { PayFlexCPV4PosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/PayFlexCPV4PosRequestValueFormatter.js'
import { PayFlexCPV4PosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/PayFlexCPV4PosRequestValueMapper.js'
import { NotImplementedError, PosError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import { PayFlexPosAccount } from '../../../../../src/model/account/PayFlexPosAccount.js'
import { CARD_TYPE, CURRENCY, LANG, MODEL, TX_TYPE } from '../../../../../src/PosInterface.js'
import type { Before3DFormHashCalculatedEvent, PosOrder } from '../../../../../src/types.js'

const RANDOM = 'TX0123456789ABCDEF0123456789ABCD'
const account = AccountFactory.createPayFlexPosAccount('vakifbank-cp', '000000000111111', '3XTgER89as', 'VP999999')
const card = CreditCardFactory.create('5555444433332222', '2021', '12', '122', 'ahmet', CARD_TYPE.VISA)

/** Compares key order as well as values. */
function expectSame(actual: unknown, expected: unknown): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
  expect(actual).toStrictEqual(expected)
}

describe('PayFlexCPV4PosRequestDataMapper', () => {
  let crypt: { [K in keyof CryptInterface]: ReturnType<typeof vi.fn> }
  let hook: ReturnType<typeof vi.fn<(e: Before3DFormHashCalculatedEvent) => void>>
  let mapper: PayFlexCPV4PosRequestDataMapper

  beforeEach(() => {
    crypt = {
      hashString: vi.fn(),
      check3DHash: vi.fn(),
      create3DHash: vi.fn(),
      createHash: vi.fn(),
      hashFromParams: vi.fn(),
      generateRandomString: vi.fn(() => RANDOM),
    }
    hook = vi.fn()
    mapper = new PayFlexCPV4PosRequestDataMapper(
      new PayFlexCPV4PosRequestValueMapper(),
      new PayFlexCPV4PosRequestValueFormatter(),
      { onBefore3DFormHashCalculated: [hook] },
      crypt as unknown as CryptInterface<never>,
      LANG.EN,
    )
  })

  it('supports only PayFlexCPV4Pos', () => {
    expect(PayFlexCPV4PosRequestDataMapper.supports('PayFlexCPV4Pos')).toBe(true)
    expect(PayFlexCPV4PosRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  describe('create3DFormInitializeRequestData', () => {
    const order: PosOrder = {
      id: 'order222',
      amount: 100.0,
      installment: 0,
      currency: CURRENCY.TRY,
      success_url: 'https://domain.com/success',
      fail_url: 'https://domain.com/fail_url',
      ip: '127.0.0.1',
    }
    const head = {
      HostMerchantId: '000000000111111',
      MerchantId: '1',
      MerchantPassword: '3XTgER89as',
      HostTerminalId: 'VP999999',
    }
    const tail = {
      AmountCode: '949',
      Amount: '100.00',
      OrderId: 'order222',
      IsSecure: 'true',
      AllowNotEnrolledCard: 'false',
      SuccessUrl: 'https://domain.com/success',
      FailUrl: 'https://domain.com/fail_url',
      RequestLanguage: 'en-US',
      Extract: '',
      CustomItems: '',
    }

    it('with_card_1', () => {
      // deviation: R3 MerchantId/TransactionId added, OrderID→OrderId; R4 ExpireYear; R2 no HashedData
      const actual = mapper.create3DFormInitializeRequestData(
        account,
        order,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        card,
      )
      expectSame(actual, {
        ...head,
        TransactionType: 'Sale',
        TransactionId: RANDOM,
        ...tail,
        BrandNumber: '100',
        CVV: '122',
        PAN: '5555444433332222',
        ExpireMonth: '12',
        ExpireYear: '2021',
        CardHoldersName: 'ahmet',
      })
      // deviation: R2 an earlier formula required exactly one createHash call
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    it('without_card_1_pre_pay_and_with_installment', () => {
      // deviation: R3 MerchantId/TransactionId added, OrderID→OrderId; R2 no HashedData
      const actual = mapper.create3DFormInitializeRequestData(
        account,
        { ...order, installment: 2 },
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_PRE_AUTH,
      )
      expectSame(actual, {
        ...head,
        TransactionType: 'Auth',
        TransactionId: RANDOM,
        ...tail,
        InstallmentCount: '2',
      })
      expect(actual).not.toHaveProperty('HashedData')
    })

    it('addition: order.transaction_id is used instead of the random value', () => {
      // addition: R13
      const actual = mapper.create3DFormInitializeRequestData(
        account,
        { ...order, transaction_id: 'MY-TX-1' },
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
      )
      expect(actual.TransactionId).toBe('MY-TX-1')
      expect(crypt.generateRandomString).not.toHaveBeenCalled()
    })

    it('addition: rejects a transaction_id with special characters', () => {
      expect(() =>
        mapper.create3DFormInitializeRequestData(
          account,
          { ...order, transaction_id: 'çok_özel' },
          MODEL.THREE_D_SECURE,
          TX_TYPE.PAY_AUTH,
        ),
      ).toThrow(PosError)
    })

    it.each(['order 222', 'ord.1'])('addition: rejects order id %j (R12)', (id) => {
      expect(() =>
        mapper.create3DFormInitializeRequestData(account, { ...order, id }, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH),
      ).toThrow(PosError)
    })

    // addition: L2 the library-wide order-id rule without "_" (the bank refuses it)
    it.each(['a_b', '-ab', '_ab', 'a'.repeat(65), 1.5, true, ['a']])(
      'rejects order id %j with the rule message',
      (id) => {
        expect(() =>
          mapper.create3DFormInitializeRequestData(
            account,
            { ...order, id } as unknown as PosOrder,
            MODEL.THREE_D_SECURE,
            TX_TYPE.PAY_AUTH,
          ),
        ).toThrow('Order field "id" must be 1-64 letters, digits or "-", starting with a letter or digit')
      },
    )

    it.each([
      ['a-b', 'a-b'],
      ['a'.repeat(64), 'a'.repeat(64)],
      [7, '7'],
    ] as const)('accepts order id %j as %j', (id, expected) => {
      const data = mapper.create3DFormInitializeRequestData(
        account,
        { ...order, id } as unknown as PosOrder,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
      )
      expect(data.OrderId).toBe(expected)
    })

    it('addition: a missing success_url is rejected, never sent as "undefined"', () => {
      const { success_url: _omit, ...noSuccess } = order
      expect(() =>
        mapper.create3DFormInitializeRequestData(account, noSuccess, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH),
      ).toThrow(PosError)
    })

    it('addition: a sub-dealer account sends its sub merchant id as MerchantId', () => {
      const sub = AccountFactory.createPayFlexPosAccount(
        'vakifbank-cp',
        '000000000111111',
        '3XTgER89as',
        'VP999999',
        PayFlexPosAccount.MERCHANT_TYPE_SUB_DEALER,
        '77',
      )
      const actual = mapper.create3DFormInitializeRequestData(sub, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH)
      expect(actual.MerchantId).toBe('77')
      expect(mapper.create3DPaymentStatusRequestData(sub, { TransactionId: 'a' }).MerchantId).toBe('77')
      expect(mapper.createStatusRequestData(sub, { transaction_id: 'a' }).MerchantId).toBe('77')
    })
  })

  describe('create3DPaymentStatusRequestData', () => {
    it('create3DPaymentStatusRequestData', () => {
      // deviation: R8 MerchantId added
      const actual = mapper.create3DPaymentStatusRequestData(account, {
        TransactionId: '3ee068d5b5a747ada65dafc0016d5887',
        PaymentToken: 'b35a56bf37334872a945afc0016d5887',
      })
      expectSame(actual, {
        HostMerchantId: '000000000111111',
        MerchantId: '1',
        Password: '3XTgER89as',
        TransactionId: '3ee068d5b5a747ada65dafc0016d5887',
        PaymentToken: 'b35a56bf37334872a945afc0016d5887',
      })
    })

    it('addition: only a PaymentToken yields no TransactionId key', () => {
      const actual = mapper.create3DPaymentStatusRequestData(account, { PaymentToken: 't' })
      expect(actual).not.toHaveProperty('TransactionId')
      expect(actual.PaymentToken).toBe('t')
    })

    it('addition: neither id is rejected', () => {
      expect(() => mapper.create3DPaymentStatusRequestData(account, {})).toThrow(PosError)
      expect(() => mapper.create3DPaymentStatusRequestData(account, { TransactionId: '', PaymentToken: null })).toThrow(
        PosError,
      )
    })
  })

  describe('create3DFormData', () => {
    it('create3DFormData', async () => {
      const actual = await mapper.create3DFormData(account, null, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, '', null, {
        CommonPaymentUrl: 'https://cptest.vakifbank.com.tr/CommonPayment/SecurePayment',
        PaymentToken: 'c5e076e7bf234a339c40afc10166c06d',
        ErrorCode: null,
        ResponseMessage: null,
      })
      expectSame(actual, {
        gateway: 'https://cptest.vakifbank.com.tr/CommonPayment/SecurePayment',
        method: 'GET',
        inputs: { Ptkn: 'c5e076e7bf234a339c40afc10166c06d' },
      })
      expect(hook).not.toHaveBeenCalled()
    })

    it('addition: null extraData and missing fields are rejected', async () => {
      await expect(mapper.create3DFormData(account, null, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, '')).rejects.toThrow(
        PosError,
      )
      await expect(
        mapper.create3DFormData(account, null, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, '', null, {
          PaymentToken: 'x',
        }),
      ).rejects.toThrow(PosError)
    })
  })

  describe('createStatusRequestData', () => {
    it('createStatusRequestData', () => {
      // deviation: R10 status is supported
      expectSame(mapper.createStatusRequestData(account, { transaction_id: 'abc' }), {
        HostMerchantId: '000000000111111',
        MerchantId: '1',
        Password: '3XTgER89as',
        TransactionId: 'abc',
      })
    })

    it('addition: uses payment_token and rejects an order without ids', () => {
      expect(mapper.createStatusRequestData(account, { payment_token: 'tok' }).PaymentToken).toBe('tok')
      expect(() => mapper.createStatusRequestData(account, {})).toThrow(PosError)
    })
  })

  describe('unsupported operations', () => {
    const order: PosOrder = { id: 'order222', amount: 1 }

    it('createRefundRequestData', () => {
      expect(() => mapper.createRefundRequestData(account, order, TX_TYPE.REFUND)).toThrow(NotImplementedError)
    })
    it('create3DPaymentRequestData', () => {
      expect(() => mapper.create3DPaymentRequestData(account, order, TX_TYPE.PAY_AUTH, {})).toThrow(NotImplementedError)
    })
    it('createCancelRequestData', () => {
      expect(() => mapper.createCancelRequestData(account, order)).toThrow(NotImplementedError)
    })
    it('createNonSecurePaymentRequestData', () => {
      expect(() => mapper.createNonSecurePaymentRequestData(account, order, TX_TYPE.PAY_AUTH, card)).toThrow(
        NotImplementedError,
      )
    })
    it('createNonSecurePostAuthPaymentRequestData', () => {
      expect(() => mapper.createNonSecurePostAuthPaymentRequestData(account, order)).toThrow(NotImplementedError)
    })
    it('createOrderHistoryRequestData', () => {
      expect(() => mapper.createOrderHistoryRequestData(account, order)).toThrow(NotImplementedError)
    })
  })
})
