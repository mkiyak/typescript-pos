import { describe, expect, it } from 'vitest'
import { PosHttpError } from '../../../src/errors.js'
import { KuveytPosSoapApiXmlDecoder } from '../../../src/serializer/KuveytPosSoapApiXmlDecoder.js'
import { SoapXmlDecoder } from '../../../src/serializer/SoapXmlDecoder.js'

const ENV = 'http://schemas.xmlsoap.org/soap/envelope/'

describe('SoapXmlDecoder', () => {
  // addition: shared by every SOAP gateway
  it.each([
    ['soap:', `<soap:Envelope xmlns:soap="${ENV}"><soap:Body><R><A>1</A></R></soap:Body></soap:Envelope>`],
    ['s:', `<s:Envelope xmlns:s="${ENV}"><s:Body><R><A>1</A></R></s:Body></s:Envelope>`],
    ['env:', `<env:Envelope xmlns:env="${ENV}"><env:Body><R><A>1</A></R></env:Body></env:Envelope>`],
    ['no prefix', `<Envelope xmlns="${ENV}"><Body><R><A>1</A></R></Body></Envelope>`],
  ])('returns the body for the %s envelope', (_name, xml) => {
    expect(SoapXmlDecoder.decode(xml)).toEqual({ R: { A: '1' } })
  })

  // addition: the echoed service header (it carries the API password) never reaches the caller
  it('drops the soap:Header', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="${ENV}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soap:Header>
    <ServiceSecuritySoapHeader xmlns="https://turkodeme.com.tr/">
      <CLIENT_CODE>10738</CLIENT_CODE><CLIENT_USERNAME>Test</CLIENT_USERNAME><CLIENT_PASSWORD>EchoedSecret9</CLIENT_PASSWORD>
    </ServiceSecuritySoapHeader>
  </soap:Header>
  <soap:Body>
    <TO_Pre_Encrypting_OOSResponse xmlns="https://turkodeme.com.tr/">
      <TO_Pre_Encrypting_OOSResult>ImBuIu4mlRq/ikGHMe5Z==</TO_Pre_Encrypting_OOSResult>
    </TO_Pre_Encrypting_OOSResponse>
  </soap:Body>
</soap:Envelope>`
    const decoded = SoapXmlDecoder.decode(xml)
    expect(JSON.stringify(decoded)).not.toContain('EchoedSecret9')
    expect(JSON.stringify(decoded)).not.toContain('CLIENT_PASSWORD')
    expect(decoded).toEqual({
      TO_Pre_Encrypting_OOSResponse: { TO_Pre_Encrypting_OOSResult: 'ImBuIu4mlRq/ikGHMe5Z==' },
    })
  })

  // addition: an element that declares a namespace around text is that text
  it('turns TO_Pre_Encrypting_OOSResponse with an xmlns and text into the result text', () => {
    const xml = `<soap:Envelope xmlns:soap="${ENV}"><soap:Body><TO_Pre_Encrypting_OOSResponse xmlns="https://turkodeme.com.tr/">abc</TO_Pre_Encrypting_OOSResponse></soap:Body></soap:Envelope>`
    expect(SoapXmlDecoder.decode(xml)).toEqual({ TO_Pre_Encrypting_OOSResponse: 'abc' })
  })

  // addition: the response wrapper with a result element holding text
  it('keeps the result text of a namespaced wrapper', () => {
    const xml = `<soap:Envelope xmlns:soap="${ENV}"><soap:Body><TO_Pre_Encrypting_OOSResponse xmlns="https://turkodeme.com.tr/"><TO_Pre_Encrypting_OOSResult>text</TO_Pre_Encrypting_OOSResult></TO_Pre_Encrypting_OOSResponse></soap:Body></soap:Envelope>`
    expect(SoapXmlDecoder.decode(xml)).toEqual({
      TO_Pre_Encrypting_OOSResponse: { TO_Pre_Encrypting_OOSResult: 'text' },
    })
  })

  // addition: a missing, empty or non-XML body is an HTTP-level error
  it.each([
    ['no body', `<soap:Envelope xmlns:soap="${ENV}"><soap:Header/></soap:Envelope>`],
    ['empty body', `<soap:Envelope xmlns:soap="${ENV}"><soap:Body/></soap:Envelope>`],
    ['html', '<html><body>blocked</body></html>'],
  ])('rejects an answer with %s', (_name, xml) => {
    expect(() => SoapXmlDecoder.decode(xml)).toThrow(PosHttpError)
  })

  // addition: hardening: a document type or entity definition is refused, also when split by a null character
  it.each([
    ['an internal entity', '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "boom">]>'],
    ['an external entity', '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>'],
    ['a lower case declaration', '<!doctype x [<!entity e "boom">]>'],
    ['an entity alone', '<!ENTITY e "boom">'],
  ])('refuses %s', (_name, head) => {
    const xml = `${head}<soap:Envelope xmlns:soap="${ENV}"><soap:Body><R>&e;</R></soap:Body></soap:Envelope>`
    expect(() => SoapXmlDecoder.decode(xml)).toThrow(PosHttpError)
  })

  // addition: the Kuveyt name reads the same body logic (it does not refuse document types)
  it('reads the same bodies as the Kuveyt decoder', () => {
    const xml = `<s:Envelope xmlns:s="${ENV}"><s:Body><R><A>1</A></R></s:Body></s:Envelope>`
    expect(KuveytPosSoapApiXmlDecoder.decode(xml)).toStrictEqual(SoapXmlDecoder.decode(xml))
  })
})
