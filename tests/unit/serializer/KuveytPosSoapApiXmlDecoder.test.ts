import { describe, expect, it } from 'vitest'
import { PosHttpError } from '../../../src/errors.js'
import { KuveytPosSoapApiXmlDecoder } from '../../../src/serializer/KuveytPosSoapApiXmlDecoder.js'

const RESULT_VALUE = {
  IsEnrolled: 'false',
  IsVirtual: 'false',
  ResponseCode: 'DbLayerError',
  OrderId: '0',
  TransactionTime: '0001-01-01T00:00:00',
  MerchantId: { '@xsi:nil': 'true', '#': '' },
  BusinessKey: '0',
}

describe('KuveytPosSoapApiXmlDecoder', () => {
  it.each([
    [
      'test_cancel',
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><SaleReversalResponse xmlns="http://boa.net/BOA.Integration.VirtualPos/Service"><SaleReversalResult><Results><Result><ErrorMessage>İptal işlemi satışla aynı gün yapılmalıdır. Geçmiş tarihli işlem için iade yapınız.</ErrorMessage><ErrorCode>InvalidRequestError</ErrorCode><IsFriendly>true</IsFriendly><Severity>BusinessError</Severity></Result></Results><Success>false</Success><Value><IsEnrolled>false</IsEnrolled><IsVirtual>false</IsVirtual><ResponseCode>DbLayerError</ResponseCode><OrderId>0</OrderId><TransactionTime>0001-01-01T00:00:00</TransactionTime><MerchantId xsi:nil="true"/><BusinessKey>0</BusinessKey></Value></SaleReversalResult></SaleReversalResponse></s:Body></s:Envelope>',
      {
        SaleReversalResponse: {
          SaleReversalResult: {
            Results: {
              Result: {
                ErrorMessage: 'İptal işlemi satışla aynı gün yapılmalıdır. Geçmiş tarihli işlem için iade yapınız.',
                ErrorCode: 'InvalidRequestError',
                IsFriendly: 'true',
                Severity: 'BusinessError',
              },
            },
            Success: 'false',
            Value: RESULT_VALUE,
          },
        },
      },
    ],
    [
      'test_refund',
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><PartialDrawbackResponse xmlns="http://boa.net/BOA.Integration.VirtualPos/Service"><PartialDrawbackResult><Results><Result><ErrorMessage>IsoProxyFactoryServiceResponseWasNull</ErrorMessage><ErrorCode>ServiceUnavailable</ErrorCode><IsFriendly>true</IsFriendly><Severity>BusinessError</Severity></Result></Results><Success>false</Success><Value><IsEnrolled>false</IsEnrolled><IsVirtual>false</IsVirtual><ResponseCode>DbLayerError</ResponseCode><OrderId>0</OrderId><TransactionTime>0001-01-01T00:00:00</TransactionTime><MerchantId xsi:nil="true"/><BusinessKey>0</BusinessKey></Value></PartialDrawbackResult></PartialDrawbackResponse></s:Body></s:Envelope>',
      {
        PartialDrawbackResponse: {
          PartialDrawbackResult: {
            Results: {
              Result: {
                ErrorMessage: 'IsoProxyFactoryServiceResponseWasNull',
                ErrorCode: 'ServiceUnavailable',
                IsFriendly: 'true',
                Severity: 'BusinessError',
              },
            },
            Success: 'false',
            Value: RESULT_VALUE,
          },
        },
      },
    ],
  ])('decode %s', (_name, xml, expected) => {
    expect(KuveytPosSoapApiXmlDecoder.decode(xml)).toStrictEqual(expected)
  })

  // addition: K6, the prefix of the envelope namespace is the bank's choice
  it.each([
    ['soap:', '<soap:Envelope xmlns:soap="x"><soap:Body><r>1</r></soap:Body></soap:Envelope>'],
    ['none', '<Envelope xmlns="x"><Body><r>1</r></Body></Envelope>'],
  ])('reads the body under the %s prefix', (_n, xml) => {
    expect(KuveytPosSoapApiXmlDecoder.decode(xml)).toStrictEqual({ r: '1' })
  })

  // addition: K6, namespace declarations are dropped at every level, the nil marker stays
  it('drops xmlns declarations at every level', () => {
    const xml =
      '<s:Envelope xmlns:s="x"><s:Body xmlns:q="y"><a xmlns="z"><b xmlns:x="w" xsi:nil="true"/></a></s:Body></s:Envelope>'
    expect(KuveytPosSoapApiXmlDecoder.decode(xml)).toStrictEqual({ a: { b: { '@xsi:nil': 'true', '#': '' } } })
  })

  // addition: K6, a SOAP answer without a usable body is an HTTP-level failure
  it.each([
    ['no body', '<s:Envelope xmlns:s="x"><s:Header/></s:Envelope>'],
    ['empty body', '<s:Envelope xmlns:s="x"><s:Body/></s:Envelope>'],
    ['text body', '<s:Envelope xmlns:s="x"><s:Body>hi</s:Body></s:Envelope>'],
    ['empty', ''],
    ['html', '<html><body>blocked</body></html>'],
    ['not xml', 'not xml'],
  ])('rejects an answer with %s', (_n, xml) => {
    expect(() => KuveytPosSoapApiXmlDecoder.decode(xml)).toThrow(PosHttpError)
  })

  // addition: K6, a very deep answer is refused instead of overflowing the stack
  it('refuses a body nested too deeply', () => {
    const deep = `${'<a>'.repeat(200)}x${'</a>'.repeat(200)}`
    expect(() =>
      KuveytPosSoapApiXmlDecoder.decode(`<s:Envelope xmlns:s="x"><s:Body>${deep}</s:Body></s:Envelope>`),
    ).toThrow(PosHttpError)
  })

  // addition: K6, entity definitions in an answer are not expanded
  it('does not expand entities defined in the answer', () => {
    const xml =
      '<!DOCTYPE s [<!ENTITY a "AAAAAAAAAA"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><s:Envelope xmlns:s="x"><s:Body><r>&b;</r></s:Body></s:Envelope>'
    expect(KuveytPosSoapApiXmlDecoder.decode(xml)).toStrictEqual({ r: '&b;' })
  })
})
