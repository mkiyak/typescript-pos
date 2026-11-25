import { PosError } from '../../../errors.js'
import type { PosOrder } from '../../../types.js'
import { ownValue } from '../../../util/ownValue.js'
import { parseInstallment } from '../../../util/parseInstallment.js'
import { parseOrderAmount } from '../../../util/parseOrderAmount.js'
import { isSet } from '../../../util/required.js'
import { toKurus } from '../../../util/toKurus.js'

/** Order ids are sent as conversation and basket ids: a letter or digit first, then letters, digits, `_` and `-`, at most 64. */
const ORDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
/** iyzico payment ids are plain positive integers. */
const PAYMENT_ID_PATTERN = /^[1-9]\d{0,19}$/
const IP_PATTERN = /^[0-9A-Fa-f.:]{2,39}$/
const EMAIL_PATTERN = /^[\x21-\x7E]+$/
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
/** Control characters, line and paragraph separators and bidi controls: none of them belongs in a value that is sent. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to find control characters
const CONTROL_CHARACTERS = /[\x00-\x1F\x7F-\x9F\u2028\u2029\u202A-\u202E\u2066-\u2069]/

const MAX_TEXT = 255
const MAX_IDENTITY = 20
const MAX_EMAIL = 100
const MAX_INSTALLMENT = 12
const ITEM_TYPES: readonly string[] = ['PHYSICAL', 'VIRTUAL']

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A required own text of 1 to `max` characters, not blank and without control characters. */
function text(source: Record<string, unknown>, key: string, what: string, max = MAX_TEXT): string {
  const value = ownValue(source, key)
  if (typeof value !== 'string' || value.trim() === '' || value.length > max || CONTROL_CHARACTERS.test(value)) {
    throw new PosError(`${what} is required (text of at most ${max} characters)`)
  }
  return value
}

/** An optional own text; absent is `''`, a value that is present must still be clean text. */
function optionalText(source: Record<string, unknown>, key: string, what: string, max = MAX_TEXT): string {
  const value = ownValue(source, key)
  if (!isSet(value)) {
    return ''
  }
  if (typeof value !== 'string' || value.length > max || CONTROL_CHARACTERS.test(value)) {
    throw new PosError(`${what} must be text of at most ${max} characters`)
  }
  return value
}

export function hasControlCharacters(value: string): boolean {
  return CONTROL_CHARACTERS.test(value)
}

/** The order id: text or a finite number that reads as letters, digits, `_` and `-`, starting with a letter or digit. */
export function iyzicoOrderId(order: PosOrder): string {
  const raw: unknown = isRecord(order) ? ownValue(order, 'id') : undefined
  if (raw === undefined || raw === null || raw === '') {
    throw new PosError('Order field "id" is required')
  }
  if (typeof raw !== 'string' && !(typeof raw === 'number' && Number.isFinite(raw))) {
    throw new PosError('The order id must be text or a number.')
  }
  const id = String(raw)
  if (!ORDER_ID_PATTERN.test(id)) {
    throw new PosError(
      'The order id may only hold letters, digits, underscores and hyphens, and must start with a letter or digit (at most 64).',
    )
  }
  return id
}

/** The order amount in whole kuruş; missing, unreadable, zero, negative, sub-kuruş and 1e13 or larger amounts are refused. */
export function iyzicoOrderKurus(order: PosOrder): number {
  const raw: unknown = isRecord(order) ? ownValue(order, 'amount') : undefined
  if (raw === undefined || raw === null || raw === '') {
    throw new PosError('Order field "amount" is required')
  }
  const amount = parseOrderAmount(raw)
  if (Number.isNaN(amount)) {
    throw new PosError('The order amount must be a number.')
  }
  return toKurus(amount)
}

/** The installment count, 1 for none, at most 12. */
export function iyzicoOrderInstallment(order: PosOrder): number {
  const installment = Math.max(parseInstallment(ownValue(order as Record<string, unknown>, 'installment') ?? 0), 1)
  if (installment > MAX_INSTALLMENT) {
    throw new PosError(`The installment count must be from 1 to ${MAX_INSTALLMENT}.`)
  }
  return installment
}

/** The payer's address of the order, when given: letters, digits, dots and colons of an IP address. */
export function iyzicoOrderIp(order: PosOrder): string | null {
  const ip: unknown = ownValue(order as Record<string, unknown>, 'ip')
  if (!isSet(ip)) {
    return null
  }
  if (typeof ip !== 'string' || !IP_PATTERN.test(ip)) {
    throw new PosError('Order field "ip" must be an IPv4 or IPv6 address')
  }
  return ip
}

/** A payment id read from an order or a callback: an own digit text (or a positive safe integer) as text. */
export function iyzicoPaymentId(value: unknown, field: string): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value)
  }
  if (typeof value !== 'string' || !PAYMENT_ID_PATTERN.test(value)) {
    throw new PosError(`${field} must be an iyzico payment id (digits only)`)
  }
  return value
}

