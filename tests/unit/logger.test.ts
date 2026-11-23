import { describe, expect, it, vi } from 'vitest'
import { createSafeLogger, noopLogger, type PosLogger } from '../../src/logger.js'

describe('logger', () => {
  it('noopLogger does nothing', () => {
    expect(() => noopLogger.info('x', { a: 1 })).not.toThrow()
  })

  it('createSafeLogger masks ctx for every level', () => {
    const inner: PosLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const log = createSafeLogger(inner)
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      log[level]('msg', { pan: '4111111111111111', ok: 'yes' })
      expect(inner[level]).toHaveBeenCalledWith('msg', {
        pan: expect.not.stringContaining('4111111111111111'),
        ok: 'yes',
      })
    }
  })

  it('passes undefined ctx through', () => {
    const inner: PosLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    createSafeLogger(inner).info('hi')
    expect(inner.info).toHaveBeenCalledWith('hi', undefined)
  })

  it('never throws on throwing getters, deep nesting or throwing inner logger', () => {
    const inner: PosLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const log = createSafeLogger(inner)
    const bad = {
      get boom(): string {
        throw new Error('nope')
      },
    }
    expect(() => log.error('x', bad)).not.toThrow()
    expect(inner.error).toHaveBeenCalledWith('x', '[unloggable]')

    let deep: Record<string, unknown> = {}
    for (let i = 0; i < 20000; i++) deep = { n: deep }
    expect(() => log.warn('deep', deep)).not.toThrow()
    expect(inner.warn).toHaveBeenCalled()

    const throwing: PosLogger = {
      ...inner,
      info: () => {
        throw new Error('sink down')
      },
    }
    expect(() => createSafeLogger(throwing).info('x', {})).not.toThrow()
  })
})
