import { ORDER_ID_PATTERN } from '../../../crypt/ParamPosCrypt.js'
import { PosError } from '../../../errors.js'
import type { ParamPosAccount } from '../../../model/account/ParamPosAccount.js'
import type { TxType } from '../../../PosInterface.js'
import type { PosOrder } from '../../../types.js'
import { ownValue } from '../../../util/ownValue.js'
import { parseOrderAmount } from '../../../util/parseOrderAmount.js'
import { isSet } from '../../../util/required.js'
import type { RequestValueFormatterInterface } from '../value-formatter/RequestValueFormatterInterface.js'

export const XMLNS = 'https://turkpos.com.tr/'

/** Return URLs: http(s) and printable ASCII only, so they cannot smuggle blanks or other schemes. */
const URL_PATTERN = /^https?:\/\/[\x21-\x7E]+$/i

const IP_PATTERN = /^[0-9A-Fa-f.:]{2,45}$/

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** An own value of the order; an order that is not an object is a `PosError`, never a `TypeError`. */
export function orderValue(order: PosOrder, key: string): unknown {
  if (!isRecord(order)) {
    throw new PosError('The order must be an object.')
  }
  return ownValue(order, key)
}

export function readOrderId(order: PosOrder): string {
  const raw: unknown = orderValue(order, 'id')
  if (typeof raw !== 'string' && !(typeof raw === 'number' && Number.isSafeInteger(raw))) {
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

/** The amount as the bank writes it for the transaction; a missing, non-numeric, zero or sub-kuruş amount never reaches the bank. */
export function orderAmount(formatter: RequestValueFormatterInterface, order: PosOrder, txType: TxType): string {
  const raw: unknown = orderValue(order, 'amount')
  if (!isSet(raw) || raw === '') {
    throw new PosError('Order field "amount" is required')
  }
  return String(formatter.formatAmount(parseOrderAmount(raw), txType))
}

export function requestIp(order: PosOrder): string {
  const ip: unknown = orderValue(order, 'ip')
  if (typeof ip !== 'string' || !IP_PATTERN.test(ip)) {
    throw new PosError('Order field "ip" must be an IPv4 or IPv6 address.')
  }
  return ip
}

export function returnUrl(order: PosOrder, key: 'success_url' | 'fail_url'): string {
  const url: unknown = orderValue(order, key)
  if (typeof url !== 'string' || !URL_PATTERN.test(url)) {
    throw new PosError(`Order field "${key}" must be an http(s) URL without blanks or non-ASCII characters.`)
  }
  return url
}

export function accountData(account: ParamPosAccount): {
  G: { CLIENT_CODE: string; CLIENT_USERNAME: string; CLIENT_PASSWORD: string }
  GUID: string
} {
  return {
    G: {
      CLIENT_CODE: account.getMerchantId(),
      CLIENT_USERNAME: account.getUsername(),
      CLIENT_PASSWORD: account.getPassword(),
    },
    GUID: account.getSecretKey(),
  }
}

export function envelope(body: Record<string, unknown>): { 'soap:Body': Record<string, unknown> } {
  return { 'soap:Body': body }
}
