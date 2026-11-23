// PayFlex V4 (VakıfBank, Ziraat) 3D Secure: card data passes through YOUR server (PCI SAQ D).
// Nothing here runs on import; call the exported functions from your own route handlers.
import {
  AccountFactory,
  CARD_TYPE,
  CreditCardFactory,
  HashMismatchError,
  MODEL,
  OrderMismatchError,
  PayFlexPosAccount,
  PosFactory,
  type PosOrder,
  type PosResponse,
  posProductionConfig,
  TX_TYPE,
} from 'typescript-pos'

const account = AccountFactory.createPayFlexPosAccount(
  'vakifbank',
  process.env.POS_MERCHANT_ID ?? '',
  process.env.POS_PASSWORD ?? '',
  process.env.POS_TERMINAL_NO ?? '',
  PayFlexPosAccount.MERCHANT_TYPE_STANDARD, // must match your contract (test merchant: MAIN_DEALER)
)

// Opt-in: set PAYFLEX_REQUIRE_HASH=1 once your bank signs the callback with `Hash`; with it, an unsigned callback
// is rejected, so leave it off if your bank does not send `Hash`.
const pos = PosFactory.createPosGateway(account, {
  banks: {
    vakifbank: {
      ...posProductionConfig.banks.vakifbank,
      require_3d_hash: process.env.PAYFLEX_REQUIRE_HASH === '1',
    },
  },
})

const newCard = (number: string, year: string, month: string, cvv: string, holder: string) =>
  CreditCardFactory.create(number, year, month, cvv, holder, CARD_TYPE.VISA)

/** Step 1: enrollment. Returns the ACS form to auto-submit, or throws when the card is not enrolled (status N/U/E). */
export async function startPayment(orderId: string, amount: number, card: ReturnType<typeof newCard>) {
  const order: PosOrder = {
    id: orderId,
    amount,
    currency: 'TRY',
    installment: 0,
    ip: '203.0.113.10', // required by PayFlex
    success_url: 'https://shop.example.com/pos/success', // public HTTPS, no "localhost"
    fail_url: 'https://shop.example.com/pos/fail',
  }
  return pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)
  // -> { gateway: '<ACS url>', method: 'POST', inputs: { PaReq, TermUrl, MD } }
}

/** Step 2: the bank POSTs the authentication result back; the provision request happens inside `payment`. */
export async function handleCallback(
  body: Record<string, string | undefined>,
  order: PosOrder, // loaded server-side by id, never from the callback
  card: ReturnType<typeof newCard>, // PayFlex needs the card again for the provision
): Promise<{ paid: boolean; response?: PosResponse }> {
  try {
    const response = await pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, card, body)
    return { paid: response.status === 'approved', response }
  } catch (error) {
    if (error instanceof HashMismatchError || error instanceof OrderMismatchError) {
      return { paid: false } // raised before the provision request: no money moved
    }
    // PosHttpError etc. after the provision request: the outcome is unknown and the card may have been charged.
    // Do not retry blindly; reconcile with pos.status(order) first.
    throw error
  }
}

/** Cancel (same day) or refund a completed payment using the `transaction_id` you stored from the response. */
export async function cancelPayment(transactionId: string) {
  return pos.cancel({ transaction_id: transactionId, ip: '203.0.113.10' })
}
