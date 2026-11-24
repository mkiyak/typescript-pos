import { PosHttpError } from '../errors.js'

/** Bank field names are plain identifiers; anything else (markup, prose, spaces) means this is not a record list. */
const KEY = /^[A-Za-z][A-Za-z0-9_]*$/

/**
 * Keys that would reach the prototype chain of a plain object are refused outright. The key pattern already rejects
 * `__proto__` (it starts with an underscore); this set guards `constructor` and `prototype`, which the pattern allows.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function malformed(reason: string): PosHttpError {
  // The body is deliberately not part of the message: it may echo card data or credentials.
  return new PosHttpError(`Bank response is not a key=value list: ${reason}`, { url: '' })
}

/**
 * Answers of the bank are `Key=Value` pairs joined by `;;` (sometimes `;;;`). A value may hold `=` and single `;`.
 * Anything that is not such a list (empty body, an HTML error page, a pair without `=`, a bad or repeated key) is
 * rejected, so a gateway error page can never read as a record.
 */
export const InterPosDecoder = {
  decode(body: string): Record<string, unknown> {
    if (body.trim() === '') {
      throw malformed('empty body')
    }

    const result: Record<string, unknown> = {}
    for (const part of body.split(/;;;|;;/)) {
      const at = part.indexOf('=')
      if (at === -1) {
        throw malformed('a part has no "="')
      }
      const key = part.slice(0, at)
      if (!KEY.test(key) || FORBIDDEN_KEYS.has(key)) {
        throw malformed('invalid key')
      }
      if (Object.hasOwn(result, key)) {
        throw malformed('duplicate key')
      }
      result[key] = part.slice(at + 1)
    }

    return result
  },
}
