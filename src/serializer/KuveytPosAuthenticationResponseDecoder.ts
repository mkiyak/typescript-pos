import iconv from 'iconv-lite'
import { PosError } from '../errors.js'
import { XmlDecoder } from './XmlDecoder.js'
import { withEmptyElementText } from './xmlElementText.js'

/** The browser posts this value, so it is hostile input: it is size-limited and may not define entities. */
const MAX_LENGTH = 65_536
const MAX_DEPTH = 32
const MARKUP_DECLARATION = /<!(?:doctype|entity)/i
const DECLARED_ENCODING = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/
const HEX = /^[0-9A-Fa-f]{2}$/

const invalid = (cause?: unknown): PosError =>
  new PosError(
    '3D callback AuthenticationResponse is not valid XML',
    cause === undefined
      ? undefined
      : { cause: new PosError(`XML decoding failed (${(cause as Error)?.name ?? 'error'})`) },
  )

/** PHP `urldecode`: `+` is a space, `%XX` is a byte, anything else (a `%` without two hex digits too) stays as it is. */
function urlDecodeBytes(value: string): Buffer {
  const chunks: Buffer[] = []
  let literal = ''
  const flush = (): void => {
    if (literal !== '') {
      chunks.push(Buffer.from(literal, 'utf8'))
      literal = ''
    }
  }
  for (let i = 0; i < value.length; i++) {
    const char = value[i] as string
    if (char === '+') {
      literal += ' '
    } else if (char === '%' && HEX.test(value.slice(i + 1, i + 3))) {
      flush()
      chunks.push(Buffer.from([Number.parseInt(value.slice(i + 1, i + 3), 16)]))
      i += 2
    } else {
      literal += char
    }
  }
  flush()

  return Buffer.concat(chunks)
}

/** The text in the charset the XML declaration names (UTF-8 when it names none, UTF-8/UTF-16 or an unknown one). */
function bytesToText(bytes: Buffer): string {
  const declared = DECLARED_ENCODING.exec(bytes.subarray(0, 200).toString('latin1'))?.[1]
  if (declared !== undefined && !/^utf-?(?:8|16)/i.test(declared) && iconv.encodingExists(declared)) {
    return iconv.decode(bytes, declared)
  }

  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function depthOf(value: unknown): number {
  let deepest = 0
  const stack: Array<[unknown, number]> = [[value, 1]]
  while (stack.length > 0) {
    const [node, depth] = stack.pop() as [unknown, number]
    if (node === null || typeof node !== 'object') continue
    deepest = Math.max(deepest, depth)
    if (deepest > MAX_DEPTH) return deepest
    for (const child of Object.values(node)) stack.push([child, depth + 1])
  }

  return deepest
}

/**
 * Decodes the `AuthenticationResponse` value the bank has the browser post back: URL-encoded XML. Any failure is a
 * `PosError` that never repeats the input.
 */
export const KuveytPosAuthenticationResponseDecoder = {
  decode(value: string): Record<string, unknown> {
    if (typeof value !== 'string' || value.length > MAX_LENGTH) throw invalid()

    let xml: string
    try {
      xml = bytesToText(urlDecodeBytes(value))
    } catch (e) {
      throw invalid(e)
    }
    if (MARKUP_DECLARATION.test(xml)) throw invalid()

    let decoded: Record<string, unknown>
    try {
      decoded = XmlDecoder.decode(xml)
    } catch (e) {
      throw invalid(e)
    }
    if (depthOf(decoded) > MAX_DEPTH) throw invalid()

    return withEmptyElementText(decoded)
  },
}
