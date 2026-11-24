import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PosNetV1PosCrypt } from '../../../../../src/crypt/PosNetV1PosCrypt.js'
import { PosNetV1PosRequestDataMapper } from '../../../../../src/data-mapper/request/mapper/PosNetV1PosRequestDataMapper.js'
import { PosNetV1PosRequestValueFormatter } from '../../../../../src/data-mapper/request/value-formatter/PosNetV1PosRequestValueFormatter.js'
import { PosNetV1PosRequestValueMapper } from '../../../../../src/data-mapper/request/value-mapper/PosNetV1PosRequestValueMapper.js'
import { NotImplementedError, PosError } from '../../../../../src/errors.js'
import { AccountFactory } from '../../../../../src/factory/AccountFactory.js'
import { CreditCardFactory } from '../../../../../src/factory/CreditCardFactory.js'
import { CURRENCY, LANG, MODEL, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'
import type { Before3DFormHashCalculatedEvent, PosOrder } from '../../../../../src/types.js'

const KEY = '10,10,10,10,10,10,10,10'
const account = AccountFactory.createPosNetPosAccount('albaraka', '6700950031', '67540050', '1010028724242434', KEY)
const card = CreditCardFactory.create('5400619360964581', '20', '01', '056', 'ahmet')

/** PHP assertSame on arrays also compares key order: compare the serialised form as well. */
function expectSame(actual: unknown, expected: unknown): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
  expect(actual).toStrictEqual(expected)
}

/** Key-sorted copy, for the rows the reference compares after ksort. */
function sorted(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

const common = {
  ApiType: 'JSON',
  ApiVersion: 'V100',
  MerchantNo: '6700950031',
  TerminalNo: '67540050',
}

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

function without<T extends Record<string, unknown>>(data: T, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...data }
  delete copy[key]
  return copy
}

