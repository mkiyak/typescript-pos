// PayTR 3D Host (iFrame): your server asks PayTR for a token, the payer's browser opens PayTR's page, and PayTR
// reports the result to your notification URL, server to server. Nothing here runs on import; call the exported
// functions from your own route handlers.
import {
  AccountFactory,
  HashMismatchError,
  MissingAccountInfoError,
  MODEL,
  OrderMismatchError,
  PayTrPos,
  PosFactory,
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

const account = AccountFactory.createPayTrPosAccount(
  'paytr', // key of `banks` in the config
  env('PAYTR_MERCHANT_ID'),
  env('PAYTR_MERCHANT_SALT'),
  env('PAYTR_MERCHANT_KEY'), // signs every request and verifies notifications
)

// Stateless: build once and share between requests. Use posProductionConfig live (the test config makes every
// request a test transaction).
const pos = PosFactory.createPosGateway(account, posTestConfig)
const query = PosQueryFactory.createPosQuery(account, posTestConfig)

/** Step 1: ask PayTR for a token and return the page for an iframe `src` (or a redirect). */
export async function startPayment(orderId: string, amount: number, payerIp: string) {
  const order: PosOrder = {
    id: orderId, // letters and digits only, unique per attempt
    amount, // major unit: 10.5 = 10,50 TL
    currency: 'TRY',
    installment: 0, // for 3D Host: the highest installment the payer may pick
    ip: payerIp,
    success_url: 'https://shop.example.com/pay/success', // shows "being processed"; confirms nothing
    fail_url: 'https://shop.example.com/pay/fail',
    lang: 'tr',
    buyer: { email: 'buyer@example.com', name: 'Ayse Yilmaz', gsm_number: '05320000000' },
    billing_address: { address: 'Example Mah. 1. Sok. No:1 Istanbul' },
    basket_items: [{ name: 'T-shirt', price: amount, item_count: 1 }],
  }
  // Persist `order` (id and amount!) before returning the page.
  return pos.get3DFormData(order, MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)
  // -> { gateway: 'https://www.paytr.com/odeme/guvenli/<token>', method: 'GET' }
}

/** Stub: load the order you stored in step 1 (with its amount) by id. */
async function loadOrder(_id: string): Promise<PosOrder | null> {
  return null
}

/**
 * Step 2: PayTR posts the result to your notification URL. Pass the raw form body; answer the returned text as the
 * plain response body. `OK` also for declines and duplicates, otherwise PayTR keeps retrying.
 */
export async function handleNotification(body: Record<string, string>): Promise<'OK'> {
  const id = PayTrPos.notificationOrderId(body) // unverified: only to find the order
  const order = await loadOrder(id)
  if (order === null) {
    return 'OK' // unknown order: nothing to update
  }
  try {
    const response = await pos.payment(MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, body)
    // Store the result once per order id: act on the first verified result and never downgrade an approved order.
    console.log(order.id, response.status)
    return 'OK'
  } catch (error) {
    if (error instanceof HashMismatchError) {
      throw error // forged or malformed: answer an error status, not OK, and investigate
    }
    if (error instanceof OrderMismatchError) {
      if (error.paymentMayHaveCompleted) {
        // The signed notification proves the payer was charged for this order, but at another amount or currency:
        // alert someone and refund the order or collect the rest. error.response holds the approved result.
        return 'OK'
      }
      throw error // the wrong order was loaded, or a test payment reached a live gateway
    }
    throw error
  }
}

/** The cards of a BIN, for example to show the card programme. */
export async function binInfo() {
  const answer = await query.getBinList({ bin: '435508' })
  return answer.bin_list[0] // bank_name, card_type, card_class, card_family
}
