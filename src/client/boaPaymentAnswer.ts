import { PosHttpError } from '../errors.js'
import { TX_TYPE } from '../PosInterface.js'
import type { ClientTxType } from './AbstractHttpClient.js'

/** Requests of the BOA gateways that can move money: the 3D provision, the sale, the pre-authorization and its close. */
const MONEY_MOVING: ReadonlySet<string> = new Set([TX_TYPE.PAY_AUTH, TX_TYPE.PAY_PRE_AUTH, TX_TYPE.PAY_POST_AUTH])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** An element the bank marks as having no value (`xsi:nil="true"` and no text). */
const isNil = (value: unknown): boolean =>
  isRecord(value) &&
  value['@xsi:nil'] === 'true' &&
  Object.keys(value).every((key) => key === '@xsi:nil' || (key === '#' && value[key] === ''))

/**
 * The answer to a request that can move money must say what happened: an answer without any field (an empty body,
 * an empty root) or without a response code (missing, empty, nil, or a root that holds only text) does not, and the
 * money may have moved. It is a transport failure with an unknown outcome, never a decline. A response code that is
 * not one plain value is left to the gateway, which attaches the mapped answer.
 *
 * @throws PosHttpError when the answer to a money-moving request carries no response code
 */
export function assertPaymentAnswerHasCode(txType: ClientTxType, answer: Record<string, unknown>, url: string): void {
  if (!MONEY_MOVING.has(txType)) return

  if (Object.keys(answer).every((key) => key.startsWith('@'))) {
    throw new PosHttpError('Bank answered the payment request without any data; its outcome is unknown', { url })
  }
  const code: unknown = Object.hasOwn(answer, 'ResponseCode') ? answer.ResponseCode : undefined
  if (code === undefined || code === null || isNil(code) || (typeof code === 'string' && code.trim() === '')) {
    throw new PosHttpError('Bank answered the payment request without a response code; its outcome is unknown', {
      url,
    })
  }
}
