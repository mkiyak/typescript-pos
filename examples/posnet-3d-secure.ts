// Yapı Kredi POSNET 3D Secure: your server registers the card with the bank (PCI DSS scope applies).
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

const account = AccountFactory.createPosNetPosAccount(
  'yapikredi', // key of `banks` in the config
  env('POS_MERCHANT_ID'),
  env('POS_TERMINAL_ID'), // the terminal id comes before the POSNET id
  env('POS_POSNET_ID'),
  env('POS_ENC_KEY'), // the 3D encryption key
)

// Stateless: build once and share between requests. Use posProductionConfig live.
const pos = PosFactory.createPosGateway(account, posTestConfig)

/** Step 1: register the card with the bank and build the form your page auto-submits (POST). */
export async function startPayment(orderId: string, amount: number, card: CreditCard) {
  const order: PosOrder = {
    id: orderId, // 1 to 20 of A-Z a-z 0-9 _ -; one fixed length, unique per attempt
    amount, // major unit: 10.5 = 10,50 TL
    currency: 'TRY',
    installment: 0,
    success_url: 'https://shop.example.com/pos/callback?token=<unguessable-token>', // the bank posts every outcome here
  }
  // Persist `order` (id and amount!) and tie it to an unguessable token in the callback URL; never store the card.
  return pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
  // -> { gateway: 'https://.../YKBPaymentService', method: 'POST', inputs: { ... } }
}

/** Step 2: the bank POSTs the customer back here (cross-site, so no session cookie may be present). */
export async function handleCallback(
  body: Record<string, string | undefined>,
  order: PosOrder, // the order stored for this customer, looked up by the token in the callback URL, never from a callback field
): Promise<{ paid: boolean; review: boolean; response?: PosResponse }> {
  try {
    // The bank decrypts the packets and its MAC is verified; the result must match the order before provisioning.
    const response = await pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, body)
    return { paid: response.status === 'approved', review: response.requires_manual_review === true, response }
  } catch (error) {
    if (error instanceof HashMismatchError) {
      return { paid: false, review: false } // forged or corrupted result
    }
    if (error instanceof OrderMismatchError) {
      // The bank resolved another order, amount, currency or installment count: nothing was charged.
      return { paid: false, review: error.paymentMayHaveCompleted, response: error.response }
    }
    // PosHttpError etc.: the outcome is unknown. Do not mark the order paid or failed yet; reconcile with
    // pos.status(order) first.
    throw error
  }
}