function ownRecord(source: Record<string, unknown>, key: string, what: string): Record<string, unknown> {
  const value = ownValue(source, key)
  if (!isRecord(value)) {
    throw new PosError(`${what} is required`)
  }
  return value
}

/** The buyer of the order in iyzico's field names. Missing required values are errors; optional ones become `''`. */
export function iyzicoBuyer(order: PosOrder): Record<string, string> {
  const buyer = ownRecord(order as Record<string, unknown>, 'buyer', 'Order field "buyer"')
  const email = text(buyer, 'email', 'Order field "buyer.email"', MAX_EMAIL)
  if (!EMAIL_PATTERN.test(email) || email.split('@').length !== 2 || email.startsWith('@') || email.endsWith('@')) {
    throw new PosError(
      'Order field "buyer.email" must be an e-mail address in printable ASCII (at most 100 characters)',
    )
  }
  const ip = ownValue(buyer, 'ip')
  if (typeof ip !== 'string' || !IP_PATTERN.test(ip)) {
    throw new PosError('Order field "buyer.ip" must be the payer\'s IPv4 or IPv6 address')
  }
  const dates = (key: string): string => {
    const value = optionalText(buyer, key, `Order field "buyer.${key}"`, 19)
    if (value !== '' && !DATE_TIME_PATTERN.test(value)) {
      throw new PosError(`Order field "buyer.${key}" must read YYYY-MM-DD HH:mm:ss`)
    }
    return value
  }

  return {
    id: text(buyer, 'id', 'Order field "buyer.id"'),
    name: text(buyer, 'name', 'Order field "buyer.name"'),
    surname: text(buyer, 'surname', 'Order field "buyer.surname"'),
    identityNumber: text(buyer, 'identity_number', 'Order field "buyer.identity_number"', MAX_IDENTITY),
    email,
    gsmNumber: optionalText(buyer, 'gsm_number', 'Order field "buyer.gsm_number"'),
    registrationAddress: text(buyer, 'registration_address', 'Order field "buyer.registration_address"'),
    city: text(buyer, 'city', 'Order field "buyer.city"'),
    country: text(buyer, 'country', 'Order field "buyer.country"'),
    zipCode: optionalText(buyer, 'zip_code', 'Order field "buyer.zip_code"'),
    ip,
    registrationDate: dates('registration_date'),
    lastLoginDate: dates('last_login_date'),
  }
}

/**
 * A billing or shipping address in iyzico's field names. An absent address is `null` when it is not required and an
 * error when it is.
 */
export function iyzicoAddress(
  order: PosOrder,
  key: 'billing_address' | 'shipping_address',
  required: boolean,
): Record<string, string> | null {
  const raw = ownValue(order as Record<string, unknown>, key)
  if (!isSet(raw) && !required) {
    return null
  }
  const address = ownRecord(order as Record<string, unknown>, key, `Order field "${key}"`)
  const what = (name: string): string => `Order field "${key}.${name}"`

  return {
    contactName: text(address, 'contact_name', what('contact_name')),
    city: text(address, 'city', what('city')),
    country: text(address, 'country', what('country')),
    address: text(address, 'address', what('address')),
    zipCode: optionalText(address, 'zip_code', what('zip_code')),
  }
}

export interface IyzicoBasketItem {
  id: string
  name: string
  category1: string
  category2: string
  itemType: string
  price: number
}

/**
 * The basket items in iyzico's field names. Every price is read as whole kuruş and the kuruş must add up to the
 * order amount exactly (iyzico refuses a basket that does not, after the payer has typed the card), so nothing is
 * summed as floating point and no request is sent for a basket that does not match.
 */
export function iyzicoBasketItems(order: PosOrder, orderKurus: number): IyzicoBasketItem[] {
  const raw = ownValue(order as Record<string, unknown>, 'basket_items')
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new PosError('Order field "basket_items" must be a non-empty list')
  }

  let total = 0
  const items: IyzicoBasketItem[] = []
  raw.forEach((entry: unknown, index: number) => {
    if (!isRecord(entry)) {
      throw new PosError(`Order field "basket_items[${index}]" must be an object`)
    }
    const what = (name: string): string => `Order field "basket_items[${index}].${name}"`
    const itemType = ownValue(entry, 'item_type')
    if (typeof itemType !== 'string' || !ITEM_TYPES.includes(itemType)) {
      throw new PosError(`${what('item_type')} must be PHYSICAL or VIRTUAL`)
    }
    const price = parseOrderAmount(ownValue(entry, 'price'))
    if (Number.isNaN(price)) {
      throw new PosError(`${what('price')} must be a number`)
    }
    const kurus = toKurus(price)
    total += kurus
    items.push({
      id: text(entry, 'id', what('id')),
      name: text(entry, 'name', what('name')),
      category1: text(entry, 'category1', what('category1')),
      category2: optionalText(entry, 'category2', what('category2')),
      itemType,
      price: kurus / 100,
    })
  })

  if (total !== orderKurus) {
    throw new PosError('Basket item prices must add up to the order amount')
  }
  return items
}
