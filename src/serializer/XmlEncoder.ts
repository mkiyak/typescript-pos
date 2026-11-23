export interface XmlEncoderOptions {
  encoding?: 'UTF-8' | 'ISO-8859-9'
  rootName?: string
  /** Drop the `<?xml ?>` declaration. */
  omitDeclaration?: boolean
}

// Control characters that are illegal in XML 1.0.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;')
}

function scalar(value: unknown): string {
  if (value === true) return '1'
  if (value === false) return '0'
  if (value === null || value === undefined) return ''
  return String(value).replace(ILLEGAL_XML_CHARS, '')
}

/** Text containing <, > or & is wrapped in CDATA. */
function text(value: unknown): string {
  const str = scalar(value)
  if (/[<>&]/.test(str)) return `<![CDATA[${str.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
  return str
}

function element(name: string, value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => element(name, item)).join('')
  if (value !== null && typeof value === 'object') {
    let attrs = ''
    let inner = ''
    for (const [key, v] of Object.entries(value)) {
      if (key.startsWith('@')) attrs += ` ${key.slice(1)}="${escapeAttr(scalar(v))}"`
      else if (key === '#') inner += text(v)
      else inner += element(key, v)
    }
    return inner === '' ? `<${name}${attrs}/>` : `<${name}${attrs}>${inner}</${name}>`
  }
  const str = text(value)
  return str === '' ? `<${name}/>` : `<${name}>${str}</${name}>`
}

/** Hand-rolled XML encoder for the request shapes the gateways send. */
export const XmlEncoder = {
  encode(data: Record<string, unknown>, opts: XmlEncoderOptions = {}): string {
    const root = element(opts.rootName ?? 'response', data)
    if (opts.omitDeclaration) return root
    return `<?xml version="1.0" encoding="${opts.encoding ?? 'UTF-8'}"?>\n${root}\n`
  },
}
