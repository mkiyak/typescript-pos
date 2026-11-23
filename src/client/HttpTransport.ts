import { PosHttpError } from '../errors.js'

export interface HttpTransportOptions {
  fetch?: typeof fetch
  /** Default 60000. */
  timeoutMs?: number
}

export interface HttpTransportResponse {
  status: number
  body: string
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
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new PosHttpError(`Request timed out after ${this.timeoutMs}ms`, { url }))
      }, this.timeoutMs)
    })

    const exchange = async (): Promise<HttpTransportResponse> => {
      let res: Response
      let text: string
      try {
        res = await this.fetchImpl(url, { method: 'POST', body: body as string, headers, signal: controller.signal })
        text = await res.text()
      } catch (e) {
        if (e instanceof PosHttpError) throw e
        throw new PosHttpError(
          `HTTP request failed: ${e instanceof Error ? e.message : String(e)}`,
          { url },
          { cause: e },
        )
      }
      if (res.status < 200 || res.status >= 300) {
        throw new PosHttpError(`Bank returned HTTP ${res.status}`, { url, status: res.status, body: text })
      }
      return { status: res.status, body: text, headers: res.headers }
    }

    const pending = exchange()
    pending.catch(() => {}) // a late rejection after the timeout won must not be unhandled
    try {
      return await Promise.race([pending, timeout])
    } finally {
      clearTimeout(timer)
    }
  }
}
