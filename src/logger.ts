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
  const wrap = (level: keyof PosLogger) => (msg: string, ctx?: unknown) => inner[level](msg, maskSensitiveData(ctx))
  return { debug: wrap('debug'), info: wrap('info'), warn: wrap('warn'), error: wrap('error') }
}
