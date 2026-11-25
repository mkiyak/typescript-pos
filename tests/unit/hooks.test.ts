import { describe, expect, it } from 'vitest'
import { PosError } from '../../src/errors.js'
import { prepareRequestDataWithHooks, runHooks } from '../../src/hooks.js'

describe('runHooks', () => {
  it('returns the event when no hooks', async () => {
    const e = { a: 1 }
    expect(await runHooks(undefined, e)).toBe(e)
    expect(await runHooks([], e)).toBe(e)
  })

  it('runs sync and async hooks in order and lets them mutate', async () => {
    const order: number[] = []
    const e = { v: 0 }
    await runHooks<{ v: number }>(
      [
        (x) => {
          order.push(1)
          x.v += 1
        },
        async (x) => {
          await new Promise((r) => setTimeout(r, 5))
          order.push(2)
          x.v *= 10
        },
      ],
      e,
    )
    expect(order).toEqual([1, 2])
    expect(e.v).toBe(10)
  })

  it('propagates hook errors', async () => {
    await expect(runHooks([() => Promise.reject(new Error('x'))], {})).rejects.toThrow('x')
  })
})

// addition: shared request-data hook helper
describe('prepareRequestDataWithHooks', () => {
  type Ev = { requestData: Record<string, unknown> }
  const build = (d: Record<string, unknown>): Ev => ({ requestData: d })

  it('returns the same reference without hooks and never builds the event', async () => {
    const d = { a: 0 }
    let built = 0
    const b = (x: Record<string, unknown>) => {
      built++
      return build(x)
    }
    for (const hooks of [undefined, []]) {
      const r = await prepareRequestDataWithHooks<Ev>(hooks, d, b, 'x')
      expect(r.data).toBe(d)
      expect(r.changed).toBe(false)
    }
    expect(built).toBe(0)
  })

  it('reports a mutation and leaves the input untouched', async () => {
    const d: Record<string, unknown> = { k: 'v' }
    const r = await prepareRequestDataWithHooks<Ev>(
      [
        (e) => {
          e.requestData.a = 1
        },
      ],
      d,
      build,
      'x',
    )
    expect(r.changed).toBe(true)
    expect(r.data.a).toBe(1)
    expect(d).toEqual({ k: 'v' })
  })

  it('accepts a replaced requestData', async () => {
    const r = await prepareRequestDataWithHooks<Ev>(
      [
        (e) => {
          e.requestData = { z: 1 }
        },
      ],
      { a: 1 },
      build,
      'x',
    )
    expect(r).toEqual({ data: { z: 1 }, changed: true })
  })

  it('returns the original reference for a no-op hook', async () => {
    const d = { a: 1 }
    const r = await prepareRequestDataWithHooks<Ev>([() => {}], d, build, 'x')
    expect(r.data).toBe(d)
    expect(r.changed).toBe(false)
  })

  it('throws PosError when the data cannot be cloned', async () => {
    const p = prepareRequestDataWithHooks<Ev>([() => {}], { f: () => 1 }, build, 'x')
    await expect(p).rejects.toBeInstanceOf(PosError)
    await expect(p).rejects.toThrow(/^Request data cannot be cloned for x hooks:/)
    // the clone failure stays reachable as the cause of the PosError
    const error = (await p.catch((e: unknown) => e)) as PosError
    expect(error.cause).toBeInstanceOf(Error)
    expect((error.cause as Error).name).toBe('DataCloneError')
  })
})
