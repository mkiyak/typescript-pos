import { gunzipSync } from 'node:zlib'
import { PosHttpError } from '../errors.js'
import { JsonDecoder } from './JsonDecoder.js'

/** Decompressed history data larger than this is refused, so a small gzip bomb cannot exhaust memory. */
const MAX_DECOMPRESSED_BYTES = 16 * 1024 * 1024

const STRICT_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

function decodeHistoryData(data: string): Record<string, unknown> {
  try {
    const base64 = data.replace(/[\r\n]/g, '')
    if (!STRICT_BASE64.test(base64) || base64.length % 4 !== 0) {
      throw new PosHttpError('History data is not base64', { url: '' })
    }
    const json = gunzipSync(Buffer.from(base64, 'base64'), { maxOutputLength: MAX_DECOMPRESSED_BYTES }).toString('utf8')
    return JsonDecoder.decode(json)
  } catch (e) {
    throw new PosHttpError('Bank history data could not be decoded', { url: '' }, { cause: e })
  }
}

/**
 * JSON responses of the Akbank API. The transaction report sends its payload as base64 gzip-compressed JSON in a
 * string `data` key, which is expanded in place; a `data` value of any other type is left as the bank sent it.
 */
export const AkbankPosJsonDecoder = {
  decode(body: string): Record<string, unknown> {
    const decoded = JsonDecoder.decode(body)
    if (Object.hasOwn(decoded, 'data') && typeof decoded.data === 'string') {
      decoded.data = decodeHistoryData(decoded.data)
    }

    return decoded
  },
}
