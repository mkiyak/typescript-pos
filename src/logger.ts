import { maskSensitiveData } from './util/maskSensitiveData.js'

export interface PosLogger {
  debug(msg: string, ctx?: unknown): void
  info(msg: string, ctx?: unknown): void
  warn(msg: string, ctx?: unknown): void
  error(msg: string, ctx?: unknown): void
}

export const noopLogger: PosLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}

/** Wraps a logger so every context object is passed through maskSensitiveData(). */
export function createSafeLogger(inner: PosLogger): PosLogger {
  const wrap = (level: keyof PosLogger) => (msg: string, ctx?: unknown) => {
    let safe: unknown
    try {
      safe = maskSensitiveData(ctx)
    } catch {
      safe = '[unloggable]'
    }
    try {
      inner[level](msg, safe)
    } catch {
      // A logging failure must never break a payment flow.
    }
  }
  return { debug: wrap('debug'), info: wrap('info'), warn: wrap('warn'), error: wrap('error') }
}
