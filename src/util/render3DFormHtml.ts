import { PosError } from '../errors.js'
import type { ThreeDFormData } from '../types.js'

export type Render3DFormOptions = {
  /** CSP nonce for the inline auto-submit script: 8–128 chars of [A-Za-z0-9+/=_-]. */
  nonce?: string
  /** Default true. False renders only the form and a submit button. */
  autoSubmit?: boolean
}

const FORM_ID = 'pos-3d-form'

// The form's own `submit` property is replaced in the browser by an input named `submit`, so the page calls the
// prototype method; the form has no `name` and the inputs no `id`, so nothing on the page can shadow the globals used.
const SUBMIT_SCRIPT = `HTMLFormElement.prototype.submit.call(document.getElementById('${FORM_ID}'))`

const NONCE_PATTERN = /^[A-Za-z0-9+/=_-]{8,128}$/

// With the u flag a surrogate pair is one code point, so this matches only a surrogate without its partner.
const LONE_SURROGATE = /\p{Cs}/u

// Whitespace and control characters are refused rather than trimmed or dropped the way a browser would, so the address
// the page posts to is exactly the one checked here.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is refused
const UNSAFE_URL_CHARS = /[\s\u0000-\u001F\u007F]/

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] as string)
}

function own(obj: object, key: string): unknown {
  return Object.hasOwn(obj, key) ? (obj as Record<string, unknown>)[key] : undefined
}

function isPlainObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The https address of the bank, refused when it could run script, leave https or hide its real host. */
function checkedGateway(gateway: unknown): string {
  if (typeof gateway !== 'string' || UNSAFE_URL_CHARS.test(gateway) || !/^https:\/\//i.test(gateway)) {
    throw new PosError('3D form gateway must be an absolute https URL')
  }
  let url: URL
  try {
    url = new URL(gateway)
  } catch {
    throw new PosError('3D form gateway must be an absolute https URL')
  }
  if (url.protocol !== 'https:' || url.hostname === '') {
    throw new PosError('3D form gateway must be an absolute https URL')
  }
  if (url.username !== '' || url.password !== '') {
    throw new PosError('3D form gateway must not carry user credentials')
  }

  return gateway
}

/**
 * A name or value the browser would change on the way (a lone surrogate becomes U+FFFD in UTF-8, a NUL becomes U+FFFD
 * in the HTML parser) would reach the bank altered, breaking signed fields silently.
 */
function assertSendable(text: string, label: string): void {
  if (LONE_SURROGATE.test(text) || text.includes('\u0000')) {
    throw new PosError(`3D form ${label} cannot be sent unchanged by a browser`)
  }
}

function addInput(pairs: Array<[string, string]>, seen: Set<string>, name: string, value: string): void {
  if (name === '') {
    throw new PosError('3D form input name is empty')
  }
  // A browser sends its page encoding instead of the value of a hidden input with this name.
  if (name.toLowerCase() === '_charset_') {
    throw new PosError('3D form input must not be named _charset_')
  }
  if (seen.has(name)) {
    throw new PosError(`3D form has a duplicate input "${name.slice(0, 64)}"`)
  }
  assertSendable(name, 'input name')
  assertSendable(value, `input "${name.slice(0, 64)}"`)
  seen.add(name)
  pairs.push([name, value])
}

/**
 * One form-encoded name or value of the gateway query. A part the browser could not send back the same way (a
 * malformed escape, bytes that are not UTF-8) is refused instead of being turned into U+FFFD or kept as literal text.
 */
function decodeQueryPart(part: string): string {
  try {
    return decodeURIComponent(part.replaceAll('+', ' '))
  } catch {
    throw new PosError('3D form gateway query is not valid form encoding')
  }
}

