import iconv from 'iconv-lite'
import type { HttpTransportResponse } from '../client/HttpTransport.js'

export const ISO_8859_9 = 'ISO-8859-9'

/** The six Turkish letters ISO-8859-9 has in place of the Latin-1 letters Ð Ý Þ ð ý þ. */
const TURKISH_LETTERS: ReadonlySet<number> = new Set([0x011e, 0x011f, 0x0130, 0x0131, 0x015e, 0x015f])
const REPLACED_LATIN1_LETTERS: ReadonlySet<number> = new Set([0xd0, 0xdd, 0xde, 0xf0, 0xfd, 0xfe])

function inIso88599(codePoint: number): boolean {
  return codePoint <= 0xff ? !REPLACED_LATIN1_LETTERS.has(codePoint) : TURKISH_LETTERS.has(codePoint)
}

/** True when every code point of the value exists in ISO-8859-9. */
export function isIso88599Representable(value: string): boolean {
  for (const char of value) {
    if (!inIso88599(char.codePointAt(0) as number)) return false
  }
  return true
}

/** Replaces every character ISO-8859-9 cannot represent. */
function replaceUnrepresentable(value: string, replace: (char: string) => string): string {
  let out = ''
  for (const char of value) {
    out += inIso88599(char.codePointAt(0) as number) ? char : replace(char)
  }
  return out
}

const CDATA_SECTION = /(<!\[CDATA\[[\s\S]*?\]\]>)/

const charRef = (char: string): string => `&#x${(char.codePointAt(0) as number).toString(16).toUpperCase()};`

/**
 * Like libxml when saving a document in a legacy charset, characters the charset cannot represent become
 * character references (CDATA sections are split around them) instead of being lost.
 */
export function toIso88599Xml(xml: string): string {
  return xml
    .split(CDATA_SECTION)
    .map((part) =>
      part.startsWith('<![CDATA[')
        ? replaceUnrepresentable(part, (c) => `]]>${charRef(c)}<![CDATA[`)
        : replaceUnrepresentable(part, charRef),
    )
    .join('')
}

/** The value as ISO-8859-9 bytes. */
export function encodeIso88599(value: string): Uint8Array {
  return new Uint8Array(iconv.encode(value, ISO_8859_9))
}

/** `encoding="..."` of an XML declaration at the start of the body (the declaration itself is ASCII). */
const XML_DECLARATION_ENCODING = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/

/** Decodes a response body with the charset its XML declaration announces (UTF-8 when there is none or it is unknown). */
export function decodeXmlResponseText(response: HttpTransportResponse): string {
  const head = Buffer.from(response.bytes.subarray(0, 200)).toString('latin1')
  const encoding = XML_DECLARATION_ENCODING.exec(head)?.[1]
  if (encoding === undefined || /^utf-?8$/i.test(encoding) || !iconv.encodingExists(encoding)) {
    return response.body
  }

  return iconv.decode(Buffer.from(response.bytes), encoding)
}
