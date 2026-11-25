import { PosError } from '../errors.js'
import { XmlEncoder } from './XmlEncoder.js'

/** An element name, optionally in the `soap:` namespace (the envelope's own `Header` and `Body`). */
const ELEMENT_NAME = /^(?:soap:)?[A-Za-z_][A-Za-z0-9_.-]*$/
const ATTRIBUTE_NAME = /^@[A-Za-z_][A-Za-z0-9_.:-]*$/
const MAX_DEPTH = 32

/** Every key becomes a tag or attribute name, so none may carry markup. */
function checkNames(value: unknown, depth: number): void {
  if (depth > MAX_DEPTH) throw new PosError('SOAP request is nested too deeply')
  if (Array.isArray(value)) {
    for (const item of value) checkNames(item, depth + 1)
    return
  }
  if (value === null || typeof value !== 'object') return

  for (const [key, item] of Object.entries(value)) {
    if (key === '#') continue
    if (key.startsWith('@')) {
      if (!ATTRIBUTE_NAME.test(key)) throw new PosError('SOAP request contains an invalid attribute name')
      continue
    }
    if (!ELEMENT_NAME.test(key)) throw new PosError('SOAP request contains an invalid element name')
    checkNames(item, depth + 1)
  }
}

/**
 * Wraps the request in a SOAP 1.1 envelope written by hand (no SOAP dependency): the `soap`, `xsi` and `xsd`
 * namespaces are declared on the root, text with markup characters goes into CDATA, a `null` value is an empty
 * element, and the document starts with a UTF-8 declaration and ends with a newline.
 */
export const ParamPosXmlEncoder = {
  encode(data: Record<string, unknown>): string {
    checkNames(data, 0)

    const root = XmlEncoder.encode(
      {
        '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
        '@xmlns:soap': 'http://schemas.xmlsoap.org/soap/envelope/',
        ...data,
      },
      { rootName: 'soap:Envelope', omitDeclaration: true },
    )

    return `<?xml version="1.0" encoding="utf-8"?>\n${root}\n`
  },
}
