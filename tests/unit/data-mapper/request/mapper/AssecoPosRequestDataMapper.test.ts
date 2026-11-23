import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CryptInterface } from '../../../../../src/crypt/CryptInterface.js'
import { AssecoPosRequestDataMapper } from '../../../../../src/data-mapper/request/mapper/AssecoPosRequestDataMapper.js'
import { AssecoPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/AssecoPosRequestValueFormatter.js'
import { AssecoPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/AssecoPosRequestValueMapper.js'
import { PosError } from '../../../../../src/errors.js'
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
import type { Before3DFormHashCalculatedEvent, PosOrder } from '../../../../../src/types.js'

const account = AccountFactory.createAssecoPosAccount('payten_v3_hash', '190100000', 'ZIRAATAPI', 'ZIRAAT19', '123456')
const card = CreditCardFactory.create('5555444433332222', '22', '01', '123', 'ahmet', CARD_TYPE.VISA)

/** PHP assertSame on arrays also compares key order and null vs missing: compare serialised form. */
function expectSame(actual: unknown, expected: unknown): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
  expect(actual).toStrictEqual(expected)
}

describe('AssecoPosRequestDataMapper', () => {
  let crypt: { [K in keyof CryptInterface]: ReturnType<typeof vi.fn> }
  let hook: ReturnType<typeof vi.fn<(e: Before3DFormHashCalculatedEvent) => void>>
  let mapper: AssecoPosRequestDataMapper

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
    mapper = new AssecoPosRequestDataMapper(
      new AssecoPosRequestValueMapper(),
      new AssecoPosRequestValueFormatter(),
      { onBefore3DFormHashCalculated: [hook] },
      crypt as unknown as CryptInterface<never>,
      LANG.EN,
    )
  })

  it('supports only AssecoPos', () => {
    expect(AssecoPosRequestDataMapper.supports('AssecoPos')).toBe(true)
    expect(AssecoPosRequestDataMapper.supports('AkbankPos')).toBe(false)
  })

  describe('create3DFormData', () => {
    const order: PosOrder = {
      id: 'order222',
      ip: '127.0.0.1',
      amount: 100.25,
      installment: 0,
      currency: CURRENCY.TRY,
      success_url: 'https://domain.com/success',
      fail_url: 'https://domain.com/fail_url',
      lang: LANG.TR,
    }
    const url = 'https://entegrasyon.asseco-see.com.tr/fim/est3Dgate'
    const base = {
      clientid: '190100000',
      oid: 'order222',
      amount: '100.25',
      okUrl: 'https://domain.com/success',
      failUrl: 'https://domain.com/fail_url',
      rnd: 'rand-21212',
      lang: 'tr',
      currency: '949',
      taksit: '',
      TranType: 'Auth',
      hashAlgorithm: 'ver3',
    }

    const cases: Array<[string, PaymentModel, boolean, Record<string, string>]> = [
      [
        'without_card',
        MODEL.THREE_D_SECURE,
        false,
        {
          ...base,
          storetype: '3d',
          hash: '7tt3i3SMhzR3jYjCMwNrolSn7ksY7eKz2kVsqt/nUGK6XNw9/dMMZPVqHK9pQROGEIW3PJWut6v1Xv6ZDtnuSA==',
        },
      ],
      [
        'with_card',
        MODEL.THREE_D_SECURE,
        true,
        {
          ...base,
          storetype: '3d',
          pan: '5555444433332222',
          Ecom_Payment_Card_ExpDate_Month: '01',
          Ecom_Payment_Card_ExpDate_Year: '22',
          cv2: '123',
          hash: '3fvBzh0HT3UiKUTXis0Ke2NG3mAp9eBOwx26bstv+l6L946GrOF2JklXfqTNc6VBeqUSkuLxo4ErtwCWuPCzYw==',
        },
      ],
      [
        '3d_host',
        MODEL.THREE_D_HOST,
        false,
        {
          ...base,
          storetype: '3d_host',
          hash: 'wlqP71Pwu5+zaCYCGxWpbqf1cAsbou5p5PDAds4YcejFO5AVTw0PjnzNiFnYX900ZL38rQw8Jt/YhMmZ5bJ/qA==',
        },
      ],
    ]

    it.each(cases)('%s', async (_name, model, withCard, inputs) => {
      crypt.create3DHash.mockReturnValue(inputs.hash)
      crypt.generateRandomString.mockReturnValue(inputs.rnd)

      const actual = await mapper.create3DFormData(account, order, model, TX_TYPE.PAY_AUTH, url, withCard ? card : null)

      expect(actual.gateway).toBe(url)
      expect(actual.method).toBe('POST')
      expect(Object.fromEntries(Object.entries(actual.inputs).sort())).toStrictEqual(
        Object.fromEntries(Object.entries(inputs).sort()),
      )
      expect(crypt.create3DHash).toHaveBeenCalledTimes(1)
      expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
      expect(hook).toHaveBeenCalledTimes(1)
      const event = hook.mock.calls[0]?.[0] as Before3DFormHashCalculatedEvent
      expect(event.gatewayClass).toBe('AssecoPos')
      expect(event.txType).toBe(TX_TYPE.PAY_AUTH)
      expect(event.paymentModel).toBe(model)
      expect(event.bankName).toBe('payten_v3_hash')
      expect(Object.keys(event.formInputs).length).toBeGreaterThan(3)
    })

    it('hashes the inputs as modified by the hook, and the hash is not part of what is hashed', async () => {
      let hashed: Record<string, string> = {}
      crypt.create3DHash.mockImplementation((_a: unknown, inputs: Record<string, string>) => {
        hashed = { ...inputs }
        return 'H'
      })
      crypt.generateRandomString.mockReturnValue('r')
      hook.mockImplementation((e) => {
        e.formInputs.extra = 'added'
      })

      const actual = await mapper.create3DFormData(account, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, url)

      expect(hashed.extra).toBe('added')
      expect('hash' in hashed).toBe(false)
      expect(actual.inputs.extra).toBe('added')
      expect(actual.inputs.hash).toBe('H')
    })

    it('uses the default language when the order has none', async () => {
      crypt.create3DHash.mockReturnValue('H')
      const { lang: _lang, ...noLang } = order
      const actual = await mapper.create3DFormData(account, noLang, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, url)
      expect(actual.inputs.lang).toBe('en')
    })

    it.each([
      [10, '10'],
      [10.5, '10.5'],
      [0.1, '0.1'],
      [1.005, '1.005'],
      [1000.01, '1000.01'],
    ])('formats the amount %d as %j', async (amount, expected) => {
      crypt.create3DHash.mockReturnValue('H')
      const actual = await mapper.create3DFormData(
        account,
        { ...order, amount },
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        url,
      )
      expect(actual.inputs.amount).toBe(expected)
    })

    it('requires an order', async () => {
      await expect(mapper.create3DFormData(account, null, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, url)).rejects.toThrow(
        PosError,
      )
    })

    it('returns plain structured-cloneable data', async () => {
      crypt.create3DHash.mockReturnValue('H')
      const actual = await mapper.create3DFormData(account, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, url, card)
      expect(structuredClone(actual)).toStrictEqual(actual)
    })
  })

  describe('createNonSecurePostAuthPaymentRequestData', () => {
    const head = {
      Name: 'ZIRAATAPI',
      Password: 'ZIRAAT19',
      ClientId: '190100000',
      Type: 'PostAuth',
      OrderId: '2020110828BC',
    }
    it.each([
      ['without_amount', { id: '2020110828BC' }, { ...head, Total: null }],
      ['with_amount', { id: '2020110828BC', amount: 1.0 }, { ...head, Total: '1' }],
      [
        'with_pre_auth_amount',
        { id: '2020110828BC', amount: 1.1, pre_auth_amount: 1.0 },
        { ...head, Total: '1.1', Extra: { PREAMT: '1' } },
      ],
    ])('%s', (_n, order, expected) => {
      expectSame(mapper.createNonSecurePostAuthPaymentRequestData(account, order), expected)
    })
  })

  describe('createNonSecurePaymentRequestData', () => {
    const expectedBasic = {
      Name: 'ZIRAATAPI',
      Password: 'ZIRAAT19',
      ClientId: '190100000',
      Type: 'Auth',
      IPAddress: '127.0.0.1',
      OrderId: 'order222',
      Total: '10.01',
      Currency: '949',
      Taksit: '',
      Number: '5555444433332222',
      Expires: '01/22',
      Cvv2Val: '123',
      Mode: 'P',
    }

    it('basic', () => {
      const order = { id: 'order222', amount: 10.01, ip: '127.0.0.1' }
      expectSame(mapper.createNonSecurePaymentRequestData(account, order, TX_TYPE.PAY_AUTH, card), expectedBasic)
    })

    it('recurring', () => {
      const order = {
        id: 'order222',
        amount: 10.01,
        ip: '127.0.0.1',
        recurring: { frequency: 3, frequencyType: 'MONTH', installment: 4 },
      }
      expectSame(mapper.createNonSecurePaymentRequestData(account, order, TX_TYPE.PAY_AUTH, card), {
        ...expectedBasic,
        PbOrder: { OrderType: '0', OrderFrequencyInterval: '3', OrderFrequencyCycle: 'M', TotalNumberPayments: '4' },
      })
    })
  })

  describe('createCancelRequestData', () => {
    it('plain cancel', () => {
      expectSame(mapper.createCancelRequestData(account, { id: '2020110828BC' }), {
        Name: 'ZIRAATAPI',
        Password: 'ZIRAAT19',
        ClientId: '190100000',
        OrderId: '2020110828BC',
        Type: 'Void',
      })
    })

    it('recurring installment cancel', () => {
      expectSame(
        mapper.createCancelRequestData(account, { id: '2020110828BC', recurringOrderInstallmentNumber: '2' }),
        {
          Name: 'ZIRAATAPI',
          Password: 'ZIRAAT19',
          ClientId: '190100000',
          Extra: { RECORDTYPE: 'Order', RECURRINGOPERATION: 'Cancel', RECORDID: '2020110828BC-2' },
        },
      )
    })
  })

  it('createOrderHistoryRequestData', () => {
    expectSame(mapper.createOrderHistoryRequestData(account, { id: '2020110828BC' }), {
      Name: 'ZIRAATAPI',
      Password: 'ZIRAAT19',
      ClientId: '190100000',
      OrderId: '2020110828BC',
      Extra: { ORDERHISTORY: 'QUERY' },
    })
  })

  describe('create3DPaymentRequestData', () => {
    const order: PosOrder = {
      id: 'order222',
      ip: '127.0.0.1',
      amount: 100.25,
      installment: 0,
      currency: CURRENCY.TRY,
      success_url: 'https://domain.com/success',
      fail_url: 'https://domain.com/fail_url',
      lang: 'tr',
    }
    const responseData = { md: '1', xid: '100000005xid', eci: '100000005eci', cavv: 'cavv' }
    const expected = {
      Name: 'ZIRAATAPI',
      Password: 'ZIRAAT19',
      ClientId: '190100000',
      Type: 'Auth',
      IPAddress: '127.0.0.1',
      OrderId: 'order222',
      Total: '100.25',
      Currency: '949',
      Taksit: '',
      Number: '1',
      PayerTxnId: '100000005xid',
      PayerSecurityLevel: '100000005eci',
      PayerAuthenticationCode: 'cavv',
      Mode: 'P',
    }

    it('basic', () => {
      expectSame(mapper.create3DPaymentRequestData(account, order, TX_TYPE.PAY_AUTH, responseData), expected)
    })

    it('recurring_order', () => {
      const recurring = { ...order, recurring: { frequency: 2, frequencyType: 'MONTH', installment: 3 } }
      expectSame(mapper.create3DPaymentRequestData(account, recurring, TX_TYPE.PAY_AUTH, responseData), {
        ...expected,
        PbOrder: { OrderType: '0', OrderFrequencyInterval: '2', OrderFrequencyCycle: 'M', TotalNumberPayments: '3' },
      })
    })
  })

  describe('createStatusRequestData', () => {
    const head = { Name: 'ZIRAATAPI', Password: 'ZIRAAT19', ClientId: '190100000' }
    it('by order id', () => {
      expectSame(mapper.createStatusRequestData(account, { id: '2020110828BC' }), {
        ...head,
        Extra: { ORDERSTATUS: 'QUERY' },
        OrderId: '2020110828BC',
      })
    })

    it('by recurring id', () => {
      expectSame(mapper.createStatusRequestData(account, { recurringId: '22303O8EA19252' }), {
        ...head,
        Extra: { ORDERSTATUS: 'QUERY', RECURRINGID: '22303O8EA19252' },
      })
    })
  })

  describe('createRefundRequestData', () => {
    const expected = {
      ClientId: '190100000',
      Currency: '949',
      Name: 'ZIRAATAPI',
      OrderId: 'order-123',
      Password: 'ZIRAAT19',
      Total: '5',
      Type: 'Credit',
    }
    it.each([
      ['full_refund', TX_TYPE.REFUND],
      ['partial_refund', TX_TYPE.REFUND_PARTIAL],
    ] as Array<[string, TxType]>)('%s', (_n, txType) => {
      const actual = mapper.createRefundRequestData(
        account,
        { id: 'order-123', currency: CURRENCY.TRY, amount: 5 },
        txType,
      )
      // order independent
      expect(Object.fromEntries(Object.entries(actual).sort())).toStrictEqual(expected)
    })

    it('defaults the currency to TRY', () => {
      const actual = mapper.createRefundRequestData(account, { id: 'order-123', amount: 5 }, TX_TYPE.REFUND)
      expect(actual.Currency).toBe('949')
    })
  })
})
