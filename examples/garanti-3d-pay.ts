// Garanti BBVA 3D Pay: the card goes to the bank's 3D page through your server and the bank charges during 3D.
// Nothing here runs on import; call the exported functions from your own route handlers.
import {
  AccountFactory,
  type CreditCard,
  HashMismatchError,
  MODEL,
  OrderMismatchError,
  PosFactory,
  type PosOrder,
  type PosResponse,
  posTestConfig,
  TX_TYPE,
} from 'typescript-pos'

const account = AccountFactory.createGarantiPosAccount(
  'garanti', // key of `banks` in the config
  process.env.POS_MERCHANT_ID ?? '',
  process.env.POS_PROVISION_USER ?? '',
  process.env.POS_PROVISION_PASSWORD ?? '',
  process.env.POS_TERMINAL_ID ?? '',
  process.env.POS_STORE_KEY || null, // 3D secret key
  process.env.POS_REFUND_USER || null, // only needed for cancel and refund
  process.env.POS_REFUND_PASSWORD || null,
)

// Stateless: build once and share between requests. posTestConfig sends Mode TEST; use posProductionConfig live.
const pos = PosFactory.createPosGateway(account, posTestConfig)

/** Step 1: build the form your page auto-submits (POST) to the bank. */
export async function startPayment(orderId: string, amount: number, card: CreditCard) {
  const order: PosOrder = {
    id: orderId, // unique per attempt
    amount, // major unit: 10.5 = 10,50 TL
    currency: 'TRY',
    installment: 0,
    ip: '203.0.113.10', // the customer's IP
    success_url: 'https://shop.example.com/pos/callback',
    fail_url: 'https://shop.example.com/pos/callback',
  }
  // Persist `order` (id and amount!) server-side before redirecting; the callback is checked against it.
  return pos.get3DFormData(order, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, card)
  // -> { gateway: 'https://.../servlet/gt3dengine', method: 'POST', inputs: { ... } }
}

/** Step 2: the bank POSTs the customer back here (cross-site, so no session cookie may be present). */
export async function handleCallback(
  body: Record<string, string | undefined>,
  loadOrder: (id: string) => Promise<PosOrder>,
): Promise<{ paid: boolean; review: boolean; response?: PosResponse }> {
  const order = await loadOrder(String(body.oid)) // look the order up by id on the server
  try {
    const response = await pos.payment(MODEL.THREE_D_PAY, order, TX_TYPE.PAY_AUTH, null, body)
    // `declined` with requires_manual_review: the bank may have authorized money although 3D failed.
    return { paid: response.status === 'approved', review: response.requires_manual_review === true, response }
  } catch (error) {
    if (error instanceof HashMismatchError) {
      return { paid: false, review: false } // forged, unsigned or corrupted callback
    }
    if (error instanceof OrderMismatchError) {
      // The callback does not belong to this order (order id, amount, currency, terminal ...). When the bank
      // reported a completed payment the card may have been charged: alert someone and void or refund it.
      return { paid: false, review: error.paymentMayHaveCompleted, response: error.response }
    }
    // PosHttpError etc.: the outcome is unknown. Do not mark the order paid or failed yet; reconcile with
    // pos.status(order) first.
    throw error
  }
}
