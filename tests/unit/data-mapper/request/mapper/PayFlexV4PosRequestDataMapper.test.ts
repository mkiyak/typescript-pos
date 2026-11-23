import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CryptInterface } from '../../../../../src/crypt/CryptInterface.js'
import { PayFlexV4PosRequestDataMapper } from '../../../../../src/data-mapper/request/mapper/PayFlexV4PosRequestDataMapper.js'
import { PayFlexV4PosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/PayFlexV4PosRequestValueFormatter.js'
import { PayFlexV4PosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/PayFlexV4PosRequestValueMapper.js'
import { NotImplementedError, PosError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import { PayFlexPosAccount } from '../../../../../src/model/account/PayFlexPosAccount.js'
import { CARD_TYPE, CURRENCY, LANG, MODEL, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'
import type { Before3DFormHashCalculatedEvent, PosOrder } from '../../../../../src/types.js'

const account = AccountFactory.createPayFlexPosAccount('vakifbank', '000000000111111', '3XTgER89as', 'VP999999')
const card = CreditCardFactory.create('5555444433332222', '2021', '12', '122', 'ahmet', CARD_TYPE.VISA)

/** PHP assertSame on arrays also compares key order and null vs missing: compare serialised form. */
function expectSame(actual: unknown, expected: unknown): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
  expect(actual).toStrictEqual(expected)
}

/** Order independent comparison. */
function sorted(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** Midday UTC: the Istanbul calendar day equals the UTC day. */
const day = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d, 12))

describe('PayFlexV4PosRequestDataMapper', () => {
  let crypt: { [K in keyof CryptInterface]: ReturnType<typeof vi.fn> }
  let hook: ReturnType<typeof vi.fn<(e: Before3DFormHashCalculatedEvent) => void>>
  let mapper: PayFlexV4PosRequestDataMapper

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
    mapper = new PayFlexV4PosRequestDataMapper(
      new PayFlexV4PosRequestValueMapper(),
      new PayFlexV4PosRequestValueFormatter(),
      { onBefore3DFormHashCalculated: [hook] },
      crypt as unknown as CryptInterface<never>,
      LANG.EN,
    )
  })

  it('supports only PayFlexV4Pos', () => {
    expect(PayFlexV4PosRequestDataMapper.supports('PayFlexV4Pos')).toBe(true)
    expect(PayFlexV4PosRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  describe('create3DPaymentRequestData', () => {
    const order: PosOrder = {
      id: 'order222',
      amount: 100.0,
      installment: 0,
      currency: CURRENCY.TRY,
      success_url: 'https://domain.com/success',
      fail_url: 'https://domain.com/fail_url',
      ip: '127.0.0.1',
    }
    const responseData = {
      Eci: '05',
      Cavv: 'AAABCYaRIwAAAVQ1gpEjAAAAAAA=',
      VerifyEnrollmentRequestId: 'ce06048a3e9c0cd1d437803fb38b5ad0',
    }
    const card3d = CreditCardFactory.create('5555444433332222', '2021', '12', '122', 'ahmet', CARD_TYPE.VISA)
    const base = {
      MerchantId: '000000000111111',
      Password: '3XTgER89as',
      TerminalNo: 'VP999999',
      TransactionType: 'Sale',
      TransactionId: 'order222',
      CurrencyAmount: '100.00',
      CurrencyCode: '949',
      ECI: '05',
      CAVV: 'AAABCYaRIwAAAVQ1gpEjAAAAAAA=',
      MpiTransactionId: 'ce06048a3e9c0cd1d437803fb38b5ad0',
      OrderId: 'order222',
      ClientIp: '127.0.0.1',
      TransactionDeviceSource: '0',
      CardHoldersName: 'ahmet',
      Cvv: '122',
      Pan: '5555444433332222',
      Expiry: '202112',
    }

    it('no_installment', () => {
      expectSame(mapper.create3DPaymentRequestData(account, order, TX_TYPE.PAY_AUTH, responseData, card3d), base)
    })

    it('with_installment', () => {
      expectSame(
        mapper.create3DPaymentRequestData(
          account,
          { ...order, installment: 3 },
          TX_TYPE.PAY_AUTH,
          responseData,
          card3d,
        ),
        { ...base, NumberOfInstallments: '3' },
      )
    })

    it('throws without a card', () => {
      expect(() => mapper.create3DPaymentRequestData(account, order, TX_TYPE.PAY_AUTH, responseData)).toThrow(PosError)
    })

    it.each(['Eci', 'Cavv', 'VerifyEnrollmentRequestId'])('throws when %s is missing from the 3D response', (key) => {
      const { [key]: _omitted, ...rest } = responseData as Record<string, string>
      expect(() => mapper.create3DPaymentRequestData(account, order, TX_TYPE.PAY_AUTH, rest, card3d)).toThrow(PosError)
    })

    it.each(['id', 'amount'])('throws when order %s is missing', (key) => {
      const { [key]: _omitted, ...rest } = order as Record<string, unknown>
      expect(() => mapper.create3DPaymentRequestData(account, rest, TX_TYPE.PAY_AUTH, responseData, card3d)).toThrow(
        PosError,
      )
    })
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
    const base = {
      MerchantId: '000000000111111',
      MerchantPassword: '3XTgER89as',
      MerchantType: 0,
      PurchaseAmount: '100.00',
      VerifyEnrollmentRequestId: 'rand123',
      Currency: '949',
      SuccessUrl: 'https://domain.com/success',
      FailureUrl: 'https://domain.com/fail_url',
      Pan: '5555444433332222',
      ExpiryDate: '2112',
      BrandName: '100',
      IsRecurring: 'false',
    }

    beforeEach(() => {
      crypt.generateRandomString.mockReturnValue('rand123')
    })

    it('default', () => {
      const actual = mapper.create3DFormInitializeRequestData(
        account,
        order,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        card,
      )
      expectSame(actual, base)
      expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
    })

    it('with_installment', () => {
      const actual = mapper.create3DFormInitializeRequestData(
        account,
        { ...order, installment: 2 },
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        card,
      )
      expectSame(actual, { ...base, InstallmentCount: '2' })
    })

    it('with_recurrent_payment', () => {
      const actual = mapper.create3DFormInitializeRequestData(
        account,
        {
          ...order,
          recurring: { frequency: 3, frequencyType: 'MONTH', installment: 2, endDate: day(2024, 4, 14) },
        },
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        card,
      )
      expectSame(actual, {
        ...base,
        IsRecurring: 'true',
        RecurringFrequency: '3',
        RecurringFrequencyType: 'Month',
        RecurringInstallmentCount: '2',
        RecurringEndDate: '20240414',
        TriggerDate: '',
      })
    })

    it('with_recurrent_payment_with_start_date', () => {
      const actual = mapper.create3DFormInitializeRequestData(
        account,
        {
          ...order,
          recurring: {
            frequency: 3,
            frequencyType: 'MONTH',
            installment: 2,
            startDate: day(2024, 10, 14),
            endDate: day(2025, 4, 14),
          },
        },
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        card,
      )
      expectSame(actual, {
        ...base,
        IsRecurring: 'true',
        RecurringFrequency: '3',
        RecurringFrequencyType: 'Month',
        RecurringInstallmentCount: '2',
        RecurringEndDate: '20250414',
        TriggerDate: '20241014',
      })
    })

    it.each(['frequency', 'installment', 'frequencyType'])('throws when recurring %s is missing', (key) => {
      const recurring: Record<string, unknown> = {
        frequency: 3,
        frequencyType: 'MONTH',
        installment: 2,
        endDate: day(2024, 4, 14),
      }
      delete recurring[key]
      expect(() =>
        mapper.create3DFormInitializeRequestData(
          account,
          { ...order, recurring },
          MODEL.THREE_D_SECURE,
          TX_TYPE.PAY_AUTH,
          card,
        ),
      ).toThrow(PosError)
    })

    it('throws without a card', () => {
      expect(() =>
        mapper.create3DFormInitializeRequestData(
          account,
          { amount: 100, currency: CURRENCY.TRY },
          MODEL.THREE_D_SECURE,
          TX_TYPE.PAY_AUTH,
        ),
      ).toThrow(PosError)
    })

    it('with sub merchant', () => {
      const subAccount = AccountFactory.createPayFlexPosAccount(
        'vakifbank',
        '000000000111111',
        '3XTgER89as',
        'VP999999',
        PayFlexPosAccount.MERCHANT_TYPE_SUB_DEALER,
        'SUB_MERCHANT_123',
      )
      const result = mapper.create3DFormInitializeRequestData(
        subAccount,
        { ...order, amount: 100.0 },
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        card,
      )
      expect(result.SubMerchantId).toBe('SUB_MERCHANT_123')
      expect(result.MerchantType).toBe(2)
    })

    it('takes MerchantType from the account, not a constant', () => {
      const dealer = AccountFactory.createPayFlexPosAccount(
        'vakifbank',
        '000000000111111',
        '3XTgER89as',
        'VP999999',
        PayFlexPosAccount.MERCHANT_TYPE_MAIN_DEALER,
      )
      const result = mapper.create3DFormInitializeRequestData(
        dealer,
        order,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        card,
      )
      expect(result.MerchantType).toBe(1)
      expect(result).not.toHaveProperty('SubMerchantId')
    })

    it('BrandName is null for a card without type', () => {
      const untyped = CreditCardFactory.create('5555444433332222', '2021', '12', '122', 'ahmet')
      const result = mapper.create3DFormInitializeRequestData(
        account,
        order,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        untyped,
      )
      expect(result.BrandName).toBeNull()
    })

    it.each(['amount', 'success_url', 'fail_url'])('throws when order %s is missing', (key) => {
      const { [key]: _omitted, ...rest } = order as Record<string, unknown>
      expect(() =>
        mapper.create3DFormInitializeRequestData(account, rest, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
      ).toThrow(PosError)
    })

    it('rejects an unknown currency', () => {
      expect(() =>
        mapper.create3DFormInitializeRequestData(
          account,
          { ...order, currency: 'XXX' as never },
          MODEL.THREE_D_SECURE,
          TX_TYPE.PAY_AUTH,
          card,
        ),
      ).toThrow(PosError)
    })
  })

  describe('create3DFormData', () => {
    it('throws with null extraData', async () => {
      await expect(
        mapper.create3DFormData(account, null, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'https://x', null, null),
      ).rejects.toThrow(PosError)
    })

    it('builds the ACS form and dispatches no hash hook', async () => {
      const actual = await mapper.create3DFormData(
        account,
        null,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        'https://ignored',
        null,
        { Status: 'Y', PaReq: 'PaReq2', TermUrl: 'TermUrl2', MD: 'MD3', ACSUrl: 'http' },
      )
      expectSame(actual, {
        gateway: 'http',
        method: 'POST',
        inputs: { PaReq: 'PaReq2', TermUrl: 'TermUrl2', MD: 'MD3' },
      })
      expect(hook).not.toHaveBeenCalled()
    })

    it('throws when an ACS field is missing', async () => {
      await expect(
        mapper.create3DFormData(account, null, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'x', null, {
          PaReq: 'p',
          TermUrl: 't',
          MD: 'm',
        }),
      ).rejects.toThrow(PosError)
    })
  })

  describe('createNonSecurePaymentRequestData', () => {
    const order: PosOrder = { id: 'order123', amount: 5, ip: '127.0.0.1' }

    it('maps the order', () => {
      expectSame(mapper.createNonSecurePaymentRequestData(account, order, TX_TYPE.PAY_AUTH, card), {
        MerchantId: '000000000111111',
        Password: '3XTgER89as',
        TerminalNo: 'VP999999',
        TransactionType: 'Sale',
        OrderId: 'order123',
        CurrencyAmount: '5.00',
        CurrencyCode: '949',
        ClientIp: '127.0.0.1',
        TransactionDeviceSource: '0',
        Pan: card.getNumber(),
        Expiry: '202112',
        Cvv: card.getCvv(),
      })
    })

    it.each(['id', 'amount'])('throws instead of sending "undefined" when %s is missing', (key) => {
      const { [key]: _omitted, ...rest } = order as Record<string, unknown>
      expect(() => mapper.createNonSecurePaymentRequestData(account, rest, TX_TYPE.PAY_AUTH, card)).toThrow(PosError)
    })
  })

  describe('createNonSecurePostAuthPaymentRequestData', () => {
    it('maps the order', () => {
      expectSame(
        mapper.createNonSecurePostAuthPaymentRequestData(account, {
          id: 'order123',
          transaction_id: 'tx123',
          amount: 1000,
          ip: '127.0.0.1',
        }),
        {
          MerchantId: '000000000111111',
          Password: '3XTgER89as',
          TerminalNo: 'VP999999',
          TransactionType: 'Capture',
          ReferenceTransactionId: 'tx123',
          CurrencyAmount: '1000.00',
          CurrencyCode: '949',
          ClientIp: '127.0.0.1',
        },
      )
    })

    it.each(['transaction_id', 'amount'])('throws when %s is missing', (key) => {
      const order: Record<string, unknown> = { id: 'o', transaction_id: 'tx123', amount: 10, ip: '127.0.0.1' }
      delete order[key]
      expect(() => mapper.createNonSecurePostAuthPaymentRequestData(account, order)).toThrow(PosError)
    })
  })

  describe('createCancelRequestData', () => {
    it('maps the order', () => {
      expectSame(
        mapper.createCancelRequestData(account, {
          transaction_id: '7022b92e-3aa1-44fb-86d4-33658c700c80',
          ip: '127.0.0.1',
        }),
        {
          MerchantId: '000000000111111',
          Password: '3XTgER89as',
          TransactionType: 'Cancel',
          ReferenceTransactionId: '7022b92e-3aa1-44fb-86d4-33658c700c80',
          ClientIp: '127.0.0.1',
        },
      )
    })

    it('throws when transaction_id is missing', () => {
      expect(() => mapper.createCancelRequestData(account, { ip: '127.0.0.1' })).toThrow(PosError)
    })
  })

  describe('createRefundRequestData', () => {
    const order: PosOrder = { transaction_id: '7022b92e-3aa1-44fb-86d4-33658c700c80', amount: 5, ip: '127.0.0.1' }
    const expected = {
      ClientIp: '127.0.0.1',
      CurrencyAmount: '5.00',
      MerchantId: '000000000111111',
      Password: '3XTgER89as',
      ReferenceTransactionId: '7022b92e-3aa1-44fb-86d4-33658c700c80',
      TransactionType: 'Refund',
    }

    it.each([
      ['full_refund', TX_TYPE.REFUND],
      ['partial_refund', TX_TYPE.REFUND_PARTIAL],
    ] as [string, TxType][])('%s', (_name, txType) => {
      expectSame(sorted(mapper.createRefundRequestData(account, order, txType)), sorted(expected))
    })

    it('throws when amount is missing', () => {
      const { amount: _omitted, ...rest } = order
      expect(() => mapper.createRefundRequestData(account, rest, TX_TYPE.REFUND)).toThrow(PosError)
    })
  })

  describe('createStatusRequestData', () => {
    it('only_with_order_id', () => {
      expectSame(mapper.createStatusRequestData(account, { id: 'order222' }), {
        MerchantCriteria: { HostMerchantId: '000000000111111', MerchantPassword: '3XTgER89as' },
        TransactionCriteria: { TransactionId: '', OrderId: 'order222', AuthCode: '' },
      })
    })

    it('with_order_id_and_tx_id', () => {
      expectSame(mapper.createStatusRequestData(account, { id: 'order222', transaction_id: 'tx222' }), {
        MerchantCriteria: { HostMerchantId: '000000000111111', MerchantPassword: '3XTgER89as' },
        TransactionCriteria: { TransactionId: 'tx222', OrderId: 'order222', AuthCode: '' },
      })
    })

    it('throws when id is missing', () => {
      expect(() => mapper.createStatusRequestData(account, {})).toThrow(PosError)
    })
  })

  it('createOrderHistoryRequestData is not implemented', () => {
    expect(() => mapper.createOrderHistoryRequestData(account, {})).toThrow(NotImplementedError)
  })
})
