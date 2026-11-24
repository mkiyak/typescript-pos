import iconv from 'iconv-lite'

export const ISO_8859_1 = 'ISO-8859-1'

const CDATA_SECTION = /(<!\[CDATA\[[\s\S]*?\]\]>)/

const charRef = (char: string): string => `&#x${(char.codePointAt(0) as number).toString(16).toUpperCase()};`

/** Replaces every character ISO-8859-1 cannot represent (anything above U+00FF). */
function replaceUnrepresentable(value: string, replace: (char: string) => string): string {
  let out = ''
  for (const char of value) {
    out += (char.codePointAt(0) as number) <= 0xff ? char : replace(char)
  }
  return out
}

/**
 * Like libxml when saving a document in a legacy charset, characters ISO-8859-1 cannot represent become character
 * references (CDATA sections are split around them) instead of being lost: `İstanbul` is sent as `&#x130;stanbul`.
 */
export function toIso88591Xml(xml: string): string {
  return xml
    .split(CDATA_SECTION)
    .map((part) =>
      part.startsWith('<![CDATA[')
        ? replaceUnrepresentable(part, (c) => `]]>${charRef(c)}<![CDATA[`)
        : replaceUnrepresentable(part, charRef),
    )
    .join('')
}

/** The value as ISO-8859-1 bytes. */
export function encodeIso88591(value: string): Uint8Array {
  return new Uint8Array(iconv.encode(value, ISO_8859_1))
}
