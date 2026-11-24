import { describe, expect, it } from 'vitest'
import { PosError } from '../../../src/errors.js'
import { boaOrderId } from '../../../src/gateway/boaCallback.js'

describe('boaOrderId', () => {
  it('accepts letters, digits, underscores and hyphens after a letter or digit', () => {
    expect(boaOrderId({ id: 'A_1-b' } as never)).toBe('A_1-b')
    expect(boaOrderId({ id: 123 } as never)).toBe('123')
  })

  // addition: the callback binding uses the same rule as the requests (first character a letter or digit)
  it.each(['-abc', '_abc', '', 'a'.repeat(65), 'a b'])('rejects %j', (id) => {
    expect(() => boaOrderId({ id } as never)).toThrow(PosError)
  })
})
