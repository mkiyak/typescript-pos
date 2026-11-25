// Tosla 3D Pay: the payer types the card into the bank's form, so no card data reaches your server.
// Nothing here runs on import; call the exported functions from your own route handlers.
import {
  AccountFactory,
  HashMismatchError,
  MissingAccountInfoError,
  MODEL,
  OrderMismatchError,
  PosFactory,
  type PosOrder,
  PosQueryFactory,
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

const account = AccountFactory.createToslaPosAccount(
  'tosla', // key of `banks` in the config
  env('POS_CLIENT_ID'),
  env('POS_API_USER'),
  env('POS_API_PASS'), // signs every request and verifies callbacks
)

// Stateless: build once and share between requests. Use posProductionConfig live.
const pos = PosFactory.createPosGateway(account, posTestConfig)
const query = PosQueryFactory.createPosQuery(account, posTestConfig)

/** Step 1: open the bank's 3D session and build the form your page auto-submits (POST) to the bank. */
export async function startPayment(orderId: string, amount: number) {
  const order: PosOrder = {
    id: orderId, // unique per attempt, one fixed length (for example zero-padded)
    amount, // major unit: 10.5 = 10,50 TL
    currency: 'TRY',
    installment: 0,
    success_url: 'https://shop.example.com/pos/callback', // Tosla posts successes and failures here
  }
  // Persist `order` (id and amount!) and tie it to the customer's session before redirecting.
  return pos.get3DFormData(order, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, null, true)
  // -> { gateway: 'https://.../ProcessCardForm', method: 'POST', inputs: { ... } } (no card inside)
}

/** Step 2: the bank POSTs the customer back here (cross-site, so no session cookie may be present). */
export async function handleCallback(
  body: Record<string, string | undefined>,
  order: PosOrder, // the order stored for this customer, never looked up from a callback field
): Promise<{ paid: boolean; review: boolean; response?: PosResponse }> {
  try {
    // An approved result is confirmed with the bank (one status request) before it is returned.
    const response = await pos.payment(MODEL.THREE_D_PAY, order, TX_TYPE.PAY_AUTH, null, body)
    return { paid: response.status === 'approved', review: response.requires_manual_review === true, response }
  } catch (error) {
    if (error instanceof HashMismatchError) {
      // A wrong hash is a forged or unsigned callback. Malformed signed fields can also come from a genuine approval,
      // so re-check with pos.status(order) before you tell the customer the payment failed.
      return { paid: false, review: true }
    }
    if (error instanceof OrderMismatchError) {
      // The callback does not belong to this order, or the bank did not confirm the payment. When
      // paymentMayHaveCompleted is set the card may have been charged: alert someone and void or refund it.
      return { paid: false, review: error.paymentMayHaveCompleted, response: error.response }
    }
    // PosHttpError etc.: the outcome is unknown. Do not mark the order paid or failed yet; re-check it later
    // with pos.status(order).
    throw error
  }
}

/** The installment options of an amount (in TL), for a payment page. */
export async function installmentOptions(amount: number) {
  const answer = await query.getInstallmentPrices({ amount })
  return answer.installment_prices.flatMap((card) => card.prices) // { installment, installment_price, total_price }
}
