type Data = Record<string, unknown>

/**
 * The expectation of a result whose vector predates the base-key guarantee: the keys `order_id`, `proc_return_code`,
 * `error_code` and `error_message` the vector lacks are `null`, appended after the vector's own keys in this order.
 */
export function withBaseKeys<T extends Data>(expected: T): T {
  const completed: Data = { ...expected }
  for (const key of ['order_id', 'proc_return_code', 'error_code', 'error_message']) {
    if (!Object.hasOwn(completed, key)) completed[key] = null
  }

  return completed as T
}
