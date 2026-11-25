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

  // addition: 3.3b a wrapped logger handed to another component is wrapped again; the second layer changes nothing
  it('createSafeLogger of a safe logger masks once, keeps every level and gives the same output', () => {
    const levels = ['debug', 'info', 'warn', 'error'] as const
    const make = (): PosLogger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
    const ctx = { pan: '4111111111111111', cvv: '123', note: 'card 4111111111111111 used', ok: 'yes' }
    const once = make()
    const twice = make()
    const single = createSafeLogger(once)
    const double = createSafeLogger(createSafeLogger(twice))

    for (const level of levels) {
      single[level]('msg', ctx)
      double[level]('msg', ctx)
    }

    for (const level of levels) {
      expect(twice[level]).toHaveBeenCalledTimes(1)
      for (const other of levels.filter((l) => l !== level)) {
        expect(twice[other]).toHaveBeenCalledTimes(1)
      }
      expect(twice[level]).toHaveBeenCalledWith('msg', (once[level] as ReturnType<typeof vi.fn>).mock.calls[0]?.[1])
    }
    const seen = JSON.stringify((twice.info as ReturnType<typeof vi.fn>).mock.calls)
    expect(seen).not.toContain('4111111111111111')
    expect(seen).not.toContain('"123"')
    expect(seen).toContain('"ok":"yes"')
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
