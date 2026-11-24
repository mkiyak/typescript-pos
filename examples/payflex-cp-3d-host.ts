// VakıfBank Common Payment (3D Host): the card page is hosted by the bank, so card data never reaches your
// server (PCI SAQ A). Nothing here runs on import; call the exported functions from your own route handlers.
import { randomUUID } from 'node:crypto'
import {
  AccountFactory,
  MODEL,
  OrderMismatchError,
  PosFactory,
  type PosOrder,
  type PosResponse,
  posProductionConfig,
  type ThreeDFormData,
  TX_TYPE,
} from 'typescript-pos'

const account = AccountFactory.createPayFlexPosAccount(
  'vakifbank-cp',
  process.env.POS_MERCHANT_ID ?? '',
  process.env.POS_PASSWORD ?? '',
  process.env.POS_TERMINAL_NO ?? '',
)

const pos = PosFactory.createPosGateway(account, posProductionConfig)

/** Callback URLs must be public HTTPS; put an unguessable token in them and map it to the order on your server. */
const newCallbackToken = (): string => randomUUID()

/** Step 1: register the payment. Redirect the browser to `form.gateway` with the `form.inputs` as query string. */
export async function startPayment(
  orderId: string, // letters, digits and "-" only
  amount: number,
  saveCallbackToken: (token: string, orderId: string) => Promise<void>,
) {
  const token = newCallbackToken()
  await saveCallbackToken(token, orderId)
  const order: PosOrder = {
    id: orderId,
    amount,
    currency: 'TRY',
    installment: 0,
    success_url: `https://shop.example.com/pos/success?o=${token}`,
    fail_url: `https://shop.example.com/pos/fail?o=${token}`,
  }
  const form = (await pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)) as ThreeDFormData
  // -> { gateway: '<bank card page>', method: 'GET', inputs: { Ptkn: '…' } }
  const url = new URL(form.gateway)
  for (const [key, value] of Object.entries(form.inputs)) url.searchParams.set(key, String(value))

  return url.toString()
}

/**
 * Step 2: the browser returns to your success/fail URL. The callback data is not trusted: `payment` asks the bank
 * for the real result and checks it against the order.
 */
export async function handleCallback(
  body: Record<string, string | undefined>,
  order: PosOrder, // loaded server-side via the `o` token of the callback URL, never from the callback body
): Promise<{ paid: boolean; reviewNeeded?: boolean; response?: PosResponse }> {
  try {
    const response = await pos.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, body)
    return { paid: response.status === 'approved', reviewNeeded: response.requires_manual_review === true, response }
  } catch (error) {
    if (error instanceof OrderMismatchError) {
      // The bank answered for another payment; if paymentMayHaveCompleted is true, check the bank panel.
      return { paid: false, reviewNeeded: error.paymentMayHaveCompleted }
    }
    throw error
  }
}

/** Re-check a payment later (for example after a timeout) by the TransactionId you stored. */
export async function checkPayment(transactionId: string) {
  return pos.status({ transaction_id: transactionId })
}
