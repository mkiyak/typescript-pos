import { describe, expect, it } from 'vitest'
import { XmlEncoder } from '../../../src/serializer/XmlEncoder.js'

describe('XmlEncoder', () => {
  it('constructs root node', () => {
    expect(XmlEncoder.encode({ key: 'val' }, { rootName: 'root' })).toContain('<root>')
  })

  it('omits declaration when requested', () => {
    expect(XmlEncoder.encode({ k: 'v' }, { rootName: 'root', omitDeclaration: true })).not.toContain('<?xml')
  })

  it.each([
    [
      'garanti_utf8',
      'GVPSRequest',
      'UTF-8' as const,
      { Mode: 'TEST', Version: 'v0.01' },
      '<?xml version="1.0" encoding="UTF-8"?>\n<GVPSRequest><Mode>TEST</Mode><Version>v0.01</Version></GVPSRequest>\n',
    ],
    [
      'estpos_iso-8859-9',
      'CC5Request',
      'ISO-8859-9' as const,
      { Name: 'test', Password: 'secret' },
      '<?xml version="1.0" encoding="ISO-8859-9"?>\n<CC5Request><Name>test</Name><Password>secret</Password></CC5Request>\n',
    ],
    [
      'nested_data',
      'posnetRequest',
      'ISO-8859-9' as const,
      { terminal: { id: '123', amount: '100' } },
      '<?xml version="1.0" encoding="ISO-8859-9"?>\n<posnetRequest><terminal><id>123</id><amount>100</amount></terminal></posnetRequest>\n',
    ],
    [
      'cancel_request',
      'GVPSRequest',
      'UTF-8' as const,
      { key: 'value' },
      '<?xml version="1.0" encoding="UTF-8"?>\n<GVPSRequest><key>value</key></GVPSRequest>\n',
    ],
  ])('encodes %s', (_n, rootName, encoding, input, expected) => {
    expect(XmlEncoder.encode(input, { rootName, encoding })).toBe(expected)
  })

  it('encodes with_ignored_pi_node_option (no declaration, no trailing newline)', () => {
    expect(
      XmlEncoder.encode(
        { MerchantId: '000000000111111', Password: 'secret' },
        { rootName: 'VposRequest', omitDeclaration: true },
      ),
    ).toBe('<VposRequest><MerchantId>000000000111111</MerchantId><Password>secret</Password></VposRequest>')
  })

  it('defaults to UTF-8 and root "response"', () => {
    expect(XmlEncoder.encode({ a: '1' })).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<response><a>1</a></response>\n',
    )
  })

  it('handles attributes, text, empty values, lists, numbers and booleans', () => {
    const out = XmlEncoder.encode(
      {
        Item: { '@id': '7', '#': 'txt' },
        Empty: '',
        Nil: null,
        List: ['a', 'b'],
        N: 10.5,
        T: true,
        F: false,
      },
      { rootName: 'r', omitDeclaration: true },
    )
    expect(out).toBe(
      '<r><Item id="7">txt</Item><Empty/><Nil/><List>a</List><List>b</List><N>10.5</N><T>1</T><F>0</F></r>',
    )
  })

  it('wraps values containing <, > or & in CDATA and escapes attribute values', () => {
    const out = XmlEncoder.encode({ a: 'x&y', b: { '@q': 'a"b&' } }, { rootName: 'r', omitDeclaration: true })
    expect(out).toBe('<r><a><![CDATA[x&y]]></a><b q="a&quot;b&amp;"/></r>')
  })
})
