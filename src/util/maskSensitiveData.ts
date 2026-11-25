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
  'userpass',
  'merchantpass',
  'storekey',
  'secretkey',
  'terminalid',
  'username',
  'secret_key',
  'store_key',
  'cvv2val',
  'expires',
  'expiremonth',
  'expireyear',
  'cvv2',
  'cardcvv2',
  'expiredate',
  'cardexpiredatemonth',
  'cardexpiredateyear',
  'refundpassword',
  'refund_password',
  'auth-hash',
  'authhash',
  'creditcard',
  'expireddate',
  'ccno',
  'expdate',
  'cvc2',
  'cardno',
  'enckey',
  'mac',
  'payerauthenticationcode',
  'hashpassword',
  'hashdata',
  // A request hash signs no body field, so a logged hash plus its body lets a reader send any request.
  'hash',
  'apipass',
  // Param: the API user and password, the merchant key and the card fields of a request body.
  'guid',
  'client_password',
  'client_username',
  'turkpos_retval_guid',
  'kk_no',
  'kk_cvc',
  'kk_sk_ay',
  'kk_sk_yil',
  // PayTR: a logged body plus its request token can be replayed verbatim, so the token, the merchant secrets and the
  // card fields are masked (`card_number`, `cvv` and `hash` are listed above).
  'paytr_token',
  'merchant_key',
  'merchant_salt',
  'expiry_month',
  'expiry_year',
  'cc_owner',
])

const PAN_PATTERN = /(?<!\d)\d{13,19}(?!\d)/g
const MASK = '***'
const MAX_DEPTH = 64

const SENSITIVE_TAGS = [
  'Cvv2Val',
  'Cvv',
  'Cv2',
  'Expiry',
  'ExpiryDate',
  'Expires',
  'ExpireMonth',
  'ExpireYear',
  'Password',
  'MerchantPassword',
  'UserPass',
  'MerchantPass',
  'Pan',
  'CVV2',
  'ExpireDate',
  'cardcvv2',
  'cardexpiredatemonth',
  'cardexpiredateyear',
  'expiredDate',
  'creditCard',
  'SecretKey',
  'StoreKey',
  'auth-hash',
  'ccno',
  'expDate',
  'cvc',
  'Cvc2',
  'CardNo',
  'encKey',
  'mac',
  'PayerAuthenticationCode',
  'HashPassword',
  'HashData',
  // Param request bodies carry the API password and the merchant key; the 3D Host answer's SOAP header echoes the
  // password. `<Islem_GUID>` is a transaction id and stays readable: the tag pattern anchors on `<` and the query
  // pattern on a non-name character before the key.
  'GUID',
  'CLIENT_PASSWORD',
  'CLIENT_USERNAME',
  'TURKPOS_RETVAL_GUID',
  'KK_No',
  'KK_CVC',
  'KK_SK_Ay',
  'KK_SK_Yil',
  'paytr_token',
  'card_number',
  'expiry_month',
  'expiry_year',
  'cc_owner',
  'merchant_key',
  'merchant_salt',
]
// Request fields a JSON error page may echo back. Only the JSON form is masked: a `Hash=` form field of another
// gateway stays readable on purpose.
const JSON_ONLY_TAGS = ['Hash', 'ApiPass']
const XML_PATTERN = new RegExp(`(<(${SENSITIVE_TAGS.join('|')})(?:\\s[^>]*)?>)[^<]*(</\\2\\s*>)`, 'gi')
const QUERY_PATTERN = new RegExp(`(?<![A-Za-z0-9_])(${SENSITIVE_TAGS.join('|')})=[^&\\s"']*`, 'gi')
// JSON-encoded pairs inside strings: "Password" : "value" (escaped quotes allowed in the value) or a bare number
// such as "cvv2":123.
const JSON_PATTERN = new RegExp(
  `"(${[...SENSITIVE_TAGS, ...JSON_ONLY_TAGS].join('|')})"\\s*:\\s*(?:"(?:[^"\\\\]|\\\\.)*"|-?\\d[\\d.eE+-]*)`,
  'gi',
)

function maskString(value: string): string {
  return value
    .replace(XML_PATTERN, `$1${MASK}$3`)
    .replace(QUERY_PATTERN, `$1=${MASK}`)
    .replace(JSON_PATTERN, `"$1":"${MASK}"`)
    .replace(PAN_PATTERN, (m) => `${m.slice(0, 6)}****${m.slice(-4)}`)
}

function mask(value: unknown, seen: WeakMap<object, unknown>, depth: number): unknown {
  if (typeof value === 'string') return maskString(value)
  if (typeof value === 'number' || typeof value === 'bigint') {
    const str = String(value)
    return /^\d{13,19}$/.test(str) ? maskString(str) : value
  }
  if (typeof value === 'function') return '[Function]'
  if (value === null || typeof value !== 'object') return value

  if (seen.has(value)) return seen.get(value)
  if (depth >= MAX_DEPTH) return '[MaxDepth]'

  if (value instanceof Error) {
    const out = { name: value.name, message: maskString(value.message) }
    seen.set(value, out)
    return out
  }
  if (Array.isArray(value)) {
    const out: unknown[] = []
    seen.set(value, out)
    for (const item of value) out.push(mask(item, seen, depth + 1))
    return out
  }

  const tag = Object.prototype.toString.call(value).slice(8, -1)
  if (tag === 'Date') return value
  if (tag !== 'Object') return `[${tag}]`

  // Plain objects and class instances: walk own enumerable properties.
  const out: Record<string, unknown> = {}
  seen.set(value, out)
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase()) && item !== null && item !== undefined) {
      out[key] = MASK
    } else {
      out[key] = mask(item, seen, depth + 1)
    }
  }
  return out
}

/**
 * Returns a deep copy with sensitive keys replaced by `***` and PAN-shaped digit runs
 * inside strings reduced to `first6****last4`. The input is never mutated.
 */
export function maskSensitiveData<T>(data: T): T {
  return mask(data, new WeakMap(), 0) as T
}
