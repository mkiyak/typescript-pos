import { XmlDecoder } from './XmlDecoder.js'

/**
 * The bank pads its XML with CRLF and indentation, even inside otherwise empty elements. Every CRLF followed by
 * whitespace is dropped before parsing, so `<MD>\r\n</MD>` reads as an empty value; a CRLF run inside a text value
 * disappears too.
 */
export const PayForPosXmlDecoder = {
  decode(xml: string): Record<string, unknown> {
    return XmlDecoder.decode(xml.replace(/\r\n\s*/g, ''))
  },
}
