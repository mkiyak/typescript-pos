// Vakıf Katılım 3D Host: the card page is at the bank, so no card data reaches your server.
// Nothing here runs on import; call the exported functions from your own route handlers.
import {
  AccountFactory,
  HashMismatchError,
  MissingAccountInfoError,
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
    throw new MissingAccountInfoError(`Missing environment variable ${name}`)
  }
  return value
}

const account = AccountFactory.createBoaPosAccount(
  'vakif-katilim', // key of `banks` in the config
  env('POS_MERCHANT_ID'),
  env('POS_USERNAME'),
  env('POS_CUSTOMER_NUMBER'),
  env('POS_PASSWORD'),
)

// Stateless: build once and share between requests. Use posProductionConfig live.
const pos = PosFactory.createPosGateway(account, posTestConfig)

/**
 * Step 1: build the form your page auto-submits (POST) to the bank's payment page. The form carries the hashed API
 * password, so ask the bank to restrict the API to your server IP addresses.
 */
export async function startPayment(orderId: string, amount: number) {
  const order: PosOrder = {
    id: orderId, // 1-64 letters, digits, _ or -; unique per attempt, one fixed length
    amount, // major unit: 10.5 = 10,50 TL
    currency: 'TRY',
    installment: 0, // enforces a single payment (the bank page may otherwise offer installments)
    success_url: 'https://shop.example.com/pos/callback',
    fail_url: 'https://shop.example.com/pos/callback',
  }
  // Persist `order` (id and amount!) and tie it to the customer's session before redirecting.
  return pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true)
  // -> { gateway: 'https://...', method: 'POST', inputs: { ... } }
}

/** Step 2: the bank POSTs the customer back here (cross-site, so no session cookie may be present). */
export async function handleCallback(
  body: Record<string, string | undefined>,
  order: PosOrder, // the order stored for this customer, never looked up from a callback field
): Promise<{ paid: boolean; review: boolean; response?: PosResponse }> {
  try {
    // An approved result is confirmed with the bank (one status request) before it is returned.
    const response = await pos.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, body)
    return { paid: response.status === 'approved', review: response.requires_manual_review === true, response }
  } catch (error) {
    if (error instanceof HashMismatchError) {
      // The callback failed verification: forged, or in a format the library does not accept.
      return { paid: false, review: true }
    }
    if (error instanceof OrderMismatchError) {
      // The bank did not confirm the payment for this order. Anyone who loaded the form can trigger this, so
      // re-query pos.status(order) before shipping or refunding; with paymentMayHaveCompleted the card may have been
      // charged.
      return { paid: false, review: error.paymentMayHaveCompleted, response: error.response }
    }
    // PosHttpError etc.: the outcome is unknown. Keep the order pending and re-check it with pos.status(order).
    throw error
  }
}
