// Pre-authorization and capture without 3D Secure (Garanti BBVA here; other gateways differ in the order fields
// they read, see guides/pre-auth-and-capture.md; AssecoPos also reads `pre_auth_amount`, the reserved amount, when
// the capture is higher). The card comes from your own PCI-scoped form and is never stored.
// Nothing here runs on import; call the exported functions from your own code.
import {
  AccountFactory,
  type CreditCard,
  MissingAccountInfoError,
  MODEL,
  PosError,
  PosFactory,
  PosHttpError,
  type PosOrder,
  type PosResponse,
  posTestConfig,
  TX_TYPE,
} from 'typescript-pos'

function env(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new MissingAccountInfoError(`Missing environment variable ${name}`)
  }
  return value
}

const account = AccountFactory.createGarantiPosAccount(
  'garanti', // key of `banks` in the config
  env('POS_MERCHANT_ID'),
  env('POS_PROVISION_USER'),
  env('POS_PROVISION_PASSWORD'),
  env('POS_TERMINAL_ID'),
  null, // no 3D here
  env('POS_REFUND_USER'), // only the release (cancel) uses the refund user; the capture uses the provision user
  env('POS_REFUND_PASSWORD'),
)

// Stateless: build once and share between requests. Use posProductionConfig live.
const pos = PosFactory.createPosGateway(account, posTestConfig)

/** Reserves the amount. Store the whole result with your order: the capture needs `ref_ret_num` from it. */
export async function reserve(orderId: string, amount: number, card: CreditCard) {
  const order: PosOrder = { id: orderId, amount, currency: 'TRY', installment: 0, ip: '203.0.113.10' }
  try {
    const pre = await pos.payment(MODEL.NON_SECURE, order, TX_TYPE.PAY_PRE_AUTH, card)
    return { reserved: pre.status === 'approved', pre } // keep `amount` (the reserved amount) and pre.ref_ret_num
  } catch (error) {
    if (error instanceof PosHttpError) {
      // Unknown outcome: the bank may hold the amount. Keep the order pending and look it up with pos.status(order)
      // before any new attempt; a second reservation could block the limit twice.
      return { reserved: false, pre: undefined }
    }
    throw error
  }
}

/**
 * Captures `amount` (the reserved amount or less, as far as the bank allows it). A capture has no card and goes
 * through the non-secure entry point whatever model the reservation used. The bank enforces the amount rules: keep the
 * reserved and captured amounts in your own records and compare them before you call.
 */
export async function capture(order: PosOrder, pre: PosResponse, amount: number) {
  try {
    const captured = await pos.payment(
      MODEL.NON_SECURE,
      { ...order, amount, ref_ret_num: refRetNum(pre) },
      TX_TYPE.PAY_POST_AUTH,
      null,
    )
    return { captured: captured.status === 'approved', response: captured }
  } catch (error) {
    if (error instanceof PosHttpError) {
      // Unknown outcome: the capture may have gone through. Read pos.status(order); capture again only when the bank
      // shows no sign of it, never blindly.
      return { captured: false, response: undefined }
    }
    throw error
  }
}

/** Releases a reservation you will not capture (Garanti reads `id` and the reservation's `ref_ret_num`). */
export function release(order: PosOrder, pre: PosResponse): Promise<PosResponse> {
  return pos.cancel({ ...order, ref_ret_num: refRetNum(pre) })
}

/** The reservation's bank reference; a capture or a release without it is not sent. */
function refRetNum(pre: PosResponse): string {
  if (typeof pre.ref_ret_num !== 'string' || pre.ref_ret_num === '') {
    throw new PosError('The reservation result carries no ref_ret_num: store the whole result')
  }
  return pre.ref_ret_num
}