/**
 * A complete HTML document that posts (or GETs) the 3D form to the bank. Every name and value is HTML-escaped.
 * The page may carry card data (3D Secure / 3D Pay forms): serve it with `Cache-Control: no-store` and never log or store it.
 *
 * Only form objects are rendered. An HTML string from `get3DFormData` is the bank's own page: serve it as it is on a
 * route of its own, never wrapped in or injected into a page of yours. For a `GET` form the query of the gateway URL
 * becomes hidden inputs (a browser drops the query of a GET form's action). Line breaks in values are sent as CR LF by
 * the browser, as with any form.
 *
 * @throws PosError for a non-https gateway URL, an unknown method, a non-string input, an empty, duplicate or
 *   `_charset_` input name, a GET query that is not valid form encoding or a bad nonce
 */
export function render3DFormHtml(form: ThreeDFormData, options?: Render3DFormOptions): string {
  if (typeof form === 'string') {
    throw new PosError(
      'render3DFormHtml takes a 3D form object; serve an HTML string from get3DFormData as it is on a page of its own',
    )
  }
  if (!isPlainObject(form)) {
    throw new PosError('3D form must be an object')
  }
  const opts: object = options === undefined || options === null ? {} : options
  if (!isPlainObject(opts)) {
    throw new PosError('render3DFormHtml options must be an object')
  }
  const nonce = own(opts, 'nonce')
  if (nonce !== undefined && (typeof nonce !== 'string' || !NONCE_PATTERN.test(nonce))) {
    throw new PosError('render3DFormHtml nonce must be 8 to 128 characters of A-Z a-z 0-9 + / = _ -')
  }
  const autoSubmit = own(opts, 'autoSubmit')
  if (autoSubmit !== undefined && typeof autoSubmit !== 'boolean') {
    throw new PosError('render3DFormHtml autoSubmit must be a boolean')
  }

  const gateway = checkedGateway(own(form, 'gateway'))
  const method = own(form, 'method')
  if (method !== 'POST' && method !== 'GET') {
    throw new PosError('3D form method must be POST or GET')
  }
  const inputs = own(form, 'inputs')
  if (!isPlainObject(inputs)) {
    throw new PosError('3D form inputs must be an object of strings')
  }

  const pairs: Array<[string, string]> = []
  const seen = new Set<string>()
  let action = gateway
  if (method === 'GET') {
    // A browser replaces the query of a GET form's action with the form fields, so the query travels as inputs.
    const hashAt = gateway.indexOf('#')
    const fragment = hashAt === -1 ? '' : gateway.slice(hashAt)
    const beforeFragment = hashAt === -1 ? gateway : gateway.slice(0, hashAt)
    const queryAt = beforeFragment.indexOf('?')
    if (queryAt !== -1) {
      const query = beforeFragment.slice(queryAt + 1)
      if (query !== '') {
        for (const segment of query.split('&')) {
          const equalsAt = segment.indexOf('=')
          if (equalsAt === -1) {
            throw new PosError('3D form gateway query has a parameter without a value')
          }
          addInput(
            pairs,
            seen,
            decodeQueryPart(segment.slice(0, equalsAt)),
            decodeQueryPart(segment.slice(equalsAt + 1)),
          )
        }
      }
      action = beforeFragment.slice(0, queryAt) + fragment
    }
  }
  for (const name of Object.keys(inputs)) {
    const value = own(inputs, name)
    if (typeof value !== 'string') {
      throw new PosError(`3D form input "${name.slice(0, 64)}" must be a string`)
    }
    addInput(pairs, seen, name, value)
  }

  const lines = [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><title>Redirecting to the bank</title></head><body>',
    `<form id="${FORM_ID}" method="${method === 'POST' ? 'post' : 'get'}" action="${escapeHtml(action)}">`,
    ...pairs.map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`),
  ]
  if (autoSubmit === false) {
    lines.push('<button type="submit">Continue</button></form>')
  } else {
    lines.push('<noscript><button type="submit">Continue</button></noscript></form>')
    lines.push(`<script${nonce === undefined ? '' : ` nonce="${nonce}"`}>${SUBMIT_SCRIPT}</script>`)
  }
  lines.push('</body></html>')

  return `${lines.join('\n')}\n`
}
