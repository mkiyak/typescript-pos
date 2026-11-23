const SENSITIVE_KEYS = new Set([
  'pan',
  'number',
  'cardnumber',
  'card_number',
  'cv2',
  'cvv',
  'cvc',
  'expiry',
  'expirydate',
  'exp_year',
  'exp_month',
  'ecom_payment_card_expdate_year',
  'ecom_payment_card_expdate_month',
  'password',
  'merchantpassword',
  'storekey',
  'secret_key',
  'store_key',
])

const PAN_PATTERN = /\b\d{13,19}\b/g
const MASK = '***'

function maskString(value: string): string {
  return value.replace(PAN_PATTERN, (m) => `${m.slice(0, 6)}****${m.slice(-4)}`)
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function mask(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === 'string') return maskString(value)
  if (value === null || typeof value !== 'object') return value

  if (seen.has(value)) return seen.get(value)

  if (value instanceof Error) {
    const out = { name: value.name, message: maskString(value.message) }
    seen.set(value, out)
    return out
  }
  if (Array.isArray(value)) {
    const out: unknown[] = []
    seen.set(value, out)
    for (const item of value) out.push(mask(item, seen))
    return out
  }
  if (!isPlainObject(value)) return value

  const out: Record<string, unknown> = {}
  seen.set(value, out)
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase()) && item !== null && item !== undefined) {
      out[key] = MASK
    } else {
      out[key] = mask(item, seen)
    }
  }
  return out
}

/**
 * Returns a deep copy with sensitive keys replaced by `***` and PAN-shaped digit runs
 * inside strings reduced to `first6****last4`. The input is never mutated.
 */
export function maskSensitiveData<T>(data: T): T {
  return mask(data, new WeakMap()) as T
}
