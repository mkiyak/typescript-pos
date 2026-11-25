// iyzico 3D Host (checkout form): your server creates the checkout, the payer enters the card on iyzico's page, and
// iyzico posts a token to your callback URL. The library then reads iyzico's signed checkout record. Nothing here runs
// on import; call the exported functions from your own route handlers.
import {
  AccountFactory,
  HashMismatchError,
  MissingAccountInfoError,
  MODEL,
  OrderMismatchError,
  PosFactory,
  PosHttpError,
  type PosOrder,
  PosQueryFactory,
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

const account = AccountFactory.createIyzicoPosAccount(
  'iyzico', // key of `banks` in the config
  env('IYZICO_API_KEY'),
  env('IYZICO_SECRET_KEY'), // signs every request and verifies iyzico's answers
)

// Stateless: build once and share between requests. Use posProductionConfig live.
const pos = PosFactory.createPosGateway(account, posTestConfig)
const query = PosQueryFactory.createPosQuery(account, posTestConfig)

/** Step 1: create the checkout and return the page for the payer (an https link to redirect to). */
export async function startPayment(orderId: string, payerIp: string) {
  const order: PosOrder = {
    id: orderId, // letters, digits, `_` and `-`; unique per attempt; also the basket and conversation id
    amount: 150.5,
    currency: 'TRY',
    installment: 1,
    success_url: 'https://shop.example.com/pay/callback', // iyzico posts the token here
    lang: 'tr',
    buyer: {
      id: 'customer-1001',
      name: 'Ayse',
      surname: 'Yilmaz',
      identity_number: '11111111111',
      email: 'buyer@example.com',
      registration_address: 'Example Mah. 1. Sok. No:1',
      city: 'Istanbul',
      country: 'Turkey',
      ip: payerIp,
    },
    billing_address: {
      contact_name: 'Ayse Yilmaz',
      city: 'Istanbul',
      country: 'Turkey',
      address: 'Example Mah. 1. Sok. No:1',
    },
    shipping_address: {
      contact_name: 'Ayse Yilmaz',
      city: 'Istanbul',
      country: 'Turkey',
      address: 'Example Mah. 1. Sok. No:1',
    },
    // The item prices must add up to the order amount: 100 + 50.5 = 150.5
    basket_items: [
      { id: 'sku-1', name: 'T-shirt', category1: 'Clothing', item_type: 'PHYSICAL', price: 100 },
      { id: 'sku-2', name: 'Socks', category1: 'Clothing', item_type: 'PHYSICAL', price: 50.5 },
    ],
  }
  // Persist `order` (id and amount!) before returning the page.
  return pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH, null, true, 'array')
  // -> { gateway: 'https://...', method: 'GET' }
}

/** Stub: load the order you stored in step 1 (with its amount) for the payer's session. */
async function loadOrder(_sessionId: string): Promise<PosOrder | null> {
  return null
}

/**
 * Step 2: iyzico posts `token` to your callback URL. The order comes from your own storage, never from the body.
 * Handle callbacks idempotently and never downgrade a paid order because a later callback says declined.
 */
export async function handleCallback(sessionId: string, body: Record<string, string>): Promise<void> {
  const order = await loadOrder(sessionId)
  if (order === null) {
    return // unknown order: nothing to update
  }
  try {
    const response = await pos.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, body)
    if (response.requires_manual_review) {
      // Held for fraud review, or a failed 3D check on a taken payment: do not ship, reconcile in the iyzico panel.
      console.warn(order.id, 'needs manual review')
      return
    }
    // Store the result once per order id; ignore a later decline for an order that is already paid.
    console.log(order.id, response.status)
  } catch (error) {
    if (error instanceof HashMismatchError) {
      throw error // forged or broken callback: answer an error status and investigate
    }
    if (error instanceof OrderMismatchError) {
      if (error.paymentMayHaveCompleted) {
        // The signed answer shows a payment that does not match this order: review it and refund.
        console.warn(order.id, 'payment may have completed for another amount, currency or phase')
        return
      }
      throw error // a checkout or callback of another order reached this handler
    }
    if (error instanceof PosHttpError) {
      // Outcome unknown: keep the order pending and check pos.status(order) before any retry.
      console.warn(order.id, 'outcome unknown')
      return
    }
    throw error
  }
}

/** The card programme of a BIN, for example to show it at checkout. */
export async function binInfo() {
  const answer = await query.getBinList({ bin: '460345' })
  return answer.bin_list[0] // bank_name, card_type, card_class, card_family
}
