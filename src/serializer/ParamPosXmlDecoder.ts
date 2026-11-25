import { SoapXmlDecoder } from './SoapXmlDecoder.js'

/**
 * The SOAP body of a Param answer (the service header, which may echo the account's credentials, is dropped). An
 * answer that defines a document type or entities is refused.
 */
export const ParamPosXmlDecoder = { decode: SoapXmlDecoder.decode }
