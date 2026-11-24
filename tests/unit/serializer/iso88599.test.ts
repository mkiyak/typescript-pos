import iconv from 'iconv-lite'
import { describe, expect, it } from 'vitest'
import type { HttpTransportResponse } from '../../../src/client/HttpTransport.js'
import {
  decodeXmlResponseText,
  encodeIso88599,
  isIso88599Representable,
  toIso88599Xml,
} from '../../../src/serializer/iso88599.js'

function response(bytes: Uint8Array): HttpTransportResponse {
  return { status: 200, body: Buffer.from(bytes).toString('utf8'), bytes, headers: new Headers() }
}

describe('iso88599', () => {
  it('knows which characters are representable', () => {
    expect(isIso88599Representable('Çağrı Öztürk İŞ')).toBe(true)
    expect(isIso88599Representable('€')).toBe(false)
    expect(isIso88599Representable('😀')).toBe(false)
    expect(isIso88599Representable('Ð')).toBe(false)
  })

  it('encodes Turkish letters as ISO-8859-9 bytes', () => {
    expect(Array.from(encodeIso88599('Çğ'))).toEqual([0xc7, 0xf0])
  })

  it('turns unrepresentable characters into character references', () => {
    expect(toIso88599Xml('<a>€</a>')).toBe('<a>&#x20AC;</a>')
    expect(toIso88599Xml('<a><![CDATA[x€y]]></a>')).toBe('<a><![CDATA[x]]>&#x20AC;<![CDATA[y]]></a>')
  })

  it('decodes a response with the charset of its XML declaration', () => {
    const bytes = new Uint8Array(iconv.encode('<?xml version="1.0" encoding="ISO-8859-9"?><a>Çğ</a>', 'ISO-8859-9'))
    expect(decodeXmlResponseText(response(bytes))).toBe('<?xml version="1.0" encoding="ISO-8859-9"?><a>Çğ</a>')
  })

  it('falls back to UTF-8 without a declaration', () => {
    const bytes = new Uint8Array(Buffer.from('<a>Çğ</a>', 'utf8'))
    expect(decodeXmlResponseText(response(bytes))).toBe('<a>Çğ</a>')
  })
})
