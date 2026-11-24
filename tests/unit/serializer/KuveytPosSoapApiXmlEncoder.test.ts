import { describe, expect, it } from 'vitest'
import { PosError } from '../../../src/errors.js'
import { KuveytPosSoapApiXmlEncoder } from '../../../src/serializer/KuveytPosSoapApiXmlEncoder.js'

const OPEN =
  '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://boa.net/BOA.Integration.VirtualPos/Service"><soapenv:Body>'
const CLOSE = '</soapenv:Body></soapenv:Envelope>'

describe('KuveytPosSoapApiXmlEncoder', () => {
  it.each([
    [
      'test_refund',
      {
        DrawBack: {
          request: {
            IsFromExternalNetwork: true,
            BusinessKey: 0,
            ProvisionNumber: '241839',
            VPosMessage: {
              APIVersion: 'TDV2.0.0',
              InstallmentMaturityCommisionFlag: 0,
              HashData: 'request-hash',
            },
          },
        },
      },
      `${OPEN}<ser:DrawBack><ser:request><ser:IsFromExternalNetwork>1</ser:IsFromExternalNetwork><ser:BusinessKey>0</ser:BusinessKey><ser:ProvisionNumber>241839</ser:ProvisionNumber><ser:VPosMessage><ser:APIVersion>TDV2.0.0</ser:APIVersion><ser:InstallmentMaturityCommisionFlag>0</ser:InstallmentMaturityCommisionFlag><ser:HashData>request-hash</ser:HashData></ser:VPosMessage></ser:request></ser:DrawBack>${CLOSE}`,
    ],
    [
      'test_partial_refund',
      {
        PartialDrawback: {
          request: {
            IsFromExternalNetwork: true,
            BusinessKey: 0,
            Stan: '298433',
            ProvisionNumber: '241839',
            VPosMessage: { APIVersion: 'TDV2.0.0', InstallmentMaturityCommisionFlag: 0 },
          },
        },
      },
      `${OPEN}<ser:PartialDrawback><ser:request><ser:IsFromExternalNetwork>1</ser:IsFromExternalNetwork><ser:BusinessKey>0</ser:BusinessKey><ser:Stan>298433</ser:Stan><ser:ProvisionNumber>241839</ser:ProvisionNumber><ser:VPosMessage><ser:APIVersion>TDV2.0.0</ser:APIVersion><ser:InstallmentMaturityCommisionFlag>0</ser:InstallmentMaturityCommisionFlag></ser:VPosMessage></ser:request></ser:PartialDrawback>${CLOSE}`,
    ],
    [
      'test_cancel',
      { abc: 1, abc2: { abc3: '3' } },
      `${OPEN}<ser:abc>1</ser:abc><ser:abc2><ser:abc3>3</ser:abc3></ser:abc2>${CLOSE}`,
    ],
    [
      'test_status',
      { abc: 1, abc2: { abc3: '3' } },
      `${OPEN}<ser:abc>1</ser:abc><ser:abc2><ser:abc3>3</ser:abc3></ser:abc2>${CLOSE}`,
    ],
  ])('encode %s', (_name, input, expected) => {
    expect(KuveytPosSoapApiXmlEncoder.encode(input)).toBe(expected)
  })

  // addition: K6, no XML declaration and false is sent as 0
  it('sends no declaration and writes false as 0', () => {
    const xml = KuveytPosSoapApiXmlEncoder.encode({ a: false, b: true })
    expect(xml.startsWith('<soapenv:Envelope')).toBe(true)
    expect(xml).toContain('<ser:a>0</ser:a><ser:b>1</ser:b>')
  })

  // addition: K6, a hostile value cannot add markup to the envelope
  it.each([
    ['a<b', '<ser:v><![CDATA[a<b]]></ser:v>'],
    ['x&y', '<ser:v><![CDATA[x&y]]></ser:v>'],
    ['</ser:v><evil/>', '<ser:v><![CDATA[</ser:v><evil/>]]></ser:v>'],
    ['a]]><evil/>', '<ser:v><![CDATA[a]]]]><![CDATA[><evil/>]]></ser:v>'],
  ])('escapes the value %s', (value, expected) => {
    expect(KuveytPosSoapApiXmlEncoder.encode({ v: value })).toBe(`${OPEN}${expected}${CLOSE}`)
  })

  // addition: K6, element names come from code but are checked before they reach the markup
  it('refuses an element name that could carry markup', () => {
    expect(() => KuveytPosSoapApiXmlEncoder.encode({ 'a><evil/><b': 'x' })).toThrow(PosError)
    expect(() => KuveytPosSoapApiXmlEncoder.encode({ a: { 'b c': 'x' } })).toThrow(PosError)
  })

  // addition: K6, repeated elements keep the prefix
  it('prefixes every item of a list', () => {
    expect(KuveytPosSoapApiXmlEncoder.encode({ a: [{ b: 1 }, { b: 2 }] })).toBe(
      `${OPEN}<ser:a><ser:b>1</ser:b></ser:a><ser:a><ser:b>2</ser:b></ser:a>${CLOSE}`,
    )
  })
})
