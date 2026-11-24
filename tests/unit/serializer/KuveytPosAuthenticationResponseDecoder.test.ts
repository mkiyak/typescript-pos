import { describe, expect, it } from 'vitest'
import { PosError } from '../../../src/errors.js'
import { KuveytPosAuthenticationResponseDecoder } from '../../../src/serializer/KuveytPosAuthenticationResponseDecoder.js'
import {
  AUTH_FAIL_RESPONSE,
  AUTH_SUCCESS_PAYMENT_FAIL_RESPONSE,
  SUCCESS_RESPONSE,
} from './kuveytPosCallbackFixtures.js'

const NIL = { '@xsi:nil': 'true', '#': '' }

const causeChain = (e: unknown): string[] => {
  const out: string[] = []
  for (let c: unknown = e; c instanceof Error; c = c.cause) out.push(`${c.name}: ${c.message}`, JSON.stringify(c))
  return out
}

describe('KuveytPosAuthenticationResponseDecoder', () => {
  // addition: K7, the three callback values of the gateway tests decode to the records those tests expect
  it('decodes auth_fail', () => {
    expect(KuveytPosAuthenticationResponseDecoder.decode(AUTH_FAIL_RESPONSE)).toStrictEqual({
      '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
      IsEnrolled: 'true',
      IsVirtual: 'false',
      ResponseCode: 'HashDataError',
      ResponseMessage: 'Şifrelenen veriler (Hashdata) uyuşmamaktadır.',
      OrderId: '0',
      TransactionTime: '0001-01-01T00:00:00',
      MerchantOrderId: '2020110828BC',
      ReferenceId: '9b8e2326a9df44c2b2aac0b98b11f0a4',
      BusinessKey: '0',
    })
  })

  it('decodes 3d_auth_success_payment_fail', () => {
    expect(KuveytPosAuthenticationResponseDecoder.decode(AUTH_SUCCESS_PAYMENT_FAIL_RESPONSE)).toStrictEqual({
      '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
      VPosMessage: {
        OrderId: '86483278',
        OkUrl: 'https://www.example.com/testodeme',
        FailUrl: 'https://www.example.com/testodeme',
        MerchantId: '48544',
        SubMerchantId: '0',
        CustomerId: '123456',
        UserName: 'fapapi',
        HashPassword: 'Hiorgg24rNeRdHUvMCg//mOJn4U=',
        CardNumber: '5124********1609',
        BatchID: '1576',
        InstallmentCount: '0',
        Amount: '10',
        CancelAmount: '0',
        MerchantOrderId: 'MP-15',
        FECAmount: '0',
        CurrencyCode: '949',
        QeryId: '0',
        DebtId: '0',
        SurchargeAmount: '0',
        SGKDebtAmount: '0',
        TransactionSecurity: '3',
        DeferringCount: NIL,
        InstallmentMaturityCommisionFlag: '0',
        PaymentId: NIL,
        OrderPOSTransactionId: NIL,
        TranDate: NIL,
        TransactionUserId: NIL,
      },
      IsEnrolled: 'true',
      IsVirtual: 'false',
      ResponseCode: '00',
      ResponseMessage: 'Kart doğrulandı.',
      OrderId: '86483278',
      TransactionTime: '0001-01-01T00:00:00',
      MerchantOrderId: 'MP-15',
      HashData: 'mOw0JGvy1JVWqDDmFyaDTvKz9Fk=',
      MD: 'ktSVkYJHcHSYM1ibA/nM6nObr8WpWdcw34ziyRQRLv06g7UR2r5LrpLeNvwfBwPz',
      BusinessKey: '202208456498416947',
    })
  })

  it('decodes success', () => {
    expect(KuveytPosAuthenticationResponseDecoder.decode(SUCCESS_RESPONSE)).toStrictEqual({
      VPosMessage: {
        APIVersion: '1.0.0',
        OkUrl: 'http://localhost:44785/Home/Success',
        FailUrl: 'http://localhost:44785/Home/Fail',
        HashData: 'lYJYMi/gVO9MWr32Pshaa/zAbSHY=',
        MerchantId: '80',
        SubMerchantId: '0',
        CustomerId: '400235',
        UserName: 'apiuser',
        CardNumber: '5124********1609',
        CardHolderName: 'afafa',
        CardType: 'MasterCard',
        BatchID: '0',
        TransactionType: 'Sale',
        InstallmentCount: '0',
        Amount: '100',
        DisplayAmount: '100',
        MerchantOrderId: 'Order 123',
        FECAmount: '0',
        CurrencyCode: '0949',
        QeryId: '0',
        DebtId: '0',
        SurchargeAmount: '0',
        SGKDebtAmount: '0',
        TransactionSecurity: '3',
        TransactionSide: 'Auto',
        EntryGateMethod: 'VPOS_ThreeDModelPayGate',
      },
      IsEnrolled: 'true',
      IsVirtual: 'false',
      OrderId: '0',
      TransactionTime: '0001-01-01T00:00:00',
      ResponseCode: '00',
      ResponseMessage: 'HATATA',
      MD: '67YtBfBRTZ0XBKnAHi8c/A==',
      AuthenticationPacket: 'WYGDgSIrSHDtYwF/WEN+nfwX63sppA=',
      ACSURL: 'https://acs.bkm.com.tr/mdpayacs/pareq',
    })
  })

  // addition: K7, urldecode semantics
  it('reads + as a space and %2B as a plus', () => {
    expect(KuveytPosAuthenticationResponseDecoder.decode('%3Ca%3E1+2%2B3%3C%2Fa%3E')).toStrictEqual({ '#': '1 2+3' })
  })

  it('keeps a % that is not followed by two hex digits', () => {
    expect(KuveytPosAuthenticationResponseDecoder.decode('<r><a>100%</a><b>%zz</b><c>%4</c></r>')).toStrictEqual({
      a: '100%',
      b: '%zz',
      c: '%4',
    })
  })

  it('decodes percent-encoded bytes in the charset the declaration names', () => {
    expect(
      KuveytPosAuthenticationResponseDecoder.decode('<?xml version="1.0" encoding="ISO-8859-9"?><r><a>%DEeker</a></r>'),
    ).toStrictEqual({ a: 'Şeker' })
  })

  it('decodes UTF-8 bytes when the declaration is UTF-8 or names no charset', () => {
    expect(
      KuveytPosAuthenticationResponseDecoder.decode('<?xml version="1.0" encoding="UTF-8"?><r><a>%C5%9Eeker</a></r>'),
    ).toStrictEqual({ a: 'Şeker' })
    expect(KuveytPosAuthenticationResponseDecoder.decode('<r><a>%C5%9Eeker</a></r>')).toStrictEqual({ a: 'Şeker' })
  })

  // addition: only the charsets the bank uses are decoded; a declaration cannot pick any other decoder
  it.each([
    ['iso-8859-1', '%E7'],
    ['ISO-8859-9', '%DE'],
    ['windows-1254', '%DE'],
    ['Windows-1254', '%DE'],
    ['utf-8', '%C5%9E'],
    ['UTF8', '%C5%9E'],
  ])('accepts the declared charset %s', (charset, bytes) => {
    const actual = KuveytPosAuthenticationResponseDecoder.decode(
      `<?xml version="1.0" encoding="${charset}"?><r><a>${bytes}eker</a></r>`,
    )
    expect(typeof actual.a).toBe('string')
  })

  it.each(['UTF-7', 'UTF-32', 'UTF-16', 'x-nope', 'cp037', 'shift_jis'])(
    'refuses the declared charset %s',
    (charset) => {
      expect(() =>
        KuveytPosAuthenticationResponseDecoder.decode(`<?xml version="1.0" encoding="${charset}"?><r><a>x</a></r>`),
      ).toThrow(PosError)
    },
  )

  // addition: K7, hostile input is refused without echoing it
  it.each([
    ['doctype', '<!DOCTYPE r [<!ENTITY a "SECRET-ENTITY">]><r>&a;</r>'],
    ['entity', '<!ENTITY a "SECRET-ENTITY"><r>x</r>'],
    ['lower case doctype', '<!doctype r><r>SECRET-ENTITY</r>'],
    ['mixed case entity', '<r><!EnTiTy a "SECRET-ENTITY"></r>'],
    ['encoded doctype', '%3C%21DOCTYPE+r+%5B%3C%21ENTITY+a+%22SECRET-ENTITY%22%3E%5D%3E%3Cr%3E%26a%3B%3C%2Fr%3E'],
    ['too long', `<r>${'SECRET-ENTITY'.repeat(6000)}</r>`],
    ['65537 characters', 'a'.repeat(65_537)],
    ['not xml', 'not xml SECRET-ENTITY'],
    ['html', '<html><body>SECRET-ENTITY</body></html>'],
    ['empty', ''],
    ['invalid utf-8', '<r>SECRET-ENTITY%FF%FE</r>'],
    ['deep', `${'<a>'.repeat(100)}SECRET-ENTITY${'</a>'.repeat(100)}`],
    ['unclosed', '<r><a>SECRET-ENTITY</r>'],
  ])('refuses %s', (_name, value) => {
    let thrown: unknown
    try {
      KuveytPosAuthenticationResponseDecoder.decode(value)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(PosError)
    expect((thrown as Error).message).toBe('3D callback AuthenticationResponse is not valid XML')
    for (const text of causeChain(thrown)) {
      expect(text).not.toContain('SECRET-ENTITY')
    }
  })

  it('accepts exactly 65536 characters of markup', () => {
    const value = `<r><a>${'x'.repeat(65_536 - 14)}</a></r>`
    expect(value).toHaveLength(65_536)
    expect(KuveytPosAuthenticationResponseDecoder.decode(value)).toHaveProperty('a')
  })

  it('refuses a value that is not a string', () => {
    expect(() => KuveytPosAuthenticationResponseDecoder.decode(undefined as never)).toThrow(PosError)
    expect(() => KuveytPosAuthenticationResponseDecoder.decode({ a: 1 } as never)).toThrow(PosError)
  })

  // addition: Task 4/5, the shapes the gateway must refuse reach it as lists and records, never as text
  it.each([
    [
      'a duplicated MerchantOrderId is a list',
      '<r><MerchantOrderId>A</MerchantOrderId><MerchantOrderId>B</MerchantOrderId></r>',
      { MerchantOrderId: ['A', 'B'] },
    ],
    [
      'an attributed ResponseCode is a record',
      '<r><ResponseCode a="1">00</ResponseCode></r>',
      { ResponseCode: { '@a': '1', '#': '00' } },
    ],
    [
      'a ResponseCode with a child is a record',
      '<r><ResponseCode><b>00</b></ResponseCode></r>',
      { ResponseCode: { b: '00' } },
    ],
    [
      'a duplicated message Amount is a list',
      '<r><VPosMessage><Amount>1</Amount><Amount>00</Amount></VPosMessage></r>',
      { VPosMessage: { Amount: ['1', '00'] } },
    ],
  ])('%s', (_name, xml, expected) => {
    expect(KuveytPosAuthenticationResponseDecoder.decode(encodeURIComponent(xml))).toStrictEqual(expected)
  })

  // addition: a declaration split by a null character reference is refused or never expands
  it.each([
    ['upper case', '<?xml version="1.0"?><!DOC&#x0;TYPE a [<!ENT&#x0;ITY x "BOOM">]><R><A>&x;</A></R>'],
    ['lower case', '<!doc&#x0;type a [<!ent&#x0;ity x "BOOM">]><R><A>&x;</A></R>'],
  ])('does not expand a split %s', (_n, xml) => {
    let decoded: unknown
    try {
      decoded = KuveytPosAuthenticationResponseDecoder.decode(encodeURIComponent(xml))
    } catch (e) {
      expect(e).toBeInstanceOf(PosError)
      return
    }
    expect(JSON.stringify(decoded)).not.toContain('BOOM')
  })
})
