import { describe, expect, it } from 'vitest'
import { runHooks } from '../../src/hooks.js'

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
