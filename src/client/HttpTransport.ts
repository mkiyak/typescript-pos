import { PosError, PosHttpError } from '../errors.js'

export interface HttpTransportOptions {
  fetch?: typeof fetch
  /** Default 60000. */
  timeoutMs?: number
  /**
   * The largest answer body accepted, in bytes (default 10 MiB). A larger answer is refused with
   * `PosHttpError('Bank answer is too large')` and its body is neither kept nor reported.
   */
  maxResponseBytes?: number
}

export interface HttpTransportRequestOptions {
  /**
   * An HTTP 400 answer is returned instead of thrown, for a caller that reads the failure body itself (the one
   * client error code a bank documents for its failure answers). Every other non-2xx answer (401, 403, 404, 429, 3xx,
   * 5xx) is an error as always.
   */
  returnClientErrors?: boolean
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
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const TOO_LARGE = 'Bank answer is too large'

export class HttpTransport {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number

  constructor(options: HttpTransportOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const max = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
    if (!Number.isSafeInteger(max) || max <= 0) {
      throw new PosError('maxResponseBytes must be a positive whole number of bytes.')
    }
    this.maxResponseBytes = max
  }

  async post(
    url: string,
    body: string | Uint8Array,
    headers: Record<string, string>,
    options?: HttpTransportRequestOptions,
  ): Promise<HttpTransportResponse> {
    return this.exchange('POST', url, body, headers, options)
  }

  /**
   * A GET sends no body. An error carries the URL without its query string, since a query may hold request values.
   */
  async get(
    url: string,
    headers: Record<string, string>,
    options?: HttpTransportRequestOptions,
  ): Promise<HttpTransportResponse> {
    return this.exchange('GET', url, undefined, headers, options)
  }

  private async exchange(
    method: 'POST' | 'GET',
    url: string,
    body: string | Uint8Array | undefined,
    headers: Record<string, string>,
    options?: HttpTransportRequestOptions,
  ): Promise<HttpTransportResponse> {
    const errorUrl = method === 'GET' ? (url.split('?')[0] ?? url) : url
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new PosHttpError(`Request timed out after ${this.timeoutMs}ms`, { url: errorUrl }))
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
        bytes = await this.readBody(res, errorUrl, controller)
        text = new TextDecoder().decode(bytes)
      } catch (e) {
        if (e instanceof PosHttpError) throw e
        throw new PosHttpError(
          `HTTP request failed: ${e instanceof Error ? e.message : String(e)}`,
          { url: errorUrl },
          { cause: e },
        )
      }
      const clientError = options?.returnClientErrors === true && res.status === 400
      if (!clientError && (res.status < 200 || res.status >= 300)) {
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

  /**
   * The body bytes, refused as soon as they pass `maxResponseBytes`: up front when the announced Content-Length is
   * larger, otherwise while reading (a missing or wrong Content-Length does not matter). A refused body is cancelled
   * and the request aborted, so an endless or huge answer is never held in memory. A fetch whose body is not a web
   * stream is read whole and checked afterwards.
   */
  private async readBody(res: Response, errorUrl: string, controller: AbortController): Promise<Uint8Array> {
    const tooLarge = (): PosHttpError => {
      controller.abort()
      return new PosHttpError(TOO_LARGE, { url: errorUrl, status: res.status })
    }

    const announced = res.headers.get('content-length')
    if (announced !== null && /^\s*\d+\s*$/.test(announced) && Number(announced) > this.maxResponseBytes) {
      await res.body?.cancel().catch(() => {})
      throw tooLarge()
    }
    if (res.body === null) return new Uint8Array(0)
    if (typeof res.body?.getReader !== 'function') {
      const whole = new Uint8Array(await res.arrayBuffer())
      if (whole.byteLength > this.maxResponseBytes) throw tooLarge()
      return whole
    }

    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > this.maxResponseBytes) {
        await reader.cancel().catch(() => {})
        throw tooLarge()
      }
      chunks.push(value)
    }
    if (chunks.length === 1) return chunks[0] as Uint8Array

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }

    return bytes
  }
}
