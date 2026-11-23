import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { PosHttpError } from '../errors.js'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  processEntities: true,
})

const fail = (message: string, body: string): never => {
  throw new PosHttpError(message, { url: '', body })
}

/** Returns the root element's children (the root name is dropped). */
export const XmlDecoder = {
  decode(xml: string): Record<string, unknown> {
    if (xml.trim() === '') return fail('Bank returned an empty response body', xml)
    if (/^\s*(<!doctype\s+html|<html[\s>])/i.test(xml)) return fail('Bank returned an HTML page instead of XML', xml)
    const valid = XMLValidator.validate(xml)
    if (valid !== true) return fail(`Bank response is not valid XML: ${valid.err.msg}`, xml)

    let parsed: Record<string, unknown>
    try {
      parsed = parser.parse(xml) as Record<string, unknown>
    } catch (e) {
      throw new PosHttpError('Bank response could not be parsed as XML', { url: '', body: xml }, { cause: e })
    }
    const rootName = Object.keys(parsed)[0]
    if (rootName === undefined) return fail('Bank response has no root element', xml)
    if (rootName.toLowerCase() === 'html') return fail('Bank returned an HTML page instead of XML', xml)
    const root = parsed[rootName]
    if (root === '' || root === undefined || root === null) return {}
    if (typeof root !== 'object') return { '#': root }
    return root as Record<string, unknown>
  },
}
