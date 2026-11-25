import { describe, expect, it } from 'vitest'
import { PosError } from '../../../src/errors.js'
import { ParamPosXmlEncoder } from '../../../src/serializer/ParamPosXmlEncoder.js'

const OPEN =
  '<?xml version="1.0" encoding="utf-8"?>\n<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">'
const CLOSE = '</soap:Envelope>\n'

const nest = (depth: number): Record<string, unknown> => {
  let value: unknown = 'x'
  for (let i = 0; i < depth; i++) value = { a: value }
  return value as Record<string, unknown>
}

describe('ParamPosXmlEncoder', () => {
  it.each([
    [
      'test_3d_payment',
      {
        'soap:Body': {
          TP_WMD_UCD: {
            Islem_ID: 'rand',
            Islem_Hash: 'jsLYSB3lJ81leFgDLw4D8PbXURs=',
            G: { CLIENT_CODE: '10738', CLIENT_USERNAME: 'Test1', CLIENT_PASSWORD: 'Test2' },
            GUID: '0c13d406-873b-403b-9c09-a5766840d98c',
            Islem_Guvenlik_Tip: '3D',
          },
        },
      },
      `${OPEN}<soap:Body><TP_WMD_UCD><Islem_ID>rand</Islem_ID><Islem_Hash>jsLYSB3lJ81leFgDLw4D8PbXURs=</Islem_Hash><G><CLIENT_CODE>10738</CLIENT_CODE><CLIENT_USERNAME>Test1</CLIENT_USERNAME><CLIENT_PASSWORD>Test2</CLIENT_PASSWORD></G><GUID>0c13d406-873b-403b-9c09-a5766840d98c</GUID><Islem_Guvenlik_Tip>3D</Islem_Guvenlik_Tip></TP_WMD_UCD></soap:Body>${CLOSE}`,
    ],
    [
      'test_xmlns_attributes_are_added_to_root',
      { 'soap:Body': { SomeMethod: { param1: 'value1' } } },
      `${OPEN}<soap:Body><SomeMethod><param1>value1</param1></SomeMethod></soap:Body>${CLOSE}`,
    ],
  ])('encodes %s', (_name, input, expected) => {
    expect(ParamPosXmlEncoder.encode(input)).toBe(expected)
  })

  // addition: an attribute and a text node keep their keys (the hosted-page header declares a namespace)
  it('keeps attributes and text nodes', () => {
    expect(ParamPosXmlEncoder.encode({ 'soap:Header': { H: { '@xmlns': 'https://turkodeme.com.tr/', A: 'b' } } })).toBe(
      `${OPEN}<soap:Header><H xmlns="https://turkodeme.com.tr/"><A>b</A></H></soap:Header>${CLOSE}`,
    )
  })

  // addition: a null value is an empty element, never the text "null"
  it('writes null as an empty element', () => {
    expect(ParamPosXmlEncoder.encode({ 'soap:Body': { M: { Prov_ID: null } } })).toBe(
      `${OPEN}<soap:Body><M><Prov_ID/></M></soap:Body>${CLOSE}`,
    )
  })

  // addition: a value with markup characters is escaped, never read as markup
  it.each([
    ['Ali & Ayşe', '<KK_Sahibi><![CDATA[Ali & Ayşe]]></KK_Sahibi>'],
    ['a<b', '<KK_Sahibi><![CDATA[a<b]]></KK_Sahibi>'],
    ['a]]>b', '<KK_Sahibi><![CDATA[a]]]]><![CDATA[>b]]></KK_Sahibi>'],
  ])('puts %j into CDATA', (value, expected) => {
    expect(ParamPosXmlEncoder.encode({ 'soap:Body': { M: { KK_Sahibi: value } } })).toContain(expected)
  })

  // addition: a key becomes a tag or attribute name, so it must not carry markup
  it.each([
    ['space', { 'a b': 1 }],
    ['angle brackets', { '<x>': 1 }],
    ['attribute with space', { M: { '@a b': 1 } }],
    ['attribute with quote', { M: { '@a"b': 1 } }],
    ['nested bad name', { M: { 'x><y': 1 } }],
    ['empty name', { '': 1 }],
    ['other prefix', { 'evil:Body': 1 }],
  ])('rejects an invalid name (%s)', (_name, input) => {
    expect(() => ParamPosXmlEncoder.encode(input as Record<string, unknown>)).toThrow(PosError)
  })

  // addition: depth is bounded
  it('rejects a request nested deeper than 32 levels', () => {
    expect(() => ParamPosXmlEncoder.encode(nest(33))).toThrow(PosError)
    expect(() => ParamPosXmlEncoder.encode(nest(10))).not.toThrow()
  })
})
