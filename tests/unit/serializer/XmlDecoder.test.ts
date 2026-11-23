import { describe, expect, it } from 'vitest'
import { PosHttpError } from '../../../src/errors.js'
import { JsonDecoder } from '../../../src/serializer/JsonDecoder.js'
import { XmlDecoder } from '../../../src/serializer/XmlDecoder.js'

describe('XmlDecoder', () => {
  it.each([
    [
      'garanti_style_response',
      '<?xml version="1.0" encoding="UTF-8"?>\n<GVPSRequest><Mode>TEST</Mode><Version>v0.01</Version><Terminal><ID>30691298</ID><MerchantID>7000679</MerchantID></Terminal></GVPSRequest>\n',
      { Mode: 'TEST', Version: 'v0.01', Terminal: { ID: '30691298', MerchantID: '7000679' } },
    ],
    [
      'simple_xml_response',
      '<CC5Response><OrderId>order222</OrderId><ProcReturnCode>00</ProcReturnCode><Response>Approved</Response></CC5Response>',
      { OrderId: 'order222', ProcReturnCode: '00', Response: 'Approved' },
    ],
    ['xml_with_empty_element', '<Response><Code>00</Code><Message/></Response>', { Code: '00', Message: '' }],
    ['cancel_response', '<Response><Status>OK</Status></Response>', { Status: 'OK' }],
    ['repeated_elements_become_array', '<R><I>1</I><I>2</I></R>', { I: ['1', '2'] }],
    ['attributes_and_text', '<R><I id="5">v</I></R>', { I: { '@id': '5', '#': 'v' } }],
    ['numbers_stay_strings', '<R><A>0012.50</A><B>true</B></R>', { A: '0012.50', B: 'true' }],
  ])('decodes %s', (_n, input, expected) => {
    expect(XmlDecoder.decode(input)).toEqual(expected)
  })

  it('throws PosHttpError on empty string', () => {
    expect(() => XmlDecoder.decode('')).toThrow(PosHttpError)
    expect(() => XmlDecoder.decode('   ')).toThrow(PosHttpError)
  })

  it('throws PosHttpError on an HTML error page', () => {
    const html = `<!DOCTYPE html>
<html>
    <head><title>Server Error</title></head>
    <body>
        <h1>Server Error in Application.</h1>
    </body>
</html>`
    expect(() => XmlDecoder.decode(html)).toThrow(PosHttpError)
  })

  it('throws PosHttpError on well-formed WAF HTML and on malformed XML', () => {
    expect(() => XmlDecoder.decode('<html><body>The requested URL was rejected</body></html>')).toThrow(PosHttpError)
    expect(() => XmlDecoder.decode('<a><b></a>')).toThrow(PosHttpError)
    expect(() => XmlDecoder.decode('plain text')).toThrow(PosHttpError)
  })
})

describe('JsonDecoder', () => {
  it.each([
    ['simple_json', '{"abc": 1, "dfe": 1.0}', { abc: 1, dfe: 1 }],
    ['nested_json', '{"order":{"id":"order222","amount":"100.25"}}', { order: { id: 'order222', amount: '100.25' } }],
    ['response_with_null_value', '{"code":"00","message":null}', { code: '00', message: null }],
    ['with_empty_value', '', {}],
  ])('decodes %s', (_n, input, expected) => {
    expect(JsonDecoder.decode(input)).toEqual(expected)
  })

  it('throws PosHttpError on invalid JSON or non-object JSON', () => {
    expect(() => JsonDecoder.decode('<html>')).toThrow(PosHttpError)
    expect(() => JsonDecoder.decode('"str"')).toThrow(PosHttpError)
  })
})
