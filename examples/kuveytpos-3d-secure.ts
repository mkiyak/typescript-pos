// KuveytPos 3D Secure (Kuveyt Türk): the card goes through your server to the bank, which returns its 3D page.
// Nothing here runs on import; call the exported functions from your own route handlers.
import {
  AccountFactory,
  type CreditCard,
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
  'kuveytpos', // key of `banks` in the config
  env('POS_MERCHANT_ID'),
  env('POS_USERNAME'),
  env('POS_CUSTOMER_NUMBER'),
  env('POS_PASSWORD'),
)

// Stateless: build once and share between requests. Use posProductionConfig live.
const pos = PosFactory.createPosGateway(account, posTestConfig)

/** Step 1: returns the bank's 3D page (HTML). Serve it as its own response; it is the bank's untrusted markup. */
export async function startPayment(orderId: string, amount: number, card: CreditCard, customerIp: string) {
  const order: PosOrder = {
    id: orderId, // 1-64 letters, digits, _ or -; unique per attempt, one fixed length
    amount, // major unit: 10.5 = 10,50 TL
    currency: 'TRY',
    installment: 0,
    success_url: 'https://shop.example.com/pos/callback',
    fail_url: 'https://shop.example.com/pos/callback',
    ip: customerIp,
    payment_channel: '02', // '01' mobile, '02' web
    buyer: { email: 'customer@example.com', gsm_number_cc: '90', gsm_number: '5320000000' },
    billing_address: {
      city: 'Istanbul',
      country: '792',
      address: 'Example Street 1',
      zip_code: '34000',
      state: 'Istanbul',
    },
  }
  // Persist `order` (id and amount!) and tie it to the customer's session before showing the page.
  // The card is used here only; never store it, nothing later needs it.
  return pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
}

/** Step 2: the bank POSTs the customer back here (cross-site, so no session cookie may be present). */
export async function handleCallback(
  body: Record<string, string | undefined>,
  order: PosOrder, // the order stored for this customer, never looked up from a callback field
): Promise<{ paid: boolean; review: boolean; response?: PosResponse }> {
  try {
    // The provision is built from your order and sent here; its answer must name your order and amount.
    const response = await pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, body)
    return { paid: response.status === 'approved', review: response.requires_manual_review === true, response }
  } catch (error) {
    if (error instanceof HashMismatchError) {
      // The callback failed verification: forged, or in a format the library does not accept. Re-check with
      // pos.status(order) before telling the customer the payment failed.
      return { paid: false, review: true }
    }
    if (error instanceof OrderMismatchError) {
      // The callback or the bank's booking does not belong to this order. When paymentMayHaveCompleted is set the
      // card may have been charged: alert someone, then cancel or refund it.
      return { paid: false, review: error.paymentMayHaveCompleted, response: error.response }
    }
    // PosHttpError etc.: the outcome is unknown. Keep the order pending and re-check it later with pos.status(order);
    // never retry the payment blindly.
    throw error
  }
}
