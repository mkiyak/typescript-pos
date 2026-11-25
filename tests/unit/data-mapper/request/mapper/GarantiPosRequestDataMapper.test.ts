import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CryptInterface } from '../../../../../src/crypt/CryptInterface.js'
import { GarantiPosCrypt } from '../../../../../src/crypt/GarantiPosCrypt.js'
import { GarantiPosRequestDataMapper } from '../../../../../src/data-mapper/request/mapper/GarantiPosRequestDataMapper.js'
import { GarantiPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/GarantiPosRequestValueFormatter.js'
import { GarantiPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/GarantiPosRequestValueMapper.js'
import { MissingAccountInfoError, NotImplementedError, PosError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import type { PosLogger } from '../../../../../src/logger.js'
import { CURRENCY, LANG, MODEL, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'
import type { Before3DFormHashCalculatedEvent, PosOrder } from '../../../../../src/types.js'

const account = AccountFactory.createGarantiPosAccount(
  'garanti',
  '7000679',
  'PROVAUT',
  '123qweASD/',
  '30691298',
  '12345678',
  'PROVRFN',
  '123qweASD/',
)
const card = CreditCardFactory.create('5555444433332222', '22', '01', '123', 'ahmet')

/** PHP assertSame on arrays also compares key order: compare the serialised form as well. */
function expectSame(actual: unknown, expected: unknown): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
  expect(actual).toStrictEqual(expected)
}

/** The hash is computed over the request with an empty HashData. */
function withEmptyHash(expected: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(expected)
  ;(copy.Terminal as Record<string, unknown>).HashData = ''
  return copy
}

const terminal = (hashData: string, user = 'PROVAUT') => ({
  ProvUserID: user,
  UserID: user,
  HashData: hashData,
  ID: '30691298',
  MerchantID: '7000679',
})

describe('GarantiPosRequestDataMapper', () => {
  let crypt: { [K in keyof CryptInterface]: ReturnType<typeof vi.fn> }
  let hook: ReturnType<typeof vi.fn<(e: Before3DFormHashCalculatedEvent) => void>>
  let mapper: GarantiPosRequestDataMapper

  /** Makes the stub hash return the expected value and records what it was asked to hash. */
  function expectHash(expected: Record<string, unknown>): void {
    crypt.createHash.mockReturnValue((expected.Terminal as Record<string, string>).HashData)
  }

  function expectHashedData(expected: Record<string, unknown>): void {
    expect(crypt.createHash).toHaveBeenCalledTimes(1)
    const call = crypt.createHash.mock.calls[0] as unknown[]
    expect(call[0]).toBe(account)
    expectSame(call[1], withEmptyHash(expected))
  }

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
    mapper = new GarantiPosRequestDataMapper(
      new GarantiPosRequestValueMapper(),
      new GarantiPosRequestValueFormatter(),
      { onBefore3DFormHashCalculated: [hook] },
      crypt as unknown as CryptInterface<never>,
      LANG.EN,
    )
    mapper.setTestMode(true)
  })

  it('supports only GarantiPos', () => {
    expect(GarantiPosRequestDataMapper.supports('GarantiPos')).toBe(true)
    expect(GarantiPosRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  describe('createNonSecurePostAuthPaymentRequestData', () => {
    const order: PosOrder = {
      id: 'order222',
      amount: 100.25,
      currency: CURRENCY.TRY,
      ip: '127.0.0.1',
      ref_ret_num: '831803579226',
    }
    const expected = {
      Mode: 'TEST',
      Version: '512',
      Terminal: terminal(''),
      Customer: { IPAddress: '127.0.0.1' },
      Order: { OrderID: 'order222' },
      Transaction: { Type: 'postauth', Amount: 10025, CurrencyCode: '949', OriginalRetrefNum: '831803579226' },
    }

    it('creates the request', () => {
      expectHash(expected)
      const actual = mapper.createNonSecurePostAuthPaymentRequestData(account, order)
      expectSame(actual, expected)
      expectHashedData(expected)
    })
  })

  describe('createNonSecurePaymentRequestData', () => {
    const order: PosOrder = {
      id: 'order222',
      amount: 100.25,
      currency: CURRENCY.TRY,
      installment: 0,
      ip: '127.0.0.1',
    }
    const hash =
      '2005F771B622399C0EC7B8BBBE9B5F7989B9587175239F0695C1E5D3BFAA0CF6D747A9CEE64D78B7081CB5193541AD9D129B929653E2B68BCAE6939E281D752E'
    const base = {
      Mode: 'TEST',
      Version: '512',
      Terminal: terminal(hash),
      Customer: { IPAddress: '127.0.0.1' },
      Card: { Number: '5555444433332222', ExpireDate: '0122', CVV2: '123' },
      Order: { OrderID: 'order222' },
      Transaction: {
        Type: 'sales',
        InstallmentCnt: '',
        Amount: 10025,
        CurrencyCode: '949',
        CardholderPresentCode: '0',
        MotoInd: 'N',
      },
    }

    it('basic', () => {
      expectHash(base)
      expectSame(mapper.createNonSecurePaymentRequestData(account, order, TX_TYPE.PAY_AUTH, card), base)
      expectHashedData(base)
    })

    it('recurring', () => {
      const expected = {
        ...base,
        Recurring: {
          TotalPaymentNum: '4',
          FrequencyType: 'M',
          FrequencyInterval: '3',
          Type: 'R',
          StartDate: '20240909',
        },
      }
      expectHash(expected)
      const { installment: _installment, ...rest } = order
      const actual = mapper.createNonSecurePaymentRequestData(
        account,
        {
          ...rest,
          // deviation: G9 - the start date is an instant, formatted on the Türkiye clock
          recurring: {
            frequency: 3,
            frequencyType: 'MONTH',
            installment: 4,
            startDate: new Date('2024-09-09T00:00:00+03:00'),
          },
        },
        TX_TYPE.PAY_AUTH,
        card,
      )
      expectSame(actual, expected)
      expectHashedData(expected)
    })

    // addition: the amount is rounded like a money format, not truncated
    it('formats 0.29 as 29 kuruş', () => {
      crypt.createHash.mockReturnValue('H')
      const actual = mapper.createNonSecurePaymentRequestData(
        account,
        { ...order, amount: 0.29 },
        TX_TYPE.PAY_AUTH,
        card,
      )
      expect((actual.Transaction as Record<string, unknown>).Amount).toBe(29)
    })

    // addition: a missing ip must never be sent as the text "undefined"
    it('rejects a missing ip without hashing', () => {
      const { ip: _ip, ...noIp } = order
      expect(() => mapper.createNonSecurePaymentRequestData(account, noIp, TX_TYPE.PAY_AUTH, card)).toThrow(PosError)
      expect(crypt.createHash).not.toHaveBeenCalled()
    })
  })

  describe('createCancelRequestData', () => {
    const order: PosOrder = { id: '2020110828BC', ip: '127.0.0.1', ref_ret_num: '831803579226' }
    const expected = {
      Mode: 'TEST',
      Version: '512',
      Terminal: terminal(
        '35E8410A78E24949D78F5E025B5E05AF470B01385A2ECBFEE6C5B3CDACFF78011D387ECAFDCE4B8453D80D35C2F344F3DAA6F2EF9143079F64DE88401EC5E4F5',
        'PROVRFN',
      ),
      Customer: { IPAddress: '127.0.0.1' },
      Order: { OrderID: '2020110828BC' },
      Transaction: {
        Type: 'void',
        InstallmentCnt: '',
        Amount: 100,
        CurrencyCode: '949',
        CardholderPresentCode: '0',
        MotoInd: 'N',
        OriginalRetrefNum: '831803579226',
      },
    }

    it('creates the request', () => {
      expectHash(expected)
      expectSame(mapper.createCancelRequestData(account, order), expected)
      expectHashedData(expected)
    })

    // addition: ref_ret_num is required
    it('rejects a missing ref_ret_num without hashing', () => {
      const { ref_ret_num: _r, ...noRef } = order
      expect(() => mapper.createCancelRequestData(account, noRef)).toThrow(PosError)
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    // addition: an empty refund username is as missing as a null one
    it('rejects an account with an empty or blank refund username before hashing', () => {
      for (const refundUsername of ['', '  ']) {
        const empty = AccountFactory.createGarantiPosAccount(
          'garanti',
          '7000679',
          'PROVAUT',
          'pw',
          '30691298',
          'key',
          refundUsername,
          'refundpw',
        )
        expect(() => mapper.createCancelRequestData(empty, order)).toThrow(MissingAccountInfoError)
      }
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    // addition: the refund user is required for a cancel
    it('rejects an account without refund username', () => {
      const noRefund = AccountFactory.createGarantiPosAccount('garanti', '7000679', 'PROVAUT', 'pw', '30691298', 'key')
      expect(() => mapper.createCancelRequestData(noRefund, order)).toThrow(MissingAccountInfoError)
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    // addition: real signature with the refund password
    it('signs with the real crypt', () => {
      const real = new GarantiPosRequestDataMapper(
        new GarantiPosRequestValueMapper(),
        new GarantiPosRequestValueFormatter(),
        {},
        new GarantiPosCrypt({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as PosLogger),
        LANG.EN,
      )
      real.setTestMode(true)
      const actual = real.createCancelRequestData(account, {
        id: '4499996',
        ip: '127.0.0.1',
        ref_ret_num: '831803579226',
      })
      expect((actual.Terminal as Record<string, string>).HashData).toBe(
        'C0C88761726D1844AF49FBE756DBE4586F7339169994CF700AE50AA8EAD0C8E81F5828C3392CE39CFC3F8C976FC3E24B576F4DB55DAF2E7D3A6F6B6E5E89B189',
      )
    })
  })

  describe('createOrderHistoryRequestData', () => {
    const expected = {
      Mode: 'TEST',
      Version: '512',
      Terminal: terminal(
        '817BA6A5013BD1E75E1C2FE82AA0F2EFEF89033C31563575701BD05F3C20ADC5DD2AF65D9EF8CF81784E9DA787603E0C1321C6909BE920504BEB3A85992440F5',
      ),
      Customer: { IPAddress: '156.155.154.153' },
      Order: { OrderID: 'order222' },
      Transaction: {
        Type: 'orderhistoryinq',
        InstallmentCnt: '',
        Amount: 100,
        CurrencyCode: '949',
        CardholderPresentCode: '0',
        MotoInd: 'N',
      },
    }

    it('creates the request', () => {
      expectHash(expected)
      const actual = mapper.createOrderHistoryRequestData(account, {
        id: 'order222',
        ip: '156.155.154.153',
        installment: 0,
      })
      expectSame(actual, expected)
      expectHashedData(expected)
    })
  })

  describe('create3DPaymentRequestData', () => {
    const order: PosOrder = {
      id: '2020110828BC',
      amount: 100.25, // deviation: order amounts are numbers in TS
      installment: 0,
      currency: CURRENCY.TRY,
      success_url: 'https://domain.com/success',
      fail_url: 'https://domain.com/fail_url',
      lang: LANG.TR,
      ip: '156.155.154.153',
    }
    const responseData = {
      orderid: '2020110828BC',
      md: '1',
      xid: '100000005xid',
      eci: '100000005eci',
      cavv: 'cavv',
      txncurrencycode: '949',
      txnamount: '100.25',
      txntype: 'sales',
      customeripaddress: '127.0.0.1',
    }
    const hash =
      'C7806BCDC5874CD227C4B7278302077F6B3E463A9C74497F263E8AF08844DEF364F4D7A089084A705D4210B9B36841E0919B72F804729F466BF00472C53AFD8B'
    const expected = {
      Mode: 'TEST',
      Version: '512',
      Terminal: terminal(hash),
      Customer: { IPAddress: '127.0.0.1' },
      Order: { OrderID: '2020110828BC' },
      Transaction: {
        Type: 'sales',
        InstallmentCnt: '',
        Amount: '100.25',
        CurrencyCode: '949',
        CardholderPresentCode: '13',
        MotoInd: 'N',
        Secure3D: { AuthenticationCode: 'cavv', SecurityLevel: '100000005eci', TxnID: '100000005xid', Md: '1' },
      },
    }

    it('creates the request', () => {
      expectHash(expected)
      expectSame(mapper.create3DPaymentRequestData(account, order, TX_TYPE.PAY_AUTH, responseData), expected)
      expectHashedData(expected)
    })

    it('recurring_order', () => {
      const withRecurring = {
        ...expected,
        Recurring: {
          TotalPaymentNum: '3',
          FrequencyType: 'M',
          FrequencyInterval: '2',
          Type: 'R',
          StartDate: '20231015',
        },
      }
      expectHash(withRecurring)
      const actual = mapper.create3DPaymentRequestData(
        account,
        {
          ...order,
          // deviation: G9 - the start date is an instant, formatted on the Türkiye clock
          recurring: {
            frequency: 2,
            frequencyType: 'MONTH',
            installment: 3,
            startDate: new Date('2023-10-15T00:00:00+03:00'),
          },
        },
        TX_TYPE.PAY_AUTH,
        responseData,
      )
      expectSame(actual, withRecurring)
      expectHashedData(withRecurring)
    })

    // addition: callback data that the request is built from must be present
    it.each(['customeripaddress', 'orderid', 'txnamount', 'txncurrencycode', 'txntype'])(
      'rejects callback data without %s',
      (field) => {
        const incomplete: Record<string, unknown> = { ...responseData }
        delete incomplete[field]
        const act = () => mapper.create3DPaymentRequestData(account, order, TX_TYPE.PAY_AUTH, incomplete)
        expect(act).toThrow(PosError)
        expect(act).toThrow(field)
        expect(crypt.createHash).not.toHaveBeenCalled()
      },
    )
  })

  describe('create3DFormData', () => {
    const order: PosOrder = {
      id: 'order222',
      amount: 100.25, // deviation: order amounts are numbers in TS
      installment: 0,
      currency: CURRENCY.TRY,
      success_url: 'https://domain.com/success',
      fail_url: 'https://domain.com/fail_url',
      lang: LANG.TR,
      ip: '156.155.154.153',
    }
    const url = 'https://sanalposprovtest.garantibbva.com.tr/servlet/gt3dengine'
    const hash =
      '372D6CB20B2B699D0A6667DFF46E3AA8CF3F9D8C2BB69A7C411895151FFCFAAB5277CCFE3B3A06035FEEFBFBFD40C79DBE51DBF867D0A24B37335A28F0CEFDE2'
    const plain = {
      secure3dsecuritylevel: '3D',
      mode: 'TEST',
      apiversion: '512',
      terminalprovuserid: 'PROVAUT',
      terminaluserid: 'PROVAUT',
      terminalmerchantid: '7000679',
      terminalid: '30691298',
      txntype: 'sales',
      txnamount: '10025',
      txncurrencycode: '949',
      txninstallmentcount: '',
      orderid: 'order222',
      successurl: 'https://domain.com/success',
      errorurl: 'https://domain.com/fail_url',
      customeripaddress: '156.155.154.153',
    }
    const withCard = {
      ...plain,
      cardnumber: '5555444433332222',
      cardexpiredatemonth: '01',
      cardexpiredateyear: '22',
      cardcvv2: '123',
    }

    it.each([
      ['without_card', false, plain],
      ['with_card', true, withCard],
    ])('%s', async (_name, isWithCard, inputs) => {
      crypt.create3DHash.mockReturnValue(hash)
      const actual = await mapper.create3DFormData(
        account,
        order,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        url,
        isWithCard ? card : null,
      )

      expectSame(actual, { gateway: url, method: 'POST', inputs: { ...inputs, secure3dhash: hash } })
      expect(crypt.create3DHash).toHaveBeenCalledTimes(1)
      expect(crypt.create3DHash.mock.calls[0]?.[0]).toBe(account)
      expectSame(crypt.create3DHash.mock.calls[0]?.[1], inputs)
      expect(hook).toHaveBeenCalledTimes(1)
      const event = hook.mock.calls[0]?.[0] as Before3DFormHashCalculatedEvent
      expect(event.gatewayClass).toBe('GarantiPos')
      expect(event.txType).toBe(TX_TYPE.PAY_AUTH)
      expect(event.paymentModel).toBe(MODEL.THREE_D_SECURE)
      expect(event.bankName).toBe('garanti')
      expect(Object.keys(event.formInputs).length).toBeGreaterThan(3)
    })

    // addition: real signature of the reference form
    it('signs the form with the real crypt', async () => {
      const real = new GarantiPosRequestDataMapper(
        new GarantiPosRequestValueMapper(),
        new GarantiPosRequestValueFormatter(),
        {},
        new GarantiPosCrypt({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as PosLogger),
        LANG.EN,
      )
      real.setTestMode(true)
      const actual = await real.create3DFormData(account, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, url)
      expect(actual.inputs.secure3dhash).toBe(hash)
    })

    // addition: what the hooks changed is what gets hashed and sent
    it('hashes the inputs as changed by a hook', async () => {
      crypt.create3DHash.mockReturnValue('H')
      hook.mockImplementation((e) => {
        e.formInputs.txnamount = '1'
      })
      const actual = await mapper.create3DFormData(account, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, url)
      const hashed = crypt.create3DHash.mock.calls[0]?.[1] as Record<string, string>
      expect(hashed.txnamount).toBe('1')
      expect(actual.inputs.txnamount).toBe('1')
      expect(actual.inputs.secure3dhash).toBe('H')
    })

    // addition: rounded, not truncated
    it('formats 0.29 as 29', async () => {
      crypt.create3DHash.mockReturnValue('H')
      const actual = await mapper.create3DFormData(
        account,
        { ...order, amount: 0.29 },
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        url,
      )
      expect(actual.inputs.txnamount).toBe('29')
    })

    // addition: a missing field is an error, never the text "undefined"
    it.each(['ip', 'success_url', 'fail_url', 'id', 'amount'])('rejects a missing %s', async (field) => {
      const incomplete: PosOrder = { ...order }
      delete incomplete[field]
      await expect(
        mapper.create3DFormData(account, incomplete, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, url),
      ).rejects.toThrow(PosError)
      expect(crypt.create3DHash).not.toHaveBeenCalled()
    })

    it('requires an order', async () => {
      await expect(mapper.create3DFormData(account, null, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, url)).rejects.toThrow(
        PosError,
      )
    })
  })

  describe('createStatusRequestData', () => {
    const expected = {
      Mode: 'TEST',
      Version: '512',
      Terminal: terminal(
        '35E8410A78E24949D78F5E025B5E05AF470B01385A2ECBFEE6C5B3CDACFF78011D387ECAFDCE4B8453D80D35C2F344F3DAA6F2EF9143079F64DE88401EC5E4F5',
      ),
      Customer: { IPAddress: '127.15.15.1' },
      Order: { OrderID: '2020110828BC' },
      Transaction: {
        Type: 'orderinq',
        InstallmentCnt: '',
        Amount: 100,
        CurrencyCode: '949',
        CardholderPresentCode: '0',
        MotoInd: 'N',
      },
    }

    it('creates the request', () => {
      expectHash(expected)
      expectSame(mapper.createStatusRequestData(account, { id: '2020110828BC', ip: '127.15.15.1' }), expected)
      expectHashedData(expected)
    })

    // addition: the ip is optional here and defaults to an empty string
    it('defaults the ip to an empty string', () => {
      crypt.createHash.mockReturnValue('H')
      const actual = mapper.createStatusRequestData(account, { id: '2020110828BC' })
      expect((actual.Customer as Record<string, string>).IPAddress).toBe('')
    })
  })

  describe('createRefundRequestData', () => {
    const order: PosOrder = {
      id: '2020110828BC',
      ip: '127.15.15.1',
      currency: CURRENCY.TRY,
      amount: 123.1,
      ref_ret_num: '831803579226',
      installment: 0,
    }
    const expected = {
      Mode: 'TEST',
      Version: '512',
      Terminal: terminal(
        'CF49751B3B793B9E1946A08815451989D0231D68A5B495C6EABA9C400442F2E6B7DF97446CE2D3562780767E634A6ECBAA1DF69F6DF7F447884A71BDE38D12AA',
        'PROVRFN',
      ),
      Customer: { IPAddress: '127.15.15.1' },
      Order: { OrderID: '2020110828BC' },
      Transaction: {
        Type: 'refund',
        InstallmentCnt: '',
        Amount: 12310,
        CurrencyCode: '949',
        CardholderPresentCode: '0',
        MotoInd: 'N',
        OriginalRetrefNum: '831803579226',
      },
    }

    it.each<[string, TxType]>([
      ['refund', TX_TYPE.REFUND],
      ['refund_partial', TX_TYPE.REFUND_PARTIAL],
    ])('%s', (_name, txType) => {
      expectHash(expected)
      const actual = mapper.createRefundRequestData(account, order, txType)
      expectSame(actual, expected)
      expectHashedData(expected)
    })

    // deviation: G16 - the missing refund credentials are a MissingAccountInfoError
    it('without refund credentials', () => {
      const noRefund = AccountFactory.createGarantiPosAccount(
        'garanti',
        '7000679',
        'PROVAUT',
        '123qweASD/',
        '30691298',
        '12345678',
      )
      expect(() => mapper.createRefundRequestData(noRefund, order, TX_TYPE.REFUND)).toThrow(MissingAccountInfoError)
      expect(crypt.createHash).not.toHaveBeenCalled()
    })

    // addition: the refund amount is required
    it('rejects a missing amount', () => {
      const { amount: _a, ...noAmount } = order
      expect(() => mapper.createRefundRequestData(account, noAmount, TX_TYPE.REFUND)).toThrow(PosError)
    })
  })

  // deviation: G16 - NotImplementedError instead of BadMethodCallException
  it('create3DFormInitializeRequestData throws by default', () => {
    expect(() => mapper.create3DFormInitializeRequestData(account, {}, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH)).toThrow(
      NotImplementedError,
    )
  })

  // addition: the caller's order is never changed
  it('does not mutate the order', () => {
    crypt.createHash.mockReturnValue('H')
    const order: PosOrder = {
      id: 'o1',
      amount: 10,
      ip: '1.1.1.1',
      ref_ret_num: 'r',
      recurring: {
        frequency: 1,
        frequencyType: 'MONTH',
        installment: 2,
        startDate: new Date('2024-01-01T00:00:00+03:00'),
      },
    }
    const snapshot = structuredClone(order)
    mapper.createNonSecurePaymentRequestData(account, order, TX_TYPE.PAY_AUTH, card)
    mapper.createCancelRequestData(account, order)
    mapper.createRefundRequestData(account, order, TX_TYPE.REFUND)
    mapper.createStatusRequestData(account, order)
    expect(order).toStrictEqual(snapshot)
  })
})
