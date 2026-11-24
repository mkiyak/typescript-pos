// Akbank 3D Host: the card page is at the bank, so no card data reaches your server.
// Nothing here runs on import; call the exported functions from your own route handlers.
import {
  AccountFactory,
  HashMismatchError,
  MODEL,
  OrderMismatchError,
  PosFactory,
  type PosOrder,
  type PosResponse,
  posTestConfig,
  TX_TYPE,
} from 'typescript-pos'

function env(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing environment variable ${name}`)
  }
  return value
}

const account = AccountFactory.createAkbankPosAccount(
  'akbank-pos', // key of `banks` in the config
  env('POS_MERCHANT_SAFE_ID'),
  env('POS_TERMINAL_SAFE_ID'),
  env('POS_SECRET_KEY'), // signs every request and the 3D form
)

// Stateless: build once and share between requests. Use posProductionConfig live.
const pos = PosFactory.createPosGateway(account, posTestConfig)

/** Step 1: build the form your page auto-submits (POST) to the bank's payment page. */
export async function startPayment(orderId: string, amount: number) {
  const order: PosOrder = {
    id: orderId, // unique per attempt, one fixed length (for example zero-padded)
    amount, // major unit: 10.5 = 10,50 TL
    currency: 'TRY',
    installment: 0,
    ip: '203.0.113.10', // the customer's IP
    success_url: 'https://shop.example.com/pos/callback',
    fail_url: 'https://shop.example.com/pos/callback',
  }
  // Persist `order` (id and amount!) and tie it to the customer's session before redirecting.
  return pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true)
  // -> { gateway: 'https://.../payhosting', method: 'POST', inputs: { ... } }
}

/** Step 2: the bank POSTs the customer back here (cross-site, so no session cookie may be present). */
export async function handleCallback(
  body: Record<string, string | undefined>,
  order: PosOrder, // the order stored for this customer, never looked up from a callback field
): Promise<{ paid: boolean; review: boolean; response?: PosResponse }> {
  try {
    // An approved result is confirmed with the bank (one order-history request) before it is returned.
    const response = await pos.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, body)
    return { paid: response.status === 'approved', review: response.requires_manual_review === true, response }
  } catch (error) {
    if (error instanceof HashMismatchError) {
      return { paid: false, review: false } // forged, unsigned or corrupted callback
    }
    if (error instanceof OrderMismatchError) {
      // The callback does not belong to this order, or the bank did not confirm the payment. When
      // paymentMayHaveCompleted is set the card may have been charged: alert someone and void or refund it.
      return { paid: false, review: error.paymentMayHaveCompleted, response: error.response }
    }
    // PosHttpError etc.: the outcome is unknown. Do not mark the order paid or failed yet; re-check it later
    // with pos.orderHistory(order).
    throw error
  }
}
