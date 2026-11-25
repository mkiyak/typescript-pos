# ToslaPos payments (Tosla)

Gateway `ToslaPos`, bank key `tosla`. Complete compile-checked code:
[`examples/tosla-3d-pay.ts`](https://github.com/mkiyak/typescript-pos/blob/main/examples/tosla-3d-pay.ts).

Status: unit-tested; the request and callback hashes are differential-tested against PHP built-ins (1,000 random sets
each, 0 mismatches).

## Bank and account

```ts
import { AccountFactory, PosFactory, posProductionConfig, posTestConfig } from 'typescript-pos'

const account = AccountFactory.createToslaPosAccount(
  'tosla', // key of `banks` in the config
  clientId,
  apiUser,
  apiPass, // the API password: it signs every request and verifies callbacks
)

const pos = PosFactory.createPosGateway(account, posTestConfig) // or posProductionConfig
```

Empty or blank credentials throw `MissingAccountInfoError` when the account is created.

## Models

| Model | Constant | What happens |
| --- | --- | --- |
| 3D Pay | `MODEL.THREE_D_PAY` | Your server opens a 3D session; the browser posts the card to the bank's `ProcessCardForm`. |
| 3D Host | `MODEL.THREE_D_HOST` | Your server opens a 3D session; the browser opens the bank's own payment page. |
| Non-secure | `MODEL.NON_SECURE` | One server-to-server sale, no 3D step. |

Pre-authorization (`TX_TYPE.PAY_PRE_AUTH`) works with 3D Pay and 3D Host; `TX_TYPE.PAY_POST_AUTH` closes it. Other
operations: `status`, `cancel`, `refund`, partial refund and `orderHistory`. There is no 3D Secure model with a separate
provision: `make3DPayment` throws `UnsupportedPaymentModelError`. `orderHistory` needs `transaction_date` on the order
besides `id`; `page` and `page_size` are optional.

## 3D flow

1. Persist the order (`id`, `amount`, `currency`, `installment`) and tie it to the customer's session. The order also
   needs `success_url`: Tosla posts both successes and failures to that one URL.
2. `pos.get3DFormData(order, model, TX_TYPE.PAY_AUTH, null, true)` first registers a 3D session with the bank from
   your server (one request), then returns what the browser needs:
   - 3D Pay: `{ gateway, method: 'POST', inputs }` for the bank's `ProcessCardForm`. Pass `createWithoutCard: true`
     (the fifth argument) and let the payer type the card into the bank's form; nothing later needs the card, so never
     store it. A card you pass together with that flag is dropped.
   - 3D Host: `{ gateway, method: 'GET', inputs }`, where `gateway` is the bank page's URL for the session.
3. The customer pays; the bank POSTs the browser to your `success_url`.
4. Load the order from the customer's session and call
   `pos.payment(MODEL.THREE_D_PAY | MODEL.THREE_D_HOST, order, TX_TYPE.PAY_AUTH, null, callbackBody)`.

```ts
const form = await pos.get3DFormData(order, MODEL.THREE_D_PAY, TX_TYPE.PAY_AUTH, null, true)
// ...customer returns...
const response = await pos.payment(MODEL.THREE_D_PAY, order, TX_TYPE.PAY_AUTH, null, callbackBody)
```

## Callback handling

- **The signature is always verified.** The bank's `Hash` is checked over a fixed field list, and an approval must
  carry it; a wrong hash throws `HashMismatchError`. Only the order id, the 3D status, the bank's response code and
  message and the request status are signed. Amount, currency and installment count are not.
- **Every approval is confirmed with the bank.** An approved 3D Pay or 3D Host result is checked with one status
  (inquiry) request before it is returned, so expect one extra request per approved payment. The bank's record must show
  this order, amount, currency, transaction type and installment count, open and unrefunded; the result takes its
  authorization code and references from that record. Any other answer throws `OrderMismatchError` with
  `paymentMayHaveCompleted: true` and `error.response` set: alert, check `pos.status(order)`, then cancel or refund.
- **A failed status request propagates.** A `PosHttpError` from the confirmation (an approval that needs it, or the
  check below) means the outcome is unknown: keep the order pending and re-check with `pos.status(order)`.
- **The signed order id must be the order's** (`OrderMismatchError`, nothing is sent). A signed decline is returned as
  the bank sent it and is not bound to your order: never use its `order_id` to look up an order.
- **Bank approval, failed 3D.** When the bank approved the card but the 3D authentication did not fully succeed, the
  result is `declined`. It carries `requires_manual_review: true` only when one status request shows that the bank holds
  a payment for the order; a callback alone raises no alert.
- **Unsigned callbacks** can only become a decline; one that reads as an approval throws `HashMismatchError`, and
  `require_3d_hash: true` rejects unsigned declines too. Their result carries no callback value except bounded decline
  reasons, and never confirms or raises a manual review.
- **Hooks and logs.** Every request carries a hash of the API password, client id, API user, a random value and the
  time. It does not cover the request body, so treat a request hash like a credential: the library masks `hash` in logs,
  and you should keep request bodies out of yours. Ask Tosla whether API requests can be limited to your server IPs.
  A hook that edits the client id, user, random value or time of a prepared request invalidates its signature.
- **Complete each order once.** Mark it paid in an idempotent update.

## Status, sales and unclear answers

`pos.status(order)` returns `status: 'approved'` when the query itself succeeded: read `order_status` for the state of
the payment.

After a non-secure sale or a post-authorization, an empty or unclear answer (no result code, or result code `0`
without the bank's response code) throws `PosHttpError`, and an approved answer for another order throws
`OrderMismatchError` with `paymentMayHaveCompleted`. The outcome is unknown, so keep the order pending, check
`pos.status(order)` and never retry blindly.

## Order ids and amounts

- An order id is 1 to 64 letters, digits, `_` or `-`, starting with a letter or digit. Use ids of one fixed length
  (zero-padded or UUID-based): one id must never be another id plus extra characters, because the signed values have no
  separators.
- Amounts go to the bank in kuruş, rounded like PHP `number_format` (`1.15` becomes `115`).

## Queries

`ToslaPosQuery` offers `customQuery`, `getInstallmentRates` and `getInstallmentPrices`, see
[queries](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md). A custom query needs an `apiUrl` on
the bank's origin.
