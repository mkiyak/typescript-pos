// Cancel, refund and status for any gateway, with the unknown-outcome rule. See guides/after-payment.md for the
// order fields each gateway reads.
// Nothing here runs on import; pass the gateway you built with PosFactory.
import {
  type AbstractGateway,
  PosHttpError,
  type PosOrder,
  type PosResponse,
  UnsupportedTransactionTypeError,
} from 'typescript-pos'

export type Outcome =
  | { outcome: 'done'; response: PosResponse } // the bank answered: read response.status
  | { outcome: 'unknown'; advice: string } // the bank may have processed it: keep it pending and look it up first

const ADVICE =
  'The answer carried no result. Keep the operation pending in your records, call checkStatus() and retry only when ' +
  'the bank shows no sign of it. Never retry blindly.'

/** Voids a payment that is not settled yet. Safer to repeat than a refund, but check the state all the same. */
export async function cancelPayment(pos: AbstractGateway, order: PosOrder): Promise<Outcome> {
  try {
    return { outcome: 'done', response: await pos.cancel(order) }
  } catch (error) {
    if (error instanceof PosHttpError) return { outcome: 'unknown', advice: ADVICE }
    throw error
  }
}

/**
 * Full refund, or a partial one when `amount` is lower than the original total (`order.order_amount`). Record
 * "refund requested" before the call and mark it done only on `outcome: 'done'` with `status === 'approved'`.
 */
export async function refundPayment(pos: AbstractGateway, order: PosOrder, amount?: number): Promise<Outcome> {
  const request: PosOrder = amount === undefined ? order : { ...order, order_amount: order.amount, amount }
  try {
    return { outcome: 'done', response: await pos.refund(request) }
  } catch (error) {
    if (error instanceof PosHttpError) return { outcome: 'unknown', advice: ADVICE }
    throw error
  }
}

/**
 * Reads the state of a payment (moves no money, so a failed lookup may simply be repeated). Gateways without a
 * status request (Akbank) answer with the order history instead.
 */
export async function checkStatus(pos: AbstractGateway, order: PosOrder): Promise<PosResponse> {
  try {
    return await pos.status(order)
  } catch (error) {
    if (error instanceof UnsupportedTransactionTypeError) return pos.orderHistory(order)
    throw error
  }
}
