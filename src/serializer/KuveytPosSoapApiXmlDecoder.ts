import { decodeSoapBody } from './SoapXmlDecoder.js'

/**
 * The SOAP body decoder of the Kuveyt Turk query endpoint: the shared body logic without the refusal of document
 * types, so the answers this endpoint has always been read with keep reading the same way.
 */
export const KuveytPosSoapApiXmlDecoder = { decode: decodeSoapBody }
