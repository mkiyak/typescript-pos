import { PosHttpError } from '../errors.js'

export interface HttpTransportOptions {
  fetch?: typeof fetch
  /** Default 60000. */
  timeoutMs?: number
}

export interface HttpTransportResponse {
  status: number
  /** The body decoded as UTF-8. */
  body: string
  /** The raw body bytes, for gateways that answer in another charset (e.g. ISO-8859-9). */
  bytes: Uint8Array
  headers: Headers
}

const DEFAULT_TIMEOUT_MS = 60_000

export class HttpTransport {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: HttpTransportOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async post(url: string, body: string | Uint8Array, headers: Record<string, string>): Promise<HttpTransportResponse> {
    return this.exchange('POST', url, body, headers)
  }

  /**
   * A GET sends no body. An error carries the URL without its query string, since a query may hold request values.
   */
  async get(url: string, headers: Record<string, string>): Promise<HttpTransportResponse> {
    return this.exchange('GET', url, undefined, headers)
  }

  private async exchange(
    method: 'POST' | 'GET',
    url: string,
    body: string | Uint8Array | undefined,
    headers: Record<string, string>,
  ): Promise<HttpTransportResponse> {
    const errorUrl = method === 'GET' ? (url.split('?')[0] ?? url) : url
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new PosHttpError(`Request timed out after ${this.timeoutMs}ms`, { url }))
      }, this.timeoutMs)
    })

    const run = async (): Promise<HttpTransportResponse> => {
      let res: Response
      let bytes: Uint8Array
      let text: string
      try {
        // redirect: 'error' — a 307/308 would resend the body (card data, credentials) to another host
        res = await this.fetchImpl(url, {
          method,
          ...(body === undefined ? {} : { body: body as string }),
          headers,
          signal: controller.signal,
          redirect: 'error',
        })
        bytes = new Uint8Array(await res.arrayBuffer())
        text = new TextDecoder().decode(bytes)
      } catch (e) {
        if (e instanceof PosHttpError) throw e
        throw new PosHttpError(
          `HTTP request failed: ${e instanceof Error ? e.message : String(e)}`,
          { url: errorUrl },
          { cause: e },
        )
      }
      if (res.status < 200 || res.status >= 300) {
        throw new PosHttpError(`Bank returned HTTP ${res.status}`, { url: errorUrl, status: res.status, body: text })
      }
      return { status: res.status, body: text, bytes, headers: res.headers }
    }

    const pending = run()
    pending.catch(() => {}) // a late rejection after the timeout won must not be unhandled
    try {
      return await Promise.race([pending, timeout])
    } finally {
      clearTimeout(timer)
    }
  }
}
