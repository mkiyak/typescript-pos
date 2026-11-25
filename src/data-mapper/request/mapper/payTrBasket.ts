import { PosError } from '../../../errors.js'
import type { PosOrder } from '../../../types.js'
import { numberFormat2 } from '../../../util/numberFormat2.js'
import { ownValue } from '../../../util/ownValue.js'

const MAX_ITEMS = 100
const MAX_NAME_LENGTH = 100
const MAX_ITEM_COUNT = 9999
const PRICE_TEXT = /^\d{1,13}(?:\.\d{1,2})?$/
const COUNT_TEXT = /^\d{1,4}$/

/**
 * JSON text the way PHP `json_encode` writes it with its default flags: `/` becomes `\/` and every non-ASCII
 * character becomes a lowercase `\uXXXX` escape (surrogate pairs for characters beyond the basic plane), so the
 * result is pure ASCII and byte-identical to what the bank's own tooling produces.
 */
export function phpJsonEncode(value: unknown): string {
  const text = JSON.stringify(value)
  if (typeof text !== 'string') {
    throw new PosError('The value cannot be written as JSON.')
  }
  return (
    text
      .replace(/\//g, '\\/')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: the range is the ASCII block
      .replace(/[^\x00-\x7f]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function basketPrice(value: unknown, index: number): number | string {
  if (typeof value === 'number') {
    // A price with more than two decimals, or one that JavaScript writes in exponent form (below 1e-6 or from 1e21),
    // would be written differently by other encoders; the range check keeps it far from both.
    if (Number.isFinite(value) && value > 0 && value < 1e13 && Number(numberFormat2(value)) === value) {
      return value
    }
  } else if (typeof value === 'string' && PRICE_TEXT.test(value) && Number(value) > 0) {
    return value
  }
  throw new PosError(`Basket item ${index + 1}: "price" must be a positive amount`)
}

function basketCount(value: unknown, index: number): number {
  const count = typeof value === 'string' && COUNT_TEXT.test(value) ? Number(value) : value
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_ITEM_COUNT) {
    throw new PosError(`Basket item ${index + 1}: "item_count" must be a whole number from 1 to ${MAX_ITEM_COUNT}`)
  }
  return count
}

function basketName(value: unknown, index: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_NAME_LENGTH) {
    throw new PosError(`Basket item ${index + 1}: "name" must be text of 1 to ${MAX_NAME_LENGTH} characters`)
  }
  return value
}

/**
 * The basket text PayTR expects: a JSON array of `[name, price, count]` rows. The order's `basket_items` are used
 * when given (every item validated); without them the basket is the single row `[orderId, amount, 1]`, where
 * `amount` is the amount that is actually charged.
 */
export function payTrBasketJson(order: PosOrder, orderId: string, amount: number): string {
  const items: unknown = ownValue(order as Record<string, unknown>, 'basket_items')
  if (items === undefined || items === null) {
    return phpJsonEncode([[orderId, amount, 1]])
  }
  if (!Array.isArray(items)) {
    throw new PosError('Order field "basket_items" must be a list')
  }
  if (items.length === 0) {
    return phpJsonEncode([[orderId, amount, 1]])
  }
  if (items.length > MAX_ITEMS) {
    throw new PosError(`Order field "basket_items" holds more than ${MAX_ITEMS} items`)
  }

  const rows = Array.from(items as unknown[], (item: unknown, index) => {
    if (!isRecord(item)) {
      throw new PosError(`Basket item ${index + 1} must be an object`)
    }
    return [
      basketName(ownValue(item, 'name'), index),
      basketPrice(ownValue(item, 'price'), index),
      basketCount(ownValue(item, 'item_count'), index),
    ]
  })
  return phpJsonEncode(rows)
}
