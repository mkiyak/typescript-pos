import iconv from 'iconv-lite'
import type { PosLogger } from '../logger.js'
import { noopLogger } from '../logger.js'
import type { PaymentModel } from '../PosInterface.js'
import type { EncodedData } from '../serializer/EncodedData.js'
import { XmlDecoder } from '../serializer/XmlDecoder.js'
import { XmlEncoder } from '../serializer/XmlEncoder.js'
import type { PosOrder } from '../types.js'
import { AbstractHttpClient, type ClientTxType } from './AbstractHttpClient.js'
import type { HttpTransport, HttpTransportResponse } from './HttpTransport.js'

const REQUEST_ENCODING = 'ISO-8859-9'

/** The six Turkish letters ISO-8859-9 has in place of the Latin-1 letters Ð Ý Þ ð ý þ. */
const TURKISH_LETTERS: ReadonlySet<number> = new Set([0x011e, 0x011f, 0x0130, 0x0131, 0x015e, 0x015f])
const REPLACED_LATIN1_LETTERS: ReadonlySet<number> = new Set([0xd0, 0xdd, 0xde, 0xf0, 0xfd, 0xfe])

function inIso88599(codePoint: number): boolean {
  return codePoint <= 0xff ? !REPLACED_LATIN1_LETTERS.has(codePoint) : TURKISH_LETTERS.has(codePoint)
}

/** Replaces every character ISO-8859-9 cannot represent. */
function replaceUnrepresentable(value: string, replace: (char: string) => string): string {
  let out = ''
  for (const char of value) {
    out += inIso88599(char.codePointAt(0) as number) ? char : replace(char)
  }
  return out
}

const CDATA_SECTION = /(<!\[CDATA\[[\s\S]*?\]\]>)/

const charRef = (char: string): string => `&#x${(char.codePointAt(0) as number).toString(16).toUpperCase()};`

/**
 * Like libxml when saving a document in a legacy charset, characters the charset cannot represent become
 * character references (CDATA sections are split around them) instead of being lost.
 */
function toIso88599Xml(xml: string): string {
  return xml
    .split(CDATA_SECTION)
    .map((part) =>
      part.startsWith('<![CDATA[')
        ? replaceUnrepresentable(part, (c) => `]]>${charRef(c)}<![CDATA[`)
        : replaceUnrepresentable(part, charRef),
    )
    .join('')
}

/** `encoding="..."` of an XML declaration at the start of the body (the declaration itself is ASCII). */
const XML_DECLARATION_ENCODING = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/

/**
 * XML (`CC5Request`, ISO-8859-9) posted to the payment API.
 *
 * The body is sent as ISO-8859-9 bytes without a Content-Type header, and a response is decoded
 * with the charset its XML declaration announces (UTF-8 when there is none or it is unknown).
 */
export class AssecoPosHttpClient extends AbstractHttpClient {
  static readonly API_NAME_PAYMENT_API = 'payment_api'

  constructor(endpoint: string, transport: HttpTransport, logger: PosLogger = noopLogger) {
    super(endpoint, transport, logger)
  }

  static supports(gatewayClass: string, apiName: string): boolean {
    return gatewayClass === 'AssecoPos' && apiName === AssecoPosHttpClient.API_NAME_PAYMENT_API
  }

  supportsTx(_txType: ClientTxType, _paymentModel: PaymentModel): boolean {
    return true
  }

  override getApiUrl(txType: ClientTxType, paymentModel: PaymentModel): string {
    return super.getApiUrl(txType, paymentModel)
  }

  protected override encode(
    _txType: ClientTxType,
    _paymentModel: PaymentModel,
    requestData: Record<string, unknown>,
    _order: PosOrder,
  ): EncodedData {
    return {
      data: XmlEncoder.encode(requestData, { rootName: 'CC5Request', encoding: REQUEST_ENCODING }),
      format: 'xml',
    }
  }

  protected override decode(body: string): Promise<Record<string, unknown>> {
    return Promise.resolve(XmlDecoder.decode(body))
  }

  protected override requestBody(encoded: EncodedData): Uint8Array {
    return new Uint8Array(iconv.encode(toIso88599Xml(encoded.data), REQUEST_ENCODING))
  }

  protected override responseText(response: HttpTransportResponse): string {
    const head = Buffer.from(response.bytes.subarray(0, 200)).toString('latin1')
    const encoding = XML_DECLARATION_ENCODING.exec(head)?.[1]
    if (encoding === undefined || /^utf-?8$/i.test(encoding) || !iconv.encodingExists(encoding)) {
      return response.body
    }

    return iconv.decode(Buffer.from(response.bytes), encoding)
  }

  protected override headers(): Record<string, string> {
    return {}
  }
}
