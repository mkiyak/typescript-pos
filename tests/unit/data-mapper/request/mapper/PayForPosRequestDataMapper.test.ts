import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayForPosCrypt } from '../../../../../src/crypt/PayForPosCrypt.js'
import { PayForPosRequestDataMapper } from '../../../../../src/data-mapper/request/mapper/PayForPosRequestDataMapper.js'
import { PayForPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/PayForPosRequestValueFormatter.js'
import { PayForPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/PayForPosRequestValueMapper.js'
import { PosError, UnsupportedTransactionTypeError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import { CURRENCY, LANG, MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'
import type { Before3DFormHashCalculatedEvent, PosOrder } from '../../../../../src/types.js'

const Q = AccountFactory.createPayForPosAccount(
  'qnbfinansbank-payfor',
  '085300000009704',
  'QNB_API_KULLANICI_3DPAY',
  'UcBN0',
  '12345678',
)
const Z = AccountFactory.createPayForPosAccount(
  'ziraat-katilim',
  '085300000009704',
  'ZIRAATKATILIM_API_KULLANICI_3DPAY',
  'UcBN0',
  '12345678',
  '12',
)
const accounts = { finansbank: Q, ziraat_katilim: Z }
const card = CreditCardFactory.create('5555444433332222', '22', '01', '123', 'ahmet')

/** assertSame on arrays also compares key order: compare the serialised form as well. */
function expectSame(actual: unknown, expected: unknown): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
  expect(actual).toStrictEqual(expected)
}

/** Key-sorted copy, for the rows compared after ksort. */
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

type CryptStub = Record<
  'hashString' | 'check3DHash' | 'create3DHash' | 'createHash' | 'hashFromParams' | 'generateRandomString',
  ReturnType<typeof vi.fn>
>

function makeCryptStub(): CryptStub {
  return {
    hashString: vi.fn(),
    check3DHash: vi.fn(),
    create3DHash: vi.fn(),
    createHash: vi.fn(),
    hashFromParams: vi.fn(),
    generateRandomString: vi.fn(),
  }
}

function makeMapper(
  crypt: unknown,
  hooks: Array<(e: Before3DFormHashCalculatedEvent) => void | Promise<void>> = [],
): PayForPosRequestDataMapper {
  return new PayForPosRequestDataMapper(
    new PayForPosRequestValueMapper(),
    new PayForPosRequestValueFormatter(),
    { onBefore3DFormHashCalculated: hooks },
    crypt as PayForPosCrypt,
    LANG.EN,
  )
}

describe('PayForPosRequestDataMapper', () => {
  let crypt: CryptStub
  let hook: ReturnType<typeof vi.fn<(e: Before3DFormHashCalculatedEvent) => void>>
  let mapper: PayForPosRequestDataMapper

  beforeEach(() => {
    crypt = makeCryptStub()
    hook = vi.fn()
    mapper = makeMapper(crypt, [hook])
  })

  it('supports only PayForPos', () => {
    expect(PayForPosRequestDataMapper.supports('PayForPos')).toBe(true)
    expect(PayForPosRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  describe('3D payment (provision)', () => {
    it('builds the provision request', () => {
      expectSame(
        mapper.create3DPaymentRequestData(Q, { id: '2020110828BC' }, TX_TYPE.PAY_AUTH, {
          RequestGuid: '1000000057437884',
        }),
        {
          RequestGuid: '1000000057437884',
          UserCode: 'QNB_API_KULLANICI_3DPAY',
          UserPass: 'UcBN0',
          OrderId: '2020110828BC',
          SecureType: '3DModelPayment',
        },
      )
    })

    // addition: the request guid must be an own string of the callback
    it.each([
      ['object', { a: 1 }],
      ['array', ['1']],
      ['number', 1],
      ['null', null],
      ['empty', ''],
    ])('rejects a %s request guid', (_name, value) => {
      expect(() =>
        mapper.create3DPaymentRequestData(Q, { id: '2020110828BC' }, TX_TYPE.PAY_AUTH, {
          RequestGuid: value as never,
        }),
      ).toThrow(PosError)
    })

    it('rejects a request guid that is only inherited', () => {
      const callback = Object.create({ RequestGuid: '1' }) as Record<string, unknown>
      expect(() => mapper.create3DPaymentRequestData(Q, { id: '1' }, TX_TYPE.PAY_AUTH, callback)).toThrow(PosError)
    })

    it('requires the order id', () => {
      expect(() => mapper.create3DPaymentRequestData(Q, {}, TX_TYPE.PAY_AUTH, { RequestGuid: '1' })).toThrow(PosError)
    })
  })

  describe('cancel', () => {
    it.each([
      ['finansbank', 'QNB_API_KULLANICI_3DPAY', '5'],
      ['ziraat_katilim', 'ZIRAATKATILIM_API_KULLANICI_3DPAY', '12'],
    ] as const)('%s', (name, userCode, mbrId) => {
      expectSame(mapper.createCancelRequestData(accounts[name], { id: '2020110828BC', currency: CURRENCY.TRY }), {
        MerchantId: '085300000009704',
        UserCode: userCode,
        UserPass: 'UcBN0',
        MbrId: mbrId,
        OrgOrderId: '2020110828BC',
        SecureType: 'NonSecure',
        TxnType: 'Void',
        Currency: '949',
        Lang: 'EN',
      })
    })
  })

  describe('non-secure payment', () => {
    const expected = (userCode: string, mbrId: string, lang = 'EN') => ({
      MerchantId: '085300000009704',
      UserCode: userCode,
      UserPass: 'UcBN0',
      MbrId: mbrId,
      MOTO: '0',
      OrderId: '2020110828BC',
      SecureType: 'NonSecure',
      TxnType: 'Auth',
      PurchAmount: '100.01',
      Currency: '949',
      InstallmentCount: '0',
      Lang: lang,
      CardHolderName: 'ahmet',
      Pan: '5555444433332222',
      Expiry: '0122',
      Cvv2: '123',
    })

    it('finansbank', () => {
      expectSame(
        mapper.createNonSecurePaymentRequestData(Q, { id: '2020110828BC', amount: 100.01 }, TX_TYPE.PAY_AUTH, card),
        expected('QNB_API_KULLANICI_3DPAY', '5'),
      )
    })

    it('lang_tr', () => {
      expectSame(
        mapper.createNonSecurePaymentRequestData(
          Q,
          { id: '2020110828BC', amount: 100.01, lang: LANG.TR },
          TX_TYPE.PAY_AUTH,
          card,
        ),
        expected('QNB_API_KULLANICI_3DPAY', '5', 'TR'),
      )
    })

    it('ziraat_katilim', () => {
      expectSame(
        mapper.createNonSecurePaymentRequestData(Z, { id: '2020110828BC', amount: 100.01 }, TX_TYPE.PAY_AUTH, card),
        expected('ZIRAATKATILIM_API_KULLANICI_3DPAY', '12'),
      )
    })

    // addition: a card without a holder name sends an empty name, and the pre-authorization type is mapped
    it('sends an empty holder name for a null holder and maps a pre-authorization', () => {
      const noHolder = CreditCardFactory.create('5555444433332222', '22', '01', '123', null)
      const data = mapper.createNonSecurePaymentRequestData(
        Q,
        { id: '2020110828BC', amount: 100.01 },
        TX_TYPE.PAY_PRE_AUTH,
        noHolder,
      )
      expect(data.CardHolderName).toBe('')
      expect(data.TxnType).toBe('PreAuth')
    })
  })

  describe('non-secure post-auth', () => {
    const order = { id: '2020110828BC', amount: 100.01, installment: 0, currency: CURRENCY.TRY }

    it.each([
      ['finansbank', 'QNB_API_KULLANICI_3DPAY', '5'],
      ['ziraat_katilim', 'ZIRAATKATILIM_API_KULLANICI_3DPAY', '12'],
    ] as const)('%s', (name, userCode, mbrId) => {
      expectSame(mapper.createNonSecurePostAuthPaymentRequestData(accounts[name], order), {
        MerchantId: '085300000009704',
        UserCode: userCode,
        UserPass: 'UcBN0',
        MbrId: mbrId,
        OrgOrderId: '2020110828BC',
        SecureType: 'NonSecure',
        TxnType: 'PostAuth',
        PurchAmount: '100.01',
        Currency: '949',
        Lang: 'EN',
      })
    })
  })

  describe('status', () => {
    it.each([
      ['finansbank', 'QNB_API_KULLANICI_3DPAY', '5'],
      ['ziraat_katilim', 'ZIRAATKATILIM_API_KULLANICI_3DPAY', '12'],
    ] as const)('%s', (name, userCode, mbrId) => {
      expectSame(mapper.createStatusRequestData(accounts[name], { id: '2020110828BC' }), {
        MerchantId: '085300000009704',
        UserCode: userCode,
        UserPass: 'UcBN0',
        MbrId: mbrId,
        OrgOrderId: '2020110828BC',
        SecureType: 'Inquiry',
        Lang: 'EN',
        TxnType: 'OrderInquiry',
      })
    })
  })

  describe('order history', () => {
    it.each([
      ['finansbank', 'QNB_API_KULLANICI_3DPAY', '5'],
      ['ziraat_katilim', 'ZIRAATKATILIM_API_KULLANICI_3DPAY', '12'],
    ] as const)('%s', (name, userCode, mbrId) => {
      const actual = mapper.createOrderHistoryRequestData(accounts[name], { id: '2020110828BC' })
      expect(sorted(actual)).toStrictEqual(
        sorted({
          MerchantId: '085300000009704',
          UserCode: userCode,
          UserPass: 'UcBN0',
          MbrId: mbrId,
          SecureType: 'Report',
          TxnType: 'TxnHistory',
          Lang: 'EN',
          OrderId: '2020110828BC',
        }),
      )
    })

    // addition: the order language is honoured
    it('uses the order language', () => {
      expect(mapper.createOrderHistoryRequestData(Q, { id: '2020110828BC', lang: LANG.TR }).Lang).toBe('TR')
    })
  })

  describe('refund', () => {
    const order = { id: '7022b92e-3aa1-44fb-86d4-33658c700c80', currency: CURRENCY.TRY, amount: 5 }

    it.each([
      ['full_refund', 'finansbank', TX_TYPE.REFUND, 'QNB_API_KULLANICI_3DPAY', '5'],
      ['full_refund_ziraat_katilim', 'ziraat_katilim', TX_TYPE.REFUND, 'ZIRAATKATILIM_API_KULLANICI_3DPAY', '12'],
      ['partial_refund', 'finansbank', TX_TYPE.REFUND_PARTIAL, 'QNB_API_KULLANICI_3DPAY', '5'],
    ] as const)('%s', (_name, name, txType, userCode, mbrId) => {
      const actual = mapper.createRefundRequestData(accounts[name], order, txType)
      expect(sorted(actual)).toStrictEqual(
        sorted({
          Currency: '949',
          Lang: 'EN',
          MbrId: mbrId,
          MerchantId: '085300000009704',
          OrgOrderId: '7022b92e-3aa1-44fb-86d4-33658c700c80',
          PurchAmount: '5',
          SecureType: 'NonSecure',
          TxnType: 'Refund',
          UserCode: userCode,
          UserPass: 'UcBN0',
        }),
      )
    })
  })

  describe('3D form', () => {
    const order: PosOrder = {
      id: '2020110828BC',
      amount: 100.01,
      installment: '0' as never, // the order installment may arrive as text
      currency: CURRENCY.TRY,
      success_url: 'http://localhost/finansbank-payfor/3d/success.php',
      fail_url: 'http://localhost/finansbank-payfor/3d/fail.php',
      lang: LANG.TR,
    }
    const baseInputs = (userCode: string, mbrId: string, secureType: string) => ({
      MbrId: mbrId,
      MerchantID: '085300000009704',
      UserCode: userCode,
      OrderId: '2020110828BC',
      Lang: 'TR',
      SecureType: secureType,
      TxnType: 'Auth',
      PurchAmount: '100.01',
      InstallmentCount: '0',
      Currency: '949',
      OkUrl: 'http://localhost/finansbank-payfor/3d/success.php',
      FailUrl: 'http://localhost/finansbank-payfor/3d/fail.php',
      Rnd: '1deda47050cd38112cbf91f4',
    })
    const cardInputs = { CardHolderName: 'ahmet', Pan: '5555444433332222', Expiry: '0122', Cvv2: '123' }
    const hash = 'BSj3xu8dYQbdw5YM4JvTS+vmyUI='
    const q = 'QNB_API_KULLANICI_3DPAY'
    const z = 'ZIRAATKATILIM_API_KULLANICI_3DPAY'

    const rows = [
      {
        name: 'without_card',
        account: Q,
        url: 'https://vpostest.qnbfinansbank.com/Gateway/Default.aspx',
        model: MODEL.THREE_D_SECURE,
        withCard: false,
        inputs: { ...baseInputs(q, '5', '3DModel'), Hash: hash },
      },
      {
        name: 'with_card',
        account: Q,
        url: 'https://vpostest.qnbfinansbank.com/Gateway/Default.aspx',
        model: MODEL.THREE_D_SECURE,
        withCard: true,
        inputs: { ...baseInputs(q, '5', '3DModel'), ...cardInputs, Hash: hash },
      },
      {
        name: 'with_card_ziraat_katilim',
        account: Z,
        url: 'https://vpostest.qnbfinansbank.com/Gateway/Default.aspx',
        model: MODEL.THREE_D_SECURE,
        withCard: true,
        inputs: { ...baseInputs(z, '12', '3DModel'), ...cardInputs, Hash: hash },
      },
      {
        name: '3d_host',
        account: Q,
        url: 'https://vpostest.qnbfinansbank.com/Gateway/3DHost.aspx',
        model: MODEL.THREE_D_HOST,
        withCard: false,
        inputs: { ...baseInputs(q, '5', '3DHost'), Hash: hash },
      },
    ]

    function arrange(inputs: Record<string, string>): void {
      crypt.create3DHash.mockReturnValue(inputs.Hash)
      crypt.generateRandomString.mockReturnValue(inputs.Rnd)
    }

    function expectHookOnce(model: PaymentModel, txType: TxType): void {
      expect(hook).toHaveBeenCalledOnce()
      const event = hook.mock.calls[0]?.[0] as Before3DFormHashCalculatedEvent
      expect(event.gatewayClass).toBe('PayForPos')
      expect(event.txType).toBe(txType)
      expect(event.paymentModel).toBe(model)
      expect(Object.keys(event.formInputs).length).toBeGreaterThan(3)
    }

    it.each(rows)('create3DFormData: $name', async (row) => {
      arrange(row.inputs)
      const actual = await mapper.create3DFormData(
        row.account,
        order,
        row.model,
        TX_TYPE.PAY_AUTH,
        row.url,
        row.withCard ? card : null,
      )
      expectSame(actual, { gateway: row.url, method: 'POST', inputs: row.inputs })
      expect(crypt.create3DHash).toHaveBeenCalledOnce()
      expect(crypt.generateRandomString).toHaveBeenCalledOnce()
      expectHookOnce(row.model, TX_TYPE.PAY_AUTH)
    })

    // deviation: F31, the initialization data is awaited because the hook can be asynchronous
    it.each(rows)('create3DFormInitializeRequestData: $name', async (row) => {
      arrange(row.inputs)
      const actual = await mapper.create3DFormInitializeRequestData(
        row.account,
        order,
        row.model,
        TX_TYPE.PAY_AUTH,
        row.withCard ? card : null,
      )
      expectSame(actual, row.inputs)
      expect(crypt.create3DHash).toHaveBeenCalledOnce()
      expectHookOnce(row.model, TX_TYPE.PAY_AUTH)
    })

    // addition: the hash is created from the hooked inputs and appended last
    it('hashes the inputs the hooks left', async () => {
      crypt.create3DHash.mockReturnValue('H')
      crypt.generateRandomString.mockReturnValue('R')
      const hooked = makeMapper(crypt, [
        (event) => {
          event.formInputs.PurchAmount = '1.00'
        },
      ])
      const actual = await hooked.create3DFormInitializeRequestData(Q, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH)
      expect(actual.PurchAmount).toBe('1.00')
      expect(crypt.create3DHash.mock.calls[0]?.[1]).toMatchObject({ PurchAmount: '1.00' })
      expect(crypt.create3DHash.mock.calls[0]?.[1]).not.toHaveProperty('Hash')
      expect(Object.keys(actual).at(-1)).toBe('Hash')
    })

    // addition: real crypt, the signature is recomputed independently
    it('signs the form with the real crypt after the hooks have run', async () => {
      const real = new PayForPosCrypt()
      const plain = makeMapper(real)
      const withCard = await plain.create3DFormInitializeRequestData(
        Q,
        order,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        card,
      )
      const signed = (inputs: Record<string, string>) =>
        s1(
          [
            '5',
            '2020110828BC',
            inputs.PurchAmount,
            order.success_url,
            order.fail_url,
            'Auth',
            '0',
            inputs.Rnd,
            '12345678',
          ].join(''),
        )
      expect(withCard.PurchAmount).toBe('100.01')
      expect(withCard.Hash).toBe(signed(withCard))
      expect(withCard.Rnd).toMatch(/^[0-9A-F]{24}$/)

      const hooked = makeMapper(real, [
        (event) => {
          event.formInputs.PurchAmount = '1.00'
        },
      ])
      const changed = await hooked.create3DFormInitializeRequestData(
        Q,
        order,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        card,
      )
      expect(changed.PurchAmount).toBe('1.00')
      expect(changed.Hash).toBe(signed(changed))
      expect(changed.Hash).not.toBe(withCard.Hash)
    })

    // addition: a missing card on the 3D model gives no card keys
    it('has no card keys without a card', async () => {
      arrange((rows[0] as (typeof rows)[number]).inputs)
      const actual = await mapper.create3DFormInitializeRequestData(
        Q,
        order,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        null,
      )
      for (const key of ['CardHolderName', 'Pan', 'Expiry', 'Cvv2']) {
        expect(actual).not.toHaveProperty(key)
      }
    })

    // addition: a card holder of null is sent as an empty name
    it('sends an empty holder name for a null holder', async () => {
      arrange((rows[1] as (typeof rows)[number]).inputs)
      const noHolder = CreditCardFactory.create('5555444433332222', '22', '01', '123', null)
      const actual = await mapper.create3DFormInitializeRequestData(
        Q,
        order,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        noHolder,
      )
      expect(actual.CardHolderName).toBe('')
    })

    // addition: both return urls and the id/amount are required text
    it.each([['success_url'], ['fail_url'], ['id'], ['amount']] as const)('requires %s', async (key) => {
      const broken: Record<string, unknown> = { ...order }
      delete broken[key]
      await expect(
        mapper.create3DFormData(Q, broken as PosOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'https://x.example'),
      ).rejects.toThrow(PosError)
      await expect(
        mapper.create3DFormInitializeRequestData(Q, broken as PosOrder, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH),
      ).rejects.toThrow(PosError)
      expect(crypt.create3DHash).not.toHaveBeenCalled()
    })

    it('rejects a url that is not text', async () => {
      await expect(
        mapper.create3DFormInitializeRequestData(
          Q,
          { ...order, success_url: { a: 1 } as never },
          MODEL.THREE_D_SECURE,
          TX_TYPE.PAY_AUTH,
        ),
      ).rejects.toThrow(PosError)
    })

    it('rejects a transaction type that is not a payment', async () => {
      await expect(
        mapper.create3DFormInitializeRequestData(Q, order, MODEL.THREE_D_SECURE, TX_TYPE.REFUND),
      ).rejects.toThrow(UnsupportedTransactionTypeError)
    })

    it('does not send an undefined value', async () => {
      arrange((rows[1] as (typeof rows)[number]).inputs)
      expectNoUndefined(
        await mapper.create3DFormInitializeRequestData(Q, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card),
      )
    })
  })

  describe('additions: amounts', () => {
    const base = {
      id: '2020110828BC',
      success_url: 'https://shop.example/ok',
      fail_url: 'https://shop.example/fail',
    }

    const paths: Array<[string, (amount: unknown) => unknown]> = [
      [
        '3D form',
        (amount) =>
          mapper.create3DFormInitializeRequestData(
            Q,
            { ...base, amount } as PosOrder,
            MODEL.THREE_D_SECURE,
            TX_TYPE.PAY_AUTH,
          ),
      ],
      [
        '3D form data',
        (amount) =>
          mapper.create3DFormData(
            Q,
            { ...base, amount } as PosOrder,
            MODEL.THREE_D_SECURE,
            TX_TYPE.PAY_AUTH,
            'https://x.example',
          ),
      ],
      [
        'non-secure',
        (amount) =>
          mapper.createNonSecurePaymentRequestData(Q, { ...base, amount } as PosOrder, TX_TYPE.PAY_AUTH, card),
      ],
      ['post-auth', (amount) => mapper.createNonSecurePostAuthPaymentRequestData(Q, { ...base, amount } as PosOrder)],
      ['refund', (amount) => mapper.createRefundRequestData(Q, { ...base, amount } as PosOrder, TX_TYPE.REFUND)],
    ]
    const amountOf = (data: unknown): unknown => {
      const record = data as Record<string, unknown>
      return (record.inputs as Record<string, unknown> | undefined)?.PurchAmount ?? record.PurchAmount
    }

    beforeEach(() => {
      crypt.create3DHash.mockReturnValue('H')
      crypt.generateRandomString.mockReturnValue('R')
    })

    it.each(paths)('rounds 1.005 to 1.01 in %s', async (_name, call) => {
      expect(amountOf(await call(1.005))).toBe('1.01')
    })

    it.each(paths)('keeps 1.75 as text in %s', async (_name, call) => {
      expect(amountOf(await call('1.75'))).toBe('1.75')
    })

    // carried from the formatter: 0.001 to 0.004 format to '0' and must never be signed or sent
    it.each(paths)('rejects invalid amounts in %s', async (_name, call) => {
      for (const amount of [
        0,
        -1,
        'abc',
        1e13,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        0.001,
        0.004,
        '0.003',
        '',
        '1e2',
        null,
      ]) {
        await expect(
          Promise.resolve().then(() => call(amount)),
          String(amount),
        ).rejects.toThrow(PosError)
      }
      expect(amountOf(await call(0.005))).toBe('0.01')
    })
  })

  describe('additions: installment', () => {
    const order = {
      id: '2020110828BC',
      amount: 10,
      success_url: 'https://s.example/ok',
      fail_url: 'https://s.example/f',
    }

    it.each([
      [2, '2'],
      ['3', '3'],
      [1, '0'],
      [0, '0'],
      [undefined, '0'],
      [99, '99'],
    ])('formats %s', (installment, want) => {
      const data = mapper.createNonSecurePaymentRequestData(
        Q,
        { ...order, installment } as PosOrder,
        TX_TYPE.PAY_AUTH,
        card,
      )
      expect(data.InstallmentCount).toBe(want)
    })

    it.each([[1.5], [-1], ['x'], [100], ['1e1'], [''], [' 2']])('rejects %s', async (installment) => {
      const bad = { ...order, installment } as never
      expect(() => mapper.createNonSecurePaymentRequestData(Q, bad, TX_TYPE.PAY_AUTH, card)).toThrow(PosError)
      await expect(
        mapper.create3DFormInitializeRequestData(Q, bad, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH),
      ).rejects.toThrow(PosError)
    })
  })

  describe('additions: order ids and required fields', () => {
    const full = {
      id: '2020110828BC',
      amount: 10,
      success_url: 'https://s.example/ok',
      fail_url: 'https://s.example/f',
    }
    const calls: Array<[string, (order: PosOrder) => unknown]> = [
      ['3D provision', (o) => mapper.create3DPaymentRequestData(Q, o, TX_TYPE.PAY_AUTH, { RequestGuid: '1' })],
      ['3D form', (o) => mapper.create3DFormInitializeRequestData(Q, o, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH)],
      [
        '3D form data',
        (o) => mapper.create3DFormData(Q, o, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'https://x.example'),
      ],
      ['non-secure', (o) => mapper.createNonSecurePaymentRequestData(Q, o, TX_TYPE.PAY_AUTH, card)],
      ['post-auth', (o) => mapper.createNonSecurePostAuthPaymentRequestData(Q, o)],
      ['status', (o) => mapper.createStatusRequestData(Q, o)],
      ['cancel', (o) => mapper.createCancelRequestData(Q, o)],
      ['refund', (o) => mapper.createRefundRequestData(Q, o, TX_TYPE.REFUND)],
      ['order history', (o) => mapper.createOrderHistoryRequestData(Q, o)],
    ]

    beforeEach(() => {
      crypt.create3DHash.mockReturnValue('H')
      crypt.generateRandomString.mockReturnValue('R')
    })

    it.each(calls)('rejects a bad order id in %s', async (_name, call) => {
      for (const id of ['sipariş1', 'a&b', 'a b', '', 'x'.repeat(65), '<a>', 'a\n', { a: 1 }]) {
        await expect(
          Promise.resolve().then(() => call({ ...full, id } as never)),
          String(id),
        ).rejects.toThrow(PosError)
      }
      await expect(Promise.resolve().then(() => call({ ...full, id: 'x'.repeat(64) }))).resolves.toBeDefined()
    })

    it.each(calls)('requires the order id in %s', async (_name, call) => {
      const { id: _id, ...noId } = full
      await expect(Promise.resolve().then(() => call(noId as PosOrder))).rejects.toThrow(PosError)
    })

    it.each([
      ['non-secure', (o: PosOrder) => mapper.createNonSecurePaymentRequestData(Q, o, TX_TYPE.PAY_AUTH, card)],
      ['post-auth', (o: PosOrder) => mapper.createNonSecurePostAuthPaymentRequestData(Q, o)],
      ['refund', (o: PosOrder) => mapper.createRefundRequestData(Q, o, TX_TYPE.REFUND)],
    ])('requires the amount in %s', (_name, call) => {
      const { amount: _amount, ...noAmount } = full
      expect(() => call(noAmount as PosOrder)).toThrow(PosError)
    })

    it('rejects a transaction type that is not a payment', () => {
      expect(() => mapper.createNonSecurePaymentRequestData(Q, full, TX_TYPE.REFUND, card)).toThrow(
        UnsupportedTransactionTypeError,
      )
    })

    it('never produces an undefined value', async () => {
      for (const [, call] of calls) {
        expectNoUndefined(await call(full))
      }
    })

    it('does not change the order it was given', async () => {
      const order: PosOrder = { ...full, installment: 2 }
      const snapshot = structuredClone(order)
      for (const [, call] of calls) {
        await call(order)
      }
      expect(order).toStrictEqual(snapshot)
    })
  })
})
