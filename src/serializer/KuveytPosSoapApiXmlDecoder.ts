import { SoapXmlDecoder } from './SoapXmlDecoder.js'

/**
 * The SOAP body decoder of the Kuveyt Turk query endpoint: the shared strict decoder, which refuses an answer that
 * defines a document type or entities.
 */
export const KuveytPosSoapApiXmlDecoder = SoapXmlDecoder
