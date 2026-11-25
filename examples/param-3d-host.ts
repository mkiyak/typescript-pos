// Param hosted page (3D Host): the bank's own page collects the card, so no card data reaches your server.
// Nothing here runs on import; call the exported functions from your own route handlers.
import {
  AccountFactory,
  HashMismatchError,
  MissingAccountInfoError,
  MODEL,
  OrderMismatchError,
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

/** The same credentials serve the hosted page (`param-3d-host-pos`) and the lookups (`param-pos`). */
function account(bank: 'param-3d-host-pos' | 'param-pos') {
  return AccountFactory.createParamPosAccount(
    bank, // key of `banks` in the config
    env('POS_CLIENT_CODE'),
    env('POS_API_USER'),
    env('POS_API_PASS'), // also stretched into the key that binds the order: use a strong one
    env('POS_GUID'), // the merchant GUID: treat it like a password
    env('POS_TERMINAL_ID'), // only the hosted page needs it
  )
}

// Stateless: build once and share between requests (reuse the account objects: the first derivation takes a moment).
// Use posProductionConfig live.
const hosted = PosFactory.createPosGateway(account('param-3d-host-pos'), posTestConfig)
const lookup = PosFactory.createPosGateway(account('param-pos'), posTestConfig)

/** Step 1: the form that sends the customer to the bank's page. */
export async function startPayment(orderId: string, amount: number) {
  const order: PosOrder = {
    id: orderId, // unique per attempt
    amount, // major unit: 10.5 = 10,50 TL
    currency: 'TRY',
    installment: 0,
    ip: '203.0.113.10', // the customer's IP
    success_url: 'https://shop.example.com/pos/success',
    fail_url: 'https://shop.example.com/pos/fail',
  }
  // Persist `order` (id, amount and currency stay the same until the callback) and tie it to the customer's session
  // before responding. There is no card to store.
  return hosted.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH) // { gateway, method: 'GET', inputs: { s } }
}

/**
 * Step 2: the customer comes back (cross-site, so no session cookie may be present). Idempotent per order: store
 * `body` with the order, so that an unknown outcome can be checked again by calling this function with it.
 */
export async function handleCallback(
  body: Record<string, string | undefined>,
  order: PosOrder, // the order stored for this customer, never looked up from a callback field
): Promise<{ paid: boolean; review: boolean; recheck?: boolean; bankOrderId?: string; response?: PosResponse }> {
  try {
    // The approval is confirmed with one status request to the bank before it is returned; the bank's record must
    // carry the transaction id derived from this order, so the callback is bound to it.
    const response = await hosted.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, body)
    return {
      paid: response.status === 'approved',
      review: response.requires_manual_review === true,
      // The bank's own order id, confirmed by its record: keep it, every later status, cancel or refund asks for it.
      bankOrderId: response.status === 'approved' ? body.TURKPOS_RETVAL_Siparis_ID : undefined,
      response,
    }
  } catch (error) {
    if (error instanceof HashMismatchError) {
      // Forged or malformed callback: not a result for this order, and none of its fields can be trusted. Keep the
      // order pending.
      return { paid: false, review: false }
    }
    if (error instanceof OrderMismatchError) {
      // The bank's record does not match this order. When paymentMayHaveCompleted is set, the record carries this
      // order's derived transaction id and the card may have been charged: alert someone, check the bank panel, and
      // cancel or refund with the bank's order id.
      return {
        paid: false,
        review: error.paymentMayHaveCompleted,
        bankOrderId: error.paymentMayHaveCompleted ? body.TURKPOS_RETVAL_Siparis_ID : undefined,
        response: error.response,
      }
    }
    if (error instanceof PosHttpError) {
      // Unknown outcome: the status request failed or its answer could not be read. Keep the order pending, never
      // charge again, and check later by calling handleCallback(storedBody, order) again: it repeats the status
      // request bound to this order through the derived transaction id.
      return { paid: false, review: true, recheck: true }
    }
    throw error
  }
}

/**
 * Status of a confirmed hosted payment. It goes through the `ParamPos` gateway and the bank's order id that
 * handleCallback returned (`TURKPOS_RETVAL_Siparis_ID`), never your own order id. It is not bound to your order: for an
 * unknown outcome call handleCallback again instead.
 */
export function hostedStatus(bankOrderId: string): Promise<PosResponse> {
  return lookup.status({ id: bankOrderId })
}

/** Cancel (same day) of a hosted payment; the amount is required. */
export function hostedCancel(bankOrderId: string, amount: number): Promise<PosResponse> {
  return lookup.cancel({ id: bankOrderId, amount })
}