describe('PosNetV1PosRequestDataMapper', () => {
  let crypt: CryptStub
  let hook: ReturnType<typeof vi.fn<(e: Before3DFormHashCalculatedEvent) => void>>
  let mapper: PosNetV1PosRequestDataMapper

  beforeEach(() => {
    crypt = makeCryptStub()
    hook = vi.fn()
    mapper = new PosNetV1PosRequestDataMapper(
      new PosNetV1PosRequestValueMapper(),
      new PosNetV1PosRequestValueFormatter(),
      { onBefore3DFormHashCalculated: [hook] },
      crypt as unknown as PosNetV1PosCrypt,
      LANG.EN,
    )
  })

  it('supports only PosNetV1Pos', () => {
    expect(PosNetV1PosRequestDataMapper.supports('PosNetV1Pos')).toBe(true)
    expect(PosNetV1PosRequestDataMapper.supports('AssecoPos')).toBe(false)
    expect(PosNetV1PosRequestDataMapper.supports('PosNetPos')).toBe(false)
    expect(PosNetV1PosRequestDataMapper.API_VERSION).toBe('V100')
  })

  describe('non-secure post-auth', () => {
    const expected = (installments: string, type: string) => ({
      ApiType: 'JSON',
      ApiVersion: 'V100',
      MACParams: 'MerchantNo:TerminalNo',
      MerchantNo: '6700950031',
      TerminalNo: '67540050',
      CipheredData: null,
      DealerData: null,
      IsEncrypted: null,
      PaymentFacilitatorData: null,
      Amount: 1230,
      CurrencyCode: 'TL',
      ReferenceCode: '159044932490000231',
      InstallmentCount: installments,
      InstallmentType: type,
      MAC: 'wgyfAJPbEPtTtce/+HRlXajSRfYA0J6mUcH+16EbB78=',
    })

    it.each([
      ['plain', 0, '0', 'N'],
      ['with_installment', 2, '2', 'Y'],
    ])('%s', (_name, installment, count, type) => {
      const order: PosOrder = {
        id: '123',
        installment,
        amount: 12.3,
        currency: CURRENCY.TRY,
        ref_ret_num: '159044932490000231',
      }
      const want = expected(count, type)
      crypt.hashFromParams.mockReturnValue(want.MAC)
      expectSame(mapper.createNonSecurePostAuthPaymentRequestData(account, order), want)
      expect(crypt.hashFromParams).toHaveBeenCalledOnce()
      expect(crypt.hashFromParams).toHaveBeenCalledWith(account, without(want, 'MAC'), 'MerchantNo:TerminalNo', ':')
    })
  })

  describe('non-secure payment', () => {
    const expected = (count: string, type: string) => ({
      ApiType: 'JSON',
      ApiVersion: 'V100',
      MACParams: 'MerchantNo:TerminalNo:CardNo:Cvc2:ExpireDate:Amount',
      MerchantNo: '6700950031',
      TerminalNo: '67540050',
      CipheredData: null,
      DealerData: null,
      IsEncrypted: null,
      PaymentFacilitatorData: null,
      AdditionalInfoData: null,
      CardInformationData: { CardNo: '5400619360964581', ExpireDate: '2001', Cvc2: '056', CardHolderName: 'ahmet' },
      IsMailOrder: 'N',
      IsRecurring: null,
      IsTDSecureMerchant: null,
      PaymentInstrumentType: 'CARD',
      ThreeDSecureData: null,
      Amount: 1000,
      CurrencyCode: 'TL',
      OrderId: '00000000000000000123',
      InstallmentCount: count,
      InstallmentType: type,
      KOICode: null,
      MerchantMessageData: null,
      PointAmount: null,
      MAC: '/R6nxI0N73nxANbkq4JVI3h94/mE0htExYyszlqTTWM=',
    })

    it.each([
      ['plain', 0, '0', 'N'],
      ['withInstallment', 3, '3', 'Y'],
    ])('%s', (_name, installment, count, type) => {
      const order: PosOrder = { id: '123', amount: 10.0, installment, currency: CURRENCY.TRY }
      const want = expected(count, type)
      crypt.hashFromParams.mockReturnValue(want.MAC)
      expectSame(mapper.createNonSecurePaymentRequestData(account, order, TX_TYPE.PAY_AUTH, card), want)
      expect(crypt.hashFromParams).toHaveBeenCalledOnce()
      expect(crypt.hashFromParams).toHaveBeenCalledWith(
        account,
        without(want, 'MAC'),
        'MerchantNo:TerminalNo:CardNo:Cvc2:ExpireDate:Amount',
        ':',
      )
    })
  })

  describe('3D payment (provision)', () => {
    const callback = {
      SecureTransactionId: '1010028947569644',
      CAVV: 'jKOBaLBL3hQ+CREBPu1HBQQAAAA=',
      ECI: '02',
      MdStatus: '1',
      MD: '9998F61E1D0C0FB6EC5203A748124F30',
    }
    const expected = (count: string, type: string) => ({
      ...common,
      PaymentInstrumentType: 'CARD',
      IsEncrypted: 'N',
      IsTDSecureMerchant: 'Y',
      IsMailOrder: 'N',
      ThreeDSecureData: {
        SecureTransactionId: '1010028947569644',
        CavvData: 'jKOBaLBL3hQ+CREBPu1HBQQAAAA=',
        Eci: '02',
        MdStatus: 1,
        MD: '9998F61E1D0C0FB6EC5203A748124F30',
      },
      MACParams: 'MerchantNo:TerminalNo:SecureTransactionId:CavvData:Eci:MdStatus',
      Amount: 10001,
      CurrencyCode: 'TL',
      PointAmount: 0,
      OrderId: '000000002020110828BC',
      InstallmentCount: count,
      InstallmentType: type,
      MAC: 'kAKxvbwXvmrM6lapGx1UcRTs454tsSuPrBXV7oA7L7w=',
    })

    it.each([
      ['plain', 0, '0', 'N'],
      ['with_installment', 2, '2', 'Y'],
    ])('%s', (_name, installment, count, type) => {
      const order: PosOrder = { id: '2020110828BC', amount: 100.01, installment, currency: CURRENCY.TRY }
      const want = expected(count, type)
      const { ApiType, ApiVersion, MerchantNo, TerminalNo, ...rest } = want
      const ordered = { ApiType, ApiVersion, MerchantNo, TerminalNo, ...rest }
      crypt.createHash.mockReturnValue(want.MAC)
      expectSame(mapper.create3DPaymentRequestData(account, order, TX_TYPE.PAY_AUTH, callback), ordered)
      expect(crypt.createHash).toHaveBeenCalledOnce()
      expect(crypt.createHash).toHaveBeenCalledWith(account, without(want, 'MAC'))
    })
  })

  describe('3D form data', () => {
    const order: PosOrder = {
      id: '620093100_024',
      amount: 1.75,
      installment: 0,
      currency: CURRENCY.TRY,
      success_url: 'https://domain.com/success',
      lang: LANG.TR,
    }
    const gatewayUrl = 'https://epostest.albarakaturk.com.tr/ALBSecurePaymentUI/SecureProcess/SecureVerification.aspx'
    const head = {
      MerchantNo: '6700950031',
      TerminalNo: '67540050',
      PosnetID: '1010028724242434',
      TransactionType: 'Sale',
      OrderId: '0000000620093100_024',
      Amount: '175',
      CurrencyCode: 'TL',
      MerchantReturnURL: 'https://domain.com/success',
      InstallmentCount: '0',
      Language: 'tr',
      TxnState: 'INITIAL',
      OpenNewWindow: '0',
    }

    it.each([
      [
        'card',
        card,
        {
          ...head,
          CardNo: '5400619360964581',
          ExpiredDate: '2001',
          Cvv: '056',
          CardHolderName: 'ahmet',
          MacParams: 'MerchantNo:TerminalNo:CardNo:Cvc2:ExpireDate:Amount',
          UseOOS: '0',
          Mac: 'xuhPbpcPJ6kVs7JeIXS8f06Cv0mb9cNPMfjp1HiB7Ew=',
        },
      ],
      [
        '3d_host_order',
        null,
        {
          ...head,
          UseOOS: '1',
          MacParams: 'MerchantNo:TerminalNo:Amount',
          Mac: 'UBdwWJh9rBCM0YWkBti7vHZm2G+nag16hAguohNrq1Y=',
        },
      ],
    ])('%s', async (_name, cardArg, inputs) => {
      crypt.create3DHash.mockReturnValue(inputs.Mac)
      const actual = await mapper.create3DFormData(
        account,
        order,
        MODEL.THREE_D_SECURE,
        TX_TYPE.PAY_AUTH,
        gatewayUrl,
        cardArg,
      )
      expectSame(actual, { gateway: gatewayUrl, method: 'POST', inputs })

      expect(hook).toHaveBeenCalledOnce()
      const event = hook.mock.calls[0]?.[0] as Before3DFormHashCalculatedEvent
      expect(event.gatewayClass).toBe('PosNetV1Pos')
      expect(event.txType).toBe(TX_TYPE.PAY_AUTH)
      expect(event.paymentModel).toBe(MODEL.THREE_D_SECURE)
      expect(Object.keys(event.formInputs).length).toBeGreaterThan(3)
      expect(crypt.create3DHash).toHaveBeenCalledOnce()
      expect(crypt.create3DHash).toHaveBeenCalledWith(account, without(inputs, 'Mac'))
    })
  })

  describe('status', () => {
    it('maps the lookup of a 3D order', () => {
      const want = {
        ...common,
        MACParams: 'MerchantNo:TerminalNo',
        CipheredData: null,
        DealerData: null,
        IsEncrypted: 'N',
        PaymentFacilitatorData: null,
        OrderId: 'TDS_000000002020110828BC',
        MAC: 'wgyfAJPbEPtTtce/+HRlXajSRfYA0J6mUcH+16EbB78=',
      }
      crypt.hashFromParams.mockReturnValue(want.MAC)
      expectSame(
        mapper.createStatusRequestData(account, { id: '000000002020110828BC', payment_model: MODEL.THREE_D_SECURE }),
        want,
      )
      expect(crypt.hashFromParams).toHaveBeenCalledWith(account, without(want, 'MAC'), 'MerchantNo:TerminalNo', ':')
    })
  })

  describe('refund', () => {
    const base = {
      ...common,
      MACParams: 'MerchantNo:TerminalNo:ReferenceCode:OrderId',
      CipheredData: null,
      DealerData: null,
      IsEncrypted: null,
      PaymentFacilitatorData: null,
    }
    const ref = 'Rp/jX8D1FM+DF/Bq49MgQDYuBdzTExy+8qN7jwO9ZYI='

    it.each<[string, PosOrder, TxType, Record<string, unknown>]>([
      [
        'withOrderIdAndReferenceCode',
        {
          id: '000000002020110828BC',
          ref_ret_num: '159044932490000231',
          amount: 112,
          payment_model: MODEL.THREE_D_SECURE,
          transaction_type: TX_TYPE.PAY_AUTH,
        },
        TX_TYPE.REFUND,
        { ...base, MAC: ref, ReferenceCode: '159044932490000231', OrderId: null, TransactionType: 'Sale' },
      ],
      [
        'refund_non_secure_order',
        {
          id: '000000002020110828BC',
          amount: 112,
          payment_model: MODEL.NON_SECURE,
          transaction_type: TX_TYPE.PAY_AUTH,
        },
        TX_TYPE.REFUND,
        {
          ...base,
          MAC: '9Ffy2cgMphKFSg2nyXr38gKXJhC8HL+L6X3KEkpt0AQ=',
          ReferenceCode: null,
          OrderId: '0000000000002020110828BC',
          TransactionType: 'Sale',
          Amount: 11200,
          CurrencyCode: 'TL',
        },
      ],
      [
        'withOrderId',
        {
          id: '000000002020110828BC',
          amount: 112,
          payment_model: MODEL.THREE_D_SECURE,
          transaction_type: TX_TYPE.PAY_AUTH,
        },
        TX_TYPE.REFUND,
        {
          ...base,
          MAC: '/RdhuykGKN/DPHXTg0Cwn6aHnAwqmH8OUAwuISKg4bc=',
          ReferenceCode: null,
          OrderId: 'TDS_000000002020110828BC',
          TransactionType: 'Sale',
        },
      ],
      [
        'withReferenceCode',
        {
          ref_ret_num: '159044932490000231',
          amount: 112,
          payment_model: MODEL.THREE_D_SECURE,
          transaction_type: TX_TYPE.PAY_AUTH,
        },
        TX_TYPE.REFUND,
        { ...base, MAC: ref, ReferenceCode: '159044932490000231', OrderId: null, TransactionType: 'Sale' },
      ],
      [
        'cancelPrePay',
        {
          ref_ret_num: '159044932490000231',
          payment_model: MODEL.THREE_D_SECURE,
          amount: 112,
          transaction_type: TX_TYPE.PAY_PRE_AUTH,
        },
        TX_TYPE.REFUND,
        { ...base, MAC: ref, ReferenceCode: '159044932490000231', OrderId: null, TransactionType: 'Auth' },
      ],
    ])('%s', (_name, order, txType, want) => {
      crypt.hashFromParams.mockReturnValue(want.MAC)
      const actual = mapper.createRefundRequestData(account, order, txType)
      expect(sorted(actual)).toStrictEqual(sorted(want))
      expect(crypt.hashFromParams).toHaveBeenCalledOnce()
      expect(crypt.hashFromParams).toHaveBeenCalledWith(
        account,
        sorted(without(want, 'MAC')),
        'MerchantNo:TerminalNo:ReferenceCode:OrderId',
        ':',
      )
    })
  })

  describe('cancel', () => {
    const base = {
      ...common,
      MACParams: 'MerchantNo:TerminalNo:ReferenceCode:OrderId',
      CipheredData: null,
      DealerData: null,
      IsEncrypted: null,
      PaymentFacilitatorData: null,
    }
    const ref = 'Rp/jX8D1FM+DF/Bq49MgQDYuBdzTExy+8qN7jwO9ZYI='

    it.each<[string, PosOrder, Record<string, unknown>]>([
      [
        'withOrderIdAndReferenceCode',
        { id: '000000002020110828BC', ref_ret_num: '159044932490000231', transaction_type: TX_TYPE.PAY_AUTH },
        { ...base, MAC: ref, ReferenceCode: '159044932490000231', OrderId: null, TransactionType: 'Sale' },
      ],
      [
        'withOrderId',
        { id: '000000002020110828BC', payment_model: MODEL.THREE_D_SECURE, transaction_type: TX_TYPE.PAY_AUTH },
        {
          ...base,
          MAC: '/RdhuykGKN/DPHXTg0Cwn6aHnAwqmH8OUAwuISKg4bc=',
          ReferenceCode: null,
          OrderId: 'TDS_000000002020110828BC',
          TransactionType: 'Sale',
        },
      ],
      [
        'withReferenceCode',
        { ref_ret_num: '159044932490000231', transaction_type: TX_TYPE.PAY_AUTH },
        { ...base, MAC: ref, ReferenceCode: '159044932490000231', OrderId: null, TransactionType: 'Sale' },
      ],
      [
        'cancelPrePay',
        { ref_ret_num: '159044932490000231', transaction_type: TX_TYPE.PAY_PRE_AUTH },
        { ...base, MAC: ref, ReferenceCode: '159044932490000231', OrderId: null, TransactionType: 'Auth' },
      ],
    ])('%s', (_name, order, want) => {
      crypt.hashFromParams.mockReturnValue(want.MAC)
      const actual = mapper.createCancelRequestData(account, order)
      expect(sorted(actual)).toStrictEqual(sorted(want))
      expect(crypt.hashFromParams).toHaveBeenCalledOnce()
      expect(crypt.hashFromParams).toHaveBeenCalledWith(
        account,
        sorted(without(want, 'MAC')),
        'MerchantNo:TerminalNo:ReferenceCode:OrderId',
        ':',
      )
    })
  })

  it('has no order history request', () => {
    expect(() => mapper.createOrderHistoryRequestData(account, { id: '1' })).toThrow(NotImplementedError)
  })
})

