// Param 3D Secure: the bank builds the card-check page, your server completes the payment after the callback.
// Nothing here runs on import; call the exported functions from your own route handlers.
import {
  AccountFactory,
  type CreditCard,
  HashMismatchError,
  MissingAccountInfoError,
  MODEL,
  OrderMismatchError,
  PosFactory,
  PosHttpError,
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

const account = AccountFactory.createParamPosAccount(
  'param-pos', // key of `banks` in the config
  env('POS_CLIENT_CODE'),
  env('POS_API_USER'),
  env('POS_API_PASS'),
  env('POS_GUID'), // the merchant GUID: signs requests and callbacks, treat it like a password
)

// Stateless: build once and share between requests. Use posProductionConfig live.
const pos = PosFactory.createPosGateway(account, posTestConfig)
const query = PosQueryFactory.createPosQuery(account, posTestConfig)

/** Step 1: register the payment and return the bank's HTML page. Send it to the browser as it is. */
export async function startPayment(orderId: string, amount: number, payerIp: string, card: CreditCard) {
  const order: PosOrder = {
    id: orderId, // unique per attempt, one fixed length (for example zero-padded)
    amount, // major unit: 10.5 = 10,50 TL
    currency: 'TRY',
    installment: 0,
    ip: payerIp,
    success_url: 'https://shop.example.com/pos/success',
    fail_url: 'https://shop.example.com/pos/fail',
  }
  // Persist `order` (id and amount!) and tie it to the customer's session before responding. Never store the card.
  return pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
}

/** Step 2: the bank sends the customer back here (cross-site, so no session cookie may be present). */
export async function handleCallback(
  body: Record<string, string | undefined>,
  order: PosOrder, // the order stored for this customer, never looked up from a callback field
): Promise<{ paid: boolean; review: boolean; response?: PosResponse }> {
  try {
    // Sends the provision for a matching order, then confirms the approval with one status request.
    const response = await pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, null, body)
    return { paid: response.status === 'approved', review: response.requires_manual_review === true, response }
  } catch (error) {
    if (error instanceof HashMismatchError) {
      // Forged or unsigned callback, or malformed signed fields: re-check with pos.status(order) before telling the
      // customer the payment failed.
      return { paid: false, review: true }
    }
    if (error instanceof OrderMismatchError) {
      // The callback or the bank's record does not belong to this order. When paymentMayHaveCompleted is set the
      // card may have been charged: alert someone and cancel or refund it.
      return { paid: false, review: error.paymentMayHaveCompleted, response: error.response }
    }
    if (error instanceof PosHttpError) {
      // Unknown outcome: keep the order pending, re-check later with pos.status(order), never retry blindly.
      return { paid: false, review: true }
    }
    throw error
  }
}

/** What the bank knows about a card's first six digits. */
export async function cardInfo(bin: string) {
  const answer = await query.getBinList({ bin })
  return answer.bin_list // { bin, bank_code, bank_name, card_type, card_class }
}
