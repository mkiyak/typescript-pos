// Asseco / Payten (NestPay) 3D Pay Hosting: card data is typed on the bank's page and never reaches your server.
// Nothing here runs on import; call the exported functions from your own route handlers.
import {
  AccountFactory,
  HashMismatchError,
  MODEL,
  OrderMismatchError,
  PosFactory,
  type PosOrder,
  type PosResponse,
  posProductionConfig,
  TX_TYPE,
} from 'typescript-pos'

const account = AccountFactory.createAssecoPosAccount(
  'isbank', // key of `banks` in the config
  process.env.POS_CLIENT_ID ?? '',
  process.env.POS_USERNAME ?? '',
  process.env.POS_PASSWORD ?? '',
  process.env.POS_STORE_KEY ?? '', // 3D secret key
)

// Stateless: build once and share between requests.
const pos = PosFactory.createPosGateway(account, posProductionConfig)

/** Step 1: build the form your page auto-submits (POST) to the bank. */
export async function startPayment(orderId: string, amount: number) {
  const order: PosOrder = {
    id: orderId, // unique, 1-64 chars
    amount, // major unit: 10.5 = 10,50 TL
    currency: 'TRY',
    installment: 0,
    ip: '203.0.113.10', // the customer's IP
    success_url: 'https://shop.example.com/pos/callback',
    fail_url: 'https://shop.example.com/pos/callback',
  }
  // Persist `order` (id and amount!) server-side before redirecting; the callback is checked against it.
  return pos.get3DFormData(order, MODEL.THREE_D_PAY_HOSTING, TX_TYPE.PAY_AUTH)
  // -> { gateway: 'https://.../est3Dgate', method: 'POST', inputs: { ... } }
}

/** Step 2: the bank POSTs the customer back here (cross-site, so no session cookie may be present). */
export async function handleCallback(
  body: Record<string, string | undefined>,
  loadOrder: (id: string) => Promise<PosOrder>,
): Promise<{ paid: boolean; review: boolean; response?: PosResponse }> {
  const order = await loadOrder(String(body.oid)) // look the order up by id on the server
  try {
    const response = await pos.payment(MODEL.THREE_D_PAY_HOSTING, order, TX_TYPE.PAY_AUTH, null, body)
    return { paid: response.status === 'approved', review: response.requires_manual_review === true, response }
  } catch (error) {
    if (error instanceof HashMismatchError) {
      return { paid: false, review: false } // forged or corrupted callback
    }
    if (error instanceof OrderMismatchError) {
      // Treat as a failure, even for a declined bank answer. If the bank approved, money may have moved.
      return { paid: false, review: error.response?.requires_manual_review === true, response: error.response }
    }
    throw error
  }
}
