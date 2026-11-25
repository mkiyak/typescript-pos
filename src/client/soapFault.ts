import { maskSensitiveData } from '../util/maskSensitiveData.js'

export const FAULT_KEY = /^(?:[A-Za-z_][\w.-]*:)?Fault$/
const FAULT_STRING_KEY = /^(?:[A-Za-z_][\w.-]*:)?faultstring$/
export const FAULT_STRING_IN_TEXT = /<(?:[A-Za-z_][\w.-]*:)?faultstring\b[^>]*>([^<]*)</i
const FAULT_MAX = 256
const FAULT_WORKING_MAX = 2048
export const FAULT_PREFIX = 'Bank SOAP fault: '
export const FALLBACK_FAULT = 'Bank request failed'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Bare base64 values of credential length (a hashed password or a signature) that a fault text may echo. */
const BASE64_TOKEN = /[A-Za-z0-9+/]{26,}={1,2}/g
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g
const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Text of a raw (not parsed) fault: the five XML entities and numeric references become characters. */
function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9A-Fa-f]{1,6})|(amp|lt|gt|quot|apos));/g, (match, dec, hex, name) => {
    if (name !== undefined) return NAMED_ENTITIES[name as string] as string
    const code = dec !== undefined ? Number.parseInt(dec as string, 10) : Number.parseInt(hex as string, 16)

    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match
  })
}

/**
 * A bank-supplied fault text, made safe to put in an error message: entities decoded, the request's own secrets
 * (given by the caller), bare base64 tokens and card-shaped digits masked, no control characters, at most
 * 256 characters. Masking comes before shortening so a cut can never leave a piece of a secret.
 */
export function faultMessage(text: string, secrets: readonly string[] = [], limit = FAULT_MAX): string {
  let masked = decodeEntities(text)
  for (const secret of secrets) masked = masked.split(secret).join('***')
  const clean = maskSensitiveData(masked.replace(BASE64_TOKEN, '***').replace(CONTROL_CHARACTERS, ' ').trim())

  return clean === '' ? FALLBACK_FAULT : clean.slice(0, limit)
}

/** The fault text of a parsed `Fault` element. */
export function faultTextOf(fault: Record<string, unknown>): string {
  const key = Object.keys(fault).find((k) => FAULT_STRING_KEY.test(k))
  const value = key === undefined ? undefined : fault[key]
  const text = typeof value === 'string' ? value : isRecord(value) && typeof value['#'] === 'string' ? value['#'] : ''

  // Shortened only when the request's own secrets are known (see the client's `request`), so a cut cannot split one.
  return faultMessage(text, [], FAULT_WORKING_MAX)
}
