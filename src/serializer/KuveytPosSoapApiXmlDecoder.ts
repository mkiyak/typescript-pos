import { PosHttpError } from '../errors.js'
import { XmlDecoder } from './XmlDecoder.js'
import { withEmptyElementText } from './xmlElementText.js'

const MAX_DEPTH = 64
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

  // An element that only declared namespaces is an empty element.
  return Object.keys(out).length === 0 && Object.keys(value).length > 0 ? '' : out
}

/**
 * Returns the content of the SOAP body, whatever prefix the bank binds to the envelope namespace (`s:`, `soap:` or
 * none). A body that is missing or empty is an error; a `Fault` inside it is left for the caller to read.
 *
 * @throws PosHttpError when the answer is empty, HTML, not XML, or has no body
 */
export const KuveytPosSoapApiXmlDecoder = {
  decode(xml: string): Record<string, unknown> {
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
  },
}
