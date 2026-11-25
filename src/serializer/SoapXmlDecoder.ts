import { PosHttpError } from '../errors.js'
import { XmlDecoder } from './XmlDecoder.js'
import { withEmptyElementText } from './xmlElementText.js'

const MAX_DEPTH = 64
/** A bank answer never defines a document type or entities; one is an attempt to expand data. */
const MARKUP_DECLARATION = /<!(?:doctype|entity)/i
const BODY_KEY = /^(?:[A-Za-z_][\w.-]*:)?Body$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Namespace declarations are not data: `@xmlns` and `@xmlns:*` are dropped at every level, `@xsi:nil` and friends stay. */
function stripNamespaceDeclarations(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) throw new PosHttpError('Bank SOAP response is nested too deeply', { url: '' })
  if (Array.isArray(value)) return value.map((item) => stripNamespaceDeclarations(item, depth + 1))
  if (!isRecord(value)) return value

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === '@xmlns' || key.startsWith('@xmlns:')) continue
    out[key] = stripNamespaceDeclarations(item, depth + 1)
  }

  const keys = Object.keys(out)
  // An element that only declared namespaces is an empty element.
  if (keys.length === 0 && Object.keys(value).length > 0) return ''
  // An element that declared a namespace around plain text is that text.
  if (keys.length === 1 && keys[0] === '#' && typeof out['#'] === 'string') return out['#']

  return out
}

/**
 * The content of the SOAP body, whatever prefix the bank binds to the envelope namespace (`s:`, `soap:`, `env:` or
 * none); the SOAP header is dropped, because it may echo the account's credentials. A body that is missing or empty
 * is an error; a `Fault` inside it is left for the caller to read. Document types and entity definitions are not
 * refused here (see `SoapXmlDecoder`).
 *
 * @throws PosHttpError when the answer is empty, HTML, not XML, or has no body
 */
export function decodeSoapBody(xml: string): Record<string, unknown> {
  const envelope = XmlDecoder.decode(xml)
  const bodyKey = Object.keys(envelope).find((key) => BODY_KEY.test(key))
  const body = bodyKey === undefined ? undefined : envelope[bodyKey]
  if (!isRecord(body)) {
    throw new PosHttpError('Bank SOAP response has no body', { url: '' })
  }

  const stripped = stripNamespaceDeclarations(body, 0)
  if (!isRecord(stripped)) {
    throw new PosHttpError('Bank SOAP response has no body', { url: '' })
  }

  return withEmptyElementText(stripped)
}

/**
 * Decodes a SOAP answer like `decodeSoapBody`, and additionally refuses an answer that defines a document type or
 * entities (the bank never sends one, and the parser would expand a simple internal entity). The check reads the
 * same text the parser reads.
 *
 * @throws PosHttpError when the answer defines a document type or entities, or `decodeSoapBody` would throw
 */
export const SoapXmlDecoder = {
  decode(xml: string): Record<string, unknown> {
    // An HTML error page also starts with a document type; the shared decoder reports that one as an HTML page.
    if (MARKUP_DECLARATION.test(xml) && !/^\s*<!doctype\s+html/i.test(xml)) {
      throw new PosHttpError('Bank SOAP response defines a document type or entities', { url: '' })
    }

    return decodeSoapBody(xml)
  },
}
