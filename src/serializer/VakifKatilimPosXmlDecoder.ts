import { PosHttpError } from '../errors.js'
import { XmlDecoder } from './XmlDecoder.js'
import { withEmptyElementText } from './xmlElementText.js'

/** The bank never sends a document type or entity definitions; one in an answer is an attempt to expand data. */
const MARKUP_DECLARATION = /<!(?:doctype|entity)/i

/**
 * Decodes the XML answers of the Vakıf Katılım gateway. Two quirks the bank documents are removed first: a null
 * character reference inside values and a `utf-16` declaration on text that is not UTF-16. Document types and
 * entity definitions are refused, HTML and empty pages are `PosHttpError`s (from the shared decoder), and an
 * element that carries only attributes (`xsi:nil`) reads with an empty text so it looks like an empty value.
 *
 * @throws PosHttpError when the answer is not a plain XML document
 */
export const VakifKatilimPosXmlDecoder = {
  decode(xml: string): Record<string, unknown> {
    if (MARKUP_DECLARATION.test(xml) && !/^\s*<!doctype\s+html/i.test(xml)) {
      throw new PosHttpError('Bank response defines a document type or entities', { url: '' })
    }

    const cleaned = xml.replaceAll('&#x0;', '').replaceAll(' encoding="utf-16"', '')

    return withEmptyElementText(XmlDecoder.decode(cleaned))
  },
}
