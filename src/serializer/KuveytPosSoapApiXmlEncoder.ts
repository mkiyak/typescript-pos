import { PosError } from '../errors.js'
import { XmlEncoder } from './XmlEncoder.js'

const SOAP_ENVELOPE_NS = 'http://schemas.xmlsoap.org/soap/envelope/'
const SERVICE_NS = 'http://boa.net/BOA.Integration.VirtualPos/Service'
const ELEMENT_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/
const ATTRIBUTE_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/
const MAX_DEPTH = 32

/** Every element of the request is in the service namespace; attributes (`@…`) and text (`#`) keep their keys. */
function prefixKeys(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) throw new PosError('SOAP request is nested too deeply')
  if (Array.isArray(value)) return value.map((item) => prefixKeys(item, depth + 1))
  if (value === null || typeof value !== 'object') return value

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === '#') {
      out[key] = item
      continue
    }
    if (key.startsWith('@')) {
      // An attribute name becomes markup too.
      if (!ATTRIBUTE_NAME.test(key.slice(1))) throw new PosError('SOAP request contains an invalid attribute name')
      out[key] = item
      continue
    }
    // A key becomes a tag name, so it must not be able to carry markup.
    if (!ELEMENT_NAME.test(key)) throw new PosError('SOAP request contains an invalid element name')
    out[`ser:${key}`] = prefixKeys(item, depth + 1)
  }

  return out
}

/**
 * Wraps the request in a minimal SOAP 1.1 envelope written by hand (no SOAP dependency): every element gets the
 * `ser:` prefix, text with markup characters goes into CDATA, booleans are sent as `1`/`0`, and there is no XML
 * declaration.
 */
export const KuveytPosSoapApiXmlEncoder = {
  encode(data: Record<string, unknown>): string {
    return XmlEncoder.encode(
      {
        '@xmlns:soapenv': SOAP_ENVELOPE_NS,
        '@xmlns:ser': SERVICE_NS,
        'soapenv:Body': prefixKeys(data, 0),
      },
      { rootName: 'soapenv:Envelope', omitDeclaration: true },
    )
  },
}
