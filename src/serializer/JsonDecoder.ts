import { PosHttpError } from '../errors.js'

/** JSON decoder: empty string decodes to an empty object. */
export const JsonDecoder = {
  decode(json: string): Record<string, unknown> {
    if (json === '') return {}
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch (e) {
      throw new PosHttpError('Bank response is not valid JSON', { url: '', body: json }, { cause: e })
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new PosHttpError('Bank response JSON is not an object', { url: '', body: json })
    }
    return parsed as Record<string, unknown>
  },
}