// addition: the mapper with the real crypt, strict inputs and no "undefined" on the wire
describe('PosNetV1PosRequestDataMapper with the real crypt', () => {
  let mapper: PosNetV1PosRequestDataMapper
  let hooks: ((e: Before3DFormHashCalculatedEvent) => void)[]

  beforeEach(() => {
    hooks = []
    mapper = new PosNetV1PosRequestDataMapper(
      new PosNetV1PosRequestValueMapper(),
      new PosNetV1PosRequestValueFormatter(),
      { onBefore3DFormHashCalculated: hooks },
      new PosNetV1PosCrypt(),
      LANG.EN,
    )
  })

  const formOrder = (): PosOrder => ({
    id: '620093100_024',
    amount: 1.75,
    currency: CURRENCY.TRY,
    success_url: 'https://domain.com/success',
    lang: LANG.TR,
  })
  const url = 'https://epostest.albarakaturk.com.tr/ALBSecurePaymentUI/SecureProcess/SecureVerification.aspx'

  it('reproduces the MACs of the 3D forms', async () => {
    const withCard = await mapper.create3DFormData(
      account,
      formOrder(),
      MODEL.THREE_D_SECURE,
      TX_TYPE.PAY_AUTH,
      url,
      card,
    )
    expect(withCard.inputs.Mac).toBe('xuhPbpcPJ6kVs7JeIXS8f06Cv0mb9cNPMfjp1HiB7Ew=')
    const host = await mapper.create3DFormData(account, formOrder(), MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, url, null)
    expect(host.inputs.Mac).toBe('UBdwWJh9rBCM0YWkBti7vHZm2G+nag16hAguohNrq1Y=')
    expect(Object.keys(host.inputs).at(-1)).toBe('Mac')
  })

  it('maps 0.29 to 29 kuruş in the host form', async () => {
    const form = await mapper.create3DFormData(
      account,
      { ...formOrder(), amount: 0.29 },
      MODEL.THREE_D_SECURE,
      TX_TYPE.PAY_AUTH,
      url,
      null,
    )
    expect(form.inputs.Amount).toBe('29')
    expect(form.inputs.Mac).toBe('myI7crNpAToKnoldyv0Z9x89MhFu0Ix9EwOTpgxPqf0=')
  })

  it('signs after the hook has changed the form', async () => {
    hooks.push((e) => {
      e.formInputs.Amount = '30'
    })
    const form = await mapper.create3DFormData(
      account,
      { ...formOrder(), amount: 0.29 },
      MODEL.THREE_D_SECURE,
      TX_TYPE.PAY_AUTH,
      url,
      null,
    )
    expect(form.inputs.Amount).toBe('30')
    expect(form.inputs.Mac).not.toBe('myI7crNpAToKnoldyv0Z9x89MhFu0Ix9EwOTpgxPqf0=')
    expect(form.inputs.Mac).toBe(
      new PosNetV1PosCrypt().create3DHash(account, { MerchantNo: '6700950031', TerminalNo: '67540050', Amount: '30' }),
    )
  })

  it('reproduces the non-secure and post-auth MACs', () => {
    const sale = mapper.createNonSecurePaymentRequestData(
      account,
      { id: '123', amount: 10.0, installment: 0 },
      TX_TYPE.PAY_AUTH,
      card,
    )
    expect(sale.MAC).toBe('/R6nxI0N73nxANbkq4JVI3h94/mE0htExYyszlqTTWM=')
    const capture = mapper.createNonSecurePostAuthPaymentRequestData(account, {
      id: '123',
      amount: 12.3,
      ref_ret_num: '159044932490000231',
    })
    expect(capture.MAC).toBe('wgyfAJPbEPtTtce/+HRlXajSRfYA0J6mUcH+16EbB78=')
  })

  const callback = () => ({
    SecureTransactionId: '1010028947569644',
    CAVV: 'jKOBaLBL3hQ+CREBPu1HBQQAAAA=',
    ECI: '02',
    MdStatus: '1',
    MD: '9998F61E1D0C0FB6EC5203A748124F30',
  })

  it('builds the provision from the success callback', () => {
    const data = mapper.create3DPaymentRequestData(
      account,
      { id: '2020110828BC', amount: 100.01, currency: CURRENCY.TRY },
      TX_TYPE.PAY_AUTH,
      callback(),
    )
    expect(data.MAC).toBe('kAKxvbwXvmrM6lapGx1UcRTs454tsSuPrBXV7oA7L7w=')
    expect((data.ThreeDSecureData as Record<string, unknown>).MdStatus).toBe(1)
  })

  it('takes a null CAVV as empty text', () => {
    const data = mapper.create3DPaymentRequestData(account, { id: '2020110828BC', amount: 100.01 }, TX_TYPE.PAY_AUTH, {
      ...callback(),
      CAVV: null,
    })
    expect((data.ThreeDSecureData as Record<string, unknown>).CavvData).toBe('')
  })

  it.each<[string, Record<string, unknown>]>([
    ['SecureTransactionId array', { ...callback(), SecureTransactionId: ['1'] }],
    ['SecureTransactionId object', { ...callback(), SecureTransactionId: { a: 1 } }],
    ['CAVV object', { ...callback(), CAVV: { a: 1 } }],
    ['ECI missing', { ...callback(), ECI: undefined }],
    ['MD number', { ...callback(), MD: 1 }],
    ['MdStatus number', { ...callback(), MdStatus: 1 }],
    ['MdStatus text', { ...callback(), MdStatus: 'x' }],
    ['MdStatus empty', { ...callback(), MdStatus: '' }],
  ])('rejects a malformed callback value: %s', (_name, bad) => {
    expect(() =>
      mapper.create3DPaymentRequestData(account, { id: '2020110828BC', amount: 100.01 }, TX_TYPE.PAY_AUTH, bad),
    ).toThrow(PosError)
  })

  it('does not read inherited callback values', () => {
    const inherited = Object.create(callback()) as Record<string, unknown>
    expect(() =>
      mapper.create3DPaymentRequestData(account, { id: '2020110828BC', amount: 100.01 }, TX_TYPE.PAY_AUTH, inherited),
    ).toThrow(PosError)
  })

  describe('installment', () => {
    const build = (installment: unknown) =>
      mapper.createNonSecurePaymentRequestData(
        account,
        { id: '123', amount: 10, installment: installment as number },
        TX_TYPE.PAY_AUTH,
        card,
      )

    it.each([
      [0, '0', 'N'],
      [1, '0', 'N'],
      [2, '2', 'Y'],
      [12, '12', 'Y'],
      ['3', '3', 'Y'],
      ['03', '3', 'Y'],
      ['0', '0', 'N'],
      [undefined, '0', 'N'],
      [null, '0', 'N'],
    ])('accepts %j', (installment, count, type) => {
      const data = build(installment)
      expect(data.InstallmentCount).toBe(count)
      expect(data.InstallmentType).toBe(type)
    })

    it.each([
      -1,
      1.5,
      Number.NaN,
      100,
      '',
      ' ',
      ' 3',
      '3 ',
      '1e1',
      '0x2',
      '-1',
      '1.5',
      '123',
      'abc',
      true,
      [2],
      { a: 1 },
      1e21,
    ])('rejects %j', (installment) => {
      expect(() => build(installment)).toThrow(PosError)
    })
  })

  it.each<[string, () => unknown]>([
    [
      'form success_url',
      () =>
        mapper.create3DFormData(
          account,
          { ...formOrder(), success_url: undefined },
          MODEL.THREE_D_SECURE,
          TX_TYPE.PAY_AUTH,
          url,
          null,
        ),
    ],
    [
      'form amount',
      () =>
        mapper.create3DFormData(
          account,
          { ...formOrder(), amount: undefined },
          MODEL.THREE_D_SECURE,
          TX_TYPE.PAY_AUTH,
          url,
          null,
        ),
    ],
    [
      'form id',
      () =>
        mapper.create3DFormData(
          account,
          { ...formOrder(), id: undefined },
          MODEL.THREE_D_SECURE,
          TX_TYPE.PAY_AUTH,
          url,
          null,
        ),
    ],
    ['form order', () => mapper.create3DFormData(account, null, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, url, null)],
    ['post-auth ref_ret_num', () => mapper.createNonSecurePostAuthPaymentRequestData(account, { id: '1', amount: 1 })],
    [
      'post-auth amount',
      () => mapper.createNonSecurePostAuthPaymentRequestData(account, { id: '1', ref_ret_num: '1' }),
    ],
    ['sale amount', () => mapper.createNonSecurePaymentRequestData(account, { id: '1' }, TX_TYPE.PAY_AUTH, card)],
    ['sale id', () => mapper.createNonSecurePaymentRequestData(account, { amount: 1 }, TX_TYPE.PAY_AUTH, card)],
    ['provision amount', () => mapper.create3DPaymentRequestData(account, { id: '1' }, TX_TYPE.PAY_AUTH, callback())],
    ['status id', () => mapper.createStatusRequestData(account, {})],
    ['cancel id and ref_ret_num', () => mapper.createCancelRequestData(account, {})],
    ['refund amount', () => mapper.createRefundRequestData(account, { id: '1' }, TX_TYPE.REFUND)],
    ['refund id and ref_ret_num', () => mapper.createRefundRequestData(account, { amount: 1 }, TX_TYPE.REFUND)],
    ['refund of nothing', () => mapper.createRefundRequestData(account, { amount: 0, id: '1' }, TX_TYPE.REFUND)],
    [
      'amount NaN',
      () => mapper.createNonSecurePaymentRequestData(account, { id: '1', amount: Number.NaN }, TX_TYPE.PAY_AUTH, card),
    ],
    [
      'amount 1e13',
      () => mapper.createNonSecurePaymentRequestData(account, { id: '1', amount: 1e13 }, TX_TYPE.PAY_AUTH, card),
    ],
    ['order id with &', () => mapper.createStatusRequestData(account, { id: 'a&b' })],
  ])('rejects %s', async (_name, run) => {
    await expect(Promise.resolve().then(run)).rejects.toThrow(PosError)
  })

  it('never puts "undefined" in a request', () => {
    const all = [
      mapper.createNonSecurePaymentRequestData(account, { id: '1', amount: 1 }, TX_TYPE.PAY_AUTH, card),
      mapper.createNonSecurePostAuthPaymentRequestData(account, { id: '1', amount: 1, ref_ret_num: '9' }),
      mapper.createStatusRequestData(account, { id: '1' }),
      mapper.createCancelRequestData(account, { id: '1' }),
      mapper.createRefundRequestData(account, { id: '1', amount: 1, payment_model: MODEL.NON_SECURE }, TX_TYPE.REFUND),
      mapper.create3DPaymentRequestData(account, { id: '1', amount: 1 }, TX_TYPE.PAY_AUTH, callback()),
    ]
    expect(JSON.stringify(all)).not.toContain('undefined')
    expect(JSON.stringify(all)).not.toContain('NaN')
  })

  it('refund without a payment model is a 3D lookup and carries no amount', () => {
    const data = mapper.createRefundRequestData(account, { id: '1', amount: 5 }, TX_TYPE.REFUND_PARTIAL)
    expect(data.OrderId).toBe('TDS_00000000000000000001')
    expect('Amount' in data).toBe(false)
  })
})
