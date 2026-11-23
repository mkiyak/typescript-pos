function phpUrlEncode(value: string): string {
  // PHP urlencode(): everything except [A-Za-z0-9_.-] is percent-encoded, space becomes "+".
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+')
}

function scalarToString(value: boolean | number | bigint | string): string {
  if (typeof value === 'boolean') return value ? '1' : '0'
  return String(value)
}

/** `prefix` is already url-encoded. */
function sub(prefix: string | null, key: string): string {
  return prefix === null ? phpUrlEncode(key) : `${prefix}%5B${phpUrlEncode(key)}%5D`
}

function build(prefix: string | null, value: unknown, out: string[]): void {
  if (value === null || value === undefined) return
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      build(sub(prefix, String(i)), item, out)
    })
    return
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) build(sub(prefix, k), v, out)
    return
  }
  if (prefix === null) return
  out.push(`${prefix}=${phpUrlEncode(scalarToString(value as string))}`)
}

/** Form encoder; output matches PHP http_build_query() (application/x-www-form-urlencoded). */
export const FormEncoder = {
  encode(data: Record<string, unknown>): string {
    const out: string[] = []
    build(null, data, out)
    return out.join('&')
  },
}
