import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AkbankPosCrypt } from '../../../../../src/crypt/AkbankPosCrypt.js'
import type { CryptInterface } from '../../../../../src/crypt/CryptInterface.js'
import { AkbankPosRequestDataMapper } from '../../../../../src/data-mapper/request/mapper/AkbankPosRequestDataMapper.js'
import { AkbankPosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/AkbankPosRequestValueFormatter.js'
import { AkbankPosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/AkbankPosRequestValueMapper.js'
import { NotImplementedError, PosError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import { CURRENCY, LANG, MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'
import type { Before3DFormHashCalculatedEvent, PosHooks, PosOrder } from '../../../../../src/types.js'

const SECRET =
  '3230323330393034313735303032363031353172675f357637355f3273387373745f7233725f73323333383737335f323272383774767276327672323531355f'
const MERCHANT = '2023090417500272654BD9A49CF07574'
const TERMINAL = '2023090417500284633D137A249DBBEB'

const account = AccountFactory.createAkbankPosAccount('akbank-pos', MERCHANT, TERMINAL, SECRET)
const subMerchantAccount = AccountFactory.createAkbankPosAccount(
  'akbank-pos',
  MERCHANT,
  TERMINAL,
  SECRET,
  'sub-merchant-id',
)
const card = CreditCardFactory.create('5555444433332222', '22', '01', '123', 'ahmet')

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000$/
const RANDOM = '128-character-random-string'

const terminal = { merchantSafeId: MERCHANT, terminalSafeId: TERMINAL }

/** PHP assertSame on arrays also compares key order: compare the serialised form as well. */
function expectSame(actual: unknown, expected: unknown): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
  expect(actual).toStrictEqual(expected)
}

/** PHP ksort on the top level only; nested key order still counts. */
function ksort(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** Checks the date time (reference asserts length 23), removes it and compares the rest with ksort. */
function expectSortedWithoutDateTime(actual: Record<string, unknown>, expected: Record<string, unknown>): void {
  expect(actual.requestDateTime).toMatch(DATE_TIME)
  const { requestDateTime: _removed, ...rest } = actual
  expectSame(ksort(rest), ksort(expected))
}

type Stub = { [K in keyof CryptInterface]: ReturnType<typeof vi.fn> }

describe('AkbankPosRequestDataMapper', () => {
  let crypt: Stub
  let hook: ReturnType<typeof vi.fn<(e: Before3DFormHashCalculatedEvent) => void>>
  let mapper: AkbankPosRequestDataMapper

  function build(
    cryptImpl: unknown,
    hooks: PosHooks = { onBefore3DFormHashCalculated: [hook] },
  ): AkbankPosRequestDataMapper {
    return new AkbankPosRequestDataMapper(
      new AkbankPosRequestValueMapper(),
      new AkbankPosRequestValueFormatter(),
      hooks,
      cryptImpl as CryptInterface<never>,
      LANG.EN,
    )
  }

  beforeEach(() => {
    crypt = {
      hashString: vi.fn(),
      check3DHash: vi.fn(),
      create3DHash: vi.fn(),
      createHash: vi.fn(),
      hashFromParams: vi.fn(),
      generateRandomString: vi.fn().mockReturnValue(RANDOM),
    }
    hook = vi.fn()
    mapper = build(crypt)
  })

  it('supports only AkbankPos', () => {
    expect(AkbankPosRequestDataMapper.supports('AkbankPos')).toBe(true)
    expect(AkbankPosRequestDataMapper.supports('AssecoPos')).toBe(false)
  })

  describe('create3DFormData', () => {
    const baseOrder: PosOrder = {
      id: '2020110828BC',
      amount: 1.1,
      ip: '127.0.0.1',
      installment: 0,
      currency: CURRENCY.TRY,
      success_url: 'http:://localhost/success',
      fail_url: 'http:://localhost/fail',
    }
    const rows: Array<{
      name: string
      order: PosOrder
      txType: TxType
      model: PaymentModel
      withCard: boolean
      gateway: string
      expected: Record<string, string>
    }> = [
      {
        name: '3d_host_form_data',
        order: { ...baseOrder, amount: 10 },
        txType: TX_TYPE.PAY_AUTH,
        model: MODEL.THREE_D_HOST,
        withCard: false,
        gateway: 'https://virtualpospaymentgatewaypre.akbank.com/payhosting',
        expected: {
          paymentModel: '3D_PAY_HOSTING',
          txnCode: '3000',
          merchantSafeId: MERCHANT,
          terminalSafeId: TERMINAL,
          orderId: '2020110828BC',
          lang: 'EN',
          amount: '10.00',
          currencyCode: '949',
          installCount: '1',
          okUrl: 'http:://localhost/success',
          failUrl: 'http:://localhost/fail',
          randomNumber: RANDOM,
          hash: 'hash-123',
        },
      },
      {
        name: '3d_pay_form_data',
        order: baseOrder,
        txType: TX_TYPE.PAY_AUTH,
        model: MODEL.THREE_D_PAY,
        withCard: true,
        gateway: 'https://virtualpospaymentgatewaypre.akbank.com/securepay',
        expected: {
          paymentModel: '3D_PAY',
          txnCode: '3000',
          merchantSafeId: MERCHANT,
          terminalSafeId: TERMINAL,
          orderId: '2020110828BC',
          lang: 'EN',
          amount: '1.10',
          currencyCode: '949',
          installCount: '1',
          okUrl: 'http:://localhost/success',
          failUrl: 'http:://localhost/fail',
          randomNumber: RANDOM,
          creditCard: '5555444433332222',
          expiredDate: '0122',
          cvv: '123',
          hash: 'hash-123',
        },
      },
      {
        name: '3d_form_data',
        order: baseOrder,
        txType: TX_TYPE.PAY_AUTH,
        model: MODEL.THREE_D_SECURE,
        withCard: true,
        gateway: 'https://virtualpospaymentgatewaypre.akbank.com/securepay',
        expected: {
          paymentModel: '3D',
          txnCode: '3000',
          merchantSafeId: MERCHANT,
          terminalSafeId: TERMINAL,
          orderId: '2020110828BC',
          lang: 'EN',
          amount: '1.10',
          currencyCode: '949',
          installCount: '1',
          okUrl: 'http:://localhost/success',
          failUrl: 'http:://localhost/fail',
          randomNumber: RANDOM,
          creditCard: '5555444433332222',
          expiredDate: '0122',
          cvv: '123',
          hash: 'hash-123',
        },
      },
      {
        name: '3d_pre_pay_form_data',
        order: { ...baseOrder, amount: 1000 },
        txType: TX_TYPE.PAY_PRE_AUTH,
        model: MODEL.THREE_D_SECURE,
        withCard: true,
        gateway: 'https://virtualpospaymentgatewaypre.akbank.com/securepay',
        expected: {
          paymentModel: '3D',
          txnCode: '3004',
          merchantSafeId: MERCHANT,
          terminalSafeId: TERMINAL,
          orderId: '2020110828BC',
          lang: 'EN',
          amount: '1000.00',
          currencyCode: '949',
          installCount: '1',
          okUrl: 'http:://localhost/success',
          failUrl: 'http:://localhost/fail',
          randomNumber: RANDOM,
          creditCard: '5555444433332222',
          expiredDate: '0122',
          cvv: '123',
          hash: 'hash-123',
        },
      },
    ]

    it.each(rows)('builds the form for $name', async ({ order, txType, model, withCard, gateway, expected }) => {
      crypt.create3DHash.mockReturnValue('hash-123')

      const actual = await mapper.create3DFormData(account, order, model, txType, gateway, withCard ? card : null)

      expect(actual.inputs.requestDateTime).toMatch(DATE_TIME)
      const { requestDateTime: _removed, ...inputs } = actual.inputs
      expectSame({ ...actual, inputs }, { gateway, method: 'POST', inputs: expected })

      expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
      expect(crypt.create3DHash).toHaveBeenCalledTimes(1)
      expect(hook).toHaveBeenCalledTimes(1)
      const event = hook.mock.calls[0]?.[0] as Before3DFormHashCalculatedEvent
      expect(event.gatewayClass).toBe('AkbankPos')
      expect(event.txType).toBe(txType)
      expect(event.paymentModel).toBe(model)
      expect(Object.keys(event.formInputs).length).toBeGreaterThan(3)
    })

    it('builds the form for a sub merchant account', async () => {
      crypt.create3DHash.mockReturnValue('hash-abc')
      crypt.generateRandomString.mockReturnValue('random-123')

      const actual = await mapper.create3DFormData(
        subMerchantAccount,
        baseOrder,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        'https://bank.com/pay',
        card,
      )

      const { requestDateTime: _removed, ...inputs } = actual.inputs
      expectSame(
        { ...actual, inputs },
        {
          gateway: 'https://bank.com/pay',
          method: 'POST',
          inputs: {
            paymentModel: '3D',
            txnCode: '3000',
            merchantSafeId: MERCHANT,
            terminalSafeId: TERMINAL,
            orderId: '2020110828BC',
            lang: 'EN',
            amount: '1.10',
            currencyCode: '949',
            installCount: '1',
            okUrl: 'http:://localhost/success',
            failUrl: 'http:://localhost/fail',
            randomNumber: 'random-123',
            subMerchantId: 'sub-merchant-id',
            creditCard: '5555444433332222',
            expiredDate: '0122',
            cvv: '123',
            hash: 'hash-abc',
          },
        },
      )
      const event = hook.mock.calls[0]?.[0] as Before3DFormHashCalculatedEvent
      expect(event.gatewayClass).toBe('AkbankPos')
      expect(Object.keys(event.formInputs).length).toBeGreaterThan(3)
    })
  })

  describe('create3DPaymentRequestData', () => {
    const secureData = {
      secureEcomInd: '02',
      secureId: 'VG8yV2tCRHpTSlpNN2VqcDJRS1k=',
      secureData: 'kBM8+wZGAAAAAAAAAAAAAAAAAAAA',
      secureMd: '08A86B192287C69B2C443E7A42B29B5F46436C41DF8E159B4A232BB3D961940F',
    }

    const secureExpected = {
      secureId: secureData.secureId,
      secureEcomInd: secureData.secureEcomInd,
      secureData: secureData.secureData,
      secureMd: secureData.secureMd,
    }

    it('builds the provision request', () => {
      crypt.generateRandomString.mockReturnValue('generated-random-string')
      const actual = mapper.create3DPaymentRequestData(
        account,
        { id: '2020110828BC', amount: 100.25, currency: CURRENCY.TRY, ip: '156.155.154.153' },
        TX_TYPE.PAY_AUTH,
        secureData,
      )

      expect(actual.requestDateTime).toMatch(DATE_TIME)
      const { requestDateTime: _removed, ...rest } = actual
      expectSame(rest, {
        terminal,
        version: '1.00',
        txnCode: '1000',
        randomNumber: 'generated-random-string',
        order: { orderId: '2020110828BC' },
        transaction: { amount: '100.25', currencyCode: 949, motoInd: 0, installCount: 1 },
        secureTransaction: secureExpected,
        customer: { ipAddress: '156.155.154.153' },
      })
      expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
    })

    it('builds the provision request for a sub merchant account', () => {
      crypt.generateRandomString.mockReturnValue('generated-random-string')
      const actual = mapper.create3DPaymentRequestData(
        subMerchantAccount,
        { id: '2020110828BC', amount: 1.1, ip: '127.0.0.1', currency: CURRENCY.TRY, installment: 0 },
        TX_TYPE.PAY_AUTH,
        {
          txnCode: '3001',
          responseCode: 'VPS-0000',
          responseMessage: 'BAŞARILI',
          txnDateTime: '2024-04-18T20:15:35.000',
          merchantSafeId: MERCHANT,
          terminalSafeId: TERMINAL,
          orderId: '20240418BA6C',
          ...secureData,
          hashParams:
            'txnCode+responseCode+responseMessage+txnDateTime+merchantSafeId+terminalSafeId+orderId+secureId+secureEcomInd+secureData+secureMd',
          hash: 'bFYReNscRIyo3EQQm18qB9iZEW5eqtx1UBAjwRAoVJuigugPKr4Rjcf4PgBHtrjg1IYFYAz8k3TCFcKWS0b4Xg==',
        },
      )

      const { requestDateTime: _removed, ...rest } = actual
      expectSame(rest, {
        terminal,
        subMerchant: { subMerchantId: 'sub-merchant-id' },
        version: '1.00',
        txnCode: '1000',
        randomNumber: 'generated-random-string',
        order: { orderId: '2020110828BC' },
        transaction: { amount: '1.10', currencyCode: 949, motoInd: 0, installCount: 1 },
        secureTransaction: secureExpected,
        customer: { ipAddress: '127.0.0.1' },
      })
    })
  })

  describe('createNonSecurePaymentRequestData', () => {
    const cardData = { cardNumber: '5555444433332222', cvv2: '123', expireDate: '0122' }
    const base = { id: '2020110828BC', amount: 1.1, ip: '127.0.0.1', currency: CURRENCY.TRY }
    const expectedBase = (over: Record<string, unknown>) => ({
      randomNumber: RANDOM,
      terminal,
      version: '1.00',
      txnCode: '1000',
      card: cardData,
      order: { orderId: '2020110828BC' },
      transaction: { amount: '1.10', currencyCode: 949, motoInd: 0, installCount: 1 },
      customer: { ipAddress: '127.0.0.1' },
      ...over,
    })

    it.each([
      {
        name: 'pay_no_installment',
        order: { ...base, installment: 0 } as PosOrder,
        txType: TX_TYPE.PAY_AUTH,
        expected: expectedBase({}),
      },
      {
        name: 'pay_with_installment',
        order: { ...base, installment: 2 } as PosOrder,
        txType: TX_TYPE.PAY_AUTH,
        expected: expectedBase({ transaction: { amount: '1.10', currencyCode: 949, motoInd: 0, installCount: 2 } }),
      },
      {
        name: 'pre_pay',
        order: { ...base, installment: 0 } as PosOrder,
        txType: TX_TYPE.PAY_PRE_AUTH,
        expected: expectedBase({ txnCode: '1004' }),
      },
      {
        name: 'pay_recurring',
        order: { ...base, recurring: { frequency: 1, frequencyType: 'MONTH', installment: 4 } } as PosOrder,
        txType: TX_TYPE.PAY_AUTH,
        expected: expectedBase({
          order: { orderTrackId: '2020110828BC' },
          transaction: { amount: '1.10', currencyCode: 949, motoInd: 1, installCount: 1 },
          recurring: { frequencyInterval: 1, frequencyCycle: 'M', numberOfPayments: 4 },
        }),
      },
    ])('builds $name', ({ order, txType, expected }) => {
      const actual = mapper.createNonSecurePaymentRequestData(account, order, txType, card)

      expectSortedWithoutDateTime(actual, expected)
      expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
    })
  })

  describe('createNonSecurePostAuthPaymentRequestData', () => {
    it('builds the post auth request', () => {
      const actual = mapper.createNonSecurePostAuthPaymentRequestData(account, {
        id: '2020110828BC',
        amount: 1.1,
        ip: '127.0.0.1',
        currency: CURRENCY.TRY,
      })

      expectSortedWithoutDateTime(actual, {
        randomNumber: RANDOM,
        terminal,
        version: '1.00',
        txnCode: '1005',
        order: { orderId: '2020110828BC' },
        transaction: { amount: '1.10', currencyCode: 949 },
        customer: { ipAddress: '127.0.0.1' },
      })
      expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
    })
  })

  describe('createCancelRequestData', () => {
    const recurringExpected = (txnCode: string, withRecurring: boolean) => ({
      randomNumber: RANDOM,
      terminal,
      version: '1.00',
      txnCode,
      order: { orderTrackId: '2020110828BC' },
      ...(withRecurring ? { recurring: { recurringOrder: 2 } } : {}),
    })

    it.each([
      {
        name: 'plain',
        order: { id: '2020110828BC' } as PosOrder,
        expected: {
          randomNumber: RANDOM,
          terminal,
          version: '1.00',
          txnCode: '1003',
          order: { orderId: '2020110828BC' },
        },
      },
      {
        name: 'recurring_single_fulfilled_tx',
        order: { recurring_id: '2020110828BC', recurringOrderInstallmentNumber: 2 } as PosOrder,
        expected: recurringExpected('1003', true),
      },
      {
        name: 'recurring_single_unfulfilled_tx',
        order: {
          recurring_id: '2020110828BC',
          recurringOrderInstallmentNumber: 2,
          recurring_payment_is_pending: true,
        } as PosOrder,
        expected: recurringExpected('1013', true),
      },
      {
        name: 'recurring_all_txs',
        order: { recurring_id: '2020110828BC', recurringOrderInstallmentNumber: null } as PosOrder,
        expected: recurringExpected('1013', false),
      },
    ])('builds $name', ({ order, expected }) => {
      const actual = mapper.createCancelRequestData(account, order)

      expectSortedWithoutDateTime(actual, expected)
      expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
    })
  })

  describe('createRefundRequestData', () => {
    it.each([
      {
        name: 'plain',
        order: { id: '2020110828BC', amount: 1.02, currency: CURRENCY.TRY } as PosOrder,
        expected: {
          terminal,
          version: '1.00',
          txnCode: '1002',
          randomNumber: RANDOM,
          order: { orderId: '2020110828BC' },
          transaction: { amount: '1.02', currencyCode: 949 },
        },
      },
      {
        name: 'recurring',
        order: {
          recurring_id: '2020110828BC',
          amount: 1.02,
          currency: CURRENCY.TRY,
          recurringOrderInstallmentNumber: 2,
        } as PosOrder,
        expected: {
          terminal,
          randomNumber: RANDOM,
          order: { orderTrackId: '2020110828BC' },
          transaction: { amount: '1.02', currencyCode: 949 },
          version: '1.00',
          txnCode: '1002',
          recurring: { recurringOrder: 2 },
        },
      },
    ])('builds $name', ({ order, expected }) => {
      const actual = mapper.createRefundRequestData(account, order, TX_TYPE.REFUND)

      expectSortedWithoutDateTime(actual, expected)
      expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
    })
  })

  describe('createOrderHistoryRequestData', () => {
    it.each([
      { name: 'plain', order: { id: '2020110828BC' } as PosOrder, orderPart: { orderId: '2020110828BC' } },
      {
        name: 'recurring_order',
        order: { recurring_id: '2020110828BC' } as PosOrder,
        orderPart: { orderTrackId: '2020110828BC' },
      },
    ])('builds $name', ({ order, orderPart }) => {
      const actual = mapper.createOrderHistoryRequestData(account, order)

      expect(actual.requestDateTime).toMatch(DATE_TIME)
      const { requestDateTime: _removed, ...rest } = actual
      expectSame(rest, {
        terminal,
        version: '1.00',
        txnCode: '1010',
        randomNumber: RANDOM,
        order: orderPart,
      })
      expect(crypt.generateRandomString).toHaveBeenCalledTimes(1)
    })
  })

  // addition: the recurring track id follows the library-wide order id rule
  describe('recurring_id', () => {
    const requests: Array<[string, (recurringId: unknown) => Record<string, unknown>]> = [
      [
        'cancel',
        (recurringId) =>
          mapper.createCancelRequestData(account, {
            recurring_id: recurringId,
            recurringOrderInstallmentNumber: 2,
          } as PosOrder),
      ],
      [
        'refund',
        (recurringId) =>
          mapper.createRefundRequestData(
            account,
            { recurring_id: recurringId, amount: 1.02, recurringOrderInstallmentNumber: 2 } as PosOrder,
            TX_TYPE.REFUND,
          ),
      ],
      [
        'order history',
        (recurringId) => mapper.createOrderHistoryRequestData(account, { recurring_id: recurringId } as PosOrder),
      ],
    ]

    it.each(requests)('%s sends a number as its decimal text', (_name, build) => {
      expect((build(7).order as Record<string, unknown>).orderTrackId).toBe('7')
    })

    it.each(
      requests.flatMap(([name]) =>
        [
          ['a line feed', 'a\nb'],
          ['a C1 control', 'a\u0085'],
          ['a lone surrogate', 'a\ud800'],
          ['65 characters', 'a'.repeat(65)],
          ['an array', ['a']],
          ['a boolean', true],
          ['an object', {}],
          ['a fraction', 1.5],
          ['a negative number', -1],
          ['an unsafe integer', 2 ** 53],
        ].map(([label, id]) => [name, label, id] as const),
      ),
    )('%s rejects %s', (name, _label, id) => {
      const build = requests.find(([n]) => n === name)?.[1] as (recurringId: unknown) => Record<string, unknown>
      expect(() => build(id)).toThrow(PosError)
    })

    // addition: a bad recurring id is reported under its own field name
    it.each(requests)('%s names the recurring_id field in the error', (_name, build) => {
      expect(() => build('a\nb')).toThrow(/^Order field "recurring_id" must be/)
    })

    // addition: recurring orders created before the shared order-id rule can still be cancelled, refunded and listed
    it.each(requests.flatMap(([name]) => ['_a', 'a b', 'a&b', 'ä1', 'INV.2024.1'].map((id) => [name, id] as const)))(
      '%s accepts the existing recurring id %j',
      (name, id) => {
        const build = requests.find(([n]) => n === name)?.[1] as (recurringId: unknown) => Record<string, unknown>
        expect((build(id).order as Record<string, unknown>).orderTrackId).toBe(id)
      },
    )
  })

  it('has no status request', () => {
    // deviation: A22 (error class: NotImplementedError)
    expect(() => mapper.createStatusRequestData(account, {})).toThrow(NotImplementedError)
  })

  describe('additions', () => {
    // addition: A2/A11 (the real crypt over the reference 3d row, values pinned by a hook)
    it('signs the reference 3d form with the real crypt', async () => {
      const real = build(new AkbankPosCrypt(), {
        onBefore3DFormHashCalculated: [
          (event: Before3DFormHashCalculatedEvent) => {
            Object.assign(event.formInputs, {
              randomNumber:
                'AEDDD8688E11A3DC588DAB2ED59B2F64D45E798761CEFF17F4DB47581072697890180C4195986250F89C2C67A04A3B96F0AC66AE99B49BB7BEE618FBD621C4CD',
              requestDateTime: '2024-04-04T21:11:41.000',
              ccbRewardAmount: '1.00',
              pcbRewardAmount: '1.00',
              xcbRewardAmount: '1.00',
              emailAddress: 'test@test.com',
            })
          },
        ],
      })
      const referenceCard = CreditCardFactory.create('4355093000315232', '35', '11', '665')

      const form = await real.create3DFormData(
        account,
        {
          id: '20240404A4B0',
          amount: 1.01,
          lang: LANG.TR,
          currency: CURRENCY.TRY,
          installment: 0,
          success_url: 'http://localhost/akbankpos/3d/response.php',
          fail_url: 'http://localhost/akbankpos/3d/response.php',
        },
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        'https://bank.example/securepay',
        referenceCard,
      )

      expect(form.inputs.hash).toBe(
        'ilR2mCExklKEti+2x61A8pcOfzJ5z5M6xMYmmU8ClaKaDuxKooFuH3v7XW/ba25xlTDqGN1H//i0zTiJl5YnfA==',
      )
      expect(Object.keys(form.inputs).at(-1)).toBe('hash')
    })

    // addition: A10 (0.29 stays 0.29 as a string in the form and the JSON body)
    it('formats an amount of 0.29 as the string 0.29', async () => {
      crypt.create3DHash.mockReturnValue('h')
      const order: PosOrder = {
        id: 'A1',
        amount: 0.29,
        ip: '127.0.0.1',
        success_url: 'https://m/ok',
        fail_url: 'https://m/fail',
      }
      const form = await mapper.create3DFormData(account, order, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, 'https://g')
      expect(form.inputs.amount).toBe('0.29')

      const body = mapper.createNonSecurePaymentRequestData(account, order, TX_TYPE.PAY_AUTH, card)
      expect((body.transaction as Record<string, unknown>).amount).toBe('0.29')
    })

    // addition: A24 (a missing value is never sent or signed as "undefined")
    it.each([
      [
        'provision without ip',
        () => mapper.create3DPaymentRequestData(account, { id: 'A', amount: 1 }, TX_TYPE.PAY_AUTH, secureOk()),
      ],
      [
        'non-secure without ip',
        () => mapper.createNonSecurePaymentRequestData(account, { id: 'A', amount: 1 }, TX_TYPE.PAY_AUTH, card),
      ],
      ['post auth without ip', () => mapper.createNonSecurePostAuthPaymentRequestData(account, { id: 'A', amount: 1 })],
      ['refund without amount', () => mapper.createRefundRequestData(account, { id: 'A' }, TX_TYPE.REFUND)],
      ['cancel without id', () => mapper.createCancelRequestData(account, {})],
      ['history without id', () => mapper.createOrderHistoryRequestData(account, {})],
      [
        'recurring without frequencyType',
        () =>
          mapper.createNonSecurePaymentRequestData(
            account,
            { id: 'A', amount: 1, ip: '1.1.1.1', recurring: { frequency: 1, installment: 2 } },
            TX_TYPE.PAY_AUTH,
            card,
          ),
      ],
    ])('rejects %s', (_name, build3) => {
      expect(build3).toThrow(PosError)
    })

    function secureOk(): Record<string, unknown> {
      return { secureId: 'a', secureEcomInd: '02', secureData: 'b', secureMd: 'c' }
    }

    it.each([
      ['success_url', { id: 'A', amount: 1, fail_url: 'https://m/fail' }],
      ['fail_url', { id: 'A', amount: 1, success_url: 'https://m/ok' }],
      ['amount', { id: 'A', success_url: 'https://m/ok', fail_url: 'https://m/fail' }],
    ])('rejects a 3D form without %s', async (_name, order) => {
      await expect(
        mapper.create3DFormData(account, order as PosOrder, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, 'https://g'),
      ).rejects.toThrow(PosError)
    })

    it.each([{ secureId: { a: 1 } }, { secureEcomInd: 2 }, { secureData: undefined }, { secureMd: '' }])(
      'rejects a callback with an invalid secure field %j',
      (override) => {
        const callback = { ...secureOk(), ...override } as never
        expect(() =>
          mapper.create3DPaymentRequestData(account, { id: 'A', amount: 1, ip: '1.1.1.1' }, TX_TYPE.PAY_AUTH, callback),
        ).toThrow(PosError)
      },
    )

    it('never produces the text "undefined"', () => {
      const body = mapper.createNonSecurePaymentRequestData(
        account,
        { id: 'A', amount: 1, ip: '1.1.1.1' },
        TX_TYPE.PAY_AUTH,
        card,
      )
      expect(JSON.stringify(body)).not.toContain('undefined')
    })

    // addition: F7 recurring options are validated and the validated values are sent
    it.each([
      [{ frequency: {}, frequencyType: 'MONTH', installment: 4 }],
      [{ frequency: [1], frequencyType: 'MONTH', installment: 4 }],
      [{ frequency: 1, frequencyType: 'MONTH', installment: { n: 4 } }],
      [{ frequency: 0, frequencyType: 'MONTH', installment: 4 }],
      [{ frequency: 1, frequencyType: 'MONTH', installment: -2 }],
      [{ frequency: 1.5, frequencyType: 'MONTH', installment: 4 }],
      [{ frequency: 'x', frequencyType: 'MONTH', installment: 4 }],
      [{ frequency: 1, frequencyType: 'MONTH', installment: '4 ' }],
    ])('rejects the recurring options %j', (recurring) => {
      expect(() =>
        mapper.createNonSecurePaymentRequestData(
          account,
          { id: 'A', amount: 1, ip: '1.1.1.1', recurring } as unknown as PosOrder,
          TX_TYPE.PAY_AUTH,
          card,
        ),
      ).toThrow(PosError)
    })

    // addition: F7
    it('sends digit strings of the recurring options as numbers', () => {
      const body = mapper.createNonSecurePaymentRequestData(
        account,
        { id: 'A', amount: 1, ip: '1.1.1.1', recurring: { frequency: '2', frequencyType: 'MONTH', installment: '12' } },
        TX_TYPE.PAY_AUTH,
        card,
      )
      expect(body.recurring).toStrictEqual({ frequencyInterval: 2, frequencyCycle: 'M', numberOfPayments: 12 })
    })

    // addition: F7 an empty recurring_id counts as unset
    it('order history by order id when recurring_id is empty', () => {
      const body = mapper.createOrderHistoryRequestData(account, { id: 'A', recurring_id: '' })
      expect(body.order).toStrictEqual({ orderId: 'A' })
    })

    // addition: A12 (the Türkiye wall clock, UTC+03:00)
    it('stamps the request with the +03:00 wall clock', () => {
      const body = mapper.createOrderHistoryRequestData(account, { id: 'A' })
      const stamped = Date.parse(`${body.requestDateTime as string}+03:00`)
      expect(Math.abs(stamped - Date.now())).toBeLessThan(5000)
    })

    it('does not change the order it is given', async () => {
      const order: PosOrder = {
        id: 'A',
        amount: 1.1,
        ip: '1.1.1.1',
        recurring: { frequency: 1, frequencyType: 'MONTH', installment: 4 },
        installment: 3,
        success_url: 'https://m/ok',
        fail_url: 'https://m/fail',
      }
      const copy = structuredClone(order)
      mapper.createNonSecurePaymentRequestData(account, order, TX_TYPE.PAY_AUTH, card)
      mapper.createNonSecurePostAuthPaymentRequestData(account, order)
      mapper.createRefundRequestData(account, order, TX_TYPE.REFUND)
      mapper.createCancelRequestData(account, order)
      crypt.create3DHash.mockReturnValue('h')
      await mapper.create3DFormData(account, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'https://g')
      expect(order).toStrictEqual(copy)
    })

    it('draws a fresh random number for every request with the real crypt', () => {
      const real = build(new AkbankPosCrypt())
      const a = real.createOrderHistoryRequestData(account, { id: 'A' })
      const b = real.createOrderHistoryRequestData(account, { id: 'A' })
      expect(a.randomNumber).toMatch(/^[0-9A-F]{128}$/)
      expect(a.randomNumber).not.toBe(b.randomNumber)
    })

    // addition: carried from the formatter review (a fractional installment is rejected, not rounded)
    it.each([1.5, -1, Number.NaN])('rejects the installment %s', async (installment) => {
      const order: PosOrder = {
        id: 'A',
        amount: 1,
        ip: '1.1.1.1',
        installment,
        success_url: 'https://m/ok',
        fail_url: 'https://m/fail',
      }
      expect(() => mapper.createNonSecurePaymentRequestData(account, order, TX_TYPE.PAY_AUTH, card)).toThrow(PosError)
      expect(() => mapper.create3DPaymentRequestData(account, order, TX_TYPE.PAY_AUTH, secureOk())).toThrow(PosError)
      await expect(
        mapper.create3DFormData(account, order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, 'https://g'),
      ).rejects.toThrow(PosError)
    })
  })
})
